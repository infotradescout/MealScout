import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings, users } from "../shared/schema";

type SeedRecord = {
  target_profile_id?: string;
  profile_name?: string;
  business_name?: string;
  name?: string;
  profile_email?: string;
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
  address?: string;
  service_area?: string;
  serviceArea?: string;
  category?: string;
  cuisine?: string;
  cuisineType?: string;
  business_type?: string;
  businessType?: string;
  onboarding_source?: string;
  source_refs?: unknown;
  submission_flow?: string;
  attribution?: unknown;
  source_file_info?: unknown;
  sourceNotes?: unknown;
  brand_lane?: string;
  brandLane?: string;
  target_profile_type?: string;
  targetProfileType?: string;
  seeded_from_evidence?: unknown;
  profile_origin?: string;
  claim_status?: string;
  email_verified?: unknown;
  insurance_verified?: unknown;
  import_decision?: string;
  importDecision?: string;
  owner_user_id?: unknown;
  ownerUserId?: unknown;
  invited_user_id?: unknown;
  invitedUserId?: unknown;
  source_actor?: string;
  sourceActor?: string;
  source_attribution?: string;
  sourceAttribution?: string;
  affiliate_user_id?: unknown;
  affiliateUserId?: unknown;
  affiliate_tag?: unknown;
  affiliateTag?: unknown;
  referral_code?: unknown;
  referralCode?: unknown;
  ref?: unknown;
  safety_flags?: unknown;
  safetyFlags?: unknown;
  [key: string]: unknown;
};

type NormalizedSeed = {
  targetProfileId: string;
  name: string;
  phone: string;
  phoneDigits: string;
  email: string;
  website: string;
  instagram: string;
  facebook: string;
  city: string;
  state: string;
  address: string;
  cuisineType: string;
  businessType: string;
  onboardingSource: "screenshot_seed" | "admin_seed" | "affiliate_seed";
  brandLane: string;
  targetProfileType: string;
  sourceRefs: unknown;
  submissionFlow: string | null;
  attribution: unknown;
  sourceFileInfo: unknown;
  sourceNotes: unknown;
  raw: SeedRecord;
  changedFields: string[];
  droppedFields: string[];
};

type MatchResult = {
  restaurant: any | null;
  listing: any | null;
  matchedBy: string;
};

type ImportDecision = {
  index: number;
  name: string;
  action: "created" | "updated" | "blocked";
  blockedReason?: string;
  matchedBy?: string;
  restaurantId?: string;
  listingId?: string;
  changedFields?: string[];
  droppedFields?: string[];
};

type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const getArg = (flag: string): string => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return "";
  return String(process.argv[i + 1] || "").trim();
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const normalize = (value: unknown): string => String(value || "").trim();
const normalizeLower = (value: unknown): string => normalize(value).toLowerCase();
const normalizePhone = (value: unknown): string => String(value || "").replace(/[^\d]/g, "");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmailLike = (value: unknown): boolean => EMAIL_RE.test(normalizeLower(value));

const isValidEmail = (value: unknown): boolean => {
  const email = normalizeLower(value);
  if (!email) return false;
  if (!EMAIL_RE.test(email)) return false;
  if (email.endsWith("@example.com")) return false;
  return true;
};

const normalizeUrlIdentity = (value: unknown): string => {
  const raw = normalize(value);
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const pathPart = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathPart}`;
  } catch {
    return normalizeLower(raw)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "");
  }
};

const isGenericOrJunkName = (value: string): boolean => {
  const name = normalize(value);
  const lower = name.toLowerCase();
  if (name.length < 4) return true;
  if (["eee", "test", "none", "n/a", "unknown", "food truck"].includes(lower)) return true;
  if (/^(.)\1{2,}$/.test(lower.replace(/\s+/g, ""))) return true;
  const alpha = name.replace(/[^a-z]/gi, "");
  if (!alpha) return true;
  if (alpha.length < 4) return true;
  const vowels = (alpha.match(/[aeiou]/gi) || []).length;
  if (vowels === 0) return true;
  const symbolRatio = name.replace(/[a-z0-9\s&'.,\-]/gi, "").length / Math.max(name.length, 1);
  if (symbolRatio > 0.25) return true;
  return false;
};

const isInvalidSocialEmailFragment = (value: unknown): boolean => {
  const raw = normalizeLower(value);
  if (!raw) return false;
  if (!raw.startsWith("@")) return false;
  return /@(gmail|yahoo|hotmail|outlook|icloud|aol)\.com$/.test(raw);
};

const normalizeSocialIdentity = (value: unknown): string => {
  const raw = normalize(value);
  if (!raw) return "";
  if (isInvalidSocialEmailFragment(raw)) return "";
  if (isEmailLike(raw)) return "";
  return normalizeUrlIdentity(raw);
};

const getSafetyField = (record: SeedRecord, key: string): unknown => {
  const root = (record as Record<string, unknown>)[key];
  if (root !== undefined) return root;
  const safetyFlags =
    record.safety_flags && typeof record.safety_flags === "object"
      ? (record.safety_flags as Record<string, unknown>)
      : record.safetyFlags && typeof record.safetyFlags === "object"
        ? (record.safetyFlags as Record<string, unknown>)
        : null;
  if (safetyFlags && key in safetyFlags) return safetyFlags[key];
  return undefined;
};

const isFalseLike = (value: unknown): boolean => {
  if (value === false) return true;
  const normalized = normalizeLower(value);
  return normalized === "false" || normalized === "0";
};

const isNullLike = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  const normalized = normalizeLower(value);
  return normalized === "" || normalized === "null" || normalized === "none";
};

const isAdminUnattributed = (raw: SeedRecord): boolean => {
  const candidates = [
    raw.source_actor,
    raw.sourceActor,
    raw.source_attribution,
    raw.sourceAttribution,
    getSafetyField(raw, "source_actor"),
    getSafetyField(raw, "source_attribution"),
  ];
  return candidates.some((value) => normalizeLower(value) === "admin_unattributed");
};

const hasAffiliateAttribution = (raw: SeedRecord): boolean => {
  const attribution =
    raw.attribution && typeof raw.attribution === "object"
      ? (raw.attribution as Record<string, unknown>)
      : {};
  const candidates = [
    raw.affiliate_user_id,
    raw.affiliateUserId,
    raw.affiliate_tag,
    raw.affiliateTag,
    raw.referral_code,
    raw.referralCode,
    raw.ref,
    getSafetyField(raw, "affiliate_user_id"),
    getSafetyField(raw, "affiliate_tag"),
    getSafetyField(raw, "referral_code"),
    attribution.affiliate_user_id,
    attribution.affiliateUserId,
    attribution.affiliate_tag,
    attribution.affiliateTag,
    attribution.referral_code,
    attribution.referralCode,
    attribution.ref,
  ];
  return candidates.some((value) => !isNullLike(value));
};

const canonicalName = (name: string): string => {
  const trimmed = normalize(name);
  if (/^mann\s+kettle\s+corn\s+\d+$/i.test(trimmed)) {
    return "MANN Kettle Corn";
  }
  return trimmed;
};

const asSafeOnboardingSource = (
  value: unknown,
): "screenshot_seed" | "admin_seed" | "affiliate_seed" => {
  const raw = normalizeLower(value);
  if (raw === "admin_seed") return "admin_seed";
  if (raw === "affiliate_seed") return "affiliate_seed";
  return "screenshot_seed";
};

const normalizeSeed = (record: SeedRecord): NormalizedSeed => {
  const changedFields: string[] = [];
  const droppedFields: string[] = [];

  const rawName = normalize(record.profile_name || record.business_name || record.name);
  const name = canonicalName(rawName);
  if (rawName && name !== rawName) changedFields.push("profile_name");

  const rawPhone = normalize(record.phone);
  const phoneDigits = normalizePhone(record.phone);
  let phone = rawPhone;
  if (phoneDigits && phoneDigits !== rawPhone) {
    phone = phoneDigits;
    changedFields.push("phone");
  }

  const rawEmail = normalize(record.profile_email || record.email);
  const email = normalizeLower(rawEmail);
  if (rawEmail && email !== rawEmail) changedFields.push("email");

  const rawWebsite = normalize(record.websiteUrl || record.website);
  let website = "";
  if (rawWebsite) {
    if (isEmailLike(rawWebsite)) {
      droppedFields.push("website");
    } else {
      website = normalizeUrlIdentity(rawWebsite);
    }
  }

  const rawInstagram = normalize(record.instagramUrl || record.instagram);
  const instagram = normalizeSocialIdentity(rawInstagram);
  if (rawInstagram && !instagram) droppedFields.push("instagram");

  const rawFacebook = normalize(record.facebookPageUrl || record.facebook);
  const facebook = normalizeSocialIdentity(rawFacebook);
  if (rawFacebook && !facebook) droppedFields.push("facebook");

  const city = normalize(record.city);
  const state = normalize(record.state);
  const address = normalize(record.address || record.service_area || record.serviceArea);
  const cuisineType = normalize(record.cuisineType || record.cuisine || record.category);
  const businessType = normalizeLower(record.businessType || record.business_type) || "food_truck";
  const brandLane = normalize(record.brand_lane || record.brandLane || "");
  const targetProfileType = normalizeLower(
    record.target_profile_type || record.targetProfileType || "",
  );

  return {
    targetProfileId: normalize(record.target_profile_id),
    name,
    phone,
    phoneDigits,
    email,
    website,
    instagram,
    facebook,
    city,
    state,
    address,
    cuisineType,
    businessType,
    onboardingSource: asSafeOnboardingSource(record.onboarding_source),
    brandLane,
    targetProfileType,
    sourceRefs: record.source_refs ?? null,
    submissionFlow: normalize(record.submission_flow) || null,
    attribution: record.attribution ?? null,
    sourceFileInfo: record.source_file_info ?? null,
    sourceNotes: record.sourceNotes ?? null,
    raw: record,
    changedFields,
    droppedFields,
  };
};

const validateSeed = (seed: NormalizedSeed): ValidationResult => {
  if (!seed.name) return { ok: false, reason: "missing_profile_name" };
  if (isGenericOrJunkName(seed.name)) return { ok: false, reason: "invalid_extraction_identity" };

  if (!seed.brandLane || normalizeLower(seed.brandLane) !== "mealscout") {
    return { ok: false, reason: "invalid_brand_lane" };
  }

  if (seed.targetProfileType !== "food_truck") {
    return { ok: false, reason: "invalid_target_profile_type" };
  }

  const raw = seed.raw;
  if (normalizeLower(getSafetyField(raw, "profile_origin") ?? raw.profile_origin) !== "evidence_seed") {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  const importDecision = normalizeLower(
    getSafetyField(raw, "import_decision") ?? raw.import_decision ?? raw.importDecision,
  );
  if (importDecision === "blocked") {
    return { ok: false, reason: "import_decision_blocked" };
  }
  if (importDecision === "review_required") {
    return { ok: false, reason: "review_required" };
  }
  if (importDecision && !["clean", "importable", "imported"].includes(importDecision)) {
    return { ok: false, reason: "invalid_import_decision" };
  }
  if (normalizeLower(getSafetyField(raw, "claim_status") ?? raw.claim_status) !== "unclaimed") {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  if (!isFalseLike(getSafetyField(raw, "email_verified") ?? raw.email_verified)) {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  if (!isFalseLike(getSafetyField(raw, "insurance_verified") ?? raw.insurance_verified)) {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  if (!isNullLike(getSafetyField(raw, "invited_user_id") ?? raw.invited_user_id ?? raw.invitedUserId)) {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  if (!isNullLike(getSafetyField(raw, "owner_user_id") ?? raw.owner_user_id ?? raw.ownerUserId)) {
    return { ok: false, reason: "invalid_safety_flags" };
  }
  if (isAdminUnattributed(raw) && hasAffiliateAttribution(raw)) {
    return { ok: false, reason: "admin_unattributed_affiliate_attribution" };
  }

  const rawSeeded = getSafetyField(raw, "seeded_from_evidence") ?? raw.seeded_from_evidence;
  if (!(rawSeeded === true || normalizeLower(rawSeeded) === "true")) {
    return { ok: false, reason: "invalid_safety_flags" };
  }

  if (seed.email && !isValidEmail(seed.email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const hasPhone = Boolean(seed.phoneDigits);
  const hasEmail = Boolean(seed.email && isValidEmail(seed.email));
  const hasWebsite = Boolean(seed.website);
  const hasSocial = Boolean(seed.instagram || seed.facebook);
  if (!hasPhone && !hasEmail && !hasWebsite && !hasSocial) {
    return { ok: false, reason: "missing_contact_identity" };
  }

  return { ok: true };
};

const hasIdentityForUpsert = (seed: NormalizedSeed): boolean => {
  if (seed.targetProfileId) return true;
  if (seed.email) return true;
  if (seed.phoneDigits) return true;
  if (seed.website || seed.instagram || seed.facebook) return true;
  if (seed.name && (seed.city || seed.state)) return true;
  return false;
};

const hasRequiredForCreate = (seed: NormalizedSeed): boolean => {
  if (!seed.name) return false;
  if (!seed.address && !seed.city && !seed.state) return false;
  return true;
};

const mergeSeedRawData = (existing: unknown, seed: NormalizedSeed) => {
  const current =
    existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {};
  const merlinSeed = {
    seeded_from_evidence: true,
    profile_origin: "evidence_seed",
    onboarding_source: seed.onboardingSource,
    source_refs: seed.sourceRefs,
    submission_flow: seed.submissionFlow,
    attribution: seed.attribution,
    source_file_info: seed.sourceFileInfo,
    source_notes: seed.sourceNotes,
    original_seed_payload: seed.raw,
    claim_status: "unclaimed",
    email_verified: false,
    insurance_verified: false,
    owner_user_id: null,
    invited_user_id: null,
    affiliate_user_id: null,
    affiliate_tag: null,
    referral_code: null,
    imported_at: new Date().toISOString(),
  };

  return {
    ...current,
    merlinSeed,
  };
};

const resolveSystemImportOwnerId = async (): Promise<string> => {
  const importEmail = normalizeLower(
    process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us",
  );
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, importEmail))
    .limit(1);

  if (!owner?.id) {
    throw new Error(
      `System import owner not found for IMPORT_SYSTEM_EMAIL=${importEmail}. Refusing to create users automatically.`,
    );
  }

  return String(owner.id);
};

const findMatches = async (seed: NormalizedSeed): Promise<MatchResult> => {
  let matchedRestaurant: any | null = null;
  let matchedListing: any | null = null;
  let matchedBy = "none";

  if (seed.targetProfileId) {
    const [restaurantById] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, seed.targetProfileId))
      .limit(1);
    if (restaurantById) {
      matchedRestaurant = restaurantById;
      matchedBy = "target_profile_id:restaurant";
      if (restaurantById.claimedFromImportId) {
        const [linked] = await db
          .select()
          .from(truckImportListings)
          .where(
            eq(
              truckImportListings.id,
              String(restaurantById.claimedFromImportId),
            ),
          )
          .limit(1);
        matchedListing = linked || null;
      }
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }

    const [listingById] = await db
      .select()
      .from(truckImportListings)
      .where(eq(truckImportListings.id, seed.targetProfileId))
      .limit(1);
    if (listingById) {
      matchedListing = listingById;
      matchedBy = "target_profile_id:listing";
      const [linkedRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.claimedFromImportId, listingById.id))
        .limit(1);
      matchedRestaurant = linkedRestaurant || null;
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }
  }

  if (seed.email) {
    const [listingByEmail] = await db
      .select()
      .from(truckImportListings)
      .where(eq(sql`lower(coalesce(${truckImportListings.email}, ''))`, seed.email))
      .limit(1);
    if (listingByEmail) {
      matchedListing = listingByEmail;
      matchedBy = "email";
      const [linkedRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.claimedFromImportId, listingByEmail.id))
        .limit(1);
      matchedRestaurant = linkedRestaurant || null;
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }
  }

  if (seed.phoneDigits) {
    const [listingByPhone] = await db
      .select()
      .from(truckImportListings)
      .where(
        eq(
          sql`regexp_replace(coalesce(${truckImportListings.phone}, ''), '[^0-9]', '', 'g')`,
          seed.phoneDigits,
        ),
      )
      .limit(1);
    if (listingByPhone) {
      matchedListing = listingByPhone;
      matchedBy = "phone";
      const [linkedRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.claimedFromImportId, listingByPhone.id))
        .limit(1);
      matchedRestaurant = linkedRestaurant || null;
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }

    const [restaurantByPhone] = await db
      .select()
      .from(restaurants)
      .where(
        eq(
          sql`regexp_replace(coalesce(${restaurants.phone}, ''), '[^0-9]', '', 'g')`,
          seed.phoneDigits,
        ),
      )
      .limit(1);
    if (restaurantByPhone) {
      matchedRestaurant = restaurantByPhone;
      matchedBy = "phone";
      if (restaurantByPhone.claimedFromImportId) {
        const [linked] = await db
          .select()
          .from(truckImportListings)
          .where(
            eq(
              truckImportListings.id,
              String(restaurantByPhone.claimedFromImportId),
            ),
          )
          .limit(1);
        matchedListing = linked || null;
      }
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }
  }

  if (seed.website || seed.instagram || seed.facebook) {
    const [listingByUrl] = await db
      .select()
      .from(truckImportListings)
      .where(
        or(
          seed.website
            ? eq(
                sql`replace(replace(replace(lower(coalesce(${truckImportListings.websiteUrl}, '')), 'https://', ''), 'http://', ''), 'www.', '')`,
                seed.website,
              )
            : sql`false`,
          seed.instagram
            ? eq(
                sql`replace(replace(replace(lower(coalesce(${truckImportListings.instagramUrl}, '')), 'https://', ''), 'http://', ''), 'www.', '')`,
                seed.instagram,
              )
            : sql`false`,
          seed.facebook
            ? eq(
                sql`replace(replace(replace(lower(coalesce(${truckImportListings.facebookPageUrl}, '')), 'https://', ''), 'http://', ''), 'www.', '')`,
                seed.facebook,
              )
            : sql`false`,
        ),
      )
      .limit(1);

    if (listingByUrl) {
      matchedListing = listingByUrl;
      matchedBy = "website_or_social";
      const [linkedRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.claimedFromImportId, listingByUrl.id))
        .limit(1);
      matchedRestaurant = linkedRestaurant || null;
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }
  }

  if (seed.name && (seed.city || seed.state)) {
    const [listingByNameLocation] = await db
      .select()
      .from(truckImportListings)
      .where(
        and(
          eq(sql`lower(${truckImportListings.name})`, normalizeLower(seed.name)),
          seed.city
            ? eq(
                sql`lower(coalesce(${truckImportListings.city}, ''))`,
                normalizeLower(seed.city),
              )
            : sql`true`,
          seed.state
            ? eq(
                sql`lower(coalesce(${truckImportListings.state}, ''))`,
                normalizeLower(seed.state),
              )
            : sql`true`,
        ),
      )
      .limit(1);

    if (listingByNameLocation) {
      matchedListing = listingByNameLocation;
      matchedBy = "name_plus_location";
      const [linkedRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.claimedFromImportId, listingByNameLocation.id))
        .limit(1);
      matchedRestaurant = linkedRestaurant || null;
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }

    const [restaurantByNameLocation] = await db
      .select()
      .from(restaurants)
      .where(
        and(
          eq(sql`lower(${restaurants.name})`, normalizeLower(seed.name)),
          seed.city
            ? eq(
                sql`lower(coalesce(${restaurants.city}, ''))`,
                normalizeLower(seed.city),
              )
            : sql`true`,
          seed.state
            ? eq(
                sql`lower(coalesce(${restaurants.state}, ''))`,
                normalizeLower(seed.state),
              )
            : sql`true`,
        ),
      )
      .limit(1);

    if (restaurantByNameLocation) {
      matchedRestaurant = restaurantByNameLocation;
      matchedBy = "name_plus_location";
      if (restaurantByNameLocation.claimedFromImportId) {
        const [linked] = await db
          .select()
          .from(truckImportListings)
          .where(
            eq(
              truckImportListings.id,
              String(restaurantByNameLocation.claimedFromImportId),
            ),
          )
          .limit(1);
        matchedListing = linked || null;
      }
      return { restaurant: matchedRestaurant, listing: matchedListing, matchedBy };
    }
  }

  return { restaurant: null, listing: null, matchedBy };
};

const upsertListing = async (
  seed: NormalizedSeed,
  existingListing: any | null,
) => {
  const rawData = mergeSeedRawData(existingListing?.rawData, seed);
  const values = {
    source: "merlin_seed_import",
    name: seed.name,
    address:
      seed.address ||
      `${seed.city}${seed.city && seed.state ? ", " : ""}${seed.state}`,
    city: seed.city || null,
    state: seed.state || null,
    phone: seed.phone || null,
    email: seed.email || null,
    cuisineType: seed.cuisineType || null,
    websiteUrl: seed.website ? `https://${seed.website}` : null,
    instagramUrl: seed.instagram ? `https://${seed.instagram}` : null,
    facebookPageUrl: seed.facebook ? `https://${seed.facebook}` : null,
    status: "unclaimed",
    invitedUserId: null,
    rawData,
    updatedAt: new Date(),
  } as any;

  if (existingListing) {
    const [updated] = await db
      .update(truckImportListings)
      .set(values)
      .where(eq(truckImportListings.id, existingListing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(truckImportListings).values(values).returning();
  return created;
};

const upsertRestaurant = async (
  seed: NormalizedSeed,
  systemOwnerId: string,
  existingRestaurant: any | null,
  listingId: string,
) => {
  const rawData = mergeSeedRawData(existingRestaurant?.rawData, seed);
  const values = {
    ownerId: systemOwnerId,
    name: seed.name,
    address:
      seed.address ||
      `${seed.city}${seed.city && seed.state ? ", " : ""}${seed.state}`,
    phone: seed.phone || null,
    businessType: seed.businessType || "food_truck",
    cuisineType: seed.cuisineType || null,
    city: seed.city || null,
    state: seed.state || null,
    isFoodTruck:
      seed.businessType === "food_truck" || seed.businessType === "truck",
    isActive: false,
    isVerified: false,
    insuranceVerified: false,
    claimedFromImportId: listingId,
    rawData,
    updatedAt: new Date(),
  } as any;

  if (existingRestaurant) {
    const [updated] = await db
      .update(restaurants)
      .set(values)
      .where(eq(restaurants.id, existingRestaurant.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(restaurants).values(values).returning();
  return created;
};

const buildReport = (input: {
  inputFile: string;
  decisions: ImportDecision[];
  systemOwnerId: string;
  importedRestaurantIds: string[];
  importedListingIds: string[];
}) => {
  const total = input.decisions.length;
  const created = input.decisions.filter((d) => d.action === "created").length;
  const updated = input.decisions.filter((d) => d.action === "updated").length;
  const imported = created + updated;
  const blocked = input.decisions.filter((d) => d.action === "blocked").length;

  const blockedByReason = input.decisions
    .filter((d) => d.action === "blocked")
    .reduce<Record<string, number>>((acc, item) => {
      const reason = item.blockedReason || "unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

  return [
    `input_file: ${input.inputFile}`,
    `total_records_read: ${total}`,
    `records_imported_count: ${imported}`,
    `records_created_count: ${created}`,
    `records_updated_count: ${updated}`,
    `records_blocked_count: ${blocked}`,
    `system_import_owner_id_used: ${input.systemOwnerId}`,
    `truck_import_listings_rows_touched: ${input.importedListingIds.length}`,
    `imported_restaurant_profile_ids: ${input.importedRestaurantIds.join(",") || "none"}`,
    `imported_truck_import_listing_ids: ${input.importedListingIds.join(",") || "none"}`,
    "safety_confirmation: seeded_from_evidence=true, profile_origin=evidence_seed, claim_status=unclaimed, owner_user_id=null, invitedUserId=null, email_verified=false, insurance_verified=false, affiliate_user_id=null",
    `blocked_reasons: ${JSON.stringify(blockedByReason)}`,
    "normalization_changes:",
    ...input.decisions.map(
      (d) =>
        `- row=${d.index} changed=${(d.changedFields || []).join(",") || "none"} dropped=${(d.droppedFields || []).join(",") || "none"}`,
    ),
    "duplicate_update_decisions:",
    ...input.decisions.map(
      (d) =>
        `- row=${d.index} name=${d.name} action=${d.action} matched_by=${d.matchedBy || "n/a"} restaurant_id=${d.restaurantId || ""} listing_id=${d.listingId || ""} reason=${d.blockedReason || ""}`,
    ),
  ].join("\n");
};

const main = async () => {
  const inputFile = getArg("--input") || "merlin-profile-seed-export.json";
  const limitArg = Number(getArg("--limit") || "0");
  const apply = hasFlag("--apply");
  const reportPath =
    getArg("--report") ||
    path.resolve(process.cwd(), "mealscout-merlin-profile-seed-import-report.txt");

  if (!db) {
    throw new Error("DATABASE_URL is required.");
  }

  const absoluteInput = path.isAbsolute(inputFile)
    ? inputFile
    : path.resolve(process.cwd(), inputFile);

  const raw = readFileSync(absoluteInput, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Input file must be a JSON array of seed records.");
  }

  const sliced = limitArg > 0 ? parsed.slice(0, limitArg) : parsed;
  const seeds = sliced.map((r: SeedRecord) => normalizeSeed(r));

  const systemOwnerId = await resolveSystemImportOwnerId();
  const decisions: ImportDecision[] = [];
  const importedRestaurantIds = new Set<string>();
  const importedListingIds = new Set<string>();

  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    const row = i + 1;

    const validation = validateSeed(seed);
    if (!validation.ok) {
      decisions.push({
        index: row,
        name: seed.name || "(missing)",
        action: "blocked",
        blockedReason: validation.reason,
        changedFields: seed.changedFields,
        droppedFields: seed.droppedFields,
      });
      continue;
    }

    if (!hasIdentityForUpsert(seed)) {
      decisions.push({
        index: row,
        name: seed.name || "(missing)",
        action: "blocked",
        blockedReason: "missing_required_identity",
        changedFields: seed.changedFields,
        droppedFields: seed.droppedFields,
      });
      continue;
    }

    const match = await findMatches(seed);

    const willCreate = !match.restaurant && !match.listing;
    if (willCreate && !hasRequiredForCreate(seed)) {
      decisions.push({
        index: row,
        name: seed.name || "(missing)",
        action: "blocked",
        blockedReason: "missing_required_fields_for_create",
        matchedBy: match.matchedBy,
        changedFields: seed.changedFields,
        droppedFields: seed.droppedFields,
      });
      continue;
    }

    if (!apply) {
      decisions.push({
        index: row,
        name: seed.name || "(missing)",
        action: willCreate ? "created" : "updated",
        matchedBy: match.matchedBy,
        restaurantId: match.restaurant?.id
          ? String(match.restaurant.id)
          : undefined,
        listingId: match.listing?.id ? String(match.listing.id) : undefined,
        changedFields: seed.changedFields,
        droppedFields: seed.droppedFields,
      });
      continue;
    }

    const listing = await upsertListing(seed, match.listing);
    const restaurant = await upsertRestaurant(
      seed,
      systemOwnerId,
      match.restaurant,
      String(listing.id),
    );

    importedListingIds.add(String(listing.id));
    importedRestaurantIds.add(String(restaurant.id));

    decisions.push({
      index: row,
      name: seed.name || "(missing)",
      action: willCreate ? "created" : "updated",
      matchedBy: match.matchedBy,
      restaurantId: String(restaurant.id),
      listingId: String(listing.id),
      changedFields: seed.changedFields,
      droppedFields: seed.droppedFields,
    });
  }

  let adminVisibleCount = 0;
  let publicEligibleCount = 0;
  if (apply && importedListingIds.size > 0) {
    const listingIds = Array.from(importedListingIds);
    const adminRows = await db
      .select({ id: truckImportListings.id, status: truckImportListings.status })
      .from(truckImportListings)
      .where(inArray(truckImportListings.id as any, listingIds as any));
    adminVisibleCount = adminRows.length;
    publicEligibleCount = adminRows.filter((r: any) => String(r.status) === "unclaimed").length;
  }

  const report = buildReport({
    inputFile: absoluteInput,
    decisions,
    systemOwnerId,
    importedRestaurantIds: Array.from(importedRestaurantIds),
    importedListingIds: Array.from(importedListingIds),
  });

  const visibilityLines = [
    `admin_visibility_proof: ${apply ? `${adminVisibleCount} listing row(s) found in truck_import_listings` : "not_checked_in_dry_run"}`,
    `public_customer_visibility_proof: ${apply ? `${publicEligibleCount} listing row(s) in unclaimed status (eligible for public claim search path)` : "not_checked_in_dry_run"}`,
  ].join("\n");

  writeFileSync(reportPath, `${report}\n${visibilityLines}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply,
        inputFile: absoluteInput,
        reportPath,
        totals: {
          totalRecordsRead: decisions.length,
          imported: decisions.filter((d) => d.action !== "blocked").length,
          created: decisions.filter((d) => d.action === "created").length,
          updated: decisions.filter((d) => d.action === "updated").length,
          blocked: decisions.filter((d) => d.action === "blocked").length,
        },
      },
      null,
      2,
    ),
  );
};

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error("import-merlin-profile-seeds failed:", error);
    process.exit(1);
  });
}

export const __testables = {
  normalizeSeed,
  validateSeed,
  isValidEmail,
  isEmailLike,
  isGenericOrJunkName,
  isInvalidSocialEmailFragment,
  mergeSeedRawData,
  canonicalName,
};
