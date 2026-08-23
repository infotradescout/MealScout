import type { Express } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import { storage } from "../../storage";
import { createHash, randomUUID } from "crypto";
import {
  isCloudinaryConfigured,
  upload,
  uploadPrivateEvidenceToCloudinary,
  uploadToCloudinary,
} from "../../imageUpload";
import { sendAccountSetupInvite } from "../../utils/accountSetup";
import { parseTruckImportFile } from "../../utils/truckImport";
import { buildTruckProfileLocationEvidence } from "../../utils/truckLocationSemantics";
import { reconcileBusinessIdentity } from "../../imports/businessIdentityReconciliation";
import {
  eventBookings,
  imageUploads,
  menuItems,
  menus,
  restaurants,
  truckClaimRequests,
  truckImportBatches,
  truckImportListings,
  truckManualSchedules,
} from "@shared/schema";
import {
  buildProfileAssetEvidence,
  type ProfileAssetType,
} from "@shared/profileAssetEvidence";
import {
  appendProfileEvidenceReviewProposals,
  bindProfileEvidenceProposalImageReferences,
  compactProfileEvidenceIntakeRequests,
  countActiveProfileEvidenceIntakeRequests,
  createProfileEvidenceIntakeRequestFingerprint,
  mergeProfileEvidenceApplySettings,
  mergeProfileEvidenceQueueContainer,
  mergeProfileEvidenceQueueContainerWithReport,
  isDirectProfileEvidenceApplyDisabledMode,
  normalizeProfileEvidenceProposalBatch,
  normalizeProfileEvidenceReviewLedger,
  normalizeQueuedProfileEvidenceMenuItems,
  normalizeQueuedProfileEvidenceScheduleItems,
  normalizeQueuedProfileEvidenceTextItems,
  parseDirectApplyMenuPriceCents,
  type ProfileEvidenceCurrentValues,
} from "../../services/profileEvidenceReview";
import { buildRestaurantOwnerTransferReset } from "../../services/restaurantOrderingAuthorityReset";
import {
  lockRestaurantForOwnerTransfer,
  resolveRestaurantOwnershipInviteAction,
} from "../../services/restaurantOwnerTransferSafety";
import {
  PROFILE_EVIDENCE_REVIEW_LIMITS,
  PROFILE_EVIDENCE_REVIEW_FIELDS,
  getProfileEvidenceFieldDefinition,
} from "@shared/profileEvidenceReview";

type RequireAdminUser = (req: any, res: any) => boolean;
type EnsureTruckImportTables = () => Promise<void>;
type IsMissingRelationError = (
  error: unknown,
  relationName?: string,
) => boolean;
type IsMissingColumnError = (error: unknown, columnName?: string) => boolean;
type GetOrCreateImportSystemUserId = () => Promise<string>;
type TruckImportUploadSingle = (req: any, res: any, next: any) => void;

export function registerTruckImportAdminRoutes(
  app: Express,
  deps: {
    requireAdminUser: RequireAdminUser;
    ensureTruckImportTables: EnsureTruckImportTables;
    isMissingRelationError: IsMissingRelationError;
    isMissingColumnError: IsMissingColumnError;
    getOrCreateImportSystemUserId: GetOrCreateImportSystemUserId;
    truckImportUploadSingle: TruckImportUploadSingle;
  },
) {
  const {
    requireAdminUser,
    ensureTruckImportTables,
    isMissingRelationError,
    isMissingColumnError,
    getOrCreateImportSystemUserId,
    truckImportUploadSingle,
  } = deps;
  const isBlankValue = (value: unknown) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object")
      return Object.keys(value as any).length === 0;
    return false;
  };
  const normalizeComparable = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase();
  const toUrl = (value: unknown, domainHint?: string) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (domainHint && !raw.includes(".")) {
      return `https://${domainHint}/${raw.replace(/^@/, "")}`;
    }
    return `https://${raw}`;
  };
  const recordListingInviteEvidence = async (
    listingId: string,
    details: {
      invitedUserId: string;
      inviteEmail: string;
      emailSent: boolean;
      source: "bulk_import" | "manual_invite";
      invitedAt: string;
    },
  ) => {
    try {
      const [existingListing] = await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingId))
        .limit(1);
      if (!existingListing) return;
      await db
        .update(truckImportListings)
        .set({
          rawData: {
            ...((existingListing as any).rawData || {}),
            ownerVerificationInvite: details,
          },
          updatedAt: new Date(),
        } as any)
        .where(eq(truckImportListings.id, listingId));
    } catch (error) {
      console.error("Failed to record listing invite evidence:", error);
    }
  };

  const resolvePublicBaseUrl = () =>
    String(
      process.env.PUBLIC_BASE_URL ||
        process.env.SERVICE_URL ||
        "https://www.mealscout.us",
    ).replace(/\/+$/, "");

  const extractClaimPitch = (listing: any) => {
    const rawData =
      listing && typeof listing.rawData === "object" && listing.rawData
        ? (listing.rawData as Record<string, any>)
        : {};
    const pitch =
      rawData && typeof rawData.claimPitch === "object" && rawData.claimPitch
        ? (rawData.claimPitch as Record<string, any>)
        : null;
    return pitch;
  };

  const buildClaimPitchSharePack = (
    listing: any,
    claimPitch: Record<string, any>,
  ) => {
    const businessName = String(
      claimPitch?.businessName || listing?.name || "this business",
    ).trim();
    const profileUrl = `${resolvePublicBaseUrl()}/p/${encodeURIComponent(String(listing?.id || ""))}`;
    const claimPitchMessage =
      "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.";
    const claimPitchShortMessage = `Your MealScout profile for ${businessName} is live. Claim it to update menu, schedule, photos, and booking info.`;

    return {
      claimPitchMessage,
      claimPitchShortMessage,
      claimPitchUrl: claimPitch?.claimUrl || null,
      profileUrl,
    };
  };

  app.get(
    "/api/admin/truck-imports",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      const includePurged = String(req.query?.includePurged || "") === "1";
      try {
        const batches = await db
          .select()
          .from(truckImportBatches)
          .where(
            includePurged ? sql`true` : isNull(truckImportBatches.purgedAt),
          )
          .orderBy(desc(truckImportBatches.createdAt))
          .limit(50);
        res.json(batches);
      } catch (error) {
        if (isMissingRelationError(error, "truck_import_batches")) {
          try {
            await ensureTruckImportTables();
            const batches = await db
              .select()
              .from(truckImportBatches)
              .where(
                includePurged ? sql`true` : isNull(truckImportBatches.purgedAt),
              )
              .orderBy(desc(truckImportBatches.createdAt))
              .limit(50);
            return res.json(batches);
          } catch (ensureError) {
            console.error("Error ensuring truck import tables:", ensureError);
            return res.status(503).json({
              message:
                "Truck import tables are missing in the database and could not be auto-created. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql` (and then `npm run migrate:sql -- 041_truck_import_batches_purged.sql`).",
              code: "migration_required",
            });
          }
        }
        console.error("Error fetching truck import batches:", error);
        res.status(500).json({ message: "Failed to fetch import batches" });
      }
    },
  );

  app.get(
    "/api/admin/truck-import-listings/search",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const query = String(req.query?.q || "").trim();
        if (!query) return res.json([]);

        const searchValue = `%${query.toLowerCase()}%`;

        const rows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(
            or(
              eq(truckImportListings.externalId, query),
              sql`lower(${truckImportListings.name}) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.email}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.phone}, '')) like ${searchValue}`,
            ),
          )
          .orderBy(desc(truckImportListings.confidenceScore))
          .limit(25);

        res.json(
          rows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
          })),
        );
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error searching truck import listings:", error);
        res.status(500).json({ message: "Failed to search import listings" });
      }
    },
  );

  app.get(
    "/api/admin/truck-import-listings/unclaimed",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const limit = Math.min(
          100,
          Math.max(1, Number(req.query?.limit ?? 50)),
        );
        const offset = Math.max(0, Number(req.query?.offset ?? 0));

        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(truckImportListings)
          .where(eq(truckImportListings.status, "unclaimed"));

        const rows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
            restaurantIsVerified: restaurants.isVerified,
            restaurantIsActive: restaurants.isActive,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.status, "unclaimed"))
          .orderBy(desc(truckImportListings.createdAt))
          .limit(limit)
          .offset(offset);

        res.json({
          total: Number(total ?? 0),
          limit,
          offset,
          rows: rows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
            restaurantIsVerified: row.restaurantIsVerified ?? null,
            restaurantIsActive: row.restaurantIsActive ?? null,
          })),
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        if (isMissingColumnError(error, "claimed_from_import_id")) {
          return res.status(503).json({
            message:
              "Truck import schema is missing columns. Run `npm run migrate:sql -- 044_add_restaurants_claimed_from_import_id.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error listing unclaimed import listings:", error);
        res.status(500).json({ message: "Failed to load unclaimed trucks" });
      }
    },
  );

  app.patch(
    "/api/admin/truck-import-listings/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = req.params.id;
        const updates: any = {};
        const fields = [
          "externalId",
          "email",
          "name",
          "address",
          "city",
          "state",
          "phone",
          "cuisineType",
          "websiteUrl",
          "instagramUrl",
          "facebookPageUrl",
          "latitude",
          "longitude",
        ];
        for (const field of fields) {
          if (req.body?.[field] === undefined) continue;
          updates[field] =
            field === "email"
              ? String(req.body[field] || "")
                  .trim()
                  .toLowerCase() || null
              : req.body[field];
        }

        const [updated] = await db
          .update(truckImportListings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(truckImportListings.id, listingId))
          .returning();

        if (!updated) {
          return res.status(404).json({ message: "Import listing not found" });
        }
        const updatedProfileLocations = buildTruckProfileLocationEvidence({
          businessName: String(updated.name || ""),
          address: String(updated.address || ""),
          serviceArea: String(
            (updated.rawData as any)?.profileLocations?.serviceArea ||
              updated.city ||
              "",
          ),
          source: "admin_truck_import_listing_edit",
        });
        await db
          .update(truckImportListings)
          .set({
            rawData: {
              ...((updated as any).rawData || {}),
              profileLocations: updatedProfileLocations,
              adminReview: {
                ...(((updated as any).rawData || {}).adminReview || {}),
                truckLocationAmbiguity:
                  updatedProfileLocations.requiresOwnerReview ||
                  updatedProfileLocations.addressPublicByDefault === false,
                lastTruckLocationClassificationAt: new Date().toISOString(),
              },
            },
            updatedAt: new Date(),
          } as any)
          .where(eq(truckImportListings.id, listingId));

        // Keep the seeded restaurant (if any) in sync with listing fields.
        const [seededRestaurant] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.claimedFromImportId, listingId))
          .limit(1);
        if (seededRestaurant) {
          const restaurantUpdates: any = {};
          const map: Array<[string, string]> = [
            ["name", "name"],
            ["address", "address"],
            ["city", "city"],
            ["state", "state"],
            ["phone", "phone"],
            ["cuisineType", "cuisineType"],
            ["websiteUrl", "websiteUrl"],
            ["instagramUrl", "instagramUrl"],
            ["facebookPageUrl", "facebookPageUrl"],
            ["latitude", "latitude"],
            ["longitude", "longitude"],
          ];
          for (const [listingField, restaurantField] of map) {
            if (updates[listingField] !== undefined) {
              restaurantUpdates[restaurantField] = updates[listingField];
            }
          }
          const profileLocations = updatedProfileLocations;
          restaurantUpdates.rawData = {
            ...((seededRestaurant as any).rawData || {}),
            profileLocations,
            adminReview: {
              ...(((seededRestaurant as any).rawData || {}).adminReview || {}),
              truckLocationAmbiguity:
                profileLocations.requiresOwnerReview ||
                profileLocations.addressPublicByDefault === false,
              lastTruckLocationClassificationAt: new Date().toISOString(),
            },
          };
          if (Object.keys(restaurantUpdates).length > 0) {
            await db
              .update(restaurants)
              .set({ ...restaurantUpdates, updatedAt: new Date() })
              .where(eq(restaurants.id, seededRestaurant.id));
          }
        }

        res.json(updated);
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error updating import listing:", error);
        res.status(500).json({ message: "Failed to update import listing" });
      }
    },
  );

  app.post(
    "/api/admin/profile-evidence/apply",
    isAuthenticated,
    isStaffOrAdmin,
    upload.fields([
      { name: "image", maxCount: 1 },
      { name: "logoImage", maxCount: 1 },
      { name: "profileImages", maxCount: 20 },
      { name: "menuImages", maxCount: 20 },
      { name: "hoursImages", maxCount: 20 },
      { name: "contactImages", maxCount: 20 },
    ]),
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      let reservedQueueRequest: {
        restaurantId: string;
        intakeRequestId: string;
        fingerprint: string;
      } | null = null;
      try {
        const requestBody =
          typeof req.body?.payload === "string" && req.body.payload.trim()
            ? JSON.parse(req.body.payload)
            : req.body || {};

        const requestedMode = String(requestBody?.mode || "dry_run")
          .trim()
          .toLowerCase();
        if (isDirectProfileEvidenceApplyDisabledMode(requestedMode)) {
          return res.status(409).json({
            status: "owner_review_required",
            code: "direct_apply_disabled_use_owner_review",
            message:
              "Direct apply is disabled for this release. Submit with mode queue_owner_review so profile evidence is reviewed before publication.",
            requiredMode: "queue_owner_review",
          });
        }

        await ensureTruckImportTables();

        const mode =
          requestedMode === "apply"
            ? "apply"
            : requestedMode === "queue_owner_review"
              ? "queue_owner_review"
              : "dry_run";
        const queuesOwnerReview = mode === "queue_owner_review";
        const intakeRequestId = String(requestBody?.intakeRequestId || "").trim();
        if (
          queuesOwnerReview &&
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(intakeRequestId)
        ) {
          return res.status(400).json({
            code: "owner_review_requires_intake_request_id",
            message:
              "Owner review requires an 8-80 character intakeRequestId using letters, numbers, dot, underscore, colon, or dash.",
          });
        }
        const profileTypeRaw = String(requestBody?.profileType || "unknown")
          .trim()
          .toLowerCase();
        const profileType = [
          "restaurant",
          "food_truck",
          "bar",
          "caterer",
          "private_chef",
          "supplier",
          "unknown",
        ].includes(profileTypeRaw)
          ? profileTypeRaw
          : "unknown";

        const match = (requestBody?.match || {}) as Record<string, unknown>;
        const fillIfBlank = (requestBody?.fillIfBlank || {}) as Record<
          string,
          unknown
        >;
        const descriptionOnlyIfBlank = String(
          requestBody?.descriptionOnlyIfBlank || "",
        ).trim();
        const queuedMenuItemBatch = normalizeQueuedProfileEvidenceMenuItems(
          requestBody?.menuItems,
        );
        const queuedScheduleItemBatch =
          normalizeQueuedProfileEvidenceScheduleItems(
            requestBody?.scheduleItems,
          );
        const incomingMenuItems = queuedMenuItemBatch.items;
        const incomingScheduleItems = queuedScheduleItemBatch.items;
        const directApplyMenuItems = incomingMenuItems.map((item, index) => {
          const priceCents = parseDirectApplyMenuPriceCents(item.price);
          if (mode === "apply" && priceCents === null) {
            return { errorIndex: index } as const;
          }
          return {
            item,
            priceCents: mode === "apply" ? priceCents : null,
          };
        });
        const invalidDirectMenuPrice = directApplyMenuItems.find(
          (item) => "errorIndex" in item,
        );
        if (invalidDirectMenuPrice && "errorIndex" in invalidDirectMenuPrice) {
          return res.status(400).json({
            code: "invalid_direct_apply_menu_price",
            message:
              "Every direct-apply menu item requires a numeric price such as $12 or 12.50.",
            itemIndex: invalidDirectMenuPrice.errorIndex,
          });
        }
        const sourceNoteBatch = normalizeQueuedProfileEvidenceTextItems(
          requestBody?.sourceNotes,
          "source-note",
        );
        const missingInfoBatch = normalizeQueuedProfileEvidenceTextItems(
          requestBody?.missingInfo,
          "missing-info",
        );
        const sourceNotes = sourceNoteBatch.items;
        const missingInfo = missingInfoBatch.items;
        const rawSource = requestBody?.rawSource;
        const declaredEvidence = Array.isArray(requestBody?.evidence)
          ? requestBody.evidence.filter(
              (item: unknown) => item && typeof item === "object",
            )
          : [];
        const rawEvidenceFieldProposals = Array.isArray(
          requestBody?.evidenceFieldProposals,
        )
          ? requestBody.evidenceFieldProposals
          : [];
        if (
          queuesOwnerReview &&
          rawEvidenceFieldProposals.length >
            PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch
        ) {
          return res.status(400).json({
            message: `Owner review accepts at most ${PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch} evidence proposals per batch.`,
            code: "owner_review_batch_too_large",
            proposalResults: {
              submittedCount: rawEvidenceFieldProposals.length,
              acceptedCount: 0,
              acceptedIds: [],
              rejectedCount: rawEvidenceFieldProposals.length,
              rejectedIds: Array.from(
                {
                  length: Math.min(
                    rawEvidenceFieldProposals.length,
                    PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
                  ),
                },
                (_, index) => `input:${index}`,
              ),
              rejectedIdsTruncated:
                rawEvidenceFieldProposals.length >
                PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
              droppedCount: rawEvidenceFieldProposals.length,
              droppedIds: [],
            },
          });
        }
        const evidenceFieldProposals = rawEvidenceFieldProposals.length
          ? rawEvidenceFieldProposals
              .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch)
              .filter(
                (proposal: any) => proposal && typeof proposal === "object",
              )
              .map((proposal: any) => ({
                field: String(proposal.field || "").trim().slice(0, 160),
                proposedValue: String(proposal.proposedValue || "").trim(),
                confidence: String(proposal.confidence || "low")
                  .trim()
                  .slice(0, 20),
                source: String(proposal.source || "screenshot")
                  .trim()
                  .slice(0, 40),
                sourceKind: String(
                  proposal.sourceKind || proposal.source || "other",
                )
                  .trim()
                  .slice(0, 40),
                sourceLabel: String(proposal.sourceLabel || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.sourceLabel),
                sourceUrl: String(proposal.sourceUrl || proposal.url || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.sourceUrl),
                evidenceText: String(proposal.evidenceText || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.evidenceExcerpt),
                evidenceExcerpt: String(
                  proposal.evidenceExcerpt || proposal.evidenceText || "",
                )
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.evidenceExcerpt),
                imageRef: String(proposal.imageRef || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.imageEvidenceId),
                imageEvidenceIds: Array.isArray(proposal.imageEvidenceIds)
                  ? proposal.imageEvidenceIds
                      .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.imageEvidenceIds)
                      .map((id: unknown) =>
                        String(id || "")
                          .trim()
                          .slice(
                            0,
                            PROFILE_EVIDENCE_REVIEW_LIMITS.imageEvidenceId,
                          ),
                      )
                      .filter(Boolean)
                  : [],
                sourceIdentity: String(proposal.sourceIdentity || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.sourceIdentity),
                batchId: String(proposal.batchId || "")
                  .trim()
                  .slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.batchId),
                receivedAt: String(proposal.receivedAt || "")
                  .trim()
                  .slice(0, 80),
              }))
              .filter(
                (proposal: any) => proposal.field && proposal.proposedValue,
              )
          : [];
        let ownerReviewEvidenceFieldProposals: unknown[] =
          evidenceFieldProposals;
        const ocrTextCandidates = [
          String(
            requestBody?.ocrTextSnippet ||
              requestBody?.ocrText ||
              requestBody?.ocr?.text ||
              "",
          ).trim(),
          String(rawSource?.ocrText || rawSource?.text || "").trim(),
          ...sourceNotes,
          ...evidenceFieldProposals
            .map((proposal: any) => String(proposal.evidenceText || "").trim())
            .filter(Boolean),
        ].filter(Boolean);
        const ocrTextSnippet = String(ocrTextCandidates[0] || "").slice(0, 240);
        const ocrConfidence = Number(
          requestBody?.ocrConfidence ||
            requestBody?.ocr?.confidence ||
            rawSource?.ocrConfidence ||
            0,
        );
        const logoUpload = requestBody?.logoUpload || {};
        const logoEnabled = Boolean(logoUpload?.enabled);
        const approvals =
          requestBody?.approvals && typeof requestBody.approvals === "object"
            ? requestBody.approvals
            : {};
        const allowMenuOverwrite = Boolean(approvals?.menuOverwrite);
        const allowLogoReplace = Boolean(approvals?.logoOverwrite);
        const allowEvidencePublication =
          mode === "apply" && Boolean(approvals?.evidencePublication);

        const fileMap =
          req.files && typeof req.files === "object"
            ? (req.files as Record<string, Express.Multer.File[]>)
            : {};
        const firstImageFile =
          (Array.isArray(fileMap.logoImage) ? fileMap.logoImage[0] : null) ||
          (Array.isArray(fileMap.image) ? fileMap.image[0] : null) ||
          null;
        const profileEvidenceFiles = Array.isArray(fileMap.profileImages)
          ? fileMap.profileImages
          : [];
        const menuEvidenceFiles = Array.isArray(fileMap.menuImages)
          ? fileMap.menuImages
          : [];
        const hoursEvidenceFiles = Array.isArray(fileMap.hoursImages)
          ? fileMap.hoursImages
          : [];
        const contactEvidenceFiles = Array.isArray(fileMap.contactImages)
          ? fileMap.contactImages
          : [];
        const hasEvidenceFiles =
          profileEvidenceFiles.length > 0 ||
          menuEvidenceFiles.length > 0 ||
          hoursEvidenceFiles.length > 0 ||
          contactEvidenceFiles.length > 0;

        const normalize = (value: unknown) =>
          String(value || "")
            .trim()
            .toLowerCase();
        const normalizeName = (value: unknown) =>
          normalize(value)
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeUrlIdentity = (value: unknown) => {
          const raw = String(value || "").trim();
          if (!raw) return "";
          const withProtocol = /^https?:\/\//i.test(raw)
            ? raw
            : `https://${raw}`;
          try {
            const parsed = new URL(withProtocol);
            const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
            const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
            return `${host}${path}`;
          } catch {
            return normalize(raw)
              .replace(/^https?:\/\//i, "")
              .replace(/^www\./i, "")
              .replace(/\/+$/, "");
          }
        };
        const normalizePhone = (value: unknown) =>
          String(value || "").replace(/[^\d]/g, "");

        const matchEmail = normalize(match.email || fillIfBlank.email);
        const matchPhone = normalizePhone(match.phone || fillIfBlank.phone);
        const matchName = String(match.name || fillIfBlank.name || "").trim();
        const matchCity = normalize(match.city || fillIfBlank.city);
        const matchState = normalize(match.state || fillIfBlank.state);
        const matchWebsite = normalizeUrlIdentity(
          match.website || fillIfBlank.websiteUrl || fillIfBlank.website,
        );
        const matchFacebook = normalizeUrlIdentity(
          match.facebook || fillIfBlank.facebook || fillIfBlank.facebookPageUrl,
        );
        const matchInstagram = normalizeUrlIdentity(
          match.instagram || fillIfBlank.instagram || fillIfBlank.instagramUrl,
        );
        const explicitProfileId = String(
          requestBody?.existingProfileId || match.profileId || match.id || "",
        ).trim();
        const expectedOwnerUserId = String(
          requestBody?.expectedOwnerUserId || requestBody?.ownerUserId || "",
        ).trim();
        if (queuesOwnerReview && !explicitProfileId) {
          return res.status(400).json({
            status: "needs_review",
            code: "owner_review_requires_explicit_profile_id",
            message:
              "Owner review requires an explicit existingProfileId; heuristic matching is not allowed.",
          });
        }
        if (queuesOwnerReview && !expectedOwnerUserId) {
          return res.status(400).json({
            status: "needs_review",
            code: "owner_review_requires_expected_owner_id",
            message:
              "Owner review requires the exact owner returned by a fresh dry run.",
          });
        }
        if (mode === "apply" && !explicitProfileId) {
          return res.status(400).json({
            status: "needs_review",
            code: "direct_apply_requires_explicit_profile_id",
            message:
              "Direct apply requires an explicit existingProfileId; heuristic matching is not allowed.",
          });
        }
        if (mode === "apply" && requestBody?.confirmDirectApply !== true) {
          return res.status(400).json({
            status: "needs_confirmation",
            code: "direct_apply_requires_confirmation",
            message:
              "Direct apply requires the literal confirmDirectApply acknowledgement.",
          });
        }
        const queueRequestFiles = Object.entries(fileMap)
          .flatMap(([field, files]) =>
            (files || []).map((file) => ({
              field,
              name: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              sha256: createHash("sha256").update(file.buffer).digest("hex"),
            })),
          )
          .sort((left, right) =>
            `${left.field}:${left.name}:${left.sha256}`.localeCompare(
              `${right.field}:${right.name}:${right.sha256}`,
            ),
          );
        const queueRequestFingerprint = queuesOwnerReview
          ? createProfileEvidenceIntakeRequestFingerprint({
              requestBody,
              files: queueRequestFiles,
            })
          : "";
        const manualDeclaredEvidence = declaredEvidence.filter(
          (item: any) => item?.source === "manual_codex_intake",
        ) as any[];
        if (manualDeclaredEvidence.length > 0) {
          const uploadedRequestFiles = Object.values(fileMap).flat();
          const failManifest = (reason: string) =>
            res.status(400).json({
              message: "Manual evidence manifest does not match uploaded binaries",
              code: "manual_evidence_manifest_mismatch",
              reason,
            });
          if (uploadedRequestFiles.length !== manualDeclaredEvidence.length) {
            return failManifest("file_count_mismatch");
          }
          for (const declared of manualDeclaredEvidence) {
            const normalizedFilename = String(
              declared?.normalizedFilename || "",
            ).trim();
            const matches = uploadedRequestFiles.filter(
              (file) => file.originalname === normalizedFilename,
            );
            if (!normalizedFilename || matches.length !== 1) {
              return failManifest("filename_mismatch");
            }
            const actualHash = createHash("sha256")
              .update(matches[0].buffer)
              .digest("hex");
            if (actualHash !== String(declared?.sha256 || "").toLowerCase()) {
              return failManifest("checksum_mismatch");
            }
            if (
              Number(declared?.sizeBytes) !== matches[0].size ||
              String(declared?.profileId || "") !== explicitProfileId ||
              String(declared?.applyMode || "") !== "append_only_enrichment"
            ) {
              return failManifest("metadata_mismatch");
            }
            if (
              expectedOwnerUserId &&
              String(declared?.ownerUserId || "") !== expectedOwnerUserId
            ) {
              return failManifest("owner_mismatch");
            }
          }
        }
        const normalizedMatchName = normalizeName(matchName);
        const identitySignals = {
          phone: Boolean(matchPhone),
          email: Boolean(matchEmail),
          website: Boolean(matchWebsite),
          facebook: Boolean(matchFacebook),
          instagram: Boolean(matchInstagram),
          exactNameCity: Boolean(normalizedMatchName && matchCity),
          nameOnly: Boolean(
            normalizedMatchName && !matchCity && !matchPhone && !matchEmail,
          ),
        };
        const menuSignals = {
          menuItemCount: incomingMenuItems.length,
          hasMenuItems: incomingMenuItems.length > 0,
          hasMenuKeywords:
            sourceNotes.some((note: string) =>
              /menu|price|item|dish/i.test(note),
            ) ||
            evidenceFieldProposals.some((proposal: any) =>
              /menu|item|price|dish|food/i.test(String(proposal.field || "")),
            ),
        };
        const whyUnknownReasons: string[] = [];
        if (!matchName) whyUnknownReasons.push("missing_name");
        if (!matchCity && !matchState)
          whyUnknownReasons.push("missing_city_or_state");
        if (
          !matchPhone &&
          !matchEmail &&
          !matchWebsite &&
          !matchFacebook &&
          !matchInstagram
        ) {
          whyUnknownReasons.push("missing_hard_identity_anchors");
        }
        const buildDebug = (input: {
          classification: string;
          classificationReasons: string[];
          whyUnknown?: string[];
        }) => ({
          ocrTextSnippet,
          ocrConfidence: Number.isFinite(ocrConfidence) ? ocrConfidence : 0,
          classification: input.classification,
          classificationReasons: input.classificationReasons,
          identitySignals,
          menuSignals,
          matchStrength,
          matchedBy,
          existingTruckId: matchedRestaurant?.id || "",
          missingFields: missingInfo,
          whyUnknown:
            input.whyUnknown && input.whyUnknown.length > 0
              ? input.whyUnknown
              : whyUnknownReasons,
        });

        let explicitRestaurant: any = null;
        if (explicitProfileId) {
          const [profile] = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, explicitProfileId))
            .limit(1);
          if (!profile) {
            return res.status(404).json({
              message: "Existing profile not found",
              code: "existing_profile_not_found",
            });
          }
          if (
            expectedOwnerUserId &&
            String(profile.ownerId || "") !== expectedOwnerUserId
          ) {
            return res.status(409).json({
              message: "Existing profile owner does not match intake manifest",
              code: "existing_profile_owner_mismatch",
            });
          }
          explicitRestaurant = profile;
        }

        const restaurantWhere = or(
          matchPhone
            ? eq(
                sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`,
                matchPhone,
              )
            : sql`false`,
          matchWebsite
            ? sql`replace(replace(lower(coalesce(${restaurants.websiteUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchWebsite}%`}`
            : sql`false`,
          matchFacebook
            ? sql`replace(replace(lower(coalesce(${restaurants.facebookPageUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchFacebook}%`}`
            : sql`false`,
          matchInstagram
            ? sql`replace(replace(lower(coalesce(${restaurants.instagramUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchInstagram}%`}`
            : sql`false`,
          matchName
            ? and(
                sql`lower(${restaurants.name}) = ${normalize(matchName)}`,
                matchCity
                  ? sql`lower(coalesce(${restaurants.city}, '')) = ${matchCity}`
                  : sql`true`,
                matchState
                  ? sql`lower(coalesce(${restaurants.state}, '')) = ${matchState}`
                  : sql`true`,
              )
            : sql`false`,
        );

        const restaurantCandidates = explicitRestaurant
          ? []
          : await db
              .select()
              .from(restaurants)
              .where(restaurantWhere)
              .limit(10);

        const scoredRestaurants = restaurantCandidates
          .map((row: any) => {
            let score = 0;
            const matchedBy = new Set<string>();
            const rowNameNormalized = normalizeName(row.name);
            if (
              matchPhone &&
              normalizePhone(row.phone) &&
              normalizePhone(row.phone) === matchPhone
            ) {
              score += 12;
              matchedBy.add("phone_exact");
            }
            if (
              matchName &&
              normalize(row.name) === normalize(matchName) &&
              (!matchCity || normalize(row.city) === matchCity) &&
              (!matchState || normalize(row.state) === matchState)
            ) {
              score += 9;
              matchedBy.add("name_city_exact");
            } else if (
              normalizedMatchName &&
              rowNameNormalized &&
              rowNameNormalized.includes(normalizedMatchName)
            ) {
              score += 3;
              matchedBy.add("name_similar");
              if (matchCity && normalize(row.city) === matchCity) {
                score += 2;
                matchedBy.add("city_exact");
              }
            }
            if (
              matchWebsite &&
              normalizeUrlIdentity(row.websiteUrl) &&
              normalizeUrlIdentity(row.websiteUrl) === matchWebsite
            ) {
              score += 12;
              matchedBy.add("website_exact");
            }
            if (
              matchFacebook &&
              normalizeUrlIdentity(row.facebookPageUrl) &&
              normalizeUrlIdentity(row.facebookPageUrl) === matchFacebook
            ) {
              score += 12;
              matchedBy.add("facebook_exact");
            }
            if (
              matchInstagram &&
              normalizeUrlIdentity(row.instagramUrl) &&
              normalizeUrlIdentity(row.instagramUrl) === matchInstagram
            ) {
              score += 12;
              matchedBy.add("instagram_exact");
            }
            return { row, score, matchedBy: Array.from(matchedBy) };
          })
          .filter((row: any) => row.score >= 3)
          .sort((a: any, b: any) => b.score - a.score);

        let matchedRestaurant =
          explicitRestaurant || scoredRestaurants[0]?.row || null;
        let matchedBy = explicitRestaurant
          ? ["profile_id_exact"]
          : scoredRestaurants[0]?.matchedBy || [];
        let matchStrength: "strongest" | "strong" | "medium" | "weak" | "none" =
          explicitRestaurant ? "strongest" : "none";
        const topRestaurantScore = explicitRestaurant
          ? 100
          : Number(scoredRestaurants[0]?.score || 0);
        if (!explicitRestaurant) {
          if (topRestaurantScore >= 12) matchStrength = "strongest";
          else if (topRestaurantScore >= 9) matchStrength = "strong";
          else if (topRestaurantScore >= 5) matchStrength = "medium";
          else if (topRestaurantScore >= 3) matchStrength = "weak";
        }
        const multipleRestaurantStrongMatches =
          !explicitRestaurant &&
          scoredRestaurants.length > 1 &&
          scoredRestaurants[0].score === scoredRestaurants[1].score &&
          scoredRestaurants[0].score >= 9;

        let matchedImportListing: any = null;
        if (profileType === "food_truck") {
          if (explicitRestaurant) {
            const linkedListingId = String(
              explicitRestaurant.claimedFromImportId || "",
            ).trim();
            if (linkedListingId) {
              const [linkedListing] = await db
                .select()
                .from(truckImportListings)
                .where(eq(truckImportListings.id, linkedListingId))
                .limit(1);
              matchedImportListing = linkedListing || null;
            }
          } else {
          const listingWhere = or(
            matchEmail
              ? eq(
                  sql`lower(coalesce(${truckImportListings.email}, ''))`,
                  matchEmail,
                )
              : sql`false`,
            matchPhone
              ? eq(
                  sql`regexp_replace(coalesce(${truckImportListings.phone}, ''), '[^0-9]', '', 'g')`,
                  matchPhone,
                )
              : sql`false`,
            matchWebsite
              ? sql`lower(coalesce(${truckImportListings.websiteUrl}, '')) like ${`%${matchWebsite}%`}`
              : sql`false`,
            matchFacebook
              ? sql`lower(coalesce(${truckImportListings.facebookPageUrl}, '')) like ${`%${matchFacebook}%`}`
              : sql`false`,
            matchInstagram
              ? sql`lower(coalesce(${truckImportListings.instagramUrl}, '')) like ${`%${matchInstagram}%`}`
              : sql`false`,
            matchName
              ? and(
                  sql`lower(${truckImportListings.name}) = ${normalize(matchName)}`,
                  matchCity
                    ? sql`lower(coalesce(${truckImportListings.city}, '')) = ${matchCity}`
                    : sql`true`,
                  matchState
                    ? sql`lower(coalesce(${truckImportListings.state}, '')) = ${matchState}`
                    : sql`true`,
                )
              : sql`false`,
          );
          const importCandidates = await db
            .select()
            .from(truckImportListings)
            .where(listingWhere)
            .limit(10);
          const scoredImportCandidates = importCandidates
            .map((row: any) => {
              let score = 0;
              const matchedBySignals = new Set<string>();
              const rowNameNormalized = normalizeName(row.name);
              if (matchEmail && normalize(row.email) === matchEmail) {
                score += 12;
                matchedBySignals.add("email_exact");
              }
              if (
                matchPhone &&
                normalizePhone(row.phone) &&
                normalizePhone(row.phone) === matchPhone
              ) {
                score += 12;
                matchedBySignals.add("phone_exact");
              }
              if (
                matchWebsite &&
                normalizeUrlIdentity(row.websiteUrl) &&
                normalizeUrlIdentity(row.websiteUrl) === matchWebsite
              ) {
                score += 12;
                matchedBySignals.add("website_exact");
              }
              if (
                matchFacebook &&
                normalizeUrlIdentity(row.facebookPageUrl) &&
                normalizeUrlIdentity(row.facebookPageUrl) === matchFacebook
              ) {
                score += 12;
                matchedBySignals.add("facebook_exact");
              }
              if (
                matchInstagram &&
                normalizeUrlIdentity(row.instagramUrl) &&
                normalizeUrlIdentity(row.instagramUrl) === matchInstagram
              ) {
                score += 12;
                matchedBySignals.add("instagram_exact");
              }
              if (
                normalizedMatchName &&
                rowNameNormalized &&
                rowNameNormalized === normalizedMatchName &&
                (!matchCity || normalize(row.city) === matchCity)
              ) {
                score += 9;
                matchedBySignals.add("name_city_exact");
              } else if (
                normalizedMatchName &&
                rowNameNormalized &&
                rowNameNormalized.includes(normalizedMatchName)
              ) {
                score += 3;
                matchedBySignals.add("name_similar");
              }
              return { row, score, matchedBy: Array.from(matchedBySignals) };
            })
            .filter((row: any) => row.score >= 3)
            .sort((a: any, b: any) => b.score - a.score);
          if ((scoredImportCandidates[0]?.score || 0) > topRestaurantScore) {
            matchStrength =
              scoredImportCandidates[0].score >= 12
                ? "strongest"
                : scoredImportCandidates[0].score >= 9
                  ? "strong"
                  : scoredImportCandidates[0].score >= 5
                    ? "medium"
                    : "weak";
            matchedBy = scoredImportCandidates[0].matchedBy;
          }
          matchedImportListing = scoredImportCandidates[0]?.row || null;
          if (!matchedRestaurant && matchedImportListing) {
            const [linked] = await db
              .select()
              .from(restaurants)
              .where(
                eq(restaurants.claimedFromImportId, matchedImportListing.id),
              )
              .limit(1);
            matchedRestaurant = linked || null;
          }
          }
        }

        const identityCandidate = matchedRestaurant || matchedImportListing;
        const identityDecision = explicitRestaurant
          ? { disposition: "canonical_match" as const, reasons: ["profile_id_exact"] }
          : reconcileBusinessIdentity(
              {
                name: matchName,
                city: matchCity,
                state: matchState,
                phone: matchPhone,
                email: matchEmail,
                website: matchWebsite,
                facebook: matchFacebook,
                instagram: matchInstagram,
              },
              identityCandidate
                ? {
                    name: identityCandidate.name,
                    city: identityCandidate.city,
                    state: identityCandidate.state,
                    phone: identityCandidate.phone,
                    email: identityCandidate.email,
                    website: identityCandidate.websiteUrl,
                    facebook: identityCandidate.facebookPageUrl,
                    instagram: identityCandidate.instagramUrl,
                  }
                : null,
            );
        if (
          identityCandidate &&
          identityDecision.disposition !== "canonical_match"
        ) {
          return res.json({
            status: "needs_review",
            existingTruckId: matchedRestaurant?.id || "",
            matchedRestaurantId: matchedRestaurant?.id || "",
            matchedImportListingId: matchedImportListing?.id || "",
            createdDraftId: "",
            matchStrength,
            matchedBy,
            fieldsApplied: [],
            fieldsSkipped: [],
            conflicts: [
              {
                field: "identity",
                reason: "identity_conflict_review_required",
                details: identityDecision.reasons,
              },
            ],
            menuStatus: "none",
            scheduleStatus: "none",
            logoStatus: "none",
            missingInfo,
            sourceNotes,
            debug: buildDebug({
              classification: "needs_review",
              classificationReasons: [
                "identity_conflict_review_required",
                ...identityDecision.reasons,
              ],
            }),
          });
        }

        if (multipleRestaurantStrongMatches) {
          return res.json({
            status: "needs_review",
            existingTruckId: null,
            matchedRestaurantId: null,
            matchedImportListingId: null,
            createdDraftId: "",
            matchStrength,
            matchedBy,
            fieldsApplied: [],
            fieldsSkipped: [],
            conflicts: [{ field: "match", reason: "multiple_strong_matches" }],
            menuStatus: "none",
            scheduleStatus: "none",
            logoStatus: "none",
            missingInfo,
            sourceNotes,
            debug: buildDebug({
              classification: "needs_review",
              classificationReasons: ["multiple_strong_matches"],
            }),
          });
        }
        if (matchStrength === "weak" && matchedRestaurant) {
          return res.json({
            status: "needs_review",
            existingTruckId: matchedRestaurant.id,
            matchedRestaurantId: matchedRestaurant.id,
            matchedImportListingId: "",
            createdDraftId: "",
            matchStrength,
            matchedBy,
            fieldsApplied: [],
            fieldsSkipped: [],
            conflicts: [
              { field: "match", reason: "weak_name_only_review_required" },
            ],
            menuStatus: "none",
            scheduleStatus: "none",
            logoStatus: "none",
            missingInfo,
            sourceNotes,
            debug: buildDebug({
              classification: "needs_review",
              classificationReasons: ["weak_name_only_review_required"],
            }),
          });
        }

        let createdDraftId = "";
        if (!matchedRestaurant && !matchedImportListing) {
          if (mode !== "apply") {
            return res.json({
              status: "needs_review",
              existingTruckId: "",
              matchedRestaurantId: "",
              matchedImportListingId: "",
              createdDraftId: "",
              matchStrength,
              matchedBy,
              fieldsApplied: [],
              fieldsSkipped: [],
              conflicts: [],
              menuStatus: "none",
              scheduleStatus: "none",
              logoStatus: "none",
              missingInfo,
              sourceNotes,
              debug: buildDebug({
                classification: "needs_review",
                classificationReasons: [
                  "no_existing_match",
                  queuesOwnerReview
                    ? "owner_review_requires_existing_profile"
                    : "dry_run_only",
                ],
                whyUnknown: whyUnknownReasons,
              }),
            });
          }

          if (profileType === "food_truck") {
            const [createdListing] = await db
              .insert(truckImportListings)
              .values({
                name: String(fillIfBlank.name || matchName || "Unknown").trim(),
                address: String(
                  fillIfBlank.address || fillIfBlank.location_text || "",
                ).trim(),
                city:
                  String(fillIfBlank.city || match.city || "").trim() || null,
                state:
                  String(fillIfBlank.state || match.state || "").trim() || null,
                phone:
                  String(fillIfBlank.phone || match.phone || "").trim() || null,
                email:
                  String(fillIfBlank.email || match.email || "")
                    .trim()
                    .toLowerCase() || null,
                cuisineType: String(fillIfBlank.category || "").trim() || null,
                websiteUrl:
                  toUrl(
                    fillIfBlank.website || fillIfBlank.websiteUrl || null,
                  ) || null,
                status: "unclaimed",
                rawData: {
                  evidenceApply: {
                    sourceNotes,
                    missingInfo,
                    evidenceFieldProposals,
                    queuedMenuItems: incomingMenuItems,
                    queuedScheduleItems: incomingScheduleItems,
                  },
                },
              } as any)
              .returning();
            createdDraftId = createdListing.id;
            matchedImportListing = createdListing;
          } else if (
            ["restaurant", "bar", "caterer", "private_chef"].includes(
              profileType,
            )
          ) {
            const systemOwnerId = await getOrCreateImportSystemUserId();
            const [createdRestaurant] = await db
              .insert(restaurants)
              .values({
                ownerId: systemOwnerId,
                name: String(fillIfBlank.name || matchName || "Unknown").trim(),
                address: String(fillIfBlank.address || "").trim(),
                city:
                  String(fillIfBlank.city || match.city || "").trim() || null,
                state:
                  String(fillIfBlank.state || match.state || "").trim() || null,
                businessType: profileType,
                phone: String(fillIfBlank.phone || "").trim() || null,
                cuisineType: String(fillIfBlank.category || "").trim() || null,
                websiteUrl:
                  toUrl(
                    fillIfBlank.website || fillIfBlank.websiteUrl || null,
                  ) || null,
                facebookPageUrl:
                  toUrl(
                    fillIfBlank.facebook || fillIfBlank.facebookPageUrl || null,
                    "facebook.com",
                  ) || null,
                instagramUrl:
                  toUrl(
                    fillIfBlank.instagram || fillIfBlank.instagramUrl || null,
                    "instagram.com",
                  ) || null,
                isFoodTruck: false,
                isActive: false,
                isVerified: false,
                socialAutopostSettings: {
                  evidenceApply: {
                    sourceNotes,
                    missingInfo,
                    evidenceFieldProposals,
                    queuedMenuItems: incomingMenuItems,
                    queuedScheduleItems: incomingScheduleItems,
                  },
                },
              } as any)
              .returning();
            createdDraftId = createdRestaurant.id;
            matchedRestaurant = createdRestaurant;
          } else {
            return res.json({
              status: "needs_review",
              existingTruckId: "",
              matchedRestaurantId: "",
              matchedImportListingId: "",
              createdDraftId: "",
              matchStrength,
              matchedBy,
              fieldsApplied: [],
              fieldsSkipped: [],
              conflicts: [],
              menuStatus: "none",
              scheduleStatus: "none",
              logoStatus: "none",
              missingInfo,
              sourceNotes,
              debug: buildDebug({
                classification: "needs_review",
                classificationReasons: ["unsupported_profile_type"],
                whyUnknown: whyUnknownReasons,
              }),
            });
          }
        }

        if (!matchedRestaurant && matchedImportListing) {
          const [linked] = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.claimedFromImportId, matchedImportListing.id))
            .limit(1);
          matchedRestaurant = linked || null;
        }

        if (queuesOwnerReview && !matchedRestaurant) {
          return res.status(409).json({
            status: "needs_review",
            code: "owner_review_requires_existing_profile",
            message:
              "Owner review can only be queued for an existing MealScout profile.",
            matchedImportListingId: matchedImportListing?.id || "",
          });
        }

        if (queuesOwnerReview && matchedRestaurant) {
          const reservation = await db.transaction(async (tx: any) => {
            const restaurantId = String(matchedRestaurant.id);
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${restaurantId}))`,
            );
            const [freshRestaurant] = await tx
              .select()
              .from(restaurants)
              .where(eq(restaurants.id, restaurantId))
              .limit(1)
              .for("update");
            if (!freshRestaurant) return { status: "missing" as const };
            if (
              String(freshRestaurant.ownerId || "") !== expectedOwnerUserId
            ) {
              return { status: "owner_changed" as const };
            }
            const freshSettings =
              freshRestaurant.socialAutopostSettings &&
              typeof freshRestaurant.socialAutopostSettings === "object"
                ? (freshRestaurant.socialAutopostSettings as Record<
                    string,
                    unknown
                  >)
                : {};
            const evidenceApply =
              freshSettings.evidenceApply &&
              typeof freshSettings.evidenceApply === "object"
                ? (freshSettings.evidenceApply as Record<string, unknown>)
                : {};
            const intakeRequests = compactProfileEvidenceIntakeRequests(
              evidenceApply.intakeRequests,
            ) as Record<string, any>;
            const existingRequest = intakeRequests[intakeRequestId];
            if (existingRequest) {
              if (
                String(existingRequest.fingerprint || "") !==
                queueRequestFingerprint
              ) {
                return { status: "conflict" as const };
              }
              if (existingRequest.status === "completed") {
                return {
                  status: "replay" as const,
                  result:
                    existingRequest.result &&
                    typeof existingRequest.result === "object"
                      ? existingRequest.result
                      : {},
                };
              }
              const startedAt = Date.parse(String(existingRequest.startedAt || ""));
              if (
                existingRequest.status === "in_progress" &&
                Number.isFinite(startedAt) &&
                Date.now() - startedAt < 15 * 60 * 1000
              ) {
                return { status: "in_progress" as const };
              }
            } else if (
              countActiveProfileEvidenceIntakeRequests(intakeRequests) >=
              PROFILE_EVIDENCE_REVIEW_LIMITS.activeIntakeRequests
            ) {
              return { status: "capacity" as const };
            }
            const nextSettings = {
              ...freshSettings,
              evidenceApply: {
                ...evidenceApply,
                intakeRequests: {
                  ...intakeRequests,
                  [intakeRequestId]: {
                    fingerprint: queueRequestFingerprint,
                    status: "in_progress",
                    startedAt: new Date().toISOString(),
                    requestedByUserId: String(req.user?.id || "").slice(0, 200),
                  },
                },
              },
            };
            await tx
              .update(restaurants)
              .set({ socialAutopostSettings: nextSettings } as any)
              .where(eq(restaurants.id, restaurantId));
            return { status: "reserved" as const, restaurant: freshRestaurant };
          });
          if (reservation.status === "missing") {
            return res.status(409).json({
              code: "owner_review_profile_missing",
              message: "Profile disappeared before intake could be reserved.",
            });
          }
          if (reservation.status === "owner_changed") {
            return res.status(409).json({
              code: "existing_profile_owner_mismatch",
              message:
                "The profile owner changed after the dry run. Run a new dry check before queueing evidence.",
            });
          }
          if (reservation.status === "conflict") {
            return res.status(409).json({
              code: "intake_request_id_conflict",
              message:
                "This intakeRequestId was already used for different evidence.",
            });
          }
          if (reservation.status === "in_progress") {
            return res.status(409).json({
              code: "intake_request_in_progress",
              message: "This evidence intake is already in progress.",
            });
          }
          if (reservation.status === "capacity") {
            return res.status(409).json({
              code: "intake_request_capacity_reached",
              message: "The intake idempotency ledger is at capacity.",
            });
          }
          if (reservation.status === "replay") {
            return res.json({
              status: "owner_review_replayed",
              ownerReviewStatus: "replayed",
              idempotentReplay: true,
              intakeRequestId,
              originalResult: reservation.result,
            });
          }
          matchedRestaurant = reservation.restaurant;
          reservedQueueRequest = {
            restaurantId: String(reservation.restaurant.id),
            intakeRequestId,
            fingerprint: queueRequestFingerprint,
          };
        }

        const fieldsApplied: string[] = [];
        const fieldsSkipped: string[] = [];
        const conflicts: Array<{
          field: string;
          existing: unknown;
          incoming: unknown;
        }> = [];
        const reviewQueueItems: Array<Record<string, unknown>> = [];
        const listingUpdates: Record<string, unknown> = {};
        const restaurantUpdates: Record<string, unknown> = {};
        const evidenceUploadsSummary: Array<Record<string, unknown>> = [];
        const queuedGalleryEntries: Array<Record<string, unknown>> = [];
        let ownerReviewProposalResult = {
          submittedCount: rawEvidenceFieldProposals.length,
          acceptedIds: [] as string[],
          duplicateIds: [] as string[],
          rejected: [] as Array<{
            id: string;
            inputIndex: number;
            code: string;
          }>,
          droppedCount: 0,
          droppedIds: [] as string[],
        };
        let queuedMenuItemResult = {
          ...queuedMenuItemBatch,
          acceptedIds: [...queuedMenuItemBatch.acceptedIds],
          duplicateIds: [...queuedMenuItemBatch.duplicateIds],
        };
        let queuedScheduleItemResult = {
          ...queuedScheduleItemBatch,
          acceptedIds: [...queuedScheduleItemBatch.acceptedIds],
          duplicateIds: [...queuedScheduleItemBatch.duplicateIds],
        };
        const emptyQueueMergeResult = () => ({
          acceptedIds: [] as string[],
          duplicateIds: [] as string[],
          droppedCount: 0,
          droppedIds: [] as string[],
        });
        let sourceNoteResult = {
          ...sourceNoteBatch,
          acceptedIds: [...sourceNoteBatch.acceptedIds],
          duplicateIds: [...sourceNoteBatch.duplicateIds],
        };
        let missingInfoResult = {
          ...missingInfoBatch,
          acceptedIds: [...missingInfoBatch.acceptedIds],
          duplicateIds: [...missingInfoBatch.duplicateIds],
        };
        let reviewQueueResult = emptyQueueMergeResult();
        let uploadedEvidenceResult = emptyQueueMergeResult();
        let galleryEntryResult = emptyQueueMergeResult();

        const summarizeUploadedEvidence = (input: {
          file: Express.Multer.File;
          assetType: ProfileAssetType;
          remoteUrl: string | null;
          imageUploadId: string | null;
          deliveryType: "authenticated" | "upload";
          reviewStatus: "pending_review" | "approved";
        }) => {
          const declared = declaredEvidence.find((item: any) => {
            const normalizedFilename = String(
              item?.normalizedFilename || item?.targetName || "",
            ).trim();
            return normalizedFilename === input.file.originalname;
          }) as any;
          const sha256 = createHash("sha256")
            .update(input.file.buffer)
            .digest("hex");
          const normalized = buildProfileAssetEvidence({
            source:
              declared?.source === "manual_codex_intake"
                ? "manual_codex_intake"
                : "admin_user_upload",
            originalFilename: String(
              declared?.originalFilename || input.file.originalname,
            ),
            normalizedFilename: input.file.originalname,
            normalizedPath:
              input.deliveryType === "authenticated"
                ? `image-upload:${input.imageUploadId || "unavailable"}`
                : String(declared?.normalizedPath || input.remoteUrl || ""),
            sha256,
            assetType: input.assetType,
            profileSlug: declared?.profileSlug
              ? String(declared.profileSlug)
              : requestBody?.profileSlug
                ? String(requestBody.profileSlug)
                : null,
            profileId: String(matchedRestaurant?.id || explicitProfileId),
            ownerUserId: expectedOwnerUserId || matchedRestaurant?.ownerId || null,
            intakeAt: declared?.intakeAt || new Date().toISOString(),
            applyMode: "append_only_enrichment",
            mimeType: input.file.mimetype,
            sizeBytes: input.file.size,
            reviewStatus: input.reviewStatus,
          });
          return {
            ...normalized,
            imageUploadId: input.imageUploadId,
            deliveryType: input.deliveryType,
          };
        };

        const isProtectedField = (field: string) =>
          [
            "description",
            "menu",
            "schedule",
            "logoUrl",
            "coverImageUrl",
            "photos",
            "booking_available",
            "catering_available",
          ].includes(field);

        const mappedFields: Array<{
          key: string;
          listingField?: string;
          restaurantField?: string;
          transform?: (value: unknown) => unknown;
        }> = [
          { key: "name", listingField: "name", restaurantField: "name" },
          {
            key: "address",
            listingField: "address",
            restaurantField: "address",
          },
          { key: "city", listingField: "city", restaurantField: "city" },
          { key: "state", listingField: "state", restaurantField: "state" },
          { key: "phone", listingField: "phone", restaurantField: "phone" },
          {
            key: "email",
            listingField: "email",
            transform: (value) =>
              String(value || "")
                .trim()
                .toLowerCase(),
          },
          {
            key: "website",
            listingField: "websiteUrl",
            restaurantField: "websiteUrl",
            transform: (value) => toUrl(value),
          },
          {
            key: "websiteUrl",
            listingField: "websiteUrl",
            restaurantField: "websiteUrl",
            transform: (value) => toUrl(value),
          },
          {
            key: "facebook",
            listingField: "facebookPageUrl",
            restaurantField: "facebookPageUrl",
            transform: (value) => toUrl(value, "facebook.com"),
          },
          {
            key: "facebookPageUrl",
            listingField: "facebookPageUrl",
            restaurantField: "facebookPageUrl",
            transform: (value) => toUrl(value, "facebook.com"),
          },
          {
            key: "instagram",
            listingField: "instagramUrl",
            restaurantField: "instagramUrl",
            transform: (value) => toUrl(value, "instagram.com"),
          },
          {
            key: "instagramUrl",
            listingField: "instagramUrl",
            restaurantField: "instagramUrl",
            transform: (value) => toUrl(value, "instagram.com"),
          },
          {
            key: "category",
            listingField: "cuisineType",
            restaurantField: "cuisineType",
          },
          { key: "businessType", restaurantField: "businessType" },
          { key: "business_type", restaurantField: "businessType" },
        ];

        for (const mapEntry of mappedFields) {
          if (fillIfBlank[mapEntry.key] === undefined) continue;
          if (isProtectedField(mapEntry.key)) {
            fieldsSkipped.push(mapEntry.key);
            continue;
          }
          const incoming = mapEntry.transform
            ? mapEntry.transform(fillIfBlank[mapEntry.key])
            : fillIfBlank[mapEntry.key];
          if (isBlankValue(incoming)) continue;

          if (matchedImportListing && mapEntry.listingField) {
            const existing = (matchedImportListing as any)[
              mapEntry.listingField
            ];
            if (isBlankValue(existing)) {
              listingUpdates[mapEntry.listingField] = incoming;
              fieldsApplied.push(`listing.${mapEntry.listingField}`);
            } else if (
              normalizeComparable(existing) !== normalizeComparable(incoming)
            ) {
              conflicts.push({
                field: `listing.${mapEntry.listingField}`,
                existing,
                incoming,
              });
              fieldsSkipped.push(`listing.${mapEntry.listingField}`);
            } else {
              fieldsSkipped.push(`listing.${mapEntry.listingField}`);
            }
          }

          if (matchedRestaurant && mapEntry.restaurantField) {
            const existing = (matchedRestaurant as any)[
              mapEntry.restaurantField
            ];
            if (isBlankValue(existing)) {
              restaurantUpdates[mapEntry.restaurantField] = incoming;
              fieldsApplied.push(`restaurant.${mapEntry.restaurantField}`);
            } else if (
              normalizeComparable(existing) !== normalizeComparable(incoming)
            ) {
              conflicts.push({
                field: `restaurant.${mapEntry.restaurantField}`,
                existing,
                incoming,
              });
              fieldsSkipped.push(`restaurant.${mapEntry.restaurantField}`);
            } else {
              fieldsSkipped.push(`restaurant.${mapEntry.restaurantField}`);
            }
          }
        }

        if (descriptionOnlyIfBlank && matchedRestaurant) {
          if (isBlankValue(matchedRestaurant.description)) {
            restaurantUpdates.description = descriptionOnlyIfBlank;
            fieldsApplied.push("restaurant.description");
          } else {
            fieldsSkipped.push("restaurant.description");
          }
        }

        let menuStatus:
          | "added"
          | "queued_review"
          | "skipped_existing"
          | "none" = "none";
        let scheduleStatus:
          | "added"
          | "queued_review"
          | "skipped_existing"
          | "none" = "none";
        let logoStatus: "uploaded" | "skipped_existing_logo" | "none" = "none";
        let evidenceStatus: "attached" | "queued_review" | "none" = "none";
        let menuEvidenceStatus: "attached" | "queued_review" | "none" = "none";

        const appendEvidence = (
          existingRaw: Record<string, unknown> | null | undefined,
          recordProposalResult = true,
        ) => {
          const existingContainer = existingRaw || {};
          const existingEvidenceApply =
            typeof (existingContainer as any).evidenceApply === "object"
              ? ((existingContainer as any).evidenceApply as Record<
                  string,
                  unknown
                >)
              : {};
          const existingSettings =
            matchedRestaurant &&
            typeof (matchedRestaurant as any).socialAutopostSettings ===
              "object"
              ? ((matchedRestaurant as any).socialAutopostSettings as Record<
                  string,
                  unknown
                >)
              : {};
          const actionLinks =
            existingSettings &&
            typeof (existingSettings as any).publicActionLinks === "object"
              ? ((existingSettings as any).publicActionLinks as Record<
                  string,
                  unknown
                >)
              : {};
          const currentValues = Object.fromEntries(
            PROFILE_EVIDENCE_REVIEW_FIELDS.map((field) => {
              const destination =
                getProfileEvidenceFieldDefinition(field).destination;
              const value =
                destination.kind === "restaurant_column"
                  ? (matchedRestaurant as any)?.[destination.column]
                  : actionLinks[destination.key];
              return [field, value];
            }),
          ) as ProfileEvidenceCurrentValues;
          const updatedAt = new Date().toISOString();
          const ledgerOptions = {
            restaurantId: String(
              matchedRestaurant?.id ||
                matchedImportListing?.id ||
                explicitProfileId,
            ),
            fallbackReceivedAt: String(
              (existingEvidenceApply as any).updatedAt || updatedAt,
            ),
            defaultBatchId:
              String(
                requestBody?.evidenceBatchId ||
                  requestBody?.batchId ||
                  requestBody?.intakeId ||
                  "",
              ).trim() || `intake-${updatedAt}`,
            currentValues,
          };
          const existingLedger = normalizeProfileEvidenceReviewLedger(
            existingContainer,
            ledgerOptions,
          );
          const proposalBatch = normalizeProfileEvidenceProposalBatch(
            ownerReviewEvidenceFieldProposals,
            ledgerOptions,
          );
          const appendedOwnerReview = appendProfileEvidenceReviewProposals(
            existingLedger,
            proposalBatch.proposals,
            ledgerOptions,
          );
          if (recordProposalResult) {
            ownerReviewProposalResult = {
              submittedCount: rawEvidenceFieldProposals.length,
              acceptedIds: appendedOwnerReview.addedIds,
              duplicateIds: Array.from(
                new Set([
                  ...proposalBatch.duplicateIds,
                  ...appendedOwnerReview.duplicateIds,
                ]),
              ),
              rejected: proposalBatch.rejected,
              droppedCount:
                proposalBatch.droppedCount +
                appendedOwnerReview.droppedIds.length,
              droppedIds: Array.from(
                new Set([
                  ...proposalBatch.droppedIds,
                  ...appendedOwnerReview.droppedIds,
                ]),
              ),
            };
          }
          return {
            ...existingContainer,
            evidenceApply: {
              ...existingEvidenceApply,
              updatedAt,
              sourceNotes,
              missingInfo,
              evidenceFieldProposals: proposalBatch.proposals,
              queuedMenuItems: incomingMenuItems,
              queuedScheduleItems: incomingScheduleItems,
              ownerReview: appendedOwnerReview.ledger,
            },
          };
        };

        if (matchedImportListing) {
          listingUpdates.rawData = appendEvidence(
            (matchedImportListing.rawData as Record<string, unknown>) || {},
            !matchedRestaurant,
          );
        }

        if (matchedRestaurant) {
          const existingSettings =
            typeof (matchedRestaurant as any).socialAutopostSettings ===
            "object"
              ? ((matchedRestaurant as any).socialAutopostSettings as Record<
                  string,
                  unknown
                >)
              : {};
          restaurantUpdates.socialAutopostSettings =
            appendEvidence(existingSettings);
        }

        if (matchedRestaurant) {
          const existingMenuCountRows = await db
            .select({ total: sql<number>`count(*)` })
            .from(menuItems)
            .where(eq(menuItems.restaurantId, matchedRestaurant.id));
          const existingMenuCount = Number(
            existingMenuCountRows?.[0]?.total || 0,
          );

          if (incomingMenuItems.length > 0) {
            if (existingMenuCount > 0 && !allowMenuOverwrite) {
              menuStatus = "queued_review";
              reviewQueueItems.push({
                type: "menu_conflict",
                reason: "existing_menu_present",
                approvedOverwrite: false,
                queuedAt: new Date().toISOString(),
                existingMenuCount,
              });
            } else if (mode === "apply") {
              if (existingMenuCount > 0 && allowMenuOverwrite) {
                await db
                  .delete(menuItems)
                  .where(eq(menuItems.restaurantId, matchedRestaurant.id));
                await db
                  .delete(menus)
                  .where(eq(menus.restaurantId, matchedRestaurant.id));
                reviewQueueItems.push({
                  type: "menu_overwrite",
                  reason: "explicit_overwrite_approval",
                  queuedAt: new Date().toISOString(),
                  existingMenuCount,
                });
              }

              const [menu] = await db
                .insert(menus)
                .values({
                  restaurantId: matchedRestaurant.id,
                  name: "Menu",
                  serviceType: "all",
                  isActive: true,
                  importSource: "manual",
                  importedAt: new Date(),
                } as any)
                .returning();

              const itemsToInsert = directApplyMenuItems
                .map((validatedItem: any, index: number) => {
                  if (!("item" in validatedItem)) return null;
                  const item = validatedItem.item;
                  const name = String(
                    item?.item_name || item?.name || "",
                  ).trim();
                  if (!name) return null;
                  return {
                    menuId: menu.id,
                    categoryId: null,
                    restaurantId: matchedRestaurant.id,
                    name,
                    description: String(item?.description || "").trim() || null,
                    priceCents: validatedItem.priceCents,
                    itemType: "food",
                    isAvailable: true,
                    sortOrder: index,
                  };
                })
                .filter(Boolean);

              if (itemsToInsert.length > 0) {
                await db.insert(menuItems).values(itemsToInsert as any[]);
                menuStatus = "added";
              } else {
                menuStatus = "none";
              }
            } else {
              menuStatus = "queued_review";
            }
          }

          const lowConfidenceMenuEvidence = evidenceFieldProposals.some(
            (proposal: any) =>
              String(proposal.field || "")
                .toLowerCase()
                .includes("menu") &&
              ["low", "unknown", "uncertain"].includes(
                String(proposal.confidence || "").toLowerCase(),
              ),
          );
          const hasMenuEvidenceWithoutParsedMenu =
            menuEvidenceFiles.length > 0 && incomingMenuItems.length === 0;
          if (lowConfidenceMenuEvidence || hasMenuEvidenceWithoutParsedMenu) {
            menuStatus = "queued_review";
            menuEvidenceStatus =
              menuEvidenceFiles.length > 0
                ? "queued_review"
                : menuEvidenceStatus;
            reviewQueueItems.push({
              type: "menu_evidence_review",
              reason: lowConfidenceMenuEvidence
                ? "low_confidence_extraction"
                : "menu_images_without_parsed_items",
              queuedAt: new Date().toISOString(),
              menuImageCount: menuEvidenceFiles.length,
              parsedMenuItems: incomingMenuItems.length,
            });
          }

          const existingScheduleRows = await db
            .select({ total: sql<number>`count(*)` })
            .from(truckManualSchedules)
            .where(eq(truckManualSchedules.truckId, matchedRestaurant.id));
          const existingScheduleCount = Number(
            existingScheduleRows?.[0]?.total || 0,
          );

          const validScheduleItems = incomingScheduleItems.filter(
            (item: any) => {
              const date = String(item?.date || "").trim();
              const location = String(
                item?.location_name || item?.locationName || "",
              ).trim();
              const start = String(
                item?.start_time || item?.startTime || "",
              ).trim();
              const end = String(item?.end_time || item?.endTime || "").trim();
              return Boolean(date && location && start && end);
            },
          );

          if (validScheduleItems.length > 0) {
            if (existingScheduleCount > 0) {
              scheduleStatus = "queued_review";
            } else if (mode === "apply" && profileType === "food_truck") {
              const rows = validScheduleItems.map((item: any) => {
                const address = String(item.address || "").trim() || null;
                return {
                  truckId: matchedRestaurant.id,
                  date: new Date(String(item.date)),
                  startTime: String(item.start_time || item.startTime),
                  endTime: String(item.end_time || item.endTime),
                  locationName:
                    String(
                      item.location_name || item.locationName || "",
                    ).trim() || null,
                  address,
                  city:
                    String(item.city || fillIfBlank.city || "").trim() || null,
                  state:
                    String(item.state || fillIfBlank.state || "").trim() || null,
                  notes: String(item.notes || "").trim() || null,
                  isPublic: true,
                  mapEligible: Boolean(address),
                  lastConfirmedAt: new Date(),
                };
              });
              await db.insert(truckManualSchedules).values(rows as any[]);
              scheduleStatus = "added";
            } else {
              scheduleStatus = "queued_review";
            }
          }

          if (logoEnabled) {
            if (
              firstImageFile &&
              mode === "apply" &&
              (!matchedRestaurant.logoUrl || allowLogoReplace)
            ) {
              if (!isCloudinaryConfigured()) {
                return res.status(503).json({
                  message: "Image upload service not configured",
                });
              }
              const uploadResult = await uploadToCloudinary(
                firstImageFile.buffer,
                "restaurant-logos",
                `restaurant-${matchedRestaurant.id}-logo`,
              );
              const insertedUploads = await db
                .insert(imageUploads)
                .values({
                  uploadedByUserId: req.user?.id || null,
                  imageType: "restaurant_logo",
                  entityId: matchedRestaurant.id,
                  entityType: "restaurant",
                  cloudinaryPublicId: uploadResult.publicId,
                  cloudinaryUrl: uploadResult.secureUrl,
                  thumbnailUrl: uploadResult.thumbnailUrl,
                  width: uploadResult.width,
                  height: uploadResult.height,
                  fileSize: uploadResult.bytes,
                  mimeType: firstImageFile.mimetype,
                })
                .returning();
              const existingSettings =
                typeof (matchedRestaurant as any).socialAutopostSettings ===
                "object"
                  ? {
                      ...((matchedRestaurant as any).socialAutopostSettings ||
                        {}),
                    }
                  : {};
              const existingGallery = Array.isArray(
                (existingSettings as any).publicGalleryImages,
              )
                ? [...((existingSettings as any).publicGalleryImages as any[])]
                : [];
              existingGallery.push({
                id: insertedUploads?.[0]?.id || randomUUID(),
                url: uploadResult.secureUrl,
                source: "logo",
                category: "logo",
                publicApproved: true,
                uploadedAt: new Date().toISOString(),
                lastVerifiedAt: new Date().toISOString(),
              });
              queuedGalleryEntries.push(existingGallery[existingGallery.length - 1]);
              evidenceUploadsSummary.push(
                summarizeUploadedEvidence({
                  file: firstImageFile,
                  assetType: "logo",
                  remoteUrl: uploadResult.secureUrl,
                  imageUploadId: insertedUploads?.[0]?.id || null,
                  deliveryType: "upload",
                  reviewStatus: "approved",
                }),
              );

              restaurantUpdates.logoUrl = uploadResult.secureUrl;
              restaurantUpdates.socialAutopostSettings = {
                ...existingSettings,
                publicGalleryImages: existingGallery,
                evidenceApply: (restaurantUpdates.socialAutopostSettings as any)
                  ?.evidenceApply,
              };
              logoStatus = "uploaded";
            } else if (matchedRestaurant.logoUrl) {
              logoStatus = "skipped_existing_logo";
              reviewQueueItems.push({
                type: "logo_conflict",
                reason: allowLogoReplace
                  ? "logo_replace_requested_but_no_file"
                  : "existing_logo_present",
                queuedAt: new Date().toISOString(),
                approvedOverwrite: allowLogoReplace,
              });
            }
          }

          const uploadEvidenceFiles = async (
            files: Express.Multer.File[],
            options: {
              cloudinaryFolder: string;
              imageType: string;
              galleryCategory: string;
              evidenceType: string;
              assetType: ProfileAssetType;
            },
          ) => {
            if (!files.length) return;
            if (!isCloudinaryConfigured()) {
              throw new Error("Image upload service not configured");
            }

            const existingSettings =
              typeof (matchedRestaurant as any).socialAutopostSettings ===
              "object"
                ? {
                    ...((matchedRestaurant as any).socialAutopostSettings ||
                      {}),
                  }
                : {};
            const existingGallery = Array.isArray(
              (existingSettings as any).publicGalleryImages,
            )
              ? [...((existingSettings as any).publicGalleryImages as any[])]
              : [];

            for (const file of files) {
              const fileSha256 = createHash("sha256")
                .update(file.buffer)
                .digest("hex");
              const deterministicPublicId = `restaurant-${matchedRestaurant.id}-${options.evidenceType}-${fileSha256.slice(0, 32)}`;
              const deterministicCloudinaryPublicId = `mealscout/${options.cloudinaryFolder}/${deterministicPublicId}`;
              const ensureEvidenceUpload = async (executor: any) => {
                const [existingUpload] = queuesOwnerReview
                  ? await executor
                      .select()
                      .from(imageUploads)
                      .where(
                        and(
                          eq(imageUploads.entityId, matchedRestaurant.id),
                          eq(imageUploads.entityType, "restaurant"),
                          eq(imageUploads.imageType, options.imageType),
                          eq(
                            imageUploads.cloudinaryPublicId,
                            deterministicCloudinaryPublicId,
                          ),
                          sql`${imageUploads.cloudinaryUrl} like ${"%/image/authenticated/%"}`,
                        ),
                      )
                      .limit(1)
                  : [];
                if (existingUpload) {
                  return {
                    uploadRow: existingUpload,
                    uploadResult: {
                      publicId: existingUpload.cloudinaryPublicId,
                      secureUrl: existingUpload.cloudinaryUrl,
                      thumbnailUrl: existingUpload.thumbnailUrl,
                      width: existingUpload.width,
                      height: existingUpload.height,
                      bytes: existingUpload.fileSize,
                    },
                  };
                }
                const uploadResult = queuesOwnerReview
                  ? await uploadPrivateEvidenceToCloudinary(
                      file.buffer,
                      options.cloudinaryFolder,
                      deterministicPublicId,
                    )
                  : await uploadToCloudinary(
                      file.buffer,
                      options.cloudinaryFolder,
                      `restaurant-${matchedRestaurant.id}-${options.evidenceType}-${Date.now()}`,
                    );
                const storedMimeType =
                  ({
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                    png: "image/png",
                    webp: "image/webp",
                    gif: "image/gif",
                    avif: "image/avif",
                  } as Record<string, string>)[
                    String(uploadResult.format || "").toLowerCase()
                  ] || file.mimetype;
                const insertedUploads = await executor
                  .insert(imageUploads)
                  .values({
                    uploadedByUserId: req.user?.id || null,
                    imageType: options.imageType,
                    entityId: matchedRestaurant.id,
                    entityType: "restaurant",
                    cloudinaryPublicId: uploadResult.publicId,
                    cloudinaryUrl: uploadResult.secureUrl,
                    thumbnailUrl: uploadResult.thumbnailUrl,
                    width: uploadResult.width,
                    height: uploadResult.height,
                    fileSize: uploadResult.bytes,
                    mimeType: storedMimeType,
                  })
                  .returning();
                return {
                  uploadRow: insertedUploads?.[0] || null,
                  uploadResult,
                };
              };
              const { uploadRow, uploadResult } = queuesOwnerReview
                ? await db.transaction(async (tx: any) => {
                    await tx.execute(
                      sql`select pg_advisory_xact_lock(hashtext(${deterministicCloudinaryPublicId}))`,
                    );
                    return ensureEvidenceUpload(tx);
                  })
                : await ensureEvidenceUpload(db);
              if (!uploadRow?.id) {
                throw new Error("Evidence upload row was not created");
              }

              if (allowEvidencePublication) {
                const galleryEntry = {
                  id: uploadRow.id,
                  url: uploadResult.secureUrl,
                  source: "admin_evidence",
                  category: options.galleryCategory,
                  publicApproved: true,
                  uploadedAt: new Date().toISOString(),
                  lastVerifiedAt: new Date().toISOString(),
                };
                existingGallery.push(galleryEntry);
                queuedGalleryEntries.push(galleryEntry);
              }
              evidenceUploadsSummary.push({
                ...summarizeUploadedEvidence({
                  file,
                  assetType: options.assetType,
                  remoteUrl: queuesOwnerReview
                    ? null
                    : uploadResult.secureUrl,
                  imageUploadId: uploadRow.id,
                  deliveryType: queuesOwnerReview
                    ? "authenticated"
                    : "upload",
                  reviewStatus: allowEvidencePublication
                    ? "approved"
                    : "pending_review",
                }),
                evidenceType: options.evidenceType,
                entityType: "restaurant",
                entityId: matchedRestaurant.id,
              });
            }

            restaurantUpdates.socialAutopostSettings = {
              ...existingSettings,
              publicGalleryImages: existingGallery,
              evidenceApply: (restaurantUpdates.socialAutopostSettings as any)
                ?.evidenceApply,
            };
          };

          if ((mode === "apply" || queuesOwnerReview) && hasEvidenceFiles) {
            await uploadEvidenceFiles(profileEvidenceFiles, {
              cloudinaryFolder: "restaurant-gallery",
              imageType: "restaurant_gallery_truck",
              galleryCategory: "truck",
              evidenceType: "profile_media",
              assetType: "profile_media",
            });
            await uploadEvidenceFiles(menuEvidenceFiles, {
              cloudinaryFolder: "restaurant-gallery",
              imageType: "restaurant_gallery_menu",
              galleryCategory: "menu",
              evidenceType: "menu_evidence",
              assetType: "menu",
            });
            await uploadEvidenceFiles(hoursEvidenceFiles, {
              cloudinaryFolder: "restaurant-gallery",
              imageType: "restaurant_gallery_hours",
              galleryCategory: "other",
              evidenceType: "hours_evidence",
              assetType: "hours",
            });
            await uploadEvidenceFiles(contactEvidenceFiles, {
              cloudinaryFolder: "restaurant-gallery",
              imageType: "restaurant_gallery_contact",
              galleryCategory: "other",
              evidenceType: "contact_evidence",
              assetType: "contact",
            });
            evidenceStatus =
              evidenceUploadsSummary.length > 0 ? "attached" : "none";
            if (menuEvidenceFiles.length > 0 && menuEvidenceStatus === "none") {
              menuEvidenceStatus = "attached";
            }
          } else if (hasEvidenceFiles) {
            evidenceStatus = "queued_review";
            if (menuEvidenceFiles.length > 0) {
              menuEvidenceStatus = "queued_review";
            }
          }

          if (queuesOwnerReview) {
            ownerReviewEvidenceFieldProposals =
              bindProfileEvidenceProposalImageReferences(
                evidenceFieldProposals,
                evidenceUploadsSummary,
              );
          }

          if (hasEvidenceFiles && !allowEvidencePublication) {
            reviewQueueItems.push({
              type: "asset_evidence_review",
              reason: "manual_or_admin_evidence_requires_publication_approval",
              queuedAt: new Date().toISOString(),
              assetCount:
                profileEvidenceFiles.length +
                menuEvidenceFiles.length +
                hoursEvidenceFiles.length +
                contactEvidenceFiles.length,
              approvedPublication: false,
            });
          }

          if (hoursEvidenceFiles.length > 0) {
            reviewQueueItems.push({
              type: "hours_evidence_review",
              reason: "operator_provided_hours_images",
              queuedAt: new Date().toISOString(),
              hoursImageCount: hoursEvidenceFiles.length,
            });
          }
          if (contactEvidenceFiles.length > 0) {
            reviewQueueItems.push({
              type: "contact_evidence_review",
              reason: "operator_provided_contact_images",
              queuedAt: new Date().toISOString(),
              contactImageCount: contactEvidenceFiles.length,
            });
          }
        }

        if (conflicts.length > 0) {
          reviewQueueItems.push({
            type: "field_conflicts",
            reason: "conflicting_existing_values",
            queuedAt: new Date().toISOString(),
            conflictCount: conflicts.length,
          });
        }

        if (reviewQueueItems.length > 0 || evidenceUploadsSummary.length > 0) {
          if (matchedImportListing) {
            listingUpdates.rawData = {
              ...((listingUpdates.rawData as Record<string, unknown>) || {}),
              evidenceApply: {
                ...(((listingUpdates.rawData as any)?.evidenceApply ||
                  {}) as Record<string, unknown>),
                reviewQueue: reviewQueueItems,
                uploadedEvidence: evidenceUploadsSummary,
              },
            };
          }

          if (matchedRestaurant) {
            const currentSettings =
              (restaurantUpdates.socialAutopostSettings as Record<
                string,
                unknown
              >) ||
              (typeof (matchedRestaurant as any).socialAutopostSettings ===
              "object"
                ? ({
                    ...(matchedRestaurant as any).socialAutopostSettings,
                  } as Record<string, unknown>)
                : {});
            restaurantUpdates.socialAutopostSettings = {
              ...currentSettings,
              evidenceApply: {
                ...((currentSettings as any)?.evidenceApply || {}),
                reviewQueue: reviewQueueItems,
                uploadedEvidence: evidenceUploadsSummary,
              },
            };
          }
        }

        if (queuesOwnerReview && matchedRestaurant) {
          for (const item of reviewQueueItems) {
            const semanticPayload = Object.fromEntries(
              Object.entries(item)
                .filter(([key]) => key !== "queuedAt" && key !== "id")
                .sort(([left], [right]) => left.localeCompare(right)),
            );
            item.id = createHash("sha256")
              .update(
                JSON.stringify([
                  "profile-evidence-review-artifact",
                  String(matchedRestaurant.id),
                  semanticPayload,
                ]),
              )
              .digest("hex");
          }
        }

        let queueAcceptedCount =
          ownerReviewProposalResult.acceptedIds.length +
          queuedMenuItemResult.acceptedIds.length +
          queuedScheduleItemResult.acceptedIds.length +
          sourceNotes.length +
          missingInfo.length +
          reviewQueueItems.length +
          evidenceUploadsSummary.length;
        if (queuesOwnerReview && matchedRestaurant && reservedQueueRequest) {
          await db.transaction(async (tx: any) => {
            const restaurantId = String(matchedRestaurant.id);
            // Share the exact per-profile lock used by owner decisions. This
            // prevents a queue write from replacing a decision committed from
            // a stale pre-upload read.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${restaurantId}))`,
            );
            const [freshRestaurant] = await tx
              .select()
              .from(restaurants)
              .where(eq(restaurants.id, restaurantId))
              .limit(1)
              .for("update");
            if (!freshRestaurant) {
              throw Object.assign(new Error("Profile disappeared during queue"), {
                code: "owner_review_profile_missing",
              });
            }
            if (
              String(freshRestaurant.ownerId || "") !== expectedOwnerUserId
            ) {
              throw Object.assign(
                new Error("Profile owner changed during evidence intake"),
                { code: "existing_profile_owner_mismatch" },
              );
            }
            matchedRestaurant = freshRestaurant;
            const freshSettings =
              freshRestaurant.socialAutopostSettings &&
              typeof freshRestaurant.socialAutopostSettings === "object"
                ? (freshRestaurant.socialAutopostSettings as Record<
                    string,
                    unknown
                  >)
                : {};
            const queuedSettings = appendEvidence(freshSettings);
            const queuedEvidenceApply =
              queuedSettings.evidenceApply &&
              typeof queuedSettings.evidenceApply === "object"
                ? (queuedSettings.evidenceApply as Record<string, unknown>)
                : {};
            const queueMerge = mergeProfileEvidenceQueueContainerWithReport({
              freshContainer: freshSettings,
              queuedEvidenceApply,
              galleryEntries: queuedGalleryEntries,
              reviewQueueItems,
              uploadedEvidence: evidenceUploadsSummary,
            });
            queuedMenuItemResult = {
              ...queuedMenuItemBatch,
              acceptedIds: queueMerge.results.menuItems.acceptedIds,
              duplicateIds: Array.from(
                new Set([
                  ...queuedMenuItemBatch.duplicateIds,
                  ...queueMerge.results.menuItems.duplicateIds,
                ]),
              ),
              droppedCount:
                queuedMenuItemBatch.droppedCount +
                queueMerge.results.menuItems.droppedCount,
              droppedIds: Array.from(
                new Set([
                  ...queuedMenuItemBatch.droppedIds,
                  ...queueMerge.results.menuItems.droppedIds,
                ]),
              ),
            };
            queuedScheduleItemResult = {
              ...queuedScheduleItemBatch,
              acceptedIds: queueMerge.results.scheduleItems.acceptedIds,
              duplicateIds: Array.from(
                new Set([
                  ...queuedScheduleItemBatch.duplicateIds,
                  ...queueMerge.results.scheduleItems.duplicateIds,
                ]),
              ),
              droppedCount:
                queuedScheduleItemBatch.droppedCount +
                queueMerge.results.scheduleItems.droppedCount,
              droppedIds: Array.from(
                new Set([
                  ...queuedScheduleItemBatch.droppedIds,
                  ...queueMerge.results.scheduleItems.droppedIds,
                ]),
              ),
            };
            sourceNoteResult = {
              ...sourceNoteBatch,
              acceptedIds: queueMerge.results.sourceNotes.acceptedIds,
              duplicateIds: Array.from(
                new Set([
                  ...sourceNoteBatch.duplicateIds,
                  ...queueMerge.results.sourceNotes.duplicateIds,
                ]),
              ),
              droppedCount:
                sourceNoteBatch.droppedCount +
                queueMerge.results.sourceNotes.droppedCount,
              droppedIds: Array.from(
                new Set([
                  ...sourceNoteBatch.droppedIds,
                  ...queueMerge.results.sourceNotes.droppedIds,
                ]),
              ),
            };
            missingInfoResult = {
              ...missingInfoBatch,
              acceptedIds: queueMerge.results.missingInfo.acceptedIds,
              duplicateIds: Array.from(
                new Set([
                  ...missingInfoBatch.duplicateIds,
                  ...queueMerge.results.missingInfo.duplicateIds,
                ]),
              ),
              droppedCount:
                missingInfoBatch.droppedCount +
                queueMerge.results.missingInfo.droppedCount,
              droppedIds: Array.from(
                new Set([
                  ...missingInfoBatch.droppedIds,
                  ...queueMerge.results.missingInfo.droppedIds,
                ]),
              ),
            };
            reviewQueueResult = queueMerge.results.reviewQueue;
            uploadedEvidenceResult = queueMerge.results.uploadedEvidence;
            galleryEntryResult = queueMerge.results.galleryEntries;
            queueAcceptedCount =
              ownerReviewProposalResult.acceptedIds.length +
              queuedMenuItemResult.acceptedIds.length +
              queuedScheduleItemResult.acceptedIds.length +
              sourceNoteResult.acceptedIds.length +
              missingInfoResult.acceptedIds.length +
              reviewQueueResult.acceptedIds.length +
              uploadedEvidenceResult.acceptedIds.length +
              galleryEntryResult.acceptedIds.length;
            const completedEvidenceApply =
              queueMerge.container.evidenceApply &&
              typeof queueMerge.container.evidenceApply === "object"
                ? (queueMerge.container.evidenceApply as Record<string, any>)
                : {};
            const completedIntakeRequests =
              compactProfileEvidenceIntakeRequests(
                completedEvidenceApply.intakeRequests,
              ) as Record<string, any>;
            const nextIntakeRequests = compactProfileEvidenceIntakeRequests({
              ...completedIntakeRequests,
              [intakeRequestId]: {
                fingerprint: queueRequestFingerprint,
                status: "completed",
                startedAt:
                  completedIntakeRequests[intakeRequestId]?.startedAt ||
                  new Date().toISOString(),
                completedAt: new Date().toISOString(),
                requestedByUserId: String(req.user?.id || "").slice(0, 200),
                result: {
                  acceptedCount: queueAcceptedCount,
                  ownerReviewAcceptedCount:
                    ownerReviewProposalResult.acceptedIds.length,
                  evidenceBacklogAcceptedCount: Math.max(
                    0,
                    queueAcceptedCount -
                      ownerReviewProposalResult.acceptedIds.length,
                  ),
                  proposalAcceptedCount:
                    ownerReviewProposalResult.acceptedIds.length,
                  menuAcceptedCount: queuedMenuItemResult.acceptedIds.length,
                  scheduleAcceptedCount:
                    queuedScheduleItemResult.acceptedIds.length,
                  sourceNoteAcceptedCount: sourceNoteResult.acceptedIds.length,
                  missingInfoAcceptedCount: missingInfoResult.acceptedIds.length,
                  reviewQueueAcceptedCount: reviewQueueResult.acceptedIds.length,
                  uploadedEvidenceAcceptedCount:
                    uploadedEvidenceResult.acceptedIds.length,
                  galleryEntryAcceptedCount:
                    galleryEntryResult.acceptedIds.length,
                },
              },
            });
            const completedSettings = {
              ...queueMerge.container,
              evidenceApply: {
                ...completedEvidenceApply,
                intakeRequests: nextIntakeRequests,
              },
            };
            await tx
              .update(restaurants)
              // Queue metadata is not a public-profile edit and must not bump
              // restaurants.updatedAt/freshness ranking.
              .set({ socialAutopostSettings: completedSettings } as any)
              .where(eq(restaurants.id, restaurantId));

            if (matchedImportListing && queueAcceptedCount > 0) {
              const [freshListing] = await tx
                .select()
                .from(truckImportListings)
                .where(eq(truckImportListings.id, matchedImportListing.id))
                .limit(1)
                .for("update");
              if (freshListing) {
                matchedImportListing = freshListing;
                const freshRawData =
                  freshListing.rawData && typeof freshListing.rawData === "object"
                    ? (freshListing.rawData as Record<string, unknown>)
                    : {};
                const queuedRawData = appendEvidence(freshRawData, false);
                const queuedListingEvidenceApply =
                  queuedRawData.evidenceApply &&
                  typeof queuedRawData.evidenceApply === "object"
                    ? (queuedRawData.evidenceApply as Record<string, unknown>)
                    : {};
                const mergedRawData = mergeProfileEvidenceQueueContainer({
                  freshContainer: freshRawData,
                  queuedEvidenceApply: queuedListingEvidenceApply,
                  reviewQueueItems,
                  uploadedEvidence: evidenceUploadsSummary,
                });
                await tx
                  .update(truckImportListings)
                  .set({ rawData: mergedRawData, updatedAt: new Date() } as any)
                  .where(eq(truckImportListings.id, freshListing.id));
              }
            }
          });
        } else if (mode === "apply") {
          if (
            matchedRestaurant &&
            (Object.keys(restaurantUpdates).length > 0 ||
              Object.keys(listingUpdates).length > 0)
          ) {
            await db.transaction(async (tx: any) => {
              const restaurantId = String(matchedRestaurant.id);
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtext(${restaurantId}))`,
              );
              const [freshRestaurant] = await tx
                .select()
                .from(restaurants)
                .where(eq(restaurants.id, restaurantId))
                .limit(1)
                .for("update");
              if (!freshRestaurant) {
                throw Object.assign(
                  new Error("Profile disappeared during direct apply"),
                  { code: "direct_apply_profile_missing" },
                );
              }
              const plannedSettings =
                restaurantUpdates.socialAutopostSettings &&
                typeof restaurantUpdates.socialAutopostSettings === "object"
                  ? (restaurantUpdates.socialAutopostSettings as Record<
                      string,
                      unknown
                    >)
                  : {};
              const freshSettings =
                freshRestaurant.socialAutopostSettings &&
                typeof freshRestaurant.socialAutopostSettings === "object"
                  ? (freshRestaurant.socialAutopostSettings as Record<
                      string,
                      unknown
                  >)
                  : {};
              const freshEvidenceContainer = appendEvidence(
                freshSettings,
                false,
              );
              const freshPlannedSettings = {
                ...plannedSettings,
                evidenceApply:
                  freshEvidenceContainer.evidenceApply &&
                  typeof freshEvidenceContainer.evidenceApply === "object"
                    ? freshEvidenceContainer.evidenceApply
                    : {},
              };
              const directUpdates: Record<string, unknown> = {};
              for (const [field, value] of Object.entries(restaurantUpdates)) {
                if (field === "socialAutopostSettings") continue;
                if (
                  field === "logoUrl"
                    ? allowLogoReplace || isBlankValue((freshRestaurant as any)[field])
                    : isBlankValue((freshRestaurant as any)[field])
                ) {
                  directUpdates[field] = value;
                }
              }
              if (Object.keys(plannedSettings).length > 0) {
                directUpdates.socialAutopostSettings =
                  mergeProfileEvidenceApplySettings({
                    freshSettings,
                    plannedSettings: freshPlannedSettings,
                    galleryEntries: queuedGalleryEntries,
                    reviewQueueItems,
                    uploadedEvidence: evidenceUploadsSummary,
                  });
              }
              if (Object.keys(directUpdates).length > 0) {
                await tx
                  .update(restaurants)
                  .set({ ...directUpdates, updatedAt: new Date() } as any)
                  .where(eq(restaurants.id, restaurantId));
              }

              if (
                matchedImportListing &&
                String(freshRestaurant.claimedFromImportId || "") ===
                  String(matchedImportListing.id) &&
                Object.keys(listingUpdates).length > 0
              ) {
                const [freshListing] = await tx
                  .select()
                  .from(truckImportListings)
                  .where(eq(truckImportListings.id, matchedImportListing.id))
                  .limit(1)
                  .for("update");
                if (freshListing) {
                  const linkedListingUpdates: Record<string, unknown> = {};
                  for (const [field, value] of Object.entries(listingUpdates)) {
                    if (field === "rawData") continue;
                    if (isBlankValue((freshListing as any)[field])) {
                      linkedListingUpdates[field] = value;
                    }
                  }
                  const freshRawData =
                    freshListing.rawData && typeof freshListing.rawData === "object"
                      ? (freshListing.rawData as Record<string, unknown>)
                      : {};
                  const plannedRawData =
                    listingUpdates.rawData &&
                    typeof listingUpdates.rawData === "object"
                      ? (listingUpdates.rawData as Record<string, unknown>)
                      : {};
                  linkedListingUpdates.rawData =
                    mergeProfileEvidenceApplySettings({
                      freshSettings: freshRawData,
                      plannedSettings: plannedRawData,
                      reviewQueueItems,
                      uploadedEvidence: evidenceUploadsSummary,
                    });
                  await tx
                    .update(truckImportListings)
                    .set({
                      ...linkedListingUpdates,
                      updatedAt: new Date(),
                    } as any)
                    .where(eq(truckImportListings.id, freshListing.id));
                }
              }
            });
          }
        }

        queueAcceptedCount =
          ownerReviewProposalResult.acceptedIds.length +
          queuedMenuItemResult.acceptedIds.length +
          queuedScheduleItemResult.acceptedIds.length +
          sourceNoteResult.acceptedIds.length +
          missingInfoResult.acceptedIds.length +
          reviewQueueResult.acceptedIds.length +
          uploadedEvidenceResult.acceptedIds.length +
          galleryEntryResult.acceptedIds.length;
        const queueCapacityDropCount =
          ownerReviewProposalResult.droppedCount +
          queuedMenuItemResult.droppedCount +
          queuedScheduleItemResult.droppedCount +
          sourceNoteResult.droppedCount +
          missingInfoResult.droppedCount +
          reviewQueueResult.droppedCount +
          uploadedEvidenceResult.droppedCount +
          galleryEntryResult.droppedCount;
        const ownerReviewAcceptedCount =
          ownerReviewProposalResult.acceptedIds.length;
        const evidenceBacklogAcceptedCount = Math.max(
          0,
          queueAcceptedCount - ownerReviewAcceptedCount,
        );
        const evidenceBacklogDropCount = Math.max(
          0,
          queueCapacityDropCount - ownerReviewProposalResult.droppedCount,
        );
        const ownerReviewRejectedCount = ownerReviewProposalResult.rejected.length;
        const evidenceBacklogRejectedCount =
          queuedMenuItemResult.rejected.length +
          queuedScheduleItemResult.rejected.length +
          sourceNoteResult.rejected.length +
          missingInfoResult.rejected.length;
        const queueBaseStatus =
          ownerReviewAcceptedCount > 0 && evidenceBacklogAcceptedCount > 0
            ? "queued_owner_review_and_admin_evidence"
            : ownerReviewAcceptedCount > 0
              ? "queued_owner_review"
              : evidenceBacklogAcceptedCount > 0
                ? "queued_admin_evidence_backlog"
                : ownerReviewRejectedCount + evidenceBacklogRejectedCount > 0
                  ? "evidence_queue_rejected"
                  : "owner_review_unchanged";
        const queueStatus =
          queueCapacityDropCount > 0
            ? queueAcceptedCount > 0
              ? `${queueBaseStatus}_partial_capacity`
              : "evidence_queue_capacity_reached"
            : queueBaseStatus;
        res.json({
          status:
            mode === "apply"
              ? "applied"
              : queuesOwnerReview
                ? queueStatus
                : "dry_run",
          existingTruckId: matchedRestaurant?.id || "",
          matchedRestaurantId: matchedRestaurant?.id || "",
          matchedImportListingId: matchedImportListing?.id || "",
          targetProfile: matchedRestaurant
            ? {
                id: String(matchedRestaurant.id),
                name: String(matchedRestaurant.name || ""),
                ownerUserId: String(matchedRestaurant.ownerId || ""),
                businessType: String(
                  matchedRestaurant.businessType ||
                    (matchedRestaurant.isFoodTruck
                      ? "food_truck"
                      : "restaurant"),
                ),
              }
            : null,
          ...(queuesOwnerReview
            ? { intakeRequestId, idempotentReplay: false }
            : {}),
          createdDraftId,
          matchStrength,
          matchedBy,
          fieldsApplied: queuesOwnerReview
            ? []
            : Array.from(new Set(fieldsApplied)),
          fieldsSkipped: Array.from(new Set(fieldsSkipped)),
          conflicts,
          menuStatus,
          scheduleStatus,
          logoStatus,
          evidenceStatus,
          menuEvidenceStatus,
          ownerReviewStatus: queuesOwnerReview
            ? ownerReviewProposalResult.droppedCount > 0 &&
              ownerReviewAcceptedCount === 0
              ? "capacity_reached"
              : ownerReviewAcceptedCount > 0
              ? "queued"
              : ownerReviewRejectedCount > 0
                ? "rejected"
              : ownerReviewProposalResult.submittedCount > 0
                ? "unchanged"
                : "not_requested"
            : "not_requested",
          evidenceBacklogStatus: queuesOwnerReview
            ? evidenceBacklogDropCount > 0
              ? evidenceBacklogAcceptedCount > 0
                ? "queued_partial_capacity"
                : "capacity_reached"
              : evidenceBacklogAcceptedCount > 0
                ? "queued"
                : evidenceBacklogRejectedCount > 0
                  ? "rejected"
                : "not_requested"
            : "not_requested",
          evidenceBacklogAcceptedCount,
          evidenceBacklogDroppedCount: evidenceBacklogDropCount,
          evidenceBacklogRejectedCount,
          proposalResults: {
            submittedCount: ownerReviewProposalResult.submittedCount,
            acceptedCount: ownerReviewProposalResult.acceptedIds.length,
            acceptedIds: ownerReviewProposalResult.acceptedIds,
            duplicateCount: ownerReviewProposalResult.duplicateIds.length,
            duplicateIds: ownerReviewProposalResult.duplicateIds,
            rejectedCount: ownerReviewProposalResult.rejected.length,
            rejectedIds: ownerReviewProposalResult.rejected.map(
              (item) => item.id,
            ),
            rejected: ownerReviewProposalResult.rejected,
            droppedCount: ownerReviewProposalResult.droppedCount,
            droppedIds: ownerReviewProposalResult.droppedIds,
            droppedIdsTruncated:
              ownerReviewProposalResult.droppedCount >
              ownerReviewProposalResult.droppedIds.length,
          },
          queuedMenuItemResults: {
            submittedCount: Array.isArray(requestBody?.menuItems)
              ? requestBody.menuItems.length
              : 0,
            acceptedCount: queuedMenuItemResult.acceptedIds.length,
            acceptedIds: queuedMenuItemResult.acceptedIds,
            duplicateCount: queuedMenuItemResult.duplicateIds.length,
            duplicateIds: queuedMenuItemResult.duplicateIds,
            rejectedCount: queuedMenuItemResult.rejected.length,
            rejectedIds: queuedMenuItemResult.rejected.map((item) => item.id),
            rejected: queuedMenuItemResult.rejected,
            droppedCount: queuedMenuItemResult.droppedCount,
            droppedIds: queuedMenuItemResult.droppedIds,
            droppedIdsTruncated:
              queuedMenuItemResult.droppedCount >
              queuedMenuItemResult.droppedIds.length,
          },
          queuedScheduleItemResults: {
            submittedCount: Array.isArray(requestBody?.scheduleItems)
              ? requestBody.scheduleItems.length
              : 0,
            acceptedCount: queuedScheduleItemResult.acceptedIds.length,
            acceptedIds: queuedScheduleItemResult.acceptedIds,
            duplicateCount: queuedScheduleItemResult.duplicateIds.length,
            duplicateIds: queuedScheduleItemResult.duplicateIds,
            rejectedCount: queuedScheduleItemResult.rejected.length,
            rejectedIds: queuedScheduleItemResult.rejected.map(
              (item) => item.id,
            ),
            rejected: queuedScheduleItemResult.rejected,
            droppedCount: queuedScheduleItemResult.droppedCount,
            droppedIds: queuedScheduleItemResult.droppedIds,
            droppedIdsTruncated:
              queuedScheduleItemResult.droppedCount >
              queuedScheduleItemResult.droppedIds.length,
          },
          sourceNoteResults: {
            submittedCount: Array.isArray(requestBody?.sourceNotes)
              ? requestBody.sourceNotes.length
              : 0,
            acceptedCount: sourceNoteResult.acceptedIds.length,
            acceptedIds: sourceNoteResult.acceptedIds,
            duplicateCount: sourceNoteResult.duplicateIds.length,
            duplicateIds: sourceNoteResult.duplicateIds,
            rejectedCount: sourceNoteResult.rejected.length,
            rejectedIds: sourceNoteResult.rejected.map((item) => item.id),
            rejected: sourceNoteResult.rejected,
            droppedCount: sourceNoteResult.droppedCount,
            droppedIds: sourceNoteResult.droppedIds,
          },
          missingInfoResults: {
            submittedCount: Array.isArray(requestBody?.missingInfo)
              ? requestBody.missingInfo.length
              : 0,
            acceptedCount: missingInfoResult.acceptedIds.length,
            acceptedIds: missingInfoResult.acceptedIds,
            duplicateCount: missingInfoResult.duplicateIds.length,
            duplicateIds: missingInfoResult.duplicateIds,
            rejectedCount: missingInfoResult.rejected.length,
            rejectedIds: missingInfoResult.rejected.map((item) => item.id),
            rejected: missingInfoResult.rejected,
            droppedCount: missingInfoResult.droppedCount,
            droppedIds: missingInfoResult.droppedIds,
          },
          reviewQueueResults: {
            submittedCount: reviewQueueItems.length,
            acceptedCount: reviewQueueResult.acceptedIds.length,
            acceptedIds: reviewQueueResult.acceptedIds,
            duplicateCount: reviewQueueResult.duplicateIds.length,
            duplicateIds: reviewQueueResult.duplicateIds,
            droppedCount: reviewQueueResult.droppedCount,
            droppedIds: reviewQueueResult.droppedIds,
          },
          uploadedEvidenceResults: {
            submittedCount: evidenceUploadsSummary.length,
            acceptedCount: uploadedEvidenceResult.acceptedIds.length,
            acceptedIds: uploadedEvidenceResult.acceptedIds,
            duplicateCount: uploadedEvidenceResult.duplicateIds.length,
            duplicateIds: uploadedEvidenceResult.duplicateIds,
            droppedCount: uploadedEvidenceResult.droppedCount,
            droppedIds: uploadedEvidenceResult.droppedIds,
          },
          galleryEntryResults: {
            submittedCount: queuedGalleryEntries.length,
            acceptedCount: galleryEntryResult.acceptedIds.length,
            acceptedIds: galleryEntryResult.acceptedIds,
            duplicateCount: galleryEntryResult.duplicateIds.length,
            duplicateIds: galleryEntryResult.duplicateIds,
            droppedCount: galleryEntryResult.droppedCount,
            droppedIds: galleryEntryResult.droppedIds,
          },
          reviewQueueItems,
          uploadedEvidence: evidenceUploadsSummary,
          missingInfo,
          sourceNotes,
          debug: buildDebug({
            classification:
              mode === "apply"
                ? "apply"
                : queuesOwnerReview
                  ? "queue_owner_review"
                : matchedRestaurant || matchedImportListing
                  ? "update_existing"
                  : createdDraftId
                    ? "create_draft"
                    : "needs_review",
            classificationReasons: [
              matchedRestaurant || matchedImportListing
                ? "existing_match_found"
                : createdDraftId
                  ? "draft_created"
                  : "no_match",
              mode === "apply"
                ? "apply_mode"
                : queuesOwnerReview
                  ? "queue_owner_review_mode"
                  : "dry_run_mode",
            ],
          }),
        });
      } catch (error: any) {
        if (reservedQueueRequest) {
          try {
            await db.transaction(async (tx: any) => {
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtext(${reservedQueueRequest!.restaurantId}))`,
              );
              const [freshRestaurant] = await tx
                .select()
                .from(restaurants)
                .where(eq(restaurants.id, reservedQueueRequest!.restaurantId))
                .limit(1)
                .for("update");
              if (!freshRestaurant) return;
              const settings =
                freshRestaurant.socialAutopostSettings &&
                typeof freshRestaurant.socialAutopostSettings === "object"
                  ? (freshRestaurant.socialAutopostSettings as Record<
                      string,
                      any
                    >)
                  : {};
              const evidenceApply =
                settings.evidenceApply &&
                typeof settings.evidenceApply === "object"
                  ? (settings.evidenceApply as Record<string, any>)
                  : {};
              const intakeRequests = compactProfileEvidenceIntakeRequests(
                evidenceApply.intakeRequests,
              ) as Record<string, any>;
              const current = intakeRequests[reservedQueueRequest!.intakeRequestId];
              if (
                current?.status !== "in_progress" ||
                current?.fingerprint !== reservedQueueRequest!.fingerprint
              ) {
                return;
              }
              await tx
                .update(restaurants)
                .set({
                  socialAutopostSettings: {
                    ...settings,
                    evidenceApply: {
                      ...evidenceApply,
                      intakeRequests: compactProfileEvidenceIntakeRequests({
                        ...intakeRequests,
                        [reservedQueueRequest!.intakeRequestId]: {
                          ...current,
                          status: "failed",
                          failedAt: new Date().toISOString(),
                        },
                      }),
                    },
                  },
                } as any)
                .where(eq(restaurants.id, reservedQueueRequest!.restaurantId));
            });
          } catch {
            // Best effort only; never log the evidence-bearing DB error.
          }
        }
        const safeErrorName =
          typeof error?.name === "string" ? error.name.slice(0, 80) : "Error";
        const safeErrorCode =
          typeof error?.code === "string" ? error.code.slice(0, 80) : "unknown";
        const requestProfileId = String(
          req.body?.existingProfileId || req.body?.match?.profileId || "",
        )
          .trim()
          .slice(0, 200);
        console.error("Profile evidence write failed", {
          errorName: safeErrorName,
          errorCode: safeErrorCode,
          requestProfileId,
          requestUserId: String(req.user?.id || "").slice(0, 200),
        });
        const isProfileConflict =
          safeErrorCode === "owner_review_profile_missing" ||
          safeErrorCode === "existing_profile_owner_mismatch";
        res.status(isProfileConflict ? 409 : 500).json({
          message:
            safeErrorCode === "existing_profile_owner_mismatch"
              ? "The profile owner changed during intake. Run a new dry check before queueing evidence."
              : "Failed to apply profile evidence",
          code: isProfileConflict
            ? safeErrorCode
            : "profile_evidence_write_failed",
        });
      }
    },
  );

  app.post(
    "/api/admin/truck-import-listings/:id/fill-missing-from-evidence",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = String(req.params.id || "").trim();
        if (!listingId) {
          return res.status(400).json({ message: "Listing ID is required" });
        }

        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, listingId))
          .limit(1);
        if (!listing) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        const [restaurant] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.claimedFromImportId, listingId))
          .limit(1);
        if (!restaurant) {
          return res.status(409).json({
            message:
              "No seeded restaurant is linked to this import listing. Refusing to create a duplicate.",
          });
        }

        const fill = (req.body?.fill_if_blank || {}) as Record<string, unknown>;
        const descriptionCandidate = String(
          req.body?.suggested_description_only_if_blank || "",
        ).trim();
        const sourceNotes = String(req.body?.source_notes || "").trim();
        const missingInfo = Array.isArray(req.body?.missing_info)
          ? req.body.missing_info
              .map((v: any) => String(v || "").trim())
              .filter(Boolean)
          : [];
        const menuItems = Array.isArray(req.body?.menu_items)
          ? req.body.menu_items
              .map((item: any) => ({
                section: String(item?.section || "").trim() || null,
                item_name: String(item?.item_name || "").trim() || null,
                description: String(item?.description || "").trim() || null,
                price: String(item?.price || "").trim() || null,
                confidence: String(item?.confidence || "").trim() || null,
              }))
              .filter((item: any) => item.item_name)
          : [];
        const scheduleNotes = Array.isArray(req.body?.schedule_notes)
          ? req.body.schedule_notes
              .map((note: any) => ({
                text: String(note?.text || "").trim() || null,
                confidence: String(note?.confidence || "").trim() || null,
                source: String(note?.source || "").trim() || null,
              }))
              .filter((note: any) => note.text)
          : [];

        const listingUpdates: Record<string, unknown> = {};
        const restaurantUpdates: Record<string, unknown> = {};
        const fieldsFilled: string[] = [];
        const fieldsSkipped: string[] = [];
        const conflicts: Array<{
          field: string;
          existing: unknown;
          incoming: unknown;
        }> = [];

        const protectedFieldSet = new Set([
          "description",
          "menu",
          "schedule",
          "logoUrl",
          "photos",
          "booking_available",
          "catering_available",
        ]);

        const candidates: Array<{
          evidenceField: string;
          listingField?: string;
          restaurantField?: string;
          value: unknown;
          transform?: (input: unknown) => unknown;
        }> = [
          {
            evidenceField: "business_type",
            restaurantField: "businessType",
            value: fill.business_type,
          },
          {
            evidenceField: "category",
            listingField: "cuisineType",
            restaurantField: "cuisineType",
            value: fill.category,
          },
          {
            evidenceField: "phone",
            listingField: "phone",
            restaurantField: "phone",
            value: fill.phone,
          },
          {
            evidenceField: "email",
            listingField: "email",
            value: fill.email,
            transform: (v) =>
              String(v || "")
                .trim()
                .toLowerCase(),
          },
          {
            evidenceField: "website",
            listingField: "websiteUrl",
            restaurantField: "websiteUrl",
            value: fill.website,
            transform: (v) => toUrl(v),
          },
          {
            evidenceField: "facebook",
            listingField: "facebookPageUrl",
            restaurantField: "facebookPageUrl",
            value: fill.facebook,
            transform: (v) => toUrl(v, "facebook.com"),
          },
          {
            evidenceField: "instagram",
            listingField: "instagramUrl",
            restaurantField: "instagramUrl",
            value: fill.instagram,
            transform: (v) => toUrl(v, "instagram.com"),
          },
          {
            evidenceField: "city",
            listingField: "city",
            restaurantField: "city",
            value: fill.city,
          },
          {
            evidenceField: "state",
            listingField: "state",
            restaurantField: "state",
            value: fill.state,
          },
        ];

        for (const candidate of candidates) {
          if (protectedFieldSet.has(candidate.evidenceField)) {
            fieldsSkipped.push(candidate.evidenceField);
            continue;
          }
          const rawValue = candidate.transform
            ? candidate.transform(candidate.value)
            : candidate.value;
          if (isBlankValue(rawValue)) continue;

          if (candidate.listingField) {
            const existing = (listing as any)[candidate.listingField];
            if (isBlankValue(existing)) {
              listingUpdates[candidate.listingField] = rawValue;
              fieldsFilled.push(candidate.listingField);
            } else if (
              normalizeComparable(existing) !== normalizeComparable(rawValue)
            ) {
              conflicts.push({
                field: `listing.${candidate.listingField}`,
                existing,
                incoming: rawValue,
              });
              fieldsSkipped.push(candidate.listingField);
            } else {
              fieldsSkipped.push(candidate.listingField);
            }
          }

          if (candidate.restaurantField) {
            const existing = (restaurant as any)[candidate.restaurantField];
            if (isBlankValue(existing)) {
              restaurantUpdates[candidate.restaurantField] = rawValue;
              fieldsFilled.push(candidate.restaurantField);
            } else if (
              normalizeComparable(existing) !== normalizeComparable(rawValue)
            ) {
              conflicts.push({
                field: `restaurant.${candidate.restaurantField}`,
                existing,
                incoming: rawValue,
              });
              fieldsSkipped.push(candidate.restaurantField);
            } else {
              fieldsSkipped.push(candidate.restaurantField);
            }
          }
        }

        if (descriptionCandidate) {
          if (isBlankValue(restaurant.description)) {
            restaurantUpdates.description = descriptionCandidate;
            fieldsFilled.push("description");
          } else {
            if (
              normalizeComparable(restaurant.description) !==
              normalizeComparable(descriptionCandidate)
            ) {
              conflicts.push({
                field: "restaurant.description",
                existing: restaurant.description,
                incoming: descriptionCandidate,
              });
            }
            fieldsSkipped.push("description");
          }
        }

        const safeEvidenceFields = {
          service_area: String(fill.service_area || "").trim() || null,
          location_text: String(fill.location_text || "").trim() || null,
          price_range: String(fill.price_range || "").trim() || null,
          hours: String(fill.hours || "").trim() || null,
          contact_method: String(req.body?.contact_method || "").trim() || null,
          followers_note: String(req.body?.followers_note || "").trim() || null,
          review_note: String(req.body?.review_note || "").trim() || null,
          source_notes: sourceNotes || null,
          missing_info: missingInfo,
          confidence: String(req.body?.confidence || "").trim() || null,
          menu_candidates: menuItems,
          schedule_notes: scheduleNotes,
        };
        const rawDataNext = {
          ...(((listing.rawData as Record<string, unknown>) || {}) as Record<
            string,
            unknown
          >),
          evidenceUpdate: {
            ...(typeof (listing.rawData as any)?.evidenceUpdate === "object"
              ? ((listing.rawData as any).evidenceUpdate as Record<
                  string,
                  unknown
                >)
              : {}),
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user?.id || null,
            safeEvidenceFields,
          },
        };
        listingUpdates.rawData = rawDataNext;

        if (Object.keys(listingUpdates).length > 0) {
          await db
            .update(truckImportListings)
            .set({ ...listingUpdates, updatedAt: new Date() })
            .where(eq(truckImportListings.id, listingId));
        }
        if (Object.keys(restaurantUpdates).length > 0) {
          await db
            .update(restaurants)
            .set({ ...restaurantUpdates, updatedAt: new Date() })
            .where(eq(restaurants.id, restaurant.id));
        }

        const logoAction = isBlankValue(restaurant.logoUrl)
          ? "missing_upload_required"
          : "skipped_existing_logo";

        res.json({
          matchedImportListingId: listing.id,
          matchedRestaurantId: restaurant.id,
          fieldsFilled: Array.from(new Set(fieldsFilled)),
          fieldsSkipped: Array.from(new Set(fieldsSkipped)),
          conflicts,
          protectedFieldsNeverOverwritten: [
            "description_unless_blank",
            "menu",
            "schedule",
            "logo_unless_blank",
            "photos",
            "booking_available",
            "catering_available",
          ],
          logo: {
            action: logoAction,
            uploadRoute: "/api/upload/restaurant-logo",
          },
          menu: {
            action: menuItems.length > 0 ? "queued_for_review" : "none",
            queuedCount: menuItems.length,
          },
          schedule: {
            action:
              scheduleNotes.length > 0 ? "note_only_no_rows_created" : "none",
            queuedCount: scheduleNotes.length,
          },
          remainingMissingInfo: missingInfo,
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error(
          "Error filling missing listing fields from evidence:",
          error,
        );
        res.status(500).json({ message: "Failed to apply evidence update" });
      }
    },
  );

  app.post(
    "/api/admin/claim-pitches",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = String(req.body?.listingId || "").trim();
        const source =
          String(req.body?.source || "admin_inventory").trim() ||
          "admin_inventory";
        if (!listingId) {
          return res.status(400).json({ message: "listingId is required" });
        }

        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, listingId))
          .limit(1);
        if (!listing) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        const profileType = "truck";
        const profileId = String(listing.id);
        const businessName =
          String(listing.name || "").trim() || "Unnamed truck";
        const city = String(listing.city || "").trim() || null;
        const claimUrl = `${resolvePublicBaseUrl()}/claim-business?q=${encodeURIComponent(
          String(listing.externalId || businessName),
        )}`;
        const pitchCreatedAt = new Date().toISOString();
        const existingRaw =
          listing && typeof listing.rawData === "object" && listing.rawData
            ? (listing.rawData as Record<string, any>)
            : {};
        const priorPitch =
          existingRaw &&
          typeof existingRaw.claimPitch === "object" &&
          existingRaw.claimPitch
            ? (existingRaw.claimPitch as Record<string, any>)
            : {};

        const claimPitch = {
          profileId,
          profileType,
          businessName,
          city,
          claimUrl,
          pitchStatus: "created",
          pitchCreatedAt,
          pitchOpenedAt: priorPitch.pitchOpenedAt || null,
          sentAt: priorPitch.sentAt || null,
          lastSentAt: priorPitch.lastSentAt || null,
          sendCount: Number(priorPitch.sendCount || 0),
          sentChannel: priorPitch.sentChannel || null,
          sentByUserId: priorPitch.sentByUserId || null,
          claimStartedAt: priorPitch.claimStartedAt || null,
          claimCompletedAt: priorPitch.claimCompletedAt || null,
          source,
          createdByUserId: String(req.user?.id || ""),
          pitchMessage:
            "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
        };
        const sharePack = buildClaimPitchSharePack(listing, claimPitch);

        const [updated] = await db
          .update(truckImportListings)
          .set({
            rawData: {
              ...existingRaw,
              claimPitch,
            },
            updatedAt: new Date(),
          } as any)
          .where(eq(truckImportListings.id, listingId))
          .returning();

        return res.json({
          listingId,
          claimPitch: {
            ...extractClaimPitch(updated),
            ...sharePack,
          },
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error creating claim pitch:", error);
        return res
          .status(500)
          .json({ message: "Failed to create claim pitch" });
      }
    },
  );

  app.patch(
    "/api/admin/claim-pitches/:listingId/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();
        const listingId = String(req.params?.listingId || "").trim();
        const status = String(req.body?.status || "")
          .trim()
          .toLowerCase();
        const sentChannel = String(req.body?.sentChannel || "")
          .trim()
          .toLowerCase();
        const allowedStatuses = new Set([
          "sent",
          "opened",
          "claim_started",
          "claim_completed",
        ]);
        const allowedSentChannels = new Set([
          "sms",
          "email",
          "facebook",
          "instagram",
          "manual",
          "other",
        ]);
        if (!listingId || !allowedStatuses.has(status)) {
          return res
            .status(400)
            .json({ message: "Invalid listingId or status" });
        }
        if (status === "sent" && !allowedSentChannels.has(sentChannel)) {
          return res.status(400).json({ message: "Invalid sentChannel" });
        }

        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, listingId))
          .limit(1);
        if (!listing) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        const existingRaw =
          listing && typeof listing.rawData === "object" && listing.rawData
            ? (listing.rawData as Record<string, any>)
            : {};
        const currentPitch =
          existingRaw &&
          typeof existingRaw.claimPitch === "object" &&
          existingRaw.claimPitch
            ? (existingRaw.claimPitch as Record<string, any>)
            : null;
        if (!currentPitch) {
          return res.status(404).json({ message: "Claim pitch not found" });
        }

        const nowIso = new Date().toISOString();
        const nextPitch = {
          ...currentPitch,
          pitchStatus:
            status === "sent"
              ? "sent"
              : status === "opened"
                ? "opened"
                : status === "claim_started"
                  ? "claim_started"
                  : "claim_completed",
          sentAt:
            status === "sent"
              ? currentPitch.sentAt || nowIso
              : currentPitch.sentAt || null,
          lastSentAt:
            status === "sent" ? nowIso : currentPitch.lastSentAt || null,
          sendCount:
            status === "sent"
              ? Math.max(1, Number(currentPitch.sendCount || 0) + 1)
              : Math.max(0, Number(currentPitch.sendCount || 0)),
          sentChannel:
            status === "sent" ? sentChannel : currentPitch.sentChannel || null,
          sentByUserId:
            status === "sent"
              ? String(req.user?.id || "")
              : currentPitch.sentByUserId || null,
          pitchOpenedAt:
            status === "opened"
              ? currentPitch.pitchOpenedAt || nowIso
              : currentPitch.pitchOpenedAt || null,
          claimStartedAt:
            status === "claim_started"
              ? currentPitch.claimStartedAt || nowIso
              : currentPitch.claimStartedAt || null,
          claimCompletedAt:
            status === "claim_completed"
              ? currentPitch.claimCompletedAt || nowIso
              : currentPitch.claimCompletedAt || null,
          lastStatusUpdatedByUserId: String(req.user?.id || ""),
          lastStatusUpdatedAt: nowIso,
        };
        const sharePack = buildClaimPitchSharePack(listing, nextPitch);

        const [updated] = await db
          .update(truckImportListings)
          .set({
            rawData: {
              ...existingRaw,
              claimPitch: nextPitch,
            },
            updatedAt: new Date(),
          } as any)
          .where(eq(truckImportListings.id, listingId))
          .returning();

        return res.json({
          listingId,
          claimPitch: {
            ...extractClaimPitch(updated),
            ...sharePack,
          },
        });
      } catch (error: any) {
        console.error("Error updating claim pitch status:", error);
        return res
          .status(500)
          .json({ message: "Failed to update claim pitch status" });
      }
    },
  );

  app.get(
    "/api/admin/claim-pitches",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query?.limit ?? 100)),
        );
        const rows = await db
          .select()
          .from(truckImportListings)
          .where(sql`${truckImportListings.rawData} ? 'claimPitch'`)
          .orderBy(desc(truckImportListings.updatedAt))
          .limit(limit);

        const items = rows
          .map((listing: any) => {
            const claimPitch = extractClaimPitch(listing);
            if (!claimPitch) return null;
            return {
              listingId: String(listing.id),
              profileId: claimPitch.profileId || String(listing.id),
              profileType: claimPitch.profileType || "truck",
              businessName:
                claimPitch.businessName || String(listing.name || ""),
              city: claimPitch.city || String(listing.city || ""),
              claimUrl: claimPitch.claimUrl || null,
              pitchStatus: claimPitch.pitchStatus || "created",
              pitchCreatedAt: claimPitch.pitchCreatedAt || null,
              sentAt: claimPitch.sentAt || null,
              lastSentAt: claimPitch.lastSentAt || null,
              sendCount: Number(claimPitch.sendCount || 0),
              sentChannel: claimPitch.sentChannel || null,
              sentByUserId: claimPitch.sentByUserId || null,
              pitchOpenedAt: claimPitch.pitchOpenedAt || null,
              claimStartedAt: claimPitch.claimStartedAt || null,
              claimCompletedAt: claimPitch.claimCompletedAt || null,
              source: claimPitch.source || null,
              createdByUserId: claimPitch.createdByUserId || null,
              ...buildClaimPitchSharePack(listing, claimPitch),
            };
          })
          .filter(Boolean);

        return res.json({ items });
      } catch (error: any) {
        console.error("Error listing claim pitches:", error);
        return res
          .status(500)
          .json({ message: "Failed to load claim pitches" });
      }
    },
  );

  app.post(
    "/api/admin/truck-import-listings/:id/invite",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = req.params.id;
        const email = String(req.body?.email || "")
          .trim()
          .toLowerCase();
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, listingId))
          .limit(1);
        if (!listing) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        const importSystemUserId = await getOrCreateImportSystemUserId();

        const existingUser = await storage.getUserByEmail(email);
        const inviteUser =
          existingUser ??
          (await storage.createUserInvite({
            email,
            firstName: null,
            lastName: null,
            phone: null,
            userType: "food_truck",
          }));

        // Ensure there is a seeded restaurant for this listing.
        const [restaurant] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.claimedFromImportId, listingId))
          .limit(1);

        if (restaurant) {
          const transfer = await db.transaction(async (tx: any) => {
            const safety = await lockRestaurantForOwnerTransfer(tx, {
              restaurantId: restaurant.id,
              nextOwnerId: inviteUser.id,
            });
            if (safety.outcome !== "ready") return safety;
            const currentOwnerId = String(safety.restaurant.ownerId || "");
            const inviteAction = resolveRestaurantOwnershipInviteAction({
              currentOwnerId,
              importSystemUserId,
              inviteUserId: inviteUser.id,
            });
            if (inviteAction === "conflict") {
              return { outcome: "owned" } as const;
            }
            if (inviteAction === "idempotent") {
              return { outcome: "unchanged" } as const;
            }
            await tx
              .update(restaurants)
              .set({
                ownerId: inviteUser.id,
                isActive: false,
                isVerified: false,
                ...buildRestaurantOwnerTransferReset(),
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, restaurant.id));
            return { outcome: "updated" } as const;
          });
          if (transfer.outcome === "active_order") {
            return res.status(409).json({
              code: "ACTIVE_ORDER_HANDOFF_REQUIRED",
              message:
                "This truck has an unresolved customer order. Finish that order before sending an ownership invite.",
              orderId: transfer.orderId,
              orderStatus: transfer.orderStatus,
            });
          }
          if (transfer.outcome === "missing") {
            return res.status(409).json({
              message:
                "This truck profile changed before the invite could be saved. Refresh and retry.",
            });
          }
          if (transfer.outcome === "owned") {
            return res.status(409).json({
              message:
                "This truck is already owned by another account. Refusing to reassign ownership.",
            });
          }
        } else {
          await db.insert(restaurants).values({
            ownerId: inviteUser.id,
            name: listing.name,
            address: listing.address,
            phone: listing.phone,
            businessType: "food_truck",
            cuisineType: listing.cuisineType,
            city: listing.city,
            state: listing.state,
            websiteUrl: listing.websiteUrl,
            instagramUrl: listing.instagramUrl,
            facebookPageUrl: listing.facebookPageUrl,
            latitude: listing.latitude,
            longitude: listing.longitude,
            isFoodTruck: true,
            isActive: false,
            isVerified: false,
            claimedFromImportId: listing.id,
          } as any);
        }

        const [updated] = await db
          .update(truckImportListings)
          .set({
            email,
            invitedUserId: inviteUser.id,
            lastInviteSentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(truckImportListings.id, listingId))
          .returning();

        const inviteResult = await sendAccountSetupInvite({
          user: inviteUser,
          createdBy: req.user,
          req,
          setupPath: "/owner/verify",
        });
        await recordListingInviteEvidence(listingId, {
          invitedUserId: inviteUser.id,
          inviteEmail: email,
          emailSent: inviteResult.emailSent,
          source: "manual_invite",
          invitedAt: new Date().toISOString(),
        });

        res.json({
          success: true,
          emailSent: inviteResult.emailSent,
          listing: updated,
        });
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_listings") ||
          isMissingRelationError(error, "truck_import_batches")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error sending import invite:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to send invite" });
      }
    },
  );

  app.post(
    "/api/admin/truck-imports",
    isAuthenticated,
    isStaffOrAdmin,
    truckImportUploadSingle,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "File is required" });
        }

        const source = String(req.body?.source || "").trim() || null;
        const { rows, headers } = await parseTruckImportFile(
          file.buffer,
          file.originalname || "import.csv",
        );

        const [batch] = await db
          .insert(truckImportBatches)
          .values({
            source,
            fileName: file.originalname || "import.csv",
            uploadedBy: req.user?.id,
            totalRows: rows.length,
          })
          .returning();

        let importedRows = 0;
        let missingRows = 0;
        let duplicateRows = 0;
        let seededRestaurants = 0;

        const listingsToInsert: Array<typeof truckImportListings.$inferInsert> =
          [];
        const seenKeys = new Set<string>();

        const normalize = (value: any) =>
          String(value || "")
            .trim()
            .toLowerCase();
        const normalizePhone = (value: any) =>
          String(value || "")
            .replace(/[^\d]/g, "")
            .trim();
        const nameAddressKey = (name: string, address: string) =>
          `${normalize(name)}|${normalize(address)}`;

        const candidateExternalIds = new Set<string>();
        const candidateEmails = new Set<string>();
        const candidateNameAddressKeys = new Set<string>();

        for (const row of rows) {
          const name = row.name?.trim() || "";
          const address = row.address?.trim() || "";
          const externalId = row.externalId?.trim() || "";
          const email = row.email?.trim()?.toLowerCase() || "";
          if (externalId) candidateExternalIds.add(externalId.toLowerCase());
          if (email) candidateEmails.add(email.toLowerCase());
          if (name && address)
            candidateNameAddressKeys.add(nameAddressKey(name, address));
        }

        const extList = Array.from(candidateExternalIds);
        const emailList = Array.from(candidateEmails);
        const nameList = Array.from(
          new Set(
            Array.from(candidateNameAddressKeys).map(
              (key) => key.split("|")[0],
            ),
          ),
        );
        const addressList = Array.from(
          new Set(
            Array.from(candidateNameAddressKeys).map(
              (key) => key.split("|")[1],
            ),
          ),
        );

        const existingImportRows =
          extList.length ||
          emailList.length ||
          (nameList.length && addressList.length)
            ? await db
                .select({
                  externalId: truckImportListings.externalId,
                  email: truckImportListings.email,
                  name: truckImportListings.name,
                  address: truckImportListings.address,
                  city: truckImportListings.city,
                  state: truckImportListings.state,
                  phone: truckImportListings.phone,
                })
                .from(truckImportListings)
                .where(
                  or(
                    extList.length
                      ? inArray(truckImportListings.externalId, extList)
                      : sql`false`,
                    emailList.length
                      ? inArray(truckImportListings.email, emailList)
                      : sql`false`,
                    nameList.length && addressList.length
                      ? and(
                          inArray(
                            sql`lower(${truckImportListings.name})` as any,
                            nameList,
                          ),
                          inArray(
                            sql`lower(${truckImportListings.address})` as any,
                            addressList,
                          ),
                        )
                      : sql`false`,
                  ),
                )
            : [];

        const existingRestaurantRows =
          nameList.length && addressList.length
            ? await db
                .select({
                  name: restaurants.name,
                  address: restaurants.address,
                  city: restaurants.city,
                  state: restaurants.state,
                  phone: restaurants.phone,
                })
                .from(restaurants)
                .where(
                  and(
                    or(
                      eq(restaurants.businessType, "food_truck"),
                      eq(restaurants.isFoodTruck, true),
                    ),
                    inArray(sql`lower(${restaurants.name})` as any, nameList),
                    inArray(
                      sql`lower(${restaurants.address})` as any,
                      addressList,
                    ),
                  ),
                )
            : [];

        const existingExternalIdSet = new Set(
          existingImportRows
            .map((row: any) => normalize(row.externalId))
            .filter((value: string) => value.length > 0),
        );
        const existingEmailSet = new Set(
          existingImportRows
            .map((row: any) => normalize(row.email))
            .filter((value: string) => value.length > 0),
        );
        const existingNameAddressSet = new Set<string>();
        const existingNameCityStateAddressSet = new Set<string>();
        const existingNameCityStatePhoneSet = new Set<string>();
        existingImportRows.forEach((row: any) => {
          const name = normalize(row.name);
          const address = normalize(row.address);
          const city = normalize(row.city);
          const state = normalize(row.state);
          const phone = normalizePhone(row.phone);
          if (name && address) existingNameAddressSet.add(`${name}|${address}`);
          if (name && city && state && address) {
            existingNameCityStateAddressSet.add(
              `${name}|${city}|${state}|${address}`,
            );
          }
          if (name && city && state && phone) {
            existingNameCityStatePhoneSet.add(
              `${name}|${city}|${state}|${phone}`,
            );
          }
        });
        existingRestaurantRows.forEach((row: any) => {
          const name = normalize(row.name);
          const address = normalize(row.address);
          const city = normalize(row.city);
          const state = normalize(row.state);
          const phone = normalizePhone(row.phone);
          if (name && address) existingNameAddressSet.add(`${name}|${address}`);
          if (name && city && state && address) {
            existingNameCityStateAddressSet.add(
              `${name}|${city}|${state}|${address}`,
            );
          }
          if (name && city && state && phone) {
            existingNameCityStatePhoneSet.add(
              `${name}|${city}|${state}|${phone}`,
            );
          }
        });

        for (const row of rows) {
          const name = row.name?.trim();
          const addressInput = row.address?.trim() || "";
          if (!name) {
            missingRows += 1;
            continue;
          }

          const email = row.email?.trim()?.toLowerCase() || null;
          const externalId = row.externalId?.trim() || null;
          const cityKey = (row.city || "").trim().toLowerCase();
          const stateKey = (row.state || "").trim().toLowerCase();
          const phoneKey = normalizePhone(row.phone || "");
          const nameKey = name.toLowerCase();
          const addressKey = addressInput.toLowerCase();
          const dedupeKey = externalId
            ? `ext:${externalId.toLowerCase()}`
            : email
              ? `email:${email}`
              : addressInput
                ? `addr:${nameKey}|${addressKey}`
                : phoneKey
                  ? `name-city-state-phone:${nameKey}|${cityKey}|${stateKey}|${phoneKey}`
                  : cityKey && stateKey
                    ? `name-city-state:${nameKey}|${cityKey}|${stateKey}`
                    : "";
          if (!dedupeKey) {
            // Reject weak name-only rows to avoid false matches from common terms.
            missingRows += 1;
            continue;
          }
          if (seenKeys.has(dedupeKey)) {
            duplicateRows += 1;
            continue;
          }
          seenKeys.add(dedupeKey);

          // Duplicate rejection rule:
          // If 2 identifying fields match, treat as a duplicate. ExternalId/email count as "2"
          // because they're unique identifiers in practice (gov license, owner email).
          let matchScore = 0;
          if (externalId && existingExternalIdSet.has(normalize(externalId)))
            matchScore += 2;
          if (email && existingEmailSet.has(normalize(email))) matchScore += 2;
          if (
            addressInput &&
            existingNameAddressSet.has(
              `${normalize(name)}|${normalize(addressInput)}`,
            )
          ) {
            matchScore += 2;
          }
          if (
            cityKey &&
            stateKey &&
            addressInput &&
            existingNameCityStateAddressSet.has(
              `${normalize(name)}|${cityKey}|${stateKey}|${normalize(addressInput)}`,
            )
          ) {
            matchScore += 2;
          }
          if (
            cityKey &&
            stateKey &&
            phoneKey &&
            existingNameCityStatePhoneSet.has(
              `${normalize(name)}|${cityKey}|${stateKey}|${phoneKey}`,
            )
          ) {
            matchScore += 2;
          }

          if (matchScore >= 2) {
            duplicateRows += 1;
            continue;
          }

          listingsToInsert.push({
            batchId: batch?.id,
            source: source || null,
            externalId,
            email,
            name,
            // Address is optional for admin-uploaded seeds; claim flow can fill it in later.
            address: addressInput,
            city: row.city || null,
            state: row.state || null,
            phone: row.phone || null,
            cuisineType: row.cuisineType || null,
            websiteUrl: row.websiteUrl || null,
            instagramUrl: row.instagramUrl || null,
            facebookPageUrl: row.facebookPageUrl || null,
            latitude: row.latitude || null,
            longitude: row.longitude || null,
            confidenceScore: row.confidenceScore || 0,
            status: "unclaimed",
            rawData: row.rawData || null,
          });
        }

        const chunkSize = 250;
        const insertedListingRows: Array<{
          id: string;
          email: string | null;
          name: string;
          address: string;
          city: string | null;
          state: string | null;
          phone: string | null;
          cuisineType: string | null;
          websiteUrl: string | null;
          instagramUrl: string | null;
          facebookPageUrl: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        for (let i = 0; i < listingsToInsert.length; i += chunkSize) {
          const chunk = listingsToInsert.slice(i, i + chunkSize);
          if (chunk.length === 0) continue;
          const inserted = await db
            .insert(truckImportListings)
            .values(chunk)
            .returning({
              id: truckImportListings.id,
              email: truckImportListings.email,
              name: truckImportListings.name,
              address: truckImportListings.address,
              city: truckImportListings.city,
              state: truckImportListings.state,
              phone: truckImportListings.phone,
              cuisineType: truckImportListings.cuisineType,
              websiteUrl: truckImportListings.websiteUrl,
              instagramUrl: truckImportListings.instagramUrl,
              facebookPageUrl: truckImportListings.facebookPageUrl,
              latitude: truckImportListings.latitude,
              longitude: truckImportListings.longitude,
            });
          insertedListingRows.push(...inserted);
          importedRows += inserted.length;
        }

        if (insertedListingRows.length > 0) {
          const systemOwnerId = await getOrCreateImportSystemUserId();

          // Create/reuse invited owner accounts where we have an email.
          const invitedOwnerByEmail = new Map<string, string>();
          const invitedOwnerByEmailSent = new Map<string, boolean>();
          const uniqueEmails = Array.from(
            new Set(
              insertedListingRows
                .map((listing: any) =>
                  String(listing.email || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter((value) => value.length > 0),
            ),
          );
          for (const email of uniqueEmails) {
            const existing = await storage.getUserByEmail(email);
            const user =
              existing ??
              (await storage.createUserInvite({
                email,
                firstName: null,
                lastName: null,
                phone: null,
                userType: "food_truck",
              }));
            invitedOwnerByEmail.set(email, user.id);
            const inviteResult = await sendAccountSetupInvite({
              user,
              createdBy: req.user,
              req,
              setupPath: "/owner/verify",
            });
            invitedOwnerByEmailSent.set(email, inviteResult.emailSent);
          }

          const restaurantsToInsert = insertedListingRows.map(
            (listing: any) => {
              const email = String(listing.email || "")
                .trim()
                .toLowerCase();
              const invitedOwnerId = email
                ? invitedOwnerByEmail.get(email)
                : undefined;
              return {
                ownerId: invitedOwnerId || systemOwnerId,
                name: listing.name,
                address: listing.address,
                phone: listing.phone,
                businessType: "food_truck",
                cuisineType: listing.cuisineType,
                city: listing.city,
                state: listing.state,
                websiteUrl: listing.websiteUrl,
                instagramUrl: listing.instagramUrl,
                facebookPageUrl: listing.facebookPageUrl,
                latitude: listing.latitude,
                longitude: listing.longitude,
                isFoodTruck: true,
                isActive: false,
                isVerified: false,
                claimedFromImportId: listing.id,
              };
            },
          );

          const restaurantChunkSize = 200;
          for (
            let i = 0;
            i < restaurantsToInsert.length;
            i += restaurantChunkSize
          ) {
            const chunk = restaurantsToInsert.slice(i, i + restaurantChunkSize);
            if (chunk.length === 0) continue;
            await db.insert(restaurants).values(chunk);
            seededRestaurants += chunk.length;
          }

          // Best-effort: persist invited owner linkage on the import listing rows.
          // This allows us to block hostile claims and send setup reminders.
          for (const listing of insertedListingRows as any[]) {
            const email = String(listing.email || "")
              .trim()
              .toLowerCase();
            const invitedOwnerId = email
              ? invitedOwnerByEmail.get(email)
              : null;
            if (!invitedOwnerId) continue;
            try {
              await db
                .update(truckImportListings)
                .set({ invitedUserId: invitedOwnerId, updatedAt: new Date() })
                .where(eq(truckImportListings.id, listing.id));
              await recordListingInviteEvidence(String(listing.id), {
                invitedUserId: invitedOwnerId,
                inviteEmail: email,
                emailSent: Boolean(invitedOwnerByEmailSent.get(email)),
                source: "bulk_import",
                invitedAt: new Date().toISOString(),
              });
            } catch {
              // ignore
            }
          }
        }

        const skippedRows = Math.max(
          0,
          rows.length - importedRows - duplicateRows - missingRows,
        );

        await db
          .update(truckImportBatches)
          .set({
            importedRows,
            skippedRows,
            updatedAt: new Date(),
          })
          .where(eq(truckImportBatches.id, batch.id));

        res.json({
          batchId: batch.id,
          totalRows: rows.length,
          importedRows,
          skippedRows,
          missingRows,
          duplicateRows,
          seededRestaurants,
          headers: (headers || []).slice(0, 50),
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_batches")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql` (and then retry the upload).",
            code: "migration_required",
          });
        }
        if (isMissingColumnError(error, "claimed_from_import_id")) {
          return res.status(503).json({
            message:
              "Truck import schema is missing columns. Run `npm run migrate:sql -- 044_add_restaurants_claimed_from_import_id.sql` (and then retry the upload).",
            code: "migration_required",
          });
        }
        console.error("Error importing truck listings:", error);
        res.status(500).json({
          message: error.message || "Failed to import truck listings",
        });
      }
    },
  );

  app.post(
    "/api/admin/truck-imports/:batchId/purge",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const batchId = String(req.params.batchId || "").trim();
        const force = Boolean(req.body?.force);
        if (!batchId) {
          return res.status(400).json({ message: "Batch ID required" });
        }

        const [batch] = await db
          .select()
          .from(truckImportBatches)
          .where(eq(truckImportBatches.id, batchId))
          .limit(1);
        if (!batch) {
          return res.status(404).json({ message: "Import batch not found" });
        }

        const listings = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId));

        const listingIds = listings.map((l: any) => l.id);
        if (listingIds.length === 0) {
          return res.json({
            batchId,
            fileName: batch.fileName,
            totalListings: 0,
            deletedListings: 0,
            deletedRestaurants: 0,
            deletedClaimRequests: 0,
            blocked: [],
          });
        }

        const importSystemUserId = await getOrCreateImportSystemUserId();

        const claimRequests = await db
          .select({
            id: truckClaimRequests.id,
            listingId: truckClaimRequests.listingId,
            restaurantId: truckClaimRequests.restaurantId,
          })
          .from(truckClaimRequests)
          .where(inArray(truckClaimRequests.listingId, listingIds));

        const claimRequestListingIds = new Set(
          claimRequests.map((row: any) => String(row.listingId || "")),
        );

        const seededRestaurants = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            claimedFromImportId: restaurants.claimedFromImportId,
          })
          .from(restaurants)
          .where(inArray(restaurants.claimedFromImportId, listingIds));

        const restaurantIds = seededRestaurants.map((row: any) => row.id);
        const bookingRows = restaurantIds.length
          ? await db
              .select({ id: eventBookings.id, truckId: eventBookings.truckId })
              .from(eventBookings)
              .where(inArray(eventBookings.truckId, restaurantIds))
              .limit(1)
          : [];
        const restaurantIdsWithBookings = new Set(
          bookingRows.map((row: any) => String(row.truckId)),
        );

        const blocked: Array<{
          listingId: string;
          reason: string;
        }> = [];

        // Purge policy:
        // - Default: only purge listings that are still `unclaimed`.
        // - Force: allow purging `claim_requested` too (also deletes the claim requests).
        // - Never purge `claimed` rows (could belong to a real business owner).
        const purgeableListingIds: string[] = [];
        for (const listing of listings as any[]) {
          const status = String(listing.status || "");
          const canPurge =
            status === "unclaimed" || (force && status === "claim_requested");
          if (!canPurge) {
            blocked.push({
              listingId: listing.id,
              reason: `status:${status}`,
            });
            continue;
          }
          if (claimRequestListingIds.has(String(listing.id)) && !force) {
            blocked.push({
              listingId: listing.id,
              reason: "has_claim_request",
            });
            continue;
          }
          purgeableListingIds.push(String(listing.id));
        }

        let deletedClaimRequests = 0;
        let deletedRestaurants = 0;
        let deletedListings = 0;

        await db.transaction(async (tx: any) => {
          if (force && claimRequests.length > 0) {
            const deleted = await tx
              .delete(truckClaimRequests)
              .where(
                inArray(
                  truckClaimRequests.id,
                  claimRequests.map((r: any) => r.id),
                ),
              )
              .returning({ id: truckClaimRequests.id });
            deletedClaimRequests = deleted.length;
          }

          // Delete seeded restaurant profiles for purgeable listings.
          const restaurantIdsToDelete: string[] = [];
          for (const row of seededRestaurants as any[]) {
            const listingId = String(row.claimedFromImportId || "");
            if (!purgeableListingIds.includes(listingId)) continue;
            if (restaurantIdsWithBookings.has(String(row.id))) {
              blocked.push({
                listingId,
                reason: "has_booking",
              });
              continue;
            }
            // If a restaurant is already owned by a real user (not system, not invited), require force.
            const isSystemOrInvited =
              String(row.ownerId) === String(importSystemUserId) ||
              listings.some(
                (l: any) =>
                  String(l.id) === listingId &&
                  l.invitedUserId &&
                  String(l.invitedUserId) === String(row.ownerId),
              );
            if (!isSystemOrInvited && !force) {
              blocked.push({
                listingId,
                reason: "owned_by_user",
              });
              continue;
            }
            restaurantIdsToDelete.push(String(row.id));
          }

          if (restaurantIdsToDelete.length > 0) {
            const deleted = await tx
              .delete(restaurants)
              .where(inArray(restaurants.id, restaurantIdsToDelete))
              .returning({ id: restaurants.id });
            deletedRestaurants = deleted.length;
          }

          const deletableListingIds = purgeableListingIds.filter((id) => {
            // If we blocked restaurant deletion due to bookings/ownership and the listing is linked, keep it.
            const hasBlocked = blocked.some((b) => b.listingId === id);
            return !hasBlocked;
          });

          if (deletableListingIds.length > 0) {
            const deleted = await tx
              .delete(truckImportListings)
              .where(inArray(truckImportListings.id, deletableListingIds))
              .returning({ id: truckImportListings.id });
            deletedListings = deleted.length;
          }
        });

        res.json({
          batchId,
          fileName: batch.fileName,
          totalListings: listings.length,
          deletedListings,
          deletedRestaurants,
          deletedClaimRequests,
          blocked,
          force,
        });

        // Hide this batch from the default Recent Imports list so staff don't keep re-purging the same file.
        try {
          await db
            .update(truckImportBatches)
            .set({
              purgedAt: new Date(),
              purgedBy: req.user?.id ?? null,
              updatedAt: new Date(),
            })
            .where(eq(truckImportBatches.id, batchId));
        } catch (markError) {
          console.error("Failed to mark import batch as purged:", markError);
        }
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_batches") ||
          isMissingRelationError(error, "truck_import_listings")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error purging truck import batch:", error);
        res.status(500).json({
          message: error.message || "Failed to purge import batch",
        });
      }
    },
  );

  app.get(
    "/api/admin/truck-imports/:batchId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const batchId = String(req.params.batchId || "").trim();
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query?.limit ?? 50)),
        );
        const offset = Math.max(0, Number(req.query?.offset ?? 0));
        if (!batchId)
          return res.status(400).json({ message: "Batch ID required" });

        const [batch] = await db
          .select()
          .from(truckImportBatches)
          .where(eq(truckImportBatches.id, batchId))
          .limit(1);
        if (!batch) return res.status(404).json({ message: "Batch not found" });

        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId));

        const statusCounts = await db
          .select({
            status: truckImportListings.status,
            count: sql<number>`count(*)`,
          })
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId))
          .groupBy(truckImportListings.status);

        const seededRestaurantCounts = await db
          .select({ count: sql<number>`count(*)` })
          .from(restaurants)
          .innerJoin(
            truckImportListings,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId));

        const claimRequestCounts = await db
          .select({ count: sql<number>`count(*)` })
          .from(truckClaimRequests)
          .innerJoin(
            truckImportListings,
            eq(truckClaimRequests.listingId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId));

        const listingRows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId))
          .orderBy(desc(truckImportListings.confidenceScore))
          .limit(limit)
          .offset(offset);

        res.json({
          batch,
          total: Number(total ?? 0),
          statusCounts: statusCounts.map((row: any) => ({
            status: row.status,
            count: Number(row.count ?? 0),
          })),
          seededRestaurants: Number(seededRestaurantCounts?.[0]?.count ?? 0),
          claimRequests: Number(claimRequestCounts?.[0]?.count ?? 0),
          rows: listingRows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
          })),
          limit,
          offset,
        });
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_batches") ||
          isMissingRelationError(error, "truck_import_listings")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error fetching import batch details:", error);
        res.status(500).json({ message: "Failed to fetch batch details" });
      }
    },
  );
}
