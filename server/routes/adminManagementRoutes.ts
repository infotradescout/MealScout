import { registerGeoAuditRoutes } from "./admin/geoAuditRoutes";
import { registerAffiliateAdminRoutes } from "./admin/affiliateAdminRoutes";
import { registerTruckImportAdminRoutes } from "./admin/truckImportAdminRoutes";
import { registerUserAdminRoutes } from "./admin/userAdminRoutes";
import { registerAdminCoreOpsRoutes } from "./admin/adminCoreOpsRoutes";
import { registerAdminEmailRoutes } from "./admin/adminEmailRoutes";
import { registerAdminLisaActionsRoutes } from "./admin/adminLisaActionsRoutes";
import { registerAdminLisaMarketIntelRoutes } from "./admin/adminLisaMarketIntelRoutes";
import {
  getHostPricingColumnsCheck,
  hasHostSpotImageColumn,
  resetHostPricingColumnsCache,
} from "./admin/hostSchemaSupport";
import type { Express } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, inArray, or, sql, desc, isNull, gte, lt, ne } from "drizzle-orm";
import { storage } from "../storage";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { sanitizeUser } from "../utils/sanitize";
import { sendAccountSetupInvite } from "../utils/accountSetup";
import { db } from "../db";
import { logAudit } from "../auditLogger";
import { ensureAffiliateTag } from "../affiliateTagService";
import { syncUserToBrevo } from "../brevoCrm";
import multer from "multer";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { forwardGeocode } from "../utils/geocoding";
import { ensurePremiumTrialForUserId } from "../services/premiumTrial";
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
  insertHostSchema,
  restaurants,
  suppliers,
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
  candidateUserType !== "admin" && candidateUserType !== "super_admin";

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
  const value = String(path || "").trim().toLowerCase();
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
  const value = String(path || "").trim().toLowerCase();
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

  add("review_public_page", "Review public page", entity.canonicalPath, "public");
  add("open_admin", "Open admin workspace", "/admin/dashboard", "admin");

  for (const gap of entity.knowledgeGaps) {
    switch (gap) {
      case "missing_description":
        add("add_description", "Add description", "/admin/dashboard");
        break;
      case "missing_website":
        add("add_website", "Add website link", "/admin/dashboard");
        break;
      case "missing_location_context":
        add("complete_location", "Complete location data", "/admin/dashboard");
        break;
      case "missing_cuisine":
        add("set_cuisine", "Set cuisine/category", "/admin/dashboard");
        break;
      case "unverified_profile":
      case "unverified_host":
        add("verify_entity", "Verify entity", "/admin/dashboard");
        break;
      case "missing_pricing":
        add("set_pricing", "Set pricing", "/admin/dashboard");
        break;
      case "stripe_not_ready":
        add("complete_stripe", "Complete Stripe setup", "/admin/dashboard");
        break;
      case "missing_spot_capacity":
        add("set_capacity", "Set capacity", "/admin/dashboard");
        break;
      case "missing_restaurant_link":
        add("link_restaurant", "Link restaurant", "/admin/dashboard");
        break;
      case "missing_start_date":
      case "missing_end_date":
        add("fix_schedule", "Fix schedule/timing", "/admin/dashboard");
        break;
      case "no_usage_signals":
        add("promote_usage", "Promote visibility", entity.canonicalPath, "public");
        break;
      case "missing_host_link":
        add("link_host", "Link host", "/admin/dashboard");
        break;
      case "missing_event_type":
      case "missing_event_date":
      case "missing_event_name":
        add("repair_event", "Repair event metadata", "/admin/dashboard");
        break;
      default:
        break;
    }
  }

  for (const opportunity of entity.opportunities) {
    switch (opportunity) {
      case "activate_live_location":
        add("go_live", "Activate live location", "/admin/dashboard");
        break;
      case "grow_authority_signals":
        add("grow_authority", "Grow authority signals", entity.canonicalPath, "public");
        break;
      case "refresh_profile_data":
      case "refresh_host_record":
      case "review_deal_freshness":
      case "review_event_status":
        add("refresh_data", "Refresh stale data", "/admin/dashboard");
        break;
      case "review_for_publish":
        add("publish_ready", "Review for publish", "/admin/dashboard");
        break;
      case "promote_deal_visibility":
        add("promote_deal", "Promote deal visibility", entity.canonicalPath, "public");
        break;
      case "drive_truck_interest":
        add("drive_interest", "Drive truck interest", entity.canonicalPath, "public");
        break;
      default:
        break;
    }
  }

  return Array.from(actions.values()).slice(0, 4);
};

async function buildCanonicalEntities(limit: number): Promise<CanonicalEntitySummary[]> {
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
    if (
      req.user?.userType !== "admin" &&
      req.user?.userType !== "super_admin"
    ) {
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
          userType,
        } = req.body;

        if (req.user?.userType === "staff") {
          if (userType === "admin" || userType === "super_admin") {
            return res.status(403).json({
              message: "Staff cannot create admin or super admin accounts",
            });
          }
        }

        if (
          userType === "super_admin" &&
          req.user?.userType !== "super_admin"
        ) {
          return res.status(403).json({
            message: "Only super admins can create super admin accounts",
          });
        }

        // Validate required fields
        const normalizedEmail = email?.trim().toLowerCase();
        const validUserTypes = [
          "customer",
          "restaurant_owner",
          "food_truck",
          "supplier",
          "host",
          "event_coordinator",
          "staff",
          "admin",
          "super_admin",
        ];

        if (
          !normalizedEmail ||
          !userType ||
          !validUserTypes.includes(userType)
        ) {
          return res.status(400).json({
            message: "Valid email and userType are required",
          });
        }

        const isRestaurantProvisionType =
          userType === "restaurant_owner" || userType === "food_truck";
        const isHostProvisionType =
          userType === "host" || userType === "event_coordinator";
        const isSupplierProvisionType = userType === "supplier";
        const normalizedBusinessName = String(businessName || "").trim();
        const normalizedAddress = String(address || "").trim();

        if (
          (isRestaurantProvisionType ||
            isHostProvisionType ||
            isSupplierProvisionType) &&
          (!normalizedBusinessName || !normalizedAddress)
        ) {
          return res.status(400).json({
            message:
              "businessName and address are required to provision this account type",
          });
        }

        const [existingUserByEmail] = await db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${normalizedEmail}`)
          .limit(1);
        if (existingUserByEmail) {
          return res.status(409).json({ message: "Email already in use" });
        }

        const hasLatitude =
          latitude !== undefined && latitude !== null && `${latitude}`.trim() !== "";
        const hasLongitude =
          longitude !== undefined && longitude !== null && `${longitude}`.trim() !== "";

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
          if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
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

        const userIsInternalTeam =
          userType === "staff" ||
          userType === "admin" ||
          userType === "super_admin";

        let createdHostId: string | null = null;
        let createdRestaurantId: string | null = null;
        let createdSupplierId: string | null = null;
        const [user] = await db.transaction(async (tx: any) => {
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
              ${userType},
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
          const insertedUser = (insertedUserResult as any)?.rows?.[0];
          if (!insertedUser?.id) {
            throw new Error("Failed to create admin-provisioned user");
          }

          if (isRestaurantProvisionType) {
            const [insertedRestaurant] = await tx
              .insert(restaurants)
              .values({
                ownerId: insertedUser.id,
                name: normalizedBusinessName,
                address: normalizedAddress,
                cuisineType: cuisineType || "Various",
                isActive: true,
                isVerified: true,
              })
              .returning({ id: restaurants.id });
            createdRestaurantId = insertedRestaurant?.id || null;
          }

          if (isHostProvisionType) {
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

            const [insertedHost] = await tx
              .insert(hosts)
              .values({
                userId: insertedUser.id,
                businessName: normalizedBusinessName,
                address: normalizedAddress,
                locationType:
                  userType === "event_coordinator"
                    ? "event_coordinator"
                    : locationType || "other",
                expectedFootTraffic: footTrafficMap[footTraffic] || 100,
                amenities:
                  Object.keys(amenitiesObj).length > 0 ? amenitiesObj : null,
                isVerified: true,
                adminCreated: true,
                ...(parsedLatitude !== null && parsedLongitude !== null
                  ? {
                      latitude: parsedLatitude.toString(),
                      longitude: parsedLongitude.toString(),
                    }
                  : {}),
              })
              .returning({ id: hosts.id });

            createdHostId = insertedHost?.id || null;
          }

          if (isSupplierProvisionType) {
            const [insertedSupplier] = await tx
              .insert(suppliers)
              .values({
                userId: insertedUser.id,
                businessName: normalizedBusinessName,
                address: normalizedAddress,
                contactEmail: normalizedEmail,
                contactPhone: phone?.trim() || null,
                isActive: true,
              })
              .returning({ id: suppliers.id });
            createdSupplierId = insertedSupplier?.id || null;
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

        const emailSent = await sendAccountSetupInvite({
          user,
          createdBy: req.user,
          req,
        });

        res.json({
          success: true,
          setupEmailSent: emailSent,
          message: `${userType} account created successfully. Setup link emailed to ${email}.`,
          user: {
            id: user.id,
            email: user.email,
            userType: user.userType,
          },
          createdRestaurantId,
          createdHostId,
          createdSupplierId,
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

      // Also verify email if admin/super_admin
      if (
        user &&
        !user.emailVerified &&
        (user.userType === "admin" || user.userType === "super_admin")
      ) {
        try {
          user = await storage.updateUser(user.id, { emailVerified: true });
        } catch (err) {
          console.warn("⚠️  Failed to verify admin email:", err);
        }
      }

      if (
        user.userType === "admin" ||
        user.userType === "super_admin" ||
        user.userType === "staff"
      ) {
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
            lane: buildSignalLane(["mobility", "truck", location.source || "gps"]),
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
            lane: buildSignalLane(["commerce", "deal", deal.isActive ? "active" : "inactive"]),
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
            lane: buildSignalLane(["events", "host_event", event.status || "unknown"]),
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
            const authorityDelta = crawlerHits * 2 + gapPenalty + readinessPenalty + freshnessPenalty;

            return {
              ...entity,
              crawlerHits,
              humanHits,
              authorityDelta,
              pressure:
                crawlerHits >= 5
                  ? "high"
                  : crawlerHits >= 2
                    ? "medium"
                    : "low",
            };
          })
          .filter((entity) => entity.crawlerHits > 0 || entity.machineReadiness !== "ready")
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
    "/api/admin/lisa/observed-events",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours || 24) || 24));
        const limit = Math.max(20, Math.min(1000, Number(req.query?.limit || 200) || 200));
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
            const actorType = botSignatureLabel(row.userAgent) ? "bot" : "human";
            const sourceType = actorType === "bot" ? "crawler" : "human";
            const eventType = classifyObservedEventType(path);
            const surface = inferObservedSurface(path);
            const restaurantMatch = path.match(/^\/restaurant\/([^/?#]+)/i);
            const resolvedEntityId = restaurantMatch?.[1] ? String(restaurantMatch[1]) : null;
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
          .filter((row: any) => (actorTypes.length ? actorTypes.includes(String(row.actorType)) : true))
          .filter((row: any) => (sourceTypes.length ? sourceTypes.includes(String(row.sourceType)) : true))
          .filter((row: any) => (eventTypes.length ? eventTypes.includes(String(row.eventType)) : true))
          .filter((row: any) => (surfaces.length ? surfaces.includes(String(row.surface)) : true))
          .filter((row: any) => (entityId ? String(row.entityId || "") === entityId : true))
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
            acc.bySourceType[sourceType] = (acc.bySourceType[sourceType] || 0) + 1;
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
            occurredAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
            sessionId: row.sessionId,
            anonymousActorId: row.anonymousActorId,
            actorType: row.actorType || "unknown",
            sourceType: row.sourceType || "unknown",
            eventType: row.eventType || classifyObservedEventType(row.path || ""),
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
        const sinceHours = Math.max(1, Math.min(24 * 14, Number(req.query?.hours || 48) || 48));
        const limit = Math.max(10, Math.min(5000, Number(req.query?.limit || 1000) || 1000));
        const format = String(req.query?.format || "json").trim().toLowerCase();

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
        const userIsStaff =
          userType === "staff" ||
          userType === "admin" ||
          userType === "super_admin";

        if (!accessInfo && !userIsStaff) {
          return res.status(401).json({
            message:
              "Unauthorized. Use staff session auth or valid API token.",
          });
        }

        const authMode = accessInfo ? "token" : "session";
        const tier = accessInfo?.tier || "staff";
        const tokenFingerprint = bearerToken ? fingerprintToken(bearerToken) : null;

        // Custom limits if configured in accessInfo
        const effectiveRateLimit = accessInfo?.rateLimitPerHour || 120;

        const sinceHours = Math.max(
          1,
          Math.min(24 * 14, Number(req.query?.hours || 48) || 48),
        );
        const dealLimit = Math.max(5, Math.min(200, Number(req.query?.dealLimit || 40) || 40));
        const laneLimit = Math.max(10, Math.min(5000, Number(req.query?.laneLimit || 1000) || 1000));
        const format = String(req.query?.format || "json").trim().toLowerCase();

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
            if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
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
            .set({ currentMonthlyUsage: sql`${clientQuotas.currentMonthlyUsage} + 1` })
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
        return res.status(500).json({ message: "Failed to fetch Price Scout feed" });
      }
    },
  );


  registerGeoAuditRoutes(app);
  registerAdminCoreOpsRoutes(app);
  registerAdminEmailRoutes(app);
  registerAdminLisaActionsRoutes(app);
  registerAdminLisaMarketIntelRoutes(app, {
    buildCanonicalEntities,
    botSignatureLabel,
    isMonitoringAgent,
    isHighValueObservedPath,
    classifyObservedEventType,
    inferObservedSurface,
    toCountDeltaLine,
    formatDealValueLabel,
    requestLogLegacySelect,
  });

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
