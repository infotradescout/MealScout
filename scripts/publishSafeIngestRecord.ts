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
const linkedVerifiedUserEmail =
  linkedUser?.emailVerified && normalize(linkedUser?.email)
    ? normalize(String(linkedUser.email))
    : "";
const listingEmailForGate = normalize(listing.email);

let contactEvidenceSource = "";
if (restaurantPhone) contactEvidenceSource = "restaurant.phone";
else if (restaurantEmail) contactEvidenceSource = "restaurant.email";
else if (ownerEmailField) contactEvidenceSource = "restaurant.ownerEmail";
else if (contactEmailField) contactEvidenceSource = "restaurant.contactEmail";
else if (linkedVerifiedUserEmail) contactEvidenceSource = "linked_user.verified_email";
else if (listingEmailForGate) contactEvidenceSource = "import_listing.email";

const hasPhoneOrEmail = Boolean(
  restaurantPhone ||
    restaurantEmail ||
    ownerEmailField ||
    contactEmailField ||
    linkedVerifiedUserEmail ||
    listingEmailForGate,
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
        contactEvidenceSource,
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
      contactEvidenceSource,
      publishGate,
    },
    null,
    2,
  ),
);
