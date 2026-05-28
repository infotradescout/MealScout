import "dotenv/config";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings, users } from "../shared/schema";

type InputRecord = {
  business_name?: string;
  name?: string;
  phone?: string;
  email?: string;
  website?: string;
  websiteUrl?: string;
  instagram?: string;
  instagramUrl?: string;
  facebook?: string;
  facebookPageUrl?: string;
  city?: string;
  state?: string;
  service_area?: string;
  serviceArea?: string;
  address?: string;
  category?: string;
  cuisine?: string;
  cuisineType?: string;
  description?: string;
  menu?: unknown[];
  menuItems?: unknown[];
  menuDeferred?: boolean;
  sourceNotes?: string[];
  source_urls?: string[];
  source_files?: string[];
  confidence?: string;
  [key: string]: unknown;
};

type Normalized = {
  businessName: string;
  city: string;
  state: string;
  serviceArea: string;
  address: string;
  phone: string;
  phoneDigits: string;
  email: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookPageUrl: string;
  cuisineType: string;
  description: string;
  menuItems: unknown[];
  menuDeferred: boolean;
  sourceNotes: string[];
  sourceUrls: string[];
  sourceFiles: string[];
  confidence: string;
  raw: Record<string, unknown>;
};

type Action = "update_draft" | "create_draft" | "needs_review" | "reject";

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const inputArg = getArg("--input");
const apply = hasFlag("--apply");
const onlyBusiness = getArg("--only");
const continueOnReview = (() => {
  const raw = getArg("--continue-on-review");
  if (!raw) return false;
  return ["1", "true", "yes"].includes(raw.toLowerCase());
})();

if (!inputArg) {
  throw new Error("Missing --input <file|folder>");
}
if (!db) {
  throw new Error("DATABASE_URL is required.");
}

const normalize = (value: unknown) => String(value || "").trim();
const normalizeLower = (value: unknown) => normalize(value).toLowerCase();
const normalizePhone = (value: unknown) => String(value || "").replace(/[^\d]/g, "");
const slugName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const isBlank = (value: unknown) =>
  value === null || value === undefined || String(value).trim().length === 0;

const toWebsite = (value: unknown) => {
  const raw = normalize(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

const toSocialUrl = (value: unknown, platform: "instagram" | "facebook") => {
  const raw = normalize(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "");
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  return `https://facebook.com/${handle.replace(/\s+/g, "")}`;
};

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values.map((v) => v.trim());
};

const readInputRecords = (inputPath: string): InputRecord[] => {
  const absolute = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
  const st = statSync(absolute);
  if (st.isDirectory()) {
    const files = readdirSync(absolute)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => path.join(absolute, f));
    const rows: InputRecord[] = [];
    for (const filePath of files) {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) rows.push(...parsed);
      else rows.push(parsed);
    }
    return rows;
  }

  const ext = path.extname(absolute).toLowerCase();
  const raw = readFileSync(absolute, "utf8");
  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [parsed];
    return parsed;
  }
  if (ext === ".csv") {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) return [];
    const headers = parseCsvLine(lines[0]);
    const rows: InputRecord[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const vals = parseCsvLine(lines[i]);
      const row: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        row[h] = vals[idx] ?? "";
      });
      rows.push(row as InputRecord);
    }
    return rows;
  }
  throw new Error("Unsupported input. Use .json, .csv, or folder of .json files.");
};

const normalizeRecord = (record: InputRecord): Normalized => {
  const businessName = normalize(record.business_name || record.name);
  const city = normalize(record.city);
  const state = normalize(record.state);
  const serviceArea = normalize(record.service_area || record.serviceArea);
  const address = normalize(record.address);
  const phone = normalize(record.phone);
  const phoneDigits = normalizePhone(record.phone);
  const email = normalizeLower(record.email);
  const websiteUrl = toWebsite(record.websiteUrl || record.website);
  const instagramUrl = toSocialUrl(record.instagramUrl || record.instagram, "instagram");
  const facebookPageUrl = toSocialUrl(
    record.facebookPageUrl || record.facebook,
    "facebook",
  );
  const cuisineType = normalize(record.cuisineType || record.cuisine || record.category);
  const description = normalize(record.description);
  const menuItems = Array.isArray(record.menuItems)
    ? record.menuItems
    : Array.isArray(record.menu)
      ? record.menu
      : [];
  const menuDeferred = Boolean(record.menuDeferred);
  const sourceNotes = Array.isArray(record.sourceNotes)
    ? record.sourceNotes.map((v) => normalize(v)).filter(Boolean)
    : [];
  const sourceUrls = Array.isArray(record.source_urls)
    ? record.source_urls.map((v) => normalize(v)).filter(Boolean)
    : [];
  const sourceFiles = Array.isArray(record.source_files)
    ? record.source_files.map((v) => normalize(v)).filter(Boolean)
    : [];
  const confidence = normalize(record.confidence);

  return {
    businessName,
    city,
    state,
    serviceArea,
    address,
    phone,
    phoneDigits,
    email,
    websiteUrl,
    instagramUrl,
    facebookPageUrl,
    cuisineType,
    description,
    menuItems,
    menuDeferred,
    sourceNotes,
    sourceUrls,
    sourceFiles,
    confidence,
    raw: record as Record<string, unknown>,
  };
};

const hasRequiredForPublish = (r: Normalized) =>
  Boolean(
    r.businessName &&
      (r.city || r.serviceArea) &&
      r.cuisineType &&
      (r.phoneDigits || r.email) &&
      (r.menuItems.length > 0 || r.menuDeferred),
  );

const ensureImportSystemUserId = async () => {
  const importEmail =
    normalizeLower(process.env.IMPORT_SYSTEM_EMAIL) || "system-import@mealscout.us";
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, importEmail))
    .limit(1);
  if (existing?.id) return existing.id as string;
  const [created] = await db
    .insert(users)
    .values({
      email: importEmail,
      firstName: "System",
      lastName: "Import",
      userType: "admin",
      appContext: "mealscout",
      emailVerified: false,
      mustResetPassword: false,
      isDisabled: false,
    } as any)
    .returning({ id: users.id });
  return String(created.id);
};

const findMatches = async (r: Normalized) => {
  const restaurantCandidates = await db
    .select()
    .from(restaurants)
    .where(
      or(
        r.phoneDigits
          ? eq(
              sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`,
              r.phoneDigits,
            )
          : sql`false`,
        r.email ? eq(sql`lower(coalesce(${users.email}, ''))`, r.email) : sql`false`,
        r.websiteUrl
          ? sql`lower(coalesce(${restaurants.websiteUrl}, '')) like ${`%${normalizeLower(r.websiteUrl)}%`}`
          : sql`false`,
        r.instagramUrl
          ? sql`lower(coalesce(${restaurants.instagramUrl}, '')) like ${`%${normalizeLower(r.instagramUrl)}%`}`
          : sql`false`,
        r.facebookPageUrl
          ? sql`lower(coalesce(${restaurants.facebookPageUrl}, '')) like ${`%${normalizeLower(r.facebookPageUrl)}%`}`
          : sql`false`,
        r.businessName && r.city
          ? and(
              sql`lower(${restaurants.name}) = ${normalizeLower(r.businessName)}`,
              sql`lower(coalesce(${restaurants.city}, '')) = ${normalizeLower(r.city)}`,
            )
          : sql`false`,
      ),
    )
    .leftJoin(users, eq(restaurants.ownerId, users.id))
    .limit(12);

  const listingCandidates = await db
    .select()
    .from(truckImportListings)
    .where(
      or(
        r.phoneDigits
          ? eq(
              sql`regexp_replace(coalesce(${truckImportListings.phone}, ''), '[^0-9]', '', 'g')`,
              r.phoneDigits,
            )
          : sql`false`,
        r.email
          ? eq(sql`lower(coalesce(${truckImportListings.email}, ''))`, r.email)
          : sql`false`,
        r.websiteUrl
          ? sql`lower(coalesce(${truckImportListings.websiteUrl}, '')) like ${`%${normalizeLower(r.websiteUrl)}%`}`
          : sql`false`,
        r.instagramUrl
          ? sql`lower(coalesce(${truckImportListings.instagramUrl}, '')) like ${`%${normalizeLower(r.instagramUrl)}%`}`
          : sql`false`,
        r.facebookPageUrl
          ? sql`lower(coalesce(${truckImportListings.facebookPageUrl}, '')) like ${`%${normalizeLower(r.facebookPageUrl)}%`}`
          : sql`false`,
        r.businessName && r.city
          ? and(
              sql`lower(${truckImportListings.name}) = ${normalizeLower(r.businessName)}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) = ${normalizeLower(r.city)}`,
            )
          : sql`false`,
      ),
    )
    .limit(12);

  const scoreRestaurant = (row: any) => {
    let score = 0;
    const ownerEmail = normalizeLower(row.users?.email);
    if (r.phoneDigits && normalizePhone(row.restaurants.phone) === r.phoneDigits) score += 10;
    if (r.email && ownerEmail && ownerEmail === r.email) score += 10;
    if (r.websiteUrl && normalizeLower(row.restaurants.websiteUrl).includes(normalizeLower(r.websiteUrl)))
      score += 6;
    if (r.instagramUrl && normalizeLower(row.restaurants.instagramUrl).includes(normalizeLower(r.instagramUrl)))
      score += 6;
    if (r.facebookPageUrl && normalizeLower(row.restaurants.facebookPageUrl).includes(normalizeLower(r.facebookPageUrl)))
      score += 6;
    const nameMatch =
      slugName(row.restaurants.name || "") === slugName(r.businessName || "");
    if (nameMatch && normalizeLower(row.restaurants.city) === normalizeLower(r.city)) score += 5;
    return score;
  };
  const scoreListing = (row: any) => {
    let score = 0;
    if (r.phoneDigits && normalizePhone(row.phone) === r.phoneDigits) score += 10;
    if (r.email && normalizeLower(row.email) === r.email) score += 10;
    if (r.websiteUrl && normalizeLower(row.websiteUrl).includes(normalizeLower(r.websiteUrl)))
      score += 6;
    if (r.instagramUrl && normalizeLower(row.instagramUrl).includes(normalizeLower(r.instagramUrl)))
      score += 6;
    if (r.facebookPageUrl && normalizeLower(row.facebookPageUrl).includes(normalizeLower(r.facebookPageUrl)))
      score += 6;
    const nameMatch = slugName(row.name || "") === slugName(r.businessName || "");
    if (nameMatch && normalizeLower(row.city) === normalizeLower(r.city)) score += 5;
    return score;
  };

  const scoredRestaurants = restaurantCandidates
    .map((row: any) => ({ row: row.restaurants, owner: row.users, score: scoreRestaurant(row) }))
    .filter((x: any) => x.score >= 10)
    .sort((a: any, b: any) => b.score - a.score);
  const scoredListings = listingCandidates
    .map((row: any) => ({ row, score: scoreListing(row) }))
    .filter((x: any) => x.score >= 10)
    .sort((a: any, b: any) => b.score - a.score);

  return { scoredRestaurants, scoredListings };
};

const run = async () => {
  const inputRows = readInputRecords(inputArg);
  const normalizedRows = inputRows.map(normalizeRecord);
  const rows = onlyBusiness
    ? normalizedRows.filter((r) => normalizeLower(r.businessName) === normalizeLower(onlyBusiness))
    : normalizedRows;
  if (!rows.length) throw new Error("No rows to process.");

  const importOwnerId = apply ? await ensureImportSystemUserId() : "";
  const reportRows: any[] = [];
  let created = 0;
  let updated = 0;
  let needsReview = 0;
  let rejected = 0;
  let skippedDuplicate = 0;

  for (const record of rows) {
    const conflicts: string[] = [];
    const missingInfo: string[] = [];
    if (!record.businessName) missingInfo.push("business_name");
    if (!record.city && !record.serviceArea) missingInfo.push("city_or_service_area");
    if (!record.cuisineType) missingInfo.push("cuisine");
    if (!record.phoneDigits && !record.email) missingInfo.push("phone_or_email");
    if (!record.menuItems.length && !record.menuDeferred) missingInfo.push("menu_or_menuDeferred");

    const publishable = hasRequiredForPublish(record);
    const { scoredRestaurants, scoredListings } = await findMatches(record);
    const strongRestaurantMatches = scoredRestaurants.filter((x: any) => x.score >= 10);
    const strongListingMatches = scoredListings.filter((x: any) => x.score >= 10);
    const totalStrong = strongRestaurantMatches.length + strongListingMatches.length;

    let action: Action = "needs_review";
    if (!record.businessName) {
      action = "reject";
    } else if (totalStrong > 1) {
      action = "needs_review";
      conflicts.push("multiple_strong_matches");
    } else if (totalStrong === 1) {
      action = "update_draft";
    } else {
      action = "create_draft";
    }

    const baseEvidence = {
      sourceNotes: record.sourceNotes,
      sourceUrls: record.sourceUrls,
      sourceFiles: record.sourceFiles,
      confidence: record.confidence || null,
      contactEvidence: {
        phone: record.phone || null,
        email: record.email || null,
        websiteUrl: record.websiteUrl || null,
        instagramUrl: record.instagramUrl || null,
        facebookPageUrl: record.facebookPageUrl || null,
        sourcePriority: [
          "restaurant.phone",
          "restaurant.email",
          "restaurant.ownerEmail",
          "restaurant.contactEmail",
          "linked_user.verified_email",
          "import_listing.email",
        ],
      },
      missingInfo,
      extractedAt: new Date().toISOString(),
      publishGate: {
        publishable,
        requiredMissing: missingInfo,
      },
      extracted: record.raw,
    };

    let matchedRestaurantId = "";
    let matchedImportListingId = "";
    let createdRestaurantId = "";
    let createdListingId = "";

    if (apply && action === "update_draft") {
      const restaurantMatch = strongRestaurantMatches[0]?.row;
      const listingMatch = strongListingMatches[0]?.row;

      if (restaurantMatch) {
        matchedRestaurantId = String(restaurantMatch.id);
        // guard: only patch draft-like records directly; otherwise queue via listing evidence
        const canPatchRestaurant =
          Boolean(restaurantMatch.claimedFromImportId) &&
          restaurantMatch.isVerified !== true &&
          restaurantMatch.isActive !== true;

        if (canPatchRestaurant) {
          const updates: Record<string, unknown> = {};
          if (isBlank(restaurantMatch.phone) && record.phone) updates.phone = record.phone;
          if (isBlank(restaurantMatch.city) && record.city) updates.city = record.city;
          if (isBlank(restaurantMatch.state) && record.state) updates.state = record.state;
          if (isBlank(restaurantMatch.address) && (record.address || record.serviceArea))
            updates.address = record.address || record.serviceArea;
          if (isBlank(restaurantMatch.cuisineType) && record.cuisineType)
            updates.cuisineType = record.cuisineType;
          if (isBlank(restaurantMatch.websiteUrl) && record.websiteUrl)
            updates.websiteUrl = record.websiteUrl;
          if (isBlank(restaurantMatch.instagramUrl) && record.instagramUrl)
            updates.instagramUrl = record.instagramUrl;
          if (isBlank(restaurantMatch.facebookPageUrl) && record.facebookPageUrl)
            updates.facebookPageUrl = record.facebookPageUrl;
          if (Object.keys(updates).length > 0) {
            await db
              .update(restaurants)
              .set({ ...updates, updatedAt: new Date() })
              .where(eq(restaurants.id, restaurantMatch.id));
            updated += 1;
          } else {
            skippedDuplicate += 1;
          }
        } else {
          action = "needs_review";
          needsReview += 1;
          conflicts.push("matched_profile_is_not_draft_safe");
        }
      }

      const linkedListingId =
        restaurantMatch?.claimedFromImportId || listingMatch?.id || "";
      if (linkedListingId) {
        matchedImportListingId = String(linkedListingId);
        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, String(linkedListingId)))
          .limit(1);
        if (listing) {
          const listingUpdates: Record<string, unknown> = {
            rawData: {
              ...((listing as any).rawData || {}),
              evidenceIngest: baseEvidence,
            },
            updatedAt: new Date(),
          };
          if (isBlank(listing.phone) && record.phone) listingUpdates.phone = record.phone;
          if (isBlank(listing.email) && record.email) listingUpdates.email = record.email;
          if (isBlank(listing.city) && record.city) listingUpdates.city = record.city;
          if (isBlank(listing.state) && record.state) listingUpdates.state = record.state;
          if (isBlank(listing.cuisineType) && record.cuisineType)
            listingUpdates.cuisineType = record.cuisineType;
          if (isBlank(listing.websiteUrl) && record.websiteUrl)
            listingUpdates.websiteUrl = record.websiteUrl;
          if (isBlank(listing.instagramUrl) && record.instagramUrl)
            listingUpdates.instagramUrl = record.instagramUrl;
          if (isBlank(listing.facebookPageUrl) && record.facebookPageUrl)
            listingUpdates.facebookPageUrl = record.facebookPageUrl;
          await db
            .update(truckImportListings)
            .set(listingUpdates as any)
            .where(eq(truckImportListings.id, listing.id));

          // Repair path: if we matched an import listing but no linked restaurant exists yet,
          // seed a draft restaurant so publish/claim workflows have a resolvable target.
          const linkedRestaurants = await db
            .select({ id: restaurants.id })
            .from(restaurants)
            .where(eq(restaurants.claimedFromImportId, listing.id))
            .limit(2);
          if (!restaurantMatch && linkedRestaurants.length === 0) {
            const [seeded] = await db
              .insert(restaurants)
              .values({
                ownerId: importOwnerId,
                name: listing.name || record.businessName,
                address:
                  listing.address || record.address || record.serviceArea || "Unknown",
                phone: listing.phone || record.phone || null,
                businessType: "food_truck",
                cuisineType: listing.cuisineType || record.cuisineType || null,
                city: listing.city || record.city || null,
                state: listing.state || record.state || null,
                websiteUrl: listing.websiteUrl || record.websiteUrl || null,
                instagramUrl: listing.instagramUrl || record.instagramUrl || null,
                facebookPageUrl: listing.facebookPageUrl || record.facebookPageUrl || null,
                isFoodTruck: true,
                isActive: false,
                isVerified: false,
                claimedFromImportId: listing.id,
              } as any)
              .returning({ id: restaurants.id });
            createdRestaurantId = String(seeded.id);
          }
        }
      }
    } else if (apply && action === "create_draft") {
      const [listing] = await db
        .insert(truckImportListings)
        .values({
          source: "bulk_evidence_ingest",
          name: record.businessName,
          address: record.address || record.serviceArea || "Unknown",
          city: record.city || null,
          state: record.state || null,
          phone: record.phone || null,
          email: record.email || null,
          cuisineType: record.cuisineType || null,
          websiteUrl: record.websiteUrl || null,
          instagramUrl: record.instagramUrl || null,
          facebookPageUrl: record.facebookPageUrl || null,
          confidenceScore: publishable ? 90 : 70,
          status: "unclaimed",
          rawData: {
            evidenceIngest: baseEvidence,
          },
        } as any)
        .returning({ id: truckImportListings.id });
      createdListingId = String(listing.id);

      const [restaurant] = await db
        .insert(restaurants)
        .values({
          ownerId: importOwnerId,
          name: record.businessName,
          address: record.address || record.serviceArea || "Unknown",
          phone: record.phone || null,
          businessType: "food_truck",
          cuisineType: record.cuisineType || null,
          city: record.city || null,
          state: record.state || null,
          websiteUrl: record.websiteUrl || null,
          instagramUrl: record.instagramUrl || null,
          facebookPageUrl: record.facebookPageUrl || null,
          isFoodTruck: true,
          isActive: false,
          isVerified: false,
          claimedFromImportId: createdListingId,
        } as any)
        .returning({ id: restaurants.id });

      createdRestaurantId = String(restaurant.id);
      created += 1;
    }

    if (action === "needs_review" && !apply) needsReview += 1;
    if (action === "needs_review" && apply && !conflicts.includes("matched_profile_is_not_draft_safe")) {
      needsReview += 1;
    }
    if (action === "reject") rejected += 1;
    if (action === "update_draft" && !apply) updated += 1;
    if (action === "create_draft" && !apply) created += 1;

    reportRows.push({
      businessName: record.businessName,
      action,
      matchedRestaurantId,
      matchedImportListingId,
      createdRestaurantId,
      createdImportListingId: createdListingId,
      publishable,
      missingInfo,
      conflicts,
      menuStatus: record.menuItems.length > 0 ? "captured_in_evidence" : "none",
      scheduleStatus: "none",
      evidenceAttached: apply && (action === "create_draft" || matchedImportListingId !== ""),
    });

    if (action === "needs_review" && !continueOnReview) {
      throw new Error(
        `Stopped on needs_review for "${record.businessName || "Unknown"}". Re-run with --continue-on-review true.`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry_run",
    input: inputArg,
    totals: {
      processed: rows.length,
      created,
      updated,
      needsReview,
      rejected,
      skippedDuplicate,
    },
    rows: reportRows,
  };

  const outputPath = path.resolve(
    process.cwd(),
    `mealscout_bulk_truck_ingest_report_${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputPath, totals: report.totals }, null, 2));
};

run().catch((error) => {
  console.error("mealscout-bulk-truck-ingest failed:", error);
  process.exit(1);
});
