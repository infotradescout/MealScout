import type { Express } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import { storage } from "../../storage";
import { randomUUID } from "crypto";
import {
  isCloudinaryConfigured,
  upload,
  uploadToCloudinary,
} from "../../imageUpload";
import { sendAccountSetupInvite } from "../../utils/accountSetup";
import { parseTruckImportFile } from "../../utils/truckImport";
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

type RequireAdminUser = (req: any, res: any) => boolean;
type EnsureTruckImportTables = () => Promise<void>;
type IsMissingRelationError = (error: unknown, relationName?: string) => boolean;
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
    if (typeof value === "object") return Object.keys(value as any).length === 0;
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
    upload.single("image"),
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const requestBody =
          typeof req.body?.payload === "string" && req.body.payload.trim()
            ? JSON.parse(req.body.payload)
            : req.body || {};

        const mode = requestBody?.mode === "apply" ? "apply" : "dry_run";
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
        const fillIfBlank = (requestBody?.fillIfBlank ||
          {}) as Record<string, unknown>;
        const descriptionOnlyIfBlank = String(
          requestBody?.descriptionOnlyIfBlank || "",
        ).trim();
        const incomingMenuItems = Array.isArray(requestBody?.menuItems)
          ? requestBody.menuItems
          : [];
        const incomingScheduleItems = Array.isArray(requestBody?.scheduleItems)
          ? requestBody.scheduleItems
          : [];
        const sourceNotes = Array.isArray(requestBody?.sourceNotes)
          ? requestBody.sourceNotes.map((v: any) => String(v || "").trim()).filter(Boolean)
          : [];
        const missingInfo = Array.isArray(requestBody?.missingInfo)
          ? requestBody.missingInfo.map((v: any) => String(v || "").trim()).filter(Boolean)
          : [];
        const rawSource = requestBody?.rawSource;
        const evidence = Array.isArray(requestBody?.evidence) ? requestBody.evidence : [];
        const evidenceFieldProposals = Array.isArray(requestBody?.evidenceFieldProposals)
          ? requestBody.evidenceFieldProposals
              .filter((proposal: any) => proposal && typeof proposal === "object")
              .map((proposal: any) => ({
                field: String(proposal.field || "").trim(),
                proposedValue: String(proposal.proposedValue || "").trim(),
                confidence: String(proposal.confidence || "low").trim(),
                source: String(proposal.source || "screenshot").trim(),
                evidenceText: String(proposal.evidenceText || "").trim(),
                imageRef: String(proposal.imageRef || "").trim(),
              }))
              .filter((proposal: any) => proposal.field && proposal.proposedValue)
          : [];
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
          const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
          try {
            const parsed = new URL(withProtocol);
            const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
            const path = parsed.pathname
              .replace(/\/+$/, "")
              .toLowerCase();
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
        const normalizedMatchName = normalizeName(matchName);
        const identitySignals = {
          phone: Boolean(matchPhone),
          email: Boolean(matchEmail),
          website: Boolean(matchWebsite),
          facebook: Boolean(matchFacebook),
          instagram: Boolean(matchInstagram),
          exactNameCity: Boolean(normalizedMatchName && matchCity),
          nameOnly: Boolean(normalizedMatchName && !matchCity && !matchPhone && !matchEmail),
        };
        const menuSignals = {
          menuItemCount: incomingMenuItems.length,
          hasMenuItems: incomingMenuItems.length > 0,
          hasMenuKeywords:
            sourceNotes.some((note: string) => /menu|price|item|dish/i.test(note)) ||
            evidenceFieldProposals.some((proposal: any) =>
              /menu|item|price|dish|food/i.test(String(proposal.field || "")),
            ),
        };
        const whyUnknownReasons: string[] = [];
        if (!matchName) whyUnknownReasons.push("missing_name");
        if (!matchCity && !matchState) whyUnknownReasons.push("missing_city_or_state");
        if (!matchPhone && !matchEmail && !matchWebsite && !matchFacebook && !matchInstagram) {
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

        const restaurantWhere = or(
          matchPhone ? eq(sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`, matchPhone) : sql`false`,
          matchWebsite ? sql`replace(replace(lower(coalesce(${restaurants.websiteUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchWebsite}%`}` : sql`false`,
          matchFacebook ? sql`replace(replace(lower(coalesce(${restaurants.facebookPageUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchFacebook}%`}` : sql`false`,
          matchInstagram ? sql`replace(replace(lower(coalesce(${restaurants.instagramUrl}, '')), 'https://', ''), 'http://', '') like ${`%${matchInstagram}%`}` : sql`false`,
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

        const restaurantCandidates = await db
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

        let matchedRestaurant = scoredRestaurants[0]?.row || null;
        let matchedBy = scoredRestaurants[0]?.matchedBy || [];
        let matchStrength: "strongest" | "strong" | "medium" | "weak" | "none" =
          "none";
        const topRestaurantScore = Number(scoredRestaurants[0]?.score || 0);
        if (topRestaurantScore >= 12) matchStrength = "strongest";
        else if (topRestaurantScore >= 9) matchStrength = "strong";
        else if (topRestaurantScore >= 5) matchStrength = "medium";
        else if (topRestaurantScore >= 3) matchStrength = "weak";
        const multipleRestaurantStrongMatches =
          scoredRestaurants.length > 1 &&
          scoredRestaurants[0].score === scoredRestaurants[1].score &&
          scoredRestaurants[0].score >= 9;

        let matchedImportListing: any = null;
        if (profileType === "food_truck") {
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
              .where(eq(restaurants.claimedFromImportId, matchedImportListing.id))
              .limit(1);
            matchedRestaurant = linked || null;
          }
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
            conflicts: [{ field: "match", reason: "weak_name_only_review_required" }],
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
          if (mode === "dry_run") {
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
                classificationReasons: ["no_existing_match", "dry_run_only"],
                whyUnknown: whyUnknownReasons,
              }),
            });
          }

          if (profileType === "food_truck") {
            const [createdListing] = await db
              .insert(truckImportListings)
              .values({
                name: String(fillIfBlank.name || matchName || "Unknown").trim(),
                address: String(fillIfBlank.address || fillIfBlank.location_text || "").trim(),
                city: String(fillIfBlank.city || match.city || "").trim() || null,
                state: String(fillIfBlank.state || match.state || "").trim() || null,
                phone: String(fillIfBlank.phone || match.phone || "").trim() || null,
                email: String(fillIfBlank.email || match.email || "").trim().toLowerCase() || null,
                cuisineType: String(fillIfBlank.category || "").trim() || null,
                websiteUrl: toUrl(fillIfBlank.website || fillIfBlank.websiteUrl || null) || null,
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
            ["restaurant", "bar", "caterer", "private_chef"].includes(profileType)
          ) {
            const systemOwnerId = await getOrCreateImportSystemUserId();
            const [createdRestaurant] = await db
              .insert(restaurants)
              .values({
                ownerId: systemOwnerId,
                name: String(fillIfBlank.name || matchName || "Unknown").trim(),
                address: String(fillIfBlank.address || "").trim(),
                city: String(fillIfBlank.city || match.city || "").trim() || null,
                state: String(fillIfBlank.state || match.state || "").trim() || null,
                businessType: profileType,
                phone: String(fillIfBlank.phone || "").trim() || null,
                cuisineType: String(fillIfBlank.category || "").trim() || null,
                websiteUrl:
                  toUrl(fillIfBlank.website || fillIfBlank.websiteUrl || null) || null,
                facebookPageUrl:
                  toUrl(fillIfBlank.facebook || fillIfBlank.facebookPageUrl || null, "facebook.com") ||
                  null,
                instagramUrl:
                  toUrl(fillIfBlank.instagram || fillIfBlank.instagramUrl || null, "instagram.com") ||
                  null,
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

        const fieldsApplied: string[] = [];
        const fieldsSkipped: string[] = [];
        const conflicts: Array<{ field: string; existing: unknown; incoming: unknown }> = [];
        const listingUpdates: Record<string, unknown> = {};
        const restaurantUpdates: Record<string, unknown> = {};

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
          { key: "address", listingField: "address", restaurantField: "address" },
          { key: "city", listingField: "city", restaurantField: "city" },
          { key: "state", listingField: "state", restaurantField: "state" },
          { key: "phone", listingField: "phone", restaurantField: "phone" },
          {
            key: "email",
            listingField: "email",
            transform: (value) => String(value || "").trim().toLowerCase(),
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
            const existing = (matchedImportListing as any)[mapEntry.listingField];
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
            const existing = (matchedRestaurant as any)[mapEntry.restaurantField];
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

        let menuStatus: "added" | "queued_review" | "skipped_existing" | "none" = "none";
        let scheduleStatus:
          | "added"
          | "queued_review"
          | "skipped_existing"
          | "none" = "none";
        let logoStatus: "uploaded" | "skipped_existing_logo" | "none" = "none";

        const appendEvidence = (
          existingRaw: Record<string, unknown> | null | undefined,
        ) => ({
          ...(existingRaw || {}),
          evidenceApply: {
            ...(typeof (existingRaw as any)?.evidenceApply === "object"
              ? ((existingRaw as any).evidenceApply as Record<string, unknown>)
              : {}),
            updatedAt: new Date().toISOString(),
            sourceNotes,
            missingInfo,
            evidenceFieldProposals,
            queuedMenuItems: incomingMenuItems,
            queuedScheduleItems: incomingScheduleItems,
          },
        });

        if (matchedImportListing) {
          listingUpdates.rawData = appendEvidence(
            (matchedImportListing.rawData as Record<string, unknown>) || {},
          );
        }

        if (matchedRestaurant) {
          const existingSettings =
            typeof (matchedRestaurant as any).socialAutopostSettings === "object"
              ? ((matchedRestaurant as any).socialAutopostSettings as Record<string, unknown>)
              : {};
          restaurantUpdates.socialAutopostSettings = appendEvidence(
            existingSettings,
          );
        }

        if (matchedRestaurant) {
          const existingMenuCountRows = await db
            .select({ total: sql<number>`count(*)` })
            .from(menuItems)
            .where(eq(menuItems.restaurantId, matchedRestaurant.id));
          const existingMenuCount = Number(existingMenuCountRows?.[0]?.total || 0);

          if (incomingMenuItems.length > 0) {
            if (existingMenuCount > 0) {
              menuStatus = "queued_review";
            } else if (mode === "apply") {
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

              const toPriceCents = (value: unknown) => {
                const raw = String(value || "").trim();
                if (!raw) return 0;
                const parsed = Number(raw.replace(/[^0-9.]/g, ""));
                if (!Number.isFinite(parsed)) return 0;
                return Math.max(0, Math.round(parsed * 100));
              };

              const itemsToInsert = incomingMenuItems
                .map((item: any, index: number) => {
                  const name = String(item?.item_name || item?.name || "").trim();
                  if (!name) return null;
                  return {
                    menuId: menu.id,
                    categoryId: null,
                    restaurantId: matchedRestaurant.id,
                    name,
                    description: String(item?.description || "").trim() || null,
                    priceCents: toPriceCents(item?.price),
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

          const existingScheduleRows = await db
            .select({ total: sql<number>`count(*)` })
            .from(truckManualSchedules)
            .where(eq(truckManualSchedules.truckId, matchedRestaurant.id));
          const existingScheduleCount = Number(existingScheduleRows?.[0]?.total || 0);

          const validScheduleItems = incomingScheduleItems.filter((item: any) => {
            const date = String(item?.date || "").trim();
            const location = String(item?.location_name || item?.locationName || "").trim();
            const start = String(item?.start_time || item?.startTime || "").trim();
            const end = String(item?.end_time || item?.endTime || "").trim();
            return Boolean(date && location && start && end);
          });

          if (validScheduleItems.length > 0) {
            if (existingScheduleCount > 0) {
              scheduleStatus = "queued_review";
            } else if (mode === "apply" && profileType === "food_truck") {
              const rows = validScheduleItems.map((item: any) => ({
                truckId: matchedRestaurant.id,
                date: new Date(String(item.date)),
                startTime: String(item.start_time || item.startTime),
                endTime: String(item.end_time || item.endTime),
                locationName: String(item.location_name || item.locationName || "").trim() || null,
                address:
                  String(item.address || "").trim() ||
                  String(item.location_name || item.locationName || "Unknown location").trim(),
                city: String(item.city || fillIfBlank.city || "").trim() || null,
                state: String(item.state || fillIfBlank.state || "").trim() || null,
                notes: String(item.notes || "").trim() || null,
                isPublic: true,
                lastConfirmedAt: new Date(),
              }));
              await db.insert(truckManualSchedules).values(rows as any[]);
              scheduleStatus = "added";
            } else {
              scheduleStatus = "queued_review";
            }
          }

          if (logoEnabled) {
            if (!matchedRestaurant.logoUrl && req.file && mode === "apply") {
              if (!isCloudinaryConfigured()) {
                return res.status(503).json({
                  message: "Image upload service not configured",
                });
              }
              const uploadResult = await uploadToCloudinary(
                req.file.buffer,
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
                  mimeType: req.file.mimetype,
                })
                .returning();
              const existingSettings =
                typeof (matchedRestaurant as any).socialAutopostSettings === "object"
                  ? { ...((matchedRestaurant as any).socialAutopostSettings || {}) }
                  : {};
              const existingGallery = Array.isArray((existingSettings as any).publicGalleryImages)
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
            }
          }
        }

        if (mode === "apply") {
          if (matchedImportListing && Object.keys(listingUpdates).length > 0) {
            await db
              .update(truckImportListings)
              .set({ ...listingUpdates, updatedAt: new Date() })
              .where(eq(truckImportListings.id, matchedImportListing.id));
          }
          if (matchedRestaurant && Object.keys(restaurantUpdates).length > 0) {
            await db
              .update(restaurants)
              .set({ ...restaurantUpdates, updatedAt: new Date() })
              .where(eq(restaurants.id, matchedRestaurant.id));
          }
        }

        res.json({
          status: mode === "apply" ? "applied" : "dry_run",
          existingTruckId: matchedRestaurant?.id || "",
          matchedRestaurantId: matchedRestaurant?.id || "",
          matchedImportListingId: matchedImportListing?.id || "",
          createdDraftId,
          matchStrength,
          matchedBy,
          fieldsApplied: Array.from(new Set(fieldsApplied)),
          fieldsSkipped: Array.from(new Set(fieldsSkipped)),
          conflicts,
          menuStatus,
          scheduleStatus,
          logoStatus,
          missingInfo,
          sourceNotes,
          debug: buildDebug({
            classification:
              mode === "apply"
                ? "apply"
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
              mode === "apply" ? "apply_mode" : "dry_run_mode",
            ],
          }),
        });
      } catch (error: any) {
        console.error("Error applying profile evidence:", error);
        res.status(500).json({ message: "Failed to apply profile evidence" });
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
          ? req.body.missing_info.map((v: any) => String(v || "").trim()).filter(Boolean)
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
        const conflicts: Array<{ field: string; existing: unknown; incoming: unknown }> = [];

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
          { evidenceField: "business_type", restaurantField: "businessType", value: fill.business_type },
          { evidenceField: "category", listingField: "cuisineType", restaurantField: "cuisineType", value: fill.category },
          { evidenceField: "phone", listingField: "phone", restaurantField: "phone", value: fill.phone },
          { evidenceField: "email", listingField: "email", value: fill.email, transform: (v) => String(v || "").trim().toLowerCase() },
          { evidenceField: "website", listingField: "websiteUrl", restaurantField: "websiteUrl", value: fill.website, transform: (v) => toUrl(v) },
          { evidenceField: "facebook", listingField: "facebookPageUrl", restaurantField: "facebookPageUrl", value: fill.facebook, transform: (v) => toUrl(v, "facebook.com") },
          { evidenceField: "instagram", listingField: "instagramUrl", restaurantField: "instagramUrl", value: fill.instagram, transform: (v) => toUrl(v, "instagram.com") },
          { evidenceField: "city", listingField: "city", restaurantField: "city", value: fill.city },
          { evidenceField: "state", listingField: "state", restaurantField: "state", value: fill.state },
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
          ...(((listing.rawData as Record<string, unknown>) || {}) as Record<string, unknown>),
          evidenceUpdate: {
            ...(typeof (listing.rawData as any)?.evidenceUpdate === "object"
              ? ((listing.rawData as any).evidenceUpdate as Record<string, unknown>)
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
            action: scheduleNotes.length > 0 ? "note_only_no_rows_created" : "none",
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
        console.error("Error filling missing listing fields from evidence:", error);
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
        const source = String(req.body?.source || "admin_inventory").trim() || "admin_inventory";
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
        const businessName = String(listing.name || "").trim() || "Unnamed truck";
        const city = String(listing.city || "").trim() || null;
        const claimUrl = `${resolvePublicBaseUrl()}/claim-truck?q=${encodeURIComponent(
          String(listing.externalId || businessName),
        )}`;
        const pitchCreatedAt = new Date().toISOString();
        const existingRaw =
          listing && typeof listing.rawData === "object" && listing.rawData
            ? (listing.rawData as Record<string, any>)
            : {};
        const priorPitch =
          existingRaw && typeof existingRaw.claimPitch === "object" && existingRaw.claimPitch
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
          claimStartedAt: priorPitch.claimStartedAt || null,
          claimCompletedAt: priorPitch.claimCompletedAt || null,
          source,
          createdByUserId: String(req.user?.id || ""),
          pitchMessage:
            "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
        };

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
          claimPitch: extractClaimPitch(updated),
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
        return res.status(500).json({ message: "Failed to create claim pitch" });
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
        const status = String(req.body?.status || "").trim().toLowerCase();
        const allowedStatuses = new Set([
          "opened",
          "claim_started",
          "claim_completed",
        ]);
        if (!listingId || !allowedStatuses.has(status)) {
          return res.status(400).json({ message: "Invalid listingId or status" });
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
          existingRaw && typeof existingRaw.claimPitch === "object" && existingRaw.claimPitch
            ? (existingRaw.claimPitch as Record<string, any>)
            : null;
        if (!currentPitch) {
          return res.status(404).json({ message: "Claim pitch not found" });
        }

        const nowIso = new Date().toISOString();
        const nextPitch = {
          ...currentPitch,
          pitchStatus:
            status === "opened"
              ? "opened"
              : status === "claim_started"
                ? "claim_started"
                : "claim_completed",
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
          claimPitch: extractClaimPitch(updated),
        });
      } catch (error: any) {
        console.error("Error updating claim pitch status:", error);
        return res.status(500).json({ message: "Failed to update claim pitch status" });
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
        const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 100)));
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
              businessName: claimPitch.businessName || String(listing.name || ""),
              city: claimPitch.city || String(listing.city || ""),
              claimUrl: claimPitch.claimUrl || null,
              pitchStatus: claimPitch.pitchStatus || "created",
              pitchCreatedAt: claimPitch.pitchCreatedAt || null,
              pitchOpenedAt: claimPitch.pitchOpenedAt || null,
              claimStartedAt: claimPitch.claimStartedAt || null,
              claimCompletedAt: claimPitch.claimCompletedAt || null,
              source: claimPitch.source || null,
              createdByUserId: claimPitch.createdByUserId || null,
            };
          })
          .filter(Boolean);

        return res.json({ items });
      } catch (error: any) {
        console.error("Error listing claim pitches:", error);
        return res.status(500).json({ message: "Failed to load claim pitches" });
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
          if (
            restaurant.ownerId !== importSystemUserId &&
            restaurant.ownerId !== inviteUser.id
          ) {
            return res.status(409).json({
              message:
                "This truck is already owned by another account. Refusing to reassign ownership.",
            });
          }
          await db
            .update(restaurants)
            .set({ ownerId: inviteUser.id, updatedAt: new Date() })
            .where(eq(restaurants.id, restaurant.id));
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

        res.json({ success: true, emailSent: inviteResult.emailSent, listing: updated });
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
            existingNameCityStatePhoneSet.add(`${name}|${city}|${state}|${phone}`);
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
            existingNameCityStatePhoneSet.add(`${name}|${city}|${state}|${phone}`);
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
