import { registerGeoAuditRoutes } from "./admin/geoAuditRoutes";
import { registerAffiliateAdminRoutes } from "./admin/affiliateAdminRoutes";
import { registerTruckImportAdminRoutes } from "./admin/truckImportAdminRoutes";
import { registerUserAdminRoutes } from "./admin/userAdminRoutes";
import { registerAdminCoreOpsRoutes } from "./admin/adminCoreOpsRoutes";
import {
  getHostPricingColumnsCheck,
  hasHostSpotImageColumn,
  resetHostPricingColumnsCache,
} from "./admin/hostSchemaSupport";
import type { Express } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  eq,
  and,
  inArray,
  or,
  sql,
  desc,
  isNull,
  gte,
  lt,
  ne,
} from "drizzle-orm";
import { storage } from "../storage";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { sanitizeUser } from "../utils/sanitize";
import { sendAccountSetupInvite } from "../utils/accountSetup";
import { emailService } from "../emailService";
import { emailDeliveryAudit, getEmailConfigSummary } from "../emailService";
import { db } from "../db";
import { logAudit } from "../auditLogger";
import { ensureAffiliateTag } from "../affiliateTagService";
import { syncUserToBrevo } from "../brevoCrm";
import multer from "multer";
import { z } from "zod";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { forwardGeocode } from "../utils/geocoding";
import { ensurePremiumTrialForUserId } from "../services/premiumTrial";
import { loadProfileCompletionEvidenceBatch } from "../services/profileCompletionEvidence";
import {
  canAssignUserType,
  getRoleAssignmentDeniedMessage,
  isAdminUserType,
  isInternalTeamUserType,
  shouldAssignAffiliateTagForUserType,
} from "../roleAccess";
import {
  deals,
  eventBookings,
  eventInterests,
  eventSeries,
  events,
  foodTruckLocations,
  foodTruckSessions,
  geoAdEvents,
  geoLocationPings,
  hosts,
  imageUploads,
  insertHostSchema,
  menuItems,
  menus,
  restaurants,
  requestLogs,
  searchQueryEvents,
  socialPostQueue,
  telemetryEvents,
  verificationRequests,
  truckImportBatches,
  truckImportListings,
  truckClaimRequests,
  truckInterests,
  users,
  userAddresses,
  locationRequests,
  videoStories,
  apiKeys,
  clientQuotas,
} from "@shared/schema";
import { isSlotWithinHours } from "@shared/parkingPassSlots";
import {
  computeParkingPassQualityFlags,
  isParkingPassPublicReady,
} from "../services/parkingPassQuality";
import { listParkingPassOccurrences } from "../services/parkingPassVirtual";
import { runParkingPassIntegrity } from "../services/parkingPassIntegrity";
import { getPaymentHealthSnapshot } from "../services/paymentHealth";
import { getSupplyMarketDataLanes } from "../services/supplyMarketIntel";

const asAdminCompletionRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const normalizeAdminCompletionValue = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
};

export const mergeAdminBusinessCompletionSettings = (input: {
  settingsValue: unknown;
  publicActionLinks?: Record<string, unknown>;
  reviewed?: Record<string, unknown>;
  galleryImageUrl?: unknown;
  galleryImageApproved?: boolean;
  verifiedAt: string;
}) => {
  const settings = asAdminCompletionRecord(input.settingsValue);
  let nextSettings: Record<string, unknown> = { ...settings };

  if (input.publicActionLinks) {
    const actionLinks = {
      ...asAdminCompletionRecord(settings.publicActionLinks),
    };
    for (const [key, value] of Object.entries(input.publicActionLinks)) {
      if (value === undefined) continue;
      actionLinks[key] = normalizeAdminCompletionValue(value);
    }
    nextSettings.publicActionLinks = actionLinks;
  }

  if (input.reviewed) {
    const reviewedUpdates = Object.fromEntries(
      Object.entries(input.reviewed).filter(([, value]) => value !== undefined),
    );
    nextSettings.completionReview = {
      ...asAdminCompletionRecord(settings.completionReview),
      ...reviewedUpdates,
    };
  }

  if (input.galleryImageUrl !== undefined) {
    const url = normalizeAdminCompletionValue(input.galleryImageUrl);
    if (url) {
      const gallery = Array.isArray(settings.publicGalleryImages)
        ? [...settings.publicGalleryImages]
        : [];
      nextSettings.publicGalleryImages = [
        ...gallery,
        {
          url,
          source: "gallery",
          publicApproved: input.galleryImageApproved !== false,
          lastVerifiedAt: input.verifiedAt,
        },
      ];
    }
  }

  return nextSettings;
};

export const createLockedAdminBusinessCompletionMutation = (database: any) =>
  async <T>(
    businessId: string,
    mutate: (tx: any, restaurant: Record<string, any>) => Promise<T>,
  ): Promise<T | null> =>
    database.transaction(async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${businessId}))`,
      );
      const [restaurant] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, businessId))
        .limit(1)
        .for("update");
      if (!restaurant) return null;
      return mutate(tx, restaurant as Record<string, any>);
    });

const withLockedAdminBusinessCompletion =
  createLockedAdminBusinessCompletionMutation(db);

const safeAdminCompletionErrorContext = (error: unknown) => {
  const record = asAdminCompletionRecord(error);
  return {
    errorName:
      typeof record.name === "string" ? record.name.slice(0, 80) : "Error",
    errorCode:
      typeof record.code === "string" ? record.code.slice(0, 80) : "unknown",
  };
};

const buildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  `${(address || "").trim().toLowerCase()}|${(city || "")
    .trim()
    .toLowerCase()}|${(state || "").trim().toLowerCase()}`;

const retryGeocodeAddress = async (rawAddress: string) => {
  const base = (rawAddress || "").trim();
  if (!base) return null;
  const candidates = Array.from(new Set([base, `${base}, USA`]));
  for (const candidate of candidates) {
    const coords = await forwardGeocode(candidate, { force: true }).catch(
      () => null,
    );
    if (coords) {
      return { coords, attempted: candidate };
    }
  }
  return null;
};

const buildLisaLane = (claim: {
  app?: string | null;
  source?: string | null;
  claimType?: string | null;
  subjectType?: string | null;
}) =>
  [
    claim.app || "unknown",
    claim.source || "unknown",
    claim.claimType || "unknown",
    claim.subjectType || "unknown",
  ].join(":");

const buildSignalLane = (parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || "unknown")).join(":");

const shouldAssignAffiliateTag = (candidateUserType?: string | null) =>
  shouldAssignAffiliateTagForUserType(candidateUserType);

const toCountDeltaLine = (
  label: string,
  currentCount: number,
  previousCount: number,
) => {
  const delta = currentCount - previousCount;
  if (delta > 0) {
    return `${label} is up ${delta} since yesterday (${currentCount} vs ${previousCount}).`;
  }
  if (delta < 0) {
    return `${label} is down ${Math.abs(delta)} since yesterday (${currentCount} vs ${previousCount}).`;
  }
  return `${label} is flat since yesterday (${currentCount} vs ${previousCount}).`;
};

const formatDealValueLabel = (
  dealType?: string | null,
  discountValue?: string | number | null,
  minOrderAmount?: string | number | null,
) => {
  const discount = Number(discountValue || 0);
  const minOrder = Number(minOrderAmount || 0);
  const baseLabel =
    String(dealType || "").toLowerCase() === "fixed"
      ? `$${discount.toFixed(0)} off`
      : `${discount.toFixed(discount % 1 === 0 ? 0 : 2)}% off`;
  if (minOrder > 0) {
    return `${baseLabel} on orders from $${minOrder.toFixed(0)}`;
  }
  return baseLabel;
};

const classifyObservedEventType = (pathValue: string): string => {
  const path = String(pathValue || "").toLowerCase();
  if (/^\/restaurant\/[^/?#]+$/.test(path)) return "profile_view";
  if (/\/search/.test(path)) return "search_submit";
  if (/^\/category\/[^/?#]+/.test(path)) return "category_view";
  if (/(favorite|save)/.test(path)) return "save";
  if (/(call|phone)/.test(path)) return "call_click";
  if (/website/.test(path)) return "website_click";
  if (/direction/.test(path)) return "directions_click";
  if (/(book|checkout|order|event-signup|claim|subscribe)/.test(path))
    return "conversion_intent";
  return "page_view";
};

const inferObservedSurface = (pathValue: string): string => {
  const path = String(pathValue || "").toLowerCase();
  if (path.startsWith("/restaurant/")) return "restaurant_profile";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/category/")) return "category";
  if (path.startsWith("/map")) return "map";
  if (path.startsWith("/events")) return "events";
  return "web";
};

const requestLogLegacySelect = {
  id: requestLogs.id,
  method: requestLogs.method,
  path: requestLogs.path,
  statusCode: requestLogs.statusCode,
  durationMs: requestLogs.durationMs,
  userId: requestLogs.userId,
  ip: requestLogs.ip,
  userAgent: requestLogs.userAgent,
  createdAt: requestLogs.createdAt,
};

const PRICE_SCOUT_TOKEN_ENV_KEYS = [
  "PRICESCOUT_FEED_API_TOKENS",
  "PRICESCOUT_FEED_API_TOKEN",
  "MEALSCOUT_ACTION_TOKENS",
  "MEALSCOUT_ACTION_TOKEN",
  "TRADESCOUT_API_TOKENS",
  "TRADESCOUT_API_TOKEN",
] as const;

const getConfiguredPriceScoutTokens = () => {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const key of PRICE_SCOUT_TOKEN_ENV_KEYS) {
    const raw = String(process.env[key] || "");
    if (!raw.trim()) continue;
    raw
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((token) => {
        if (seen.has(token)) return;
        seen.add(token);
        values.push(token);
      });
  }
  return values;
};

const extractBearerToken = (authorizationHeader?: string | null) => {
  const raw = String(authorizationHeader || "").trim();
  if (!raw) return "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
};

const fingerprintToken = (token: string) =>
  token
    ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)
    : "anonymous";

/**
 * Validates a Bearer token against either environment-based "master" tokens
 * or tiered API keys in the database. Returns quota and owner info if valid.
 */
async function validateFeedAccess(bearerToken: string) {
  if (!bearerToken) return null;

  // 1. Check persistent environment secrets (Master access)
  const masterTokens = getConfiguredPriceScoutTokens();
  if (masterTokens.includes(bearerToken)) {
    return {
      type: "master",
      tier: "unlimited",
      rateLimitPerHour: 1000,
      monthlyLimit: 100000,
      userId: "system",
      keyId: "env_master",
    };
  }

  // 2. Check Database API Keys (Tiered/Paid access)
  const keyRecords = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      keyHash: apiKeys.keyHash,
      isActive: apiKeys.isActive,
      expiresAt: apiKeys.expiresAt,
      // Joined quota info
      tier: clientQuotas.tier,
      rateLimitPerHour: clientQuotas.rateLimitPerHour,
      monthlyLimit: clientQuotas.monthlyRequestLimit,
      quotaActive: clientQuotas.isActive,
    })
    .from(apiKeys)
    .innerJoin(clientQuotas, eq(clientQuotas.userId, apiKeys.userId))
    .where(
      and(
        eq(apiKeys.keyPrefix, bearerToken.slice(0, 8)),
        eq(apiKeys.isActive, true),
        or(isNull(apiKeys.expiresAt), gte(apiKeys.expiresAt, new Date())),
      ),
    );

  let keyRecord: (typeof keyRecords)[number] | undefined;
  for (const candidate of keyRecords) {
    try {
      const matches = await bcrypt.compare(bearerToken, candidate.keyHash);
      if (matches) {
        keyRecord = candidate;
        break;
      }
    } catch {
      // Ignore malformed candidate hashes and continue.
    }
  }

  if (keyRecord && keyRecord.quotaActive !== false) {
    return {
      type: "tiered",
      tier: keyRecord.tier || "bronze",
      rateLimitPerHour: keyRecord.rateLimitPerHour || 60,
      monthlyLimit: keyRecord.monthlyLimit || 1000,
      userId: keyRecord.userId,
      keyId: keyRecord.id,
    };
  }

  return null;
}

const priceScoutFeedLimiter = distributedRateLimit({
  scope: "api:price-scout-feed",
  windowMs: 60 * 60 * 1000, // Hourly window for pricing tiers
  limit: 60, // Default fallback
  key: (req: any) => {
    const token = extractBearerToken(String(req.get?.("authorization") || ""));
    if (token) return `token:${fingerprintToken(token)}`;
    if (req.user?.id) return `user:${String(req.user.id)}`;
    return `ip:${String(req.ip || "unknown")}`;
  },
});

const botSignatureLabel = (userAgent?: string | null) => {
  const ua = String(userAgent || "");
  if (/gptbot/i.test(ua)) return "GPTBot";
  if (/chatgpt-user/i.test(ua)) return "ChatGPT-User";
  if (/oai-searchbot/i.test(ua)) return "OAI-SearchBot";
  if (/claudebot|anthropic/i.test(ua)) return "Claude";
  if (/perplexity/i.test(ua)) return "Perplexity";
  if (/googlebot|google-inspectiontool/i.test(ua)) return "Googlebot";
  if (/bingbot/i.test(ua)) return "Bingbot";
  if (/bytespider/i.test(ua)) return "Bytespider";
  if (/bot|crawler|spider|fetcher/i.test(ua)) return "Bot";
  return null;
};

const isOperationalNoisePath = (path?: string | null) => {
  const value = String(path || "")
    .trim()
    .toLowerCase();
  if (!value) return true;
  return (
    value === "/api/health" ||
    value === "/health" ||
    value === "/favicon.ico" ||
    value === "/robots.txt" ||
    value.startsWith("/api/auth/admin/verify") ||
    value.startsWith("/api/admin/health") ||
    value.startsWith("/api/admin/stats") ||
    value.startsWith("/api/debug") ||
    value.startsWith("/_vercel") ||
    value.startsWith("/.well-known")
  );
};

const isMonitoringAgent = (userAgent?: string | null) => {
  const ua = String(userAgent || "").toLowerCase();
  return /uptimerobot|better stack|betterstack|statuscake|pingdom|newrelic|datadog|kuma/i.test(
    ua,
  );
};

const isHighValueObservedPath = (path?: string | null) => {
  const value = String(path || "")
    .trim()
    .toLowerCase();
  if (!value) return false;
  if (value.startsWith("/restaurant/")) return true;
  if (value.startsWith("/truck/")) return true;
  if (value.startsWith("/deal/")) return true;
  if (value.startsWith("/event/")) return true;
  if (value.startsWith("/p/")) return true;
  if (value.startsWith("/map")) return true;
  if (value.startsWith("/search")) return true;
  if (value.startsWith("/events")) return true;
  if (value.startsWith("/deals")) return true;
  if (value.startsWith("/cuisine/")) return true;
  if (value.startsWith("/category/")) return true;
  if (value.startsWith("/suppliers")) return true;
  if (value.startsWith("/api/public/canonical/")) return true;
  if (value.startsWith("/api/public/evidence/")) return true;
  return false;
};

const hoursSince = (value?: string | Date | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
};

const staleBucketFromHours = (hours: number | null) => {
  if (hours == null) return "unknown";
  if (hours <= 24) return "fresh";
  if (hours <= 24 * 7) return "recent";
  if (hours <= 24 * 30) return "aging";
  return "stale";
};

const scoreBucket = (score: number) => {
  if (score >= 4) return "strong";
  if (score >= 2) return "growing";
  return "thin";
};

type CanonicalEntitySummary = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  location: string;
  canonicalPath: string;
  health: string;
  quality: string;
  freshness: string;
  freshnessHours: number | null;
  machineReadiness: string;
  canonicalFields: Record<string, unknown>;
  knowledgeGaps: string[];
  opportunities: string[];
  recommendedActions: Array<{
    id: string;
    label: string;
    href: string;
    kind: "admin" | "public";
  }>;
  updatedAt: string | Date | null;
};

const buildCanonicalPath = (entityType: string, entityId: string) => {
  switch (entityType) {
    case "restaurant":
      return `/restaurant/${entityId}`;
    case "deal":
      return `/deal/${entityId}`;
    case "event":
      return `/event/${entityId}`;
    case "host":
      return `/p/host/${entityId}`;
    default:
      return `/admin/control-center`;
  }
};

const machineReadinessBucket = (score: number) => {
  if (score >= 4) return "ready";
  if (score >= 2) return "developing";
  return "blocked";
};

const buildRecommendedActions = (entity: {
  entityType: string;
  entityId: string;
  canonicalPath: string;
  knowledgeGaps: string[];
  opportunities: string[];
}) => {
  const actions = new Map<
    string,
    { id: string; label: string; href: string; kind: "admin" | "public" }
  >();

  const add = (
    id: string,
    label: string,
    href: string,
    kind: "admin" | "public" = "admin",
  ) => {
    if (!actions.has(id)) {
      actions.set(id, { id, label, href, kind });
    }
  };

  add(
    "review_public_page",
    "Review public page",
    entity.canonicalPath,
    "public",
  );
  add("open_admin", "Open admin workspace", "/admin", "admin");

  for (const gap of entity.knowledgeGaps) {
    switch (gap) {
      case "missing_description":
        add("add_description", "Add description", "/admin");
        break;
      case "missing_website":
        add("add_website", "Add website link", "/admin");
        break;
      case "missing_location_context":
        add("complete_location", "Complete location data", "/admin");
        break;
      case "missing_cuisine":
        add("set_cuisine", "Set cuisine/category", "/admin");
        break;
      case "unverified_profile":
      case "unverified_host":
        add("verify_entity", "Verify entity", "/admin");
        break;
      case "missing_pricing":
        add("set_pricing", "Set pricing", "/admin");
        break;
      case "stripe_not_ready":
        add("complete_stripe", "Complete Stripe setup", "/admin");
        break;
      case "missing_spot_capacity":
        add("set_capacity", "Set capacity", "/admin");
        break;
      case "missing_restaurant_link":
        add("link_restaurant", "Link restaurant", "/admin");
        break;
      case "missing_start_date":
      case "missing_end_date":
        add("fix_schedule", "Fix schedule/timing", "/admin");
        break;
      case "no_usage_signals":
        add(
          "promote_usage",
          "Promote visibility",
          entity.canonicalPath,
          "public",
        );
        break;
      case "missing_host_link":
        add("link_host", "Link host", "/admin");
        break;
      case "missing_event_type":
      case "missing_event_date":
      case "missing_event_name":
        add("repair_event", "Repair event metadata", "/admin");
        break;
      default:
        break;
    }
  }

  for (const opportunity of entity.opportunities) {
    switch (opportunity) {
      case "activate_live_location":
        add("go_live", "Activate live location", "/admin");
        break;
      case "grow_authority_signals":
        add(
          "grow_authority",
          "Grow authority signals",
          entity.canonicalPath,
          "public",
        );
        break;
      case "refresh_profile_data":
      case "refresh_host_record":
      case "review_deal_freshness":
      case "review_event_status":
        add("refresh_data", "Refresh stale data", "/admin");
        break;
      case "review_for_publish":
        add("publish_ready", "Review for publish", "/admin");
        break;
      case "promote_deal_visibility":
        add(
          "promote_deal",
          "Promote deal visibility",
          entity.canonicalPath,
          "public",
        );
        break;
      case "drive_truck_interest":
        add(
          "drive_interest",
          "Drive truck interest",
          entity.canonicalPath,
          "public",
        );
        break;
      default:
        break;
    }
  }

  return Array.from(actions.values()).slice(0, 4);
};

async function buildCanonicalEntities(
  limit: number,
): Promise<CanonicalEntitySummary[]> {
  const [restaurantRows, hostRows, dealRows, eventRows] = await Promise.all([
    db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        businessType: restaurants.businessType,
        cuisineType: restaurants.cuisineType,
        city: restaurants.city,
        state: restaurants.state,
        isActive: restaurants.isActive,
        isVerified: restaurants.isVerified,
        isFoodTruck: restaurants.isFoodTruck,
        mobileOnline: restaurants.mobileOnline,
        rankingScore: restaurants.rankingScore,
        description: restaurants.description,
        websiteUrl: restaurants.websiteUrl,
        createdAt: restaurants.createdAt,
        updatedAt: restaurants.updatedAt,
      })
      .from(restaurants)
      .orderBy(desc(restaurants.updatedAt))
      .limit(limit),
    db
      .select({
        id: hosts.id,
        businessName: hosts.businessName,
        city: hosts.city,
        state: hosts.state,
        isVerified: hosts.isVerified,
        spotCount: hosts.spotCount,
        stripeOnboardingCompleted: hosts.stripeOnboardingCompleted,
        parkingPassDailyPriceCents: hosts.parkingPassDailyPriceCents,
        createdAt: hosts.createdAt,
        updatedAt: hosts.updatedAt,
      })
      .from(hosts)
      .orderBy(desc(hosts.updatedAt))
      .limit(limit),
    db
      .select({
        id: deals.id,
        title: deals.title,
        restaurantId: deals.restaurantId,
        isActive: deals.isActive,
        startDate: deals.startDate,
        endDate: deals.endDate,
        currentUses: deals.currentUses,
        createdAt: deals.createdAt,
        updatedAt: deals.updatedAt,
      })
      .from(deals)
      .orderBy(desc(deals.updatedAt))
      .limit(limit),
    db
      .select({
        id: events.id,
        name: events.name,
        hostId: events.hostId,
        eventType: events.eventType,
        status: events.status,
        date: events.date,
        createdAt: events.createdAt,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .orderBy(desc(events.updatedAt))
      .limit(limit),
  ]);

  const entities: CanonicalEntitySummary[] = [
    ...restaurantRows.map((row: any) => {
      const completenessScore =
        Number(Boolean(row.description)) +
        Number(Boolean(row.websiteUrl)) +
        Number(Boolean(row.city && row.state)) +
        Number(Boolean(row.cuisineType)) +
        Number(Boolean(row.isVerified));
      const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
      const knowledgeGaps = [
        !row.description ? "missing_description" : null,
        !row.websiteUrl ? "missing_website" : null,
        !(row.city && row.state) ? "missing_location_context" : null,
        !row.cuisineType ? "missing_cuisine" : null,
        !row.isVerified ? "unverified_profile" : null,
      ].filter(Boolean) as string[];
      const opportunities = [
        row.isFoodTruck && !row.mobileOnline ? "activate_live_location" : null,
        row.rankingScore < 50 ? "grow_authority_signals" : null,
        freshnessHours != null && freshnessHours > 24 * 7
          ? "refresh_profile_data"
          : null,
      ].filter(Boolean) as string[];
      const readinessScore =
        Number(Boolean(row.description)) +
        Number(Boolean(row.websiteUrl)) +
        Number(Boolean(row.city && row.state)) +
        Number(Boolean(row.isVerified));
      const entity: CanonicalEntitySummary = {
        id: `restaurant:${row.id}`,
        entityType: "restaurant",
        entityId: row.id,
        title: row.name,
        location: [row.city, row.state].filter(Boolean).join(", "),
        canonicalPath: buildCanonicalPath("restaurant", row.id),
        health:
          row.isVerified && row.isActive
            ? "verified"
            : row.isActive
              ? "active"
              : "inactive",
        quality: scoreBucket(completenessScore),
        freshness: staleBucketFromHours(freshnessHours),
        freshnessHours,
        machineReadiness: machineReadinessBucket(readinessScore),
        canonicalFields: {
          businessType: row.businessType,
          cuisineType: row.cuisineType,
          isFoodTruck: row.isFoodTruck,
          mobileOnline: row.mobileOnline,
          rankingScore: row.rankingScore,
          hasDescription: Boolean(row.description),
          hasWebsite: Boolean(row.websiteUrl),
        },
        knowledgeGaps,
        opportunities,
        recommendedActions: [],
        updatedAt: row.updatedAt || row.createdAt,
      };
      entity.recommendedActions = buildRecommendedActions(entity);
      return entity;
    }),
    ...hostRows.map((row: any) => {
      const completenessScore =
        Number(Boolean(row.city && row.state)) +
        Number(Boolean(row.spotCount)) +
        Number(Boolean(row.parkingPassDailyPriceCents)) +
        Number(Boolean(row.stripeOnboardingCompleted)) +
        Number(Boolean(row.isVerified));
      const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
      const knowledgeGaps = [
        !(row.city && row.state) ? "missing_location_context" : null,
        !row.spotCount ? "missing_spot_capacity" : null,
        !row.parkingPassDailyPriceCents ? "missing_pricing" : null,
        !row.stripeOnboardingCompleted ? "stripe_not_ready" : null,
        !row.isVerified ? "unverified_host" : null,
      ].filter(Boolean) as string[];
      const opportunities = [
        row.parkingPassDailyPriceCents > 0 &&
        row.stripeOnboardingCompleted &&
        !row.isVerified
          ? "review_for_publish"
          : null,
        freshnessHours != null && freshnessHours > 24 * 7
          ? "refresh_host_record"
          : null,
      ].filter(Boolean) as string[];
      const readinessScore =
        Number(Boolean(row.city && row.state)) +
        Number(Boolean(row.spotCount)) +
        Number(Boolean(row.parkingPassDailyPriceCents)) +
        Number(Boolean(row.isVerified));
      const entity: CanonicalEntitySummary = {
        id: `host:${row.id}`,
        entityType: "host",
        entityId: row.id,
        title: row.businessName,
        location: [row.city, row.state].filter(Boolean).join(", "),
        canonicalPath: buildCanonicalPath("host", row.id),
        health: row.isVerified
          ? "verified"
          : row.stripeOnboardingCompleted
            ? "operational"
            : "draft",
        quality: scoreBucket(completenessScore),
        freshness: staleBucketFromHours(freshnessHours),
        freshnessHours,
        machineReadiness: machineReadinessBucket(readinessScore),
        canonicalFields: {
          spotCount: row.spotCount,
          stripeOnboardingCompleted: row.stripeOnboardingCompleted,
          parkingPassDailyPriceCents: row.parkingPassDailyPriceCents,
        },
        knowledgeGaps,
        opportunities,
        recommendedActions: [],
        updatedAt: row.updatedAt || row.createdAt,
      };
      entity.recommendedActions = buildRecommendedActions(entity);
      return entity;
    }),
    ...dealRows.map((row: any) => {
      const completenessScore =
        Number(Boolean(row.restaurantId)) +
        Number(Boolean(row.startDate)) +
        Number(Boolean(row.endDate)) +
        Number(Boolean(row.currentUses && row.currentUses > 0)) +
        Number(Boolean(row.isActive));
      const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
      const knowledgeGaps = [
        !row.restaurantId ? "missing_restaurant_link" : null,
        !row.startDate ? "missing_start_date" : null,
        !row.endDate ? "missing_end_date" : null,
        !row.currentUses ? "no_usage_signals" : null,
      ].filter(Boolean) as string[];
      const opportunities = [
        row.isActive && !row.currentUses ? "promote_deal_visibility" : null,
        freshnessHours != null && freshnessHours > 24 * 7
          ? "review_deal_freshness"
          : null,
      ].filter(Boolean) as string[];
      const readinessScore =
        Number(Boolean(row.restaurantId)) +
        Number(Boolean(row.startDate)) +
        Number(Boolean(row.endDate)) +
        Number(Boolean(row.isActive));
      const entity: CanonicalEntitySummary = {
        id: `deal:${row.id}`,
        entityType: "deal",
        entityId: row.id,
        title: row.title,
        location: row.restaurantId,
        canonicalPath: buildCanonicalPath("deal", row.id),
        health: row.isActive ? "active" : "inactive",
        quality: scoreBucket(completenessScore),
        freshness: staleBucketFromHours(freshnessHours),
        freshnessHours,
        machineReadiness: machineReadinessBucket(readinessScore),
        canonicalFields: {
          restaurantId: row.restaurantId,
          startDate: row.startDate,
          endDate: row.endDate,
          currentUses: row.currentUses,
        },
        knowledgeGaps,
        opportunities,
        recommendedActions: [],
        updatedAt: row.updatedAt || row.createdAt,
      };
      entity.recommendedActions = buildRecommendedActions(entity);
      return entity;
    }),
    ...eventRows.map((row: any) => {
      const completenessScore =
        Number(Boolean(row.hostId)) +
        Number(Boolean(row.eventType)) +
        Number(Boolean(row.date)) +
        Number(Boolean(row.status)) +
        Number(Boolean(row.name));
      const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
      const knowledgeGaps = [
        !row.hostId ? "missing_host_link" : null,
        !row.eventType ? "missing_event_type" : null,
        !row.date ? "missing_event_date" : null,
        !row.name ? "missing_event_name" : null,
      ].filter(Boolean) as string[];
      const opportunities = [
        row.status === "open" ? "drive_truck_interest" : null,
        freshnessHours != null && freshnessHours > 24 * 7
          ? "review_event_status"
          : null,
      ].filter(Boolean) as string[];
      const readinessScore =
        Number(Boolean(row.hostId)) +
        Number(Boolean(row.eventType)) +
        Number(Boolean(row.date)) +
        Number(Boolean(row.name));
      const entity: CanonicalEntitySummary = {
        id: `event:${row.id}`,
        entityType: "event",
        entityId: row.id,
        title: row.name || "Unnamed event",
        location: row.hostId,
        canonicalPath: buildCanonicalPath("event", row.id),
        health: row.status,
        quality: scoreBucket(completenessScore),
        freshness: staleBucketFromHours(freshnessHours),
        freshnessHours,
        machineReadiness: machineReadinessBucket(readinessScore),
        canonicalFields: {
          hostId: row.hostId,
          eventType: row.eventType,
          date: row.date,
        },
        knowledgeGaps,
        opportunities,
        recommendedActions: [],
        updatedAt: row.updatedAt || row.createdAt,
      };
      entity.recommendedActions = buildRecommendedActions(entity);
      return entity;
    }),
  ];

  return entities
    .sort(
      (a, b) =>
        new Date(String(b.updatedAt)).getTime() -
        new Date(String(a.updatedAt)).getTime(),
    )
    .slice(0, limit * 2);
}

const truckImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Large state/county exports can exceed 20MB; allow override via env.
    fileSize:
      (Number(process.env.TRUCK_IMPORT_MAX_FILE_SIZE_MB || 50) || 50) *
      1024 *
      1024,
  },
});

const truckImportUploadSingle = (req: any, res: any, next: any) => {
  const maxMb = Number(process.env.TRUCK_IMPORT_MAX_FILE_SIZE_MB || 50) || 50;
  return truckImportUpload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof (multer as any).MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: `File is too large. Max upload size is ${maxMb}MB.`,
          code: "file_too_large",
          maxFileSizeMb: maxMb,
        });
      }
    }
    return next(err);
  });
};

const IMPORT_SYSTEM_EMAIL =
  process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us";
let importSystemUserIdPromise: Promise<string> | null = null;

let ensureTruckImportTablesPromise: Promise<void> | null = null;
const ensureTruckImportTables = async () => {
  if (!ensureTruckImportTablesPromise) {
    ensureTruckImportTablesPromise = (async () => {
      const statements: string[] = [
        `CREATE TABLE IF NOT EXISTS "truck_import_batches" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "source" varchar,
          "file_name" varchar,
          "uploaded_by" varchar REFERENCES "users"("id"),
          "total_rows" integer DEFAULT 0,
          "imported_rows" integer DEFAULT 0,
          "skipped_rows" integer DEFAULT 0,
          "purged_at" timestamp,
          "purged_by" varchar REFERENCES "users"("id"),
          "created_at" timestamp DEFAULT now(),
          "updated_at" timestamp DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS "idx_truck_import_batches_created"
          ON "truck_import_batches" ("created_at")`,
        `CREATE TABLE IF NOT EXISTS "truck_import_listings" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "batch_id" varchar REFERENCES "truck_import_batches"("id") ON DELETE SET NULL,
          "source" varchar,
          "external_id" varchar,
          "email" varchar,
          "name" varchar NOT NULL,
          "address" text NOT NULL,
          "city" varchar,
          "state" varchar,
          "phone" varchar,
          "cuisine_type" varchar,
          "website_url" varchar,
          "instagram_url" varchar,
          "facebook_page_url" varchar,
          "latitude" decimal(10, 8),
          "longitude" decimal(11, 8),
          "confidence_score" integer DEFAULT 0,
          "status" varchar NOT NULL DEFAULT 'unclaimed',
          "invited_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
          "last_invite_sent_at" timestamp,
          "raw_data" jsonb,
          "created_at" timestamp DEFAULT now(),
          "updated_at" timestamp DEFAULT now()
        )`,
        `ALTER TABLE IF EXISTS "truck_import_listings"
          ADD COLUMN IF NOT EXISTS "batch_id" varchar`,
        `DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'truck_import_batches') THEN
            IF NOT EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conname = 'truck_import_listings_batch_id_fkey'
            ) THEN
              ALTER TABLE "truck_import_listings"
                ADD CONSTRAINT "truck_import_listings_batch_id_fkey"
                FOREIGN KEY ("batch_id") REFERENCES "truck_import_batches"("id")
                ON DELETE SET NULL;
            END IF;
          END IF;
        END $$`,
        `ALTER TABLE IF EXISTS "truck_import_listings"
          ADD COLUMN IF NOT EXISTS "email" varchar`,
        `ALTER TABLE IF EXISTS "truck_import_listings"
          ADD COLUMN IF NOT EXISTS "invited_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL`,
        `ALTER TABLE IF EXISTS "truck_import_listings"
          ADD COLUMN IF NOT EXISTS "last_invite_sent_at" timestamp`,
        `ALTER TABLE IF EXISTS "truck_import_batches"
          ADD COLUMN IF NOT EXISTS "purged_at" timestamp`,
        `ALTER TABLE IF EXISTS "truck_import_batches"
          ADD COLUMN IF NOT EXISTS "purged_by" varchar REFERENCES "users"("id")`,
        `CREATE INDEX IF NOT EXISTS "idx_truck_import_external"
          ON "truck_import_listings" ("external_id")`,
        `CREATE INDEX IF NOT EXISTS "idx_truck_import_status"
          ON "truck_import_listings" ("status")`,
        `CREATE INDEX IF NOT EXISTS "idx_truck_import_state"
          ON "truck_import_listings" ("state")`,
        `CREATE INDEX IF NOT EXISTS "idx_truck_import_batch"
          ON "truck_import_listings" ("batch_id")`,
        `ALTER TABLE IF EXISTS "restaurants"
          ADD COLUMN IF NOT EXISTS "claimed_from_import_id" varchar`,
        `CREATE INDEX IF NOT EXISTS "idx_restaurants_claimed_from_import"
          ON "restaurants" ("claimed_from_import_id")`,
      ];

      for (const statement of statements) {
        try {
          await db.execute(sql.raw(statement));
        } catch (error: any) {
          if (
            error?.code === "42701" || // duplicate_column
            error?.code === "42P07" || // duplicate_table
            error?.message?.includes("already exists")
          ) {
            continue;
          }
          throw error;
        }
      }

      const after = await db.execute(sql`
        select table_name
        from information_schema.tables
        where table_name in ('truck_import_batches', 'truck_import_listings')
      `);
      const afterRows = ((after as any)?.rows ?? []) as Array<{
        table_name?: string;
      }>;
      const afterNames = new Set(
        afterRows.map((row) =>
          String(row?.table_name || "")
            .trim()
            .toLowerCase(),
        ),
      );
      if (
        !afterNames.has("truck_import_batches") ||
        !afterNames.has("truck_import_listings")
      ) {
        throw new Error(
          "Truck import tables are still missing after ensure step.",
        );
      }

      // The admin dashboard joins restaurants.claimed_from_import_id; ensure it exists.
      const claimedFromImport = await db.execute(sql`
        select 1
        from information_schema.columns
        where table_name = 'restaurants'
          and column_name = 'claimed_from_import_id'
        limit 1
      `);
      const claimedFromImportRows = ((claimedFromImport as any)?.rows ??
        []) as Array<unknown>;
      if (claimedFromImportRows.length === 0) {
        throw new Error(
          "restaurants.claimed_from_import_id is missing after ensure step.",
        );
      }
    })();
  }
  return await ensureTruckImportTablesPromise;
};

const getOrCreateImportSystemUserId = async (): Promise<string> => {
  if (!importSystemUserIdPromise) {
    importSystemUserIdPromise = (async () => {
      const existing = await storage.getUserByEmail(IMPORT_SYSTEM_EMAIL);
      if (existing) return existing.id;

      const created = await storage.createUserInvite({
        email: IMPORT_SYSTEM_EMAIL,
        firstName: "System",
        lastName: "Import",
        phone: null,
        userType: "admin",
      });
      return created.id;
    })();
  }
  return await importSystemUserIdPromise;
};

export function registerAdminManagementRoutes(app: Express) {
  const isMissingRelationError = (error: unknown, relationName?: string) => {
    const err = error as { code?: string; message?: string } | null;
    if (!err || err.code !== "42P01") return false;
    if (!relationName) return true;
    return err.message?.includes(`"${relationName}"`) ?? false;
  };

  const isMissingColumnError = (error: unknown, columnName?: string) => {
    const err = error as { code?: string; message?: string } | null;
    if (!err || err.code !== "42703") return false; // undefined_column
    if (!columnName) return true;
    return err.message?.includes(columnName) ?? false;
  };

  const denyStaffEdits = (req: any, res: any) => {
    if (req.user?.userType === "staff") {
      res.status(403).json({ message: "Staff cannot modify existing data" });
      return true;
    }
    return false;
  };
  const requireAdminUser = (req: any, res: any) => {
    if (!isAdminUserType(req.user?.userType)) {
      res.status(403).json({ message: "Admin access required" });
      return false;
    }
    return true;
  };

  app.get(
    "/api/admin/debug/db",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      // Expose a safe DB hint for debugging environment drift (no credentials).
      const raw = String(process.env.DATABASE_URL || "").trim();
      const dbHost =
        raw.match(/@([^:/?#]+)/)?.[1] ??
        raw.match(/\bhost=([^\s;]+)/i)?.[1] ??
        null;
      res.json({
        status: "ok",
        ts: Date.now(),
        dbHost,
        hasDatabaseUrl: Boolean(raw),
        gitCommit:
          String(
            process.env.RENDER_GIT_COMMIT ||
              process.env.VERCEL_GIT_COMMIT_SHA ||
              process.env.GIT_COMMIT ||
              "",
          ).trim() || null,
      });
    },
  );

  app.get(
    "/api/admin/email/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      res.json(getEmailConfigSummary());
    },
  );

  app.post(
    "/api/admin/email/test",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const to = String(req.body?.to || "").trim() || req.user?.email;
        const categoryRaw = String(req.body?.category || "general").trim();
        const category =
          categoryRaw === "account" ? "account" : ("general" as const);
        if (!to) {
          return res.status(400).json({ message: "Recipient email required" });
        }
        const summary = getEmailConfigSummary();
        if (!summary.configured) {
          return res.status(400).json({
            message:
              "Email provider is not configured (missing/invalid BREVO_API_KEY).",
          });
        }

        const ok = await emailService.sendBasicEmail(
          to,
          "MealScout test email",
          "<p>This is a test email from MealScout admin.</p>",
          "This is a test email from MealScout admin.",
          category,
        );
        res.json({
          success: ok,
          configured: summary.configured,
          mode: summary.mode,
          category,
          latestAttempt: emailDeliveryAudit.latest(),
        });
      } catch (error: any) {
        console.error("Error sending test email:", error);
        res.status(500).json({ message: "Failed to send test email" });
      }
    },
  );

  app.get(
    "/api/admin/email/attempts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const rawLimit =
        typeof req.query?.limit === "string" ? req.query.limit : "";
      const limit = Number(rawLimit || 25);
      res.json({ rows: emailDeliveryAudit.list(limit) });
    },
  );

  app.get(
    "/api/admin/users/duplicate-emails",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit =
          typeof req.query?.limit === "string" ? req.query.limit : "";
        const limit = Math.max(1, Math.min(100, Number(rawLimit || 50)));
        const rows = await db.execute(sql`
          with duplicate_keys as (
            select lower(trim(email)) as normalized_email
            from users
            where email is not null
              and trim(email) <> ''
            group by lower(trim(email))
            having count(*) > 1
            order by max(created_at) desc
            limit ${limit}
          ),
          user_rows as (
            select
              u.id,
              lower(trim(u.email)) as normalized_email,
              u.email,
              u.first_name,
              u.last_name,
              u.user_type,
              u.email_verified,
              u.google_id,
              u.facebook_id,
              u.tradescout_id,
              u.password_hash is not null as has_password,
              u.created_at,
              u.updated_at,
              (
                select count(*)::int
                from restaurants r
                where r.owner_id = u.id
              ) as restaurant_count,
              (
                select count(*)::int
                from hosts h
                where h.user_id = u.id
              ) as host_count,
              (
                select count(*)::int
                from user_addresses ua
                where ua.user_id = u.id
              ) as address_count,
              (
                select count(*)::int
                from telemetry_events te
                where te.user_id = u.id
              ) as telemetry_count
            from users u
            inner join duplicate_keys dk
              on dk.normalized_email = lower(trim(u.email))
          )
          select
            normalized_email as "normalizedEmail",
            json_agg(
              json_build_object(
                'id', id,
                'email', email,
                'firstName', first_name,
                'lastName', last_name,
                'userType', user_type,
                'emailVerified', email_verified,
                'hasGoogle', google_id is not null,
                'hasFacebook', facebook_id is not null,
                'hasTradeScout', tradescout_id is not null,
                'hasPassword', has_password,
                'restaurantCount', restaurant_count,
                'hostCount', host_count,
                'addressCount', address_count,
                'telemetryCount', telemetry_count,
                'createdAt', created_at,
                'updatedAt', updated_at
              )
              order by
                email_verified desc,
                (restaurant_count + host_count + address_count + telemetry_count) desc,
                created_at asc
            ) as users
          from user_rows
          group by normalized_email
          order by max(updated_at) desc nulls last
        `);

        const groups = (Array.isArray((rows as any).rows)
          ? (rows as any).rows
          : []
        ).map((group: any) => {
          const candidates = Array.isArray(group.users) ? group.users : [];
          const scored = candidates
            .map((candidate: any) => {
              const linkedDataScore =
                Number(candidate.restaurantCount || 0) * 8 +
                Number(candidate.hostCount || 0) * 8 +
                Number(candidate.addressCount || 0) * 3 +
                Math.min(Number(candidate.telemetryCount || 0), 100);
              const providerScore =
                (candidate.hasGoogle ? 8 : 0) +
                (candidate.hasFacebook ? 8 : 0) +
                (candidate.hasTradeScout ? 8 : 0) +
                (candidate.hasPassword ? 5 : 0);
              const verifiedScore = candidate.emailVerified ? 20 : 0;
              const ageScore = candidate.createdAt
                ? Math.max(
                    0,
                    10 -
                      Math.floor(
                        (Date.now() -
                          new Date(candidate.createdAt).getTime()) /
                          (1000 * 60 * 60 * 24 * 365),
                      ),
                  )
                : 0;
              return {
                ...candidate,
                auditScore:
                  linkedDataScore + providerScore + verifiedScore + ageScore,
              };
            })
            .sort((a: any, b: any) => {
              if (Number(a.auditScore) !== Number(b.auditScore)) {
                return Number(b.auditScore) - Number(a.auditScore);
              }
              return (
                new Date(a.createdAt || 0).getTime() -
                new Date(b.createdAt || 0).getTime()
              );
            });

          const businessLinkedCount = scored.filter(
            (candidate: any) =>
              Number(candidate.restaurantCount || 0) > 0 ||
              Number(candidate.hostCount || 0) > 0,
          ).length;
          const verifiedCount = scored.filter(
            (candidate: any) => candidate.emailVerified,
          ).length;
          const providerLinkedCount = scored.filter(
            (candidate: any) =>
              candidate.hasGoogle ||
              candidate.hasFacebook ||
              candidate.hasTradeScout ||
              candidate.hasPassword,
          ).length;
          const reasons: string[] = [];
          if (businessLinkedCount > 1) {
            reasons.push("multiple accounts have linked business/host data");
          }
          if (verifiedCount > 1) {
            reasons.push("multiple accounts have verified email");
          }
          if (providerLinkedCount > 1) {
            reasons.push("multiple accounts have auth providers");
          }
          if (scored.length > 2) {
            reasons.push("more than two accounts share this email");
          }
          const riskLevel =
            businessLinkedCount > 1 || verifiedCount > 1
              ? "high"
              : providerLinkedCount > 1 || scored.length > 2
                ? "medium"
                : "low";

          return {
            ...group,
            users: scored,
            recommendedPrimaryId: scored[0]?.id || null,
            riskLevel,
            reasons,
          };
        });

        res.json({ groups });
      } catch (error) {
        console.error("Error loading duplicate email users:", error);
        res.status(500).json({
          message: "Failed to load duplicate email users",
        });
      }
    },
  );

  app.get(
    "/api/admin/users/duplicate-emails/:normalizedEmail/merge-plan",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const normalizedEmail = String(req.params.normalizedEmail || "")
          .trim()
          .toLowerCase();
        if (!normalizedEmail || normalizedEmail.includes("@") === false) {
          return res.status(400).json({ message: "Valid email required" });
        }

        const rows = await db.execute(sql`
          select
            u.id,
            u.email,
            u.first_name as "firstName",
            u.last_name as "lastName",
            u.user_type as "userType",
            u.email_verified as "emailVerified",
            u.google_id is not null as "hasGoogle",
            u.facebook_id is not null as "hasFacebook",
            u.tradescout_id is not null as "hasTradeScout",
            u.password_hash is not null as "hasPassword",
            u.created_at as "createdAt",
            (
              select count(*)::int from restaurants r where r.owner_id = u.id
            ) as "restaurantCount",
            (
              select count(*)::int from hosts h where h.user_id = u.id
            ) as "hostCount",
            (
              select count(*)::int from user_addresses ua where ua.user_id = u.id
            ) as "addressCount",
            (
              select count(*)::int from restaurant_favorites rf where rf.user_id = u.id
            ) as "favoriteCount",
            (
              select count(*)::int from restaurant_follows rfo where rfo.user_id = u.id
            ) as "followCount",
            (
              select count(*)::int from restaurant_user_recommendations rur where rur.user_id = u.id
            ) as "recommendationCount",
            (
              select count(*)::int from telemetry_events te where te.user_id = u.id
            ) as "telemetryCount"
          from users u
          where lower(trim(u.email)) = ${normalizedEmail}
          order by
            u.email_verified desc,
            u.created_at asc
        `);
        const candidates = Array.isArray((rows as any).rows)
          ? (rows as any).rows
          : [];
        if (candidates.length < 2) {
          return res.status(404).json({
            message: "No duplicate group found for that email",
          });
        }

        const scored = candidates
          .map((candidate: any) => ({
            ...candidate,
            auditScore:
              (candidate.emailVerified ? 20 : 0) +
              (candidate.hasGoogle ? 8 : 0) +
              (candidate.hasFacebook ? 8 : 0) +
              (candidate.hasTradeScout ? 8 : 0) +
              (candidate.hasPassword ? 5 : 0) +
              Number(candidate.restaurantCount || 0) * 8 +
              Number(candidate.hostCount || 0) * 8 +
              Number(candidate.addressCount || 0) * 3 +
              Number(candidate.favoriteCount || 0) * 2 +
              Number(candidate.followCount || 0) * 2 +
              Number(candidate.recommendationCount || 0) * 4 +
              Math.min(Number(candidate.telemetryCount || 0), 100),
          }))
          .sort((a: any, b: any) => {
            if (Number(a.auditScore) !== Number(b.auditScore)) {
              return Number(b.auditScore) - Number(a.auditScore);
            }
            return (
              new Date(a.createdAt || 0).getTime() -
              new Date(b.createdAt || 0).getTime()
            );
          });

        const primary = scored[0];
        const secondaries = scored.slice(1);
        res.json({
          normalizedEmail,
          primaryUserId: primary.id,
          candidates: scored,
          dryRun: true,
          operations: secondaries.flatMap((candidate: any) => [
            {
              table: "restaurants",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.restaurantCount || 0),
              action: "reassign owner_id",
            },
            {
              table: "hosts",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.hostCount || 0),
              action: "reassign user_id",
            },
            {
              table: "user_addresses",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.addressCount || 0),
              action: "reassign user_id",
            },
            {
              table: "restaurant_favorites",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.favoriteCount || 0),
              action: "dedupe then reassign user_id",
            },
            {
              table: "restaurant_follows",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.followCount || 0),
              action: "dedupe then reassign user_id",
            },
            {
              table: "restaurant_user_recommendations",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.recommendationCount || 0),
              action: "reassign user_id",
            },
            {
              table: "telemetry_events",
              fromUserId: candidate.id,
              toUserId: primary.id,
              count: Number(candidate.telemetryCount || 0),
              action: "reassign user_id",
            },
          ]),
          warnings: [
            "Dry-run only. Do not merge automatically until auth providers, business ownership, payment history, and user consent/admin evidence are reviewed.",
          ],
        });
      } catch (error) {
        console.error("Error building duplicate merge plan:", error);
        res.status(500).json({ message: "Failed to build merge plan" });
      }
    },
  );

  // Manual User/Host Creation
  app.post(
    "/api/admin/users/create",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const {
          email,
          firstName,
          lastName,
          phone,
          businessName,
          address,
          cuisineType,
          latitude,
          longitude,
          locationType,
          footTraffic,
          amenities,
          hostAddress,
          hostBusinessName,
          hostLocationType,
          hostLatitude,
          hostLongitude,
          userType,
          businessType,
          accountType,
          servesFood,
          hostsFoodTrucks,
          wantsFoodTrucks,
          runsEvents,
          postsSpecials,
          allowsPrivateEvents,
          hasFeaturedStaff,
          staffBusinessId,
          staffInviteMode,
        } = req.body;

        // Validate required fields
        const normalizedEmail = email?.trim().toLowerCase();
        const normalizedAccountType = String(accountType || "")
          .trim()
          .toLowerCase();
        const normalizedRequestedUserType = String(userType || "")
          .trim()
          .toLowerCase();
        const normalizedRequestedBusinessType = String(businessType || "")
          .trim()
          .toLowerCase();
        const normalizedStaffBusinessId = String(staffBusinessId || "").trim();
        const normalizedStaffInviteMode = String(staffInviteMode || "")
          .trim()
          .toLowerCase();

        const accountTypeMap: Record<
          string,
          { userType: string; businessType?: string | null }
        > = {
          food_truck_owner: { userType: "food_truck", businessType: "food_truck" },
          restaurant_owner: { userType: "restaurant_owner", businessType: "restaurant" },
          bar_owner: { userType: "restaurant_owner", businessType: "bar" },
          brewery_taproom_owner: { userType: "restaurant_owner", businessType: "brewery_taproom" },
          caterer_owner: { userType: "restaurant_owner", businessType: "caterer" },
          private_chef_owner: { userType: "restaurant_owner", businessType: "private_chef" },
          host_venue_operator: { userType: "host", businessType: "host_venue" },
          event_coordinator: { userType: "event_coordinator", businessType: "event_organizer" },
        };

        const mappedType = accountTypeMap[normalizedAccountType] || null;
        if (normalizedAccountType && !mappedType) {
          return res.status(400).json({ message: "Unknown account type" });
        }
        const resolvedUserType = mappedType?.userType || normalizedRequestedUserType;
        const businessTypesRequiringShell = new Set([
          "food_truck",
          "restaurant",
          "bar",
          "brewery_taproom",
          "caterer",
          "private_chef",
          "host_venue",
          "supplier",
          "event_organizer",
        ]);
        const resolvedBusinessType =
          normalizedRequestedBusinessType ||
          mappedType?.businessType ||
          (resolvedUserType === "food_truck"
            ? "food_truck"
            : resolvedUserType === "restaurant_owner"
              ? "restaurant"
              : null);

        const validUserTypes = [
          "customer",
          "restaurant_owner",
          "food_truck",
          "supplier",
          "host",
          "event_coordinator",
          "staff",
          "admin",
          "duper_admin",
          "super_admin",
        ];

        if (
          !normalizedEmail ||
          !resolvedUserType ||
          !validUserTypes.includes(resolvedUserType)
        ) {
          return res.status(400).json({
            message: "Valid email and userType are required",
          });
        }

        if (!canAssignUserType(req.user?.userType, resolvedUserType)) {
          return res.status(403).json({
            message: getRoleAssignmentDeniedMessage(resolvedUserType),
          });
        }
        if (
          resolvedUserType === "staff" &&
          !normalizedStaffBusinessId &&
          normalizedStaffInviteMode !== "pending_invite"
        ) {
          return res.status(400).json({
            message:
              "Staff provisioning requires selected businessId or pending_invite mode.",
          });
        }

        const isRestaurantProvisionType =
          resolvedUserType === "restaurant_owner" ||
          resolvedUserType === "food_truck" ||
          businessTypesRequiringShell.has(String(resolvedBusinessType || "").toLowerCase());
        const shouldCreateHostProfile =
          resolvedUserType === "host" ||
          resolvedUserType === "event_coordinator" ||
          (resolvedUserType === "restaurant_owner" &&
            String(resolvedBusinessType || "").toLowerCase() === "bar" &&
            Boolean(hostsFoodTrucks || wantsFoodTrucks));
        const normalizedBusinessName = String(businessName || "").trim();
        const normalizedAddress = String(address || "").trim();

        if (
          (isRestaurantProvisionType || shouldCreateHostProfile) &&
          (!normalizedBusinessName || !normalizedAddress)
        ) {
          return res.status(400).json({
            message:
              "businessName and address are required to provision this account type",
          });
        }

        const hasLatitude =
          latitude !== undefined &&
          latitude !== null &&
          `${latitude}`.trim() !== "";
        const hasLongitude =
          longitude !== undefined &&
          longitude !== null &&
          `${longitude}`.trim() !== "";

        let parsedLatitude: number | null = null;
        let parsedLongitude: number | null = null;
        if (hasLatitude || hasLongitude) {
          if (!hasLatitude || !hasLongitude) {
            return res.status(400).json({
              message: "Both latitude and longitude are required together",
            });
          }

          parsedLatitude = Number(latitude);
          parsedLongitude = Number(longitude);
          if (
            !Number.isFinite(parsedLatitude) ||
            !Number.isFinite(parsedLongitude)
          ) {
            return res.status(400).json({
              message: "Latitude and longitude must be valid numbers",
            });
          }
          if (parsedLatitude < -90 || parsedLatitude > 90) {
            return res.status(400).json({
              message: "Latitude must be between -90 and 90",
            });
          }
          if (parsedLongitude < -180 || parsedLongitude > 180) {
            return res.status(400).json({
              message: "Longitude must be between -180 and 180",
            });
          }
        }

        const userIsInternalTeam = isInternalTeamUserType(resolvedUserType);

        let createdHostId: string | null = null;
        let createdBusinessId: string | null = null;
        let createdBusinessType: string | null = null;
        const [user] = await db.transaction(async (tx: any) => {
          const existingUserResult = await tx.execute(sql`
            select
              id,
              email,
              first_name as "firstName",
              last_name as "lastName",
              phone,
              user_type as "userType",
              email_verified as "emailVerified"
            from users
            where lower(email) = ${normalizedEmail}
            limit 1
          `);
          let insertedUser = (existingUserResult as any)?.rows?.[0];
          if (!insertedUser?.id) {
            const insertedUserResult = await tx.execute(sql`
              insert into users (
                email,
                first_name,
                last_name,
                phone,
                user_type,
                password_hash,
                must_reset_password,
                email_verified,
                created_at,
                updated_at
              )
              values (
                ${normalizedEmail},
                ${firstName?.trim() || null},
                ${lastName?.trim() || null},
                ${phone?.trim() || null},
                ${resolvedUserType},
                ${null},
                ${false},
                ${userIsInternalTeam},
                now(),
                now()
              )
              returning
                id,
                email,
                first_name as "firstName",
                last_name as "lastName",
                phone,
                user_type as "userType",
                email_verified as "emailVerified"
            `);
            insertedUser = (insertedUserResult as any)?.rows?.[0];
          }
          if (!insertedUser?.id) {
            throw new Error("Failed to create admin-provisioned user");
          }

          if (isRestaurantProvisionType) {
            const [createdBusiness] = await tx
              .insert(restaurants)
              .values({
                ownerId: insertedUser.id,
                name: normalizedBusinessName,
                address: normalizedAddress,
                cuisineType: cuisineType || "Various",
                businessType: resolvedBusinessType,
                isFoodTruck:
                  resolvedUserType === "food_truck" ||
                  resolvedBusinessType === "food_truck",
                servesFood: Boolean(servesFood ?? true),
                hostsFoodTrucks: Boolean(hostsFoodTrucks),
                wantsFoodTrucks: Boolean(wantsFoodTrucks),
                runsEvents: Boolean(runsEvents),
                postsSpecials: Boolean(postsSpecials),
                allowsPrivateEvents: Boolean(allowsPrivateEvents),
                hasFeaturedStaff: Boolean(hasFeaturedStaff),
                isActive: true,
                isVerified: true,
              })
              .returning({ id: restaurants.id, businessType: restaurants.businessType });
            createdBusinessId = createdBusiness?.id || null;
            createdBusinessType = createdBusiness?.businessType || null;
          }

          if (shouldCreateHostProfile) {
            const existingHostResult = await tx.execute(sql`
              select id from hosts where user_id = ${insertedUser.id} limit 1
            `);
            const existingHost = (existingHostResult as any)?.rows?.[0];
            if (!existingHost?.id) {
            const footTrafficMap: Record<string, number> = {
              low: 50,
              medium: 150,
              high: 300,
            };
            const amenitiesObj: Record<string, boolean> = {};
            if (Array.isArray(amenities)) {
              amenities.forEach((amenity: string) => {
                amenitiesObj[amenity] = true;
              });
            }

            const trimmedHostAddress = String(hostAddress || "").trim();
            const trimmedHostBusinessName = String(hostBusinessName || "").trim();
            const resolvedHostAddress = trimmedHostAddress || normalizedAddress;
            const resolvedHostBusinessName = trimmedHostBusinessName || normalizedBusinessName;
            const resolvedHostLocationType =
              resolvedUserType === "event_coordinator"
                ? "event_organizer"
                : String(hostLocationType || "").trim() || locationType || "other";
            const resolvedHostLatitude =
              hostLatitude !== undefined &&
              hostLatitude !== null &&
              `${hostLatitude}`.trim() !== ""
                ? Number(hostLatitude)
                : parsedLatitude;
            const resolvedHostLongitude =
              hostLongitude !== undefined &&
              hostLongitude !== null &&
              `${hostLongitude}`.trim() !== ""
                ? Number(hostLongitude)
                : parsedLongitude;

            const [insertedHost] = await tx
              .insert(hosts)
              .values({
                userId: insertedUser.id,
                businessName: resolvedHostBusinessName,
                address: resolvedHostAddress,
                locationType: resolvedHostLocationType,
                expectedFootTraffic: footTrafficMap[footTraffic] || 100,
                amenities:
                  Object.keys(amenitiesObj).length > 0 ? amenitiesObj : null,
                isVerified: true,
                adminCreated: true,
                ...(resolvedHostLatitude !== null && resolvedHostLongitude !== null
                  ? {
                      latitude: resolvedHostLatitude.toString(),
                      longitude: resolvedHostLongitude.toString(),
                    }
                  : {}),
              })
              .returning({ id: hosts.id });

            createdHostId = insertedHost?.id || null;
            }
          }

          return [insertedUser];
        });

        if (createdHostId) {
          storage.ensureDraftParkingPassForHost(createdHostId).catch((e) => {
            console.warn(
              "ensureDraftParkingPassForHost failed for admin-created host",
              e,
            );
          });
        }

        if (shouldAssignAffiliateTag(user.userType)) {
          ensureAffiliateTag(user.id).catch((error) =>
            console.error("[affiliate] Failed to assign tag:", error),
          );
        }
        void syncUserToBrevo(user).catch(() => {});

        const setupParams = new URLSearchParams();
        setupParams.set("source", "admin_provisioning");
        setupParams.set("role", String(resolvedUserType || ""));
        setupParams.set("email", normalizedEmail);
        if (createdBusinessId) setupParams.set("businessId", createdBusinessId);
        if (createdBusinessType || resolvedBusinessType) {
          setupParams.set(
            "businessType",
            String(createdBusinessType || resolvedBusinessType),
          );
        }
        const setupQuery = setupParams.toString();
        const inviteResult = await sendAccountSetupInvite({
          user,
          createdBy: req.user,
          req,
          setupPath: `/account-setup?${setupQuery}`,
        });

        res.json({
          success: true,
          userId: user.id,
          businessId: createdBusinessId,
          businessType: createdBusinessType || resolvedBusinessType || null,
          ownerAccessCreated: Boolean(createdBusinessId),
          setupEmailSent: inviteResult.emailSent,
          setupLink: inviteResult.setupUrl,
          message: `${resolvedUserType} account created successfully. Setup link emailed to ${email}.`,
        });
      } catch (error: any) {
        console.error("Error creating user manually:", error);
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "Email or phone already in use",
          });
        }
        res.status(500).json({
          message: error.message || "Failed to create user",
        });
      }
    },
  );

  // Admin API endpoints
  app.get("/api/auth/admin/verify", isAuthenticated, async (req: any, res) => {
    try {
      let user = req.user;

      // Auto-upgrade configured super admin email to super_admin role
      const SUPER_ADMIN_EMAIL =
        process.env.ADMIN_EMAIL || "info.mealscout@gmail.com";
      if (
        user &&
        user.email === SUPER_ADMIN_EMAIL &&
        user.userType !== "super_admin"
      ) {
        try {
          user = await storage.updateUserType(user.id, "super_admin");
          console.log(`✅ Auto-upgraded ${user.email} to super_admin role`);
        } catch (err) {
          console.warn("⚠️  Failed to auto-upgrade super admin role:", err);
        }
      }

      // Also verify email for admin-family users.
      if (user && !user.emailVerified && isAdminUserType(user.userType)) {
        try {
          user = await storage.updateUser(user.id, { emailVerified: true });
        } catch (err) {
          console.warn("⚠️  Failed to verify admin email:", err);
        }
      }

      if (isInternalTeamUserType(user.userType)) {
        res.json(sanitizeUser(user, { includeStripe: true }));
      } else {
        console.warn(
          `🚫 Admin access denied for user ${user.id} with role ${user.userType}`,
        );
        res.status(403).json({ message: "Admin access required" });
      }
    } catch (error) {
      console.error("Error verifying admin:", error);
      res.status(500).json({ message: "Failed to verify admin" });
    }
  });

  app.get(
    "/api/admin/lisa/claims",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 50);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(200, Math.trunc(rawLimit)))
          : 50;

        const appFilter =
          req.query.app === "mealscout" || req.query.app === "tradescout"
            ? req.query.app
            : undefined;

        const claims = await storage.getClaims({
          app: appFilter,
          limit,
        });

        const items = claims.map((claim) => ({
          id: claim.id,
          lane: buildLisaLane(claim),
          app: claim.app,
          source: claim.source,
          claimType: claim.claimType,
          subjectType: claim.subjectType,
          subjectId: claim.subjectId,
          actorType: claim.actorType,
          actorId: claim.actorId,
          claimValue: claim.claimValue,
          confidence: claim.confidence,
          createdAt: claim.createdAt,
        }));

        const laneCounts = items.reduce(
          (acc, item) => {
            acc[item.lane] = (acc[item.lane] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        res.json({
          ok: true,
          total: items.length,
          generatedAt: new Date().toISOString(),
          laneCounts,
          items,
        });
      } catch (error) {
        console.error("Error fetching admin LISA claims:", error);
        res.status(500).json({ message: "Failed to fetch LISA claims" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/signals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 80);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(10, Math.min(200, Math.trunc(rawLimit)))
          : 80;
        const sinceHoursRaw = Number(req.query.hours ?? 72);
        const hours = Number.isFinite(sinceHoursRaw)
          ? Math.max(1, Math.min(24 * 14, Math.trunc(sinceHoursRaw)))
          : 72;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const entityTypeFilter = String(req.query.entityType || "").trim();
        const entityIdFilter = String(req.query.entityId || "").trim();

        const [
          claims,
          telemetry,
          queries,
          stories,
          locations,
          posts,
          requests,
          recentDeals,
          recentEvents,
        ] = await Promise.all([
          storage.getClaims({ limit: Math.min(limit, 80), startDate: since }),
          db
            .select()
            .from(telemetryEvents)
            .where(gte(telemetryEvents.createdAt, since))
            .orderBy(desc(telemetryEvents.createdAt))
            .limit(Math.min(limit, 60)),
          db
            .select()
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since))
            .orderBy(desc(searchQueryEvents.createdAt))
            .limit(Math.min(limit, 60)),
          db
            .select({
              id: videoStories.id,
              title: videoStories.title,
              status: videoStories.status,
              restaurantId: videoStories.restaurantId,
              viewCount: videoStories.viewCount,
              createdAt: videoStories.createdAt,
            })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since))
            .orderBy(desc(videoStories.createdAt))
            .limit(Math.min(limit, 40)),
          db
            .select({
              id: foodTruckLocations.id,
              restaurantId: foodTruckLocations.restaurantId,
              source: foodTruckLocations.source,
              latitude: foodTruckLocations.latitude,
              longitude: foodTruckLocations.longitude,
              recordedAt: foodTruckLocations.recordedAt,
            })
            .from(foodTruckLocations)
            .where(gte(foodTruckLocations.recordedAt, since))
            .orderBy(desc(foodTruckLocations.recordedAt))
            .limit(Math.min(limit, 40)),
          db
            .select()
            .from(socialPostQueue)
            .where(gte(socialPostQueue.createdAt, since))
            .orderBy(desc(socialPostQueue.createdAt))
            .limit(Math.min(limit, 40)),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since))
            .orderBy(desc(requestLogs.createdAt))
            .limit(Math.min(limit, 120)),
          db
            .select({
              id: deals.id,
              title: deals.title,
              restaurantId: deals.restaurantId,
              isActive: deals.isActive,
              createdAt: deals.createdAt,
            })
            .from(deals)
            .where(gte(deals.createdAt, since))
            .orderBy(desc(deals.createdAt))
            .limit(Math.min(limit, 40)),
          db
            .select({
              id: events.id,
              title: events.name,
              hostId: events.hostId,
              status: events.status,
              createdAt: events.createdAt,
            })
            .from(events)
            .where(gte(events.createdAt, since))
            .orderBy(desc(events.createdAt))
            .limit(Math.min(limit, 40)),
        ]);

        const items = [
          ...claims.map((claim) => ({
            id: `claim:${claim.id}`,
            streamType: "lisa_claim",
            lane: buildLisaLane(claim),
            family: "lisa",
            source: claim.source,
            subjectType: claim.subjectType,
            subjectId: claim.subjectId,
            title: claim.claimType,
            summary: `${claim.subjectType} ${claim.subjectId}`,
            payload: claim.claimValue,
            createdAt: claim.createdAt,
            visibility: "on_platform",
          })),
          ...telemetry.map((event: any) => ({
            id: `telemetry:${event.id}`,
            streamType: "telemetry_event",
            lane: buildSignalLane(["telemetry", event.eventName, "event"]),
            family: "telemetry",
            source: "telemetry",
            subjectType: "event",
            subjectId: event.userId || event.id,
            title: event.eventName,
            summary: `Telemetry event${event.userId ? ` by ${event.userId}` : ""}`,
            payload: event.properties ?? {},
            createdAt: event.createdAt,
            visibility: "on_platform",
          })),
          ...queries.map((query: any) => ({
            id: `search:${query.id}`,
            streamType: "search_query",
            lane: buildSignalLane(["search", query.source, "query"]),
            family: "search",
            source: query.source,
            subjectType: "query",
            subjectId: query.id,
            title: query.query,
            summary: `Search demand: ${query.query}`,
            payload: { query: query.query, userId: query.userId },
            createdAt: query.createdAt,
            visibility: "on_platform",
          })),
          ...stories.map((story: any) => ({
            id: `story:${story.id}`,
            streamType: "video_story",
            lane: buildSignalLane(["content", "video_story", story.status]),
            family: "content",
            source: "video_story",
            subjectType: "story",
            subjectId: story.id,
            title: story.title,
            summary: `Story for restaurant ${story.restaurantId || "unknown"}`,
            payload: {
              restaurantId: story.restaurantId,
              status: story.status,
              viewCount: story.viewCount,
            },
            createdAt: story.createdAt,
            visibility: "on_platform",
          })),
          ...locations.map((location: any) => ({
            id: `location:${location.id}`,
            streamType: "truck_location",
            lane: buildSignalLane([
              "mobility",
              "truck",
              location.source || "gps",
            ]),
            family: "mobility",
            source: location.source || "gps",
            subjectType: "restaurant",
            subjectId: location.restaurantId,
            title: "Truck location ping",
            summary: `Restaurant ${location.restaurantId} updated location`,
            payload: {
              latitude: location.latitude,
              longitude: location.longitude,
            },
            createdAt: location.recordedAt,
            visibility: "on_platform",
          })),
          ...posts.map((post: any) => ({
            id: `social:${post.id}`,
            streamType: "social_post",
            lane: buildSignalLane(["distribution", post.platform, post.status]),
            family: "distribution",
            source: post.platform,
            subjectType: "social_post",
            subjectId: post.id,
            title: `${post.platform} ${post.status}`,
            summary: post.link || post.target || "Outbound social post",
            payload: {
              target: post.target,
              status: post.status,
              link: post.link,
              errorMessage: post.errorMessage,
            },
            createdAt: post.createdAt,
            visibility: "off_platform",
          })),
          ...requests
            .map((request: any) => {
              const botLabel = botSignatureLabel(request.userAgent);
              if (!botLabel) return null;
              if (isMonitoringAgent(request.userAgent)) return null;
              if (isOperationalNoisePath(request.path)) return null;
              if (!isHighValueObservedPath(request.path)) return null;
              return {
                id: `request:${request.id}`,
                streamType: "external_crawler",
                lane: buildSignalLane(["external", "crawler", botLabel]),
                family: "external",
                source: botLabel,
                subjectType: "path",
                subjectId: request.path,
                title: `${botLabel} requested ${request.path}`,
                summary: `${request.method} ${request.path} (${request.statusCode})`,
                payload: {
                  userAgent: request.userAgent,
                  ip: request.ip,
                  durationMs: request.durationMs,
                  statusCode: request.statusCode,
                },
                createdAt: request.createdAt,
                visibility: "off_platform",
              };
            })
            .filter(Boolean),
          ...recentDeals.map((deal: any) => ({
            id: `deal:${deal.id}`,
            streamType: "deal_created",
            lane: buildSignalLane([
              "commerce",
              "deal",
              deal.isActive ? "active" : "inactive",
            ]),
            family: "commerce",
            source: "deal",
            subjectType: "deal",
            subjectId: deal.id,
            title: deal.title,
            summary: `Deal created for restaurant ${deal.restaurantId}`,
            payload: {
              restaurantId: deal.restaurantId,
              isActive: deal.isActive,
            },
            createdAt: deal.createdAt,
            visibility: "on_platform",
          })),
          ...recentEvents.map((event: any) => ({
            id: `event:${event.id}`,
            streamType: "event_created",
            lane: buildSignalLane([
              "events",
              "host_event",
              event.status || "unknown",
            ]),
            family: "events",
            source: "event",
            subjectType: "event",
            subjectId: event.id,
            title: event.title,
            summary: `Host ${event.hostId || "unknown"} event`,
            payload: {
              hostId: event.hostId,
              status: event.status,
            },
            createdAt: event.createdAt,
            visibility: "on_platform",
          })),
        ]
          .filter((item) => item && item.createdAt)
          .filter((item) => {
            if (!entityTypeFilter && !entityIdFilter) return true;
            const matchesType = entityTypeFilter
              ? item.subjectType === entityTypeFilter
              : true;
            const matchesId = entityIdFilter
              ? item.subjectId === entityIdFilter ||
                String(item.payload?.restaurantId || "") === entityIdFilter ||
                String(item.payload?.hostId || "") === entityIdFilter
              : true;
            return matchesType && matchesId;
          })
          .sort(
            (a, b) =>
              new Date(String(b.createdAt)).getTime() -
              new Date(String(a.createdAt)).getTime(),
          )
          .slice(0, limit);

        const familyCounts = items.reduce(
          (acc, item) => {
            acc[item.family] = (acc[item.family] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        res.json({
          ok: true,
          total: items.length,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          filters: {
            entityType: entityTypeFilter || null,
            entityId: entityIdFilter || null,
          },
          familyCounts,
          items,
        });
      } catch (error) {
        console.error("Error fetching unified LISA signals:", error);
        res.status(500).json({ message: "Failed to fetch unified signals" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/entities",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 12);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(50, Math.trunc(rawLimit)))
          : 12;
        const entities = await buildCanonicalEntities(limit);

        const counts = entities.reduce(
          (acc, entity) => {
            acc[entity.entityType] = (acc[entity.entityType] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          counts,
          items: entities,
        });
      } catch (error) {
        console.error("Error fetching LISA entities:", error);
        res.status(500).json({ message: "Failed to fetch LISA entities" });
      }
    },
  );

  app.get(
    "/api/admin/business-profiles/completion",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 200);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(500, Math.trunc(rawLimit)))
          : 200;

        const rows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            city: restaurants.city,
            state: restaurants.state,
            ownerId: restaurants.ownerId,
            ownerEmail: users.email,
            claimedFromImportId: restaurants.claimedFromImportId,
            isVerified: restaurants.isVerified,
            hasGoldenPlate: restaurants.hasGoldenPlate,
            description: restaurants.description,
            cuisineType: restaurants.cuisineType,
            address: restaurants.address,
            phone: restaurants.phone,
            websiteUrl: restaurants.websiteUrl,
            instagramUrl: restaurants.instagramUrl,
            facebookPageUrl: restaurants.facebookPageUrl,
            xUrl: restaurants.xUrl,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            operatingHours: restaurants.operatingHours,
            socialAutopostSettings: restaurants.socialAutopostSettings,
            updatedAt: restaurants.updatedAt,
            createdAt: restaurants.createdAt,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .orderBy(desc(restaurants.updatedAt))
          .limit(limit);

        const restaurantIds = rows.map((row: any) => row.id).filter(Boolean);
        const completionEvidencePromise = loadProfileCompletionEvidenceBatch(
          restaurantIds.map((id: unknown) => String(id)),
        );
        const [menuRows, menuItemRows, dealRows, eventRows, mediaRows, analyticsRows] =
          restaurantIds.length
            ? await Promise.all([
                db
                  .select({
                    restaurantId: menus.restaurantId,
                    isActive: menus.isActive,
                  })
                  .from(menus)
                  .where(inArray(menus.restaurantId, restaurantIds)),
                db
                    .select({
                      restaurantId: menuItems.restaurantId,
                    })
                    .from(menuItems)
                    .where(inArray(menuItems.restaurantId, restaurantIds)),
                db
                  .select({
                    restaurantId: deals.restaurantId,
                    isActive: deals.isActive,
                    endDate: deals.endDate,
                  })
                  .from(deals)
                  .where(inArray(deals.restaurantId, restaurantIds)),
                db
                  .select({
                    hostId: events.hostId,
                    status: events.status,
                    date: events.date,
                  })
                  .from(events)
                  .where(inArray(events.hostId, restaurantIds)),
                db
                  .select({
                    entityId: imageUploads.entityId,
                  })
                  .from(imageUploads)
                  .where(
                    and(
                      eq(imageUploads.entityType, "restaurant"),
                      inArray(imageUploads.entityId, restaurantIds),
                    ),
                  ),
                db
                  .select({
                    path: requestLogs.path,
                    createdAt: requestLogs.createdAt,
                  })
                  .from(requestLogs)
                  .where(gte(requestLogs.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
                  .orderBy(desc(requestLogs.createdAt))
                  .limit(6000),
              ])
            : [[], [], [], [], [], []];
        const completionEvidenceByRestaurant = await completionEvidencePromise;

        const menuByRestaurant = new Map<string, number>();
        menuRows.forEach((row: any) => {
          if (!row?.restaurantId) return;
          if (row.isActive === false) return;
          menuByRestaurant.set(
            String(row.restaurantId),
            (menuByRestaurant.get(String(row.restaurantId)) || 0) + 1,
          );
        });

        const menuItemsByRestaurant = new Map<string, number>();
        menuItemRows.forEach((row: any) => {
          if (!row?.restaurantId) return;
          menuItemsByRestaurant.set(
            String(row.restaurantId),
            (menuItemsByRestaurant.get(String(row.restaurantId)) || 0) + 1,
          );
        });

        const now = new Date();
        const activeDealsByRestaurant = new Map<string, number>();
        dealRows.forEach((row: any) => {
          if (!row?.restaurantId) return;
          if (!row?.isActive) return;
          const endDate = row?.endDate ? new Date(String(row.endDate)) : null;
          if (endDate && endDate.getTime() < now.getTime()) return;
          activeDealsByRestaurant.set(
            String(row.restaurantId),
            (activeDealsByRestaurant.get(String(row.restaurantId)) || 0) + 1,
          );
        });

        const activeEventsByRestaurant = new Map<string, number>();
        eventRows.forEach((row: any) => {
          if (!row?.hostId) return;
          const status = String(row?.status || "").toLowerCase();
          if (status && ["cancelled", "archived", "completed"].includes(status)) return;
          const date = row?.date ? new Date(String(row.date)) : null;
          if (date && date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) return;
          activeEventsByRestaurant.set(
            String(row.hostId),
            (activeEventsByRestaurant.get(String(row.hostId)) || 0) + 1,
          );
        });

        const photosByRestaurant = new Map<string, number>();
        mediaRows.forEach((row: any) => {
          if (!row?.entityId) return;
          photosByRestaurant.set(
            String(row.entityId),
            (photosByRestaurant.get(String(row.entityId)) || 0) + 1,
          );
        });

        const analyticsByRestaurant = new Map<string, number>();
        analyticsRows.forEach((row: any) => {
          const path = String(row?.path || "");
          const match =
            path.match(/^\/p\/(restaurant|truck|bar)\/([^/?#]+)/i) ||
            path.match(/^\/restaurant\/([^/?#]+)/i);
          const entityId = match?.[2] || match?.[1];
          if (!entityId) return;
          analyticsByRestaurant.set(
            String(entityId),
            (analyticsByRestaurant.get(String(entityId)) || 0) + 1,
          );
        });

        const collisionKeywordSet = new Set([
          "florida",
          "kitchen",
          "island",
          "cuisine",
          "jamaican",
          "caribbean",
        ]);
        const commonStopWords = new Set([
          "the",
          "and",
          "llc",
          "inc",
          "co",
          "company",
          "restaurant",
          "grill",
          "cafe",
          "food",
          "truck",
        ]);
        const toIdentityTokens = (name: string) =>
          String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !commonStopWords.has(token));

        const rowsWithIdentity = rows.map((row: any) => {
          const tokens = toIdentityTokens(String(row?.name || ""));
          const riskyTokens = tokens.filter((token) => collisionKeywordSet.has(token));
          return {
            ...row,
            __identityTokens: tokens,
            __riskyTokens: riskyTokens,
          };
        });

        const items = rowsWithIdentity.map((row: any) => {
          const isTruck =
            Boolean(row?.isFoodTruck) ||
            String(row?.businessType || "").toLowerCase() === "food_truck";
          const profileType = isTruck
            ? "truck"
            : String(row?.businessType || "").toLowerCase() === "bar"
              ? "bar"
              : "restaurant";
          const canonicalPath = `/p/${profileType}/${row.id}`;
          const actionLinks =
            row?.socialAutopostSettings &&
            typeof row.socialAutopostSettings === "object" &&
            typeof row.socialAutopostSettings.publicActionLinks === "object"
              ? row.socialAutopostSettings.publicActionLinks
              : {};
          const completionReview =
            row?.socialAutopostSettings &&
            typeof row.socialAutopostSettings === "object" &&
            typeof row.socialAutopostSettings.completionReview === "object"
              ? row.socialAutopostSettings.completionReview
              : {};
          const menuItemCount = menuItemsByRestaurant.get(String(row.id)) || 0;
          const menuCount = menuByRestaurant.get(String(row.id)) || 0;
          const activeDeals = activeDealsByRestaurant.get(String(row.id)) || 0;
          const activeEvents = activeEventsByRestaurant.get(String(row.id)) || 0;
          const photoCount = photosByRestaurant.get(String(row.id)) || 0;
          const analyticsCount = analyticsByRestaurant.get(String(row.id)) || 0;
          const completionEvidence = completionEvidenceByRestaurant.get(
            String(row.id),
          );
          const completionTruth = completionEvidence?.truth;

          const basicsReady = Boolean(
            row?.name &&
              row?.description &&
              row?.cuisineType &&
              (row?.address || (row?.city && row?.state)),
          );
          const hasContact = Boolean(
            row?.phone || row?.websiteUrl || row?.instagramUrl || row?.facebookPageUrl || row?.xUrl,
          );
          const hasActionLinks = Boolean(
            actionLinks?.onlineOrderingUrl ||
              actionLinks?.deliveryUrl ||
              actionLinks?.cateringInquiryUrl ||
              actionLinks?.truckBookingInquiryUrl,
          );
          const contactReady = hasContact || hasActionLinks;
          const featuredMenuItems = Array.isArray((row as any)?.featuredMenuItems)
            ? (row as any).featuredMenuItems.filter((item: unknown) =>
                Boolean(String(item || "").trim()),
              )
            : [];
          const hasMenuFallback =
            Boolean((row as any)?.menuUrl) ||
            Boolean((row as any)?.menuImageUrl) ||
            Boolean((row as any)?.menuPdfUrl) ||
            featuredMenuItems.length > 0;
          const menuReviewedUnavailable = Boolean(completionReview?.menuReviewedUnavailable);
          const photosReviewedUnavailable = Boolean(
            completionReview?.photosReviewedUnavailable,
          );
          const scheduleReviewedUnavailable = Boolean(
            completionReview?.scheduleReviewedUnavailable,
          );
          const dealsReviewedNone = Boolean(completionReview?.dealsReviewedNone);
          const eventsReviewedNone = Boolean(completionReview?.eventsReviewedNone);
          const identityReviewed = Boolean(completionReview?.identityReviewed);
          const forceIdentityReview = Boolean(completionReview?.identityReviewNeeded);
          const hideAsTestQa = Boolean(completionReview?.hideAsTestQa);
          const blockerReason = String(completionReview?.blockerReason || "").trim() || null;

          const menuReady = completionTruth?.menuState === "approved_current";
          const photoReady = completionTruth?.mediaState === "ready";
          const scheduleReady = completionTruth?.availabilityReady === true;
          const dealsReady = activeDeals > 0 || dealsReviewedNone;
          const eventsReady = activeEvents > 0 || eventsReviewedNone;
          const qrReady = Boolean(canonicalPath);

          const requiredSections = [
            basicsReady,
            contactReady,
            menuReady,
            photoReady,
            scheduleReady,
            qrReady,
          ];
          const optionalSections = [dealsReady, eventsReady];
          const completedRequired = requiredSections.filter(Boolean).length;
          const requiredScore = completedRequired / requiredSections.length;
          const optionalScore = optionalSections.filter(Boolean).length / optionalSections.length;
          const completenessScore = Math.round(requiredScore * 85 + optionalScore * 15);

          const missingFields: string[] = [];
          if (!basicsReady) missingFields.push("basics");
          if (!contactReady) missingFields.push("contact/actions");
          if (!menuReady) missingFields.push("menu");
          if (!photoReady) missingFields.push("photos");
          if (!scheduleReady) {
            missingFields.push(
              isTruck ? "dated truck schedule" : "weekly business hours",
            );
          }
          if (!dealsReady) missingFields.push("deals (optional)");
          if (!eventsReady) missingFields.push("events (optional)");

          const ownerEmail = String(row?.ownerEmail || "").toLowerCase();
          const claimed =
            Boolean(row?.ownerId) && ownerEmail !== IMPORT_SYSTEM_EMAIL.toLowerCase();

          const similarRows = rowsWithIdentity.filter((candidate: any) => {
            if (!candidate?.id || String(candidate.id) === String(row.id)) return false;
            const overlapCount = (row.__identityTokens || []).filter((token: string) =>
              (candidate.__identityTokens || []).includes(token),
            ).length;
            if (row.__riskyTokens?.length > 0 || candidate.__riskyTokens?.length > 0) {
              return overlapCount >= 2;
            }
            return false;
          });
          const identityNeedsReview = similarRows.some((candidate: any) => {
            const cityStateA = `${String(row?.city || "").trim().toLowerCase()}|${String(
              row?.state || "",
            )
              .trim()
              .toLowerCase()}`;
            const cityStateB = `${String(candidate?.city || "")
              .trim()
              .toLowerCase()}|${String(candidate?.state || "")
              .trim()
              .toLowerCase()}`;
            const phoneA = String(row?.phone || "").replace(/\D/g, "");
            const phoneB = String(candidate?.phone || "").replace(/\D/g, "");
            const websiteA = String(row?.websiteUrl || "").trim().toLowerCase();
            const websiteB = String(candidate?.websiteUrl || "").trim().toLowerCase();
            const importA = String(row?.claimedFromImportId || "")
              .trim()
              .toLowerCase();
            const importB = String(candidate?.claimedFromImportId || "")
              .trim()
              .toLowerCase();
            return (
              cityStateA !== cityStateB ||
              (phoneA && phoneB && phoneA !== phoneB) ||
              (websiteA && websiteB && websiteA !== websiteB) ||
              (importA && importB && importA !== importB)
            );
          });
          const identityNeedsReviewFinal = forceIdentityReview || identityNeedsReview;
          const identityReason = identityNeedsReviewFinal
            ? "Possible duplicate/similar business. Confirm identity before editing."
            : null;

          const normalizedName = String(row?.name || "").toLowerCase();
          const importSourceHint = String(row?.claimedFromImportId || "").toLowerCase();
          const qaHint = [normalizedName, importSourceHint].join(" ");
          const testOrQaDetected =
            hideAsTestQa ||
            /\b(test|qa|seed|demo|fake|internal|sample|sandbox|staging)\b/.test(qaHint);

          const publicReady = completionTruth?.publicProfileReady === true;
          const hasPublicProfile = Boolean(
            completionTruth?.publicRouteState === "published" && canonicalPath,
          );
          const handoffReady = Boolean(
            publicReady &&
              basicsReady &&
              contactReady &&
              menuReady &&
              photoReady &&
              scheduleReady &&
              qrReady &&
              !identityNeedsReviewFinal &&
              !testOrQaDetected,
          );
          const adminFixableItems: string[] = [];
          if (!contactReady) adminFixableItems.push("contact/actions");
          if (!menuReady) adminFixableItems.push("menu");
          if (!photoReady) adminFixableItems.push("photos");
          if (!dealsReady) adminFixableItems.push("deals");
          if (!eventsReady) adminFixableItems.push("events");
          const ownerInputBlockers: string[] = [];
          if (!basicsReady) ownerInputBlockers.push("basics");
          if (!scheduleReady) {
            ownerInputBlockers.push(
              isTruck ? "dated truck schedule" : "weekly business hours",
            );
          }
          if (!menuReady && !hasMenuFallback && menuItemCount === 0) ownerInputBlockers.push("menu source");
          if (!photoReady && !row?.logoUrl && !row?.coverImageUrl && photoCount === 0)
            ownerInputBlockers.push("photo proof");
          const adminFixable =
            !testOrQaDetected &&
            !identityNeedsReviewFinal &&
            ownerInputBlockers.length === 0 &&
            adminFixableItems.length > 0;
          const blockedOwnerInput =
            !testOrQaDetected &&
            !identityNeedsReviewFinal &&
            !handoffReady &&
            ownerInputBlockers.length > 0;

          const completionScore = completenessScore;
          const confidenceScore = Math.max(
            0,
            Math.min(
              100,
              100 -
                (identityNeedsReviewFinal && !identityReviewed ? 35 : 0) -
                (testOrQaDetected ? 60 : 0) +
                (row?.isVerified ? 10 : 0),
            ),
          );
          const fixabilityScore = Math.max(
            0,
            Math.min(
              100,
              100 -
                ownerInputBlockers.length * 25 -
                (identityNeedsReviewFinal && !identityReviewed ? 20 : 0) -
                (testOrQaDetected ? 80 : 0),
            ),
          );
          const actionabilityScore = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                completionScore * 0.35 +
                  confidenceScore * 0.35 +
                  fixabilityScore * 0.3 +
                  Math.min(10, analyticsCount > 0 ? 10 : 0),
              ),
            ),
          );
          const rankReason: string[] = [];
          if (menuReady && photoReady && contactReady) {
            rankReason.push("Has menu, photo, and contact path");
          }
          if (publicReady && !handoffReady) {
            rankReason.push("Only optional sections missing");
          }
          if (!menuReady) {
            rankReason.push("Needs menu source from business");
          }
          if (testOrQaDetected) {
            rankReason.push("Likely test record");
          }
          if (identityNeedsReviewFinal && !identityReviewed) {
            rankReason.push("Possible duplicate/name conflict");
          }
          if (!scheduleReady) {
            rankReason.push(
              isTruck
                ? "Truck missing a dated stop"
                : "Business missing valid weekly hours",
            );
          }
          if (!rankReason.length) {
            rankReason.push("Needs focused completion cleanup");
          }

          const primaryStatus = testOrQaDetected
            ? "test_or_qa"
            : identityNeedsReviewFinal && !identityReviewed
              ? "identity_review_needed"
              : handoffReady
                ? "handoff_ready"
                : publicReady
                  ? "public_ready"
                  : adminFixable
                    ? "admin_fixable"
                    : "blocked_owner_input";

          return {
            id: row.id,
            businessName: row.name,
            profileType,
            city: row.city || null,
            state: row.state || null,
            claimed,
            verifiedProfile: Boolean(row?.isVerified),
            locallyOwned: Boolean(row?.hasGoldenPlate),
            hasPublicProfile,
            publicProfileUrl: hasPublicProfile ? canonicalPath : null,
            profileCompletenessScore: completenessScore,
            missingFields,
            menuStatus: {
              ready: menuReady,
              state: completionTruth?.menuState || "missing",
              menuCount,
              menuItemCount,
              hasMenuFallback,
              reviewedUnavailable: menuReviewedUnavailable,
            },
            photoStatus: {
              ready: photoReady,
              state: completionTruth?.mediaState || "missing",
              hasLogo: Boolean(row?.logoUrl),
              hasCover: Boolean(row?.coverImageUrl),
              uploadedCount: photoCount,
              reviewedUnavailable: photosReviewedUnavailable,
            },
            contactActionStatus: {
              ready: contactReady,
              hasPhone: Boolean(row?.phone),
              hasWebsite: Boolean(row?.websiteUrl),
              hasSocial:
                Boolean(row?.instagramUrl) ||
                Boolean(row?.facebookPageUrl) ||
                Boolean(row?.xUrl),
              hasActionLinks,
            },
            scheduleStatus: {
              required: true,
              ready: scheduleReady,
              kind: isTruck ? "dated_truck_schedule" : "fixed_weekly_hours",
              state: isTruck
                ? completionTruth?.datedTruckScheduleState || "missing"
                : completionTruth?.fixedWeeklyHoursState || "missing",
              workflowState:
                completionTruth?.datedTruckScheduleWorkflowState ||
                "not_applicable",
              mobileOnline: Boolean(row?.mobileOnline),
              hasOperatingHours:
                completionTruth?.fixedWeeklyHoursState === "ready",
              reviewedUnavailable: scheduleReviewedUnavailable,
            },
            dealsEventsStatus: {
              dealsActive: activeDeals,
              eventsUpcoming: activeEvents,
              dealsReviewedNone,
              eventsReviewedNone,
            },
            qrKitReady: qrReady,
            identityNeedsReview: identityNeedsReviewFinal,
            identityReason,
            similarBusinesses: similarRows.slice(0, 4).map((candidate: any) => ({
              id: String(candidate.id),
              name: String(candidate.name || ""),
              city: candidate.city || null,
              state: candidate.state || null,
              phone: candidate.phone || null,
              websiteUrl: candidate.websiteUrl || null,
            })),
            publicReady,
            completionTruth: completionTruth || null,
            handoffReady,
            adminFixable,
            blockedOwnerInput,
            testOrQa: testOrQaDetected,
            primaryStatus,
            secondaryFlags: [
              publicReady ? "public_ready" : null,
              handoffReady ? "handoff_ready" : null,
              adminFixable ? "admin_fixable" : null,
              blockedOwnerInput ? "blocked_owner_input" : null,
              identityNeedsReviewFinal && !identityReviewed ? "identity_review_needed" : null,
              testOrQaDetected ? "test_or_qa" : null,
            ].filter(Boolean),
            completionScore,
            confidenceScore,
            fixabilityScore,
            actionabilityScore,
            rankReason,
            adminFixableItems,
            ownerInputBlockers,
            blockerReason,
            hasAnalyticsActivity: analyticsCount > 0,
            taskLabels: {
              basics: basicsReady ? "ready" : "fix_now",
              contactActions: contactReady ? "ready" : "fix_now",
              menu: menuReady
                ? "ready"
                : hasMenuFallback || menuItemCount > 0
                  ? "fix_now"
                  : "needs_business_input",
              photos: photoReady ? "ready" : "needs_business_input",
              schedule: scheduleReady ? "ready" : "needs_business_input",
              deals: dealsReady ? "optional_reviewed" : "optional",
              events: eventsReady ? "optional_reviewed" : "optional",
            },
            analyticsActivity: {
              viewsOrClicks30d: analyticsCount,
            },
            lastUpdated: row?.updatedAt || row?.createdAt,
          };
        });

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          total: items.length,
          counts: {
            complete: items.filter((item: any) => item.profileCompletenessScore >= 85).length,
            almostComplete: items.filter(
              (item: any) =>
                item.profileCompletenessScore >= 60 &&
                item.profileCompletenessScore < 85,
            ).length,
            needsWork: items.filter((item: any) => item.profileCompletenessScore < 60).length,
          },
          items,
        });
      } catch (error) {
        console.error("Error fetching business profile completion dashboard:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch business profile completion dashboard" });
      }
    },
  );

  app.patch(
    "/api/admin/business-profiles/:businessId/completion",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const businessId = String(req.params.businessId || "").trim();
        if (!businessId) {
          return res.status(400).json({ message: "Business id is required" });
        }

        const schema = z.object({
          phone: z.string().trim().max(40).optional().nullable(),
          websiteUrl: z.string().trim().max(500).optional().nullable(),
          facebookPageUrl: z.string().trim().max(500).optional().nullable(),
          instagramUrl: z.string().trim().max(500).optional().nullable(),
          menuUrl: z.string().trim().max(500).optional().nullable(),
          menuImageUrl: z.string().trim().max(500).optional().nullable(),
          menuPdfUrl: z.string().trim().max(500).optional().nullable(),
          logoUrl: z.string().trim().max(500).optional().nullable(),
          coverImageUrl: z.string().trim().max(500).optional().nullable(),
          operatingHours: z.record(z.any()).optional().nullable(),
          publicActionLinks: z
            .object({
              onlineOrderingUrl: z.string().trim().max(500).optional().nullable(),
              deliveryUrl: z.string().trim().max(500).optional().nullable(),
              cateringInquiryUrl: z.string().trim().max(500).optional().nullable(),
              truckBookingInquiryUrl: z.string().trim().max(500).optional().nullable(),
            })
            .partial()
            .optional(),
          reviewed: z
            .object({
              menuReviewedUnavailable: z.boolean().optional(),
              photosReviewedUnavailable: z.boolean().optional(),
              scheduleReviewedUnavailable: z.boolean().optional(),
              dealsReviewedNone: z.boolean().optional(),
              eventsReviewedNone: z.boolean().optional(),
              hideAsTestQa: z.boolean().optional(),
              identityReviewNeeded: z.boolean().optional(),
              identityReviewed: z.boolean().optional(),
              blockerReason: z.string().trim().max(160).optional().nullable(),
            })
            .partial()
            .optional(),
          galleryImageUrl: z.string().trim().max(500).optional().nullable(),
          galleryImageApproved: z.boolean().optional(),
        });

        const parsed = schema.parse(req.body || {});
        const restaurant = await storage.getRestaurant(businessId);
        if (!restaurant) {
          return res.status(404).json({ message: "Business not found" });
        }

        const collisionKeywordSet = new Set([
          "florida",
          "kitchen",
          "island",
          "cuisine",
          "jamaican",
          "caribbean",
        ]);
        const commonStopWords = new Set([
          "the",
          "and",
          "llc",
          "inc",
          "co",
          "company",
          "restaurant",
          "grill",
          "cafe",
          "food",
          "truck",
        ]);
        const toIdentityTokens = (name: string) =>
          String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !commonStopWords.has(token));
        const rowTokens = toIdentityTokens(String((restaurant as any)?.name || ""));
        const hasRiskyToken = rowTokens.some((token) => collisionKeywordSet.has(token));
        if (hasRiskyToken) {
          const candidates = await db
            .select({
              id: restaurants.id,
              name: restaurants.name,
              city: restaurants.city,
              state: restaurants.state,
              phone: restaurants.phone,
              websiteUrl: restaurants.websiteUrl,
            })
            .from(restaurants)
            .where(ne(restaurants.id, businessId))
            .limit(500);
          const ambiguous = candidates.some((candidate: any) => {
            const candidateTokens = toIdentityTokens(String(candidate?.name || ""));
            const overlapCount = rowTokens.filter((token) =>
              candidateTokens.includes(token),
            ).length;
            if (overlapCount < 2) return false;
            const cityStateA = `${String((restaurant as any)?.city || "")
              .trim()
              .toLowerCase()}|${String((restaurant as any)?.state || "")
              .trim()
              .toLowerCase()}`;
            const cityStateB = `${String(candidate?.city || "")
              .trim()
              .toLowerCase()}|${String(candidate?.state || "")
              .trim()
              .toLowerCase()}`;
            const phoneA = String((restaurant as any)?.phone || "").replace(/\D/g, "");
            const phoneB = String(candidate?.phone || "").replace(/\D/g, "");
            const websiteA = String((restaurant as any)?.websiteUrl || "")
              .trim()
              .toLowerCase();
            const websiteB = String(candidate?.websiteUrl || "")
              .trim()
              .toLowerCase();
            return (
              cityStateA !== cityStateB ||
              (phoneA && phoneB && phoneA !== phoneB) ||
              (websiteA && websiteB && websiteA !== websiteB)
            );
          });
          if (ambiguous) {
            return res.status(409).json({
              message:
                "Identity review required for this business. Confirm duplicate/similar records before editing.",
              code: "IDENTITY_REVIEW_REQUIRED",
            });
          }
        }

        const updates: Record<string, unknown> = {};
        const directFields = [
          "phone",
          "websiteUrl",
          "facebookPageUrl",
          "instagramUrl",
          "menuUrl",
          "menuImageUrl",
          "menuPdfUrl",
          "logoUrl",
          "coverImageUrl",
        ] as const;
        for (const field of directFields) {
          if ((parsed as any)[field] !== undefined) {
            updates[field] = normalizeAdminCompletionValue((parsed as any)[field]);
          }
        }
        if (parsed.operatingHours !== undefined) {
          updates.operatingHours = parsed.operatingHours ?? null;
        }

        const verifiedAt = new Date().toISOString();
        const updatedRestaurant = await withLockedAdminBusinessCompletion(
          businessId,
          async (tx, lockedRestaurant) => {
            const socialAutopostSettings = mergeAdminBusinessCompletionSettings({
              settingsValue: lockedRestaurant.socialAutopostSettings,
              publicActionLinks: parsed.publicActionLinks,
              reviewed: parsed.reviewed,
              galleryImageUrl: parsed.galleryImageUrl,
              galleryImageApproved: parsed.galleryImageApproved,
              verifiedAt,
            });
            const [updated] = await tx
              .update(restaurants)
              .set({
                ...updates,
                socialAutopostSettings,
                updatedAt: new Date(),
              } as any)
              .where(eq(restaurants.id, businessId))
              .returning();
            return updated;
          },
        );
        if (!updatedRestaurant) {
          return res.status(404).json({ message: "Business not found" });
        }
        return res.json({ ok: true, restaurant: updatedRestaurant });
      } catch (error) {
        console.error(
          "Admin business completion update failed",
          safeAdminCompletionErrorContext(error),
        );
        return res.status(error instanceof z.ZodError ? 400 : 500).json({
          message:
            error instanceof z.ZodError
              ? "Invalid business completion fields"
              : "Failed to update business completion fields",
        });
      }
    },
  );

  app.get(
    "/api/admin/lisa/priorities",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 12);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(50, Math.trunc(rawLimit)))
          : 12;
        const hours = 72;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const [entities, recentRequests] = await Promise.all([
          buildCanonicalEntities(Math.max(limit, 24)),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
        ]);

        const items = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const botLabel = botSignatureLabel(request.userAgent);
              if (!botLabel) return false;
              const path = String(request.path || "");
              return path.includes(entity.entityId);
            });

            const crawlerDemand = crawlerHits.length;
            const gapScore = entity.knowledgeGaps.length * 3;
            const opportunityScore = entity.opportunities.length;
            const freshnessPenalty =
              entity.freshness === "stale"
                ? 4
                : entity.freshness === "aging"
                  ? 2
                  : 0;
            const qualityPenalty =
              entity.quality === "thin"
                ? 4
                : entity.quality === "growing"
                  ? 2
                  : 0;
            const readinessPenalty =
              entity.machineReadiness === "blocked"
                ? 4
                : entity.machineReadiness === "developing"
                  ? 2
                  : 0;
            const demandScore = Math.min(10, crawlerDemand * 2);
            const priorityScore =
              gapScore +
              opportunityScore +
              freshnessPenalty +
              qualityPenalty +
              readinessPenalty +
              demandScore;

            return {
              ...entity,
              priorityScore,
              crawlerDemand,
              reasons: [
                crawlerDemand > 0 ? `external_demand:${crawlerDemand}` : null,
                ...entity.knowledgeGaps.slice(0, 3),
                ...entity.opportunities.slice(0, 2),
              ].filter(Boolean),
            };
          })
          .sort((a, b) => b.priorityScore - a.priorityScore)
          .slice(0, limit);

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
        });
      } catch (error) {
        console.error("Error fetching LISA priorities:", error);
        res.status(500).json({ message: "Failed to fetch LISA priorities" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/authority-gap",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query.limit ?? 12);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(50, Math.trunc(rawLimit)))
          : 12;
        const hours = 72;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const [entities, recentRequests] = await Promise.all([
          buildCanonicalEntities(Math.max(limit, 30)),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
        ]);

        const items = entities
          .map((entity) => {
            const matchingRequests = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              return (
                path === entity.canonicalPath ||
                path.startsWith(`${entity.canonicalPath}?`) ||
                path.includes(entity.entityId)
              );
            });

            const crawlerHits = matchingRequests.filter((request: any) =>
              Boolean(botSignatureLabel(request.userAgent)),
            ).length;
            const humanHits = matchingRequests.filter(
              (request: any) => !botSignatureLabel(request.userAgent),
            ).length;
            const readinessPenalty =
              entity.machineReadiness === "blocked"
                ? 6
                : entity.machineReadiness === "developing"
                  ? 3
                  : 0;
            const gapPenalty = entity.knowledgeGaps.length * 2;
            const freshnessPenalty =
              entity.freshness === "stale"
                ? 3
                : entity.freshness === "aging"
                  ? 1
                  : 0;
            const authorityDelta =
              crawlerHits * 2 +
              gapPenalty +
              readinessPenalty +
              freshnessPenalty;

            return {
              ...entity,
              crawlerHits,
              humanHits,
              authorityDelta,
              pressure:
                crawlerHits >= 5 ? "high" : crawlerHits >= 2 ? "medium" : "low",
            };
          })
          .filter(
            (entity) =>
              entity.crawlerHits > 0 || entity.machineReadiness !== "ready",
          )
          .sort((a, b) => b.authorityDelta - a.authorityDelta)
          .slice(0, limit);

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
        });
      } catch (error) {
        console.error("Error fetching LISA authority gap:", error);
        res.status(500).json({ message: "Failed to fetch authority gap" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/market-intel",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const now = new Date();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const since48h = new Date(Date.now() - 48 * 24 * 60 * 60 * 1000);

        const [
          topQueriesRows,
          cityDemandRows,
          cuisineRows,
          videoRows,
          geoAdTotals,
          geoPingTotals,
          entities,
          recentRequests,
          recentQueryRows,
          previousQueryRows,
          recentStoryCountRows,
          previousStoryCountRows,
          recentLocationCountRows,
          previousLocationCountRows,
          recentDealCreateCountRows,
          previousDealCreateCountRows,
          activeDealRows,
          supplyMarketLaneFeed,
        ] = await Promise.all([
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since30d))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              businessName: locationRequests.businessName,
              address: locationRequests.address,
              locationType: locationRequests.locationType,
              requestCount: sql<number>`count(*)`.mapWith(Number),
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(
                Number,
              ),
            })
            .from(locationRequests)
            .leftJoin(
              truckInterests,
              eq(truckInterests.locationRequestId, locationRequests.id),
            )
            .where(gte(locationRequests.createdAt, since30d))
            .groupBy(
              locationRequests.businessName,
              locationRequests.address,
              locationRequests.locationType,
            )
            .orderBy(
              desc(sql`count(*)`),
              desc(sql`count(${truckInterests.id})`),
            )
            .limit(10),
          db
            .select({
              cuisineType: restaurants.cuisineType,
              restaurantCount: sql<number>`count(*)`.mapWith(Number),
              avgRankingScore:
                sql<number>`avg(${restaurants.rankingScore})`.mapWith(Number),
            })
            .from(restaurants)
            .where(gte(restaurants.createdAt, new Date("2020-01-01")))
            .groupBy(restaurants.cuisineType)
            .orderBy(desc(sql`count(*)`))
            .limit(10)
            .catch(async () =>
              db
                .select({
                  cuisineType: restaurants.cuisineType,
                  restaurantCount: sql<number>`count(*)`.mapWith(Number),
                  avgRankingScore:
                    sql<number>`avg(${restaurants.rankingScore})`.mapWith(
                      Number,
                    ),
                })
                .from(restaurants)
                .groupBy(restaurants.cuisineType)
                .orderBy(desc(sql`count(*)`))
                .limit(10),
            ),
          db
            .select({
              id: videoStories.id,
              title: videoStories.title,
              restaurantId: videoStories.restaurantId,
              viewCount: videoStories.viewCount,
              impressionCount: videoStories.impressionCount,
              createdAt: videoStories.createdAt,
            })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since30d))
            .orderBy(
              desc(videoStories.impressionCount),
              desc(videoStories.viewCount),
            )
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(
                  Number,
                ),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(
                  Number,
                ),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(
                  Number,
                ),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since30d))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since24h))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(25),
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(
              and(
                gte(searchQueryEvents.createdAt, since48h),
                lt(searchQueryEvents.createdAt, since24h),
              ),
            )
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(25),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(videoStories)
            .where(
              and(
                gte(videoStories.createdAt, since48h),
                lt(videoStories.createdAt, since24h),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(locationRequests)
            .where(gte(locationRequests.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(locationRequests)
            .where(
              and(
                gte(locationRequests.createdAt, since48h),
                lt(locationRequests.createdAt, since24h),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(deals)
            .where(gte(deals.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(deals)
            .where(
              and(
                gte(deals.createdAt, since48h),
                lt(deals.createdAt, since24h),
              ),
            ),
          db
            .select({
              dealId: deals.id,
              restaurantId: restaurants.id,
              restaurantName: restaurants.name,
              cuisineType: restaurants.cuisineType,
              city: restaurants.city,
              state: restaurants.state,
              title: deals.title,
              dealType: deals.dealType,
              discountValue: deals.discountValue,
              minOrderAmount: deals.minOrderAmount,
              endDate: deals.endDate,
              isOngoing: deals.isOngoing,
              createdAt: deals.createdAt,
            })
            .from(deals)
            .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
            .where(
              and(
                eq(deals.isActive, true),
                or(
                  eq(deals.isOngoing, true),
                  isNull(deals.endDate),
                  gte(deals.endDate, now),
                ),
              ),
            )
            .orderBy(desc(deals.createdAt))
            .limit(80),
          getSupplyMarketDataLanes({ sinceHours: 48, limit: 300 }),
        ]);

        const typedRecentQueryRows = recentQueryRows as Array<{
          query: string | null;
          count: number;
        }>;
        const typedPreviousQueryRows = previousQueryRows as Array<{
          query: string | null;
          count: number;
        }>;
        const typedActiveDealRows = activeDealRows as Array<{
          dealId: string;
          restaurantId: string;
          restaurantName: string;
          cuisineType: string | null;
          city: string | null;
          state: string | null;
          title: string;
          dealType: string;
          discountValue: string | number;
          minOrderAmount: string | number | null;
          endDate: Date | null;
          isOngoing: boolean | null;
          createdAt: Date | null;
        }>;

        const recentQueryMap = new Map(
          typedRecentQueryRows.map((row) => [
            String(row.query || "").toLowerCase(),
            Number(row.count || 0),
          ]),
        );
        const previousQueryMap = new Map(
          typedPreviousQueryRows.map((row) => [
            String(row.query || "").toLowerCase(),
            Number(row.count || 0),
          ]),
        );

        const trendWatch = Array.from(
          new Set([
            ...typedRecentQueryRows.map((row) =>
              String(row.query || "").toLowerCase(),
            ),
            ...typedPreviousQueryRows.map((row) =>
              String(row.query || "").toLowerCase(),
            ),
          ]),
        )
          .map((key: string) => {
            const recentMatch =
              typedRecentQueryRows.find(
                (row) => String(row.query || "").toLowerCase() === key,
              ) ?? null;
            const currentCount = Number(recentQueryMap.get(key) ?? 0);
            const previousCount = Number(previousQueryMap.get(key) ?? 0);
            const delta = currentCount - previousCount;
            return {
              id: `trend:${key}`,
              label: recentMatch?.query || key || "food trend",
              currentCount,
              previousCount,
              delta,
              direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
              momentum:
                delta >= 3
                  ? "surging"
                  : delta > 0
                    ? "rising"
                    : currentCount > 0 && previousCount === 0
                      ? "new"
                      : "steady",
              summary:
                delta > 0
                  ? `"${recentMatch?.query || key}" is climbing with ${currentCount} recent searches, up ${delta} from the previous day.`
                  : delta < 0
                    ? `"${recentMatch?.query || key}" cooled slightly to ${currentCount} recent searches, down ${Math.abs(delta)} from the previous day.`
                    : `"${recentMatch?.query || key}" is holding steady at ${currentCount} recent searches.`,
              next:
                delta > 0
                  ? `Build or refresh pages, deals, and content around "${recentMatch?.query || key}" while interest is rising.`
                  : `Keep coverage for "${recentMatch?.query || key}" fresh so MealScout can hold the topic if demand rebounds.`,
            };
          })
          .filter((item) => item.currentCount > 0)
          .sort((a, b) => {
            if (b.delta !== a.delta) return b.delta - a.delta;
            return b.currentCount - a.currentCount;
          })
          .slice(0, 8);

        const bestValueDeals = typedActiveDealRows
          .map((item) => {
            const discountValue = Number(item.discountValue || 0);
            const minOrderAmount = Number(item.minOrderAmount || 0);
            const valueScore =
              String(item.dealType || "").toLowerCase() === "fixed"
                ? (discountValue / Math.max(minOrderAmount || 25, 25)) * 100
                : discountValue;
            return {
              id: item.dealId,
              restaurantId: item.restaurantId,
              restaurantName: item.restaurantName,
              cuisineType: item.cuisineType,
              city: item.city,
              state: item.state,
              title: item.title,
              dealType: item.dealType,
              discountValue,
              minOrderAmount,
              endDate: item.endDate,
              isOngoing: item.isOngoing,
              createdAt: item.createdAt,
              valueScore: Number(valueScore.toFixed(1)),
              priceSignal: formatDealValueLabel(
                item.dealType,
                item.discountValue,
                item.minOrderAmount,
              ),
            };
          })
          .sort((a, b) => {
            if (b.valueScore !== a.valueScore)
              return b.valueScore - a.valueScore;
            return a.minOrderAmount - b.minOrderAmount;
          })
          .slice(0, 8);

        const cuisineValueMap = typedActiveDealRows.reduce<
          Map<
            string,
            {
              cuisineType: string;
              dealCount: number;
              totalValueScore: number;
              totalMinOrder: number;
            }
          >
        >((acc, item) => {
          const cuisine = String(item.cuisineType || "Unknown");
          const discountValue = Number(item.discountValue || 0);
          const minOrderAmount = Number(item.minOrderAmount || 0);
          const normalizedDiscount =
            String(item.dealType || "").toLowerCase() === "fixed"
              ? (discountValue / Math.max(minOrderAmount || 25, 25)) * 100
              : discountValue;
          const current = acc.get(cuisine) || {
            cuisineType: cuisine,
            dealCount: 0,
            totalValueScore: 0,
            totalMinOrder: 0,
          };
          current.dealCount += 1;
          current.totalValueScore += normalizedDiscount;
          current.totalMinOrder += minOrderAmount;
          acc.set(cuisine, current);
          return acc;
        }, new Map());
        const cuisineValue = Array.from(cuisineValueMap.values())
          .map((value) => ({
            cuisineType: value.cuisineType,
            dealCount: value.dealCount,
            avgValueScore:
              value.dealCount > 0
                ? Number((value.totalValueScore / value.dealCount).toFixed(1))
                : 0,
            avgMinOrder:
              value.dealCount > 0
                ? Number((value.totalMinOrder / value.dealCount).toFixed(1))
                : 0,
          }))
          .sort((a, b) => {
            if (b.avgValueScore !== a.avgValueScore) {
              return b.avgValueScore - a.avgValueScore;
            }
            return b.dealCount - a.dealCount;
          })
          .slice(0, 6);

        const acquisitionTargets = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              return (
                Boolean(botSignatureLabel(request.userAgent)) &&
                path.includes(entity.entityId)
              );
            }).length;

            const advertiserScore =
              (entity.entityType === "restaurant" ? 3 : 1) +
              (entity.machineReadiness === "blocked"
                ? 3
                : entity.machineReadiness === "developing"
                  ? 1
                  : 0) +
              (entity.quality === "thin"
                ? 3
                : entity.quality === "growing"
                  ? 1
                  : 0) +
              Math.min(5, crawlerHits);

            return {
              id: entity.id,
              entityId: entity.entityId,
              title: entity.title,
              entityType: entity.entityType,
              canonicalPath: entity.canonicalPath,
              location: entity.location,
              machineReadiness: entity.machineReadiness,
              quality: entity.quality,
              crawlerHits,
              advertiserScore,
              reasons: [
                ...entity.knowledgeGaps.slice(0, 2),
                ...entity.opportunities.slice(0, 2),
              ],
            };
          })
          .sort((a, b) => b.advertiserScore - a.advertiserScore)
          .slice(0, 8);

        const humanRequestRows = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "")
            .trim()
            .toLowerCase();
          const sourceType = String(request.sourceType || "")
            .trim()
            .toLowerCase();
          const isHumanByType = actorType
            ? actorType === "human"
            : !botSignatureLabel(request.userAgent);
          const isHumanBySource = sourceType ? sourceType === "human" : true;
          return (
            createdAt >= since24h.getTime() &&
            !isMonitoringAgent(request.userAgent) &&
            isHumanByType &&
            isHumanBySource
          );
        });

        const recent15m = new Date(Date.now() - 15 * 60 * 1000);
        const recent1h = new Date(Date.now() - 60 * 60 * 1000);
        const profilePathMatcher = /^\/restaurant\/([^/?#]+)/i;
        const intentPathMatcher =
          /(call|phone|website|favorite|save|direction|book|checkout|claim|order|event-signup|subscribe)/i;

        const buildVisitorKey = (request: any) =>
          String(
            request.sessionId ||
              request.anonymousActorId ||
              request.userId ||
              `${String(request.ip || "unknown").trim()}|${String(
                request.userAgent || "",
              )
                .toLowerCase()
                .slice(0, 120)}`,
          );

        const restaurantTitleById = new Map<string, string>();
        for (const entity of entities as any[]) {
          if (String(entity.entityType || "") !== "restaurant") continue;
          if (!entity.entityId) continue;
          restaurantTitleById.set(
            String(entity.entityId),
            String(entity.title || "Restaurant"),
          );
        }

        const profileInterestByRestaurant = new Map<
          string,
          {
            views: number;
            visitors: Set<string>;
            repeatVisitors: Set<string>;
            latestSeenAt: string | null;
          }
        >();
        const profileIntentByRestaurant = new Map<string, number>();
        const visitorProfileCounts = new Map<string, number>();

        for (const request of humanRequestRows) {
          const createdAt = new Date(request.createdAt).getTime();
          const pathValue = String(request.path || "");
          const match = pathValue.match(profilePathMatcher);
          if (!match?.[1]) continue;
          const restaurantId = String(match[1]).trim();
          if (!restaurantId) continue;

          const visitorKey = buildVisitorKey(request);
          const profileKey = `${restaurantId}|${visitorKey}`;
          visitorProfileCounts.set(
            profileKey,
            (visitorProfileCounts.get(profileKey) || 0) + 1,
          );

          const bucket = profileInterestByRestaurant.get(restaurantId) || {
            views: 0,
            visitors: new Set<string>(),
            repeatVisitors: new Set<string>(),
            latestSeenAt: null,
          };
          bucket.views += 1;
          bucket.visitors.add(visitorKey);
          const occurredIso = new Date(createdAt).toISOString();
          if (!bucket.latestSeenAt || occurredIso > bucket.latestSeenAt) {
            bucket.latestSeenAt = occurredIso;
          }
          profileInterestByRestaurant.set(restaurantId, bucket);

          if (intentPathMatcher.test(pathValue)) {
            profileIntentByRestaurant.set(
              restaurantId,
              (profileIntentByRestaurant.get(restaurantId) || 0) + 1,
            );
          }

          if (
            createdAt >= recent1h.getTime() &&
            visitorProfileCounts.get(profileKey)! >= 2
          ) {
            bucket.repeatVisitors.add(visitorKey);
          }
        }

        const topViewedBusinesses = Array.from(
          profileInterestByRestaurant.entries(),
        )
          .map(([restaurantId, data]) => ({
            restaurantId,
            title:
              restaurantTitleById.get(restaurantId) ||
              `Restaurant ${restaurantId.slice(0, 8)}`,
            views: data.views,
            uniqueVisitors: data.visitors.size,
            repeatVisitors: data.repeatVisitors.size,
            intentActions: Number(
              profileIntentByRestaurant.get(restaurantId) || 0,
            ),
            latestSeenAt: data.latestSeenAt,
          }))
          .sort((a, b) => {
            if (b.views !== a.views) return b.views - a.views;
            return b.repeatVisitors - a.repeatVisitors;
          })
          .slice(0, 8);

        const humanSessionsNow = new Set(
          humanRequestRows
            .filter(
              (request: any) =>
                new Date(request.createdAt).getTime() >= recent15m.getTime(),
            )
            .map((request: any) => buildVisitorKey(request)),
        ).size;

        const intentActionsNow = humanRequestRows.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          if (createdAt < recent15m.getTime()) return false;
          return intentPathMatcher.test(String(request.path || ""));
        }).length;

        const repeatedBusinessInterestNow = topViewedBusinesses.reduce(
          (sum, item) => sum + Number(item.repeatVisitors || 0),
          0,
        );

        const machineDiscoveryNow = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "")
            .trim()
            .toLowerCase();
          const sourceType = String(request.sourceType || "")
            .trim()
            .toLowerCase();
          const isMachineByType = actorType
            ? actorType === "bot" || actorType === "llm_bot"
            : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since24h.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path)
          );
        }).length;

        const frictionCases = topViewedBusinesses
          .filter((item) => item.views >= 3 && item.intentActions === 0)
          .map((item) => ({
            id: `friction:${item.restaurantId}`,
            restaurantId: item.restaurantId,
            title: item.title,
            views: item.views,
            uniqueVisitors: item.uniqueVisitors,
            intentActions: item.intentActions,
            latestSeenAt: item.latestSeenAt,
          }))
          .slice(0, 8);
        const frictionCasesNow = frictionCases.length;

        const humanTruthSignalScore =
          humanSessionsNow +
          intentActionsNow +
          repeatedBusinessInterestNow +
          frictionCasesNow;
        const machineSupportScore = machineDiscoveryNow;
        const hasRecommendationDensity =
          humanTruthSignalScore >= 10 &&
          topViewedBusinesses.length >= 2 &&
          humanSessionsNow >= 2 &&
          (intentActionsNow >= 2 || repeatedBusinessInterestNow >= 2);

        const signalContract = {
          mode: hasRecommendationDensity ? "recommendations" : "truth_only",
          reason: hasRecommendationDensity
            ? "Human first-party signal density is high enough for ranked recommendations."
            : "Not enough recent human first-party signal to rank recommendation cards safely.",
          thresholds: {
            minHumanTruthSignalScore: 10,
            minTopViewedBusinesses: 2,
            minHumanSessionsNow: 2,
            minIntentOrRepeat: 2,
          },
          observed: {
            humanTruthSignalScore,
            machineSupportScore,
            topViewedBusinesses: topViewedBusinesses.length,
            humanSessionsNow,
            intentActionsNow,
            repeatedBusinessInterestNow,
            frictionCasesNow,
          },
        } as const;

        const recentObservedEvents = recentRequests
          .slice()
          .sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 80)
          .map((request: any) => {
            const pathValue = String(request.path || "");
            const actorType =
              String(request.actorType || "")
                .trim()
                .toLowerCase() ||
              (botSignatureLabel(request.userAgent) ? "bot" : "human");
            const restaurantMatch = pathValue.match(
              /^\/restaurant\/([^/?#]+)/i,
            );
            const eventType =
              String(request.eventType || "").trim() ||
              classifyObservedEventType(pathValue);
            const surface =
              String(request.surface || "").trim() ||
              inferObservedSurface(pathValue);
            const identitySeed = String(
              request.userId || request.ip || "anonymous",
            );
            const deviceSeed = String(request.userAgent || "").slice(0, 160);
            const anonymousActorId = crypto
              .createHash("sha256")
              .update(`${identitySeed}|${deviceSeed}`)
              .digest("hex")
              .slice(0, 20);
            const sessionId =
              String(request.sessionId || "").trim() ||
              (request.userId
                ? `user:${String(request.userId)}`
                : `anon:${anonymousActorId}`);
            const sourceType =
              String(request.sourceType || "").trim() ||
              (actorType === "human" ? "human" : "crawler");
            return {
              eventId: String(request.id || ""),
              occurredAt: new Date(request.createdAt).toISOString(),
              ingestedAt: new Date(request.createdAt).toISOString(),
              sessionId,
              anonymousActorId: String(
                request.anonymousActorId || anonymousActorId,
              ),
              actorType,
              eventType,
              entityId:
                request.entityId ||
                (restaurantMatch?.[1] ? String(restaurantMatch[1]) : null),
              entityType:
                request.entityType ||
                (restaurantMatch?.[1] ? "restaurant" : null),
              route: pathValue,
              surface,
              category: null,
              state: null,
              county: null,
              city: null,
              sourceType,
              metadata: {
                method: String(request.method || ""),
                statusCode: Number(request.statusCode || 0),
                durationMs: Number(request.durationMs || 0),
              },
            };
          });

        const recentTruthFeed = [
          ...topViewedBusinesses.slice(0, 3).map((item) => ({
            id: `truth:profile:${item.restaurantId}`,
            family: "page_demand",
            summary: `${item.title} drew ${item.views} profile views (${item.uniqueVisitors} visitors) in the last 24h.`,
            evidence: `${item.repeatVisitors} repeat visitors; ${item.intentActions} intent actions.`,
            actionHint:
              item.intentActions === 0
                ? "Improve profile clarity and call-to-action blocks."
                : "Sustain with fresh offers and keep profile details current.",
            occurredAt: item.latestSeenAt || now.toISOString(),
          })),
          ...frictionCases.slice(0, 2).map((item) => ({
            id: `truth:friction:${item.restaurantId}`,
            family: "conversion_friction",
            summary: `${item.title} has ${item.views} views with no intent actions.`,
            evidence: `${item.uniqueVisitors} unique visitors in the current window.`,
            actionHint:
              "Tighten value proposition, menu details, and outbound click paths.",
            occurredAt: item.latestSeenAt || now.toISOString(),
          })),
          ...acquisitionTargets
            .filter((item) => Number(item.crawlerHits || 0) > 0)
            .slice(0, 2)
            .map((item) => {
              const latestMachineHit = recentRequests
                .filter((request: any) => {
                  const createdAt = new Date(request.createdAt).getTime();
                  const actorType = String(request.actorType || "")
                    .trim()
                    .toLowerCase();
                  const sourceType = String(request.sourceType || "")
                    .trim()
                    .toLowerCase();
                  const isMachineByType = actorType
                    ? actorType === "bot" || actorType === "llm_bot"
                    : Boolean(botSignatureLabel(request.userAgent));
                  const isMachineBySource = sourceType
                    ? sourceType === "crawler" || sourceType === "llm_crawler"
                    : true;
                  if (createdAt < since24h.getTime()) return false;
                  if (!isMachineByType || !isMachineBySource) return false;
                  if (!isHighValueObservedPath(request.path)) return false;
                  return String(request.path || "").includes(
                    String(item.entityId || ""),
                  );
                })
                .sort(
                  (a: any, b: any) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )[0];
              return {
                id: `truth:machine:${item.id}`,
                family: "machine_discovery",
                summary: `${item.title} received ${item.crawlerHits} machine discovery hits in the last 24h.`,
                evidence: `Quality=${item.quality}; readiness=${item.machineReadiness}.`,
                actionHint:
                  "Upgrade public page quality before pushing broader distribution.",
                occurredAt: latestMachineHit
                  ? new Date(latestMachineHit.createdAt).toISOString()
                  : now.toISOString(),
              };
            }),
        ].slice(0, 8);

        const recentHighValueMachineHits = recentRequests.filter(
          (request: any) => {
            const createdAt = new Date(request.createdAt).getTime();
            const actorType = String(request.actorType || "")
              .trim()
              .toLowerCase();
            const sourceType = String(request.sourceType || "")
              .trim()
              .toLowerCase();
            const isMachineByType = actorType
              ? actorType === "bot" || actorType === "llm_bot"
              : Boolean(botSignatureLabel(request.userAgent));
            const isMachineBySource = sourceType
              ? sourceType === "crawler" || sourceType === "llm_crawler"
              : true;
            return (
              createdAt >= since24h.getTime() &&
              isMachineByType &&
              isMachineBySource &&
              isHighValueObservedPath(request.path) &&
              !isMonitoringAgent(request.userAgent)
            );
          },
        ).length;
        const previousHighValueMachineHits = recentRequests.filter(
          (request: any) => {
            const createdAt = new Date(request.createdAt).getTime();
            const actorType = String(request.actorType || "")
              .trim()
              .toLowerCase();
            const sourceType = String(request.sourceType || "")
              .trim()
              .toLowerCase();
            const isMachineByType = actorType
              ? actorType === "bot" || actorType === "llm_bot"
              : Boolean(botSignatureLabel(request.userAgent));
            const isMachineBySource = sourceType
              ? sourceType === "crawler" || sourceType === "llm_crawler"
              : true;
            return (
              createdAt >= since48h.getTime() &&
              createdAt < since24h.getTime() &&
              isMachineByType &&
              isMachineBySource &&
              isHighValueObservedPath(request.path) &&
              !isMonitoringAgent(request.userAgent)
            );
          },
        ).length;

        const recentStoryCount = recentStoryCountRows[0]?.count ?? 0;
        const previousStoryCount = previousStoryCountRows[0]?.count ?? 0;
        const recentLocationCount = recentLocationCountRows[0]?.count ?? 0;
        const previousLocationCount = previousLocationCountRows[0]?.count ?? 0;
        const recentDealCreateCount = recentDealCreateCountRows[0]?.count ?? 0;
        const previousDealCreateCount =
          previousDealCreateCountRows[0]?.count ?? 0;
        const recentSearchCount = typedRecentQueryRows.reduce(
          (sum, row) => sum + Number(row.count || 0),
          0,
        );
        const previousSearchCount = typedPreviousQueryRows.reduce(
          (sum, row) => sum + Number(row.count || 0),
          0,
        );
        const topTrend = trendWatch[0] || null;
        const changeItems = [
          {
            id: "search-demand",
            title: "Search demand",
            summary: toCountDeltaLine(
              "Food and restaurant search demand",
              recentSearchCount,
              previousSearchCount,
            ),
            delta: recentSearchCount - previousSearchCount,
            next: topTrend?.label
              ? `Double down on "${topTrend.label}" while it is drawing the strongest visible food demand.`
              : "Strengthen the strongest food topics with better landing pages and fresh content.",
          },
          {
            id: "fresh-content",
            title: "Fresh content",
            summary: toCountDeltaLine(
              "New story creation",
              recentStoryCount,
              previousStoryCount,
            ),
            delta: recentStoryCount - previousStoryCount,
            next: "Push the strongest new stories into sponsor, search, and discovery surfaces before they go stale.",
          },
          {
            id: "deal-supply",
            title: "Deal supply",
            summary: toCountDeltaLine(
              "New deal creation",
              recentDealCreateCount,
              previousDealCreateCount,
            ),
            delta: recentDealCreateCount - previousDealCreateCount,
            next: "Use new deals to feed Price Scout, promotion slots, and machine-readable local value pages.",
          },
          {
            id: "machine-attention",
            title: "Machine discovery",
            summary: toCountDeltaLine(
              "High-value machine discovery",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
            delta: recentHighValueMachineHits - previousHighValueMachineHits,
            next: "Refresh the public pages machines are finding so MealScout becomes the easiest source to cite.",
          },
          {
            id: "location-demand",
            title: "Location demand",
            summary: toCountDeltaLine(
              "Fresh location demand",
              recentLocationCount,
              previousLocationCount,
            ),
            delta: recentLocationCount - previousLocationCount,
            next: "Turn active locations into city pages, ad packages, and truck recruitment targets.",
          },
        ].sort((a, b) => b.delta - a.delta);

        const geoAds = geoAdTotals[0] || { impressions: 0, clicks: 0 };
        const geoPings = geoPingTotals[0] || {
          totalPings: 0,
          uniqueVisitors: 0,
        };
        const topQuery =
          topTrend?.label || topQueriesRows[0]?.query || "local food trucks";
        const topLocation = cityDemandRows[0]
          ? cityDemandRows[0].businessName ||
            cityDemandRows[0].address ||
            cityDemandRows[0].locationType ||
            "high-demand location"
          : "high-demand location";
        const topCuisine =
          cuisineValue[0]?.cuisineType ||
          cuisineRows[0]?.cuisineType ||
          "food truck";
        const topAcquisition = acquisitionTargets[0]?.title || "priority asset";
        const topPriceDeal = bestValueDeals[0];
        const supplyLaneSpotlight = (
          Array.isArray((supplyMarketLaneFeed as any)?.lanes)
            ? (supplyMarketLaneFeed as any).lanes
            : []
        )
          .filter((lane: any) => lane && lane.itemKey && lane.signalType)
          .slice(0, 8)
          .map((lane: any) => ({
            lane: String(lane.lane || ""),
            signalType: String(lane.signalType || ""),
            itemKey: String(lane.itemKey || ""),
            itemName: String(lane.itemName || lane.itemKey || "Unknown item"),
            areaKey: String(lane.areaKey || "global"),
            valuePrimary:
              lane.valuePrimary === null || lane.valuePrimary === undefined
                ? null
                : Number(lane.valuePrimary),
            valueSecondary:
              lane.valueSecondary === null || lane.valueSecondary === undefined
                ? null
                : Number(lane.valueSecondary),
            source: String(lane.source || "market"),
            createdAt: lane.createdAt,
          }));

        const supplyLaneCounts =
          (supplyMarketLaneFeed as any)?.laneCounts ||
          ({} as Record<string, number>);
        const supplySnapshotCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_snapshot:item"] || 0,
        );
        const supplyAlertCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_alert:item"] || 0,
        );
        const supplyWatchCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_watch:item"] || 0,
        );
        const brief = {
          headline: `MealScout demand is clustering around ${topQuery} and ${topCuisine} value right now.`,
          audienceAngle: `Promote around ${topLocation} where location demand and truck interest are forming.`,
          inventoryAngle: `${videoRows.length} recent recommendation stories, ${geoPings.totalPings} foot-traffic pings, and ${bestValueDeals.length} live value offers create ad packaging potential.`,
          acquisitionAngle: `${topAcquisition} is still a candidate to strengthen before monetization packaging.`,
          recommendedPackage: [
            `Sponsor search and discovery around "${topQuery}"`,
            `Bundle geo ads with ${topCuisine} trend momentum`,
            `Use ${topLocation} as a localized campaign wedge`,
          ],
        };

        const safeBrief = hasRecommendationDensity
          ? brief
          : {
              headline:
                "Recommendation layer is paused while first-party signal density is still low.",
              audienceAngle:
                "Track truth counters and repeated business interest before ranking promotion opportunities.",
              inventoryAngle: `Observed human truth score ${humanTruthSignalScore} (needs ${signalContract.thresholds.minHumanTruthSignalScore}) across ${topViewedBusinesses.length} top-viewed businesses; machine support score is ${machineSupportScore}.`,
              acquisitionAngle: signalContract.reason,
              recommendedPackage: [] as string[],
            };

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          signalContract,
          recentObservedEvents,
          truthCounters: {
            humanSessionsNow,
            intentActionsNow,
            repeatedBusinessInterestNow,
            machineDiscoveryNow,
            frictionCasesNow,
          },
          recentTruthFeed,
          topViewedBusinesses,
          frictionCases,
          brief: safeBrief,
          changeSinceYesterday: {
            summary:
              changeItems[0]?.summary ||
              "MealScout does not yet have enough daily movement to call a clear change.",
            items: changeItems.slice(0, 5),
          },
          dailyBriefChanges: {
            promotion: toCountDeltaLine(
              "Fresh content momentum",
              recentStoryCount,
              previousStoryCount,
            ),
            demand:
              topTrend?.summary ||
              toCountDeltaLine(
                "Food search demand",
                recentSearchCount,
                previousSearchCount,
              ),
            acquisition: toCountDeltaLine(
              "Machine attention on public MealScout pages",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
            machineAttention: toCountDeltaLine(
              "High-value machine discovery",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
          },
          trendWatch,
          priceScout: {
            summary: topPriceDeal
              ? `${topPriceDeal.restaurantName} currently leads Price Scout with ${topPriceDeal.priceSignal}. Supply lanes report ${Number((supplyMarketLaneFeed as any)?.total || 0)} recent records (${supplySnapshotCount} snapshots, ${supplyAlertCount} alerts).`
              : `Price Scout does not have enough active deals yet, but supply lanes report ${Number((supplyMarketLaneFeed as any)?.total || 0)} recent records (${supplySnapshotCount} snapshots, ${supplyAlertCount} alerts).`,
            bestDeals: bestValueDeals,
            cuisineValue,
            supplyLaneSummary: {
              totalRecentRecords: Number(
                (supplyMarketLaneFeed as any)?.total || 0,
              ),
              snapshotCount: supplySnapshotCount,
              alertCount: supplyAlertCount,
              watchCount: supplyWatchCount,
              laneCounts: supplyLaneCounts,
              spotlight: supplyLaneSpotlight,
            },
          },
          supplyMarketIntel: {
            summary:
              supplyMarketLaneFeed.total > 0
                ? `Supply market lanes active with ${supplyMarketLaneFeed.total} recent records.`
                : "Supply market lanes have no recent records yet.",
            laneCounts: supplyMarketLaneFeed.laneCounts,
            lanes: supplyMarketLaneFeed.lanes.slice(0, 60),
          },
          advertiserSignals: {
            topQueries: topQueriesRows,
            cityDemand: cityDemandRows,
            cuisineDemand: cuisineRows,
            geoAds: {
              impressions: geoAds.impressions,
              clicks: geoAds.clicks,
              ctr:
                geoAds.impressions > 0 ? geoAds.clicks / geoAds.impressions : 0,
            },
            footTraffic: geoPings,
          },
          contentMomentum: hasRecommendationDensity ? videoRows : [],
          acquisitionTargets: hasRecommendationDensity
            ? acquisitionTargets
            : [],
        });
      } catch (error) {
        console.error("Error fetching LISA market intel:", error);
        res.status(500).json({ message: "Failed to fetch market intel" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/observed-events",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hours = Math.max(
          1,
          Math.min(24 * 30, Number(req.query?.hours || 24) || 24),
        );
        const limit = Math.max(
          20,
          Math.min(1000, Number(req.query?.limit || 200) || 200),
        );
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const parseCsvFilter = (value: unknown) =>
          String(value || "")
            .split(",")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20);

        const actorTypes = parseCsvFilter(req.query?.actorType);
        const sourceTypes = parseCsvFilter(req.query?.sourceType);
        const eventTypes = parseCsvFilter(req.query?.eventType);
        const surfaces = parseCsvFilter(req.query?.surface);
        const entityId = String(req.query?.entityId || "").trim();

        const rows = await db
          .select({
            ...requestLogLegacySelect,
          })
          .from(requestLogs)
          .where(gte(requestLogs.createdAt, since))
          .orderBy(desc(requestLogs.createdAt))
          .limit(Math.max(limit * 5, 400));

        const shapedRows = rows
          .map((row: any) => {
            const path = String(row.path || "");
            const actorType = botSignatureLabel(row.userAgent)
              ? "bot"
              : "human";
            const sourceType = actorType === "bot" ? "crawler" : "human";
            const eventType = classifyObservedEventType(path);
            const surface = inferObservedSurface(path);
            const restaurantMatch = path.match(/^\/restaurant\/([^/?#]+)/i);
            const resolvedEntityId = restaurantMatch?.[1]
              ? String(restaurantMatch[1])
              : null;
            const resolvedEntityType = resolvedEntityId ? "restaurant" : null;
            return {
              ...row,
              actorType,
              sourceType,
              eventType,
              surface,
              entityId: resolvedEntityId,
              entityType: resolvedEntityType,
              sessionId: row.userId ? `user:${String(row.userId)}` : null,
              anonymousActorId: crypto
                .createHash("sha256")
                .update(
                  `${String(row.userId || row.ip || "anonymous")}|${String(row.userAgent || "").slice(0, 160)}`,
                )
                .digest("hex")
                .slice(0, 20),
            };
          })
          .filter((row: any) =>
            actorTypes.length
              ? actorTypes.includes(String(row.actorType))
              : true,
          )
          .filter((row: any) =>
            sourceTypes.length
              ? sourceTypes.includes(String(row.sourceType))
              : true,
          )
          .filter((row: any) =>
            eventTypes.length
              ? eventTypes.includes(String(row.eventType))
              : true,
          )
          .filter((row: any) =>
            surfaces.length ? surfaces.includes(String(row.surface)) : true,
          )
          .filter((row: any) =>
            entityId ? String(row.entityId || "") === entityId : true,
          )
          .slice(0, limit);

        const summary = shapedRows.reduce(
          (
            acc: {
              total: number;
              byActorType: Record<string, number>;
              bySourceType: Record<string, number>;
              byEventType: Record<string, number>;
            },
            row: (typeof shapedRows)[number],
          ) => {
            const actorType = String(row.actorType || "unknown");
            const sourceType = String(row.sourceType || "unknown");
            const eventType = String(row.eventType || "unknown");
            acc.byActorType[actorType] = (acc.byActorType[actorType] || 0) + 1;
            acc.bySourceType[sourceType] =
              (acc.bySourceType[sourceType] || 0) + 1;
            acc.byEventType[eventType] = (acc.byEventType[eventType] || 0) + 1;
            return acc;
          },
          {
            total: shapedRows.length,
            byActorType: {} as Record<string, number>,
            bySourceType: {} as Record<string, number>,
            byEventType: {} as Record<string, number>,
          },
        );

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          filters: {
            actorTypes,
            sourceTypes,
            eventTypes,
            surfaces,
            entityId: entityId || null,
            limit,
          },
          summary,
          events: shapedRows.map((row: (typeof shapedRows)[number]) => ({
            eventId: row.id,
            occurredAt: row.createdAt
              ? new Date(row.createdAt).toISOString()
              : null,
            sessionId: row.sessionId,
            anonymousActorId: row.anonymousActorId,
            actorType: row.actorType || "unknown",
            sourceType: row.sourceType || "unknown",
            eventType:
              row.eventType || classifyObservedEventType(row.path || ""),
            entityId: row.entityId,
            entityType: row.entityType,
            route: row.path,
            surface: row.surface || inferObservedSurface(row.path || ""),
            metadata: {
              method: row.method,
              statusCode: row.statusCode,
              durationMs: row.durationMs,
              userId: row.userId,
            },
          })),
        });
      } catch (error) {
        console.error("Error fetching observed events:", error);
        res.status(500).json({ message: "Failed to fetch observed events" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/market-data-lanes",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const sinceHours = Math.max(
          1,
          Math.min(24 * 14, Number(req.query?.hours || 48) || 48),
        );
        const limit = Math.max(
          10,
          Math.min(5000, Number(req.query?.limit || 1000) || 1000),
        );
        const format = String(req.query?.format || "json")
          .trim()
          .toLowerCase();

        const feed = await getSupplyMarketDataLanes({ sinceHours, limit });

        if (format === "csv") {
          const header = [
            "id",
            "lane",
            "laneFamily",
            "signalType",
            "itemKey",
            "itemName",
            "areaKey",
            "valuePrimary",
            "valueSecondary",
            "source",
            "createdAt",
          ];
          const rows = feed.lanes.map((row: any) =>
            [
              row.id,
              row.lane,
              row.laneFamily,
              row.signalType,
              row.itemKey,
              row.itemName,
              row.areaKey,
              row.valuePrimary ?? "",
              row.valueSecondary ?? "",
              row.source,
              row.createdAt,
            ]
              .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
              .join(","),
          );
          const csv = [header.join(","), ...rows].join("\n");
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `inline; filename="mealscout-supply-market-lanes-${Date.now()}.csv"`,
          );
          return res.send(csv);
        }

        res.json({ ok: true, ...feed });
      } catch (error) {
        console.error("Error fetching supply market data lanes:", error);
        res.status(500).json({ message: "Failed to fetch market data lanes" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/price-scout-feed",
    priceScoutFeedLimiter,
    async (req: any, res) => {
      try {
        const bearerToken = extractBearerToken(req.get("authorization"));
        const accessInfo = await validateFeedAccess(bearerToken);

        const userType = String(req.user?.userType || "").trim();
        const userIsStaff = isInternalTeamUserType(userType);

        if (!accessInfo && !userIsStaff) {
          return res.status(401).json({
            message: "Unauthorized. Use staff session auth or valid API token.",
          });
        }

        const authMode = accessInfo ? "token" : "session";
        const tier = accessInfo?.tier || "staff";
        const tokenFingerprint = bearerToken
          ? fingerprintToken(bearerToken)
          : null;

        // Custom limits if configured in accessInfo
        const effectiveRateLimit = accessInfo?.rateLimitPerHour || 120;

        const sinceHours = Math.max(
          1,
          Math.min(24 * 14, Number(req.query?.hours || 48) || 48),
        );
        const dealLimit = Math.max(
          5,
          Math.min(200, Number(req.query?.dealLimit || 40) || 40),
        );
        const laneLimit = Math.max(
          10,
          Math.min(5000, Number(req.query?.laneLimit || 1000) || 1000),
        );
        const format = String(req.query?.format || "json")
          .trim()
          .toLowerCase();

        const [activeDealRows, supplyFeed] = await Promise.all([
          db
            .select({
              dealId: deals.id,
              restaurantId: restaurants.id,
              restaurantName: restaurants.name,
              cuisineType: restaurants.cuisineType,
              city: restaurants.city,
              state: restaurants.state,
              title: deals.title,
              dealType: deals.dealType,
              discountValue: deals.discountValue,
              minOrderAmount: deals.minOrderAmount,
              endDate: deals.endDate,
              isOngoing: deals.isOngoing,
              createdAt: deals.createdAt,
            })
            .from(deals)
            .innerJoin(restaurants, eq(restaurants.id, deals.restaurantId))
            .where(eq(deals.isActive, true))
            .orderBy(desc(deals.createdAt))
            .limit(dealLimit * 4),
          getSupplyMarketDataLanes({ sinceHours, limit: laneLimit }),
        ]);

        const typedActiveDealRows = activeDealRows as Array<{
          dealId: string;
          restaurantId: string;
          restaurantName: string;
          cuisineType: string | null;
          city: string | null;
          state: string | null;
          title: string;
          dealType: string;
          discountValue: string | number;
          minOrderAmount: string | number | null;
          endDate: Date | null;
          isOngoing: boolean | null;
          createdAt: Date | null;
        }>;

        const bestDeals = typedActiveDealRows
          .map((item) => {
            const discountValue = Number(item.discountValue || 0);
            const minOrderAmount = Number(item.minOrderAmount || 0);
            const valueScore =
              String(item.dealType || "").toLowerCase() === "fixed"
                ? (discountValue / Math.max(minOrderAmount || 25, 25)) * 100
                : discountValue;
            return {
              id: item.dealId,
              restaurantId: item.restaurantId,
              restaurantName: item.restaurantName,
              cuisineType: item.cuisineType,
              city: item.city,
              state: item.state,
              title: item.title,
              dealType: item.dealType,
              discountValue,
              minOrderAmount,
              endDate: item.endDate,
              isOngoing: item.isOngoing,
              createdAt: item.createdAt,
              valueScore: Number(valueScore.toFixed(1)),
              priceSignal: formatDealValueLabel(
                item.dealType,
                item.discountValue,
                item.minOrderAmount,
              ),
              lane: "mealscout:price_scout:deal_value:offer",
            };
          })
          .sort((a, b) => {
            if (b.valueScore !== a.valueScore)
              return b.valueScore - a.valueScore;
            return a.minOrderAmount - b.minOrderAmount;
          })
          .slice(0, dealLimit);

        const payload = {
          ok: true,
          generatedAt: new Date().toISOString(),
          sinceHours,
          lanes: {
            dealValue: "mealscout:price_scout:deal_value:offer",
            supplyAlert: "mealscout:supply_market:price_alert:item",
            supplySnapshot: "mealscout:supply_market:price_snapshot:item",
            supplyWatch: "mealscout:supply_market:price_watch:item",
          },
          summary: {
            deals: bestDeals.length,
            supplyRecords: Number((supplyFeed as any)?.total || 0),
            supplyLaneCounts: (supplyFeed as any)?.laneCounts || {},
          },
          auth: {
            mode: authMode,
            tier,
            tokenFingerprint,
            quota: accessInfo
              ? {
                  limit: accessInfo.monthlyLimit,
                  rateLimit: accessInfo.rateLimitPerHour,
                }
              : "unlimited",
          },
          deals: bestDeals,
          supplyLanes: (supplyFeed as any)?.lanes || [],
        };

        const usageProps = {
          endpoint: "/api/admin/lisa/price-scout-feed",
          authMode,
          tier,
          tokenFingerprint,
          format,
          sinceHours,
          dealLimit,
          laneLimit,
          dealsReturned: bestDeals.length,
          supplyRecordsReturned: Number((supplyFeed as any)?.total || 0),
          laneCounts: (supplyFeed as any)?.laneCounts || {},
        };

        // Increment monthly usage if it's a tiered client
        if (accessInfo?.type === "tiered" && accessInfo.userId !== "system") {
          db.update(clientQuotas)
            .set({
              currentMonthlyUsage: sql`${clientQuotas.currentMonthlyUsage} + 1`,
            })
            .where(eq(clientQuotas.userId, accessInfo.userId))
            .catch((err: any) => console.error("Quota update failed:", err));
        }

        db.insert(telemetryEvents)
          .values({
            eventName: "price_scout_feed_accessed",
            userId: req.user?.id || null,
            properties: usageProps,
          })
          .catch((error: any) => {
            console.error("Failed to log Price Scout feed telemetry:", error);
          });

        logAudit(
          req.user?.id || `token:${tokenFingerprint || "anonymous"}`,
          "price_scout_feed_accessed",
          "price_scout_feed",
          "global",
          req.ip || "",
          String(req.get("user-agent") || ""),
          usageProps,
        ).catch((error) => {
          console.error("Failed to write Price Scout feed audit log:", error);
        });

        res.setHeader("X-PriceScout-Auth-Mode", authMode);
        if (tokenFingerprint) {
          res.setHeader("X-PriceScout-Token", tokenFingerprint);
        }

        if (format === "csv") {
          const header = [
            "recordType",
            "id",
            "lane",
            "name",
            "city",
            "state",
            "itemKey",
            "itemName",
            "signalType",
            "valueScore",
            "valuePrimary",
            "valueSecondary",
            "source",
            "createdAt",
          ];
          const dealRows = bestDeals.map((row) =>
            [
              "deal",
              row.id,
              row.lane,
              row.restaurantName,
              row.city || "",
              row.state || "",
              "",
              row.title,
              "deal_value",
              row.valueScore,
              row.discountValue,
              row.minOrderAmount,
              "price_scout",
              row.createdAt ? new Date(row.createdAt).toISOString() : "",
            ]
              .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
              .join(","),
          );
          const laneRows = ((supplyFeed as any)?.lanes || []).map((row: any) =>
            [
              "supply_lane",
              row.id,
              row.lane,
              "",
              "",
              "",
              row.itemKey || "",
              row.itemName || "",
              row.signalType || "",
              "",
              row.valuePrimary ?? "",
              row.valueSecondary ?? "",
              row.source || "",
              row.createdAt ? new Date(row.createdAt).toISOString() : "",
            ]
              .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
              .join(","),
          );

          const csv = [header.join(","), ...dealRows, ...laneRows].join("\n");
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `inline; filename="mealscout-price-scout-feed-${Date.now()}.csv"`,
          );
          return res.send(csv);
        }

        return res.json(payload);
      } catch (error) {
        console.error("Error fetching Price Scout feed:", error);
        return res
          .status(500)
          .json({ message: "Failed to fetch Price Scout feed" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/market-intel/export",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const exportType = String(req.query.type || "advertiser_brief").trim();
        const format = String(req.query.format || "markdown").trim();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
          topQueriesRows,
          cityDemandRows,
          cuisineRows,
          videoRows,
          geoAdTotals,
          geoPingTotals,
          entities,
          recentRequests,
        ] = await Promise.all([
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since30d))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              businessName: locationRequests.businessName,
              address: locationRequests.address,
              locationType: locationRequests.locationType,
              requestCount: sql<number>`count(*)`.mapWith(Number),
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(
                Number,
              ),
            })
            .from(locationRequests)
            .leftJoin(
              truckInterests,
              eq(truckInterests.locationRequestId, locationRequests.id),
            )
            .where(gte(locationRequests.createdAt, since30d))
            .groupBy(
              locationRequests.businessName,
              locationRequests.address,
              locationRequests.locationType,
            )
            .orderBy(
              desc(sql`count(*)`),
              desc(sql`count(${truckInterests.id})`),
            )
            .limit(10),
          db
            .select({
              cuisineType: restaurants.cuisineType,
              restaurantCount: sql<number>`count(*)`.mapWith(Number),
            })
            .from(restaurants)
            .groupBy(restaurants.cuisineType)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              id: videoStories.id,
              title: videoStories.title,
              restaurantId: videoStories.restaurantId,
              viewCount: videoStories.viewCount,
              impressionCount: videoStories.impressionCount,
              createdAt: videoStories.createdAt,
            })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since30d))
            .orderBy(
              desc(videoStories.impressionCount),
              desc(videoStories.viewCount),
            )
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(
                  Number,
                ),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(
                  Number,
                ),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(
                  Number,
                ),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since30d))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
        ]);

        const acquisitionTargets = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              const actorType = String(request.actorType || "")
                .trim()
                .toLowerCase();
              const sourceType = String(request.sourceType || "")
                .trim()
                .toLowerCase();
              const isMachineByType = actorType
                ? actorType === "bot" || actorType === "llm_bot"
                : Boolean(botSignatureLabel(request.userAgent));
              const isMachineBySource = sourceType
                ? sourceType === "crawler" || sourceType === "llm_crawler"
                : true;
              return (
                isMachineByType &&
                isMachineBySource &&
                path.includes(entity.entityId)
              );
            }).length;

            const advertiserScore =
              (entity.entityType === "restaurant" ? 3 : 1) +
              (entity.machineReadiness === "blocked"
                ? 3
                : entity.machineReadiness === "developing"
                  ? 1
                  : 0) +
              (entity.quality === "thin"
                ? 3
                : entity.quality === "growing"
                  ? 1
                  : 0) +
              Math.min(5, crawlerHits);

            return {
              id: entity.id,
              title: entity.title,
              entityType: entity.entityType,
              canonicalPath: entity.canonicalPath,
              location: entity.location,
              machineReadiness: entity.machineReadiness,
              quality: entity.quality,
              crawlerHits,
              advertiserScore,
              reasons: [
                ...entity.knowledgeGaps.slice(0, 2),
                ...entity.opportunities.slice(0, 2),
              ],
            };
          })
          .sort((a, b) => b.advertiserScore - a.advertiserScore)
          .slice(0, 8);

        const geoAds = geoAdTotals[0] || { impressions: 0, clicks: 0 };
        const geoPings = geoPingTotals[0] || {
          totalPings: 0,
          uniqueVisitors: 0,
        };
        const topQuery = topQueriesRows[0]?.query || "local food trucks";
        const topLocation =
          cityDemandRows[0]?.businessName ||
          cityDemandRows[0]?.address ||
          cityDemandRows[0]?.locationType ||
          "high-demand location";
        const topCuisine = cuisineRows[0]?.cuisineType || "food truck";

        const searchDemandCount = topQueriesRows.reduce(
          (sum: number, row: any) => sum + Number(row.count || 0),
          0,
        );
        const locationDemandCount = cityDemandRows.reduce(
          (sum: number, row: any) => sum + Number(row.requestCount || 0),
          0,
        );
        const machineDiscoveryCount = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "")
            .trim()
            .toLowerCase();
          const sourceType = String(request.sourceType || "")
            .trim()
            .toLowerCase();
          const isMachineByType = actorType
            ? actorType === "bot" || actorType === "llm_bot"
            : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since7d.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path)
          );
        }).length;
        const exportHumanTruthSignalScore =
          Math.min(searchDemandCount, 10) +
          Math.min(locationDemandCount, 10) +
          Math.min(videoRows.length, 5);
        const exportMachineSupportScore = Math.min(machineDiscoveryCount, 5);
        const hasExportRecommendationDensity =
          exportHumanTruthSignalScore >= 10 &&
          (locationDemandCount >= 3 || searchDemandCount >= 5);

        const exportPayload = {
          type: exportType,
          generatedAt: new Date().toISOString(),
          signalContract: {
            mode: hasExportRecommendationDensity
              ? "recommendations"
              : "truth_only",
            reason: hasExportRecommendationDensity
              ? "First-party signal density is high enough for export recommendations."
              : "Not enough recent first-party signal to export recommendation packages safely.",
            observed: {
              exportHumanTruthSignalScore,
              exportMachineSupportScore,
              searchDemandCount,
              locationDemandCount,
              machineDiscoveryCount,
              contentMomentumCount: videoRows.length,
            },
          },
          advertiserBrief: {
            headline: hasExportRecommendationDensity
              ? `MealScout demand is clustering around ${topQuery} and ${topCuisine} inventory.`
              : "Recommendation exports paused while first-party signal density is low.",
            audienceAngle: hasExportRecommendationDensity
              ? `Promote around ${topLocation} where location demand and truck interest are forming.`
              : "Use truth counters and recent event evidence until enough density is present.",
            inventoryAngle: hasExportRecommendationDensity
              ? `${videoRows.length} recent stories, ${geoAds.impressions} geo-ad impressions, and ${geoPings.totalPings} foot-traffic pings create sponsor inventory.`
              : `Observed human truth score ${exportHumanTruthSignalScore} in the latest export window; machine support score ${exportMachineSupportScore}.`,
            recommendations: hasExportRecommendationDensity
              ? [
                  `Sponsor search and discovery around "${topQuery}"`,
                  `Build a localized package around ${topLocation}`,
                  `Bundle ${topCuisine} content with geo-distribution inventory`,
                ]
              : [],
          },
          acquisitionWatchlist: hasExportRecommendationDensity
            ? acquisitionTargets
            : [],
          sponsorPackage: {
            geoAds,
            footTraffic: geoPings,
            topQueries: topQueriesRows.slice(0, 5),
            topLocations: cityDemandRows.slice(0, 5),
            topCuisines: cuisineRows.slice(0, 5),
            contentMomentum: videoRows.slice(0, 5),
          },
        };

        if (format === "json") {
          return res.json({ ok: true, ...exportPayload });
        }

        const markdown = [
          `# MealScout ${exportType.replace(/_/g, " ")}`,
          ``,
          `Generated: ${exportPayload.generatedAt}`,
          ``,
          `## Advertiser Brief`,
          exportPayload.advertiserBrief.headline,
          ``,
          `- Audience angle: ${exportPayload.advertiserBrief.audienceAngle}`,
          `- Inventory angle: ${exportPayload.advertiserBrief.inventoryAngle}`,
          ...exportPayload.advertiserBrief.recommendations.map(
            (item) => `- ${item}`,
          ),
          ``,
          `## Acquisition Watchlist`,
          ...exportPayload.acquisitionWatchlist.map(
            (item) =>
              `- ${item.title} (${item.entityType}) | score ${item.advertiserScore} | crawler hits ${item.crawlerHits} | ${item.reasons.join(", ")}`,
          ),
          ``,
          `## Sponsor Package`,
          `- Geo ads: ${geoAds.impressions} impressions / ${geoAds.clicks} clicks`,
          `- Foot traffic: ${geoPings.totalPings} pings / ${geoPings.uniqueVisitors} unique visitors`,
          ...topQueriesRows
            .slice(0, 5)
            .map(
              (item: any) => `- Query demand: ${item.query} (${item.count})`,
            ),
        ].join("\n");

        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="mealscout-${exportType}.md"`,
        );
        res.send(markdown);
      } catch (error) {
        console.error("Error exporting market intel package:", error);
        res
          .status(500)
          .json({ message: "Failed to export market intel package" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/remediations",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hoursRaw = Number(req.query.hours ?? 24 * 30);
        const hours = Number.isFinite(hoursRaw)
          ? Math.max(24, Math.min(24 * 120, Math.trunc(hoursRaw)))
          : 24 * 30;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const entityType = String(req.query.entityType || "").trim();
        const entityId = String(req.query.entityId || "").trim();

        const rows = await db
          .select({
            id: telemetryEvents.id,
            userId: telemetryEvents.userId,
            createdAt: telemetryEvents.createdAt,
            properties: telemetryEvents.properties,
          })
          .from(telemetryEvents)
          .where(
            and(
              eq(telemetryEvents.eventName, "lisa_remediation_action"),
              gte(telemetryEvents.createdAt, since),
            ),
          )
          .orderBy(desc(telemetryEvents.createdAt))
          .limit(1000);

        const items = rows
          .map((row: any) => {
            const properties =
              row.properties && typeof row.properties === "object"
                ? (row.properties as Record<string, any>)
                : {};
            return {
              id: row.id,
              userId: row.userId,
              createdAt: row.createdAt,
              entityType: String(properties.entityType || ""),
              entityId: String(properties.entityId || ""),
              actionId: String(properties.actionId || ""),
              actionLabel: String(properties.actionLabel || ""),
              actionHref: String(properties.actionHref || ""),
              actionKind: String(properties.actionKind || "admin"),
              status: String(properties.status || "started"),
              notes: String(properties.notes || ""),
            };
          })
          .filter((item: any) => {
            if (entityType && item.entityType !== entityType) return false;
            if (entityId && item.entityId !== entityId) return false;
            return Boolean(item.entityType && item.entityId && item.actionId);
          });

        const latestByAction = new Map<string, (typeof items)[number]>();
        for (const item of items) {
          const key = `${item.entityType}:${item.entityId}:${item.actionId}`;
          if (!latestByAction.has(key)) {
            latestByAction.set(key, item);
          }
        }

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
          latest: Array.from(latestByAction.values()),
        });
      } catch (error) {
        console.error("Error fetching LISA remediations:", error);
        res.status(500).json({ message: "Failed to fetch remediations" });
      }
    },
  );

  app.post(
    "/api/admin/lisa/remediations",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const entityType = String(req.body?.entityType || "").trim();
        const entityId = String(req.body?.entityId || "").trim();
        const actionId = String(req.body?.actionId || "").trim();
        const actionLabel = String(req.body?.actionLabel || "").trim();
        const actionHref = String(req.body?.actionHref || "").trim();
        const actionKind =
          String(req.body?.actionKind || "admin").trim() === "public"
            ? "public"
            : "admin";
        const status =
          String(req.body?.status || "started").trim() === "completed"
            ? "completed"
            : "started";
        const notes = String(req.body?.notes || "")
          .trim()
          .slice(0, 500);

        if (!entityType || !entityId || !actionId || !actionLabel) {
          return res
            .status(400)
            .json({ message: "Missing remediation fields" });
        }

        const [eventRow] = await db
          .insert(telemetryEvents)
          .values({
            eventName: "lisa_remediation_action",
            userId: req.user?.id || null,
            properties: {
              entityType,
              entityId,
              actionId,
              actionLabel,
              actionHref,
              actionKind,
              status,
              notes: notes || null,
            },
          })
          .returning({
            id: telemetryEvents.id,
            createdAt: telemetryEvents.createdAt,
          });

        logAudit(
          req.user?.id || "",
          "lisa_remediation_action",
          "lisa_entity",
          `${entityType}:${entityId}`,
          req.ip || "",
          String(req.get("user-agent") || ""),
          {
            actionId,
            actionLabel,
            actionHref,
            actionKind,
            status,
          },
        ).catch((err) =>
          console.error("Failed to write LISA remediation audit log:", err),
        );

        storage
          .emitClaim({
            subjectType: entityType,
            subjectId: entityId,
            actorType: "user",
            actorId: req.user?.id || null,
            app: "mealscout",
            claimType: "remediation_action_logged",
            claimValue: {
              actionId,
              actionLabel,
              actionHref,
              actionKind,
              status,
              notes: notes || null,
            },
            source: "admin_control_center",
          })
          .catch((err) =>
            console.error("Failed to emit remediation LISA claim:", err),
          );

        res.json({
          ok: true,
          item: {
            id: eventRow?.id || null,
            createdAt: eventRow?.createdAt || new Date().toISOString(),
            entityType,
            entityId,
            actionId,
            actionLabel,
            actionHref,
            actionKind,
            status,
            notes,
          },
        });
      } catch (error) {
        console.error("Error logging LISA remediation:", error);
        res.status(500).json({ message: "Failed to log remediation" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/brief-actions",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hoursRaw = Number(req.query.hours ?? 24 * 30);
        const hours = Number.isFinite(hoursRaw)
          ? Math.max(24, Math.min(24 * 120, Math.trunc(hoursRaw)))
          : 24 * 30;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const rows = await db
          .select({
            id: telemetryEvents.id,
            userId: telemetryEvents.userId,
            createdAt: telemetryEvents.createdAt,
            properties: telemetryEvents.properties,
          })
          .from(telemetryEvents)
          .where(
            and(
              eq(telemetryEvents.eventName, "lisa_brief_action"),
              gte(telemetryEvents.createdAt, since),
            ),
          )
          .orderBy(desc(telemetryEvents.createdAt))
          .limit(1000);

        const items = rows
          .map((row: any) => {
            const properties =
              row.properties && typeof row.properties === "object"
                ? (row.properties as Record<string, any>)
                : {};
            return {
              id: row.id,
              userId: row.userId,
              createdAt: row.createdAt,
              briefKey: String(properties.briefKey || ""),
              action: String(properties.action || ""),
              title: String(properties.title || ""),
              href: String(properties.href || ""),
            };
          })
          .filter((item: any) => Boolean(item.briefKey && item.action));

        const latestByBrief = new Map<string, (typeof items)[number]>();
        for (const item of items) {
          if (!latestByBrief.has(item.briefKey)) {
            latestByBrief.set(item.briefKey, item);
          }
        }

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
          latest: Array.from(latestByBrief.values()),
        });
      } catch (error) {
        console.error("Error fetching LISA brief actions:", error);
        res.status(500).json({ message: "Failed to fetch brief actions" });
      }
    },
  );

  app.post(
    "/api/admin/lisa/brief-actions",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const briefKey = String(req.body?.briefKey || "").trim();
        const actionRaw = String(req.body?.action || "")
          .trim()
          .toLowerCase();
        const title = String(req.body?.title || "").trim();
        const href = String(req.body?.href || "").trim();
        const action =
          actionRaw === "done" ||
          actionRaw === "snooze" ||
          actionRaw === "dismiss"
            ? actionRaw
            : "";

        if (!briefKey || !action) {
          return res
            .status(400)
            .json({ message: "Missing brief action fields" });
        }

        const [eventRow] = await db
          .insert(telemetryEvents)
          .values({
            eventName: "lisa_brief_action",
            userId: req.user?.id || null,
            properties: {
              briefKey,
              action,
              title: title || null,
              href: href || null,
            },
          })
          .returning({
            id: telemetryEvents.id,
            createdAt: telemetryEvents.createdAt,
          });

        logAudit(
          req.user?.id || "",
          "lisa_brief_action",
          "lisa_brief",
          briefKey,
          req.ip || "",
          String(req.get("user-agent") || ""),
          { briefKey, action, title, href },
        ).catch((err) =>
          console.error("Failed to write LISA brief audit log:", err),
        );

        res.json({
          ok: true,
          item: {
            id: eventRow?.id || null,
            createdAt: eventRow?.createdAt || new Date().toISOString(),
            briefKey,
            action,
            title,
            href,
          },
        });
      } catch (error) {
        console.error("Error logging LISA brief action:", error);
        res.status(500).json({ message: "Failed to log brief action" });
      }
    },
  );

  registerGeoAuditRoutes(app);
  registerAdminCoreOpsRoutes(app);

  registerTruckImportAdminRoutes(app, {
    requireAdminUser,
    ensureTruckImportTables,
    isMissingRelationError,
    isMissingColumnError,
    getOrCreateImportSystemUserId,
    truckImportUploadSingle,
  });

  registerUserAdminRoutes(app, {
    denyStaffEdits,
    requireAdminUser,
    buildLocationKey,
    getHostPricingColumnsCheck,
    hasHostSpotImageColumn,
    resetHostPricingColumnsCache,
    isMissingColumnError,
  });
  registerAffiliateAdminRoutes(app, {
    requireAdminUser,
  });
}

