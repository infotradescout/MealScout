import "dotenv/config";
import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings, users } from "../shared/schema";

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const listingId = getArg("--listing-id");
const apply = process.argv.includes("--apply");
if (!listingId) {
  throw new Error(
    "Usage: npx tsx scripts/publishSafeIngestRecord.ts --listing-id <id> [--apply]",
  );
}
if (!db) throw new Error("DATABASE_URL is required.");

const normalize = (v: unknown) => String(v || "").trim().toLowerCase();
const normalizePhone = (v: unknown) => String(v || "").replace(/[^\d]/g, "");
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

const [listing] = await db
  .select()
  .from(truckImportListings)
  .where(eq(truckImportListings.id, listingId))
  .limit(1);

if (!listing) {
  console.log(
    JSON.stringify({ ok: false, reason: "listing_not_found", listingId }, null, 2),
  );
  process.exit(0);
}

const candidates: any[] = [];
const seen = new Set<string>();
const pushCandidates = (rows: any[]) => {
  for (const row of rows) {
    const key = String(row.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(row);
  }
};

// 1) restaurants.claimedFromImportId = listing.id
const step1 = await db
  .select()
  .from(restaurants)
  .where(eq(restaurants.claimedFromImportId, listingId))
  .limit(25);
pushCandidates(step1 as any[]);

// 2) restaurants.rawData.importListingId = listing.id
try {
  const step2 = await db.execute(sql`
    select r.*
    from restaurants r
    where coalesce(r.raw_data->>'importListingId', '') = ${listingId}
    limit 25
  `);
  pushCandidates((step2 as any)?.rows || []);
} catch (error: any) {
  if (String(error?.code || "") !== "42703") throw error;
}

// 3) restaurants.rawData.sourceImportListingId = listing.id
try {
  const step3 = await db.execute(sql`
    select r.*
    from restaurants r
    where coalesce(r.raw_data->>'sourceImportListingId', '') = ${listingId}
    limit 25
  `);
  pushCandidates((step3 as any)?.rows || []);
} catch (error: any) {
  if (String(error?.code || "") !== "42703") throw error;
}

// 4) restaurants.rawData.evidenceIngest.importListingId = listing.id
try {
  const step4 = await db.execute(sql`
    select r.*
    from restaurants r
    where coalesce(r.raw_data->'evidenceIngest'->>'importListingId', '') = ${listingId}
    limit 25
  `);
  pushCandidates((step4 as any)?.rows || []);
} catch (error: any) {
  if (String(error?.code || "") !== "42703") throw error;
}

// 5) normalized name + phone/email/social between listing and restaurants
const listingPhone = normalizePhone(listing.phone);
const listingEmail = normalize(listing.email);
const listingName = normalize(listing.name);
const listingCity = normalize(listing.city);
const listingWebsite = normalize(listing.websiteUrl);
const listingInstagram = normalize(listing.instagramUrl);
const listingFacebook = normalize(listing.facebookPageUrl);

const step5 = await db
  .select({
    restaurant: restaurants,
    ownerEmail: users.email,
  })
  .from(restaurants)
  .leftJoin(users, eq(restaurants.ownerId, users.id))
  .where(
    or(
      listingPhone
        ? eq(
            sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`,
            listingPhone,
          )
        : sql`false`,
      listingEmail
        ? eq(sql`lower(coalesce(${users.email}, ''))`, listingEmail)
        : sql`false`,
      listingWebsite
        ? sql`lower(coalesce(${restaurants.websiteUrl}, '')) like ${`%${listingWebsite}%`}`
        : sql`false`,
      listingInstagram
        ? sql`lower(coalesce(${restaurants.instagramUrl}, '')) like ${`%${listingInstagram}%`}`
        : sql`false`,
      listingFacebook
        ? sql`lower(coalesce(${restaurants.facebookPageUrl}, '')) like ${`%${listingFacebook}%`}`
        : sql`false`,
      listingName && listingCity
        ? and(
            sql`lower(${restaurants.name}) = ${listingName}`,
            sql`lower(coalesce(${restaurants.city}, '')) = ${listingCity}`,
          )
        : sql`false`,
    ),
  )
  .limit(25);
pushCandidates((step5 as any[]).map((r: any) => ({ ...r.restaurant, ownerEmail: r.ownerEmail })));

if (candidates.length !== 1) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: candidates.length === 0 ? "no_restaurant_match" : "multiple_restaurant_matches",
        listingId,
        listingName: listing.name,
        candidates: candidates.map((c: any) => ({
          restaurantId: c.id,
          name: c.name,
          city: c.city,
          state: c.state,
          phone: c.phone,
          websiteUrl: c.websiteUrl,
          instagramUrl: c.instagramUrl,
          facebookPageUrl: c.facebookPageUrl,
          claimedFromImportId: c.claimedFromImportId,
          isActive: c.isActive,
          isVerified: c.isVerified,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const restaurant = candidates[0] as any;
const hasMenu =
  Boolean((listing as any)?.rawData?.evidenceIngest?.extracted?.menuItems?.length) ||
  Boolean((listing as any)?.rawData?.evidenceIngest?.extracted?.menu?.length);
const menuDeferred = Boolean((listing as any)?.rawData?.evidenceIngest?.extracted?.menuDeferred);
const [linkedUser] = await db
  .select({
    id: users.id,
    email: users.email,
    emailVerified: users.emailVerified,
  })
  .from(users)
  .where(eq(users.id, String(restaurant.ownerId || "")))
  .limit(1);

const restaurantPhone = normalize(restaurant.phone);
const restaurantEmail = normalize((restaurant as any).email);
const ownerEmailField = normalize((restaurant as any).ownerEmail);
const contactEmailField = normalize((restaurant as any).contactEmail);
const restaurantWebsite = normalize(restaurant.websiteUrl);
const restaurantInstagram = normalize(restaurant.instagramUrl);
const restaurantFacebook = normalize(restaurant.facebookPageUrl);
const linkedVerifiedUserEmail =
  linkedUser?.emailVerified && normalize(linkedUser?.email)
    ? normalize(String(linkedUser.email))
    : "";
const listingEmailForGate = normalize(listing.email);
const listingPhoneForGate = normalizePhone(listing.phone);
const listingWebsiteForGate = normalize(listing.websiteUrl);
const listingInstagramForGate = normalize(listing.instagramUrl);
const listingFacebookForGate = normalize(listing.facebookPageUrl);
const listingEvidence = ((listing as any)?.rawData?.evidenceIngest || {}) as Record<
  string,
  any
>;
const extractedEvidence = (listingEvidence.extracted || {}) as Record<string, any>;
const extractedPhone = normalizePhone(extractedEvidence.phone);
const extractedEmail = normalize(extractedEvidence.email);
const extractedWebsite = normalize(
  extractedEvidence.websiteUrl || extractedEvidence.website,
);
const extractedInstagram = normalize(
  extractedEvidence.instagramUrl || extractedEvidence.instagram,
);
const extractedFacebook = normalize(
  extractedEvidence.facebookPageUrl || extractedEvidence.facebook,
);

const contactEvidenceSources: string[] = [];
const addEvidence = (source: string, present: unknown) => {
  const has =
    typeof present === "string"
      ? present.trim().length > 0
      : typeof present === "number"
        ? Number.isFinite(present)
        : Boolean(present);
  if (!has) return;
  if (!contactEvidenceSources.includes(source)) {
    contactEvidenceSources.push(source);
  }
};

addEvidence("restaurant.phone", restaurantPhone);
addEvidence("restaurant.email", restaurantEmail);
addEvidence("restaurant.ownerEmail", ownerEmailField);
addEvidence("restaurant.contactEmail", contactEmailField);
addEvidence("restaurant.websiteUrl", restaurantWebsite);
addEvidence("restaurant.instagramUrl", restaurantInstagram);
addEvidence("restaurant.facebookPageUrl", restaurantFacebook);
addEvidence("linked_user.verified_email", linkedVerifiedUserEmail);
addEvidence("import_listing.phone", listingPhoneForGate);
addEvidence("import_listing.email", listingEmailForGate);
addEvidence("import_listing.websiteUrl", listingWebsiteForGate);
addEvidence("import_listing.instagramUrl", listingInstagramForGate);
addEvidence("import_listing.facebookPageUrl", listingFacebookForGate);
addEvidence("truckImportListings.rawData.evidenceIngest.extracted.phone", extractedPhone);
addEvidence("truckImportListings.rawData.evidenceIngest.extracted.email", extractedEmail);
addEvidence(
  "truckImportListings.rawData.evidenceIngest.extracted.website",
  extractedWebsite,
);
addEvidence(
  "truckImportListings.rawData.evidenceIngest.extracted.instagram",
  extractedInstagram,
);
addEvidence(
  "truckImportListings.rawData.evidenceIngest.extracted.facebook",
  extractedFacebook,
);
const screenshotOcrSourceUrls = Array.isArray(listingEvidence.sourceUrls)
  ? listingEvidence.sourceUrls
  : [];
addEvidence(
  "truckImportListings.rawData.evidenceIngest.sourceUrls",
  screenshotOcrSourceUrls.length,
);

const hasPhoneOrEmail = Boolean(
  restaurantPhone ||
    restaurantEmail ||
    ownerEmailField ||
    contactEmailField ||
    linkedVerifiedUserEmail ||
    listingPhoneForGate ||
    listingEmailForGate ||
    restaurantWebsite ||
    restaurantInstagram ||
    restaurantFacebook ||
    listingWebsiteForGate ||
    listingInstagramForGate ||
    listingFacebookForGate ||
    extractedPhone ||
    extractedEmail ||
    extractedWebsite ||
    extractedInstagram ||
    extractedFacebook,
);

const publishGate = {
  hasName: !isBlank(restaurant.name || listing.name),
  hasCityOrArea: !isBlank(restaurant.city || listing.city),
  hasCuisine: !isBlank(restaurant.cuisineType || listing.cuisineType),
  hasPhoneOrEmail,
  hasMenuOrDeferred: hasMenu || menuDeferred,
};
const publishable = Object.values(publishGate).every(Boolean);

if (!publishable) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "publish_gate_failed",
        listingId,
        restaurantId: restaurant.id,
        businessName: restaurant.name,
        linkedUserId: linkedUser?.id || "",
        contactEvidenceSource:
          contactEvidenceSources[0] || "",
        contactEvidenceSources,
        publishGate,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (apply) {
  await db
    .update(restaurants)
    .set({ isActive: true, updatedAt: new Date() } as any)
    .where(eq(restaurants.id, restaurant.id));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      action: apply ? "published_isActive_true" : "publishable_preview",
      listingId,
      restaurantId: restaurant.id,
      businessName: restaurant.name,
      linkedUserId: linkedUser?.id || "",
      contactEvidenceSource:
        contactEvidenceSources[0] || "",
      contactEvidenceSources,
      publishGate,
    },
    null,
    2,
  ),
);
