import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings, users } from "../shared/schema";

type BatchRow = {
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
  cuisineType?: string;
  description?: string;
  sourceNotes?: string[];
  confidence?: string;
  [key: string]: unknown;
};

type Decision = {
  businessName: string;
  action: "attach_to_existing" | "create_new_draft" | "skip";
  targetRestaurantId?: string;
  targetImportListingId?: string;
  reason?: string;
};

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};
const hasFlag = (flag: string) => process.argv.includes(flag);

const reportPathArg = getArg("--report");
const batchPathArg = getArg("--batch");
const decisionsPathArg = getArg("--decisions");
const apply = hasFlag("--apply");

if (!reportPathArg || !batchPathArg) {
  throw new Error(
    "Usage: node --import tsx scripts/resolveProfileEvidenceConflicts.ts --report <report.json> --batch <batch.json> [--decisions <decisions.json>] [--apply]",
  );
}
if (!db) throw new Error("DATABASE_URL is required.");

const normalize = (v: unknown) => String(v || "").trim();
const normalizeLower = (v: unknown) => normalize(v).toLowerCase();
const normalizePhone = (v: unknown) => String(v || "").replace(/[^\d]/g, "");
const slugName = (v: unknown) =>
  normalize(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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

const ensureImportSystemUserId = async () => {
  const importEmail =
    normalizeLower(process.env.IMPORT_SYSTEM_EMAIL) || "system-import@mealscout.us";
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, importEmail))
    .limit(1);
  if (existing?.id) return String(existing.id);
  const [created] = await db
    .insert(users)
    .values({
      email: importEmail,
      firstName: "System",
      lastName: "Import",
      userType: "admin",
      appContext: "mealscout",
    } as any)
    .returning({ id: users.id });
  return String(created.id);
};

const signalScore = (incoming: any, row: any, ownerEmail?: string) => {
  let score = 0;
  const signals: string[] = [];
  if (
    incoming.phoneDigits &&
    normalizePhone(row.phone || row.restaurants?.phone) === incoming.phoneDigits
  ) {
    score += 10;
    signals.push("phone");
  }
  const rowEmail = normalizeLower(ownerEmail || row.email);
  if (incoming.email && rowEmail && rowEmail === incoming.email) {
    score += 10;
    signals.push("email");
  }
  const rowWebsite = normalizeLower(row.websiteUrl || row.restaurants?.websiteUrl);
  if (incoming.websiteUrl && rowWebsite.includes(normalizeLower(incoming.websiteUrl))) {
    score += 6;
    signals.push("website");
  }
  const rowIg = normalizeLower(row.instagramUrl || row.restaurants?.instagramUrl);
  if (incoming.instagramUrl && rowIg.includes(normalizeLower(incoming.instagramUrl))) {
    score += 6;
    signals.push("instagram");
  }
  const rowFb = normalizeLower(row.facebookPageUrl || row.restaurants?.facebookPageUrl);
  if (incoming.facebookPageUrl && rowFb.includes(normalizeLower(incoming.facebookPageUrl))) {
    score += 6;
    signals.push("facebook");
  }
  const rowName = slugName(row.name || row.restaurants?.name);
  if (rowName && incoming.nameSlug && rowName === incoming.nameSlug) {
    score += 4;
    signals.push("name");
  }
  const rowCity = normalizeLower(row.city || row.restaurants?.city);
  if (incoming.city && rowCity && rowCity === incoming.city) {
    score += 2;
    signals.push("city");
  }
  const rowState = normalizeLower(row.state || row.restaurants?.state);
  if (incoming.state && rowState && rowState === incoming.state) {
    score += 1;
    signals.push("state");
  }
  return { score, signals };
};

const parseJson = (p: string) =>
  JSON.parse(readFileSync(path.isAbsolute(p) ? p : path.resolve(process.cwd(), p), "utf8"));

const batchRows: BatchRow[] = parseJson(batchPathArg);
const report = parseJson(reportPathArg);
const decisions: Decision[] = decisionsPathArg ? parseJson(decisionsPathArg) : [];
const decisionsMap = new Map(decisions.map((d) => [normalizeLower(d.businessName), d]));

const findBatch = (businessName: string) =>
  batchRows.find(
    (b) =>
      normalizeLower(b.business_name || b.name) === normalizeLower(businessName),
  );

const run = async () => {
  const needsReview = Array.isArray(report?.rows)
    ? report.rows.filter((r: any) => String(r.action) === "needs_review")
    : [];

  const out: any[] = [];
  const applyResults: any[] = [];
  const importOwnerId = apply ? await ensureImportSystemUserId() : "";

  for (const row of needsReview) {
    const businessName = String(row.businessName || "").trim();
    const batch = findBatch(businessName);
    if (!batch) {
      out.push({
        businessName,
        error: "missing_batch_record",
      });
      continue;
    }

    const incoming = {
      businessName,
      phoneDigits: normalizePhone(batch.phone),
      email: normalizeLower(batch.email),
      websiteUrl: toWebsite(batch.websiteUrl || batch.website),
      instagramUrl: toSocialUrl(batch.instagramUrl || batch.instagram, "instagram"),
      facebookPageUrl: toSocialUrl(batch.facebookPageUrl || batch.facebook, "facebook"),
      city: normalizeLower(batch.city),
      state: normalizeLower(batch.state),
      nameSlug: slugName(batch.business_name || batch.name),
      category: normalize(batch.category || batch.cuisineType),
      address: normalize(batch.address),
    };

    const restaurantCandidates = await db
      .select()
      .from(restaurants)
      .leftJoin(users, eq(restaurants.ownerId, users.id))
      .where(
        or(
          incoming.phoneDigits
            ? eq(
                sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`,
                incoming.phoneDigits,
              )
            : sql`false`,
          incoming.websiteUrl
            ? sql`lower(coalesce(${restaurants.websiteUrl}, '')) like ${`%${normalizeLower(incoming.websiteUrl)}%`}`
            : sql`false`,
          incoming.instagramUrl
            ? sql`lower(coalesce(${restaurants.instagramUrl}, '')) like ${`%${normalizeLower(incoming.instagramUrl)}%`}`
            : sql`false`,
          incoming.facebookPageUrl
            ? sql`lower(coalesce(${restaurants.facebookPageUrl}, '')) like ${`%${normalizeLower(incoming.facebookPageUrl)}%`}`
            : sql`false`,
          incoming.nameSlug && incoming.city
            ? and(
                sql`lower(${restaurants.name}) = ${normalizeLower(businessName)}`,
                sql`lower(coalesce(${restaurants.city}, '')) = ${incoming.city}`,
              )
            : sql`false`,
        ),
      )
      .limit(12);

    const listingCandidates = await db
      .select()
      .from(truckImportListings)
      .where(
        or(
          incoming.phoneDigits
            ? eq(
                sql`regexp_replace(coalesce(${truckImportListings.phone}, ''), '[^0-9]', '', 'g')`,
                incoming.phoneDigits,
              )
            : sql`false`,
          incoming.email
            ? eq(sql`lower(coalesce(${truckImportListings.email}, ''))`, incoming.email)
            : sql`false`,
          incoming.websiteUrl
            ? sql`lower(coalesce(${truckImportListings.websiteUrl}, '')) like ${`%${normalizeLower(incoming.websiteUrl)}%`}`
            : sql`false`,
          incoming.instagramUrl
            ? sql`lower(coalesce(${truckImportListings.instagramUrl}, '')) like ${`%${normalizeLower(incoming.instagramUrl)}%`}`
            : sql`false`,
          incoming.facebookPageUrl
            ? sql`lower(coalesce(${truckImportListings.facebookPageUrl}, '')) like ${`%${normalizeLower(incoming.facebookPageUrl)}%`}`
            : sql`false`,
          incoming.nameSlug && incoming.city
            ? and(
                sql`lower(${truckImportListings.name}) = ${normalizeLower(businessName)}`,
                sql`lower(coalesce(${truckImportListings.city}, '')) = ${incoming.city}`,
              )
            : sql`false`,
        ),
      )
      .limit(12);

    const scoredRestaurants = restaurantCandidates
      .map((r: any) => {
        const sig = signalScore(incoming, r.restaurants, r.users?.email);
        return {
          candidateType: "restaurant",
          id: String(r.restaurants.id),
          name: r.restaurants.name,
          city: r.restaurants.city,
          state: r.restaurants.state,
          isActive: r.restaurants.isActive,
          isVerified: r.restaurants.isVerified,
          claimedFromImportId: r.restaurants.claimedFromImportId,
          score: sig.score,
          signals: sig.signals,
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const scoredListings = listingCandidates
      .map((l: any) => {
        const sig = signalScore(incoming, l);
        return {
          candidateType: "import_listing",
          id: String(l.id),
          name: l.name,
          city: l.city,
          state: l.state,
          status: l.status,
          score: sig.score,
          signals: sig.signals,
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const decision = decisionsMap.get(normalizeLower(businessName));
    const item: any = {
      businessName,
      originalConflicts: row.conflicts || [],
      candidates: [...scoredRestaurants, ...scoredListings].sort(
        (a, b) => b.score - a.score,
      ),
      decision: decision || null,
      applied: false,
    };

    if (apply && decision) {
      if (decision.action === "skip") {
        item.applied = true;
        applyResults.push({ businessName, action: "skip", ok: true });
      } else if (decision.action === "create_new_draft") {
        const [listing] = await db
          .insert(truckImportListings)
          .values({
            source: "conflict_resolver_manual",
            name: businessName,
            address: incoming.address || "Unknown",
            city: normalize(batch.city) || null,
            state: normalize(batch.state) || null,
            phone: normalize(batch.phone) || null,
            email: normalizeLower(batch.email) || null,
            cuisineType: incoming.category || null,
            websiteUrl: incoming.websiteUrl || null,
            instagramUrl: incoming.instagramUrl || null,
            facebookPageUrl: incoming.facebookPageUrl || null,
            status: "unclaimed",
            confidenceScore: 65,
            rawData: {
              conflictResolver: {
                appliedAt: new Date().toISOString(),
                businessName,
                decision,
              },
            },
          } as any)
          .returning({ id: truckImportListings.id });

        const [createdRestaurant] = await db
          .insert(restaurants)
          .values({
            ownerId: importOwnerId,
            name: businessName,
            address: incoming.address || "Unknown",
            phone: normalize(batch.phone) || null,
            businessType: "food_truck",
            cuisineType: incoming.category || null,
            city: normalize(batch.city) || null,
            state: normalize(batch.state) || null,
            websiteUrl: incoming.websiteUrl || null,
            instagramUrl: incoming.instagramUrl || null,
            facebookPageUrl: incoming.facebookPageUrl || null,
            isFoodTruck: true,
            isActive: false,
            isVerified: false,
            claimedFromImportId: listing.id,
          } as any)
          .returning({ id: restaurants.id });

        item.applied = true;
        item.result = {
          createdImportListingId: String(listing.id),
          createdRestaurantId: String(createdRestaurant.id),
        };
        applyResults.push({ businessName, action: "create_new_draft", ok: true });
      } else if (decision.action === "attach_to_existing") {
        if (!decision.targetRestaurantId && !decision.targetImportListingId) {
          applyResults.push({
            businessName,
            action: "attach_to_existing",
            ok: false,
            error: "missing_target_ids",
          });
        } else {
          if (decision.targetImportListingId) {
            const [listing] = await db
              .select()
              .from(truckImportListings)
              .where(eq(truckImportListings.id, decision.targetImportListingId))
              .limit(1);
            if (listing) {
              await db
                .update(truckImportListings)
                .set({
                  rawData: {
                    ...((listing as any).rawData || {}),
                    conflictResolver: {
                      appliedAt: new Date().toISOString(),
                      businessName,
                      decision,
                    },
                  },
                  updatedAt: new Date(),
                } as any)
                .where(eq(truckImportListings.id, listing.id));
            }
          }
          if (decision.targetRestaurantId) {
            await db
              .update(restaurants)
              .set({ updatedAt: new Date() } as any)
              .where(eq(restaurants.id, decision.targetRestaurantId));
          }
          item.applied = true;
          item.result = {
            attachedRestaurantId: decision.targetRestaurantId || "",
            attachedImportListingId: decision.targetImportListingId || "",
          };
          applyResults.push({ businessName, action: "attach_to_existing", ok: true });
        }
      }
    }

    out.push(item);
  }

  const reportOut = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "preview",
    sourceReportPath: path.resolve(process.cwd(), reportPathArg),
    sourceBatchPath: path.resolve(process.cwd(), batchPathArg),
    decisionsPath: decisionsPathArg
      ? path.resolve(process.cwd(), decisionsPathArg)
      : null,
    conflicts: out,
    applyResults,
  };

  const outputPath = path.resolve(
    process.cwd(),
    `mealscout_conflict_resolver_report_${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify(reportOut, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputPath, mode: reportOut.mode }, null, 2));
};

run().catch((error) => {
  console.error("resolveProfileEvidenceConflicts failed:", error);
  process.exit(1);
});

