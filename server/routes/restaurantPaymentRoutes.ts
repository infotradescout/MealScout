import type { Express } from "express";
import type Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { orderingReviewRequests, restaurants, users } from "@shared/schema";
import { db } from "../db";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { canManageBusinessFinancials } from "../businessFinancialAccess";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { isAdminUserType, isInternalTeamUserType } from "../roleAccess";
import {
  canManageLockedRestaurantConnect,
  restaurantConnectAccountCreationIdempotencyKey,
} from "../utils/restaurantConnectOnboarding";
import { buildOrderingReadiness } from "./menuRoutes";

type Dependencies = {
  stripe: Stripe | null;
};

const onboardingLimiter = distributedRateLimit({
  scope: "restaurant_stripe_onboarding",
  limit: 6,
  windowMs: 60 * 60 * 1000,
});

const statusLimiter = distributedRateLimit({
  scope: "restaurant_stripe_status",
  limit: 30,
  windowMs: 60 * 60 * 1000,
});

export function registerRestaurantPaymentRoutes(
  app: Express,
  { stripe }: Dependencies,
) {
  app.post(
    "/api/admin/restaurants/:restaurantId/ordering-approval",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        if (!isAdminUserType(req.user?.userType)) {
          return res.status(403).json({
            message: "Admin access is required for ordering approval.",
          });
        }
        const restaurantId = String(req.params?.restaurantId || "").trim();
        const body = z
          .object({
            requestId: z.string().trim().min(1).max(128),
            decision: z.enum(["approved", "rejected"]),
            reviewNote: z.string().trim().min(10).max(2000),
            rejectionReason: z.string().trim().min(10).max(1000).optional(),
          })
          .superRefine((value, ctx) => {
            if (value.decision === "rejected" && !value.rejectionReason) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["rejectionReason"],
                message: "A clear rejection reason is required.",
              });
            }
          })
          .parse(req.body || {});
        if (!restaurantId) {
          return res.status(400).json({ message: "Business ID is required." });
        }
        const result = await db.transaction(async (tx: any) => {
          const [currentReviewer] = await tx
            .select({
              id: users.id,
              userType: users.userType,
              isDisabled: users.isDisabled,
            })
            .from(users)
            .where(eq(users.id, req.user.id))
            .limit(1)
            .for("update");
          if (
            !currentReviewer ||
            currentReviewer.isDisabled !== false ||
            !isAdminUserType(currentReviewer.userType)
          ) {
            return { kind: "reviewer_revoked" as const };
          }
          // Lock the aggregate before its request; owner submission uses the
          // same order so review/resubmit races cannot deadlock.
          const [restaurant] = await tx
            .select({
              id: restaurants.id,
              orderingAuthorityVersion: restaurants.orderingAuthorityVersion,
            })
            .from(restaurants)
            .where(eq(restaurants.id, restaurantId))
            .limit(1)
            .for("update");
          if (!restaurant) return { kind: "missing" as const };
          const [request] = await tx
            .select()
            .from(orderingReviewRequests)
            .where(
              and(
                eq(orderingReviewRequests.id, body.requestId),
                eq(orderingReviewRequests.restaurantId, restaurantId),
              ),
            )
            .limit(1)
            .for("update");
          if (!request) {
            return { kind: "missing" as const };
          }
          if (request.status !== "pending") {
            return {
              kind:
                request.status === body.decision
                  ? ("replay" as const)
                  : ("decision_conflict" as const),
              request,
            };
          }
          if (request.requesterUserId === req.user.id) {
            return { kind: "self_review" as const, request };
          }
          if (
            Number(restaurant.orderingAuthorityVersion) !==
            Number(request.submittedAuthorityVersion)
          ) {
            const [superseded] = await tx
              .update(orderingReviewRequests)
              .set({
                status: "superseded",
                reviewerUserId: req.user.id,
                reviewNote: body.reviewNote,
                rejectionReason:
                  "Ordering readiness changed after this request was submitted.",
                reviewedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(orderingReviewRequests.id, request.id))
              .returning();
            return { kind: "stale" as const, request: superseded };
          }

          const readiness = await buildOrderingReadiness(
            restaurantId,
            undefined,
            {
              database: tx,
              reviewMode: true,
              proposedAcknowledgementMinutes:
                request.acknowledgementMinutes,
            },
          );
          if (body.decision === "approved" && !readiness.orderingEnabled) {
            return {
              kind: "not_ready" as const,
              request,
              readiness,
            };
          }

          const now = new Date();
          let approvedRestaurant = null;
          let stagedRequest = request;
          if (body.decision === "approved") {
            [stagedRequest] = await tx
              .update(orderingReviewRequests)
              .set({
                reviewerUserId: req.user.id,
                reviewNote: body.reviewNote,
                rejectionReason: null,
                reviewedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(orderingReviewRequests.id, request.id),
                  eq(orderingReviewRequests.status, "pending"),
                ),
              )
              .returning();
            if (!stagedRequest) {
              throw new Error("Ordering review changed before approval.");
            }
            [approvedRestaurant] = await tx
              .update(restaurants)
              .set({
                orderingApprovedAt: now,
                orderingApprovedByUserId: req.user.id,
                orderingApprovalEvidenceUrl: request.evidenceUrl,
                orderingApprovalReviewNote: body.reviewNote,
                pickupAcknowledgementMinutes:
                  request.acknowledgementMinutes,
                updatedAt: now,
              })
              .where(eq(restaurants.id, restaurantId))
              .returning({
                id: restaurants.id,
                orderingApprovedAt: restaurants.orderingApprovedAt,
                orderingApprovedByUserId:
                  restaurants.orderingApprovedByUserId,
                pickupAcknowledgementMinutes:
                  restaurants.pickupAcknowledgementMinutes,
                orderingAuthorityVersion:
                  restaurants.orderingAuthorityVersion,
              });
          }
          const [decidedRequest] = await tx
            .update(orderingReviewRequests)
            .set({
              status: body.decision,
              reviewerUserId: stagedRequest.reviewerUserId || req.user.id,
              reviewNote: stagedRequest.reviewNote || body.reviewNote,
              rejectionReason:
                body.decision === "rejected"
                  ? body.rejectionReason || null
                  : null,
              reviewedAt: now,
              updatedAt: now,
            })
            .where(eq(orderingReviewRequests.id, request.id))
            .returning();
          return {
            kind: "decided" as const,
            request: decidedRequest,
            restaurant: approvedRestaurant,
            readiness,
          };
        });
        if (result.kind === "missing") {
          return res.status(404).json({ message: "Review request not found." });
        }
        if (result.kind === "reviewer_revoked") {
          return res.status(403).json({
            code: "ordering_reviewer_authority_revoked",
            message: "Current administrator authority is required.",
          });
        }
        if (result.kind === "self_review") {
          return res.status(403).json({
            code: "ordering_review_separation_required",
            message:
              "The person who submitted this request cannot make the admin decision.",
          });
        }
        if (result.kind === "decision_conflict") {
          return res.status(409).json({
            code: "ordering_review_already_decided",
            message: `This request is already ${result.request.status}.`,
            request: result.request,
          });
        }
        if (result.kind === "stale") {
          return res.status(409).json({
            code: "ordering_review_superseded",
            message:
              "Ordering readiness changed. The owner must review and resubmit current evidence.",
            request: result.request,
          });
        }
        if (result.kind === "not_ready") {
          return res.status(409).json({
            code: "ordering_review_not_ready",
            message: "Current ordering readiness does not permit approval.",
            request: result.request,
            readiness: result.readiness,
          });
        }
        return res.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.issues[0]?.message || "Invalid ordering approval.",
          });
        }
        console.error("Restaurant ordering approval failed:", error);
        return res.status(500).json({
          message: "Ordering approval could not be updated.",
        });
      }
    },
  );

  const getOwnedRestaurant = async (req: any) => {
    const restaurantId = String(req.params?.restaurantId || "").trim();
    const userId = String(req.user?.id || "").trim();
    if (!restaurantId || !userId) return null;

    const canManageBilling = await canManageBusinessFinancials({
      restaurantId,
      userId,
      userType: req.user?.userType,
    });
    if (!canManageBilling) return null;

    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    return restaurant || null;
  };

  app.get(
    "/api/restaurants/:restaurantId/ordering-review",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurant = await getOwnedRestaurant(req);
        if (!restaurant) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }
        if (restaurant.ownerId !== req.user.id) {
          return res.status(403).json({
            message: "Only the current business owner may view ordering review.",
          });
        }
        const [latestRequest] = await db
          .select()
          .from(orderingReviewRequests)
          .where(eq(orderingReviewRequests.restaurantId, restaurant.id))
          .orderBy(desc(orderingReviewRequests.createdAt))
          .limit(1);
        const reviewAcknowledgementMinutes = Number(
          latestRequest?.acknowledgementMinutes ||
            restaurant.pickupAcknowledgementMinutes ||
            10,
        );
        const [currentReadiness, reviewReadiness] = await Promise.all([
          buildOrderingReadiness(restaurant.id),
          buildOrderingReadiness(restaurant.id, undefined, {
            reviewMode: true,
            proposedAcknowledgementMinutes: reviewAcknowledgementMinutes,
          }),
        ]);
        return res.json({
          restaurant: {
            id: restaurant.id,
            orderingApprovedAt: restaurant.orderingApprovedAt,
            orderingApprovedByUserId:
              restaurant.orderingApprovedByUserId,
            pickupAcknowledgementMinutes:
              restaurant.pickupAcknowledgementMinutes,
            orderingAuthorityVersion: restaurant.orderingAuthorityVersion,
          },
          request: latestRequest || null,
          currentReadiness,
          reviewReadiness,
        });
      } catch (error) {
        console.error("Ordering review status failed:", error);
        return res
          .status(500)
          .json({ message: "Ordering review status could not be loaded." });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/ordering-review",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurant = await getOwnedRestaurant(req);
        if (!restaurant) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }
        if (restaurant.ownerId !== req.user.id) {
          return res.status(403).json({
            message:
              "Only the current business owner may request ordering review.",
          });
        }
        const body = z
          .object({
            evidenceUrl: z
              .string()
              .trim()
              .url()
              .max(2000)
              .refine((value) => /^https:\/\//i.test(value), {
                message: "Evidence must use HTTPS.",
              }),
            acknowledgementMinutes: z.number().int().min(5).max(30),
            idempotencyKey: z.string().trim().min(8).max(200),
          })
          .parse({
            ...(req.body || {}),
            idempotencyKey:
              req.headers["idempotency-key"] ||
              req.body?.idempotencyKey ||
              "",
          });
        const result = await db.transaction(async (tx: any) => {
          const [lockedRestaurant] = await tx
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, restaurant.id))
            .limit(1)
            .for("update");
          if (!lockedRestaurant) return { kind: "missing" as const };
          if (lockedRestaurant.ownerId !== req.user.id) {
            return { kind: "owner_revoked" as const };
          }
          const [idempotentRequest] = await tx
            .select()
            .from(orderingReviewRequests)
            .where(
              and(
                eq(
                  orderingReviewRequests.restaurantId,
                  lockedRestaurant.id,
                ),
                eq(orderingReviewRequests.idempotencyKey, body.idempotencyKey),
              ),
            )
            .limit(1);
          if (idempotentRequest) {
            const sameRequest =
              idempotentRequest.requesterUserId === req.user.id &&
              idempotentRequest.evidenceUrl === body.evidenceUrl &&
              Number(idempotentRequest.acknowledgementMinutes) ===
                body.acknowledgementMinutes;
            return {
              kind: sameRequest ? ("replay" as const) : ("conflict" as const),
              request: idempotentRequest,
            };
          }
          const [pendingRequest] = await tx
            .select()
            .from(orderingReviewRequests)
            .where(
              and(
                eq(
                  orderingReviewRequests.restaurantId,
                  lockedRestaurant.id,
                ),
                eq(orderingReviewRequests.status, "pending"),
              ),
            )
            .limit(1)
            .for("update");
          if (pendingRequest) {
            return { kind: "pending" as const, request: pendingRequest };
          }
          const readiness = await buildOrderingReadiness(
            lockedRestaurant.id,
            undefined,
            {
              database: tx,
              reviewMode: true,
              proposedAcknowledgementMinutes: body.acknowledgementMinutes,
            },
          );
          if (!readiness.orderingEnabled) {
            return { kind: "not_ready" as const, readiness };
          }
          const [request] = await tx
            .insert(orderingReviewRequests)
            .values({
              restaurantId: lockedRestaurant.id,
              requesterUserId: req.user.id,
              submittedAuthorityVersion: Number(
                lockedRestaurant.orderingAuthorityVersion || 0,
              ),
              acknowledgementMinutes: body.acknowledgementMinutes,
              evidenceUrl: body.evidenceUrl,
              readinessSnapshot: {
                capturedAt: new Date().toISOString(),
                orderingAuthorityVersion:
                  readiness.orderingAuthorityVersion,
                orderingEnabled: readiness.orderingEnabled,
                blockingReasons: readiness.blockingReasons,
                checks: readiness.checks,
              },
              status: "pending",
              idempotencyKey: body.idempotencyKey,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();
          return { kind: "created" as const, request, readiness };
        });
        if (result.kind === "missing") {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }
        if (result.kind === "owner_revoked") {
          return res.status(403).json({
            code: "ordering_owner_authority_revoked",
            message:
              "Only the current business owner may request ordering review.",
          });
        }
        if (result.kind === "conflict") {
          return res.status(409).json({
            code: "ordering_review_idempotency_conflict",
            message:
              "That idempotency key already belongs to different review evidence.",
            request: result.request,
          });
        }
        if (result.kind === "pending") {
          return res.status(409).json({
            code: "ordering_review_pending",
            message: "An ordering review is already pending.",
            request: result.request,
          });
        }
        if (result.kind === "not_ready") {
          return res.status(409).json({
            code: "ordering_review_not_ready",
            message:
              "Resolve every current readiness blocker before requesting review.",
            readiness: result.readiness,
          });
        }
        return res
          .status(result.kind === "created" ? 201 : 200)
          .json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message:
              error.issues[0]?.message || "Invalid ordering review request.",
          });
        }
        console.error("Ordering review submission failed:", error);
        return res
          .status(500)
          .json({ message: "Ordering review could not be submitted." });
      }
    },
  );

  app.get(
    "/api/admin/ordering-reviews",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        if (!isAdminUserType(req.user?.userType)) {
          return res
            .status(403)
            .json({ message: "Admin access is required." });
        }
        const status = z
          .enum(["pending", "approved", "rejected", "superseded"])
          .catch("pending")
          .parse(req.query?.status);
        const rows = await db
          .select({
            request: orderingReviewRequests,
            restaurantName: restaurants.name,
            currentAuthorityVersion: restaurants.orderingAuthorityVersion,
            orderingApprovedAt: restaurants.orderingApprovedAt,
          })
          .from(orderingReviewRequests)
          .innerJoin(
            restaurants,
            eq(restaurants.id, orderingReviewRequests.restaurantId),
          )
          .where(eq(orderingReviewRequests.status, status))
          .orderBy(desc(orderingReviewRequests.createdAt))
          .limit(100);
        const reviews = await Promise.all(
          rows.map(async (row: (typeof rows)[number]) => {
            const readiness = await buildOrderingReadiness(
              row.request.restaurantId,
              undefined,
              {
                reviewMode: true,
                proposedAcknowledgementMinutes:
                  row.request.acknowledgementMinutes,
              },
            );
            return {
              ...row,
              staleAuthority:
                Number(row.currentAuthorityVersion) !==
                Number(row.request.submittedAuthorityVersion),
              readiness,
            };
          }),
        );
        return res.json({ status, reviews });
      } catch (error) {
        console.error("Ordering review queue failed:", error);
        return res
          .status(500)
          .json({ message: "Ordering review queue could not be loaded." });
      }
    },
  );

  app.post(
    "/api/owner/restaurants/:restaurantId/stripe/onboard",
    isAuthenticated,
    onboardingLimiter,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(503).json({
            code: "STRIPE_NOT_CONFIGURED",
            message: "Card payment setup is unavailable right now.",
          });
        }

        const restaurant = await getOwnedRestaurant(req);
        if (!restaurant) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }

        const accountId = await db.transaction(async (tx: any) => {
          const [lockedRestaurant] = await tx
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, restaurant.id))
            .limit(1)
            .for("update");
          if (!lockedRestaurant) {
            throw new Error("Restaurant disappeared during Stripe onboarding");
          }
          if (
            !canManageLockedRestaurantConnect({
              restaurantOwnerId: lockedRestaurant.ownerId,
              requesterUserId: req.user?.id,
              requesterIsInternalTeam: isInternalTeamUserType(
                req.user?.userType,
              ),
            })
          ) {
            return null;
          }

          const existingAccountId =
            lockedRestaurant.stripeConnectStatus === "revoked"
              ? ""
              : String(
                  lockedRestaurant.stripeConnectAccountId || "",
                ).trim();
          if (existingAccountId) return existingAccountId;

          const createIdempotencyKey =
            restaurantConnectAccountCreationIdempotencyKey({
              restaurantId: lockedRestaurant.id,
              restaurantOwnerId: lockedRestaurant.ownerId,
              connectGeneration: lockedRestaurant.stripeConnectGeneration,
            });
          const account = await stripe.accounts.create(
            {
              type: "express",
              country: "US",
              capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
              },
              metadata: {
                restaurantId: lockedRestaurant.id,
                restaurantOwnerId: String(lockedRestaurant.ownerId),
                connectGeneration: String(
                  lockedRestaurant.stripeConnectGeneration,
                ),
              },
            },
            { idempotencyKey: createIdempotencyKey },
          );

          await tx
            .update(restaurants)
            .set({
              stripeConnectAccountId: account.id,
              stripeConnectStatus: "pending",
              stripeOnboardingCompleted: false,
              stripeChargesEnabled: false,
              stripePayoutsEnabled: false,
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, lockedRestaurant.id));
          return account.id;
        });
        if (!accountId) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }

        const configuredBaseUrl = String(
          process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`,
        ).replace(/\/+$/, "");
        const restaurantId = encodeURIComponent(String(restaurant.id));
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${configuredBaseUrl}/menu-builder?restaurantId=${restaurantId}&stripe=refresh`,
          return_url: `${configuredBaseUrl}/menu-builder?restaurantId=${restaurantId}&stripe=complete`,
          type: "account_onboarding",
        });

        return res.json({ onboardingUrl: accountLink.url });
      } catch (error) {
        console.error("Restaurant Stripe onboarding failed:", error);
        return res.status(500).json({
          message: "Stripe payout setup could not be started.",
        });
      }
    },
  );

  app.post(
    "/api/owner/restaurants/:restaurantId/stripe/status",
    isAuthenticated,
    statusLimiter,
    async (req: any, res) => {
      try {
        const restaurant = await getOwnedRestaurant(req);
        if (!restaurant) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }

        const accountId = String(
          restaurant.stripeConnectAccountId || "",
        ).trim();
        if (!accountId) {
          return res.json({
            connected: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            onboardingCompleted: false,
            connectStatus: "not_connected",
          });
        }
        if (!stripe) {
          return res.status(503).json({
            code: "STRIPE_NOT_CONFIGURED",
            message: "Card payment status is unavailable right now.",
          });
        }

        const account = await stripe.accounts.retrieve(accountId);
        // The provider read can overlap ownership transfer or reconnection.
        // Apply its result only to the exact lifecycle that requested it.
        const currentConnectIdentity = and(
          eq(restaurants.id, restaurant.id),
          eq(restaurants.ownerId, restaurant.ownerId),
          eq(restaurants.stripeConnectAccountId, accountId),
          eq(
            restaurants.stripeConnectGeneration,
            restaurant.stripeConnectGeneration,
          ),
        );
        const staleRefresh = () => res.status(409).json({
          code: "STRIPE_CONNECT_STATUS_STALE",
          message: "Payment setup changed during this refresh. Refresh again to load its current status.",
        });
        if ("deleted" in account && account.deleted) {
          const [updated] = await db
            .update(restaurants)
            .set({
              stripeConnectAccountId: null,
              stripeConnectStatus: "revoked",
              stripeOnboardingCompleted: false,
              stripeChargesEnabled: false,
              stripePayoutsEnabled: false,
              updatedAt: new Date(),
            })
            .where(currentConnectIdentity)
            .returning({ id: restaurants.id });
          if (!updated) return staleRefresh();
          return res.json({
            connected: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            onboardingCompleted: false,
            connectStatus: "revoked",
          });
        }

        const chargesEnabled = account.charges_enabled === true;
        const payoutsEnabled = account.payouts_enabled === true;
        const onboardingCompleted = account.details_submitted === true;
        const connectStatus =
          chargesEnabled && payoutsEnabled && onboardingCompleted
            ? "active"
            : "pending";

        const [updated] = await db
          .update(restaurants)
          .set({
            stripeConnectStatus: connectStatus,
            stripeOnboardingCompleted: onboardingCompleted,
            stripeChargesEnabled: chargesEnabled,
            stripePayoutsEnabled: payoutsEnabled,
            updatedAt: new Date(),
          })
          .where(currentConnectIdentity)
          .returning({ id: restaurants.id });
        if (!updated) return staleRefresh();

        return res.json({
          connected: true,
          chargesEnabled,
          payoutsEnabled,
          onboardingCompleted,
          connectStatus,
        });
      } catch (error) {
        console.error("Restaurant Stripe status refresh failed:", error);
        return res.status(500).json({
          message: "Stripe payout status could not be refreshed.",
        });
      }
    },
  );
}
