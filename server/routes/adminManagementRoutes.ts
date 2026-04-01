import type { Express } from "express";
import Stripe from "stripe";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, inArray, or, sql, desc, isNull, gte, lt, ne } from "drizzle-orm";
import { storage } from "../storage";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { sanitizeUser, sanitizeUsers } from "../utils/sanitize";
import { sendAccountSetupInvite } from "../utils/accountSetup";
import { emailService } from "../emailService";
import { emailDeliveryAudit, getEmailConfigSummary } from "../emailService";
import { db } from "../db";
import { logAudit } from "../auditLogger";
import multer from "multer";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { parseTruckImportFile } from "../utils/truckImport";
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
  affiliateShareEvents,
  affiliateCommissionLedger,
  affiliateWithdrawals,
  creditLedger,
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

// Optional Stripe integration (mirrors server/routes.ts)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

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

type HostPricingColumnsCheck = {
  checkedAt: number;
  hasAll: boolean;
  missing: string[];
};

const HOST_PRICING_COLUMNS = [
  "parking_pass_breakfast_price_cents",
  "parking_pass_lunch_price_cents",
  "parking_pass_dinner_price_cents",
  "parking_pass_daily_price_cents",
  "parking_pass_weekly_price_cents",
  "parking_pass_monthly_price_cents",
  "parking_pass_start_time",
  "parking_pass_end_time",
  "parking_pass_days_of_week",
] as const;

let hostPricingColumnsCache: HostPricingColumnsCheck | null = null;
let hostSpotImageColumnCache: { checkedAt: number; has: boolean } | null = null;

async function getHostPricingColumnsCheck(): Promise<HostPricingColumnsCheck> {
  const now = Date.now();
  if (
    hostPricingColumnsCache &&
    now - hostPricingColumnsCache.checkedAt < 5 * 60 * 1000
  ) {
    return hostPricingColumnsCache;
  }

  const rows = await db.execute(
    sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hosts'
        and column_name in (${sql.join(
          HOST_PRICING_COLUMNS.map((col) => sql`${col}`),
          sql`, `,
        )})
    `,
  );

  const present = new Set<string>(
    (rows as any)?.rows?.map((r: any) => String(r?.column_name || "")) ?? [],
  );
  const missing = HOST_PRICING_COLUMNS.filter((col) => !present.has(col));
  hostPricingColumnsCache = {
    checkedAt: now,
    hasAll: missing.length === 0,
    missing: missing.slice(),
  };
  return hostPricingColumnsCache;
}

async function hasHostSpotImageColumn(): Promise<boolean> {
  const now = Date.now();
  if (
    hostSpotImageColumnCache &&
    now - hostSpotImageColumnCache.checkedAt < 5 * 60 * 1000
  ) {
    return hostSpotImageColumnCache.has;
  }

  const rows = await db.execute(
    sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hosts'
        and column_name = 'spot_image_url'
      limit 1
    `,
  );

  const present =
    Array.isArray((rows as any)?.rows) &&
    (rows as any).rows.some(
      (r: any) => String(r?.column_name || "") === "spot_image_url",
    );

  hostSpotImageColumnCache = { checkedAt: now, has: present };
  return present;
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

        // Create user account (invite link flow)
        const user = await storage.createUserInvite({
          email: normalizedEmail,
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
          phone: phone?.trim() || null,
          userType,
        });

        // Internal team accounts should not be blocked on email verification.
        if (
          userType === "staff" ||
          userType === "admin" ||
          userType === "super_admin"
        ) {
          await storage.updateUser(user.id, { emailVerified: true });
        }

        // Handle restaurant owner and food truck creation
        if (
          (userType === "restaurant_owner" || userType === "food_truck") &&
          businessName &&
          address
        ) {
          await storage.createRestaurantForUser({
            userId: user.id,
            name: businessName,
            address,
            cuisineType: cuisineType || "Various",
          });
        }

        // Handle host and event coordinator creation
        if (
          (userType === "host" || userType === "event_coordinator") &&
          businessName &&
          address
        ) {
          // Convert footTraffic string to expected integer
          const footTrafficMap: Record<string, number> = {
            low: 50,
            medium: 150,
            high: 300,
          };

          // Convert amenities array to object
          const amenitiesObj: Record<string, boolean> = {};
          if (Array.isArray(amenities)) {
            amenities.forEach((amenity: string) => {
              amenitiesObj[amenity] = true;
            });
          }

          const hostData: any = {
            userId: user.id,
            businessName,
            address,
            locationType:
              userType === "event_coordinator"
                ? "event_coordinator"
                : locationType || "other",
            expectedFootTraffic: footTrafficMap[footTraffic] || 100,
            amenities:
              Object.keys(amenitiesObj).length > 0 ? amenitiesObj : null,
            isVerified: true, // Admin-created hosts are pre-verified
            adminCreated: true,
          };

          if (latitude && longitude) {
            hostData.latitude = latitude.toString();
            hostData.longitude = longitude.toString();
          }

          await storage.createHost(hostData);
        }

        const emailSent = await sendAccountSetupInvite({
          user,
          createdBy: req.user,
          req,
        });

        res.json({
          success: true,
          setupEmailSent: emailSent,
          message: `${userType} account created successfully. Setup link emailed to ${email}.`,
        });
      } catch (error: any) {
        console.error("Error creating user manually:", error);
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
    "/api/admin/stats",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
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
            .select()
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
            .select()
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
            .select()
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
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(Number),
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
            .orderBy(desc(sql`count(*)`), desc(sql`count(${truckInterests.id})`))
            .limit(10),
          db
            .select({
              cuisineType: restaurants.cuisineType,
              restaurantCount: sql<number>`count(*)`.mapWith(Number),
              avgRankingScore: sql<number>`avg(${restaurants.rankingScore})`.mapWith(Number),
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
                  avgRankingScore: sql<number>`avg(${restaurants.rankingScore})`.mapWith(Number),
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
            .orderBy(desc(videoStories.impressionCount), desc(videoStories.viewCount))
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(Number),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(Number),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(Number),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select()
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
            .where(and(gte(deals.createdAt, since48h), lt(deals.createdAt, since24h))),
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
            if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
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
              return Boolean(botSignatureLabel(request.userAgent)) && path.includes(entity.entityId);
            }).length;

            const advertiserScore =
              (entity.entityType === "restaurant" ? 3 : 1) +
              (entity.machineReadiness === "blocked" ? 3 : entity.machineReadiness === "developing" ? 1 : 0) +
              (entity.quality === "thin" ? 3 : entity.quality === "growing" ? 1 : 0) +
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
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isHumanByType = actorType ? actorType === "human" : !botSignatureLabel(request.userAgent);
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
              `${String(request.ip || "unknown").trim()}|${String(request.userAgent || "")
                .toLowerCase()
                .slice(0, 120)}`,
          );

        const restaurantTitleById = new Map<string, string>();
        for (const entity of entities as any[]) {
          if (String(entity.entityType || "") !== "restaurant") continue;
          if (!entity.entityId) continue;
          restaurantTitleById.set(String(entity.entityId), String(entity.title || "Restaurant"));
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
          visitorProfileCounts.set(profileKey, (visitorProfileCounts.get(profileKey) || 0) + 1);

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

          if (createdAt >= recent1h.getTime() && visitorProfileCounts.get(profileKey)! >= 2) {
            bucket.repeatVisitors.add(visitorKey);
          }
        }

        const topViewedBusinesses = Array.from(profileInterestByRestaurant.entries())
          .map(([restaurantId, data]) => ({
            restaurantId,
            title:
              restaurantTitleById.get(restaurantId) || `Restaurant ${restaurantId.slice(0, 8)}`,
            views: data.views,
            uniqueVisitors: data.visitors.size,
            repeatVisitors: data.repeatVisitors.size,
            intentActions: Number(profileIntentByRestaurant.get(restaurantId) || 0),
            latestSeenAt: data.latestSeenAt,
          }))
          .sort((a, b) => {
            if (b.views !== a.views) return b.views - a.views;
            return b.repeatVisitors - a.repeatVisitors;
          })
          .slice(0, 8);

        const humanSessionsNow = new Set(
          humanRequestRows
            .filter((request: any) => new Date(request.createdAt).getTime() >= recent15m.getTime())
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
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isMachineByType = actorType ? actorType === "bot" || actorType === "llm_bot" : Boolean(botSignatureLabel(request.userAgent));
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
          humanSessionsNow + intentActionsNow + repeatedBusinessInterestNow + frictionCasesNow;
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
            const actorType = String(request.actorType || "").trim().toLowerCase() ||
              (botSignatureLabel(request.userAgent) ? "bot" : "human");
            const restaurantMatch = pathValue.match(/^\/restaurant\/([^/?#]+)/i);
            const eventType = String(request.eventType || "").trim() || classifyObservedEventType(pathValue);
            const surface = String(request.surface || "").trim() || inferObservedSurface(pathValue);
            const identitySeed = String(request.userId || request.ip || "anonymous");
            const deviceSeed = String(request.userAgent || "").slice(0, 160);
            const anonymousActorId = crypto
              .createHash("sha256")
              .update(`${identitySeed}|${deviceSeed}`)
              .digest("hex")
              .slice(0, 20);
            const sessionId =
              String(request.sessionId || "").trim() ||
              (request.userId ? `user:${String(request.userId)}` : `anon:${anonymousActorId}`);
            const sourceType =
              String(request.sourceType || "").trim() ||
              (actorType === "human" ? "human" : "crawler");
            return {
              eventId: String(request.id || ""),
              occurredAt: new Date(request.createdAt).toISOString(),
              ingestedAt: new Date(request.createdAt).toISOString(),
              sessionId,
              anonymousActorId: String(request.anonymousActorId || anonymousActorId),
              actorType,
              eventType,
              entityId: request.entityId || (restaurantMatch?.[1] ? String(restaurantMatch[1]) : null),
              entityType: request.entityType || (restaurantMatch?.[1] ? "restaurant" : null),
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
            actionHint: "Tighten value proposition, menu details, and outbound click paths.",
            occurredAt: item.latestSeenAt || now.toISOString(),
          })),
          ...acquisitionTargets
            .filter((item) => Number(item.crawlerHits || 0) > 0)
            .slice(0, 2)
            .map((item) => {
              const latestMachineHit = recentRequests
                .filter((request: any) => {
                  const createdAt = new Date(request.createdAt).getTime();
                  const actorType = String(request.actorType || "").trim().toLowerCase();
                  const sourceType = String(request.sourceType || "").trim().toLowerCase();
                  const isMachineByType = actorType
                    ? actorType === "bot" || actorType === "llm_bot"
                    : Boolean(botSignatureLabel(request.userAgent));
                  const isMachineBySource = sourceType
                    ? sourceType === "crawler" || sourceType === "llm_crawler"
                    : true;
                  if (createdAt < since24h.getTime()) return false;
                  if (!isMachineByType || !isMachineBySource) return false;
                  if (!isHighValueObservedPath(request.path)) return false;
                  return String(request.path || "").includes(String(item.entityId || ""));
                })
                .sort(
                  (a: any, b: any) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                )[0];
              return {
                id: `truth:machine:${item.id}`,
                family: "machine_discovery",
                summary: `${item.title} received ${item.crawlerHits} machine discovery hits in the last 24h.`,
                evidence: `Quality=${item.quality}; readiness=${item.machineReadiness}.`,
                actionHint: "Upgrade public page quality before pushing broader distribution.",
                occurredAt: latestMachineHit
                  ? new Date(latestMachineHit.createdAt).toISOString()
                  : now.toISOString(),
              };
            }),
        ].slice(0, 8);

        const recentHighValueMachineHits = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
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
        }).length;
        const previousHighValueMachineHits = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
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
        }).length;

        const recentStoryCount = recentStoryCountRows[0]?.count ?? 0;
        const previousStoryCount = previousStoryCountRows[0]?.count ?? 0;
        const recentLocationCount = recentLocationCountRows[0]?.count ?? 0;
        const previousLocationCount = previousLocationCountRows[0]?.count ?? 0;
        const recentDealCreateCount = recentDealCreateCountRows[0]?.count ?? 0;
        const previousDealCreateCount = previousDealCreateCountRows[0]?.count ?? 0;
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
            next:
              topTrend?.label
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
            next:
              "Push the strongest new stories into sponsor, search, and discovery surfaces before they go stale.",
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
            next:
              "Use new deals to feed Price Scout, promotion slots, and machine-readable local value pages.",
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
            next:
              "Refresh the public pages machines are finding so MealScout becomes the easiest source to cite.",
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
            next:
              "Turn active locations into city pages, ad packages, and truck recruitment targets.",
          },
        ].sort((a, b) => b.delta - a.delta);

        const geoAds = geoAdTotals[0] || { impressions: 0, clicks: 0 };
        const geoPings = geoPingTotals[0] || { totalPings: 0, uniqueVisitors: 0 };
        const topQuery = topTrend?.label || topQueriesRows[0]?.query || "local food trucks";
        const topLocation = cityDemandRows[0]
          ? cityDemandRows[0].businessName ||
            cityDemandRows[0].address ||
            cityDemandRows[0].locationType ||
            "high-demand location"
          : "high-demand location";
        const topCuisine =
          cuisineValue[0]?.cuisineType || cuisineRows[0]?.cuisineType || "food truck";
        const topAcquisition = acquisitionTargets[0]?.title || "priority asset";
        const topPriceDeal = bestValueDeals[0];
        const supplyLaneSpotlight = (Array.isArray((supplyMarketLaneFeed as any)?.lanes)
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
          (supplyMarketLaneFeed as any)?.laneCounts || ({} as Record<string, number>);
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
              headline: "Recommendation layer is paused while first-party signal density is still low.",
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
              totalRecentRecords: Number((supplyMarketLaneFeed as any)?.total || 0),
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
          acquisitionTargets: hasRecommendationDensity ? acquisitionTargets : [],
        });
      } catch (error) {
        console.error("Error fetching LISA market intel:", error);
        res.status(500).json({ message: "Failed to fetch market intel" });
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
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(Number),
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
            .orderBy(desc(sql`count(*)`), desc(sql`count(${truckInterests.id})`))
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
            .orderBy(desc(videoStories.impressionCount), desc(videoStories.viewCount))
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(Number),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(Number),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(Number),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select()
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since30d))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
        ]);

        const acquisitionTargets = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              const actorType = String(request.actorType || "").trim().toLowerCase();
              const sourceType = String(request.sourceType || "").trim().toLowerCase();
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
              (entity.quality === "thin" ? 3 : entity.quality === "growing" ? 1 : 0) +
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
        const geoPings = geoPingTotals[0] || { totalPings: 0, uniqueVisitors: 0 };
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
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
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
            mode: hasExportRecommendationDensity ? "recommendations" : "truth_only",
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
          acquisitionWatchlist: hasExportRecommendationDensity ? acquisitionTargets : [],
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
          ...topQueriesRows.slice(0, 5).map(
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
        res.status(500).json({ message: "Failed to export market intel package" });
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
        const notes = String(req.body?.notes || "").trim().slice(0, 500);

        if (!entityType || !entityId || !actionId || !actionLabel) {
          return res.status(400).json({ message: "Missing remediation fields" });
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
        const actionRaw = String(req.body?.action || "").trim().toLowerCase();
        const title = String(req.body?.title || "").trim();
        const href = String(req.body?.href || "").trim();
        const action =
          actionRaw === "done" || actionRaw === "snooze" || actionRaw === "dismiss"
            ? actionRaw
            : "";

        if (!briefKey || !action) {
          return res.status(400).json({ message: "Missing brief action fields" });
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
    "/api/admin/map-pin-audit",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const normalize = (value?: string | null) =>
          (value || "").trim().toLowerCase();
        const keyFor = (
          address?: string | null,
          city?: string | null,
          state?: string | null,
        ) => `${normalize(address)}|${normalize(city)}|${normalize(state)}`;
        const hasCoords = (
          lat?: string | number | null,
          lng?: string | number | null,
        ) =>
          lat !== null &&
          lat !== undefined &&
          lng !== null &&
          lng !== undefined &&
          Number.isFinite(Number(lat)) &&
          Number.isFinite(Number(lng));

        const openLocations = await storage.getOpenLocationRequests();
        // Don't select `hosts.*` because older deployments may be missing newer columns
        // (e.g. `spot_image_url`), which would 500 admin tooling.
        const hostProfiles: Array<{
          id: string;
          userId: string;
          address: string;
          city: string | null;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
          isVerified: boolean | null;
        }> = (await db
          .select({
            id: hosts.id,
            userId: hosts.userId,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            latitude: hosts.latitude,
            longitude: hosts.longitude,
            isVerified: hosts.isVerified,
          })
          .from(hosts)
          .innerJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              sql`${hosts.address} IS NOT NULL`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )) as any;

        const hostByUserId = new Map<
          string,
          {
            id: string;
            userId: string;
            address: string;
            city: string | null;
            state: string | null;
            latitude: string | null;
            longitude: string | null;
            isVerified: boolean | null;
          }
        >();
        hostProfiles.forEach((host) => {
          const existing = hostByUserId.get(host.userId);
          if (!existing) {
            hostByUserId.set(host.userId, host as any);
            return;
          }
          if (!existing.isVerified && host.isVerified) {
            hostByUserId.set(host.userId, host as any);
          }
        });

        const hostUserIds = Array.from(hostByUserId.keys());
        let additionalAddressRows: Array<{
          id: string;
          userId: string;
          address: string;
          city: string;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        if (hostUserIds.length) {
          additionalAddressRows = (await db
            .select({
              id: userAddresses.id,
              userId: userAddresses.userId,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
              latitude: userAddresses.latitude,
              longitude: userAddresses.longitude,
            })
            .from(userAddresses)
            .innerJoin(users, eq(userAddresses.userId, users.id))
            .where(
              and(
                inArray(userAddresses.userId, hostUserIds),
                sql`${userAddresses.address} IS NOT NULL`,
                or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              ),
            )) as any;
        }

        const primaryHostLocations: Array<{
          id: string;
          address: string | null;
          city?: string | null;
          state?: string | null;
          mappable: boolean;
        }> = hostProfiles.map((host) => ({
          id: host.id,
          address: host.address,
          city: host.city,
          state: host.state,
          mappable: hasCoords(host.latitude, host.longitude),
        }));

        const openHostLocations: Array<{
          id: string;
          address: string | null;
          city: string | null;
          state: string | null;
          mappable: boolean;
        }> = openLocations.map(
          (loc: {
            id: string;
            address: string | null;
            latitude?: string | number | null;
            longitude?: string | number | null;
          }) => ({
            id: loc.id,
            address: loc.address,
            city: null,
            state: null,
            mappable: hasCoords(loc.latitude, loc.longitude),
          }),
        );

        const seenKeys = new Set<string>();
        primaryHostLocations.forEach((loc) => {
          seenKeys.add(keyFor(loc.address, loc.city, loc.state));
        });
        openHostLocations.forEach((loc) => {
          seenKeys.add(keyFor(loc.address, null, null));
        });

        let additionalIncluded = 0;
        let additionalSkippedDuplicates = 0;
        const additionalIncludedLocations: Array<{
          id: string;
          address: string;
          city?: string | null;
          state?: string | null;
          mappable: boolean;
        }> = [];

        additionalAddressRows.forEach((address) => {
          const key = keyFor(address.address, address.city, address.state);
          if (!key || seenKeys.has(key)) {
            additionalSkippedDuplicates += 1;
            return;
          }
          seenKeys.add(key);
          additionalIncluded += 1;
          additionalIncludedLocations.push({
            id: address.id,
            address: address.address,
            city: address.city,
            state: address.state,
            mappable: hasCoords(address.latitude, address.longitude),
          });
        });

        const renderedCandidates = [
          ...openHostLocations.map((loc) => ({
            ...loc,
            source: "open_request",
          })),
          ...primaryHostLocations.map((loc) => ({
            ...loc,
            source: "host_profile",
          })),
          ...additionalIncludedLocations.map((loc) => ({
            ...loc,
            source: "host_address",
          })),
        ];

        const renderedMappable = renderedCandidates.filter(
          (loc) => loc.mappable,
        );
        const renderedMissing = renderedCandidates.filter(
          (loc) => !loc.mappable,
        );

        res.json({
          openLocationRequests: {
            total: openHostLocations.length,
            mappable: openHostLocations.filter((loc) => loc.mappable).length,
            missingCoords: openHostLocations.filter((loc) => !loc.mappable)
              .length,
          },
          primaryHostProfiles: {
            total: primaryHostLocations.length,
            mappable: primaryHostLocations.filter((loc) => loc.mappable).length,
            missingCoords: primaryHostLocations.filter((loc) => !loc.mappable)
              .length,
          },
          additionalHostAddresses: {
            total: additionalAddressRows.length,
            included: additionalIncluded,
            skippedDuplicates: additionalSkippedDuplicates,
            mappable: additionalIncludedLocations.filter((loc) => loc.mappable)
              .length,
            missingCoords: additionalIncludedLocations.filter(
              (loc) => !loc.mappable,
            ).length,
          },
          renderedHostLocationCandidates: {
            total: renderedCandidates.length,
            mappable: renderedMappable.length,
            missingCoords: renderedMissing.length,
          },
          sampleMissing: renderedMissing.slice(0, 20),
        });
      } catch (error) {
        console.error("Error building map pin audit:", error);
        res.status(500).json({ message: "Failed to build map pin audit" });
      }
    },
  );

  app.post(
    "/api/admin/map-pin-audit/retry-geocode",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const normalize = (value?: string | null) =>
          (value || "").trim().toLowerCase();
        const keyFor = (
          address?: string | null,
          city?: string | null,
          state?: string | null,
        ) => `${normalize(address)}|${normalize(city)}|${normalize(state)}`;
        const hasCoords = (
          lat?: string | number | null,
          lng?: string | number | null,
        ) =>
          lat !== null &&
          lat !== undefined &&
          lng !== null &&
          lng !== undefined &&
          Number.isFinite(Number(lat)) &&
          Number.isFinite(Number(lng));

        const requestedLimit = Number(req.body?.limit ?? 30);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
          : 30;

        const hostProfiles: Array<{
          id: string;
          userId: string;
          address: string;
          city: string | null;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
          isVerified: boolean | null;
        }> = (await db
          .select({
            id: hosts.id,
            userId: hosts.userId,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            latitude: hosts.latitude,
            longitude: hosts.longitude,
            isVerified: hosts.isVerified,
          })
          .from(hosts)
          .innerJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              sql`${hosts.address} IS NOT NULL`,
              eq(hosts.isVerified, true),
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )) as any;

        const hostByUserId = new Map<string, (typeof hostProfiles)[number]>();
        hostProfiles.forEach((host) => {
          const existing = hostByUserId.get(host.userId);
          if (!existing) {
            hostByUserId.set(host.userId, host);
            return;
          }
          if (!existing.isVerified && host.isVerified) {
            hostByUserId.set(host.userId, host);
          }
        });

        const hostUserIds = Array.from(hostByUserId.keys());
        let additionalAddressRows: Array<{
          id: string;
          userId: string;
          address: string;
          city: string;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        if (hostUserIds.length) {
          additionalAddressRows = (await db
            .select({
              id: userAddresses.id,
              userId: userAddresses.userId,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
              latitude: userAddresses.latitude,
              longitude: userAddresses.longitude,
            })
            .from(userAddresses)
            .innerJoin(users, eq(userAddresses.userId, users.id))
            .where(
              and(
                inArray(userAddresses.userId, hostUserIds),
                sql`${userAddresses.address} IS NOT NULL`,
                or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              ),
            )) as any;
        }

        const seenKeys = new Set<string>();
        hostProfiles.forEach((host) => {
          seenKeys.add(keyFor(host.address, host.city, host.state));
        });

        const failures: Array<{ source: string; id: string; address: string }> =
          [];
        let primaryUpdated = 0;
        let additionalUpdated = 0;
        let attempted = 0;

        const primaryQueue = hostProfiles.filter(
          (host: (typeof hostProfiles)[number]) =>
            !hasCoords(host.latitude, host.longitude) &&
            Boolean((host.address || "").trim()),
        );

        for (const host of primaryQueue) {
          if (attempted >= limit) break;
          const address = [host.address, host.city, host.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) continue;
          attempted += 1;
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            failures.push({ source: "host_profile", id: host.id, address });
            continue;
          }
          await db
            .update(hosts)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(hosts.id, host.id));
          primaryUpdated += 1;
        }

        const additionalQueue = additionalAddressRows.filter((address) => {
          if (hasCoords(address.latitude, address.longitude)) return false;
          const key = keyFor(address.address, address.city, address.state);
          if (!key) return false;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });

        for (const addressRow of additionalQueue) {
          if (attempted >= limit) break;
          const address = [
            addressRow.address,
            addressRow.city,
            addressRow.state,
          ]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) continue;
          attempted += 1;
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            failures.push({
              source: "host_address",
              id: addressRow.id,
              address,
            });
            continue;
          }
          await db
            .update(userAddresses)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(userAddresses.id, addressRow.id));
          additionalUpdated += 1;
        }

        res.json({
          attempted,
          updated: {
            primaryHostProfiles: primaryUpdated,
            additionalHostAddresses: additionalUpdated,
            total: primaryUpdated + additionalUpdated,
          },
          failures: {
            total: failures.length,
            sample: failures.slice(0, 20),
          },
        });
      } catch (error) {
        console.error("Error retrying admin map geocode:", error);
        res.status(500).json({ message: "Failed to retry geocoding" });
      }
    },
  );

  app.post(
    "/api/admin/map-pin-audit/retry-geocode-item",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const source = String(req.body?.source || "");
        const id = String(req.body?.id || "");
        if (!source || !id) {
          return res
            .status(400)
            .json({ message: "source and id are required" });
        }

        if (source === "host_profile") {
          const rows = await db
            .select({
              id: hosts.id,
              address: hosts.address,
              city: hosts.city,
              state: hosts.state,
            })
            .from(hosts)
            .where(eq(hosts.id, id))
            .limit(1);
          const host = rows[0];
          if (!host) return res.status(404).json({ message: "Host not found" });
          const address = [host.address, host.city, host.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) {
            return res.status(400).json({ message: "Host address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({
              message: "Unable to geocode host address",
              address,
            });
          }
          await db
            .update(hosts)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(hosts.id, id));
          return res.json({
            ok: true,
            source,
            id,
            address,
            attempted: geocode.attempted,
            coords: geocode.coords,
          });
        }

        if (source === "host_address") {
          const rows = await db
            .select({
              id: userAddresses.id,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
            })
            .from(userAddresses)
            .where(eq(userAddresses.id, id))
            .limit(1);
          const addressRow = rows[0];
          if (!addressRow) {
            return res.status(404).json({ message: "Host address not found" });
          }
          const address = [
            addressRow.address,
            addressRow.city,
            addressRow.state,
          ]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) {
            return res.status(400).json({ message: "Address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({
              message: "Unable to geocode host address",
              address,
            });
          }
          await db
            .update(userAddresses)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(userAddresses.id, id));
          return res.json({
            ok: true,
            source,
            id,
            address,
            attempted: geocode.attempted,
            coords: geocode.coords,
          });
        }

        if (source === "open_request") {
          const rows = await db
            .select({
              id: locationRequests.id,
              address: locationRequests.address,
            })
            .from(locationRequests)
            .where(eq(locationRequests.id, id))
            .limit(1);
          const requestRow = rows[0];
          if (!requestRow) {
            return res.status(404).json({ message: "Open request not found" });
          }
          const address = (requestRow.address || "").trim();
          if (!address) {
            return res
              .status(400)
              .json({ message: "Open request address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({
              message: "Unable to geocode open request address",
              address,
            });
          }
          await db
            .update(locationRequests)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
            })
            .where(eq(locationRequests.id, id));
          return res.json({
            ok: true,
            source,
            id,
            address,
            attempted: geocode.attempted,
            coords: geocode.coords,
          });
        }

        return res.status(400).json({ message: "Unsupported source type" });
      } catch (error) {
        console.error("Error retrying map geocode item:", error);
        res.status(500).json({ message: "Failed to retry geocode item" });
      }
    },
  );

  // Admin endpoint to sync subscriptions from Stripe to database
  app.post(
    "/api/admin/subscriptions/sync",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
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

        // Get all users with Stripe customer IDs
        const allUsers = await storage.getAllUsers();
        const usersWithStripe = allUsers.filter((u) => u.stripeCustomerId);

        console.log(
          `[ADMIN SYNC] Found ${usersWithStripe.length} users with Stripe customer IDs`,
        );

        for (const user of usersWithStripe) {
          try {
            // Skip if user already has subscription ID
            if (user.stripeSubscriptionId) {
              results.skipped++;
              continue;
            }

            // Check Stripe for active subscriptions
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
                `[ADMIN SYNC] ✅ Synced subscription ${subscription.id} for user ${user.email}`,
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
              `[ADMIN SYNC] ❌ Error syncing user ${user.email}:`,
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
    "/api/admin/restaurants/pending",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const restaurants = await storage.getPendingRestaurants();
        res.json(restaurants);
      } catch (error) {
        console.error("Error fetching pending restaurants:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch pending restaurants" });
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.approveRestaurant(req.params.id);
        res.json({ message: "Restaurant approved successfully" });
      } catch (error) {
        console.error("Error approving restaurant:", error);
        res.status(500).json({ message: "Failed to approve restaurant" });
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
      } catch (error) {
        console.error("Error deleting restaurant:", error);
        res.status(500).json({ message: "Failed to delete restaurant" });
      }
    },
  );

  app.get(
    "/api/admin/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
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
    "/api/admin/truck-imports",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      const includePurged = String(req.query?.includePurged || "") === "1";
      try {
        const batches = await db
          .select()
          .from(truckImportBatches)
          .where(
            includePurged ? sql`true` : isNull(truckImportBatches.purgedAt),
          )
          .orderBy(desc(truckImportBatches.createdAt))
          .limit(50);
        res.json(batches);
      } catch (error) {
        if (isMissingRelationError(error, "truck_import_batches")) {
          try {
            await ensureTruckImportTables();
            const batches = await db
              .select()
              .from(truckImportBatches)
              .where(
                includePurged ? sql`true` : isNull(truckImportBatches.purgedAt),
              )
              .orderBy(desc(truckImportBatches.createdAt))
              .limit(50);
            return res.json(batches);
          } catch (ensureError) {
            console.error("Error ensuring truck import tables:", ensureError);
            return res.status(503).json({
              message:
                "Truck import tables are missing in the database and could not be auto-created. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql` (and then `npm run migrate:sql -- 041_truck_import_batches_purged.sql`).",
              code: "migration_required",
            });
          }
        }
        console.error("Error fetching truck import batches:", error);
        res.status(500).json({ message: "Failed to fetch import batches" });
      }
    },
  );

  app.get(
    "/api/admin/truck-import-listings/search",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const query = String(req.query?.q || "").trim();
        if (!query) return res.json([]);

        const searchValue = `%${query.toLowerCase()}%`;

        const rows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(
            or(
              eq(truckImportListings.externalId, query),
              sql`lower(${truckImportListings.name}) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.email}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.phone}, '')) like ${searchValue}`,
            ),
          )
          .orderBy(desc(truckImportListings.confidenceScore))
          .limit(25);

        res.json(
          rows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
          })),
        );
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error searching truck import listings:", error);
        res.status(500).json({ message: "Failed to search import listings" });
      }
    },
  );

  app.get(
    "/api/admin/truck-import-listings/unclaimed",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const limit = Math.min(
          100,
          Math.max(1, Number(req.query?.limit ?? 50)),
        );
        const offset = Math.max(0, Number(req.query?.offset ?? 0));

        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(truckImportListings)
          .where(eq(truckImportListings.status, "unclaimed"));

        const rows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
            restaurantIsVerified: restaurants.isVerified,
            restaurantIsActive: restaurants.isActive,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.status, "unclaimed"))
          .orderBy(desc(truckImportListings.createdAt))
          .limit(limit)
          .offset(offset);

        res.json({
          total: Number(total ?? 0),
          limit,
          offset,
          rows: rows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
            restaurantIsVerified: row.restaurantIsVerified ?? null,
            restaurantIsActive: row.restaurantIsActive ?? null,
          })),
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        if (isMissingColumnError(error, "claimed_from_import_id")) {
          return res.status(503).json({
            message:
              "Truck import schema is missing columns. Run `npm run migrate:sql -- 044_add_restaurants_claimed_from_import_id.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error listing unclaimed import listings:", error);
        res.status(500).json({ message: "Failed to load unclaimed trucks" });
      }
    },
  );

  app.patch(
    "/api/admin/truck-import-listings/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = req.params.id;
        const updates: any = {};
        const fields = [
          "externalId",
          "email",
          "name",
          "address",
          "city",
          "state",
          "phone",
          "cuisineType",
          "websiteUrl",
          "instagramUrl",
          "facebookPageUrl",
          "latitude",
          "longitude",
        ];
        for (const field of fields) {
          if (req.body?.[field] === undefined) continue;
          updates[field] =
            field === "email"
              ? String(req.body[field] || "")
                  .trim()
                  .toLowerCase() || null
              : req.body[field];
        }

        const [updated] = await db
          .update(truckImportListings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(truckImportListings.id, listingId))
          .returning();

        if (!updated) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        // Keep the seeded restaurant (if any) in sync with listing fields.
        const [seededRestaurant] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.claimedFromImportId, listingId))
          .limit(1);
        if (seededRestaurant) {
          const restaurantUpdates: any = {};
          const map: Array<[string, string]> = [
            ["name", "name"],
            ["address", "address"],
            ["city", "city"],
            ["state", "state"],
            ["phone", "phone"],
            ["cuisineType", "cuisineType"],
            ["websiteUrl", "websiteUrl"],
            ["instagramUrl", "instagramUrl"],
            ["facebookPageUrl", "facebookPageUrl"],
            ["latitude", "latitude"],
            ["longitude", "longitude"],
          ];
          for (const [listingField, restaurantField] of map) {
            if (updates[listingField] !== undefined) {
              restaurantUpdates[restaurantField] = updates[listingField];
            }
          }
          if (Object.keys(restaurantUpdates).length > 0) {
            await db
              .update(restaurants)
              .set({ ...restaurantUpdates, updatedAt: new Date() })
              .where(eq(restaurants.id, seededRestaurant.id));
          }
        }

        res.json(updated);
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_listings")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error updating import listing:", error);
        res.status(500).json({ message: "Failed to update import listing" });
      }
    },
  );

  app.post(
    "/api/admin/truck-import-listings/:id/invite",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const listingId = req.params.id;
        const email = String(req.body?.email || "")
          .trim()
          .toLowerCase();
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const [listing] = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.id, listingId))
          .limit(1);
        if (!listing) {
          return res.status(404).json({ message: "Import listing not found" });
        }

        const importSystemUserId = await getOrCreateImportSystemUserId();

        const existingUser = await storage.getUserByEmail(email);
        const inviteUser =
          existingUser ??
          (await storage.createUserInvite({
            email,
            firstName: null,
            lastName: null,
            phone: null,
            userType: "food_truck",
          }));

        // Ensure there is a seeded restaurant for this listing.
        const [restaurant] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.claimedFromImportId, listingId))
          .limit(1);

        if (restaurant) {
          if (
            restaurant.ownerId !== importSystemUserId &&
            restaurant.ownerId !== inviteUser.id
          ) {
            return res.status(409).json({
              message:
                "This truck is already owned by another account. Refusing to reassign ownership.",
            });
          }
          await db
            .update(restaurants)
            .set({ ownerId: inviteUser.id, updatedAt: new Date() })
            .where(eq(restaurants.id, restaurant.id));
        } else {
          await db.insert(restaurants).values({
            ownerId: inviteUser.id,
            name: listing.name,
            address: listing.address,
            phone: listing.phone,
            businessType: "food_truck",
            cuisineType: listing.cuisineType,
            city: listing.city,
            state: listing.state,
            websiteUrl: listing.websiteUrl,
            instagramUrl: listing.instagramUrl,
            facebookPageUrl: listing.facebookPageUrl,
            latitude: listing.latitude,
            longitude: listing.longitude,
            isFoodTruck: true,
            isActive: false,
            isVerified: false,
            claimedFromImportId: listing.id,
          } as any);
        }

        const [updated] = await db
          .update(truckImportListings)
          .set({
            email,
            invitedUserId: inviteUser.id,
            lastInviteSentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(truckImportListings.id, listingId))
          .returning();

        const emailSent = await sendAccountSetupInvite({
          user: inviteUser,
          createdBy: req.user,
          req,
        });

        res.json({ success: true, emailSent, listing: updated });
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_listings") ||
          isMissingRelationError(error, "truck_import_batches")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error sending import invite:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to send invite" });
      }
    },
  );

  app.post(
    "/api/admin/truck-imports",
    isAuthenticated,
    isStaffOrAdmin,
    truckImportUploadSingle,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "File is required" });
        }

        const source = String(req.body?.source || "").trim() || null;
        const { rows, headers } = await parseTruckImportFile(
          file.buffer,
          file.originalname || "import.csv",
        );

        const [batch] = await db
          .insert(truckImportBatches)
          .values({
            source,
            fileName: file.originalname || "import.csv",
            uploadedBy: req.user?.id,
            totalRows: rows.length,
          })
          .returning();

        let importedRows = 0;
        let missingRows = 0;
        let duplicateRows = 0;
        let seededRestaurants = 0;

        const listingsToInsert: Array<typeof truckImportListings.$inferInsert> =
          [];
        const seenKeys = new Set<string>();

        const normalize = (value: any) =>
          String(value || "")
            .trim()
            .toLowerCase();
        const nameAddressKey = (name: string, address: string) =>
          `${normalize(name)}|${normalize(address)}`;

        const candidateExternalIds = new Set<string>();
        const candidateEmails = new Set<string>();
        const candidateNameAddressKeys = new Set<string>();

        for (const row of rows) {
          const name = row.name?.trim() || "";
          const address = row.address?.trim() || "";
          const externalId = row.externalId?.trim() || "";
          const email = row.email?.trim()?.toLowerCase() || "";
          if (externalId) candidateExternalIds.add(externalId.toLowerCase());
          if (email) candidateEmails.add(email.toLowerCase());
          if (name && address)
            candidateNameAddressKeys.add(nameAddressKey(name, address));
        }

        const extList = Array.from(candidateExternalIds);
        const emailList = Array.from(candidateEmails);
        const nameList = Array.from(
          new Set(
            Array.from(candidateNameAddressKeys).map(
              (key) => key.split("|")[0],
            ),
          ),
        );
        const addressList = Array.from(
          new Set(
            Array.from(candidateNameAddressKeys).map(
              (key) => key.split("|")[1],
            ),
          ),
        );

        const existingImportRows =
          extList.length ||
          emailList.length ||
          (nameList.length && addressList.length)
            ? await db
                .select({
                  externalId: truckImportListings.externalId,
                  email: truckImportListings.email,
                  name: truckImportListings.name,
                  address: truckImportListings.address,
                })
                .from(truckImportListings)
                .where(
                  or(
                    extList.length
                      ? inArray(truckImportListings.externalId, extList)
                      : sql`false`,
                    emailList.length
                      ? inArray(truckImportListings.email, emailList)
                      : sql`false`,
                    nameList.length && addressList.length
                      ? and(
                          inArray(
                            sql`lower(${truckImportListings.name})` as any,
                            nameList,
                          ),
                          inArray(
                            sql`lower(${truckImportListings.address})` as any,
                            addressList,
                          ),
                        )
                      : sql`false`,
                  ),
                )
            : [];

        const existingRestaurantRows =
          nameList.length && addressList.length
            ? await db
                .select({
                  name: restaurants.name,
                  address: restaurants.address,
                })
                .from(restaurants)
                .where(
                  and(
                    or(
                      eq(restaurants.businessType, "food_truck"),
                      eq(restaurants.isFoodTruck, true),
                    ),
                    inArray(sql`lower(${restaurants.name})` as any, nameList),
                    inArray(
                      sql`lower(${restaurants.address})` as any,
                      addressList,
                    ),
                  ),
                )
            : [];

        const existingExternalIdSet = new Set(
          existingImportRows
            .map((row: any) => normalize(row.externalId))
            .filter((value: string) => value.length > 0),
        );
        const existingEmailSet = new Set(
          existingImportRows
            .map((row: any) => normalize(row.email))
            .filter((value: string) => value.length > 0),
        );
        const existingNameAddressSet = new Set<string>();
        existingImportRows.forEach((row: any) => {
          const name = normalize(row.name);
          const address = normalize(row.address);
          if (name && address) existingNameAddressSet.add(`${name}|${address}`);
        });
        existingRestaurantRows.forEach((row: any) => {
          const name = normalize(row.name);
          const address = normalize(row.address);
          if (name && address) existingNameAddressSet.add(`${name}|${address}`);
        });

        for (const row of rows) {
          const name = row.name?.trim();
          const addressInput = row.address?.trim() || "";
          if (!name) {
            missingRows += 1;
            continue;
          }

          const email = row.email?.trim()?.toLowerCase() || null;
          const externalId = row.externalId?.trim() || null;
          const cityKey = (row.city || "").trim().toLowerCase();
          const nameKey = name.toLowerCase();
          const addressKey = addressInput.toLowerCase();
          const dedupeKey = externalId
            ? `ext:${externalId.toLowerCase()}`
            : email
              ? `email:${email}`
              : addressInput
                ? `addr:${nameKey}|${addressKey}`
                : `name:${nameKey}|${cityKey}`;
          if (seenKeys.has(dedupeKey)) {
            duplicateRows += 1;
            continue;
          }
          seenKeys.add(dedupeKey);

          // Duplicate rejection rule:
          // If 2 identifying fields match, treat as a duplicate. ExternalId/email count as "2"
          // because they're unique identifiers in practice (gov license, owner email).
          let matchScore = 0;
          if (externalId && existingExternalIdSet.has(normalize(externalId)))
            matchScore += 2;
          if (email && existingEmailSet.has(normalize(email))) matchScore += 2;
          if (
            addressInput &&
            existingNameAddressSet.has(
              `${normalize(name)}|${normalize(addressInput)}`,
            )
          ) {
            matchScore += 2;
          }

          if (matchScore >= 2) {
            duplicateRows += 1;
            continue;
          }

          listingsToInsert.push({
            batchId: batch?.id,
            source: source || null,
            externalId,
            email,
            name,
            // Address is optional for admin-uploaded seeds; claim flow can fill it in later.
            address: addressInput,
            city: row.city || null,
            state: row.state || null,
            phone: row.phone || null,
            cuisineType: row.cuisineType || null,
            websiteUrl: row.websiteUrl || null,
            instagramUrl: row.instagramUrl || null,
            facebookPageUrl: row.facebookPageUrl || null,
            latitude: row.latitude || null,
            longitude: row.longitude || null,
            confidenceScore: row.confidenceScore || 0,
            status: "unclaimed",
            rawData: row.rawData || null,
          });
        }

        const chunkSize = 250;
        const insertedListingRows: Array<{
          id: string;
          email: string | null;
          name: string;
          address: string;
          city: string | null;
          state: string | null;
          phone: string | null;
          cuisineType: string | null;
          websiteUrl: string | null;
          instagramUrl: string | null;
          facebookPageUrl: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        for (let i = 0; i < listingsToInsert.length; i += chunkSize) {
          const chunk = listingsToInsert.slice(i, i + chunkSize);
          if (chunk.length === 0) continue;
          const inserted = await db
            .insert(truckImportListings)
            .values(chunk)
            .returning({
              id: truckImportListings.id,
              email: truckImportListings.email,
              name: truckImportListings.name,
              address: truckImportListings.address,
              city: truckImportListings.city,
              state: truckImportListings.state,
              phone: truckImportListings.phone,
              cuisineType: truckImportListings.cuisineType,
              websiteUrl: truckImportListings.websiteUrl,
              instagramUrl: truckImportListings.instagramUrl,
              facebookPageUrl: truckImportListings.facebookPageUrl,
              latitude: truckImportListings.latitude,
              longitude: truckImportListings.longitude,
            });
          insertedListingRows.push(...inserted);
          importedRows += inserted.length;
        }

        if (insertedListingRows.length > 0) {
          const systemOwnerId = await getOrCreateImportSystemUserId();

          // Create invited owner accounts where we have an email, but do not email them here.
          // The “Request this truck” flow sends reminders on-demand.
          const invitedOwnerByEmail = new Map<string, string>();
          const uniqueEmails = Array.from(
            new Set(
              insertedListingRows
                .map((listing: any) =>
                  String(listing.email || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter((value) => value.length > 0),
            ),
          );
          for (const email of uniqueEmails) {
            const existing = await storage.getUserByEmail(email);
            const user =
              existing ??
              (await storage.createUserInvite({
                email,
                firstName: null,
                lastName: null,
                phone: null,
                userType: "food_truck",
              }));
            invitedOwnerByEmail.set(email, user.id);
          }

          const restaurantsToInsert = insertedListingRows.map(
            (listing: any) => {
              const email = String(listing.email || "")
                .trim()
                .toLowerCase();
              const invitedOwnerId = email
                ? invitedOwnerByEmail.get(email)
                : undefined;
              return {
                ownerId: invitedOwnerId || systemOwnerId,
                name: listing.name,
                address: listing.address,
                phone: listing.phone,
                businessType: "food_truck",
                cuisineType: listing.cuisineType,
                city: listing.city,
                state: listing.state,
                websiteUrl: listing.websiteUrl,
                instagramUrl: listing.instagramUrl,
                facebookPageUrl: listing.facebookPageUrl,
                latitude: listing.latitude,
                longitude: listing.longitude,
                isFoodTruck: true,
                isActive: false,
                isVerified: false,
                claimedFromImportId: listing.id,
              };
            },
          );

          const restaurantChunkSize = 200;
          for (
            let i = 0;
            i < restaurantsToInsert.length;
            i += restaurantChunkSize
          ) {
            const chunk = restaurantsToInsert.slice(i, i + restaurantChunkSize);
            if (chunk.length === 0) continue;
            await db.insert(restaurants).values(chunk);
            seededRestaurants += chunk.length;
          }

          // Best-effort: persist invited owner linkage on the import listing rows.
          // This allows us to block hostile claims and send setup reminders.
          for (const listing of insertedListingRows as any[]) {
            const email = String(listing.email || "")
              .trim()
              .toLowerCase();
            const invitedOwnerId = email
              ? invitedOwnerByEmail.get(email)
              : null;
            if (!invitedOwnerId) continue;
            try {
              await db
                .update(truckImportListings)
                .set({ invitedUserId: invitedOwnerId, updatedAt: new Date() })
                .where(eq(truckImportListings.id, listing.id));
            } catch {
              // ignore
            }
          }
        }

        const skippedRows = Math.max(
          0,
          rows.length - importedRows - duplicateRows - missingRows,
        );

        await db
          .update(truckImportBatches)
          .set({
            importedRows,
            skippedRows,
            updatedAt: new Date(),
          })
          .where(eq(truckImportBatches.id, batch.id));

        res.json({
          batchId: batch.id,
          totalRows: rows.length,
          importedRows,
          skippedRows,
          missingRows,
          duplicateRows,
          seededRestaurants,
          headers: (headers || []).slice(0, 50),
        });
      } catch (error: any) {
        if (isMissingRelationError(error, "truck_import_batches")) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql` (and then retry the upload).",
            code: "migration_required",
          });
        }
        if (isMissingColumnError(error, "claimed_from_import_id")) {
          return res.status(503).json({
            message:
              "Truck import schema is missing columns. Run `npm run migrate:sql -- 044_add_restaurants_claimed_from_import_id.sql` (and then retry the upload).",
            code: "migration_required",
          });
        }
        console.error("Error importing truck listings:", error);
        res.status(500).json({
          message: error.message || "Failed to import truck listings",
        });
      }
    },
  );

  app.post(
    "/api/admin/truck-imports/:batchId/purge",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const batchId = String(req.params.batchId || "").trim();
        const force = Boolean(req.body?.force);
        if (!batchId) {
          return res.status(400).json({ message: "Batch ID required" });
        }

        const [batch] = await db
          .select()
          .from(truckImportBatches)
          .where(eq(truckImportBatches.id, batchId))
          .limit(1);
        if (!batch) {
          return res.status(404).json({ message: "Import batch not found" });
        }

        const listings = await db
          .select()
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId));

        const listingIds = listings.map((l: any) => l.id);
        if (listingIds.length === 0) {
          return res.json({
            batchId,
            fileName: batch.fileName,
            totalListings: 0,
            deletedListings: 0,
            deletedRestaurants: 0,
            deletedClaimRequests: 0,
            blocked: [],
          });
        }

        const importSystemUserId = await getOrCreateImportSystemUserId();

        const claimRequests = await db
          .select({
            id: truckClaimRequests.id,
            listingId: truckClaimRequests.listingId,
            restaurantId: truckClaimRequests.restaurantId,
          })
          .from(truckClaimRequests)
          .where(inArray(truckClaimRequests.listingId, listingIds));

        const claimRequestListingIds = new Set(
          claimRequests.map((row: any) => String(row.listingId || "")),
        );

        const seededRestaurants = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            claimedFromImportId: restaurants.claimedFromImportId,
          })
          .from(restaurants)
          .where(inArray(restaurants.claimedFromImportId, listingIds));

        const restaurantIds = seededRestaurants.map((row: any) => row.id);
        const bookingRows = restaurantIds.length
          ? await db
              .select({ id: eventBookings.id, truckId: eventBookings.truckId })
              .from(eventBookings)
              .where(inArray(eventBookings.truckId, restaurantIds))
              .limit(1)
          : [];
        const restaurantIdsWithBookings = new Set(
          bookingRows.map((row: any) => String(row.truckId)),
        );

        const blocked: Array<{
          listingId: string;
          reason: string;
        }> = [];

        // Purge policy:
        // - Default: only purge listings that are still `unclaimed`.
        // - Force: allow purging `claim_requested` too (also deletes the claim requests).
        // - Never purge `claimed` rows (could belong to a real business owner).
        const purgeableListingIds: string[] = [];
        for (const listing of listings as any[]) {
          const status = String(listing.status || "");
          const canPurge =
            status === "unclaimed" || (force && status === "claim_requested");
          if (!canPurge) {
            blocked.push({
              listingId: listing.id,
              reason: `status:${status}`,
            });
            continue;
          }
          if (claimRequestListingIds.has(String(listing.id)) && !force) {
            blocked.push({
              listingId: listing.id,
              reason: "has_claim_request",
            });
            continue;
          }
          purgeableListingIds.push(String(listing.id));
        }

        let deletedClaimRequests = 0;
        let deletedRestaurants = 0;
        let deletedListings = 0;

        await db.transaction(async (tx: any) => {
          if (force && claimRequests.length > 0) {
            const deleted = await tx
              .delete(truckClaimRequests)
              .where(
                inArray(
                  truckClaimRequests.id,
                  claimRequests.map((r: any) => r.id),
                ),
              )
              .returning({ id: truckClaimRequests.id });
            deletedClaimRequests = deleted.length;
          }

          // Delete seeded restaurant profiles for purgeable listings.
          const restaurantIdsToDelete: string[] = [];
          for (const row of seededRestaurants as any[]) {
            const listingId = String(row.claimedFromImportId || "");
            if (!purgeableListingIds.includes(listingId)) continue;
            if (restaurantIdsWithBookings.has(String(row.id))) {
              blocked.push({
                listingId,
                reason: "has_booking",
              });
              continue;
            }
            // If a restaurant is already owned by a real user (not system, not invited), require force.
            const isSystemOrInvited =
              String(row.ownerId) === String(importSystemUserId) ||
              listings.some(
                (l: any) =>
                  String(l.id) === listingId &&
                  l.invitedUserId &&
                  String(l.invitedUserId) === String(row.ownerId),
              );
            if (!isSystemOrInvited && !force) {
              blocked.push({
                listingId,
                reason: "owned_by_user",
              });
              continue;
            }
            restaurantIdsToDelete.push(String(row.id));
          }

          if (restaurantIdsToDelete.length > 0) {
            const deleted = await tx
              .delete(restaurants)
              .where(inArray(restaurants.id, restaurantIdsToDelete))
              .returning({ id: restaurants.id });
            deletedRestaurants = deleted.length;
          }

          const deletableListingIds = purgeableListingIds.filter((id) => {
            // If we blocked restaurant deletion due to bookings/ownership and the listing is linked, keep it.
            const hasBlocked = blocked.some((b) => b.listingId === id);
            return !hasBlocked;
          });

          if (deletableListingIds.length > 0) {
            const deleted = await tx
              .delete(truckImportListings)
              .where(inArray(truckImportListings.id, deletableListingIds))
              .returning({ id: truckImportListings.id });
            deletedListings = deleted.length;
          }
        });

        res.json({
          batchId,
          fileName: batch.fileName,
          totalListings: listings.length,
          deletedListings,
          deletedRestaurants,
          deletedClaimRequests,
          blocked,
          force,
        });

        // Hide this batch from the default Recent Imports list so staff don't keep re-purging the same file.
        try {
          await db
            .update(truckImportBatches)
            .set({
              purgedAt: new Date(),
              purgedBy: req.user?.id ?? null,
              updatedAt: new Date(),
            })
            .where(eq(truckImportBatches.id, batchId));
        } catch (markError) {
          console.error("Failed to mark import batch as purged:", markError);
        }
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_batches") ||
          isMissingRelationError(error, "truck_import_listings")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error purging truck import batch:", error);
        res.status(500).json({
          message: error.message || "Failed to purge import batch",
        });
      }
    },
  );

  app.get(
    "/api/admin/truck-imports/:batchId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        await ensureTruckImportTables();

        const batchId = String(req.params.batchId || "").trim();
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query?.limit ?? 50)),
        );
        const offset = Math.max(0, Number(req.query?.offset ?? 0));
        if (!batchId)
          return res.status(400).json({ message: "Batch ID required" });

        const [batch] = await db
          .select()
          .from(truckImportBatches)
          .where(eq(truckImportBatches.id, batchId))
          .limit(1);
        if (!batch) return res.status(404).json({ message: "Batch not found" });

        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId));

        const statusCounts = await db
          .select({
            status: truckImportListings.status,
            count: sql<number>`count(*)`,
          })
          .from(truckImportListings)
          .where(eq(truckImportListings.batchId, batchId))
          .groupBy(truckImportListings.status);

        const seededRestaurantCounts = await db
          .select({ count: sql<number>`count(*)` })
          .from(restaurants)
          .innerJoin(
            truckImportListings,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId));

        const claimRequestCounts = await db
          .select({ count: sql<number>`count(*)` })
          .from(truckClaimRequests)
          .innerJoin(
            truckImportListings,
            eq(truckClaimRequests.listingId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId));

        const listingRows = await db
          .select({
            listing: truckImportListings,
            restaurantId: restaurants.id,
            restaurantOwnerId: restaurants.ownerId,
          })
          .from(truckImportListings)
          .leftJoin(
            restaurants,
            eq(restaurants.claimedFromImportId, truckImportListings.id),
          )
          .where(eq(truckImportListings.batchId, batchId))
          .orderBy(desc(truckImportListings.confidenceScore))
          .limit(limit)
          .offset(offset);

        res.json({
          batch,
          total: Number(total ?? 0),
          statusCounts: statusCounts.map((row: any) => ({
            status: row.status,
            count: Number(row.count ?? 0),
          })),
          seededRestaurants: Number(seededRestaurantCounts?.[0]?.count ?? 0),
          claimRequests: Number(claimRequestCounts?.[0]?.count ?? 0),
          rows: listingRows.map((row: any) => ({
            ...row.listing,
            restaurantId: row.restaurantId ?? null,
            restaurantOwnerId: row.restaurantOwnerId ?? null,
          })),
          limit,
          offset,
        });
      } catch (error: any) {
        if (
          isMissingRelationError(error, "truck_import_batches") ||
          isMissingRelationError(error, "truck_import_listings")
        ) {
          return res.status(503).json({
            message:
              "Truck import tables are missing in the database. Run `npm run migrate:sql -- 042_create_truck_import_tables.sql`.",
            code: "migration_required",
          });
        }
        console.error("Error fetching import batch details:", error);
        res.status(500).json({ message: "Failed to fetch batch details" });
      }
    },
  );

  app.get(
    "/api/admin/affiliates/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const allUsers = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            userType: users.userType,
            affiliateTag: users.affiliateTag,
            affiliatePercent: users.affiliatePercent,
            affiliateCloserUserId: users.affiliateCloserUserId,
            affiliateBookerUserId: users.affiliateBookerUserId,
            stripeSubscriptionId: users.stripeSubscriptionId,
          })
          .from(users)
          .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)))
          .orderBy(users.createdAt);

        const shareCounts = await db
          .select({
            affiliateUserId: affiliateShareEvents.affiliateUserId,
            count: sql<number>`count(*)`,
          })
          .from(affiliateShareEvents)
          .groupBy(affiliateShareEvents.affiliateUserId);

        type ShareCountRow = {
          affiliateUserId: string | null;
          count: number | string | null;
        };
        const shareCountMap = new Map(
          (shareCounts as ShareCountRow[]).map((row) => [
            row.affiliateUserId,
            Number(row.count ?? 0),
          ]),
        );

        const commissionSums = await db
          .select({
            affiliateUserId: affiliateCommissionLedger.affiliateUserId,
            earnedCents: sql<number>`coalesce(sum(${affiliateCommissionLedger.amount}), 0)`,
            revenueCents: sql<number>`coalesce(sum(${affiliateCommissionLedger.sourceAmountCents}), 0)`,
            subscriptionRevenueCents: sql<number>`coalesce(sum(case when ${affiliateCommissionLedger.commissionSource} = 'subscription_payment' then ${affiliateCommissionLedger.sourceAmountCents} else 0 end), 0)`,
            bookingRevenueCents: sql<number>`coalesce(sum(case when ${affiliateCommissionLedger.commissionSource} in ('booking_fee_host', 'booking_fee_truck') then ${affiliateCommissionLedger.sourceAmountCents} else 0 end), 0)`,
          })
          .from(affiliateCommissionLedger)
          .groupBy(affiliateCommissionLedger.affiliateUserId);

        type CommissionSumRow = {
          affiliateUserId: string | null;
          earnedCents: number | string | null;
          revenueCents: number | string | null;
          subscriptionRevenueCents: number | string | null;
          bookingRevenueCents: number | string | null;
        };
        const commissionMap = new Map(
          (commissionSums as CommissionSumRow[]).map((row) => [
            row.affiliateUserId,
            row,
          ]),
        );

        const referralRows = await db
          .select({
            id: users.id,
            affiliateCloserUserId: users.affiliateCloserUserId,
            affiliateBookerUserId: users.affiliateBookerUserId,
            stripeSubscriptionId: users.stripeSubscriptionId,
          })
          .from(users)
          .where(
            and(
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              or(
                sql`${users.affiliateCloserUserId} is not null`,
                sql`${users.affiliateBookerUserId} is not null`,
              ),
            ),
          );

        const truckOwnerRows = await db
          .select({ ownerId: restaurants.ownerId })
          .from(eventBookings)
          .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id));

        const hostOwnerRows = await db
          .select({ ownerId: hosts.userId })
          .from(eventBookings)
          .innerJoin(hosts, eq(eventBookings.hostId, hosts.id));

        const bookingOwnerIds = new Set<string>();
        for (const row of truckOwnerRows) {
          if (row.ownerId) bookingOwnerIds.add(row.ownerId);
        }
        for (const row of hostOwnerRows) {
          if (row.ownerId) bookingOwnerIds.add(row.ownerId);
        }

        const referredMap = new Map<string, Set<string>>();
        const paidMap = new Map<string, Set<string>>();
        for (const row of referralRows) {
          const referrerIds = [
            row.affiliateCloserUserId,
            row.affiliateBookerUserId,
          ].filter((value): value is string => Boolean(value));
          if (referrerIds.length === 0) continue;

          for (const referrerId of referrerIds) {
            if (!referredMap.has(referrerId)) {
              referredMap.set(referrerId, new Set());
            }
            referredMap.get(referrerId)?.add(row.id);

            const isPaid =
              Boolean(row.stripeSubscriptionId) || bookingOwnerIds.has(row.id);
            if (isPaid) {
              if (!paidMap.has(referrerId)) {
                paidMap.set(referrerId, new Set());
              }
              paidMap.get(referrerId)?.add(row.id);
            }
          }
        }

        const payload = allUsers.map((user: (typeof allUsers)[number]) => {
          const commissions = commissionMap.get(user.id as string);
          const referred = referredMap.get(user.id);
          const paid = paidMap.get(user.id);

          return {
            ...user,
            linksShared: shareCountMap.get(user.id) ?? 0,
            peopleReferred: referred?.size ?? 0,
            paidReferrals: paid?.size ?? 0,
            affiliateEarningsCents: Number(commissions?.earnedCents ?? 0),
            mealScoutRevenueCents: Number(commissions?.revenueCents ?? 0),
            subscriptionRevenueCents: Number(
              commissions?.subscriptionRevenueCents ?? 0,
            ),
            bookingRevenueCents: Number(commissions?.bookingRevenueCents ?? 0),
          };
        });

        res.json(payload);
      } catch (error: any) {
        console.error("Error fetching affiliate users:", error);
        res.status(500).json({ message: "Failed to fetch affiliate users" });
      }
    },
  );

  app.patch(
    "/api/admin/affiliates/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const targetUserId = req.params.id;
        const {
          affiliatePercent,
          affiliateCloserUserId,
          affiliateBookerUserId,
        } = req.body || {};

        const updates: any = {};
        if (affiliatePercent !== undefined) {
          const parsed = Number(affiliatePercent);
          if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
            return res
              .status(400)
              .json({ message: "affiliatePercent must be 0-100" });
          }
          updates.affiliatePercent = parsed;
        }

        if (affiliateCloserUserId !== undefined) {
          const closerId =
            affiliateCloserUserId === null || affiliateCloserUserId === ""
              ? null
              : String(affiliateCloserUserId);
          updates.affiliateCloserUserId = closerId;

          // Snapshot the closer's current percent so future affiliatePercent edits
          // do not change earnings for already-attributed users.
          if (closerId) {
            const [closer] = await db
              .select({ affiliatePercent: users.affiliatePercent })
              .from(users)
              .where(eq(users.id, closerId))
              .limit(1);
            updates.affiliateCloserPercent = Math.max(
              Number(closer?.affiliatePercent ?? 5),
              0,
            );
          } else {
            updates.affiliateCloserPercent = null;
          }
        }

        if (affiliateBookerUserId !== undefined) {
          const bookerId =
            affiliateBookerUserId === null || affiliateBookerUserId === ""
              ? null
              : String(affiliateBookerUserId);
          updates.affiliateBookerUserId = bookerId;

          // Snapshot the booker's current percent for the same reason as closer.
          if (bookerId) {
            const [booker] = await db
              .select({ affiliatePercent: users.affiliatePercent })
              .from(users)
              .where(eq(users.id, bookerId))
              .limit(1);
            updates.affiliateBookerPercent = Math.max(
              Number(booker?.affiliatePercent ?? 5),
              0,
            );
          } else {
            updates.affiliateBookerPercent = null;
          }
        }

        if (Object.keys(updates).length === 0) {
          return res
            .status(400)
            .json({ message: "No affiliate fields to update" });
        }

        updates.updatedAt = new Date();

        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, targetUserId))
          .returning();

        if (!updated) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({
          id: updated.id,
          affiliatePercent: updated.affiliatePercent,
          affiliateCloserUserId: updated.affiliateCloserUserId,
          affiliateBookerUserId: updated.affiliateBookerUserId,
          affiliateCloserPercent:
            (updated as any).affiliateCloserPercent ?? null,
          affiliateBookerPercent:
            (updated as any).affiliateBookerPercent ?? null,
        });
      } catch (error: any) {
        console.error("Error updating affiliate settings:", error);
        res
          .status(500)
          .json({ message: "Failed to update affiliate settings" });
      }
    },
  );

  // Affiliate payout queue (manual payouts)
  app.get(
    "/api/admin/affiliate-payouts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const status =
          typeof req.query?.status === "string" ? req.query.status : null;
        const baseQuery = db
          .select({
            id: affiliateWithdrawals.id,
            userId: affiliateWithdrawals.userId,
            amount: affiliateWithdrawals.amount,
            method: affiliateWithdrawals.method,
            status: affiliateWithdrawals.status,
            methodDetails: affiliateWithdrawals.methodDetails,
            creditLedgerId: affiliateWithdrawals.creditLedgerId,
            requestedAt: affiliateWithdrawals.requestedAt,
            processedAt: affiliateWithdrawals.processedAt,
            approvedAt: affiliateWithdrawals.approvedAt,
            approvedBy: affiliateWithdrawals.approvedBy,
            paidAt: affiliateWithdrawals.paidAt,
            rejectedAt: affiliateWithdrawals.rejectedAt,
            notes: affiliateWithdrawals.notes,
            userEmail: users.email,
            userFirstName: users.firstName,
            userLastName: users.lastName,
          })
          .from(affiliateWithdrawals)
          .innerJoin(users, eq(affiliateWithdrawals.userId, users.id));

        const rows = status
          ? await baseQuery
              .where(eq(affiliateWithdrawals.status, status))
              .orderBy(desc(affiliateWithdrawals.requestedAt))
          : await baseQuery.orderBy(desc(affiliateWithdrawals.requestedAt));

        res.json(rows);
      } catch (error: any) {
        console.error("Error fetching affiliate payouts:", error);
        res.status(500).json({ message: "Failed to fetch payout requests" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status !== "pending") {
          return res.status(409).json({ message: "Payout is not pending" });
        }

        const [updated] = await db
          .update(affiliateWithdrawals)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedBy: req.user.id,
          })
          .where(eq(affiliateWithdrawals.id, payoutId))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error approving affiliate payout:", error);
        res.status(500).json({ message: "Failed to approve payout" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/mark-paid",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status === "paid") {
          return res
            .status(409)
            .json({ message: "Payout already marked paid" });
        }
        if (existing.status === "rejected") {
          return res.status(409).json({ message: "Payout was rejected" });
        }

        const [updated] = await db
          .update(affiliateWithdrawals)
          .set({
            status: "paid",
            paidAt: new Date(),
            processedAt: new Date(),
          })
          .where(eq(affiliateWithdrawals.id, payoutId))
          .returning();

        if (existing.creditLedgerId) {
          await db
            .update(creditLedger)
            .set({
              redeemedFor: "cash_payout",
              redeemedAt: new Date(),
            })
            .where(eq(creditLedger.id, existing.creditLedgerId));
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error marking affiliate payout paid:", error);
        res.status(500).json({ message: "Failed to mark payout paid" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const reason =
          typeof req.body?.reason === "string" ? req.body.reason : null;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status === "paid") {
          return res.status(409).json({ message: "Payout already paid" });
        }
        if (existing.status === "rejected") {
          return res.status(409).json({ message: "Payout already rejected" });
        }

        const amountNum = parseFloat(existing.amount?.toString() || "0");

        await db.transaction(async (tx: any) => {
          await tx
            .update(affiliateWithdrawals)
            .set({
              status: "rejected",
              rejectedAt: new Date(),
              notes: reason || existing.notes,
            })
            .where(eq(affiliateWithdrawals.id, payoutId));

          const reversalExists = (
            await tx
              .select({ id: creditLedger.id })
              .from(creditLedger)
              .where(
                and(
                  eq(creditLedger.userId, existing.userId),
                  eq(creditLedger.sourceType, "cash_payout_reversal"),
                  eq(creditLedger.sourceId, payoutId),
                ),
              )
              .limit(1)
          )[0];

          if (!reversalExists && amountNum > 0) {
            await tx.insert(creditLedger).values({
              userId: existing.userId,
              amount: amountNum.toString(),
              sourceType: "cash_payout_reversal",
              sourceId: payoutId,
            });
          }

          if (existing.creditLedgerId) {
            await tx
              .update(creditLedger)
              .set({ redeemedFor: "cash_payout_rejected" })
              .where(eq(creditLedger.id, existing.creditLedgerId));
          }
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error("Error rejecting affiliate payout:", error);
        res.status(500).json({ message: "Failed to reject payout" });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/resend-verification",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!user.email) {
          return res.status(400).json({ message: "User has no email address" });
        }
        if (user.emailVerified) {
          return res.status(400).json({ message: "Email is already verified" });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await storage.createEmailVerificationToken({
          userId: user.id,
          tokenHash,
          expiresAt,
          requestIp: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.get("User-Agent") || undefined,
        });

        const apiBaseUrl =
          `${req.protocol}://${req.get("host")}` ||
          process.env.PUBLIC_BASE_URL ||
          "http://localhost:5000";
        const verifyUrl = `${apiBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(
          token,
        )}`;

        await emailService.sendEmailVerificationEmail(user, verifyUrl);

        res.json({ message: "Verification email sent" });
      } catch (error: any) {
        console.error("Error resending verification email:", error);
        res.status(500).json({
          message: error.message || "Failed to resend verification email",
        });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/verify",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const updated = await storage.updateUser(user.id, {
          emailVerified: true,
        });
        res.json(sanitizeUser(updated, { includeStripe: true }));
      } catch (error: any) {
        console.error("Error verifying user:", error);
        res.status(500).json({
          message: error.message || "Failed to verify user",
        });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/send-subscription-link",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!user.email) {
          return res.status(400).json({ message: "User has no email address" });
        }

        const baseUrl =
          process.env.CLIENT_ORIGIN ||
          process.env.PUBLIC_BASE_URL ||
          "http://localhost:5000";
        const subscribeUrl = `${baseUrl}/subscribe`;
        const subject = "MealScout Monthly Subscription";
        const html = `
          <p>Hi ${user.firstName || "there"},</p>
          <p>Use the link below to sign up for MealScout monthly subscriptions:</p>
          <p><a href="${subscribeUrl}">Subscribe now</a></p>
          <p>If the link doesn't work, copy and paste this URL:</p>
          <p>${subscribeUrl}</p>
        `;
        const text = `Use this link to sign up for MealScout monthly subscriptions: ${subscribeUrl}`;

        await emailService.sendBasicEmail(user.email, subject, html, text);
        res.json({ message: "Subscription link sent" });
      } catch (error: any) {
        console.error("Error sending subscription link:", error);
        res.status(500).json({
          message: error.message || "Failed to send subscription link",
        });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const userId = req.params.id;
        const {
          email,
          firstName,
          lastName,
          phone,
          postalCode,
          birthYear,
          gender,
          isActive,
          emailVerified,
          userType,
        } = req.body || {};

        const updates: any = {};
        if (email !== undefined) {
          updates.email = String(email).trim().toLowerCase();
        }
        if (firstName !== undefined) {
          updates.firstName = String(firstName).trim();
        }
        if (lastName !== undefined) {
          updates.lastName = String(lastName).trim();
        }
        if (phone !== undefined) {
          updates.phone = String(phone).trim();
        }
        if (postalCode !== undefined) {
          updates.postalCode = String(postalCode).trim();
        }
        if (birthYear !== undefined && birthYear !== null && birthYear !== "") {
          updates.birthYear = Number(birthYear);
        }
        if (gender !== undefined) {
          updates.gender = String(gender).trim() || null;
        }
        if (isActive !== undefined) {
          updates.isActive = Boolean(isActive);
        }
        if (emailVerified !== undefined) {
          updates.emailVerified = Boolean(emailVerified);
        }

        if (userType) {
          const allowedTypes = [
            "customer",
            "restaurant_owner",
            "food_truck",
            "host",
            "event_coordinator",
            "staff",
            "admin",
            "super_admin",
          ];
          if (!allowedTypes.includes(userType)) {
            return res.status(400).json({ message: "Invalid user type" });
          }
          if (req.user?.userType === "staff") {
            if (userType === "admin" || userType === "super_admin") {
              return res.status(403).json({
                message: "Staff cannot assign admin roles",
              });
            }
          }
          await storage.updateUserType(userId, userType);
        }

        const updated = Object.keys(updates).length
          ? await storage.updateUser(userId, updates)
          : await storage.getUser(userId);

        if (!updated) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(sanitizeUser(updated, { includeStripe: true }));
      } catch (error: any) {
        console.error("Error updating user info:", error);
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "Email or phone already in use",
          });
        }
        res.status(500).json({
          message: error.message || "Failed to update user",
        });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/parking-pass",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hosts = await storage.getHostsByUserId(req.params.id);
        if (!hosts.length) {
          return res.json([]);
        }

        // Ensure every host has a draft Parking Pass series so pricing can be edited.
        await Promise.all(
          hosts.map((host) => storage.ensureDraftParkingPassForHost(host.id)),
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const hostIds = hosts.map((host) => host.id);
        const { occurrences } = await listParkingPassOccurrences({
          hostIds,
          horizonDays: 30,
          includeDraft: true,
          start: today,
        });

        const occurrencesByHost = new Map<string, any[]>();
        for (const row of occurrences) {
          const list = occurrencesByHost.get(row.hostId) ?? [];
          list.push(row);
          occurrencesByHost.set(row.hostId, list);
        }

        const listings = hosts.flatMap((host) => {
          const hostOccurrences = occurrencesByHost.get(host.id) ?? [];
          if (!hostOccurrences.length) return [];
          const sorted = [...hostOccurrences].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          const upcoming = sorted.find(
            (event) => new Date(event.date) >= today,
          );
          const representative = upcoming ?? sorted[0];

          return [
            {
              ...representative,
              host,
              nextDate: upcoming?.date ?? representative.date,
              occurrenceCount: sorted.length,
              publicReady: isParkingPassPublicReady(representative),
              qualityFlags: computeParkingPassQualityFlags(representative),
            },
          ];
        });

        res.json(listings);
      } catch (error) {
        console.error("Error fetching parking pass listings:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch parking pass listings" });
      }
    },
  );

  app.patch(
    "/api/admin/parking-pass/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const eventId = req.params.id;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Parking pass not found" });
        }
        const host = event.hostId ? await storage.getHost(event.hostId) : null;

        const updates: any = {};
        const fields = [
          "startTime",
          "endTime",
          "maxTrucks",
          "status",
          "breakfastPriceCents",
          "lunchPriceCents",
          "dinnerPriceCents",
          "dailyPriceCents",
          "weeklyPriceCents",
          "monthlyPriceCents",
        ];
        for (const field of fields) {
          if (req.body?.[field] === undefined) continue;
          if (
            field === "startTime" ||
            field === "endTime" ||
            field === "status"
          ) {
            updates[field] = req.body[field];
          } else {
            updates[field] = Number(req.body[field]);
          }
        }

        if (updates.startTime && updates.endTime) {
          const [startHour, startMinute] = String(updates.startTime)
            .split(":")
            .map(Number);
          const [endHour, endMinute] = String(updates.endTime)
            .split(":")
            .map(Number);
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = endHour * 60 + endMinute;
          if (endMinutes <= startMinutes) {
            return res
              .status(400)
              .json({ message: "End time must be after start time" });
          }
        }

        if (updates.maxTrucks !== undefined && updates.maxTrucks < 1) {
          return res
            .status(400)
            .json({ message: "Max trucks must be at least 1" });
        }

        const breakfast = Number(
          updates.breakfastPriceCents ?? event.breakfastPriceCents ?? 0,
        );
        const lunch = Number(
          updates.lunchPriceCents ?? event.lunchPriceCents ?? 0,
        );
        const dinner = Number(
          updates.dinnerPriceCents ?? event.dinnerPriceCents ?? 0,
        );
        const dailyExisting = Number(event.dailyPriceCents ?? 0);
        const weeklyExisting = Number(event.weeklyPriceCents ?? 0);
        const monthlyExisting = Number(event.monthlyPriceCents ?? 0);
        const dailyCandidate =
          updates.dailyPriceCents !== undefined
            ? Number(updates.dailyPriceCents)
            : dailyExisting;
        const weeklyCandidate =
          updates.weeklyPriceCents !== undefined
            ? Number(updates.weeklyPriceCents)
            : weeklyExisting;
        const monthlyCandidate =
          updates.monthlyPriceCents !== undefined
            ? Number(updates.monthlyPriceCents)
            : monthlyExisting;
        const slotSum = breakfast + lunch + dinner;
        const dailyOverride =
          updates.dailyPriceCents !== undefined
            ? Number(updates.dailyPriceCents)
            : null;
        const weeklyOverride =
          updates.weeklyPriceCents !== undefined
            ? Number(updates.weeklyPriceCents)
            : null;
        const monthlyOverride =
          updates.monthlyPriceCents !== undefined
            ? Number(updates.monthlyPriceCents)
            : null;
        let baseDaily =
          dailyOverride ??
          (slotSum > 0 ? slotSum : (event.dailyPriceCents ?? 0));
        if (baseDaily <= 0) {
          if (weeklyOverride && weeklyOverride > 0) {
            baseDaily = Math.round(weeklyOverride / 7);
          } else if (monthlyOverride && monthlyOverride > 0) {
            baseDaily = Math.round(monthlyOverride / 30);
          }
        }
        const hostPriceCents = slotSum > 0 ? slotSum : baseDaily;
        const pricingUpdates = {
          hostPriceCents: hostPriceCents || event.hostPriceCents || 0,
          dailyPriceCents: baseDaily,
          weeklyPriceCents:
            weeklyOverride ??
            (baseDaily > 0 ? baseDaily * 7 : (event.weeklyPriceCents ?? 0)),
          monthlyPriceCents:
            monthlyOverride ??
            (baseDaily > 0 ? baseDaily * 30 : (event.monthlyPriceCents ?? 0)),
          requiresPayment: true,
          updatedAt: new Date(),
        };

        if (event.seriesId) {
          const seriesUpdates: any = { updatedAt: new Date() };
          if (updates.startTime !== undefined) {
            seriesUpdates.defaultStartTime = String(updates.startTime);
          }
          if (updates.endTime !== undefined) {
            seriesUpdates.defaultEndTime = String(updates.endTime);
          }
          if (updates.maxTrucks !== undefined) {
            seriesUpdates.defaultMaxTrucks = Number(updates.maxTrucks);
          }
          const pricingTouched = [
            "breakfastPriceCents",
            "lunchPriceCents",
            "dinnerPriceCents",
            "dailyPriceCents",
            "weeklyPriceCents",
            "monthlyPriceCents",
          ].some((field) => req.body?.[field] !== undefined);
          if (pricingTouched) {
            seriesUpdates.defaultBreakfastPriceCents = breakfast;
            seriesUpdates.defaultLunchPriceCents = lunch;
            seriesUpdates.defaultDinnerPriceCents = dinner;
            seriesUpdates.defaultDailyPriceCents = baseDaily;
            seriesUpdates.defaultWeeklyPriceCents =
              pricingUpdates.weeklyPriceCents;
            seriesUpdates.defaultMonthlyPriceCents =
              pricingUpdates.monthlyPriceCents;
            seriesUpdates.defaultHostPriceCents = hostPriceCents;

            // Simple model: mirror Parking Pass defaults back onto the host row as the source of truth.
            // This is best-effort because older DBs may not have these columns yet.
            try {
              if (host?.id) {
                await db
                  .update(hosts)
                  .set({
                    parkingPassBreakfastPriceCents: breakfast,
                    parkingPassLunchPriceCents: lunch,
                    parkingPassDinnerPriceCents: dinner,
                    parkingPassDailyPriceCents: baseDaily,
                    parkingPassWeeklyPriceCents:
                      pricingUpdates.weeklyPriceCents,
                    parkingPassMonthlyPriceCents:
                      pricingUpdates.monthlyPriceCents,
                    parkingPassStartTime: String(
                      updates.startTime ?? event.startTime ?? "",
                    ),
                    parkingPassEndTime: String(
                      updates.endTime ?? event.endTime ?? "",
                    ),
                    updatedAt: new Date(),
                  } as any)
                  .where(eq(hosts.id, host.id));
              }
            } catch (e) {
              console.warn("Failed to persist host parking pass defaults:", e);
            }

            const publicReady =
              host &&
              isParkingPassPublicReady({
                host,
                startTime: updates.startTime ?? event.startTime,
                endTime: updates.endTime ?? event.endTime,
                maxTrucks: updates.maxTrucks ?? event.maxTrucks,
                breakfastPriceCents: breakfast,
                lunchPriceCents: lunch,
                dinnerPriceCents: dinner,
                dailyPriceCents: baseDaily,
                weeklyPriceCents: pricingUpdates.weeklyPriceCents,
                monthlyPriceCents: pricingUpdates.monthlyPriceCents,
              });

            seriesUpdates.status = publicReady ? "published" : "draft";
            seriesUpdates.publishedAt = publicReady ? new Date() : null;
          }
          if (Object.keys(seriesUpdates).length > 1) {
            await db
              .update(eventSeries)
              .set(seriesUpdates)
              .where(eq(eventSeries.id, event.seriesId));
          }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const scope = event.seriesId
          ? eq(events.seriesId, event.seriesId)
          : eq(events.hostId, event.hostId);

        const updatedEvents = await db
          .update(events)
          .set({ ...updates, ...pricingUpdates })
          .where(
            and(
              scope,
              gte(events.date, today),
              eq(events.requiresPayment, true),
            ),
          )
          .returning();

        let updated = updatedEvents[0];
        if (!updated) {
          const [singleUpdated] = await db
            .update(events)
            .set({ ...updates, ...pricingUpdates })
            .where(eq(events.id, eventId))
            .returning();
          updated = singleUpdated;
        }

        void logAudit(
          req.user?.id || "",
          "admin_parking_pass_updated",
          "parking_pass",
          String(eventId),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            seriesId: event.seriesId,
            hostId: event.hostId,
            fields: Object.keys(updates),
            pricingFields: Object.keys(pricingUpdates),
          },
        ).catch((err) =>
          console.error("Failed to write admin parking pass audit log:", err),
        );

        res.json(updated ?? event);
      } catch (error: any) {
        console.error("Error updating parking pass:", error);
        res.status(500).json({
          message: error.message || "Failed to update parking pass",
        });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/backfill",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        // Ensures every host row has a draft parking pass series, so pricing can be edited immediately.
        const created = await storage.ensureDraftParkingPassesForHosts();
        res.json({ success: true, created });
      } catch (error: any) {
        console.error("Error backfilling parking pass series:", error);
        res
          .status(500)
          .json({ message: "Failed to backfill parking pass series" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/sync-host-defaults",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const seriesRows = await storage.getParkingPassSeriesSafe();
        let updatedHosts = 0;
        const touchedHostIds = new Set<string>();

        for (const series of seriesRows as any[]) {
          const hostId = String(series?.hostId || "").trim();
          if (!hostId) continue;

          const breakfast =
            Number(series?.defaultBreakfastPriceCents ?? 0) || 0;
          const lunch = Number(series?.defaultLunchPriceCents ?? 0) || 0;
          const dinner = Number(series?.defaultDinnerPriceCents ?? 0) || 0;
          const daily = Number(series?.defaultDailyPriceCents ?? 0) || 0;
          const weekly = Number(series?.defaultWeeklyPriceCents ?? 0) || 0;
          const monthly = Number(series?.defaultMonthlyPriceCents ?? 0) || 0;

          try {
            await db
              .update(hosts)
              .set({
                parkingPassBreakfastPriceCents: breakfast,
                parkingPassLunchPriceCents: lunch,
                parkingPassDinnerPriceCents: dinner,
                parkingPassDailyPriceCents: daily,
                parkingPassWeeklyPriceCents: weekly,
                parkingPassMonthlyPriceCents: monthly,
                parkingPassStartTime: series?.defaultStartTime ?? null,
                parkingPassEndTime: series?.defaultEndTime ?? null,
                parkingPassDaysOfWeek: series?.parkingPassDaysOfWeek ?? [],
                updatedAt: new Date(),
              } as any)
              .where(eq(hosts.id, hostId));
            updatedHosts += 1;
            touchedHostIds.add(hostId);
          } catch (e: any) {
            // If the migration hasn't run yet, fail with a clear message.
            const msg = String(e?.message || "");
            if (msg.includes("parking_pass_breakfast_price_cents")) {
              return res.status(503).json({
                message:
                  "Host parking pass pricing columns are missing. Run migration 071_add_hosts_parking_pass_pricing.sql and retry.",
                code: "migration_required",
              });
            }
            console.warn("sync-host-defaults: failed updating host:", e);
          }
        }

        // Ensure series status reflects host defaults.
        let syncedSeries = 0;
        for (const hostId of touchedHostIds) {
          const seriesId = await storage.syncParkingPassSeriesFromHost(hostId);
          if (seriesId) syncedSeries += 1;
        }

        res.json({
          success: true,
          updatedHosts,
          syncedSeries,
        });
      } catch (error: any) {
        console.error("Error syncing host parking pass defaults:", error);
        res
          .status(500)
          .json({ message: "Failed to sync host parking pass defaults" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/normalize-series",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        let rows: Array<{ series: any }> = [];
        try {
          rows = await db
            .select({ series: eventSeries })
            .from(eventSeries)
            .where(eq(eventSeries.seriesType, "parking_pass"));
        } catch (error) {
          // Degrade gracefully if event_series schema drifts (Drizzle selects all columns).
          console.warn(
            "normalize-series: falling back to safe event_series projection:",
            error,
          );
          const safe = await storage.getParkingPassSeriesSafe();
          rows = safe.map((series: any) => ({ series }));
        }

        const hostIds = Array.from(
          new Set<string>(
            rows
              .map((row: any) => String(row.series?.hostId || "").trim())
              .filter(Boolean),
          ),
        );
        const hostRows = await storage.getHostsByIds(hostIds);
        const hostById = new Map<string, any>(
          (hostRows || []).map((host: any) => [host.id, host]),
        );

        let updated = 0;
        for (const row of rows as any[]) {
          const series = row.series;
          const host = hostById.get(String(series.hostId || "").trim()) ?? null;
          const listing = {
            host,
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            breakfastPriceCents: series.defaultBreakfastPriceCents,
            lunchPriceCents: series.defaultLunchPriceCents,
            dinnerPriceCents: series.defaultDinnerPriceCents,
            dailyPriceCents: series.defaultDailyPriceCents,
            weeklyPriceCents: series.defaultWeeklyPriceCents,
            monthlyPriceCents: series.defaultMonthlyPriceCents,
          };
          const publicReady = isParkingPassPublicReady(listing);
          const nextStatus = publicReady ? "published" : "draft";

          if (String(series.status) !== nextStatus) {
            await db
              .update(eventSeries)
              .set({
                status: nextStatus as any,
                publishedAt: publicReady
                  ? (series.publishedAt ?? new Date())
                  : null,
                updatedAt: new Date(),
              })
              .where(eq(eventSeries.id, series.id));
            updated += 1;
          }
        }

        res.json({ success: true, updated });
      } catch (error: any) {
        console.error("Error normalizing parking pass series:", error);
        res
          .status(500)
          .json({ message: "Failed to normalize parking pass series" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/integrity/run",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const dryRun = Boolean(req.body?.dryRun);
        const result = await runParkingPassIntegrity({ dryRun });
        res.json({ success: true, ...result });
      } catch (error: any) {
        console.error("Error running parking pass integrity:", error);
        res.status(500).json({ message: "Failed to run integrity job" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const { isActive } = req.body;
        await storage.updateUserStatus(req.params.id, isActive);
        res.json({ message: "User status updated successfully" });
      } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).json({ message: "Failed to update user status" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id/type",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const { userType } = req.body;
        const allowedTypes = [
          "customer",
          "restaurant_owner",
          "food_truck",
          "host",
          "event_coordinator",
          "staff",
          "admin",
          "super_admin",
        ];

        if (!allowedTypes.includes(userType)) {
          return res.status(400).json({ message: "Invalid user type" });
        }

        await storage.updateUserType(req.params.id, userType);
        res.json({ message: "User type updated successfully" });
      } catch (error) {
        console.error("Error updating user type:", error);
        res.status(500).json({ message: "Failed to update user type" });
      }
    },
  );

  app.get(
    "/api/admin/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        // Enrich hosts with their rep (user) for admin tooling.
        // If the join fails due to schema drift, fall back to plain hosts.
        try {
          const rows = await db
            .select({
              host: hosts,
              user: users,
            })
            .from(hosts)
            .leftJoin(users, eq(hosts.userId, users.id))
            .orderBy(desc(hosts.createdAt));

          const referrerIds = Array.from(
            new Set<string>(
              rows
                .flatMap((row: any) => [
                  row?.user?.affiliateCloserUserId,
                  row?.user?.affiliateBookerUserId,
                ])
                .filter(
                  (value: any) =>
                    typeof value === "string" && value.trim().length > 0,
                ),
            ),
          );
          const referrerById = new Map<string, any>();
          if (referrerIds.length > 0) {
            const referrers = await db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                phone: users.phone,
                userType: users.userType,
                affiliateTag: users.affiliateTag,
              })
              .from(users)
              .where(inArray(users.id, referrerIds));
            for (const u of referrers as any[]) {
              referrerById.set(String(u.id), u);
            }
          }

          res.json(
            rows.map((row: any) => ({
              ...row.host,
              rep: row.user
                ? {
                    id: row.user.id,
                    firstName: row.user.firstName,
                    lastName: row.user.lastName,
                    email: row.user.email,
                    phone: row.user.phone,
                    userType: row.user.userType,
                    affiliateTag: row.user.affiliateTag,
                    affiliateCloserUserId: row.user.affiliateCloserUserId,
                    affiliateBookerUserId: row.user.affiliateBookerUserId,
                    referredByCloser: row.user.affiliateCloserUserId
                      ? (referrerById.get(
                          String(row.user.affiliateCloserUserId),
                        ) ?? null)
                      : null,
                    referredByBooker: row.user.affiliateBookerUserId
                      ? (referrerById.get(
                          String(row.user.affiliateBookerUserId),
                        ) ?? null)
                      : null,
                  }
                : null,
            })),
          );
          return;
        } catch (e) {
          console.warn("/api/admin/hosts join fallback:", e);
        }

        const allHosts = await storage.getAllHosts();
        res.json(allHosts);
      } catch (error) {
        console.error("Error fetching hosts:", error);
        res.status(500).json({ message: "Failed to fetch hosts" });
      }
    },
  );

  app.patch(
    "/api/admin/hosts/:hostId/coordinates",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostId = req.params.hostId;
        const lat = Number(req.body?.latitude);
        const lng = Number(req.body?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return res.status(400).json({ message: "Invalid coordinates" });
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return res.status(400).json({ message: "Invalid coordinates" });
        }

        const updated = await storage.updateHostCoordinates(hostId, lat, lng);
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating host coordinates:", error);
        res.status(500).json({ message: "Failed to update coordinates" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        await storage.deleteUser(req.params.id);
        res.json({ message: "User deleted successfully" });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ message: "Failed to delete user" });
      }
    },
  );

  app.get(
    "/api/admin/users/:userId/addresses",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const addresses = await storage.getUserAddresses(req.params.userId);
        res.json(addresses);
      } catch (error) {
        console.error("Error fetching user addresses:", error);
        res.status(500).json({ message: "Failed to fetch user addresses" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/addresses",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const address = await storage.createUserAddress({
          userId: req.params.userId,
          label: req.body?.label || "Address",
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          postalCode: req.body?.postalCode,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          type: req.body?.type || "other",
          isDefault: !!req.body?.isDefault,
        });

        if (req.body?.isDefault) {
          await storage.setDefaultAddress(req.params.userId, address.id);
        }
        await storage.syncHostFromUserAddress(
          req.params.userId,
          address,
          undefined,
          {
            force: true,
          },
        );

        res.json(address);
      } catch (error: any) {
        console.error("Error creating user address:", error);
        res.status(500).json({ message: "Failed to create address" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:userId/addresses/:addressId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const existing = await storage.getUserAddress(req.params.addressId);
        const updated = await storage.updateUserAddress(req.params.addressId, {
          label: req.body?.label,
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          postalCode: req.body?.postalCode,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          type: req.body?.type,
        });

        if (req.body?.isDefault) {
          await storage.setDefaultAddress(req.params.userId, updated.id);
        }
        if (existing) {
          await storage.syncHostFromUserAddress(
            req.params.userId,
            updated,
            existing,
            { force: true },
          );
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating user address:", error);
        res.status(500).json({ message: "Failed to update address" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/addresses/:addressId/default",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        await storage.setDefaultAddress(
          req.params.userId,
          req.params.addressId,
        );
        res.json({ message: "Default address updated" });
      } catch (error) {
        console.error("Error setting default address:", error);
        res.status(500).json({ message: "Failed to set default address" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:userId/addresses/:addressId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const existing = await storage.getUserAddress(req.params.addressId);
        await storage.deleteUserAddress(req.params.addressId);
        if (existing) {
          await storage.deleteHostForUserAddress(req.params.userId, existing);
        }
        res.json({ message: "Address deleted" });
      } catch (error) {
        console.error("Error deleting user address:", error);
        res.status(500).json({ message: "Failed to delete address" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = req.params.userId;
        const address = req.body?.address?.trim();
        const businessName = req.body?.businessName?.trim();

        if (!businessName || !address) {
          return res.status(400).json({
            message: "Business name and address are required.",
          });
        }

        const city = req.body?.city?.trim() || null;
        const state = req.body?.state?.trim() || null;
        const newKey = buildLocationKey(address, city, state);
        const existingHosts = await db
          .select({
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
          })
          .from(hosts)
          .where(eq(hosts.userId, userId));
        const hasDuplicate = existingHosts.some(
          (host: (typeof existingHosts)[number]) =>
            buildLocationKey(host.address, host.city, host.state) === newKey,
        );
        if (hasDuplicate) {
          return res.status(409).json({
            message: "This user already has a host location for that address.",
          });
        }

        const expectedFootTraffic =
          req.body?.expectedFootTraffic !== undefined &&
          req.body?.expectedFootTraffic !== null &&
          req.body?.expectedFootTraffic !== ""
            ? Number(req.body.expectedFootTraffic)
            : undefined;
        const spotCount =
          req.body?.spotCount !== undefined &&
          req.body?.spotCount !== null &&
          req.body?.spotCount !== ""
            ? Number(req.body.spotCount)
            : undefined;

        const parsed = insertHostSchema.parse({
          userId,
          businessName,
          address,
          city,
          state,
          locationType: req.body?.locationType || "other",
          expectedFootTraffic: Number.isFinite(expectedFootTraffic)
            ? expectedFootTraffic
            : undefined,
          contactPhone: req.body?.contactPhone || null,
          notes: req.body?.notes || null,
          amenities: req.body?.amenities,
          spotCount: Number.isFinite(spotCount) ? spotCount : undefined,
          isVerified: true,
          adminCreated: true,
          latitude:
            req.body?.latitude !== undefined && req.body?.latitude !== null
              ? req.body.latitude.toString()
              : undefined,
          longitude:
            req.body?.longitude !== undefined && req.body?.longitude !== null
              ? req.body.longitude.toString()
              : undefined,
        });

        const host = await storage.createHost(parsed);
        // Ensure the new host has draft Parking Pass events so pricing can be edited immediately.
        await storage.ensureDraftParkingPassForHost(host.id);
        res.status(201).json(host);
      } catch (error: any) {
        console.error("Error creating host location:", error);
        res.status(500).json({ message: "Failed to create host location" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        res.json(hostsForUser);
      } catch (error) {
        console.error("Error fetching user hosts:", error);
        res.status(500).json({ message: "Failed to fetch hosts" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/restaurants",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const restaurantsForUser = await storage.getRestaurantsByOwner(
          req.params.id,
        );
        res.json(restaurantsForUser);
      } catch (error) {
        console.error("Error fetching user restaurants:", error);
        res.status(500).json({ message: "Failed to fetch restaurants" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const ownedRestaurants = await storage.getRestaurantsByOwner(
          req.params.id,
        );
        if (!ownedRestaurants.length) {
          return res.json([]);
        }
        const restaurantIds = ownedRestaurants.map((r) => r.id);
        const userDeals = await db
          .select()
          .from(deals)
          .where(inArray(deals.restaurantId, restaurantIds))
          .orderBy(deals.createdAt);
        res.json(userDeals);
      } catch (error) {
        console.error("Error fetching user deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/events",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        if (!hostsForUser.length) {
          return res.json([]);
        }
        const hostIds = hostsForUser.map((h) => h.id);
        const userEvents = await db
          .select()
          .from(events)
          .where(inArray(events.hostId, hostIds))
          .orderBy(events.date);
        res.json(userEvents);
      } catch (error) {
        console.error("Error fetching user events:", error);
        res.status(500).json({ message: "Failed to fetch events" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/event-series",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        if (!hostsForUser.length) {
          return res.json([]);
        }
        const hostIds = hostsForUser.map((h) => h.id);
        const userSeries = await db
          .select()
          .from(eventSeries)
          .where(inArray(eventSeries.hostId, hostIds))
          .orderBy(eventSeries.createdAt);
        res.json(userSeries);
      } catch (error) {
        console.error("Error fetching event series:", error);
        res.status(500).json({ message: "Failed to fetch event series" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/parking-pass-bookings",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = req.params.id;
        const bookingsAsTruck = await db
          .select()
          .from(eventBookings)
          .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
          .where(eq(restaurants.ownerId, userId));

        const hostRows = await db
          .select({ id: hosts.id })
          .from(hosts)
          .where(eq(hosts.userId, userId));
        const hostIds = hostRows.map(
          (row: (typeof hostRows)[number]) => row.id,
        );
        const bookingsAsHost = hostIds.length
          ? await db
              .select()
              .from(eventBookings)
              .where(inArray(eventBookings.hostId, hostIds))
          : [];

        res.json({ bookingsAsTruck, bookingsAsHost });
      } catch (error) {
        console.error("Error fetching parking pass bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    },
  );

  app.patch(
    "/api/admin/hosts/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parseNullableDecimalString = (
          value: unknown,
        ): string | null | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return trimmed;
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return String(value);
          }
          return "__invalid__";
        };

        const parseIntCentsOrZero = (
          value: unknown,
        ): number | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return 0;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return 0;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return Math.max(0, Math.round(num));
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return Math.max(0, Math.round(value));
          }
          return "__invalid__";
        };

        const parseNullableInt = (
          value: unknown,
        ): number | null | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return Math.round(num);
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return Math.round(value);
          }
          return "__invalid__";
        };

        const parseDaysOfWeek = (
          value: unknown,
        ): number[] | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (!Array.isArray(value)) return "__invalid__";
          const out: number[] = [];
          for (const entry of value) {
            const num = typeof entry === "number" ? entry : Number(entry);
            if (!Number.isInteger(num) || num < 0 || num > 6) {
              return "__invalid__";
            }
            out.push(num);
          }
          return Array.from(new Set(out)).sort((a, b) => a - b);
        };

        const latitude = parseNullableDecimalString(req.body?.latitude);
        if (latitude === "__invalid__") {
          return res.status(400).json({ message: "Invalid latitude" });
        }
        const longitude = parseNullableDecimalString(req.body?.longitude);
        if (longitude === "__invalid__") {
          return res.status(400).json({ message: "Invalid longitude" });
        }

        const expectedFootTraffic = parseNullableInt(
          req.body?.expectedFootTraffic,
        );
        if (expectedFootTraffic === "__invalid__") {
          return res
            .status(400)
            .json({ message: "Invalid expectedFootTraffic" });
        }

        const parkingPassDaysOfWeek = parseDaysOfWeek(
          req.body?.parkingPassDaysOfWeek,
        );
        if (parkingPassDaysOfWeek === "__invalid__") {
          return res
            .status(400)
            .json({ message: "Invalid parkingPassDaysOfWeek" });
        }

        const parkingPassBreakfastPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassBreakfastPriceCents,
        );
        if (parkingPassBreakfastPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassBreakfastPriceCents",
          });
        }
        const parkingPassLunchPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassLunchPriceCents,
        );
        if (parkingPassLunchPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassLunchPriceCents",
          });
        }
        const parkingPassDinnerPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassDinnerPriceCents,
        );
        if (parkingPassDinnerPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassDinnerPriceCents",
          });
        }
        const parkingPassDailyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassDailyPriceCents,
        );
        if (parkingPassDailyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassDailyPriceCents",
          });
        }
        const parkingPassWeeklyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassWeeklyPriceCents,
        );
        if (parkingPassWeeklyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassWeeklyPriceCents",
          });
        }
        const parkingPassMonthlyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassMonthlyPriceCents,
        );
        if (parkingPassMonthlyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassMonthlyPriceCents",
          });
        }

        const wantsHostPricingUpdate =
          req.body?.parkingPassBreakfastPriceCents !== undefined ||
          req.body?.parkingPassLunchPriceCents !== undefined ||
          req.body?.parkingPassDinnerPriceCents !== undefined ||
          req.body?.parkingPassDailyPriceCents !== undefined ||
          req.body?.parkingPassWeeklyPriceCents !== undefined ||
          req.body?.parkingPassMonthlyPriceCents !== undefined ||
          req.body?.parkingPassStartTime !== undefined ||
          req.body?.parkingPassEndTime !== undefined ||
          req.body?.parkingPassDaysOfWeek !== undefined;

        if (wantsHostPricingUpdate) {
          const check = await getHostPricingColumnsCheck();
          if (!check.hasAll) {
            return res.status(409).json({
              message:
                "Parking Pass pricing columns are missing in the database. Run migration `071_add_hosts_parking_pass_pricing.sql` and redeploy.",
              missingColumns: check.missing,
            });
          }
        }

        const wantsHostPricingFieldsUpdate =
          req.body?.parkingPassBreakfastPriceCents !== undefined ||
          req.body?.parkingPassLunchPriceCents !== undefined ||
          req.body?.parkingPassDinnerPriceCents !== undefined ||
          req.body?.parkingPassDailyPriceCents !== undefined ||
          req.body?.parkingPassWeeklyPriceCents !== undefined ||
          req.body?.parkingPassMonthlyPriceCents !== undefined ||
          req.body?.parkingPassDailyOnly !== undefined;

        let derivedBreakfastCents = parkingPassBreakfastPriceCents;
        let derivedLunchCents = parkingPassLunchPriceCents;
        let derivedDinnerCents = parkingPassDinnerPriceCents;
        let derivedDailyCents = parkingPassDailyPriceCents;
        let derivedWeeklyCents = parkingPassWeeklyPriceCents;
        let derivedMonthlyCents = parkingPassMonthlyPriceCents;

        if (wantsHostPricingFieldsUpdate) {
          const slotSum =
            (Number(derivedBreakfastCents ?? 0) || 0) +
            (Number(derivedLunchCents ?? 0) || 0) +
            (Number(derivedDinnerCents ?? 0) || 0);

          const dailyProvided =
            req.body?.parkingPassDailyPriceCents !== undefined;
          const weeklyProvided =
            req.body?.parkingPassWeeklyPriceCents !== undefined;
          const monthlyProvided =
            req.body?.parkingPassMonthlyPriceCents !== undefined;

          const effectiveDaily = dailyProvided
            ? Number(derivedDailyCents ?? 0)
            : slotSum > 0
              ? slotSum
              : Number(derivedDailyCents ?? 0);

          derivedDailyCents = Math.max(0, Math.round(effectiveDaily || 0));

          if (!weeklyProvided) {
            derivedWeeklyCents =
              derivedDailyCents > 0
                ? derivedDailyCents * 7
                : Number(derivedWeeklyCents ?? 0);
          }
          if (!monthlyProvided) {
            derivedMonthlyCents =
              derivedDailyCents > 0
                ? derivedDailyCents * 30
                : Number(derivedMonthlyCents ?? 0);
          }
        }

        const wantsSpotImageUpdate = req.body?.spotImageUrl !== undefined;
        const includeSpotImageUrl = wantsSpotImageUpdate
          ? await hasHostSpotImageColumn().catch(() => false)
          : false;

        const updates: any = {
          businessName: req.body?.businessName,
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          latitude,
          longitude,
          // Older deployments may not have `spot_image_url` yet.
          // If the column is missing, silently ignore this field so admins can still update
          // coordinates/pricing without a 500.
          spotImageUrl: includeSpotImageUrl
            ? req.body?.spotImageUrl
            : undefined,
          locationType: req.body?.locationType,
          expectedFootTraffic,
          amenities: req.body?.amenities,
          contactPhone: req.body?.contactPhone,
          notes: req.body?.notes,
          isVerified: req.body?.isVerified,
          // Parking Pass defaults (host is the source of truth).
          parkingPassBreakfastPriceCents: wantsHostPricingFieldsUpdate
            ? derivedBreakfastCents
            : undefined,
          parkingPassLunchPriceCents: wantsHostPricingFieldsUpdate
            ? derivedLunchCents
            : undefined,
          parkingPassDinnerPriceCents: wantsHostPricingFieldsUpdate
            ? derivedDinnerCents
            : undefined,
          parkingPassDailyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedDailyCents
            : undefined,
          parkingPassWeeklyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedWeeklyCents
            : undefined,
          parkingPassMonthlyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedMonthlyCents
            : undefined,
          parkingPassStartTime: req.body?.parkingPassStartTime,
          parkingPassEndTime: req.body?.parkingPassEndTime,
          parkingPassDaysOfWeek,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(hosts)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(hosts.id, req.params.id))
          .returning();

        // Keep derived series in sync so pins/bookability update immediately.
        try {
          if (updated?.id) {
            await storage.syncParkingPassSeriesFromHost(String(updated.id));
          }
        } catch (e) {
          console.warn(
            "admin host update: failed syncing parking pass series:",
            e,
          );
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating host:", error);
        if (
          isMissingColumnError(error) &&
          (error?.message?.includes("parking_pass_") ||
            error?.message?.includes("parkingPass"))
        ) {
          hostPricingColumnsCache = null;
          const check = await getHostPricingColumnsCheck().catch(() => null);
          return res.status(409).json({
            message:
              "Parking Pass pricing columns are missing in the database. Run migration `071_add_hosts_parking_pass_pricing.sql` and redeploy.",
            missingColumns: check?.missing ?? undefined,
          });
        }
        const code = typeof error?.code === "string" ? error.code : null;
        const allowDetailCodes = new Set([
          "42703", // undefined_column
          "22P02", // invalid_text_representation
          "23502", // not_null_violation
          "23503", // foreign_key_violation
          "42804", // datatype_mismatch
        ]);
        const detail =
          allowDetailCodes.has(code || "") && typeof error?.message === "string"
            ? String(error.message).split("\n")[0].slice(0, 220)
            : null;

        res.status(500).json({
          message: `Failed to update host${
            code ? ` (code=${code})` : ""
          }${detail ? `: ${detail}` : ""}`,
        });
      }
    },
  );

  app.delete(
    "/api/admin/hosts/:hostId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostId = req.params.hostId;
        const host = await storage.getHost(hostId);
        if (!host) {
          return res.status(404).json({ message: "Host location not found" });
        }

        const existingBookings = await db
          .select({ id: eventBookings.id })
          .from(eventBookings)
          .where(eq(eventBookings.hostId, hostId))
          .limit(1);

        if (existingBookings.length > 0) {
          return res.status(409).json({
            message: "This location has bookings and cannot be deleted.",
          });
        }

        await db.delete(hosts).where(eq(hosts.id, hostId));
        res.json({ message: "Host location deleted" });
      } catch (error: any) {
        console.error("Error deleting host location:", error);
        res.status(500).json({ message: "Failed to delete host location" });
      }
    },
  );

  app.patch(
    "/api/admin/restaurants/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          name: req.body?.name,
          address: req.body?.address,
          phone: req.body?.phone,
          businessType: req.body?.businessType,
          cuisineType: req.body?.cuisineType,
          promoCode: req.body?.promoCode,
          city: req.body?.city,
          state: req.body?.state,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          isActive: req.body?.isActive,
          isVerified: req.body?.isVerified,
          description: req.body?.description,
          websiteUrl: req.body?.websiteUrl,
          instagramUrl: req.body?.instagramUrl,
          facebookPageUrl: req.body?.facebookPageUrl,
          amenities: req.body?.amenities,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const updated = await storage.updateRestaurant(req.params.id, updates);
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating restaurant:", error);
        res.status(500).json({ message: "Failed to update restaurant" });
      }
    },
  );

  app.get(
    "/api/admin/restaurants/:id/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const restaurantDeals = await storage.getDealsByRestaurant(
          req.params.id,
        );
        res.json(restaurantDeals);
      } catch (error) {
        console.error("Error fetching restaurant deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          title: req.body?.title,
          description: req.body?.description,
          dealType: req.body?.dealType,
          discountValue:
            req.body?.discountValue !== undefined
              ? Number(req.body.discountValue)
              : undefined,
          minOrderAmount:
            req.body?.minOrderAmount !== undefined
              ? Number(req.body.minOrderAmount)
              : undefined,
          imageUrl: req.body?.imageUrl,
          startDate: req.body?.startDate
            ? new Date(req.body.startDate)
            : undefined,
          endDate: req.body?.endDate ? new Date(req.body.endDate) : undefined,
          startTime: req.body?.startTime,
          endTime: req.body?.endTime,
          availableDuringBusinessHours: req.body?.availableDuringBusinessHours,
          isOngoing: req.body?.isOngoing,
          totalUsesLimit:
            req.body?.totalUsesLimit !== undefined
              ? Number(req.body.totalUsesLimit)
              : undefined,
          perCustomerLimit:
            req.body?.perCustomerLimit !== undefined
              ? Number(req.body.perCustomerLimit)
              : undefined,
          isActive: req.body?.isActive,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const updated = await storage.updateDeal(req.params.id, updates);
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating deal:", error);
        res.status(500).json({ message: "Failed to update deal" });
      }
    },
  );

  app.patch(
    "/api/admin/events/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const eventId = req.params.id;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        const updates: any = {
          name: req.body?.name,
          description: req.body?.description,
          date: req.body?.date ? new Date(req.body.date) : undefined,
          startTime: req.body?.startTime,
          endTime: req.body?.endTime,
          maxTrucks:
            req.body?.maxTrucks !== undefined
              ? Number(req.body.maxTrucks)
              : undefined,
          status: req.body?.status,
          hardCapEnabled: req.body?.hardCapEnabled,
          requiresPayment: req.body?.requiresPayment,
          breakfastPriceCents:
            req.body?.breakfastPriceCents !== undefined
              ? Number(req.body.breakfastPriceCents)
              : undefined,
          lunchPriceCents:
            req.body?.lunchPriceCents !== undefined
              ? Number(req.body.lunchPriceCents)
              : undefined,
          dinnerPriceCents:
            req.body?.dinnerPriceCents !== undefined
              ? Number(req.body.dinnerPriceCents)
              : undefined,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        if (updates.startTime && updates.endTime) {
          const [startHour, startMinute] = String(updates.startTime)
            .split(":")
            .map(Number);
          const [endHour, endMinute] = String(updates.endTime)
            .split(":")
            .map(Number);
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = endHour * 60 + endMinute;
          if (endMinutes <= startMinutes) {
            return res
              .status(400)
              .json({ message: "End time must be after start time" });
          }
        }

        const breakfast = Number(
          updates.breakfastPriceCents ?? event.breakfastPriceCents ?? 0,
        );
        const lunch = Number(
          updates.lunchPriceCents ?? event.lunchPriceCents ?? 0,
        );
        const dinner = Number(
          updates.dinnerPriceCents ?? event.dinnerPriceCents ?? 0,
        );
        const finalStartTime = String(updates.startTime ?? event.startTime);
        const finalEndTime = String(updates.endTime ?? event.endTime);
        const invalidSlots: string[] = [];
        if (
          breakfast > 0 &&
          !isSlotWithinHours("breakfast", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Breakfast");
        }
        if (
          lunch > 0 &&
          !isSlotWithinHours("lunch", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Lunch");
        }
        if (
          dinner > 0 &&
          !isSlotWithinHours("dinner", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Dinner");
        }
        if (invalidSlots.length > 0) {
          return res.status(400).json({
            message:
              "Parking hours must fully cover priced slots: " +
              invalidSlots.join(", "),
          });
        }
        const slotSum = breakfast + lunch + dinner;
        updates.hostPriceCents = slotSum;
        updates.dailyPriceCents = slotSum;
        updates.weeklyPriceCents = slotSum * 7;
        updates.monthlyPriceCents = slotSum * 30;
        updates.updatedAt = new Date();

        const [updated] = await db
          .update(events)
          .set(updates)
          .where(eq(events.id, eventId))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating event:", error);
        res.status(500).json({ message: "Failed to update event" });
      }
    },
  );

  app.patch(
    "/api/admin/event-series/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          name: req.body?.name,
          description: req.body?.description,
          timezone: req.body?.timezone,
          recurrenceRule: req.body?.recurrenceRule,
          startDate: req.body?.startDate
            ? new Date(req.body.startDate)
            : undefined,
          endDate: req.body?.endDate ? new Date(req.body.endDate) : undefined,
          defaultStartTime: req.body?.defaultStartTime,
          defaultEndTime: req.body?.defaultEndTime,
          defaultMaxTrucks:
            req.body?.defaultMaxTrucks !== undefined
              ? Number(req.body.defaultMaxTrucks)
              : undefined,
          defaultHardCapEnabled: req.body?.defaultHardCapEnabled,
          status: req.body?.status,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(eventSeries)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(eventSeries.id, req.params.id))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating event series:", error);
        res.status(500).json({ message: "Failed to update event series" });
      }
    },
  );

  app.patch(
    "/api/admin/parking-pass-bookings/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          status: req.body?.status,
          refundStatus: req.body?.refundStatus,
          refundAmountCents:
            req.body?.refundAmountCents !== undefined
              ? Number(req.body.refundAmountCents)
              : undefined,
          cancellationReason: req.body?.cancellationReason,
          refundReason: req.body?.refundReason,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(eventBookings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(eventBookings.id, req.params.id))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating booking:", error);
        res.status(500).json({ message: "Failed to update booking" });
      }
    },
  );

  app.get(
    "/api/admin/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const deals = await storage.getAllDealsWithRestaurants();
        res.json(deals);
      } catch (error) {
        console.error("Error fetching deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.get(
    "/api/admin/deals/:dealId/stats",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const dealId = req.params.dealId;
        const [viewsCount, claimsCount, feedbackStats] = await Promise.all([
          storage.getDealViewsCount(dealId),
          storage.getDealClaimsCount(dealId),
          storage.getDealFeedbackStats(dealId),
        ]);

        res.json({
          views: viewsCount,
          claims: claimsCount,
          averageRating: feedbackStats.averageRating,
          totalFeedback: feedbackStats.totalFeedback,
          ratingDistribution: feedbackStats.ratingDistribution,
        });
      } catch (error) {
        console.error("Error fetching deal stats:", error);
        res.status(500).json({ message: "Failed to fetch deal statistics" });
      }
    },
  );

  app.delete(
    "/api/admin/deals/:dealId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.deleteDeal(req.params.dealId);
        res.json({ message: "Deal deleted successfully" });
      } catch (error) {
        console.error("Error deleting deal:", error);
        res.status(500).json({ message: "Failed to delete deal" });
      }
    },
  );

  app.post(
    "/api/admin/deals/:dealId/clone",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const clonedDeal = await storage.duplicateDeal(req.params.dealId);
        res.json(clonedDeal);
      } catch (error) {
        console.error("Error cloning deal:", error);
        res.status(500).json({ message: "Failed to clone deal" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:dealId/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { isActive } = req.body;
        await storage.updateDeal(req.params.dealId, { isActive });
        res.json({ message: "Deal status updated successfully" });
      } catch (error) {
        console.error("Error updating deal status:", error);
        res.status(500).json({ message: "Failed to update deal status" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:dealId/extend",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { days } = req.body;
        if (!days || days < 1) {
          return res.status(400).json({ message: "Invalid number of days" });
        }

        const deal = await storage.getDeal(req.params.dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        if (!deal.endDate) {
          return res
            .status(400)
            .json({ message: "Cannot extend ongoing deals (no end date)" });
        }

        const newEndDate = new Date(deal.endDate);
        newEndDate.setDate(newEndDate.getDate() + days);

        await storage.updateDeal(req.params.dealId, { endDate: newEndDate });
        res.json({ message: `Deal extended by ${days} days`, newEndDate });
      } catch (error) {
        console.error("Error extending deal:", error);
        res.status(500).json({ message: "Failed to extend deal" });
      }
    },
  );

  // Admin verification routes
  app.get(
    "/api/admin/verifications",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { status } = req.query;
        let verifications = await storage.getVerificationRequests();

        // Filter by status if provided
        if (
          status &&
          ["pending", "approved", "rejected"].includes(status as string)
        ) {
          verifications = verifications.filter((v) => v.status === status);
        }

        res.json(verifications);
      } catch (error) {
        console.error("Error fetching verification requests:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch verification requests" });
      }
    },
  );

  app.post(
    "/api/admin/verifications/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const user = req.user;
        const { id } = req.params;
        await storage.approveVerificationRequest(id, user.id);

        const [claimContext] = await db
          .select({
            restaurantId: restaurants.id,
            claimedFromImportId: restaurants.claimedFromImportId,
            ownerId: restaurants.ownerId,
            ownerEmail: users.email,
          })
          .from(verificationRequests)
          .innerJoin(
            restaurants,
            eq(verificationRequests.restaurantId, restaurants.id),
          )
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(eq(verificationRequests.id, id))
          .limit(1);

        if (claimContext?.ownerId) {
          try {
            await ensurePremiumTrialForUserId(String(claimContext.ownerId));
          } catch (e) {
            console.warn(
              "ensurePremiumTrialForUserId failed after verification approval:",
              e,
            );
          }
        }

        if (claimContext?.claimedFromImportId) {
          await db
            .update(truckImportListings)
            .set({
              status: "claimed",
              updatedAt: new Date(),
            })
            .where(
              eq(truckImportListings.id, claimContext.claimedFromImportId),
            );

          await db
            .update(truckClaimRequests)
            .set({
              status: "approved",
              reviewerId: user.id,
              reviewedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              eq(truckClaimRequests.restaurantId, claimContext.restaurantId),
            );

          await db
            .update(restaurants)
            .set({
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, claimContext.restaurantId));

          const notificationEmail = "notifications@mealscout.us";
          if (claimContext.ownerEmail) {
            await emailService.sendBasicEmail(
              claimContext.ownerEmail,
              "Your food truck claim was approved",
              `
                <p>Your food truck claim has been approved.</p>
                <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              `,
            );
          }
          await emailService.sendBasicEmail(
            notificationEmail,
            "Food Truck Claim Approved",
            `
              <p>A food truck claim was approved.</p>
              <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              <p><strong>Owner ID:</strong> ${claimContext.ownerId}</p>
            `,
          );
        }

        res.json({ success: true, message: "Verification request approved" });
      } catch (error) {
        console.error("Error approving verification request:", error);
        res
          .status(500)
          .json({ message: "Failed to approve verification request" });
      }
    },
  );

  app.post(
    "/api/admin/verifications/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const user = req.user;
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim().length === 0) {
          return res
            .status(400)
            .json({ message: "Rejection reason is required" });
        }

        await storage.rejectVerificationRequest(id, user.id, reason);

        const [claimContext] = await db
          .select({
            restaurantId: restaurants.id,
            claimedFromImportId: restaurants.claimedFromImportId,
            ownerId: restaurants.ownerId,
            ownerEmail: users.email,
          })
          .from(verificationRequests)
          .innerJoin(
            restaurants,
            eq(verificationRequests.restaurantId, restaurants.id),
          )
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(eq(verificationRequests.id, id))
          .limit(1);

        if (claimContext?.claimedFromImportId) {
          await db
            .update(truckImportListings)
            .set({
              status: "rejected",
              updatedAt: new Date(),
            })
            .where(
              eq(truckImportListings.id, claimContext.claimedFromImportId),
            );

          await db
            .update(truckClaimRequests)
            .set({
              status: "rejected",
              reviewerId: user.id,
              reviewedAt: new Date(),
              rejectionReason: reason,
              updatedAt: new Date(),
            })
            .where(
              eq(truckClaimRequests.restaurantId, claimContext.restaurantId),
            );

          const notificationEmail = "notifications@mealscout.us";
          if (claimContext.ownerEmail) {
            await emailService.sendBasicEmail(
              claimContext.ownerEmail,
              "Your food truck claim was rejected",
              `
                <p>Your food truck claim was rejected.</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              `,
            );
          }
          await emailService.sendBasicEmail(
            notificationEmail,
            "Food Truck Claim Rejected",
            `
              <p>A food truck claim was rejected.</p>
              <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              <p><strong>Owner ID:</strong> ${claimContext.ownerId}</p>
              <p><strong>Reason:</strong> ${reason}</p>
            `,
          );
        }

        res.json({ success: true, message: "Verification request rejected" });
      } catch (error) {
        console.error("Error rejecting verification request:", error);
        res
          .status(500)
          .json({ message: "Failed to reject verification request" });
      }
    },
  );

  // OAuth configuration status check
  app.get(
    "/api/admin/oauth/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";

        const status = {
          google: {
            configured: !!(
              process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ),
            clientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
            clientSecretPresent: !!process.env.GOOGLE_CLIENT_SECRET,
            callbackUrls: {
              customer: `${baseUrl}/api/auth/google/customer/callback`,
              restaurant: `${baseUrl}/api/auth/google/restaurant/callback`,
            },
          },
          facebook: {
            configured: !!(
              process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
            ),
            appIdPresent: !!process.env.FACEBOOK_APP_ID,
            appSecretPresent: !!process.env.FACEBOOK_APP_SECRET,
            callbackUrl: `${baseUrl}/api/auth/facebook/callback`,
          },
          requiredUrls: {
            privacyPolicy: `${baseUrl}/privacy-policy`,
            dataDeletion: `${baseUrl}/data-deletion`,
            termsOfService: `${baseUrl}/terms-of-service`,
          },
          baseUrl,
          environment: process.env.NODE_ENV || "development",
        };

        res.json(status);
      } catch (error) {
        console.error("Error checking OAuth status:", error);
        res.status(500).json({ error: "Failed to check OAuth status" });
      }
    },
  );
}
