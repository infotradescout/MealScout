import type { Express } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import { storage } from "../../storage";
import { sendAccountSetupInvite } from "../../utils/accountSetup";
import { parseTruckImportFile } from "../../utils/truckImport";
import {
  eventBookings,
  restaurants,
  truckClaimRequests,
  truckImportBatches,
  truckImportListings,
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

        const emailSent = await sendAccountSetupInvite({
          user: inviteUser,
          createdBy: req.user,
          req,
        });

        res.json({ success: true, emailSent, listing: updated });
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

          // Create invited owner accounts where we have an email, but do not email them here.
          // The “Request this truck” flow sends reminders on-demand.
          const invitedOwnerByEmail = new Map<string, string>();
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
