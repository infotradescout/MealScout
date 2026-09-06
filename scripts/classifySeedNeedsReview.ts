import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings, users } from "../shared/schema";

/**
 * Read-only triage for the "needs_review" rows produced by
 * mealscout-bulk-truck-ingest.ts. No writes.
 *
 * The ingest script flags a row "needs_review" whenever it finds >1 "strong"
 * match (score >= 10) across restaurants + truck_import_listings combined.
 * But a restaurant and its own truck_import_listings companion (linked via
 * restaurants.claimedFromImportId) always score as 2 separate strong matches
 * for the SAME real-world business - so any business that already exists as
 * a normal restaurant+listing pair trips this every time it reappears in a
 * later seed file, even though there's nothing to resolve.
 *
 * This script re-derives each needs_review row's strong matches (same scoring
 * as the ingest script) and collapses linked restaurant/listing pairs into a
 * single "identity" before classifying:
 *   - existing_pair_noise: collapses to exactly 1 identity - false alarm.
 *   - multi_location_or_dup: 2+ identities, at least one has the same
 *     name+city as the input row - a real judgment call (same brand /
 *     multiple locations / duplicate address).
 *   - shares_contact_different_name: 2+ identities, none share the input
 *     row's name+city - matched purely via phone/email/website coincidence;
 *     most likely to be a genuinely new business that got wrongly blocked.
 *
 * Usage:
 *   node --import tsx scripts/classifySeedNeedsReview.ts --report <path-to-report.json> [--samples 5]
 */

const getArg = (flag: string, dflt = "") => {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=").slice(1).join("=").trim();
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? String(process.argv[idx + 1] || "").trim() : dflt;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeLower = (value: unknown) => normalize(value).toLowerCase();
const normalizePhone = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");
const slugName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
  return platform === "instagram"
    ? `https://instagram.com/${handle}`
    : `https://facebook.com/${handle.replace(/\s+/g, "")}`;
};

type InputRow = Record<string, unknown>;

const normalizeInputRow = (record: InputRow) => ({
  businessName: normalize(record.business_name || record.name),
  city: normalize(record.city),
  phoneDigits: normalizePhone(record.phone),
  email: normalizeLower(record.email),
  websiteUrl: toWebsite(record.websiteUrl || record.website),
  instagramUrl: toSocialUrl(record.instagramUrl || record.instagram, "instagram"),
  facebookPageUrl: toSocialUrl(record.facebookPageUrl || record.facebook, "facebook"),
});

const findMatches = async (r: ReturnType<typeof normalizeInputRow>) => {
  const restaurantCandidates = await db
    .select()
    .from(restaurants)
    .where(
      or(
        r.phoneDigits
          ? eq(sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`, r.phoneDigits)
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
          ? sql`lower(${restaurants.name}) = ${normalizeLower(r.businessName)} and lower(coalesce(${restaurants.city}, '')) = ${normalizeLower(r.city)}`
          : sql`false`,
      ),
    )
    .leftJoin(users, eq(restaurants.ownerId, users.id))
    .limit(20);

  const listingCandidates = await db
    .select()
    .from(truckImportListings)
    .where(
      or(
        r.phoneDigits
          ? eq(sql`regexp_replace(coalesce(${truckImportListings.phone}, ''), '[^0-9]', '', 'g')`, r.phoneDigits)
          : sql`false`,
        r.email ? eq(sql`lower(coalesce(${truckImportListings.email}, ''))`, r.email) : sql`false`,
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
          ? sql`lower(${truckImportListings.name}) = ${normalizeLower(r.businessName)} and lower(coalesce(${truckImportListings.city}, '')) = ${normalizeLower(r.city)}`
          : sql`false`,
      ),
    )
    .limit(20);

  const scoreRestaurant = (row: any) => {
    let score = 0;
    const ownerEmail = normalizeLower(row.users?.email);
    if (r.phoneDigits && normalizePhone(row.restaurants.phone) === r.phoneDigits) score += 10;
    if (r.email && ownerEmail && ownerEmail === r.email) score += 10;
    if (r.websiteUrl && normalizeLower(row.restaurants.websiteUrl).includes(normalizeLower(r.websiteUrl))) score += 6;
    if (r.instagramUrl && normalizeLower(row.restaurants.instagramUrl).includes(normalizeLower(r.instagramUrl))) score += 6;
    if (r.facebookPageUrl && normalizeLower(row.restaurants.facebookPageUrl).includes(normalizeLower(r.facebookPageUrl))) score += 6;
    const nameMatch = slugName(row.restaurants.name || "") === slugName(r.businessName || "");
    if (nameMatch && normalizeLower(row.restaurants.city) === normalizeLower(r.city)) score += 5;
    return score;
  };
  const scoreListing = (row: any) => {
    let score = 0;
    if (r.phoneDigits && normalizePhone(row.phone) === r.phoneDigits) score += 10;
    if (r.email && normalizeLower(row.email) === r.email) score += 10;
    if (r.websiteUrl && normalizeLower(row.websiteUrl).includes(normalizeLower(r.websiteUrl))) score += 6;
    if (r.instagramUrl && normalizeLower(row.instagramUrl).includes(normalizeLower(r.instagramUrl))) score += 6;
    if (r.facebookPageUrl && normalizeLower(row.facebookPageUrl).includes(normalizeLower(r.facebookPageUrl))) score += 6;
    const nameMatch = slugName(row.name || "") === slugName(r.businessName || "");
    if (nameMatch && normalizeLower(row.city) === normalizeLower(r.city)) score += 5;
    return score;
  };

  const scoredRestaurants = restaurantCandidates
    .map((row: any) => ({ row: row.restaurants, score: scoreRestaurant(row) }))
    .filter((x: any) => x.score >= 10);
  const scoredListings = listingCandidates
    .map((row: any) => ({ row, score: scoreListing(row) }))
    .filter((x: any) => x.score >= 10);

  return { scoredRestaurants, scoredListings };
};

type Bucket = "existing_pair_noise" | "multi_location_or_dup" | "shares_contact_different_name";

async function main() {
  const reportPath = getArg("--report");
  const sampleSize = Number(getArg("--samples", "5")) || 5;
  if (!reportPath) throw new Error("Missing --report <path>");

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const inputPath = path.isAbsolute(report.input)
    ? report.input
    : path.resolve(process.cwd(), report.input);
  const inputRows: InputRow[] = JSON.parse(readFileSync(inputPath, "utf8"));

  if (report.rows.length !== inputRows.length) {
    console.warn(
      `WARNING: report.rows.length (${report.rows.length}) != input.length (${inputRows.length}); index alignment may be off.`,
    );
  }

  const buckets: Record<Bucket, { count: number; samples: string[] }> = {
    existing_pair_noise: { count: 0, samples: [] },
    multi_location_or_dup: { count: 0, samples: [] },
    shares_contact_different_name: { count: 0, samples: [] },
  };
  const reviewRows: Array<{
    bucket: Bucket;
    inputBusinessName: string;
    inputCity: string;
    identities: Array<{ type: "restaurant" | "listing"; id: string; name: string; city: string; address: string; phone: string }>;
  }> = [];

  let processed = 0;
  for (let i = 0; i < report.rows.length; i += 1) {
    const reportRow = report.rows[i];
    if (reportRow.action !== "needs_review") continue;
    if (!reportRow.conflicts?.includes("multiple_strong_matches")) continue;

    const input = normalizeInputRow(inputRows[i] || {});
    const { scoredRestaurants, scoredListings } = await findMatches(input);

    const linkedListingIds = new Set(
      scoredRestaurants.map((x: any) => x.row.claimedFromImportId).filter(Boolean),
    );
    const orphanListings = scoredListings.filter((x: any) => !linkedListingIds.has(x.row.id));
    const totalIdentities = scoredRestaurants.length + orphanListings.length;

    const exactNameCityMatch = [...scoredRestaurants.map((x: any) => x.row), ...orphanListings.map((x: any) => x.row)].some(
      (row: any) =>
        normalizeLower(row.name) === normalizeLower(input.businessName) &&
        normalizeLower(row.city) === normalizeLower(input.city),
    );

    let bucket: Bucket;
    if (totalIdentities <= 1) bucket = "existing_pair_noise";
    else if (exactNameCityMatch) bucket = "multi_location_or_dup";
    else bucket = "shares_contact_different_name";

    buckets[bucket].count += 1;
    if (buckets[bucket].samples.length < sampleSize) {
      buckets[bucket].samples.push(`${input.businessName} (${input.city}) - identities=${totalIdentities}`);
    }
    if (bucket !== "existing_pair_noise") {
      reviewRows.push({
        bucket,
        inputBusinessName: input.businessName,
        inputCity: input.city,
        identities: [
          ...scoredRestaurants.map((x: any) => ({
            type: "restaurant" as const,
            id: String(x.row.id),
            name: String(x.row.name || ""),
            city: String(x.row.city || ""),
            address: String(x.row.address || ""),
            phone: String(x.row.phone || ""),
          })),
          ...orphanListings.map((x: any) => ({
            type: "listing" as const,
            id: String(x.row.id),
            name: String(x.row.name || ""),
            city: String(x.row.city || ""),
            address: String(x.row.address || ""),
            phone: String(x.row.phone || ""),
          })),
        ],
      });
    }
    processed += 1;
    if (processed % 250 === 0) console.log(`  ...processed ${processed}`);
  }

  console.log(`\nProcessed ${processed} needs_review rows with conflict=multiple_strong_matches.\n`);
  for (const [name, data] of Object.entries(buckets)) {
    console.log(`${name}: ${data.count}`);
    for (const s of data.samples) console.log(`    - ${s}`);
  }

  const outPath = getArg("--out");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(reviewRows, null, 2));
    console.log(`\nWrote ${reviewRows.length} review-worthy rows to ${outPath}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("classifySeedNeedsReview failed:", e);
  process.exit(1);
});
