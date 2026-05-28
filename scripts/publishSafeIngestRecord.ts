import "dotenv/config";
import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { menus, restaurants, truckImportListings, users } from "../shared/schema";

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const listingIdArg = getArg("--listing-id");
const allMode = hasFlag("--all");
const modeArg = getArg("--mode");
const legacyApply = hasFlag("--apply");
const applyMode = modeArg ? modeArg.toLowerCase() === "apply" : legacyApply;
const mode = applyMode ? "apply" : "preview";

if (!listingIdArg && !allMode) {
  throw new Error(
    "Usage: npx tsx scripts/publishSafeIngestRecord.ts --listing-id <id> [--apply] OR --mode=preview|apply --all",
  );
}
if (!db) throw new Error("DATABASE_URL is required.");

const normalize = (v: unknown) => String(v || "").trim().toLowerCase();
const normalizePhone = (v: unknown) => String(v || "").replace(/[^\d]/g, "");
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

type ListingRow = typeof truckImportListings.$inferSelect;
type RestaurantRow = typeof restaurants.$inferSelect & { ownerEmail?: string };

const addUnique = (arr: string[], value: string) => {
  if (!value) return;
  if (!arr.includes(value)) arr.push(value);
};

const collectCandidatesForListing = async (listing: ListingRow): Promise<RestaurantRow[]> => {
  const listingId = String(listing.id);
  const candidates: RestaurantRow[] = [];
  const seen = new Set<string>();
  const pushCandidates = (rows: any[]) => {
    for (const row of rows) {
      const key = String(row.id || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(row as RestaurantRow);
    }
  };

  const step1 = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.claimedFromImportId, listingId))
    .limit(25);
  pushCandidates(step1 as any[]);

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
        listingEmail ? eq(sql`lower(coalesce(${users.email}, ''))`, listingEmail) : sql`false`,
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

  return candidates;
};

const evaluateListing = async (listing: ListingRow) => {
  const listingId = String(listing.id);
  const candidates = await collectCandidatesForListing(listing);

  if (candidates.length !== 1) {
    return {
      ok: false as const,
      reason:
        candidates.length === 0 ? "no_restaurant_match" : "multiple_restaurant_matches",
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
      publishable: false,
      publishGate: null,
      contactEvidenceSources: [] as string[],
      restaurantId: "",
      businessName: listing.name || "",
      action: "none" as const,
    };
  }

  const restaurant = candidates[0] as RestaurantRow;
  const [existingMenu] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.restaurantId, String(restaurant.id)), eq(menus.isActive, true)))
    .limit(1);
  const hasMenu =
    Boolean(existingMenu?.id) ||
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
  const listingEvidence = ((listing as any)?.rawData?.evidenceIngest || {}) as Record<string, any>;
  const extractedEvidence = (listingEvidence.extracted || {}) as Record<string, any>;
  const extractedPhone = normalizePhone(extractedEvidence.phone);
  const extractedEmail = normalize(extractedEvidence.email);
  const extractedWebsite = normalize(extractedEvidence.websiteUrl || extractedEvidence.website);
  const extractedInstagram = normalize(
    extractedEvidence.instagramUrl || extractedEvidence.instagram,
  );
  const extractedFacebook = normalize(
    extractedEvidence.facebookPageUrl || extractedEvidence.facebook,
  );
  const screenshotOcrSourceUrls = Array.isArray(listingEvidence.sourceUrls)
    ? listingEvidence.sourceUrls
    : [];

  const contactEvidenceSources: string[] = [];
  addUnique(contactEvidenceSources, restaurantPhone ? "restaurant.phone" : "");
  addUnique(contactEvidenceSources, restaurantEmail ? "restaurant.email" : "");
  addUnique(contactEvidenceSources, ownerEmailField ? "restaurant.ownerEmail" : "");
  addUnique(contactEvidenceSources, contactEmailField ? "restaurant.contactEmail" : "");
  addUnique(contactEvidenceSources, restaurantWebsite ? "restaurant.websiteUrl" : "");
  addUnique(contactEvidenceSources, restaurantInstagram ? "restaurant.instagramUrl" : "");
  addUnique(contactEvidenceSources, restaurantFacebook ? "restaurant.facebookPageUrl" : "");
  addUnique(contactEvidenceSources, linkedVerifiedUserEmail ? "linked_user.verified_email" : "");
  addUnique(contactEvidenceSources, listingPhoneForGate ? "import_listing.phone" : "");
  addUnique(contactEvidenceSources, listingEmailForGate ? "import_listing.email" : "");
  addUnique(contactEvidenceSources, listingWebsiteForGate ? "import_listing.websiteUrl" : "");
  addUnique(contactEvidenceSources, listingInstagramForGate ? "import_listing.instagramUrl" : "");
  addUnique(contactEvidenceSources, listingFacebookForGate ? "import_listing.facebookPageUrl" : "");
  addUnique(
    contactEvidenceSources,
    extractedPhone ? "truckImportListings.rawData.evidenceIngest.extracted.phone" : "",
  );
  addUnique(
    contactEvidenceSources,
    extractedEmail ? "truckImportListings.rawData.evidenceIngest.extracted.email" : "",
  );
  addUnique(
    contactEvidenceSources,
    extractedWebsite ? "truckImportListings.rawData.evidenceIngest.extracted.website" : "",
  );
  addUnique(
    contactEvidenceSources,
    extractedInstagram ? "truckImportListings.rawData.evidenceIngest.extracted.instagram" : "",
  );
  addUnique(
    contactEvidenceSources,
    extractedFacebook ? "truckImportListings.rawData.evidenceIngest.extracted.facebook" : "",
  );
  addUnique(
    contactEvidenceSources,
    screenshotOcrSourceUrls.length
      ? "truckImportListings.rawData.evidenceIngest.sourceUrls"
      : "",
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

  return {
    ok: publishable,
    reason: publishable ? "" : "publish_gate_failed",
    listingId,
    listingName: listing.name,
    restaurantId: String(restaurant.id),
    businessName: String(restaurant.name || listing.name || ""),
    linkedUserId: linkedUser?.id || "",
    contactEvidenceSource: contactEvidenceSources[0] || "",
    contactEvidenceSources,
    publishGate,
    publishable,
    candidates: [],
    action: publishable ? "publishable_preview" : "none",
  };
};

const processOne = async (listing: ListingRow, apply: boolean) => {
  const evaluated = await evaluateListing(listing);
  if (!evaluated.ok) return evaluated;
  if (apply) {
    await db
      .update(restaurants)
      .set({ isActive: true, updatedAt: new Date() } as any)
      .where(eq(restaurants.id, evaluated.restaurantId));
    return { ...evaluated, action: "published_isActive_true" as const };
  }
  return evaluated;
};

const runSingle = async (listingId: string, apply: boolean) => {
  const [listing] = await db
    .select()
    .from(truckImportListings)
    .where(eq(truckImportListings.id, listingId))
    .limit(1);

  if (!listing) {
    console.log(JSON.stringify({ ok: false, reason: "listing_not_found", listingId }, null, 2));
    process.exit(0);
  }

  const result = await processOne(listing, apply);
  console.log(JSON.stringify(result, null, 2));
};

const runAll = async (apply: boolean) => {
  const rawRows = await db.execute(sql`
    select *
    from truck_import_listings til
    where til.status in ('processed', 'unclaimed')
      and til.raw_data ? 'evidenceIngest'
    order by til.created_at asc
  `);
  const listings = ((rawRows as any)?.rows || []) as ListingRow[];

  const rows: any[] = [];
  let publishedLive = 0;
  let attachedToExistingProfiles = 0;
  let newlyCreated = 0;
  let skipped = 0;
  let failed = 0;
  let duplicateRisk = 0;
  let missingEvidenceReasons = 0;
  let alreadyActive = 0;

  for (const listing of listings) {
    const result = await processOne(listing, apply);
    const restaurantId = result.restaurantId || "";
    const [rest] = restaurantId
      ? await db
          .select({
            id: restaurants.id,
            claimedFromImportId: restaurants.claimedFromImportId,
            isActive: restaurants.isActive,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1)
      : [];

    if (result.reason === "multiple_restaurant_matches") duplicateRisk += 1;
    if (result.reason === "publish_gate_failed") missingEvidenceReasons += 1;
    if (!result.ok) failed += 1;

    if (result.ok) {
      if (result.action === "published_isActive_true") publishedLive += 1;
      else skipped += 1;
      if (rest?.claimedFromImportId) attachedToExistingProfiles += 1;
      else newlyCreated += 1;
      if (rest?.isActive) alreadyActive += 1;
    } else {
      skipped += 1;
    }

    rows.push(result);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: apply ? "apply" : "preview",
        totals: {
          totalImportRecordsProcessed: listings.length,
          totalPublishedLive: publishedLive,
          totalAttachedToExistingProfiles: attachedToExistingProfiles,
          totalNewlyCreated: newlyCreated,
          totalSkipped: skipped,
          totalFailed: failed,
          duplicateConflicts: duplicateRisk,
          missingEvidenceReasons,
          alreadyActive,
          publicSearchSmokeCount: 0,
        },
        rows,
      },
      null,
      2,
    ),
  );
};

if (allMode) {
  await runAll(applyMode);
} else {
  await runSingle(listingIdArg, applyMode);
}
