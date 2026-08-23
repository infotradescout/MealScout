import type { Express } from "express";
import type Stripe from "stripe";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { restaurants, users } from "@shared/schema";
import { db } from "../db";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { canManageBusinessFinancials } from "../businessFinancialAccess";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { isAdminUserType, isInternalTeamUserType } from "../roleAccess";
import { IMPORT_SYSTEM_EMAIL } from "../seo/publicRestaurantIndexability";
import {
  canManageLockedRestaurantConnect,
  restaurantConnectAccountCreationIdempotencyKey,
} from "../utils/restaurantConnectOnboarding";

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
            approved: z.boolean(),
            evidenceUrl: z.string().url().max(2000).optional().nullable(),
            reviewNote: z.string().trim().min(10).max(2000),
            acknowledgementMinutes: z
              .number()
              .int()
              .min(5)
              .max(30)
              .optional()
              .nullable(),
          })
          .parse(req.body || {});
        if (!restaurantId) {
          return res.status(400).json({ message: "Business ID is required." });
        }
        if (
          body.approved &&
          (!/^https:\/\//i.test(String(body.evidenceUrl || "").trim()) ||
            !Number.isInteger(body.acknowledgementMinutes))
        ) {
          return res.status(400).json({
            message:
              "Ordering approval requires an HTTPS evidence URL, review note, and a 5-30 minute merchant acknowledgement window.",
          });
        }

        const [existingRestaurant] = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);
        if (!existingRestaurant) {
          return res
            .status(404)
            .json({ message: "Business profile not found" });
        }

        const now = new Date();
        const [restaurant] = await db
          .update(restaurants)
          .set({
            orderingApprovedAt: body.approved ? now : null,
            orderingApprovedByUserId: body.approved ? req.user.id : null,
            orderingApprovalEvidenceUrl: body.approved
              ? String(body.evidenceUrl).trim()
              : null,
            orderingApprovalReviewNote: body.reviewNote,
            pickupAcknowledgementMinutes: body.approved
              ? body.acknowledgementMinutes
              : null,
            updatedAt: now,
          })
          .where(
            body.approved
              ? and(
                  eq(restaurants.id, restaurantId),
                  eq(restaurants.isActive, true),
                  eq(restaurants.isVerified, true),
                  isNotNull(restaurants.ownerId),
                  sql<boolean>`exists (
                    select 1
                    from ${users}
                    where ${users.id} = ${restaurants.ownerId}
                      and ${users.emailVerified} = true
                      and ${users.isDisabled} = false
                      and trim(coalesce(${users.email}, '')) <> ''
                      and lower(trim(${users.email})) <> ${IMPORT_SYSTEM_EMAIL}
                  )`,
                )
              : eq(restaurants.id, restaurantId),
          )
          .returning({
            id: restaurants.id,
            orderingApprovedAt: restaurants.orderingApprovedAt,
            orderingApprovedByUserId: restaurants.orderingApprovedByUserId,
            pickupAcknowledgementMinutes:
              restaurants.pickupAcknowledgementMinutes,
          });
        if (!restaurant) {
          return res.status(409).json({
            message:
              "Ordering approval requires an active, verified business with an active owner whose email is verified.",
          });
        }
        return res.json({ restaurant, approved: body.approved });
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
        if ("deleted" in account && account.deleted) {
          await db
            .update(restaurants)
            .set({
              stripeConnectAccountId: null,
              stripeConnectStatus: "revoked",
              stripeOnboardingCompleted: false,
              stripeChargesEnabled: false,
              stripePayoutsEnabled: false,
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, restaurant.id));
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

        await db
          .update(restaurants)
          .set({
            stripeConnectStatus: connectStatus,
            stripeOnboardingCompleted: onboardingCompleted,
            stripeChargesEnabled: chargesEnabled,
            stripePayoutsEnabled: payoutsEnabled,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, restaurant.id));

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
