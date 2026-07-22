import type { Express } from "express";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  PROFILE_EVIDENCE_REVIEW_FIELDS,
  getProfileEvidenceFieldDefinition,
  type ProfileEvidenceReviewField,
} from "@shared/profileEvidenceReview";
import {
  businessStaffMemberships,
  imageUploads,
  restaurants,
} from "@shared/schema";
import { db } from "../db";
import {
  createAuthenticatedEvidenceReviewUrl,
  isAuthenticatedCloudinaryDeliveryUrl,
} from "../imageUpload";
import {
  hasProfileEvidenceReviewAccess,
  hasProfileEvidenceReviewDecisionAccess,
} from "../services/profileEvidenceReviewAccess";
import { reconcileOwnerConfirmedEvidenceQuarantine } from "../services/profileEvidenceQuarantine";
import {
  buildProfileEvidenceOwnerReviewDto,
  isProfileEvidenceDecisionSourceInspectable,
  normalizeProfileEvidenceReviewLedger,
  planProfileEvidenceReviewDecision,
  type ProfileEvidenceCurrentValues,
  type ProfileEvidenceOwnerImageLookup,
} from "../services/profileEvidenceReview";
import { isAuthenticated } from "../unifiedAuth";

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const currentProfileEvidenceValues = (
  restaurant: Record<string, any>,
): ProfileEvidenceCurrentValues => {
  const settings = asRecord(restaurant.socialAutopostSettings);
  const publicActionLinks = asRecord(settings.publicActionLinks);
  return Object.fromEntries(
    PROFILE_EVIDENCE_REVIEW_FIELDS.map((field) => {
      const destination = getProfileEvidenceFieldDefinition(field).destination;
      const value =
        destination.kind === "restaurant_column"
          ? restaurant[destination.column]
          : publicActionLinks[destination.key];
      return [field, value];
    }),
  ) as ProfileEvidenceCurrentValues;
};

const fallbackEvidenceTimestamp = (restaurant: Record<string, any>) => {
  const evidenceApply = asRecord(
    asRecord(restaurant.socialAutopostSettings).evidenceApply,
  );
  return String(
    evidenceApply.updatedAt ||
      restaurant.updatedAt ||
      restaurant.createdAt ||
      new Date(0).toISOString(),
  );
};

const PRIVATE_EVIDENCE_IMAGE_TYPES = new Set([
  "restaurant_gallery_truck",
  "restaurant_gallery_menu",
  "restaurant_gallery_hours",
  "restaurant_gallery_contact",
]);

const ownerEvidenceImagesById = async (
  restaurant: Record<string, any>,
  ledger: ReturnType<typeof normalizeProfileEvidenceReviewLedger>,
  executor: any = db,
  lockRows = false,
): Promise<ProfileEvidenceOwnerImageLookup> => {
  const settings = asRecord(restaurant.socialAutopostSettings);
  const evidenceApply = asRecord(settings.evidenceApply);
  const uploadedEvidence = Array.isArray(evidenceApply.uploadedEvidence)
    ? evidenceApply.uploadedEvidence
    : [];
  const eligibleUploadIds = new Set<string>();
  for (const rawEvidence of uploadedEvidence.slice(0, 500)) {
    const evidence = asRecord(rawEvidence);
    const uploadId = String(evidence.imageUploadId || "").trim().toLowerCase();
    if (
      String(evidence.profileId || "").trim() !== String(restaurant.id) ||
      String(evidence.reviewStatus || "").trim() !== "pending_review" ||
      String(evidence.deliveryType || "").trim() !== "authenticated" ||
      !/^[a-f0-9-]{36}$/.test(uploadId)
    ) {
      continue;
    }
    eligibleUploadIds.add(uploadId);
  }

  const referencedUploadIds = Array.from(
    new Set(
      ledger.proposals.flatMap((proposal) =>
        proposal.imageEvidenceIds
          .map((id) => String(id || "").trim().toLowerCase())
          .filter((id) => eligibleUploadIds.has(id)),
      ),
    ),
  ).slice(0, 500);
  if (!referencedUploadIds.length) return {};

  let query = executor
    .select({
      id: imageUploads.id,
      entityId: imageUploads.entityId,
      entityType: imageUploads.entityType,
      imageType: imageUploads.imageType,
      cloudinaryPublicId: imageUploads.cloudinaryPublicId,
      cloudinaryUrl: imageUploads.cloudinaryUrl,
      mimeType: imageUploads.mimeType,
    })
    .from(imageUploads)
    .where(
      and(
        inArray(imageUploads.id, referencedUploadIds),
        eq(imageUploads.entityId, String(restaurant.id)),
        eq(imageUploads.entityType, "restaurant"),
      ),
    );
  if (lockRows) query = query.for("share");
  const rows = await query;
  const images: Record<string, string> = {};
  const nowMs = Date.now();
  for (const row of rows) {
    const id = String(row.id || "").trim().toLowerCase();
    if (
      !eligibleUploadIds.has(id) ||
      !PRIVATE_EVIDENCE_IMAGE_TYPES.has(String(row.imageType || "")) ||
      !isAuthenticatedCloudinaryDeliveryUrl(row.cloudinaryUrl)
    ) {
      continue;
    }
    const url = createAuthenticatedEvidenceReviewUrl(
      String(row.cloudinaryPublicId || ""),
      String(row.mimeType || ""),
      nowMs,
    );
    if (url) images[id] = url;
  }
  return images;
};

const buildReviewDto = async (
  restaurant: Record<string, any>,
  executor: any = db,
  lockEvidenceRows = false,
) => {
  const evidenceApply = asRecord(
    asRecord(restaurant.socialAutopostSettings).evidenceApply,
  );
  const currentValues = currentProfileEvidenceValues(restaurant);
  const ledger = normalizeProfileEvidenceReviewLedger(evidenceApply, {
    restaurantId: String(restaurant.id),
    fallbackReceivedAt: fallbackEvidenceTimestamp(restaurant),
    currentValues,
  });
  return {
    ledger,
    currentValues,
    dto: buildProfileEvidenceOwnerReviewDto({
      restaurantId: String(restaurant.id),
      ledger,
      currentValues,
      evidenceImagesById: await ownerEvidenceImagesById(
        restaurant,
        ledger,
        executor,
        lockEvidenceRows,
      ),
    }),
  };
};

const decisionSchema = z
  .object({
    action: z.enum(["confirm", "correct", "decline"]),
    correctedValue: z
      .union([z.string().max(4000), z.number(), z.boolean()])
      .optional(),
    expectedCurrentValueFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    clientRequestId: z
      .string()
      .trim()
      .min(8)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "correct" && value.correctedValue === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctedValue"],
        message: "A corrected value is required.",
      });
    }
    if (value.action !== "correct" && value.correctedValue !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctedValue"],
        message: "Corrected value is only valid with the correct action.",
      });
    }
  });

async function canDecideProfileEvidence(
  userId: string,
  restaurantId: string,
  userType?: string | null,
) {
  const [authorizedRow] = await db
    .select({
      ownerId: restaurants.ownerId,
      membership: {
        restaurantId: businessStaffMemberships.restaurantId,
        userId: businessStaffMemberships.userId,
        permissions: businessStaffMemberships.permissions,
        status: businessStaffMemberships.status,
      },
    })
    .from(restaurants)
    .leftJoin(
      businessStaffMemberships,
      and(
        eq(businessStaffMemberships.restaurantId, restaurants.id),
        eq(businessStaffMemberships.userId, userId),
        eq(businessStaffMemberships.status, "active"),
      ),
    )
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return hasProfileEvidenceReviewDecisionAccess({
    userId,
    userType,
    restaurantId,
    ownerId: authorizedRow?.ownerId,
    membership: authorizedRow?.membership,
  });
}

export function registerProfileEvidenceReviewRoutes(app: Express) {
  app.get(
    "/api/restaurants/:restaurantId/profile-evidence-review",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = String(req.params.restaurantId || "").trim();
        const userId = String(req.user.id);
        // Fetch the sensitive resource and its exact selected-business grant
        // in one database statement. A separate authorize-then-load sequence
        // can disclose evidence once if membership is revoked between reads.
        const [authorizedRow] = await db
          .select({
            restaurant: getTableColumns(restaurants),
            membership: {
              restaurantId: businessStaffMemberships.restaurantId,
              userId: businessStaffMemberships.userId,
              permissions: businessStaffMemberships.permissions,
              status: businessStaffMemberships.status,
            },
          })
          .from(restaurants)
          .leftJoin(
            businessStaffMemberships,
            and(
              eq(businessStaffMemberships.restaurantId, restaurants.id),
              eq(businessStaffMemberships.userId, userId),
              eq(businessStaffMemberships.status, "active"),
            ),
          )
          .where(eq(restaurants.id, restaurantId))
          .limit(1);
        if (!authorizedRow?.restaurant) {
          return res.status(404).json({ message: "Business not found" });
        }
        const allowed = hasProfileEvidenceReviewAccess({
          userId,
          userType: req.user?.userType,
          restaurantId,
          ownerId: authorizedRow.restaurant.ownerId,
          membership: authorizedRow.membership,
        });
        if (!allowed) return res.status(403).json({ message: "Forbidden" });
        const restaurant = authorizedRow.restaurant;
        const review = await buildReviewDto(restaurant);
        res.set("Cache-Control", "private, no-store");
        return res.json(review.dto);
      } catch (error) {
        console.error("Error loading profile evidence review:", error);
        return res
          .status(500)
          .json({ message: "Failed to load profile evidence review" });
      }
    },
  );

  app.patch(
    "/api/restaurants/:restaurantId/profile-evidence-review/:proposalId",
    isAuthenticated,
    async (req: any, res) => {
      const parsed = decisionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid profile evidence decision",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      const restaurantId = String(req.params.restaurantId || "").trim();
      const proposalId = String(req.params.proposalId || "").trim();
      try {
        const allowed = await canDecideProfileEvidence(
          String(req.user.id),
          restaurantId,
          req.user?.userType,
        );
        if (!allowed) return res.status(403).json({ message: "Forbidden" });

        const result = await db.transaction(async (tx: any) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${restaurantId}))`,
          );
          const [restaurant] = await tx
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, restaurantId))
            .limit(1)
            .for("update");
          if (!restaurant) return { status: "not_found" as const };

          const directDecisionAccess = hasProfileEvidenceReviewDecisionAccess({
            userId: req.user.id,
            userType: req.user?.userType,
            restaurantId,
            ownerId: restaurant.ownerId,
          });
          let hasScopedPermission = directDecisionAccess;
          if (!directDecisionAccess && req.user?.userType !== "staff") {
              const [membership] = await tx
                .select({
                  restaurantId: businessStaffMemberships.restaurantId,
                  userId: businessStaffMemberships.userId,
                  permissions: businessStaffMemberships.permissions,
                  status: businessStaffMemberships.status,
                })
                .from(businessStaffMemberships)
                .where(
                  and(
                    eq(businessStaffMemberships.restaurantId, restaurantId),
                    eq(businessStaffMemberships.userId, String(req.user.id)),
                    eq(businessStaffMemberships.status, "active"),
                  ),
                )
                .limit(1)
                .for("share");
              hasScopedPermission = hasProfileEvidenceReviewDecisionAccess({
                userId: req.user.id,
                userType: req.user?.userType,
                restaurantId,
                ownerId: restaurant.ownerId,
                membership,
              });
          }
          if (!hasScopedPermission) return { status: "forbidden" as const };

          const review = await buildReviewDto(restaurant, tx, true);
          const proposal = review.ledger.proposals.find(
            (item) => item.id === proposalId,
          );
          const currentValue = proposal
            ? review.currentValues[proposal.field]
            : undefined;
          const decidedAt = new Date().toISOString();
          const plan = planProfileEvidenceReviewDecision({
            ledger: review.ledger,
            proposalId,
            action: parsed.data.action,
            correctedValue: parsed.data.correctedValue,
            currentValue,
            expectedCurrentValueFingerprint:
              parsed.data.expectedCurrentValueFingerprint,
            actorUserId: String(req.user.id),
            clientRequestId: parsed.data.clientRequestId,
            decidedAt,
          });
          const proposalDto = review.dto.proposals.find(
            (item) => item.id === proposalId,
          );
          if (
            plan.status === "planned" &&
            !isProfileEvidenceDecisionSourceInspectable({
              action: parsed.data.action,
              proposal: proposalDto,
            })
          ) {
            return {
              status: "unreviewable" as const,
              message:
                proposalDto?.source.unavailableReason ||
                "The referenced evidence is not available to inspect.",
            };
          }
          if (plan.status !== "planned") return plan;

          const settings = asRecord(restaurant.socialAutopostSettings);
          const evidenceApply = asRecord(settings.evidenceApply);
          let nextSettings: Record<string, unknown> = {
            ...settings,
            evidenceApply: {
              ...evidenceApply,
              ownerReview: plan.ledger,
            },
          };
          const updates: Record<string, unknown> = {};
          if (plan.mutation?.destination.kind === "restaurant_column") {
            updates[plan.mutation.destination.column] =
              plan.mutation.nextValue;
          } else if (
            plan.mutation?.destination.kind === "public_action_link"
          ) {
            nextSettings = {
              ...nextSettings,
              publicActionLinks: {
                ...asRecord(settings.publicActionLinks),
                [plan.mutation.destination.key]: plan.mutation.nextValue,
              },
            };
          }
          updates.socialAutopostSettings = nextSettings;
          if (proposal && plan.decision.action !== "declined") {
            const reconciledRawData =
              reconcileOwnerConfirmedEvidenceQuarantine({
                rawData: restaurant.rawData,
                field: proposal.field,
                proposalId,
                actorUserId: String(req.user.id),
                decidedAt,
              });
            if (reconciledRawData) updates.rawData = reconciledRawData;
          }
          updates.updatedAt = new Date();
          await tx
            .update(restaurants)
            .set(updates as any)
            .where(eq(restaurants.id, restaurantId));

          return {
            status: "applied" as const,
            action: plan.decision.action,
            proposalId,
            field: proposal?.field as ProfileEvidenceReviewField,
            pendingCount: Math.max(0, review.dto.pendingCount - 1),
          };
        });

        if (result.status === "forbidden") {
          return res.status(403).json({ message: "Forbidden" });
        }
        if (result.status === "not_found") {
          return res.status(404).json({ message: "Evidence proposal not found" });
        }
        if (result.status === "stale") {
          return res.status(409).json({
            code: "stale_review",
            message:
              "This profile field changed after the review loaded. Refresh and review the current value.",
          });
        }
        if (result.status === "conflict") {
          return res.status(409).json({
            code: "decision_conflict",
            message: "This evidence proposal has already been reviewed.",
          });
        }
        if (result.status === "invalid") {
          return res.status(400).json({
            code: result.code,
            message: result.message,
          });
        }
        if (result.status === "unreviewable") {
          return res.status(400).json({
            code: "evidence_not_inspectable",
            message: result.message,
          });
        }
        if (result.status === "idempotent") {
          return res.json({
            ok: true,
            idempotent: true,
            proposalId,
            action: result.decision.action,
          });
        }
        return res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("Profile evidence decision failed", {
          restaurantId,
          proposalId,
          clientRequestId: parsed.data.clientRequestId,
          errorName: String(error?.name || "Error").slice(0, 80),
          errorCode: String(error?.code || "unknown").slice(0, 80),
        });
        return res
          .status(500)
          .json({ message: "Failed to apply profile evidence decision" });
      }
    },
  );
}
