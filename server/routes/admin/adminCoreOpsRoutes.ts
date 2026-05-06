import type { Express } from "express";
import Stripe from "stripe";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { createEmailVerificationUrl } from "../../utils/emailVerification";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";
import { db } from "../../db";
import { emailService, isEmailConfigured } from "../../emailService";
import { sendAdminDailyDigest } from "../../services/adminDailyDigest";
import { sendOwnerDiscoverabilityAlerts } from "../../services/ownerDiscoverabilityAlerts";
import { sendOwnerProfileRecoveryEmail } from "../../services/ownerProfileRecovery";
import {
  shouldAttemptGoogleHostAutoLink,
  shouldAttemptGoogleRestaurantAutoLink,
} from "../../services/googleBusinessAutoLink";
import {
  isGoogleManagedImageUrl,
  populateHostProfile,
  populateRestaurantProfile,
} from "../../services/googleProfileService";
import { ensureAffiliateTag } from "../../affiliateTagService";
import {
  getPublicBusinessVisibilityChecks,
  isPublicBusinessVisible,
} from "../../utils/publicBusinessVisibility";
import {
  eventBookings,
  events,
  eventSeries,
  foodTruckLocations,
  foodTruckSessions,
  users,
  restaurants,
  hosts,
  suppliers,
  supplierProducts,
  mediaAssets,
  menus,
  menuItems,
  menuImportLogs,
  businessInsuranceVerifications,
} from "@shared/schema";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const parseAdminAuditPhotos = (value: unknown): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hasAdminAuditPhoto = (restaurant: any): boolean => {
  const suppressGoogleImages =
    Boolean(restaurant?.isFoodTruck) ||
    String(restaurant?.businessType || "").toLowerCase() === "food_truck" ||
    Boolean(String(restaurant?.claimedFromImportId || "").trim());
  const direct = [
    restaurant?.logoUrl,
    suppressGoogleImages && isGoogleManagedImageUrl(restaurant?.coverImageUrl)
      ? null
      : restaurant?.coverImageUrl,
    restaurant?.facebookCoverUrl,
  ].some((value) => String(value || "").trim().length >= 8);
  if (direct) return true;

  const galleries = suppressGoogleImages
    ? [restaurant?.facebookPhotos]
    : [restaurant?.googlePhotos, restaurant?.facebookPhotos];

  return galleries.some((value) =>
    parseAdminAuditPhotos(value).some((photo) =>
      String(
        photo?.url ||
          photo?.imageUrl ||
          photo?.photoUrl ||
          photo?.src ||
          photo?.name ||
          photo?.photoName ||
          photo?.photoReference ||
          "",
      ).trim(),
    ),
  );
};

const labelPublicDataIssue = (issue: string) => {
  const labels: Record<string, string> = {
    missing_name: "Missing name",
    missing_location: "Missing location",
    missing_category: "Missing category",
    flagged_test_data: "Looks like test data",
    non_public_profile_source: "Non-public source",
    non_public_owner_email: "Demo owner email",
    closed_permanently: "Closed permanently",
    missing_description_or_photo: "Missing description/photo",
  };
  return labels[issue] || issue.replace(/_/g, " ");
};

const resolveAdminPublicBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVICE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

const toShareSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const profileVisibilityForUser = (user: any) =>
  String(user?.accountSettings?.privacy?.profileVisibility || "public")
    .trim()
    .toLowerCase();

const isOwnerProfilePublic = (user: any) =>
  profileVisibilityForUser(user) === "public";

const firstAdminPhotoUrl = (...values: unknown[]) => {
  for (const value of values) {
    const direct = String(value || "").trim();
    if (/^https?:\/\//i.test(direct) || direct.startsWith("/")) {
      return direct;
    }

    const gallery = parseAdminAuditPhotos(value);
    for (const photo of gallery) {
      const url = String(
        photo?.url ||
          photo?.imageUrl ||
          photo?.photoUrl ||
          photo?.src ||
          "",
      ).trim();
      if (url) return url;

      const googlePhotoName = String(
        photo?.name || photo?.photoName || photo?.photoReference || "",
      ).trim();
      if (googlePhotoName) {
        return `/api/google/photo?name=${encodeURIComponent(
          googlePhotoName,
        )}&maxWidth=1200`;
      }
    }
  }

  return null;
};

const absoluteAdminUrl = (baseUrl: string, value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${baseUrl}${raw}`;
  return `https://${raw}`;
};

const normalizeAdminPath = (value: unknown, fallback = "/map") => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return `${url.pathname || fallback}${url.search || ""}${url.hash || ""}`;
    } catch {
      return fallback;
    }
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const cleanAffiliateSharePath = (
  affiliateTag: unknown,
  destinationPath: unknown,
  fallback = "/map",
) => {
  const targetPath = normalizeAdminPath(destinationPath, fallback);
  const tag = String(affiliateTag || "")
    .trim()
    .replace(/^\/+/, "")
    .split(/[/?#]/)[0];
  if (!tag) return targetPath;
  return `/ref/${encodeURIComponent(tag)}`;
};

const proxiedAdminImageUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isGoogleManagedImageUrl(raw)) return "";
  return `/api/admin/recent-signups/image?url=${encodeURIComponent(raw)}`;
};

const RECENT_SIGNUP_HARD_TEST_PATTERN =
  /\b(test|testing|dummy|fake|placeholder|asdf|qwer|lorem|ipsum)\b/i;
const RECENT_SIGNUP_SYNTHETIC_EMAIL_PATTERN =
  /(^deleted\+.*@mealscout\.invalid$|@example\.(?:com|net|org|test)$|@test\.com$|@mailinator\.com$|@yopmail\.com$|@invalid\.)/i;
const RECENT_SIGNUP_SYNTHETIC_PROFILE_SOURCES = new Set([
  "search_query_seed",
  "demo_seed",
  "sample_seed",
  "development_seed",
  "fixture",
  "test_fixture",
  "admin_quarantine",
]);

const isFilteredRecentSignup = (signup: any) => {
  const fields = [
    signup?.displayName,
    signup?.ownerEmail,
    signup?.category,
    signup?.description,
    signup?.city,
    signup?.state,
    signup?.address,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const haystack = fields.join(" ");
  const email = String(signup?.ownerEmail || "").trim().toLowerCase();
  const profileSource = String(signup?.profileSource || "").trim().toLowerCase();
  const name = String(signup?.displayName || "").trim();

  if (RECENT_SIGNUP_SYNTHETIC_PROFILE_SOURCES.has(profileSource)) return true;
  if (email && RECENT_SIGNUP_SYNTHETIC_EMAIL_PATTERN.test(email)) return true;
  if (RECENT_SIGNUP_HARD_TEST_PATTERN.test(haystack)) return true;
  if (/onboarding\s+test/i.test(haystack)) return true;
  if (
    signup?.entity !== "user" &&
    /\b(?:restaurant|truck|business|vendor|host)\b/i.test(name) &&
    /\d{8,}/.test(name)
  ) {
    return true;
  }

  if (signup?.entity !== "user") {
    const checks = getPublicBusinessVisibilityChecks({
      name: signup?.displayName,
      address: signup?.address,
      city: signup?.city,
      state: signup?.state,
      cuisineType: signup?.category,
      businessType: signup?.kind,
      description: signup?.description,
      imageUrl: signup?.imageUrl,
      ownerEmail: signup?.ownerEmail,
      profileSource: signup?.profileSource,
    });
    return checks.blockers.some((issue) =>
      [
        "flagged_test_data",
        "non_public_profile_source",
        "non_public_owner_email",
        "closed_permanently",
      ].includes(issue),
    );
  }

  return false;
};

const normalizeRecentSignupCardName = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeRecentSignupEmail = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const normalizeRecentSignupPhone = (value: unknown) =>
  String(value || "").replace(/\D/g, "");

const recentSignupRolePriority = (row: any) => {
  const kind = String(row?.kind || "").toLowerCase();
  if (
    [
      "food_truck",
      "restaurant",
      "caterer",
      "private_chef",
      "host",
      "supplier",
    ].includes(kind)
  ) {
    return 40;
  }
  if (kind === "team") return 5;
  return 0;
};

const scoreRecentSignupCard = (row: any) =>
  recentSignupRolePriority(row) +
  (row?.entity !== "user" ? 30 : 0) +
  (row?.isPublic ? 20 : 0) +
  (row?.imageUrl ? 10 : 0) +
  (row?.description ? 8 : 0) +
  (row?.isVerified ? 6 : 0);

const compareRecentSignupCards = (a: any, b: any) => {
  const scoreDiff = scoreRecentSignupCard(b) - scoreRecentSignupCard(a);
  if (scoreDiff) return scoreDiff;
  return (
    new Date(b?.createdAt || 0).getTime() -
    new Date(a?.createdAt || 0).getTime()
  );
};

const recentSignupStrongIdentityKeys = (item: any) => {
  const keys: string[] = [];
  const ownerId = String(item?.ownerId || "").trim();
  const email = normalizeRecentSignupEmail(item?.ownerEmail);
  const phone = normalizeRecentSignupPhone(item?.ownerPhone);
  if (ownerId) keys.push(`owner:${ownerId}`);
  if (email) keys.push(`email:${email}`);
  if (phone && phone.length >= 7) keys.push(`phone:${phone}`);
  return keys;
};

const dedupeRecentSignupCards = (items: any[]) => {
  const kept = new Set(items);
  const hidden: any[] = [];

  const hideRow = (row: any) => {
    if (!kept.has(row)) return;
    kept.delete(row);
    hidden.push(row);
  };

  const applyGroups = (
    groups: Map<string, any[]>,
    options: { weakName?: boolean } = {},
  ) => {
    for (const rows of groups.values()) {
      const activeRows = rows.filter((row) => kept.has(row));
      if (activeRows.length < 2) continue;

      const businessRows = activeRows.filter((row) => row?.entity !== "user");
      if (businessRows.length) {
        activeRows
          .filter((row) => row?.entity === "user")
          .forEach((row) => hideRow(row));
        continue;
      }

      if (options.weakName) {
        const hasCustomer = activeRows.some(
          (row) => String(row?.kind || "").toLowerCase() === "customer",
        );
        const hasHigherIntentUser = activeRows.some(
          (row) =>
            row?.entity === "user" &&
            recentSignupRolePriority(row) > 0 &&
            String(row?.kind || "").toLowerCase() !== "team",
        );
        if (!hasCustomer || !hasHigherIntentUser) continue;
      }

      const rankedRows = [...activeRows].sort(compareRecentSignupCards);
      rankedRows.slice(1).forEach((row) => hideRow(row));
    }
  };

  const strongGroups = new Map<string, any[]>();
  for (const item of items) {
    for (const key of recentSignupStrongIdentityKeys(item)) {
      const rows = strongGroups.get(key) || [];
      rows.push(item);
      strongGroups.set(key, rows);
    }
  }
  applyGroups(strongGroups);

  const nameGroups = new Map<string, any[]>();
  for (const item of items) {
    const name = normalizeRecentSignupCardName(item?.displayName);
    if (!name || name === "new mealscout member" || name.length < 4) continue;
    const rows = nameGroups.get(name) || [];
    rows.push(item);
    nameGroups.set(name, rows);
  }
  applyGroups(nameGroups, { weakName: true });

  return {
    kept: Array.from(kept).sort(
      (a, b) =>
        new Date(b?.createdAt || 0).getTime() -
        new Date(a?.createdAt || 0).getTime(),
    ),
    hidden,
  };
};

const formatSignupLocation = (row: {
  city?: string | null;
  state?: string | null;
  address?: string | null;
}) =>
  [row.city, row.state].filter(Boolean).join(", ") ||
  String(row.address || "").trim() ||
  "local";

const publicRestaurantPath = (row: any, isFoodTruck: boolean) => {
  const id = String(row?.id || "").trim();
  const slug = toShareSlug(row?.name) || id;
  const slugWithId = id ? `${slug}--${id}` : slug;
  const businessType = String(row?.businessType || "").toLowerCase();
  if (isFoodTruck) {
    return `/truck/${encodeURIComponent(slugWithId)}`;
  }
  if (businessType === "bar") {
    return `/bar/${encodeURIComponent(slugWithId)}`;
  }
  if (businessType === "private_chef") {
    return `/chef/${encodeURIComponent(slugWithId)}`;
  }
  if (businessType === "caterer") {
    return id
      ? `/restaurant/${encodeURIComponent(id)}/${encodeURIComponent(slug)}`
      : `/restaurant/${encodeURIComponent(slug)}`;
  }
  return id
    ? `/restaurant/${encodeURIComponent(id)}/${encodeURIComponent(slug)}`
    : `/restaurant/${encodeURIComponent(slug)}`;
};

const publicHostPath = (row: any) => {
  const id = String(row?.id || "").trim();
  const slug = toShareSlug(row?.businessName) || id;
  return `/location/${encodeURIComponent(id ? `${slug}--${id}` : slug)}`;
};

const publicSupplierPath = (row: any) => {
  const id = String(row?.id || "").trim();
  const slug = toShareSlug(row?.businessName) || id;
  return `/supplier/${encodeURIComponent(id ? `${slug}--${id}` : slug)}`;
};

type RecentSignupInsuranceStatus =
  | "valid"
  | "pending"
  | "rejected"
  | "expired"
  | "not_submitted"
  | "not_required";

const insuranceEntityTypeForRestaurantRow = (row: any) => {
  const businessType = String(row?.businessType || "").trim().toLowerCase();
  if (Boolean(row?.isFoodTruck) || businessType === "food_truck") {
    return "food_truck";
  }
  if (businessType === "caterer") return "caterer";
  if (businessType === "private_chef") return "private_chef";
  return "restaurant";
};

const summarizeRecentSignupInsurance = (
  record?: any,
): {
  required: boolean;
  status: RecentSignupInsuranceStatus;
  valid: boolean;
  expiresAt: string | null;
  documentsCount: number;
} => {
  if (!record) {
    return {
      required: true,
      status: "not_submitted",
      valid: false,
      expiresAt: null,
      documentsCount: 0,
    };
  }

  const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
  const isExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  const documents = Array.isArray(record.documents) ? record.documents : [];
  let status: RecentSignupInsuranceStatus = "pending";

  if (record.status === "approved") {
    status =
      isExpired ||
      !record.attestedCommercialCoverage ||
      !record.attestedJurisdictionCompliance
        ? "expired"
        : "valid";
  } else if (record.status === "rejected") {
    status = "rejected";
  } else if (record.status === "expired") {
    status = "expired";
  }

  return {
    required: true,
    status,
    valid: status === "valid",
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    documentsCount: documents.length,
  };
};

const splitMenuHighlights = (value: unknown) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

const buildSignupCaption = (signup: {
  displayName: string;
  kind?: string;
  typeLabel: string;
  locationLabel: string;
  profileUrl: string;
  shareUrl?: string;
  isPublic: boolean;
  category?: string | null;
  menuItemNames?: string[] | null;
  videoCount?: number | null;
  websiteUrl?: string | null;
  menuUrl?: string | null;
  orderUrl?: string | null;
}) => {
  const publicUrl = signup.shareUrl || signup.profileUrl;
  const location =
    signup.locationLabel && signup.locationLabel !== "local"
      ? ` in ${signup.locationLabel}`
      : "";
  const category = signup.category ? `${signup.category} ` : "";
  const menu =
    signup.menuItemNames && signup.menuItemNames.length
      ? ` Menu highlights include ${signup.menuItemNames.slice(0, 3).join(", ")}.`
      : "";
  const videos =
    Number(signup.videoCount || 0) > 0
      ? " Videos and profile updates are live on MealScout."
      : "";
  const nextBestLink =
    signup.orderUrl || signup.menuUrl || signup.websiteUrl
      ? ` More info is connected from the profile.`
      : "";

  if (signup.kind === "customer") {
    return `Welcome ${signup.displayName} to MealScout. Find local food trucks, restaurants, hosts, and events here: ${publicUrl}`;
  }

  if (signup.kind === "team") {
    return `Welcome ${signup.displayName} to the MealScout crew. Local food discovery starts here: ${publicUrl}`;
  }

  if (signup.kind === "supplier") {
    return `Say hello to ${signup.displayName} on MealScout. ${signup.typeLabel} helping local food businesses stay stocked: ${publicUrl}`;
  }

  if (!signup.isPublic) {
    return `Fresh local food activity is landing on MealScout. This ${signup.typeLabel.toLowerCase()} profile is still being finished, so we will route visitors to nearby trucks, restaurants, hosts, and events for now: ${publicUrl}`;
  }

  if (signup.kind === "food_truck") {
    return `New on MealScout: ${signup.displayName}, a ${category}food truck${location}.${menu}${videos}${nextBestLink} Track their menu, schedule, and updates here: ${publicUrl}`;
  }

  if (signup.kind === "caterer") {
    return `New on MealScout: ${signup.displayName}, a ${category}caterer${location}.${menu}${videos}${nextBestLink} See their catering-ready profile here: ${publicUrl}`;
  }

  if (signup.kind === "private_chef") {
    return `New on MealScout: ${signup.displayName}, a ${category}private chef${location}.${menu}${videos}${nextBestLink} See their bookable chef profile here: ${publicUrl}`;
  }

  if (signup.kind === "host") {
    return `New MealScout host: ${signup.displayName}${location}. Hosts publish truck opportunities and parking availability directly through MealScout. See the public profile: ${publicUrl}`;
  }

  return `Say hello to ${signup.displayName} on MealScout. ${category}${signup.typeLabel}${location}.${menu}${videos}${nextBestLink} See the public profile: ${publicUrl}`;
};

const signupUserTypeLabel = (userType: unknown) => {
  const normalized = String(userType || "customer").trim().toLowerCase();
  const labels: Record<string, string> = {
    customer: "Customer",
    restaurant_owner: "Restaurant Owner",
    caterer: "Caterer",
    private_chef: "Private Chef",
    food_truck: "Food Truck Owner",
    supplier: "Supplier",
    host: "Host",
    event_coordinator: "Event Organizer",
    staff: "Team Member",
    admin: "Admin",
    super_admin: "Admin",
  };
  return labels[normalized] || "MealScout User";
};

const signupKindForUserType = (userType: unknown) => {
  const normalized = String(userType || "customer").trim().toLowerCase();
  if (normalized === "food_truck") return "food_truck";
  if (normalized === "caterer") return "caterer";
  if (normalized === "private_chef") return "private_chef";
  if (normalized === "restaurant_owner") return "restaurant";
  if (normalized === "host" || normalized === "event_coordinator") {
    return "host";
  }
  if (normalized === "supplier") return "supplier";
  if (normalized === "staff" || normalized === "admin" || normalized === "super_admin") {
    return "team";
  }
  return "customer";
};

const signupCategoryForUserType = (userType: unknown) => {
  const normalized = String(userType || "customer").trim().toLowerCase();
  const labels: Record<string, string> = {
    customer: "Local food fan",
    restaurant_owner: "Business owner",
    caterer: "Catering business",
    private_chef: "Private chef",
    food_truck: "Mobile food owner",
    supplier: "Food business supplier",
    host: "Truck-friendly host",
    event_coordinator: "Event organizer",
    staff: "MealScout team",
    admin: "MealScout team",
    super_admin: "MealScout team",
  };
  return labels[normalized] || "MealScout member";
};

const displayNameForSignupUser = (user: any) => {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  if (fullName) return fullName;

  const email = String(user?.email || "").trim();
  if (email && email.includes("@")) return email.split("@")[0];
  if (email) return email;

  return "New MealScout member";
};

const ensureRecentSignupAffiliateTags = async (params: {
  userRows: any[];
  restaurantRows: any[];
  hostRows: any[];
  supplierRows: any[];
}) => {
  const userIds = new Set<string>();
  for (const row of params.userRows) {
    if (!row?.affiliateTag && row?.id) userIds.add(String(row.id));
  }
  for (const row of params.restaurantRows) {
    if (!row?.ownerAffiliateTag && row?.ownerId) userIds.add(String(row.ownerId));
  }
  for (const row of params.hostRows) {
    if (!row?.ownerAffiliateTag && row?.userId) userIds.add(String(row.userId));
  }
  for (const row of params.supplierRows) {
    if (!row?.ownerAffiliateTag && row?.userId) userIds.add(String(row.userId));
  }

  if (!userIds.size) return;

  const tagByUserId = new Map<string, string>();
  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      try {
        tagByUserId.set(userId, await ensureAffiliateTag(userId));
      } catch (error) {
        console.warn("[admin/recent-signups] affiliate tag repair failed", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  for (const row of params.userRows) {
    const tag = tagByUserId.get(String(row?.id || ""));
    if (tag) row.affiliateTag = tag;
  }
  for (const row of params.restaurantRows) {
    const tag = tagByUserId.get(String(row?.ownerId || ""));
    if (tag) row.ownerAffiliateTag = tag;
  }
  for (const row of params.hostRows) {
    const tag = tagByUserId.get(String(row?.userId || ""));
    if (tag) row.ownerAffiliateTag = tag;
  }
  for (const row of params.supplierRows) {
    const tag = tagByUserId.get(String(row?.userId || ""));
    if (tag) row.ownerAffiliateTag = tag;
  }
};

const dataUrlToBlob = (dataUrl: string) => {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!match) return null;

  const mimeType = match[1] || "image/png";
  const buffer = Buffer.from(match[2], "base64");
  return new Blob([buffer], { type: mimeType });
};

const fetchAdminImageResponse = async (url: string) => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return null;

  const response = await fetch(parsed.toString(), {
    headers: {
      "user-agent":
        "MealScoutBot/1.0 (+https://www.mealscout.us; image proxy for admin sharing)",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) return null;

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 8 * 1024 * 1024) return null;

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) return null;

  return {
    contentType,
    buffer: Buffer.from(arrayBuffer),
  };
};

const refreshRecentRestaurantGoogleFields = async (rows: any[]) => {
  const ids = Array.from(
    new Set(rows.map((row) => String(row.id || "").trim()).filter(Boolean)),
  );
  if (!ids.length) return;

  const freshRows = await db
    .select({
      id: restaurants.id,
      phone: restaurants.phone,
      cuisineType: restaurants.cuisineType,
      logoUrl: restaurants.logoUrl,
      coverImageUrl: restaurants.coverImageUrl,
      description: restaurants.description,
      websiteUrl: restaurants.websiteUrl,
      menuUrl: restaurants.menuUrl,
      orderUrl: restaurants.orderUrl,
      googlePlaceId: restaurants.googlePlaceId,
      googleRating: restaurants.googleRating,
      googleReviewCount: restaurants.googleReviewCount,
      googlePriceLevel: restaurants.googlePriceLevel,
      googleBusinessStatus: restaurants.googleBusinessStatus,
      googlePhotos: restaurants.googlePhotos,
      googleCategories: restaurants.googleCategories,
      googleFormattedPhone: restaurants.googleFormattedPhone,
      profileSource: restaurants.profileSource,
      profileLastSynced: restaurants.profileLastSynced,
    })
    .from(restaurants)
    .where(inArray(restaurants.id, ids));

  const byId = new Map(
    (freshRows as any[]).map((row) => [String(row.id), row]),
  );
  for (const row of rows) {
    const fresh = byId.get(String(row.id));
    if (fresh) Object.assign(row, fresh);
  }
};

const refreshRecentHostGoogleFields = async (rows: any[]) => {
  const ids = Array.from(
    new Set(rows.map((row) => String(row.id || "").trim()).filter(Boolean)),
  );
  if (!ids.length) return;

  const freshRows = await db
    .select({
      id: hosts.id,
      contactPhone: hosts.contactPhone,
      spotImageUrl: hosts.spotImageUrl,
      description: hosts.description,
      businessWebsite: hosts.businessWebsite,
      googlePlaceId: hosts.googlePlaceId,
      googleRating: hosts.googleRating,
      googleReviewCount: hosts.googleReviewCount,
      googlePriceLevel: hosts.googlePriceLevel,
      googleBusinessStatus: hosts.googleBusinessStatus,
      googlePhotos: hosts.googlePhotos,
      googleCategories: hosts.googleCategories,
      googleFormattedPhone: hosts.googleFormattedPhone,
      profileSource: hosts.profileSource,
      profileLastSynced: hosts.profileLastSynced,
    })
    .from(hosts)
    .where(inArray(hosts.id, ids));

  const byId = new Map(
    (freshRows as any[]).map((row) => [String(row.id), row]),
  );
  for (const row of rows) {
    const fresh = byId.get(String(row.id));
    if (fresh) Object.assign(row, fresh);
  }
};

const enrichRecentSignupGoogleRows = async (
  restaurantRows: any[],
  hostRows: any[],
) => {
  const restaurantTargets = restaurantRows
    .filter(shouldAttemptGoogleRestaurantAutoLink)
    .slice(0, 12);
  const hostTargets = hostRows.filter(shouldAttemptGoogleHostAutoLink).slice(0, 8);

  if (!restaurantTargets.length && !hostTargets.length) return;

  const [restaurantResults, hostResults] = await Promise.all([
    Promise.allSettled(
      restaurantTargets.map((row) => populateRestaurantProfile(String(row.id))),
    ),
    Promise.allSettled(
      hostTargets.map((row) => populateHostProfile(String(row.id))),
    ),
  ]);

  const hasRestaurantUpdates = restaurantResults.some(
    (result) =>
      result.status === "fulfilled" && Boolean(result.value?.success),
  );
  const hasHostUpdates = hostResults.some(
    (result) =>
      result.status === "fulfilled" && Boolean(result.value?.success),
  );

  if (hasRestaurantUpdates) {
    await refreshRecentRestaurantGoogleFields(restaurantTargets);
  }
  if (hasHostUpdates) {
    await refreshRecentHostGoogleFields(hostTargets);
  }
};

let adminMenuSchemaAvailableCache: boolean | null = null;
let adminMenuSchemaWarningLogged = false;
const hasAdminMenuSchema = async () => {
  if (adminMenuSchemaAvailableCache !== null) {
    return adminMenuSchemaAvailableCache;
  }

  try {
    const result = await db.execute(sql`
      select
        to_regclass('public.menus')::text as menus_table,
        to_regclass('public.menu_items')::text as menu_items_table,
        to_regclass('public.menu_import_logs')::text as menu_import_logs_table
    `);
    const row = result.rows?.[0] as any;
    adminMenuSchemaAvailableCache = Boolean(
      row?.menus_table && row?.menu_items_table && row?.menu_import_logs_table,
    );
  } catch (error) {
    adminMenuSchemaAvailableCache = false;
    if (!adminMenuSchemaWarningLogged) {
      console.warn(
        "[admin/launch-week] menu schema check failed; using zero menu counts:",
        error,
      );
      adminMenuSchemaWarningLogged = true;
    }
  }

  if (!adminMenuSchemaAvailableCache && !adminMenuSchemaWarningLogged) {
    console.warn(
      "[admin/launch-week] menu tables unavailable; using zero menu counts",
    );
    adminMenuSchemaWarningLogged = true;
  }

  return adminMenuSchemaAvailableCache;
};

export function registerAdminCoreOpsRoutes(app: Express) {
  app.get(
    "/api/admin/stats",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const stats = await storage.getAdminStats();
        res.json(stats);
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
      }
    },
  );

  app.get(
    "/api/admin/dashboard-totals",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const statsPromise = storage.getAdminStats();
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const upcoming7d = new Date(today);
        upcoming7d.setDate(upcoming7d.getDate() + 7);
        const liveSince = new Date(Date.now() - 15 * 60 * 1000);

        const operationsPromise = (async () => {
          try {
            const [
              seriesTotals,
              seriesPublishedTotals,
              bookingsTodayTotals,
              bookings7dTotals,
              openCallCapacity7dRows,
              openCallAccepted7dRows,
              liveTruckTotals,
              activeSessionTotals,
              paymentHealth,
            ] = await Promise.all([
              db
                .select({
                  total: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventSeries)
                .where(eq(eventSeries.seriesType, "parking_pass" as any)),
              db
                .select({
                  published: sql<number>`count(*)`.mapWith(Number),
                  publishedHosts:
                    sql<number>`count(distinct ${eventSeries.hostId})`.mapWith(
                      Number,
                    ),
                  spotCapacity:
                    sql<number>`coalesce(sum(${eventSeries.defaultMaxTrucks}), 0)`.mapWith(
                      Number,
                    ),
                })
                .from(eventSeries)
                .where(
                  and(
                    eq(eventSeries.seriesType, "parking_pass" as any),
                    eq(eventSeries.status, "published" as any),
                  ),
                ),
              db
                .select({
                  count: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventBookings)
                .innerJoin(events, eq(events.id, eventBookings.eventId))
                .where(
                  and(
                    eq(events.eventType, "parking_pass" as any),
                    gte(events.date, today),
                    lt(events.date, tomorrow),
                    eq(eventBookings.status, "confirmed" as any),
                  ),
                ),
              db
                .select({
                  count: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventBookings)
                .innerJoin(events, eq(events.id, eventBookings.eventId))
                .where(
                  and(
                    eq(events.eventType, "parking_pass" as any),
                    gte(events.date, today),
                    lt(events.date, upcoming7d),
                    eq(eventBookings.status, "confirmed" as any),
                  ),
                ),
              db.execute(sql`
                select coalesce(sum(e.max_trucks), 0)::int as capacity_total
                from events e
                inner join event_series s on s.id = e.series_id
                where s.series_type in ('event', 'open_call')
                  and e.date >= ${today}
                  and e.date < ${upcoming7d}
                  and e.status in ('open', 'booked')
              `),
              db.execute(sql`
                select count(*)::int as accepted_total
                from event_interests i
                inner join events e on e.id = i.event_id
                inner join event_series s on s.id = e.series_id
                where i.status = 'accepted'
                  and s.series_type in ('event', 'open_call')
                  and e.date >= ${today}
                  and e.date < ${upcoming7d}
                  and e.status in ('open', 'booked')
              `),
              db
                .select({
                  live: sql<number>`count(distinct ${foodTruckLocations.restaurantId})`.mapWith(
                    Number,
                  ),
                })
                .from(foodTruckLocations)
                .where(gte(foodTruckLocations.recordedAt, liveSince)),
              db
                .select({
                  active:
                    sql<number>`count(distinct ${foodTruckSessions.restaurantId})`.mapWith(
                      Number,
                    ),
                })
                .from(foodTruckSessions)
                .where(
                  and(
                    eq(foodTruckSessions.isActive, true),
                    isNull(foodTruckSessions.endedAt),
                  ),
                ),
              getPaymentHealthSnapshot().catch((error) => {
                console.error(
                  "[admin] Failed to compute payment health totals:",
                  error,
                );
                return null;
              }),
            ]);

            const openCallCapacityRow = Array.isArray(
              (openCallCapacity7dRows as any)?.rows,
            )
              ? (openCallCapacity7dRows as any).rows[0]
              : Array.isArray(openCallCapacity7dRows)
                ? (openCallCapacity7dRows as any)[0]
                : null;
            const openCallAcceptedRow = Array.isArray(
              (openCallAccepted7dRows as any)?.rows,
            )
              ? (openCallAccepted7dRows as any).rows[0]
              : Array.isArray(openCallAccepted7dRows)
                ? (openCallAccepted7dRows as any)[0]
                : null;
            const openCallCapacity7d = Number(
              openCallCapacityRow?.capacity_total || 0,
            );
            const openCallAccepted7d = Number(
              openCallAcceptedRow?.accepted_total || 0,
            );
            const openCallFillRate7dPct =
              openCallCapacity7d > 0
                ? Number(
                    ((openCallAccepted7d / openCallCapacity7d) * 100).toFixed(
                      2,
                    ),
                  )
                : 0;

            return {
              parkingPass: {
                seriesTotal: Number(seriesTotals?.[0]?.total ?? 0),
                seriesPublished: Number(
                  seriesPublishedTotals?.[0]?.published ?? 0,
                ),
                hostsPublished: Number(
                  seriesPublishedTotals?.[0]?.publishedHosts ?? 0,
                ),
                spotCapacityPublished: Number(
                  seriesPublishedTotals?.[0]?.spotCapacity ?? 0,
                ),
              },
              openCalls: {
                acceptedNext7Days: openCallAccepted7d,
                capacityNext7Days: openCallCapacity7d,
                fillRateNext7DaysPct: openCallFillRate7dPct,
              },
              bookings: {
                parkingPassConfirmedToday: Number(
                  bookingsTodayTotals?.[0]?.count ?? 0,
                ),
                parkingPassConfirmedNext7Days: Number(
                  bookings7dTotals?.[0]?.count ?? 0,
                ),
                pendingCheckoutHolds: Number(
                  paymentHealth?.counts?.pendingTotal ?? 0,
                ),
                staleCheckoutHolds: Number(
                  paymentHealth?.counts?.pendingExpired ?? 0,
                ),
                failedPaymentsLast24h: Number(
                  paymentHealth?.counts?.failedLast24h ?? 0,
                ),
                confirmedLast24h: Number(
                  paymentHealth?.counts?.confirmedLast24h ?? 0,
                ),
              },
              trucks: {
                liveTrucks15m: Number(liveTruckTotals?.[0]?.live ?? 0),
                activeSessions: Number(activeSessionTotals?.[0]?.active ?? 0),
              },
            };
          } catch (error) {
            console.error(
              "[admin] Failed to compute operations totals:",
              error,
            );
            return null;
          }
        })();

        const stats = await statsPromise;
        const operations = await operationsPromise;
        const roleTotal = Number(stats.memberCountsTotal || 0);
        const totalUsers = Number(stats.totalUsers || 0);
        const isConsistent = roleTotal <= totalUsers;

        res.json({
          generatedAt: new Date().toISOString(),
          totals: stats,
          operations,
          consistency: {
            roleTotal,
            totalUsers,
            unclassifiedUsers: Math.max(0, totalUsers - roleTotal),
            rolesWithinUserTotal: isConsistent,
          },
        });
      } catch (error) {
        console.error("Error fetching dashboard totals:", error);
        res.status(500).json({ message: "Failed to fetch dashboard totals" });
      }
    },
  );

  app.get(
    "/api/admin/payments/health",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const snapshot = await getPaymentHealthSnapshot();
        res.json(snapshot);
      } catch (error) {
        console.error("Error fetching payment health:", error);
        res.status(500).json({ message: "Failed to fetch payment health" });
      }
    },
  );

  app.get(
    "/api/admin/public-data-audit",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const limit = Math.max(
          25,
          Math.min(
            500,
            Number.parseInt(String(req.query.limit || "150"), 10) || 150,
          ),
        );
        const rows = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            name: restaurants.name,
            cuisineType: restaurants.cuisineType,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
            description: restaurants.description,
            websiteUrl: restaurants.websiteUrl,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            facebookCoverUrl: restaurants.facebookCoverUrl,
            googlePhotos: restaurants.googlePhotos,
            facebookPhotos: restaurants.facebookPhotos,
            googleBusinessStatus: restaurants.googleBusinessStatus,
            claimedFromImportId: restaurants.claimedFromImportId,
            profileSource: restaurants.profileSource,
            createdAt: restaurants.createdAt,
            updatedAt: restaurants.updatedAt,
            ownerEmail: users.email,
            ownerUserType: users.userType,
            ownerDisabled: users.isDisabled,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .orderBy(desc(restaurants.updatedAt))
          .limit(5000);

        const audited = rows.map((restaurant: any) => {
          const checks = getPublicBusinessVisibilityChecks(restaurant);
          const hasPhoto = hasAdminAuditPhoto(restaurant);
          const publicVisible =
            Boolean(restaurant.isActive) && isPublicBusinessVisible(restaurant);
          const profileSource = String(restaurant.profileSource || "").trim();
          const isQuarantined = profileSource === "admin_quarantine";
          const ownerEmail = String(restaurant.ownerEmail || "").trim();
          const issueLabels = [
            ...checks.blockers.map(labelPublicDataIssue),
            ...checks.warnings.map(labelPublicDataIssue),
          ];

          if (!restaurant.isActive) issueLabels.push("Inactive");
          if (!restaurant.isVerified) issueLabels.push("Unverified");
          if (!hasPhoto) issueLabels.push("Missing photo");
          if (!ownerEmail) issueLabels.push("Missing owner email");
          if (restaurant.ownerDisabled) issueLabels.push("Owner disabled");
          if (isQuarantined) issueLabels.push("Quarantined");

          const uniqueIssues = Array.from(new Set(issueLabels));
          const priority =
            isQuarantined
              ? 5
              : restaurant.isActive && checks.blockers.length > 0
                ? 1
                : restaurant.isActive && (!hasPhoto || !ownerEmail)
                  ? 2
                  : restaurant.isActive && !restaurant.isVerified
                    ? 3
                    : restaurant.isActive
                      ? 6
                      : 8;

          return {
            ...restaurant,
            publicVisible,
            hasPhoto,
            blockers: checks.blockers,
            warnings: checks.warnings,
            issueLabels: uniqueIssues,
            issueCount: uniqueIssues.length,
            isQuarantined,
            priority,
            recommendedAction:
              restaurant.isActive && checks.blockers.length > 0
                ? "quarantine_or_fix"
                : restaurant.isActive && (!hasPhoto || !ownerEmail)
                  ? "fix_profile"
                  : isQuarantined
                    ? "review_restore"
                    : "monitor",
          };
        });

        const summary = {
          total: audited.length,
          active: audited.filter((row: any) => row.isActive).length,
          publicVisible: audited.filter((row: any) => row.publicVisible).length,
          blockedActive: audited.filter(
            (row: any) => row.isActive && row.blockers.length > 0,
          ).length,
          needsPhoto: audited.filter(
            (row: any) => row.isActive && !row.hasPhoto,
          ).length,
          missingOwner: audited.filter(
            (row: any) =>
              row.isActive && !String(row.ownerEmail || "").trim(),
          ).length,
          missingLocation: audited.filter((row: any) =>
            row.blockers.includes("missing_location"),
          ).length,
          missingCategory: audited.filter((row: any) =>
            row.blockers.includes("missing_category"),
          ).length,
          quarantined: audited.filter((row: any) => row.isQuarantined).length,
          closedPermanently: audited.filter((row: any) =>
            row.blockers.includes("closed_permanently"),
          ).length,
          generatedAt: new Date().toISOString(),
        };

        audited.sort((a: any, b: any) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
          return (
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime()
          );
        });

        res.json({
          summary,
          rows: audited.slice(0, limit),
        });
      } catch (error) {
        console.error("Error fetching public data audit:", error);
        res.status(500).json({ message: "Failed to fetch public data audit" });
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/quarantine",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const reason =
          String(req.body?.reason || "").trim() ||
          "Quarantined from public discovery by admin data-quality review.";
        const [existing] = await db
          .select({ id: restaurants.id, name: restaurants.name })
          .from(restaurants)
          .where(eq(restaurants.id, req.params.id))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const [updated] = await db
          .update(restaurants)
          .set({
            isActive: false,
            profileSource: "admin_quarantine",
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, req.params.id))
          .returning();

        console.warn("[admin/public-data] quarantined restaurant", {
          adminId: req.user?.id || null,
          restaurantId: req.params.id,
          name: existing.name,
          reason,
        });

        res.json({
          message: "Restaurant quarantined from public discovery",
          restaurant: updated,
        });
      } catch (error) {
        console.error("Error quarantining restaurant:", error);
        res.status(500).json({ message: "Failed to quarantine restaurant" });
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/restore-public",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const [existing] = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            profileSource: restaurants.profileSource,
          })
          .from(restaurants)
          .where(eq(restaurants.id, req.params.id))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const [updated] = await db
          .update(restaurants)
          .set({
            isActive: true,
            profileSource:
              existing.profileSource === "admin_quarantine"
                ? "manual"
                : existing.profileSource,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, req.params.id))
          .returning();

        console.info("[admin/public-data] restored restaurant", {
          adminId: req.user?.id || null,
          restaurantId: req.params.id,
          name: existing.name,
        });

        res.json({
          message: "Restaurant restored for public eligibility review",
          restaurant: updated,
        });
      } catch (error) {
        console.error("Error restoring restaurant:", error);
        res.status(500).json({ message: "Failed to restore restaurant" });
      }
    },
  );

  // Admin endpoint to sync subscriptions from Stripe to database
  app.post(
    "/api/admin/subscriptions/sync",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const results = {
          synced: 0,
          skipped: 0,
          errors: 0,
          details: [] as any[],
        };

        const allUsers = await storage.getAllUsers();
        const usersWithStripe = allUsers.filter((u) => u.stripeCustomerId);

        console.log(
          `[ADMIN SYNC] Found ${usersWithStripe.length} users with Stripe customer IDs`,
        );

        for (const user of usersWithStripe) {
          try {
            if (user.stripeSubscriptionId) {
              results.skipped++;
              continue;
            }

            const subscriptions = await stripe.subscriptions.list({
              customer: user.stripeCustomerId!,
              status: "active",
              limit: 1,
            });

            if (subscriptions.data.length > 0) {
              const subscription = subscriptions.data[0];
              const interval =
                subscription.items.data[0]?.price?.recurring?.interval;
              const intervalCount =
                subscription.items.data[0]?.price?.recurring?.interval_count ||
                1;

              let billingInterval = "month";
              if (interval === "month" && intervalCount === 3) {
                billingInterval = "quarter";
              } else if (interval === "year") {
                billingInterval = "year";
              }

              await storage.updateUserStripeInfo(
                user.id,
                user.stripeCustomerId!,
                subscription.id,
                `standard-${billingInterval}`,
              );

              results.synced++;
              results.details.push({
                userId: user.id,
                email: user.email,
                subscriptionId: subscription.id,
                billingInterval: `standard-${billingInterval}`,
                status: "synced",
              });

              console.log(
                `[ADMIN SYNC] Synced subscription ${subscription.id} for user ${user.email}`,
              );
            } else {
              results.skipped++;
            }
          } catch (error: any) {
            results.errors++;
            results.details.push({
              userId: user.id,
              email: user.email,
              error: error.message,
              status: "error",
            });
            console.error(
              `[ADMIN SYNC] Error syncing user ${user.email}:`,
              error,
            );
          }
        }

        console.log(
          `[ADMIN SYNC] Complete: ${results.synced} synced, ${results.skipped} skipped, ${results.errors} errors`,
        );
        res.json(results);
      } catch (error) {
        console.error("Error syncing subscriptions:", error);
        res.status(500).json({ message: "Failed to sync subscriptions" });
      }
    },
  );

  app.get(
    "/api/admin/restaurants/search",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const query = String(req.query.q || "")
          .trim()
          .toLowerCase();
        const limit = Math.max(
          1,
          Math.min(
            50,
            Number.parseInt(String(req.query.limit || "25"), 10) || 25,
          ),
        );

        if (query.length < 2) {
          return res.json([]);
        }

        const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
        const rows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            cuisineType: restaurants.cuisineType,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            facebookCoverUrl: restaurants.facebookCoverUrl,
            googlePhotos: restaurants.googlePhotos,
            facebookPhotos: restaurants.facebookPhotos,
            profileSource: restaurants.profileSource,
            createdAt: restaurants.createdAt,
            ownerEmail: users.email,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .where(
            sql`
            lower(coalesce(${restaurants.name}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.cuisineType}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.address}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.city}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.state}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${users.email}, '')) like ${pattern} escape '\\'
          `,
          )
          .orderBy(desc(restaurants.createdAt))
          .limit(limit);

        res.json(rows);
      } catch (error) {
        console.error("Error searching restaurants:", error);
        res.status(500).json({ message: "Failed to search restaurants" });
      }
    },
  );

  app.get(
    "/api/admin/restaurants/pending",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const restaurants = await storage.getPendingRestaurants();
        res.json(restaurants);
      } catch (error) {
        console.error("Error fetching pending restaurants:", error);
        res.setHeader("X-MealScout-Degraded", "pending-restaurants");
        res.json([]);
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.approveRestaurant(req.params.id, req.user?.id || null);
        res.json({ message: "Business profile activated successfully" });
      } catch (error) {
        console.error("Error approving restaurant:", error);
        if (
          error instanceof Error &&
          error.message === "Restaurant not found"
        ) {
          return res.status(404).json({ message: error.message });
        }
        res.status(500).json({ message: "Failed to approve restaurant" });
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const reason =
          String(req.body?.reason || "").trim() ||
          "Rejected from admin restaurant approval queue.";
        await storage.rejectRestaurant(req.params.id, req.user?.id || null, reason);
        res.json({ message: "Restaurant rejected successfully" });
      } catch (error) {
        console.error("Error rejecting restaurant:", error);
        res.status(500).json({ message: "Failed to reject restaurant" });
      }
    },
  );

  app.delete(
    "/api/admin/restaurants/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.deleteRestaurant(req.params.id);
        res.json({ message: "Restaurant deleted successfully" });
      } catch (error: any) {
        console.error("Error deleting restaurant:", error);
        if (String(error?.code || "") === "23503") {
          return res.status(409).json({
            message:
              "This restaurant has related records and cannot be deleted. Reject or deactivate it instead.",
          });
        }
        res.status(500).json({ message: "Failed to delete restaurant" });
      }
    },
  );

  app.get(
    "/api/admin/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const users = await storage.getAllUsers();
        res.json(sanitizeUsers(users, { includeStripe: true }));
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    },
  );

  app.get(
    "/api/admin/recent-signups/image",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawUrl = String(req.query?.url || "").trim();
        if (!rawUrl) {
          return res.status(400).send("Missing image URL");
        }
        if (isGoogleManagedImageUrl(rawUrl)) {
          return res.status(404).send("Image unavailable");
        }

        const image = await fetchAdminImageResponse(rawUrl);
        if (!image) {
          return res.status(404).send("Image unavailable");
        }

        res.setHeader("Content-Type", image.contentType);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(image.buffer);
      } catch (error) {
        console.warn("[admin/recent-signups/image] proxy failed:", error);
        res.status(404).send("Image unavailable");
      }
    },
  );

  app.get(
    "/api/admin/recent-signups",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const includeAll =
          req.query?.all === "1" || String(req.query?.hours || "") === "all";
        const includeFiltered =
          req.query?.includeFiltered === "1" || req.query?.debug === "1";
        const hours = includeAll
          ? 0
          : Math.min(168, Math.max(1, Number(req.query?.hours) || 48));
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        const baseUrl = resolveAdminPublicBaseUrl();

        const userRows = await db
          .select({
            id: users.id,
            userType: users.userType,
            email: users.email,
            isDisabled: users.isDisabled,
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            profileImageUrl: users.profileImageUrl,
            affiliateTag: users.affiliateTag,
            postalCode: users.postalCode,
            publicHandle: users.publicHandle,
            publicBio: users.publicBio,
            emailVerified: users.emailVerified,
            accountSettings: users.accountSettings,
            publicProfileSettings: users.publicProfileSettings,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(
            and(
              includeAll ? sql`true` : gte(users.createdAt, cutoff),
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(users.createdAt))
          .limit(500);

        const recentUserRows = userRows as any[];
        const recentUserIds = Array.from(
          new Set(
            recentUserRows
              .map((row) => String(row.id || "").trim())
              .filter(Boolean),
          ),
        );

        const recentOrOwnedRestaurantWhere =
          includeAll
            ? sql`true`
            : recentUserIds.length > 0
            ? or(
                gte(restaurants.createdAt, cutoff),
                inArray(restaurants.ownerId, recentUserIds),
              )
            : gte(restaurants.createdAt, cutoff);
        const recentOrOwnedHostWhere =
          includeAll
            ? sql`true`
            : recentUserIds.length > 0
            ? or(gte(hosts.createdAt, cutoff), inArray(hosts.userId, recentUserIds))
            : gte(hosts.createdAt, cutoff);
        const recentOrOwnedSupplierWhere =
          includeAll
            ? sql`true`
            : recentUserIds.length > 0
            ? or(
                gte(suppliers.createdAt, cutoff),
                inArray(suppliers.userId, recentUserIds),
              )
            : gte(suppliers.createdAt, cutoff);

        const restaurantRows = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            name: restaurants.name,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            businessType: restaurants.businessType,
            cuisineType: restaurants.cuisineType,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            facebookCoverUrl: restaurants.facebookCoverUrl,
            facebookPhotos: restaurants.facebookPhotos,
            googlePhotos: restaurants.googlePhotos,
            description: restaurants.description,
            websiteUrl: restaurants.websiteUrl,
            menuUrl: restaurants.menuUrl,
            orderUrl: restaurants.orderUrl,
            googlePlaceId: restaurants.googlePlaceId,
            googleRating: restaurants.googleRating,
            googleReviewCount: restaurants.googleReviewCount,
            googlePriceLevel: restaurants.googlePriceLevel,
            googleBusinessStatus: restaurants.googleBusinessStatus,
            googleCategories: restaurants.googleCategories,
            googleFormattedPhone: restaurants.googleFormattedPhone,
            claimedFromImportId: restaurants.claimedFromImportId,
            profileSource: restaurants.profileSource,
            profileLastSynced: restaurants.profileLastSynced,
            instagramUrl: restaurants.instagramUrl,
            facebookPageId: restaurants.facebookPageId,
            facebookPageUrl: restaurants.facebookPageUrl,
            createdAt: restaurants.createdAt,
            ownerEmail: users.email,
            ownerPhone: users.phone,
            ownerFirstName: users.firstName,
            ownerLastName: users.lastName,
            ownerProfileImageUrl: users.profileImageUrl,
            ownerAffiliateTag: users.affiliateTag,
            ownerAccountSettings: users.accountSettings,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .where(
            and(
              recentOrOwnedRestaurantWhere,
              or(eq(restaurants.isActive, true), isNull(restaurants.isActive)),
              sql`${users.id} is not null`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(restaurants.createdAt))
          .limit(600);

        const hostRows = await db
          .select({
            id: hosts.id,
            userId: hosts.userId,
            businessName: hosts.businessName,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            locationType: hosts.locationType,
            expectedFootTraffic: hosts.expectedFootTraffic,
            contactPhone: hosts.contactPhone,
            notes: hosts.notes,
            isVerified: hosts.isVerified,
            spotCount: hosts.spotCount,
            spotImageUrl: hosts.spotImageUrl,
            description: hosts.description,
            businessWebsite: hosts.businessWebsite,
            facebookPageId: hosts.facebookPageId,
            facebookPageUrl: hosts.facebookPageUrl,
            facebookCoverUrl: hosts.facebookCoverUrl,
            facebookPhotos: hosts.facebookPhotos,
            googlePhotos: hosts.googlePhotos,
            googlePlaceId: hosts.googlePlaceId,
            googleRating: hosts.googleRating,
            googleReviewCount: hosts.googleReviewCount,
            googlePriceLevel: hosts.googlePriceLevel,
            googleBusinessStatus: hosts.googleBusinessStatus,
            googleCategories: hosts.googleCategories,
            googleFormattedPhone: hosts.googleFormattedPhone,
            profileSource: hosts.profileSource,
            profileLastSynced: hosts.profileLastSynced,
            createdAt: hosts.createdAt,
            ownerEmail: users.email,
            ownerPhone: users.phone,
            ownerFirstName: users.firstName,
            ownerLastName: users.lastName,
            ownerProfileImageUrl: users.profileImageUrl,
            ownerAffiliateTag: users.affiliateTag,
            ownerAccountSettings: users.accountSettings,
          })
          .from(hosts)
          .leftJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              recentOrOwnedHostWhere,
              sql`${users.id} is not null`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(hosts.createdAt))
          .limit(600);

        const supplierRows = await db
          .select({
            id: suppliers.id,
            userId: suppliers.userId,
            businessName: suppliers.businessName,
            address: suppliers.address,
            city: suppliers.city,
            state: suppliers.state,
            contactPhone: suppliers.contactPhone,
            contactEmail: suppliers.contactEmail,
            isActive: suppliers.isActive,
            onlinePaymentsEnabled: suppliers.onlinePaymentsEnabled,
            offersDelivery: suppliers.offersDelivery,
            deliveryRadiusMiles: suppliers.deliveryRadiusMiles,
            onlinePaymentsNotes: suppliers.onlinePaymentsNotes,
            deliveryNotes: suppliers.deliveryNotes,
            createdAt: suppliers.createdAt,
            ownerEmail: users.email,
            ownerPhone: users.phone,
            ownerFirstName: users.firstName,
            ownerLastName: users.lastName,
            ownerProfileImageUrl: users.profileImageUrl,
            ownerAffiliateTag: users.affiliateTag,
            ownerAccountSettings: users.accountSettings,
          })
          .from(suppliers)
          .leftJoin(users, eq(suppliers.userId, users.id))
          .where(
            and(
              recentOrOwnedSupplierWhere,
              eq(suppliers.isActive, true),
              sql`${users.id} is not null`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(suppliers.createdAt))
          .limit(600);

        const restaurantRowsAny = restaurantRows as any[];
        const hostRowsAny = hostRows as any[];
        const supplierRowsAny = supplierRows as any[];

        await ensureRecentSignupAffiliateTags({
          userRows: recentUserRows,
          restaurantRows: restaurantRowsAny,
          hostRows: hostRowsAny,
          supplierRows: supplierRowsAny,
        });

        await enrichRecentSignupGoogleRows(restaurantRowsAny, hostRowsAny);

        const restaurantsByOwner = new Map<string, any[]>();
        const hostsByOwner = new Map<string, any[]>();
        const suppliersByOwner = new Map<string, any[]>();
        const restaurantIds = Array.from(
          new Set(
            restaurantRowsAny
              .map((row) => String(row.id || "").trim())
              .filter(Boolean),
          ),
        );
        const hostIds = Array.from(
          new Set(
            hostRowsAny
              .map((row) => String(row.id || "").trim())
              .filter(Boolean),
          ),
        );
        const supplierIds = Array.from(
          new Set(
            supplierRowsAny
              .map((row) => String(row.id || "").trim())
              .filter(Boolean),
          ),
        );
        const menuStatsByRestaurant = new Map<
          string,
          { itemCount: number; itemNames: string[]; menuCount: number }
        >();
        const productStatsBySupplier = new Map<
          string,
          { itemCount: number; itemNames: string[]; imageUrl: string | null }
        >();
        const videoCountsByEntity = new Map<string, number>();
        const videoThumbByEntity = new Map<string, string>();
        const insuranceByEntity = new Map<
          string,
          ReturnType<typeof summarizeRecentSignupInsurance>
        >();

        try {
          const insuranceClauses: any[] = [];
          const restaurantInsuranceIdsByType = new Map<string, string[]>();
          for (const row of restaurantRowsAny) {
            const id = String(row.id || "").trim();
            if (!id) continue;
            const entityType = insuranceEntityTypeForRestaurantRow(row);
            const ids = restaurantInsuranceIdsByType.get(entityType) || [];
            ids.push(id);
            restaurantInsuranceIdsByType.set(entityType, ids);
          }
          for (const [entityType, ids] of restaurantInsuranceIdsByType) {
            if (!ids.length) continue;
            insuranceClauses.push(
              and(
                eq(businessInsuranceVerifications.entityType, entityType),
                inArray(businessInsuranceVerifications.entityId, ids),
              ),
            );
          }
          if (hostIds.length) {
            insuranceClauses.push(
              and(
                eq(businessInsuranceVerifications.entityType, "host"),
                inArray(businessInsuranceVerifications.entityId, hostIds),
              ),
            );
          }

          if (insuranceClauses.length) {
            const insuranceRows = await db
              .select({
                entityType: businessInsuranceVerifications.entityType,
                entityId: businessInsuranceVerifications.entityId,
                status: businessInsuranceVerifications.status,
                expiresAt: businessInsuranceVerifications.expiresAt,
                documents: businessInsuranceVerifications.documents,
                attestedCommercialCoverage:
                  businessInsuranceVerifications.attestedCommercialCoverage,
                attestedJurisdictionCompliance:
                  businessInsuranceVerifications.attestedJurisdictionCompliance,
                createdAt: businessInsuranceVerifications.createdAt,
              })
              .from(businessInsuranceVerifications)
              .where(
                insuranceClauses.length === 1
                  ? insuranceClauses[0]
                  : or(...insuranceClauses),
              )
              .orderBy(desc(businessInsuranceVerifications.createdAt));

            for (const row of insuranceRows as any[]) {
              const key = `${row.entityType}:${row.entityId}`;
              if (insuranceByEntity.has(key)) continue;
              insuranceByEntity.set(key, summarizeRecentSignupInsurance(row));
            }
          }
        } catch (error) {
          console.warn(
            "[admin/recent-signups] insurance status unavailable; continuing",
            error,
          );
        }

        if (restaurantIds.length) {
          try {
            const menuStatsRows = await db
              .select({
                restaurantId: menus.restaurantId,
                menuCount:
                  sql<number>`count(distinct ${menus.id}) filter (where ${menus.isActive} = true)`.mapWith(
                    Number,
                  ),
                itemCount:
                  sql<number>`count(${menuItems.id}) filter (where ${menuItems.isAvailable} = true)`.mapWith(
                    Number,
                  ),
                itemNames:
                  sql<string>`string_agg(distinct ${menuItems.name}, ', ') filter (where ${menuItems.isAvailable} = true)`,
              })
              .from(menus)
              .leftJoin(menuItems, eq(menuItems.menuId, menus.id))
              .where(inArray(menus.restaurantId, restaurantIds))
              .groupBy(menus.restaurantId);

            for (const row of menuStatsRows as any[]) {
              menuStatsByRestaurant.set(String(row.restaurantId), {
                itemCount: Number(row.itemCount || 0),
                itemNames: splitMenuHighlights(row.itemNames),
                menuCount: Number(row.menuCount || 0),
              });
            }
          } catch (error) {
            console.warn(
              "[admin/recent-signups] menu stats unavailable; continuing",
              error,
            );
          }

          try {
            const videoRows = await db
              .select({
                ownerId: mediaAssets.ownerId,
                count: sql<number>`count(*)`.mapWith(Number),
              })
              .from(mediaAssets)
              .where(
                and(
                  inArray(mediaAssets.ownerId, restaurantIds),
                  inArray(mediaAssets.ownerType, ["restaurant", "food_truck"] as any),
                  eq(mediaAssets.mediaType, "video"),
                  eq(mediaAssets.status, "active"),
                  eq(mediaAssets.visibility, "public"),
                  isNull(mediaAssets.deletedAt),
                ),
              )
              .groupBy(mediaAssets.ownerId);

            for (const row of videoRows as any[]) {
              videoCountsByEntity.set(
                `restaurant:${row.ownerId}`,
                Number(row.count || 0),
              );
            }

            const videoThumbRows = await db
              .select({
                ownerId: mediaAssets.ownerId,
                thumbnailUrl: mediaAssets.thumbnailUrl,
                fileUrl: mediaAssets.fileUrl,
              })
              .from(mediaAssets)
              .where(
                and(
                  inArray(mediaAssets.ownerId, restaurantIds),
                  inArray(mediaAssets.ownerType, ["restaurant", "food_truck"] as any),
                  eq(mediaAssets.mediaType, "video"),
                  eq(mediaAssets.status, "active"),
                  eq(mediaAssets.visibility, "public"),
                  isNull(mediaAssets.deletedAt),
                ),
              )
              .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt))
              .limit(200);

            for (const row of videoThumbRows as any[]) {
              const key = `restaurant:${row.ownerId}`;
              if (videoThumbByEntity.has(key)) continue;
              const thumb = firstAdminPhotoUrl(row.thumbnailUrl, row.fileUrl);
              if (thumb) videoThumbByEntity.set(key, thumb);
            }
          } catch (error) {
            console.warn(
              "[admin/recent-signups] restaurant video stats unavailable; continuing",
              error,
            );
          }
        }

        if (hostIds.length) {
          try {
            const videoRows = await db
              .select({
                ownerId: mediaAssets.ownerId,
                count: sql<number>`count(*)`.mapWith(Number),
              })
              .from(mediaAssets)
              .where(
                and(
                  inArray(mediaAssets.ownerId, hostIds),
                  eq(mediaAssets.ownerType, "host"),
                  eq(mediaAssets.mediaType, "video"),
                  eq(mediaAssets.status, "active"),
                  eq(mediaAssets.visibility, "public"),
                  isNull(mediaAssets.deletedAt),
                ),
              )
              .groupBy(mediaAssets.ownerId);

            for (const row of videoRows as any[]) {
              videoCountsByEntity.set(`host:${row.ownerId}`, Number(row.count || 0));
            }

            const videoThumbRows = await db
              .select({
                ownerId: mediaAssets.ownerId,
                thumbnailUrl: mediaAssets.thumbnailUrl,
                fileUrl: mediaAssets.fileUrl,
              })
              .from(mediaAssets)
              .where(
                and(
                  inArray(mediaAssets.ownerId, hostIds),
                  eq(mediaAssets.ownerType, "host"),
                  eq(mediaAssets.mediaType, "video"),
                  eq(mediaAssets.status, "active"),
                  eq(mediaAssets.visibility, "public"),
                  isNull(mediaAssets.deletedAt),
                ),
              )
              .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt))
              .limit(200);

            for (const row of videoThumbRows as any[]) {
              const key = `host:${row.ownerId}`;
              if (videoThumbByEntity.has(key)) continue;
              const thumb = firstAdminPhotoUrl(row.thumbnailUrl, row.fileUrl);
              if (thumb) videoThumbByEntity.set(key, thumb);
            }
          } catch (error) {
            console.warn(
              "[admin/recent-signups] host video stats unavailable; continuing",
              error,
            );
          }
        }

        if (supplierIds.length) {
          try {
            const productRows = await db
              .select({
                supplierId: supplierProducts.supplierId,
                itemCount:
                  sql<number>`count(*) filter (where ${supplierProducts.isActive} = true)`.mapWith(
                    Number,
                  ),
                itemNames:
                  sql<string>`string_agg(distinct ${supplierProducts.name}, ', ') filter (where ${supplierProducts.isActive} = true)`,
                imageUrl:
                  sql<string>`max(${supplierProducts.imageUrl}) filter (where ${supplierProducts.isActive} = true and ${supplierProducts.imageUrl} is not null)`,
              })
              .from(supplierProducts)
              .where(inArray(supplierProducts.supplierId, supplierIds))
              .groupBy(supplierProducts.supplierId);

            for (const row of productRows as any[]) {
              productStatsBySupplier.set(String(row.supplierId), {
                itemCount: Number(row.itemCount || 0),
                itemNames: splitMenuHighlights(row.itemNames),
                imageUrl: firstAdminPhotoUrl(row.imageUrl),
              });
            }
          } catch (error) {
            console.warn(
              "[admin/recent-signups] supplier product stats unavailable; continuing",
              error,
            );
          }
        }

        const isInsideWindow = (value: unknown) => {
          const time = new Date(value as any).getTime();
          return Number.isFinite(time) && time >= cutoff.getTime();
        };

        for (const row of restaurantRowsAny) {
          const ownerId = String(row.ownerId || "").trim();
          if (!ownerId) continue;
          const rows = restaurantsByOwner.get(ownerId) || [];
          rows.push(row);
          restaurantsByOwner.set(ownerId, rows);
        }

        for (const row of hostRowsAny) {
          const ownerId = String(row.userId || "").trim();
          if (!ownerId) continue;
          const rows = hostsByOwner.get(ownerId) || [];
          rows.push(row);
          hostsByOwner.set(ownerId, rows);
        }

        for (const row of supplierRowsAny) {
          const ownerId = String(row.userId || "").trim();
          if (!ownerId) continue;
          const rows = suppliersByOwner.get(ownerId) || [];
          rows.push(row);
          suppliersByOwner.set(ownerId, rows);
        }

        const createRestaurantSignup = (
          row: any,
          options: { key?: string; createdAt?: unknown; source?: string } = {},
        ) => {
          const isFoodTruck =
            Boolean(row.isFoodTruck) ||
            String(row.businessType || "").toLowerCase() === "food_truck";
          const businessType = String(row.businessType || "").toLowerCase();
          const isCaterer = businessType === "caterer";
          const isPrivateChef = businessType === "private_chef";
          const kind = isFoodTruck
            ? "food_truck"
            : isPrivateChef
              ? "private_chef"
              : isCaterer
                ? "caterer"
                : "restaurant";
          const isBar = String(row.businessType || "").toLowerCase() === "bar";
          const typeLabel = isFoodTruck
            ? "Food Truck"
            : isPrivateChef
              ? "Private Chef"
            : isCaterer
              ? "Caterer"
              : isBar
              ? "Restaurant or Bar"
              : "Restaurant";
          const owner = { accountSettings: row.ownerAccountSettings };
          const insuranceEntityType = insuranceEntityTypeForRestaurantRow(row);
          const insurance =
            insuranceByEntity.get(`${insuranceEntityType}:${row.id}`) ||
            summarizeRecentSignupInsurance();
          const isPublic = row.isActive !== false && isOwnerProfilePublic(owner);
          const canonicalProfilePath = publicRestaurantPath(row, isFoodTruck);
          const profilePath = isPublic ? canonicalProfilePath : "/map";
          const profileUrl = `${baseUrl}${profilePath}`;
          const sharePath = cleanAffiliateSharePath(
            row.ownerAffiliateTag,
            profilePath,
          );
          const shareUrl = `${baseUrl}${sharePath}`;
          const locationLabel = formatSignupLocation(row);
          const shouldSuppressGoogleImages =
            isFoodTruck || Boolean(String(row.claimedFromImportId || "").trim());
          const coverImageUrl =
            shouldSuppressGoogleImages && isGoogleManagedImageUrl(row.coverImageUrl)
              ? null
              : row.coverImageUrl;
          const imageUrl = absoluteAdminUrl(
            baseUrl,
            firstAdminPhotoUrl(
              coverImageUrl,
              row.facebookCoverUrl,
              row.facebookPhotos,
              shouldSuppressGoogleImages ? null : row.googlePhotos,
              row.logoUrl,
              videoThumbByEntity.get(`restaurant:${row.id}`),
              row.ownerProfileImageUrl,
            ),
          );
          const menuStats = menuStatsByRestaurant.get(String(row.id)) || {
            itemCount: 0,
            itemNames: [],
            menuCount: 0,
          };
          const signup = {
            key: options.key || `restaurant:${row.id}`,
            kind,
            entity: "restaurant",
            id: row.id,
            ownerId: row.ownerId,
            displayName: row.name,
            typeLabel,
            category:
              row.cuisineType ||
              (isFoodTruck
                ? "Mobile food"
                : isCaterer
                  ? "Catering"
                  : row.businessType || "Local food"),
            locationLabel,
            city: row.city || null,
            state: row.state || null,
            address: row.address || null,
            description: row.description || null,
            imageUrl: imageUrl || null,
            shareImageUrl: proxiedAdminImageUrl(imageUrl),
            websiteUrl: row.websiteUrl || null,
            menuUrl: row.menuUrl || null,
            orderUrl: row.orderUrl || null,
            menuCount: menuStats.menuCount,
            menuItemCount: menuStats.itemCount,
            menuItemNames: menuStats.itemNames,
            videoCount: videoCountsByEntity.get(`restaurant:${row.id}`) || 0,
            canonicalProfilePath,
            profilePath,
            profileUrl,
            sharePath,
            shareUrl,
            isPublic,
            isVerified: Boolean(row.isVerified),
            googlePlaceId: row.googlePlaceId || null,
            googleRating: row.googleRating || null,
            googleReviewCount: row.googleReviewCount || null,
            googleProfileLinked: Boolean(row.googlePlaceId),
            insurance,
            profileSource: row.profileSource || null,
            profileCompleteness: {
              hasImage: Boolean(
                imageUrl,
              ),
              hasDescription: Boolean(String(row.description || "").trim()),
              hasMenu: menuStats.itemCount > 0 || Boolean(row.menuUrl),
              hasInsurance: insurance.valid,
              hasLocation: Boolean(locationLabel && locationLabel !== "local"),
              isPublic,
            },
            createdAt: options.createdAt || row.createdAt,
            ownerName:
              [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") ||
              null,
            ownerEmail: row.ownerEmail || null,
            ownerPhone: row.ownerPhone || null,
            ownerAffiliateTag: row.ownerAffiliateTag || null,
            facebookPageId: row.facebookPageId || null,
            facebookPageUrl: row.facebookPageUrl || null,
            source: options.source || "restaurant_onboarding",
          };

          return {
            ...signup,
            caption: buildSignupCaption(signup),
          };
        };

        const createHostSignup = (
          row: any,
          options: { key?: string; createdAt?: unknown; source?: string } = {},
        ) => {
          const isEventCoordinator =
            String(row.locationType || "").toLowerCase() ===
            "event_coordinator";
          const typeLabel = isEventCoordinator ? "Event Host" : "Host Location";
          const owner = { accountSettings: row.ownerAccountSettings };
          const insurance =
            insuranceByEntity.get(`host:${row.id}`) ||
            summarizeRecentSignupInsurance();
          const isPublic = isOwnerProfilePublic(owner);
          const canonicalProfilePath = publicHostPath(row);
          const profilePath = isPublic ? canonicalProfilePath : "/map";
          const profileUrl = `${baseUrl}${profilePath}`;
          const sharePath = cleanAffiliateSharePath(
            row.ownerAffiliateTag,
            profilePath,
          );
          const shareUrl = `${baseUrl}${sharePath}`;
          const locationLabel = formatSignupLocation(row);
          const hostImageUrl = absoluteAdminUrl(
            baseUrl,
            firstAdminPhotoUrl(
              row.spotImageUrl,
              row.facebookCoverUrl,
              row.facebookPhotos,
              row.googlePhotos,
              videoThumbByEntity.get(`host:${row.id}`),
              row.ownerProfileImageUrl,
            ),
          );
          const signup = {
            key: options.key || `host:${row.id}`,
            kind: "host",
            entity: "host",
            id: row.id,
            ownerId: row.userId,
            displayName: row.businessName,
            typeLabel,
            category: isEventCoordinator
              ? "Events and organizers"
              : "Truck-friendly space",
            locationLabel,
            city: row.city || null,
            state: row.state || null,
            address: row.address || null,
            description: row.description || row.notes || null,
            imageUrl: hostImageUrl || null,
            shareImageUrl: proxiedAdminImageUrl(hostImageUrl),
            websiteUrl: row.businessWebsite || null,
            spotCount: Number(row.spotCount || 0),
            videoCount: videoCountsByEntity.get(`host:${row.id}`) || 0,
            canonicalProfilePath,
            profilePath,
            profileUrl,
            sharePath,
            shareUrl,
            isPublic,
            isVerified: Boolean(row.isVerified),
            googlePlaceId: row.googlePlaceId || null,
            googleRating: row.googleRating || null,
            googleReviewCount: row.googleReviewCount || null,
            googleProfileLinked: Boolean(row.googlePlaceId),
            insurance,
            profileSource: row.profileSource || null,
            profileCompleteness: {
              hasImage: Boolean(hostImageUrl),
              hasDescription: Boolean(
                String(row.description || row.notes || "").trim(),
              ),
              hasInsurance: insurance.valid,
              hasLocation: Boolean(locationLabel && locationLabel !== "local"),
              hasCapacity: Number(row.spotCount || 0) > 0,
              isPublic,
            },
            createdAt: options.createdAt || row.createdAt,
            ownerName:
              [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") ||
              null,
            ownerEmail: row.ownerEmail || null,
            ownerPhone: row.ownerPhone || null,
            ownerAffiliateTag: row.ownerAffiliateTag || null,
            facebookPageId: row.facebookPageId || null,
            facebookPageUrl: row.facebookPageUrl || null,
            source: options.source || "host_onboarding",
          };

          return {
            ...signup,
            caption: buildSignupCaption(signup),
          };
        };

        const createSupplierSignup = (
          row: any,
          options: { key?: string; createdAt?: unknown; source?: string } = {},
        ) => {
          const owner = { accountSettings: row.ownerAccountSettings };
          const isPublic = row.isActive !== false && isOwnerProfilePublic(owner);
          const canonicalProfilePath = publicSupplierPath(row);
          const profilePath = isPublic ? canonicalProfilePath : "/suppliers";
          const profileUrl = `${baseUrl}${profilePath}`;
          const sharePath = cleanAffiliateSharePath(
            row.ownerAffiliateTag,
            profilePath,
            "/suppliers",
          );
          const shareUrl = `${baseUrl}${sharePath}`;
          const locationLabel = formatSignupLocation(row);
          const productStats = productStatsBySupplier.get(String(row.id)) || {
            itemCount: 0,
            itemNames: [],
            imageUrl: null,
          };
          const imageUrl = absoluteAdminUrl(
            baseUrl,
            firstAdminPhotoUrl(productStats.imageUrl, row.ownerProfileImageUrl),
          );
          const description =
            row.onlinePaymentsNotes ||
            row.deliveryNotes ||
            (row.offersDelivery
              ? "Supplies local food businesses with delivery available."
              : "Supplies local food businesses through MealScout.");
          const signup = {
            key: options.key || `supplier:${row.id}`,
            kind: "supplier",
            entity: "supplier",
            id: row.id,
            ownerId: row.userId,
            displayName: row.businessName,
            typeLabel: "Supplier",
            category: row.offersDelivery
              ? "Supplier with delivery"
              : "Food business supplier",
            locationLabel,
            city: row.city || null,
            state: row.state || null,
            address: row.address || null,
            description,
            imageUrl: imageUrl || null,
            shareImageUrl: proxiedAdminImageUrl(imageUrl),
            websiteUrl: null,
            menuItemCount: productStats.itemCount,
            menuItemNames: productStats.itemNames,
            canonicalProfilePath,
            profilePath,
            profileUrl,
            sharePath,
            shareUrl,
            isPublic,
            isVerified: Boolean(row.onlinePaymentsEnabled),
            profileCompleteness: {
              hasImage: Boolean(imageUrl),
              hasDescription: Boolean(String(description || "").trim()),
              hasProducts: productStats.itemCount > 0,
              hasLocation: Boolean(locationLabel && locationLabel !== "local"),
              isPublic,
            },
            createdAt: options.createdAt || row.createdAt,
            ownerName:
              [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") ||
              null,
            ownerEmail: row.ownerEmail || row.contactEmail || null,
            ownerPhone: row.ownerPhone || null,
            ownerAffiliateTag: row.ownerAffiliateTag || null,
            facebookPageId: null,
            facebookPageUrl: null,
            source: options.source || "supplier_onboarding",
          };

          return {
            ...signup,
            caption: buildSignupCaption(signup),
          };
        };

        const createUserSignup = (row: any) => {
          const kind = signupKindForUserType(row.userType);
          const typeLabel = signupUserTypeLabel(row.userType);
          const displayName = displayNameForSignupUser(row);
          const locationLabel =
            String(row.postalCode || "").trim() || "MealScout";
          const profilePath = "/map";
          const profileUrl = `${baseUrl}${profilePath}`;
          const sharePath = cleanAffiliateSharePath(
            row.affiliateTag,
            profilePath,
          );
          const shareUrl = `${baseUrl}${sharePath}`;
          const imageUrl = absoluteAdminUrl(
            baseUrl,
            firstAdminPhotoUrl(row.profileImageUrl),
          );
          const signup = {
            key: `user:${row.id}`,
            kind,
            entity: "user",
            id: row.id,
            ownerId: row.id,
            displayName,
            typeLabel,
            category: signupCategoryForUserType(row.userType),
            nounLabel: typeLabel.toLowerCase(),
            locationLabel,
            city: null,
            state: null,
            address: null,
            description: row.publicBio || null,
            imageUrl: imageUrl || null,
            shareImageUrl: proxiedAdminImageUrl(imageUrl),
            profilePath,
            profileUrl,
            sharePath,
            shareUrl,
            isPublic: true,
            linkLabel: "Referral link",
            isVerified: Boolean(row.emailVerified),
            createdAt: row.createdAt,
            ownerName: displayName,
            ownerEmail: row.email || null,
            ownerPhone: row.phone || null,
            ownerAffiliateTag: row.affiliateTag || null,
            facebookPageId: null,
            facebookPageUrl: null,
            source: "user_signup",
          };

          return {
            ...signup,
            caption: buildSignupCaption(signup),
          };
        };

        const representedBusinessKeys = new Set<string>();
        const userSignups = recentUserRows.map((row) => {
          const userId = String(row.id || "");
          const normalizedType = String(row.userType || "customer")
            .trim()
            .toLowerCase();
          const ownedRestaurants = restaurantsByOwner.get(userId) || [];
          const ownedHosts = hostsByOwner.get(userId) || [];
          const ownedSuppliers = suppliersByOwner.get(userId) || [];
          const preferredHost =
            normalizedType === "host" || normalizedType === "event_coordinator";
          const preferredSupplier = normalizedType === "supplier";

          if (preferredSupplier && ownedSuppliers[0]) {
            representedBusinessKeys.add(`supplier:${ownedSuppliers[0].id}`);
            return createSupplierSignup(ownedSuppliers[0], {
              key: `user:${userId}`,
              createdAt: row.createdAt,
              source: "user_signup",
            });
          }

          if (!preferredHost && !preferredSupplier && ownedRestaurants[0]) {
            representedBusinessKeys.add(`restaurant:${ownedRestaurants[0].id}`);
            return createRestaurantSignup(ownedRestaurants[0], {
              key: `user:${userId}`,
              createdAt: row.createdAt,
              source: "user_signup",
            });
          }

          if (ownedHosts[0]) {
            representedBusinessKeys.add(`host:${ownedHosts[0].id}`);
            return createHostSignup(ownedHosts[0], {
              key: `user:${userId}`,
              createdAt: row.createdAt,
              source: "user_signup",
            });
          }

          if (ownedRestaurants[0]) {
            representedBusinessKeys.add(`restaurant:${ownedRestaurants[0].id}`);
            return createRestaurantSignup(ownedRestaurants[0], {
              key: `user:${userId}`,
              createdAt: row.createdAt,
              source: "user_signup",
            });
          }

          if (ownedSuppliers[0]) {
            representedBusinessKeys.add(`supplier:${ownedSuppliers[0].id}`);
            return createSupplierSignup(ownedSuppliers[0], {
              key: `user:${userId}`,
              createdAt: row.createdAt,
              source: "user_signup",
            });
          }

          return createUserSignup(row);
        });

        const businessOnlySignups = [
          ...restaurantRowsAny
            .filter(
              (row) =>
                isInsideWindow(row.createdAt) &&
                !representedBusinessKeys.has(`restaurant:${row.id}`),
            )
            .map((row) => createRestaurantSignup(row)),
          ...hostRowsAny
            .filter(
              (row) =>
                isInsideWindow(row.createdAt) &&
                !representedBusinessKeys.has(`host:${row.id}`),
            )
            .map((row) => createHostSignup(row)),
          ...supplierRowsAny
            .filter(
              (row) =>
                isInsideWindow(row.createdAt) &&
                !representedBusinessKeys.has(`supplier:${row.id}`),
            )
            .map((row) => createSupplierSignup(row)),
        ];

        const rawSignups = [...userSignups, ...businessOnlySignups].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
        const syntheticFilteredOut = rawSignups.filter(isFilteredRecentSignup);
        const publicCandidates = rawSignups.filter(
          (item) => !isFilteredRecentSignup(item),
        );
        const deduped = includeFiltered
          ? { kept: rawSignups, hidden: [] as any[] }
          : dedupeRecentSignupCards(publicCandidates);
        const filteredOut = [...syntheticFilteredOut, ...deduped.hidden];
        const signups = deduped.kept;

        res.json({
          windowHours: includeAll ? null : hours,
          includeAll,
          includeFiltered,
          filteredOut: filteredOut.length,
          generatedAt: new Date().toISOString(),
          summary: {
            total: signups.length,
            users: signups.filter((item) => item.entity === "user").length,
            customers: signups.filter((item) => item.kind === "customer").length,
            foodTrucks: signups.filter((item) => item.kind === "food_truck")
              .length,
            caterers: signups.filter((item) => item.kind === "caterer").length,
            privateChefs: signups.filter(
              (item) => item.kind === "private_chef",
            ).length,
            restaurants: signups.filter((item) => item.kind === "restaurant")
              .length,
            hosts: signups.filter((item) => item.kind === "host").length,
            suppliers: signups.filter((item) => item.kind === "supplier").length,
            team: signups.filter((item) => item.kind === "team").length,
            notPublic: signups.filter((item) => !item.isPublic).length,
            insuranceValid: signups.filter((item) => item.insurance?.valid)
              .length,
            insurancePending: signups.filter(
              (item) => item.insurance?.status === "pending",
            ).length,
            insuranceNeedsSubmission: signups.filter(
              (item) =>
                item.insurance?.required &&
                ["not_submitted", "expired", "rejected"].includes(
                  item.insurance.status,
                ),
            ).length,
          },
          signups,
          facebookPagePostingConfigured: Boolean(
            (process.env.MEALSCOUT_FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID) &&
              (process.env.MEALSCOUT_FB_PAGE_TOKEN ||
                process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
          ),
        });
      } catch (error: any) {
        console.error("[admin/recent-signups] failed:", error);
        res.status(500).json({
          message: "Failed to load recent signups",
          error: String(error?.message || error),
        });
      }
    },
  );

  app.post(
    "/api/admin/recent-signups/backfill-google",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const includeAll =
          req.body?.all === true ||
          req.query?.all === "1" ||
          String(req.body?.hours || req.query?.hours || "") === "all";
        const hours = includeAll
          ? 0
          : Math.min(
              168,
              Math.max(1, Number(req.body?.hours || req.query?.hours) || 48),
            );
        const limit = Math.min(
          120,
          Math.max(1, Number(req.body?.limit || req.query?.limit) || 60),
        );
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

        const restaurantRows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            description: restaurants.description,
            websiteUrl: restaurants.websiteUrl,
            googlePlaceId: restaurants.googlePlaceId,
            googlePhotos: restaurants.googlePhotos,
            profileSource: restaurants.profileSource,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .where(
            and(
              includeAll ? sql`true` : gte(restaurants.createdAt, cutoff),
              sql`${users.id} is not null`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(restaurants.createdAt))
          .limit(limit);

        const hostRows = await db
          .select({
            id: hosts.id,
            businessName: hosts.businessName,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            contactPhone: hosts.contactPhone,
            description: hosts.description,
            businessWebsite: hosts.businessWebsite,
            googlePlaceId: hosts.googlePlaceId,
            googlePhotos: hosts.googlePhotos,
            profileSource: hosts.profileSource,
          })
          .from(hosts)
          .leftJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              includeAll ? sql`true` : gte(hosts.createdAt, cutoff),
              sql`${users.id} is not null`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .orderBy(desc(hosts.createdAt))
          .limit(Math.ceil(limit / 2));

        const restaurantTargets = (restaurantRows as any[])
          .filter(shouldAttemptGoogleRestaurantAutoLink)
          .slice(0, Math.ceil(limit * 0.7));
        const hostTargets = (hostRows as any[])
          .filter(shouldAttemptGoogleHostAutoLink)
          .slice(0, Math.ceil(limit * 0.3));

        const [restaurantResults, hostResults] = await Promise.all([
          Promise.allSettled(
            restaurantTargets.map((row) =>
              populateRestaurantProfile(String(row.id)),
            ),
          ),
          Promise.allSettled(
            hostTargets.map((row) => populateHostProfile(String(row.id))),
          ),
        ]);

        const restaurantLinked = restaurantResults.filter(
          (result) =>
            result.status === "fulfilled" && Boolean(result.value?.success),
        ).length;
        const hostLinked = hostResults.filter(
          (result) =>
            result.status === "fulfilled" && Boolean(result.value?.success),
        ).length;

        res.json({
          ok: true,
          includeAll,
          windowHours: includeAll ? null : hours,
          scanned: {
            restaurants: restaurantRows.length,
            hosts: hostRows.length,
          },
          attempted: {
            restaurants: restaurantTargets.length,
            hosts: hostTargets.length,
          },
          linked: {
            restaurants: restaurantLinked,
            hosts: hostLinked,
          },
        });
      } catch (error: any) {
        console.error("[admin/recent-signups/backfill-google] failed:", error);
        res.status(500).json({
          message: "Failed to backfill Google listing data",
          error: String(error?.message || error),
        });
      }
    },
  );

  app.post(
    "/api/admin/recent-signups/facebook-share",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const caption = String(req.body?.caption || "").trim().slice(0, 2000);
        const profileUrl = String(req.body?.profileUrl || "")
          .trim()
          .slice(0, 1000);
        const graphicDataUrl = String(req.body?.graphicDataUrl || "").trim();
        const pageId =
          process.env.MEALSCOUT_FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID;
        const pageToken =
          process.env.MEALSCOUT_FB_PAGE_TOKEN ||
          process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
        const fallbackUrl =
          profileUrl || `${resolveAdminPublicBaseUrl()}/map`;
        const fallbackShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
          fallbackUrl,
        )}&quote=${encodeURIComponent(caption)}`;

        if (!caption) {
          return res.status(400).json({ message: "Caption is required" });
        }

        if (!pageId || !pageToken) {
          return res.json({
            ok: false,
            needsConfig: true,
            fallbackShareUrl,
            message:
              "Direct Facebook Page posting is not connected yet. A manual share window is available.",
          });
        }

        const imageBlob = dataUrlToBlob(graphicDataUrl);
        if (!imageBlob) {
          return res.status(400).json({
            message: "A PNG graphic data URL is required for Facebook posting",
          });
        }

        const form = new FormData();
        form.set("access_token", pageToken);
        form.set("caption", caption);
        form.set("published", "true");
        form.set("source", imageBlob, "mealscout-new-signup.png");

        const fbRes = await fetch(
          `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`,
          {
            method: "POST",
            body: form,
          },
        );
        const data = await fbRes.json().catch(() => ({}));
        if (!fbRes.ok) {
          return res.json({
            ok: false,
            fallbackShareUrl,
            message:
              data?.error?.message ||
              "Facebook did not accept the direct post. A manual share window is available.",
            facebookError: data?.error || data || null,
          });
        }

        res.json({
          ok: true,
          facebookPhotoId: data?.id || null,
          facebookPostId: data?.post_id || null,
          taggingSupported: false,
        });
      } catch (error: any) {
        console.error("[admin/recent-signups/facebook-share] failed:", error);
        res.status(500).json({
          message: "Failed to share recent signup",
          error: String(error?.message || error),
        });
      }
    },
  );

  // ── Launch Week ──────────────────────────────────────────────────────────────
  // Operator-friendly snapshot of new business signups + their setup state.
  // Designed for non-technical owners to triage support during launch week.
  // GET /api/admin/launch-week?days=7
  app.get(
    "/api/admin/launch-week",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const today = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // New business owner accounts in the window
        const newOwners = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            userType: users.userType,
            emailVerified: users.emailVerified,
            createdAt: users.createdAt,
            stripeSubscriptionId: users.stripeSubscriptionId,
            trialEndsAt: users.trialEndsAt,
          })
          .from(users)
          .where(
            and(
              gte(users.createdAt, cutoff),
              sql`${users.userType} IN ('restaurant_owner','caterer','private_chef','food_truck')`,
            ),
          )
          .orderBy(sql`${users.createdAt} DESC`)
          .limit(500);

        // Their restaurants (joined separately to avoid Cartesian)
        const ownerIds = newOwners.map((o: any) => o.id);
        const restaurantsForOwners = ownerIds.length
          ? await db
              .select({
                id: restaurants.id,
                ownerId: restaurants.ownerId,
                name: restaurants.name,
                businessType: restaurants.businessType,
                city: restaurants.city,
                state: restaurants.state,
                isVerified: restaurants.isVerified,
                isActive: restaurants.isActive,
                createdAt: restaurants.createdAt,
              })
              .from(restaurants)
              .where(inArray(restaurants.ownerId, ownerIds))
          : [];

        // Menu + item counts per restaurant (1 query)
        const restaurantIds = restaurantsForOwners.map((r: any) => r.id);
        const menuSchemaAvailable = await hasAdminMenuSchema();
        const menuCounts = restaurantIds.length && menuSchemaAvailable
          ? await db
              .select({
                restaurantId: menus.restaurantId,
                menuCount: sql<number>`count(distinct ${menus.id})::int`,
                itemCount: sql<number>`count(${menuItems.id})::int`,
              })
              .from(menus)
              .leftJoin(menuItems, eq(menuItems.menuId, menus.id))
              .where(inArray(menus.restaurantId, restaurantIds))
              .groupBy(menus.restaurantId)
          : [];
        const countsByRestaurant = new Map<
          string,
          { menuCount: number; itemCount: number }
        >();
        for (const c of menuCounts as any[]) {
          countsByRestaurant.set(c.restaurantId, {
            menuCount: Number(c.menuCount || 0),
            itemCount: Number(c.itemCount || 0),
          });
        }

        const importRows = restaurantIds.length && menuSchemaAvailable
          ? await db
              .select({
                restaurantId: menuImportLogs.restaurantId,
                source: menuImportLogs.source,
                status: menuImportLogs.status,
                itemsImported: menuImportLogs.itemsImported,
                itemsSkipped: menuImportLogs.itemsSkipped,
                errors: menuImportLogs.errors,
                createdAt: menuImportLogs.createdAt,
              })
              .from(menuImportLogs)
              .where(
                and(
                  inArray(menuImportLogs.restaurantId, restaurantIds),
                  gte(menuImportLogs.createdAt, cutoff),
                ),
              )
              .orderBy(desc(menuImportLogs.createdAt))
          : [];
        const importsByRestaurant = new Map<
          string,
          {
            attempts: number;
            failed: number;
            lastFailure: {
              source: string;
              status: string;
              itemsImported: number;
              itemsSkipped: number;
              errorCount: number;
              createdAt: Date | null;
            } | null;
          }
        >();
        for (const row of importRows as any[]) {
          const current = importsByRestaurant.get(row.restaurantId) || {
            attempts: 0,
            failed: 0,
            lastFailure: null,
          };
          const itemsImported = Number(row.itemsImported || 0);
          const failed =
            row.status === "failed" ||
            (row.status === "complete" && itemsImported === 0);
          current.attempts += 1;
          if (failed) {
            current.failed += 1;
            if (!current.lastFailure) {
              current.lastFailure = {
                source: row.source || "unknown",
                status: row.status || "unknown",
                itemsImported,
                itemsSkipped: Number(row.itemsSkipped || 0),
                errorCount: Array.isArray(row.errors) ? row.errors.length : 0,
                createdAt: row.createdAt || null,
              };
            }
          }
          importsByRestaurant.set(row.restaurantId, current);
        }

        const restaurantsByOwner = new Map<string, any[]>();
        for (const r of restaurantsForOwners as any[]) {
          const counts = countsByRestaurant.get(r.id) || {
            menuCount: 0,
            itemCount: 0,
          };
          const imports = importsByRestaurant.get(r.id) || {
            attempts: 0,
            failed: 0,
            lastFailure: null,
          };
          const enriched = {
            ...r,
            ...counts,
            publicPreviewUrl:
              String(r.businessType || "").toLowerCase() === "private_chef"
                ? `/chef/${encodeURIComponent(`${toShareSlug(r.name) || r.id}--${r.id}`)}`
                : `/restaurant/${r.id}`,
            importAttempts: imports.attempts,
            failedImports: imports.failed,
            lastImportFailure: imports.lastFailure,
          };
          const arr = restaurantsByOwner.get(r.ownerId) || [];
          arr.push(enriched);
          restaurantsByOwner.set(r.ownerId, arr);
        }

        const rows = newOwners.map((o: any) => {
          const owned = restaurantsByOwner.get(o.id) || [];
          const totalMenus = owned.reduce(
            (s: number, r: any) => s + (r.menuCount || 0),
            0,
          );
          const totalItems = owned.reduce(
            (s: number, r: any) => s + (r.itemCount || 0),
            0,
          );
          const totalFailedImports = owned.reduce(
            (s: number, r: any) => s + (r.failedImports || 0),
            0,
          );
          // Setup score = simple checklist for triage
          const checklist = {
            emailVerified: !!o.emailVerified,
            hasBusiness: owned.length > 0,
            hasMenu: totalMenus > 0,
            hasItems: totalItems > 0,
            isVerified: owned.some((r: any) => r.isVerified),
            hasSubscription: !!o.stripeSubscriptionId,
          };
          const score = Object.values(checklist).filter(Boolean).length;
          return {
            ...o,
            restaurants: owned,
            totalMenus,
            totalItems,
            totalFailedImports,
            checklist,
            setupScore: score,
            stuck:
              score < 3 &&
              new Date(o.createdAt).getTime() < Date.now() - 6 * 60 * 60 * 1000,
          };
        });

        // Aggregate counters
        const summary = {
          windowDays: days,
          totalNewOwners: rows.length,
          newToday: rows.filter((r: any) => new Date(r.createdAt) >= today)
            .length,
          unverifiedEmails: rows.filter((r: any) => !r.emailVerified).length,
          noBusinessYet: rows.filter((r: any) => !r.checklist.hasBusiness)
            .length,
          noMenuYet: rows.filter(
            (r: any) => r.checklist.hasBusiness && !r.checklist.hasMenu,
          ).length,
          failedImports: rows.filter((r: any) => r.totalFailedImports > 0)
            .length,
          stuck: rows.filter((r: any) => r.stuck).length,
          subscribed: rows.filter((r: any) => r.checklist.hasSubscription)
            .length,
          byType: {
            restaurant_owner: rows.filter(
              (r: any) => r.userType === "restaurant_owner",
            ).length,
            caterer: rows.filter((r: any) => r.userType === "caterer").length,
            private_chef: rows.filter(
              (r: any) => r.userType === "private_chef",
            ).length,
            food_truck: rows.filter((r: any) => r.userType === "food_truck")
              .length,
          },
        };

        res.json({ summary, owners: rows });
      } catch (error: any) {
        console.error("[admin/launch-week] failed:", error);
        res.status(500).json({
          message: "Failed to load launch-week snapshot",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/digest/send
  // Manual trigger for the daily digest so admins can verify email delivery.
  app.post(
    "/api/admin/launch-week/digest/send",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const result = await sendAdminDailyDigest();
        console.log(
          `[admin/launch-week/digest] requested by=${req.user?.id || req.user?.claims?.sub || "admin"} sent=${result.sent} reason=${result.reason || "ok"}`,
        );

        if (!result.sent) {
          const status = result.reason === "email_not_configured" ? 503 : 400;
          return res.status(status).json({
            ok: false,
            message:
              result.reason === "email_not_configured"
                ? "Email provider not configured"
                : "Daily digest was not sent",
            reason: result.reason,
            snapshot: result.snapshot,
          });
        }

        res.json({ ok: true, snapshot: result.snapshot });
      } catch (error: any) {
        console.error("[admin/launch-week/digest] failed:", error);
        res.status(500).json({
          message: "Failed to send daily digest",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/alerts/discoverability/run
  // Manual trigger for the hourly discoverability alert scan.
  app.post(
    "/api/admin/launch-week/alerts/discoverability/run",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const result = await sendOwnerDiscoverabilityAlerts();
        console.log(
          `[admin/launch-week/discoverability-alert] requested by=${req.user?.id || req.user?.claims?.sub || "admin"} sent=${result.sent} reason=${result.reason || "ok"} considered=${result.considered} alerted=${result.alerted}`,
        );
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error(
          "[admin/launch-week/discoverability-alert] failed:",
          error,
        );
        res.status(500).json({
          message: "Failed to run discoverability alert scan",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/owners/:userId/action
  // Body: { action: "resend-verification" | "send-profile-recovery" | "send-menu-nudge" | "send-help-offer" }
  // One-click triage actions for owners flagged on the Launch Week dashboard.
  app.post(
    "/api/admin/launch-week/owners/:userId/action",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = String(req.params.userId);
        const action = String(req.body?.action || "");
        const validActions = new Set([
          "resend-verification",
          "send-profile-recovery",
          "send-menu-nudge",
          "send-help-offer",
        ]);
        if (!validActions.has(action)) {
          return res.status(400).json({ message: "Invalid action" });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const requiresEmail =
          action === "resend-verification" ||
          action === "send-profile-recovery" ||
          action === "send-menu-nudge" ||
          action === "send-help-offer";
        if (requiresEmail && !user.email) {
          return res.status(400).json({
            message: "User has no email on file",
          });
        }

        const adminId = req.user?.id || req.user?.claims?.sub || "admin";
        const baseUrl = (
          process.env.PUBLIC_BASE_URL ||
          `${req.protocol}://${req.get("host")}` ||
          "http://localhost:5000"
        ).replace(/\/+$/, "");

        if (action === "resend-verification") {
          if (user.emailVerified) {
            return res.json({ ok: true, skipped: "already_verified" });
          }
          if (!isEmailConfigured()) {
            return res
              .status(503)
              .json({ message: "Email provider not configured" });
          }
          const verifyUrl = await createEmailVerificationUrl(user as any, req);
          if (!verifyUrl) {
            return res
              .status(400)
              .json({ message: "User has no email address" });
          }
          const ok = await emailService.sendEmailVerificationEmail(
            user as any,
            verifyUrl,
          );
          console.log(
            `[admin/launch-week] resend-verification by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        if (action === "send-profile-recovery") {
          if (!isEmailConfigured()) {
            return res
              .status(503)
              .json({ message: "Email provider not configured" });
          }
          const result = await sendOwnerProfileRecoveryEmail({
            user: user as any,
            baseUrl,
            force: Boolean(req.body?.force),
            requestMeta: {
              requestIp: req.ip || undefined,
              userAgent: req.get("User-Agent") || undefined,
              adminId,
            },
          });
          console.log(
            `[admin/launch-week] profile-recovery by=${adminId} owner=${user.id} ok=${result.ok} skipped=${result.skipped || "none"}`,
          );
          return res.json(result);
        }

        if (action === "send-menu-nudge") {
          const firstName = user.firstName || "there";
          const dashUrl = `${baseUrl}/restaurant/dashboard`;
          const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
              <h2>Hi ${firstName}, ready to add your menu?</h2>
              <p>Welcome to MealScout! The fastest way to start getting discovered is to add your menu \u2014 it takes about 2 minutes.</p>
              <p>You can paste a link to your existing website menu, Google profile, Yelp page, or another public menu and we will import the items automatically.</p>
              <p style="margin: 16px 0;">
                <a href="${dashUrl}" style="background:#f97316;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;">
                  Add Your Menu
                </a>
              </p>
              <p>Stuck? Just reply to this email and we will help you import it.</p>
              <p style="color:#6b7280;font-size:12px;">\u2014 The MealScout team</p>
            </div>
          `;
          const text = `Hi ${firstName}, ready to add your menu? Visit ${dashUrl} to get started, or reply to this email and we'll help.`;
          const ok = await emailService.sendBasicEmail(
            user.email,
            "Ready to add your menu? \uD83C\uDF7D\uFE0F",
            html,
            text,
            "general",
          );
          console.log(
            `[admin/launch-week] menu-nudge by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        if (action === "send-help-offer") {
          const firstName = user.firstName || "there";
          const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
              <h2>Hi ${firstName}, want us to set it up for you?</h2>
              <p>I noticed you signed up for MealScout but haven't added a menu yet. No problem \u2014 we can do it for you.</p>
              <p>Just reply to this email with a link to your existing website menu, Google profile, Yelp page, or another public menu and we'll import everything for you within 24 hours.</p>
              <p>Or if you'd rather, reply with a phone number and we'll call to walk you through it.</p>
              <p style="color:#6b7280;font-size:12px;">\u2014 The MealScout team</p>
            </div>
          `;
          const text = `Hi ${firstName}, reply with a link to your menu (website, Google, Yelp, or another public menu) and we'll import it for you within 24 hours. Or send a phone number and we'll call.`;
          const ok = await emailService.sendBasicEmail(
            user.email,
            "Want us to set up your menu for you?",
            html,
            text,
            "general",
          );
          console.log(
            `[admin/launch-week] help-offer by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        return res.status(400).json({ message: "Unhandled action" });
      } catch (error: any) {
        console.error("[admin/launch-week/action] failed:", error);
        res.status(500).json({
          message: "Action failed",
          error: String(error?.message || error),
        });
      }
    },
  );
}
