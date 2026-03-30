import type { Express } from "express";
import { createServer, type Server } from "http";
import {
  getParkingPassOnboardingQueue,
  getParkingPassPricingAudit,
  repairParkingPassPricingDrift,
} from "./parkingPassReminder";
import {
  getLocationDemandFunnelKpis,
} from "./services/locationDemandActivation";
import Stripe from "stripe";
import { storage } from "./storage";
import {
  getHostByUserId,
  getEventAndHostForUser,
  getInterestEventAndHostForUser,
  userOwnsEvent,
} from "./services/hostOwnership";
import {
  assertMaxSpan180Days,
  generateOccurrences,
  filterFutureOccurrences,
} from "./services/openCallSeries";
import {
  computeAcceptedCount,
  shouldBlockAcceptance,
  buildCapacityFullError,
  computeFillRate,
} from "./services/interestDecision";
import { registerHostRoutes } from "./routes/hostRoutes";
import {
  isHostProfileMapEligible,
  normalizeUsStateAbbr,
} from "./services/parkingPassQuality";
import { resolveCityTimeZoneSync } from "./services/cityTimeZone";
import {
  addDaysToDateKey,
  dateKeyInZone,
  utcDateFromDateKey,
} from "./services/dateKeys";
import { registerOpenCallSeriesRoutes } from "./routes/openCallSeriesRoutes";
import { registerEventRoutes } from "./routes/eventRoutes";
import { registerDiscoveryRoutes } from "./routes/discoveryRoutes";
import { registerEventCoordinatorRoutes } from "./routes/eventCoordinatorRoutes";
import { registerAdminManagementRoutes } from "./routes/adminManagementRoutes";
import { registerGeoAdRoutes } from "./routes/geoAdRoutes";
import { registerBookingRoutes } from "./routes/bookingRoutes";
import { registerSupplierMarketplaceRoutes } from "./routes/supplierMarketplaceRoutes";
import { registerSupplyScoutRoutes } from "./routes/supplyScoutRoutes";
import { registerStaffRoutes } from "./staffRoutes";
import {
  validateEnvironmentForStartup,
  validateRequiredEnvOnModuleLoad,
} from "./startup/envValidation";
import {
  setupUnifiedAuth,
  isRestaurantOwner,
  isRestaurantOwnerOrAdmin,
  isStaffOrAdmin,
  verifyResourceOwnership,
} from "./unifiedAuth";
import { emailService, isEmailConfigured } from "./emailService";
import {
  insertFoodTruckSessionSchema,
  insertRestaurantRecommendationSchema,
  insertPasswordResetTokenSchema,
  insertLocationRequestSchema,
  insertTruckInterestSchema,
  insertHostLocationClaimSchema,
  insertHostSchema,
  insertEventSchema,
  insertEventSeriesSchema,
  insertEventInterestSchema,
  type User,
  type InsertEvent,
  deals,
  events,
  hosts,
  insertAwardHistorySchema,
  passwordResetTokens,
  users,
  userAddresses,
  locationRequests,
  restaurants,
  truckInterests,
  suppliers,
  socialPostQueue,
} from "@shared/schema";
import {
  PARKING_PASS_BOOKING_DAYS,
  PARKING_PASS_SLOT_TYPES,
  isSlotWithinHours,
} from "@shared/parkingPassSlots";
import { z } from "zod";
import { validateDocuments, checkRateLimit } from "./documentValidation";
import { randomBytes, timingSafeEqual, createHash } from "crypto";
import { ensureAffiliateTag } from "./affiliateTagService";
import {
  isPasswordStrong,
  PASSWORD_REQUIREMENTS,
} from "./utils/passwordPolicy";
import {
  sendGoldenForkAwardEmail,
  sendGoldenPlateAwardEmail,
  sendDealClaimedNotification,
  sendWelcomeEmail,
  sendTruckInterestNotification,
} from "./emailNotifications";

// SECURITY AUDIT STATUS
// ✅ All critical endpoints require authentication
// ✅ Rate limiting applied to sensitive endpoints (login, password reset, bug reports)
// ✅ Password reset tokens stored in database (persistent across restarts)
// ✅ Database-backed rate limiting prevents brute force attacks
// ✅ Drizzle ORM prevents SQL injection
// ⚠️  Recommendation: Add admin role checks for critical operations
// ⚠️  Recommendation: Add API key authentication for service-to-service communication

// Environment validation - ensures critical configuration is present at startup
function validateRequiredEnv() {
  const required = ["DATABASE_URL", "SESSION_SECRET"];
  const missing = required.filter((env) => !process.env[env]);

  if (missing.length > 0) {
    const errorMsg = `❌ FATAL: Missing required environment variables: ${missing.join(
      ", ",
    )}`;
    console.error(errorMsg);
    if (process.env.NODE_ENV === "production") {
      throw new Error(errorMsg);
    }
  }

  // Validate ALLOWED_ORIGINS format if set
  if (process.env.ALLOWED_ORIGINS) {
    const origins = process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    if (origins.length === 0) {
      console.warn(
        "⚠️  ALLOWED_ORIGINS is empty, using default: http://localhost:5000",
      );
    } else {
      console.log("✅ ALLOWED_ORIGINS configured:", origins.join(", "));
    }
  } else {
    console.warn(
      "⚠️  ALLOWED_ORIGINS not set, defaulting to: http://localhost:5000",
    );
  }
}

// Validate environment at module load time
validateRequiredEnvOnModuleLoad();

import bcrypt from "bcryptjs";
import auditLogger, { logAudit } from "./auditLogger";
import incidentManager, {
  createIncident,
  ANOMALY_RULES,
} from "./incidentManager";
import {
  ensurePremiumTrialForUser,
  isPremiumTrialActive,
} from "./services/premiumTrial";
import { db } from "./db";
import {
  and,
  inArray,
  eq,
  sql,
  gte,
  lte,
  desc,
  like,
  ilike,
  asc,
  isNotNull,
  ne,
  lt,
  isNull,
  or,
} from "drizzle-orm";
import { runMapEndpointWatchdog } from "./mapEndpointWatchdog";
import { registerAuthAccountRoutes } from "./routes/authAccountRoutes";
import { registerAnalyticsRoutes } from "./routes/analyticsRoutes";
import { registerAwardsRoutes } from "./routes/awardsRoutes";
import { registerClaimRoutes } from "./routes/claimRoutes";
import { registerDealManagementRoutes } from "./routes/dealManagementRoutes";
import { registerLocationDemandRoutes } from "./routes/locationDemandRoutes";
import { registerLocationUtilityRoutes } from "./routes/locationUtilityRoutes";
import { registerMediaRoutes } from "./routes/mediaRoutes";
import { registerDealDiscoveryRoutes } from "./routes/dealDiscoveryRoutes";
import { registerHostPayoutAdminRoutes } from "./routes/hostPayoutAdminRoutes";
import { registerHostInterestRoutes } from "./routes/hostInterestRoutes";
import { registerPublicDiscoveryRoutes } from "./routes/publicDiscoveryRoutes";
import { registerPublicMapRoutes } from "./routes/publicMapRoutes";
import { registerRestaurantCoreRoutes } from "./routes/restaurantCoreRoutes";
import { registerRestaurantOperationsRoutes } from "./routes/restaurantOperationsRoutes";
import { registerRestaurantSignupRoutes } from "./routes/restaurantSignupRoutes";
import { registerPublicSearchRoutes } from "./routes/publicSearchRoutes";
import { registerSeoRoutes } from "./routes/seoRoutes";
import { registerSubscriptionRoutes } from "./routes/subscriptionRoutes";
import { registerSystemUtilityRoutes } from "./routes/systemUtilityRoutes";
import { registerTruckClaimRoutes } from "./routes/truckClaimRoutes";

// Optional Stripe integration
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// Pricing helpers: Stripe Price IDs
const PROMO_DEADLINE = new Date("2026-03-01T00:00:00Z");

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const postToFacebookPage = async (message: string, link?: string | null) => {
  const pageId = process.env.MEALSCOUT_FB_PAGE_ID;
  const pageToken = process.env.MEALSCOUT_FB_PAGE_TOKEN;
  if (!pageId || !pageToken) {
    return { ok: false, error: "Missing Facebook page credentials" };
  }
  const body = new URLSearchParams();
  body.set("message", link ? `${message} ${link}` : message);
  body.set("access_token", pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || "Facebook post failed",
    };
  }
  return { ok: true, postId: data?.id };
};

const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const toNumeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEmailChannelEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const channels =
    settings?.notifications?.channels &&
    typeof settings.notifications.channels === "object"
      ? (settings.notifications.channels as Record<string, any>)
      : null;
  return typeof channels?.email === "boolean" ? channels.email : true;
};

const isDealAlertsEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const topics =
    settings?.notifications?.topics &&
    typeof settings.notifications.topics === "object"
      ? (settings.notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.dealAlerts === "boolean" ? topics.dealAlerts : true;
};

const isNearbyEventsEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const topics =
    settings?.notifications?.topics &&
    typeof settings.notifications.topics === "object"
      ? (settings.notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.nearbyEvents === "boolean" ? topics.nearbyEvents : true;
};

const getNearbyDealRadiusKm = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const location =
    settings?.notifications?.location &&
    typeof settings.notifications.location === "object"
      ? (settings.notifications.location as Record<string, any>)
      : null;

  if (location && typeof location.enabled === "boolean" && !location.enabled) {
    return null;
  }

  const radius = Number(location?.radiusKm);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }
  return 8; // ~5 miles default
};

async function notifyNearbyDealSubscribers(params: {
  creatorUserId: string;
  dealId: string;
  dealTitle: string;
  restaurantName: string;
  lat: number;
  lng: number;
}) {
  if (!isEmailConfigured()) return;

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
  const dealUrl = `${baseUrl.replace(/\/+$/, "")}/deals/${params.dealId}`;

  const candidates = await db
    .select({
      userId: users.id,
      email: users.email,
      accountSettings: users.accountSettings,
      latitude: userAddresses.latitude,
      longitude: userAddresses.longitude,
    })
    .from(users)
    .innerJoin(
      userAddresses,
      and(
        eq(userAddresses.userId, users.id),
        eq(userAddresses.isDefault, true),
      ),
    )
    .where(
      and(
        or(eq(users.isDisabled, false), isNull(users.isDisabled)),
        isNotNull(users.email),
        isNotNull(userAddresses.latitude),
        isNotNull(userAddresses.longitude),
      ),
    );

  for (const candidate of candidates) {
    if (!candidate.email || candidate.userId === params.creatorUserId) continue;
    if (!isEmailChannelEnabled(candidate.accountSettings)) continue;
    if (!isDealAlertsEnabled(candidate.accountSettings)) continue;

    const radiusKm = getNearbyDealRadiusKm(candidate.accountSettings);
    if (!radiusKm) continue;

    const userLat = toNumeric(candidate.latitude);
    const userLng = toNumeric(candidate.longitude);
    if (userLat == null || userLng == null) continue;

    const distanceKm = haversineKm(params.lat, params.lng, userLat, userLng);
    if (distanceKm > radiusKm) continue;

    await emailService.sendBasicEmail(
      candidate.email,
      `New deal near you: ${params.restaurantName}`,
      `<p>A new deal was just posted near your location.</p><p><strong>${params.dealTitle}</strong> at <strong>${params.restaurantName}</strong>.</p><p><a href="${dealUrl}">View deal</a></p>`,
      `New deal near you: ${params.dealTitle} at ${params.restaurantName}. View: ${dealUrl}`,
      "general",
    );
  }
}

async function notifyHostCapacityWarning(params: {
  hostId: string;
  eventId: string;
  eventStartDate: Date | null;
  confirmedCount: number;
  maxTrucks: number;
}) {
  if (!isEmailConfigured()) return;

  const [recipient] = await db
    .select({
      email: users.email,
      accountSettings: users.accountSettings,
      hostName: hosts.businessName,
    })
    .from(hosts)
    .innerJoin(users, eq(users.id, hosts.userId))
    .where(eq(hosts.id, params.hostId))
    .limit(1);

  if (!recipient?.email) return;
  if (!isEmailChannelEnabled(recipient.accountSettings)) return;
  if (!isNearbyEventsEnabled(recipient.accountSettings)) return;

  const fillPercent = Math.round(
    (params.confirmedCount / Math.max(1, params.maxTrucks)) * 100,
  );
  const isFull = params.confirmedCount >= params.maxTrucks;
  const subject = isFull
    ? `Parking Pass full: ${recipient.hostName || "Host listing"}`
    : `Parking Pass nearing capacity: ${recipient.hostName || "Host listing"}`;
  const eventDateText = params.eventStartDate
    ? new Date(params.eventStartDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Upcoming date";

  await emailService.sendBasicEmail(
    recipient.email,
    subject,
    `<p>Your parking pass date on <strong>${eventDateText}</strong> is now at <strong>${params.confirmedCount}/${params.maxTrucks}</strong> booked spots (${fillPercent}%).</p><p>Event ID: ${params.eventId}</p>`,
    `Parking pass occupancy update: ${eventDateText} is ${params.confirmedCount}/${params.maxTrucks} booked (${fillPercent}%). Event ID: ${params.eventId}`,
    "general",
  );
}

const queueSocialPost = async (payload: {
  platform: string;
  target?: string | null;
  message: string;
  link?: string | null;
}) => {
  let status = "pending";
  let errorMessage: string | null = null;

  if (payload.platform === "facebook") {
    const result = await postToFacebookPage(payload.message, payload.link);
    status = result.ok ? "posted" : "failed";
    if (!result.ok) {
      errorMessage = result.error || "Facebook post failed";
    }
  }

  await db.insert(socialPostQueue).values({
    platform: payload.platform,
    target: payload.target || null,
    message: payload.message,
    link: payload.link || null,
    status,
    errorMessage,
    updatedAt: new Date(),
  });
};

const isTrialActive = isPremiumTrialActive;
const ensureTrialForUser = ensurePremiumTrialForUser;

async function getLockedPriceForUser(userId: string): Promise<{
  locked: boolean;
  priceId: string;
  label: string;
}> {
  const price25 = process.env.PRICE_MONTHLY_25;
  if (!price25) {
    throw new Error("Stripe Price IDs not configured (PRICE_MONTHLY_25)");
  }

  const locked = true;
  const priceId = price25;
  const label = "$25 (was $50)";
  return { locked, priceId, label };
}

// Environment validation for production - BLOCKING to prevent startup with missing config
function validateEnvironment() {
  const required = ["DATABASE_URL", "SESSION_SECRET"];
  const missing = required.filter((env) => !process.env[env]);

  if (missing.length > 0) {
    const errorMsg = `❌ FATAL: Missing required environment variables: ${missing.join(
      ", ",
    )}`;
    console.error(errorMsg);
    if (process.env.NODE_ENV === "production") {
      console.error(
        "🛑 Production mode: Cannot start without required configuration",
      );
      process.exit(1);
    } else {
      console.warn(
        "⚠️  Development mode: Server starting with incomplete configuration. This may cause runtime errors.",
      );
    }
    return false;
  }
  console.log("✅ All required environment variables present");
  return true;
}

async function ensureAffiliateTagsForExistingUsers() {
  try {
    const rows = await db
      .select({ id: users.id, userType: users.userType })
      .from(users)
      .where(sql`${users.affiliateTag} is null`);

    for (const row of rows) {
      if (row.userType === "admin" || row.userType === "super_admin") {
        continue;
      }
      await ensureAffiliateTag(row.id);
    }
  } catch (error) {
    console.error("[affiliate] Failed to backfill affiliate tags:", error);
  }
}

// Subscription validation function for analytics access
async function validateAnalyticsAccess(userId: string): Promise<{
  hasAccess: boolean;
  error?: string;
  subscriptionTier?: string;
}> {
  try {
    const user = await storage.getUser(userId);
    if (!user) {
      return { hasAccess: false, error: "User not found" };
    }

    const hydratedUser = await ensureTrialForUser(user);

    if (isTrialActive(hydratedUser)) {
      return { hasAccess: true, subscriptionTier: "trial" };
    }

    // Check if user has active subscription
    if (!stripe || !hydratedUser.stripeSubscriptionId) {
      return {
        hasAccess: false,
        error:
          "Premium subscription required to access analytics. Please upgrade your plan.",
        subscriptionTier: "free",
      };
    }

    // Verify subscription status with Stripe
    const subscription = await stripe.subscriptions.retrieve(
      hydratedUser.stripeSubscriptionId,
    );
    if (!subscription || subscription.status !== "active") {
      return {
        hasAccess: false,
        error:
          "Your subscription is not active. Please check your payment method and try again.",
        subscriptionTier: "inactive",
      };
    }

    // Return subscription tier (monthly only)
    return {
      hasAccess: true,
      subscriptionTier: "monthly",
    };
  } catch (error) {
    console.error("Analytics access validation error:", error);
    return {
      hasAccess: false,
      error: "Unable to verify subscription status. Please try again.",
      subscriptionTier: "error",
    };
  }
}

// Subscription validation function - Now allows unlimited deals for all paid subscriptions
async function validateSubscriptionLimits(
  userId: string,
  excludeDealId?: string,
): Promise<{
  isValid: boolean;
  error?: string;
  currentCount?: number;
  maxDeals?: number;
}> {
  try {
    const user = await storage.getUser(userId);
    if (!user) {
      return { isValid: false, error: "User not found" };
    }

    const hydratedUser = await ensureTrialForUser(user);

    console.log("🔍 validateSubscriptionLimits - User ID:", userId);

    if (isTrialActive(hydratedUser)) {
      return { isValid: true, currentCount: 0, maxDeals: 999 };
    }

    // Check if user has active subscription
    if (!stripe) {
      return {
        isValid: false,
        error:
          "Active subscription required to create deals. Please upgrade your plan.",
        currentCount: 0,
        maxDeals: 0,
      };
    }

    const subscriptionId =
      hydratedUser.stripeSubscriptionId || hydratedUser.stripeCustomerId;

    // Removed legacy billing interval checks
    // Only monthly billing supported
    const validIntervals = ["month"];
    const intervalCount = 1;

    if (!subscriptionId) {
      return {
        isValid: false,
        error:
          "Active subscription required to create deals. Please upgrade your plan.",
        currentCount: 0,
        maxDeals: 0,
      };
    }

    // Verify subscription status with Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (!subscription || subscription.status !== "active") {
      return {
        isValid: false,
        error:
          "Your subscription is not active. Please check your payment method and try again.",
        currentCount: 0,
        maxDeals: 0,
      };
    }

    // Get user's restaurants and count active deals (for reporting purposes)
    const restaurants = await storage.getRestaurantsByOwner(userId);
    let activeDealsCount = 0;

    for (const restaurant of restaurants) {
      const deals = await storage.getDealsByRestaurant(restaurant.id);
      const activeDeals = deals.filter(
        (d) => d.isActive && (!excludeDealId || d.id !== excludeDealId),
      );
      activeDealsCount += activeDeals.length;
    }

    // All paid subscriptions now get unlimited deals
    const maxDeals = 999; // Unlimited deals for all paid plans

    return {
      isValid: true,
      currentCount: activeDealsCount,
      maxDeals,
    };
  } catch (error) {
    console.error("Subscription validation error:", error);
    return {
      isValid: false,
      error: "Unable to verify subscription status. Please try again.",
      currentCount: 0,
      maxDeals: 0,
    };
  }
}

const BUSINESS_FEATURE_TRIAL_DAYS = 30;
const BUSINESS_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const businessAccessCache = new Map<
  string,
  { hasAccess: boolean; expiresAt: number }
>();

function hasAccountAgeTrialAccess(user: User | null): boolean {
  if (!user?.createdAt) return false;
  if (
    !["restaurant_owner", "food_truck"].includes(String(user.userType || ""))
  ) {
    return false;
  }
  const createdAtMs = new Date(user.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  const trialEndsAtMs =
    createdAtMs + BUSINESS_FEATURE_TRIAL_DAYS * 24 * 60 * 60 * 1000;
  return trialEndsAtMs > Date.now();
}

async function hasBusinessDistributionAccess(userId: string): Promise<boolean> {
  const key = String(userId || "");
  if (!key) return false;

  const now = Date.now();
  const cached = businessAccessCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.hasAccess;
  }

  let hasAccess = false;
  try {
    const user = await storage.getUser(key);
    if (user) {
      if (["admin", "super_admin"].includes(String(user.userType || ""))) {
        hasAccess = true;
      } else if (hasAccountAgeTrialAccess(user)) {
        hasAccess = true;
      } else if (stripe && user.stripeSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(
            user.stripeSubscriptionId,
          );
          hasAccess = ["active", "trialing"].includes(
            String(subscription?.status || ""),
          );
        } catch (subscriptionError) {
          console.warn(
            "[subscription] Unable to verify subscription for visibility",
            {
              userId: key,
              error: (subscriptionError as any)?.message || subscriptionError,
            },
          );
          hasAccess = false;
        }
      }
    }
  } catch (error) {
    console.warn("[subscription] Failed to compute business access", {
      userId: key,
      error: (error as any)?.message || error,
    });
    hasAccess = false;
  }

  businessAccessCache.set(key, {
    hasAccess,
    expiresAt: now + BUSINESS_ACCESS_CACHE_TTL_MS,
  });
  return hasAccess;
}

async function filterDealsByBusinessAccess<
  T extends { restaurantId?: string | null },
>(dealRows: T[]): Promise<T[]> {
  if (!Array.isArray(dealRows) || dealRows.length === 0) return [];

  const restaurantIds = Array.from(
    new Set(
      dealRows
        .map((row) => String(row?.restaurantId || "").trim())
        .filter(Boolean),
    ),
  );
  if (restaurantIds.length === 0) return dealRows;

  const restaurantRows = await db
    .select({
      id: restaurants.id,
      ownerId: restaurants.ownerId,
    })
    .from(restaurants)
    .where(inArray(restaurants.id, restaurantIds));

  const ownerByRestaurant = new Map<string, string>();
  for (const row of restaurantRows) {
    const restaurantId = String(row.id || "").trim();
    const ownerId = String(row.ownerId || "").trim();
    if (!restaurantId || !ownerId) continue;
    ownerByRestaurant.set(restaurantId, ownerId);
  }

  const ownerIds = Array.from(new Set(ownerByRestaurant.values()));
  const ownerAccess = new Map<string, boolean>();
  await Promise.all(
    ownerIds.map(async (ownerId) => {
      ownerAccess.set(ownerId, await hasBusinessDistributionAccess(ownerId));
    }),
  );

  return dealRows.filter((deal) => {
    const restaurantId = String(deal?.restaurantId || "").trim();
    if (!restaurantId) return false;
    const ownerId = ownerByRestaurant.get(restaurantId);
    if (!ownerId) return false;
    return ownerAccess.get(ownerId) === true;
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerAuthAccountRoutes(app);

  registerLocationDemandRoutes(app);
  registerLocationUtilityRoutes(app, { hasBusinessDistributionAccess });

  registerPublicMapRoutes(app);

  registerMediaRoutes(app);

  registerAnalyticsRoutes(app);
  registerAwardsRoutes(app);

  registerClaimRoutes(app, { sendDealClaimedNotification });

  registerDealManagementRoutes(app, {
    logAudit,
    validateSubscriptionLimits,
    notifyNearbyDealSubscribers,
    toNumeric,
  });

  registerDealDiscoveryRoutes(app, {
    filterDealsByBusinessAccess,
    hasBusinessDistributionAccess,
  });

  registerRestaurantOperationsRoutes(app, {
    validateAnalyticsAccess,
    hasBusinessDistributionAccess,
  });

  registerRestaurantSignupRoutes(app, {
    ensureTrialForUser,
    queueSocialPost,
  });
  registerSubscriptionRoutes(app, {
    stripe,
    ensureTrialForUser,
    isTrialActive,
    getLockedPriceForUser,
  });
  registerTruckClaimRoutes(app);

  registerPublicDiscoveryRoutes(app);

  registerRestaurantCoreRoutes(app, { validateAnalyticsAccess });

  registerPublicSearchRoutes(app);

  registerSeoRoutes(app);
  registerHostInterestRoutes(app, {
    getHostByUserId,
    getEventAndHostForUser,
    getInterestEventAndHostForUser,
    userOwnsEvent,
    computeAcceptedCount,
    shouldBlockAcceptance,
    buildCapacityFullError,
    computeFillRate,
  });

  // Host Profile & Events
  registerHostRoutes(app);

  // =====================================================================
  // EVENT SERIES (OPEN CALLS) ENDPOINTS
  // =====================================================================
  registerOpenCallSeriesRoutes(app);

  // =====================================================================
  // END EVENT SERIES ENDPOINTS
  // ====================================================================

  // Truck Discovery
  registerEventRoutes(app);
  registerDiscoveryRoutes(app);
  registerEventCoordinatorRoutes(app);

  // Booking Management
  registerBookingRoutes(app);

  // Supplier marketplace (suppliers + food truck pickup orders)
  registerSupplierMarketplaceRoutes(app);
  if (String(process.env.ENABLE_SUPPLY_SCOUT || "").toLowerCase() === "true") {
    registerSupplyScoutRoutes(app);
  }

  // Stripe Webhook Handler
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event;

    try {
      const payload = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : req.body;
      const forceVerify =
        String(process.env.STRIPE_WEBHOOK_FORCE_VERIFY || "").toLowerCase() ===
        "true";

      // Default behavior:
      // - development: accept JSON payloads without signature verification (fast local iteration)
      // - non-development: require Stripe signature verification
      // Optional hardening: set STRIPE_WEBHOOK_FORCE_VERIFY=true to require signatures in development too.
      if (process.env.NODE_ENV === "development" && !forceVerify) {
        event = typeof payload === "string" ? JSON.parse(payload) : payload;
      } else {
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !endpointSecret) {
          return res.status(400).send("Webhook secret not configured");
        }
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      }
    } catch (err: any) {
      console.error(`Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`[WEBHOOK] Received event: ${event.type}`);

    try {
      switch (event.type) {
        case "invoice.payment_succeeded":
          const invoice = event.data.object;
          console.log(`[WEBHOOK] Invoice ${invoice.id} payment succeeded`);

          if (invoice.subscription && stripe) {
            // Retrieve the subscription to get full details
            const subscription = await stripe.subscriptions.retrieve(
              invoice.subscription as string,
            );
            if (subscription && subscription.status === "active") {
              console.log(
                `[WEBHOOK] Subscription ${subscription.id} is now active for customer ${subscription.customer}`,
              );

              // Find user by subscription ID (more reliable than customer ID)
              const user = await storage.getUserByStripeSubscriptionId(
                subscription.id,
              );

              if (user) {
                try {
                  const { createAffiliateCommissionsForSubscription } =
                    await import("./affiliateCommissionService");
                  await createAffiliateCommissionsForSubscription(
                    user.id,
                    invoice.total,
                    invoice.id,
                  );
                } catch (commissionError) {
                  console.error(
                    "[WEBHOOK] Error processing affiliate commissions:",
                    commissionError,
                  );
                }
              }

              if (user) {
                console.log(
                  `[WEBHOOK] Found user ${user.id} (${user.email}) - ensuring subscription is active`,
                );

                // Make sure the user has the subscription ID stored
                // (it should already be there from initialization, but this ensures consistency)
                if (
                  !user.stripeSubscriptionId ||
                  user.stripeSubscriptionId !== subscription.id
                ) {
                  await storage.updateUser(user.id, {
                    stripeSubscriptionId: subscription.id,
                    stripeCustomerId: subscription.customer as string,
                  });
                  console.log(
                    `[WEBHOOK] Updated user ${user.id} with subscription ID ${subscription.id}`,
                  );
                } else {
                  console.log(
                    `[WEBHOOK] User ${user.id} subscription already properly configured`,
                  );
                }
              } else {
                console.log(
                  `[WEBHOOK] Warning: No user found for subscription ${subscription.id}`,
                );
              }
            }
          }
          break;
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${paymentIntent.id} succeeded`);

          try {
            const { eventBookings, events, restaurants, hosts } =
              await import("@shared/schema");
            const metadata = paymentIntent.metadata || {};

            // Supplier marketplace order payment
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                const [order] = await db
                  .select()
                  .from(supplierOrders)
                  .where(eq(supplierOrders.id, String(supplierOrderId)))
                  .limit(1);
                if (order) {
                  // Idempotent: only mark paid if not already.
                  if (String((order as any).paymentStatus || "") !== "paid") {
                    await db
                      .update(supplierOrders)
                      .set({
                        paymentStatus: "paid",
                        updatedAt: new Date(),
                      } as any)
                      .where(eq(supplierOrders.id, String(supplierOrderId)));
                  }
                }
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order update failed:",
                  supplierError,
                );
              }
              break;
            }

            const passId = metadata.passId;
            const truckId = metadata.truckId;

            if (!passId || !truckId) {
              break;
            }

            const amountCents =
              Number(metadata.totalCents) || Number(paymentIntent.amount || 0);

            const intentRows = await db
              .select()
              .from(eventBookings)
              .where(
                and(
                  eq(eventBookings.stripePaymentIntentId, paymentIntent.id),
                  eq(eventBookings.truckId, truckId),
                ),
              );
            const pendingHolds = intentRows.filter(
              (row: (typeof intentRows)[number]) => row.status === "pending",
            );
            const alreadyProcessed = intentRows.some(
              (row: (typeof intentRows)[number]) =>
                row.status === "confirmed" ||
                (row.status === "cancelled" && row.refundStatus === "credit"),
            );
            if (alreadyProcessed) {
              break;
            }

            const [eventRow] = await db
              .select()
              .from(events)
              .where(eq(events.id, passId));

            if (!eventRow || !eventRow.requiresPayment) {
              break;
            }

            const [host] = await db
              .select()
              .from(hosts)
              .where(eq(hosts.id, eventRow.hostId));
            const bookingTimeZone = resolveCityTimeZoneSync({
              city: host?.city,
              state: host?.state,
            });

            const slotTypes = String(
              metadata.slotTypes || metadata.slotType || "",
            )
              .split(",")
              .map((value) => value.trim().toLowerCase())
              .filter((value) => value.length > 0)
              .filter((value) =>
                PARKING_PASS_SLOT_TYPES.includes(value as any),
              );
            const normalizedSlotTypes =
              slotTypes.length > 0 ? slotTypes : ["daily"];

            const hasMonthly = normalizedSlotTypes.includes("monthly");
            const hasWeekly = normalizedSlotTypes.includes("weekly");
            const hasDaily = normalizedSlotTypes.includes("daily");
            const bookingDays = Math.max(
              1,
              Number(
                metadata.bookingDays ||
                  (hasMonthly
                    ? PARKING_PASS_BOOKING_DAYS.monthly
                    : hasWeekly
                      ? PARKING_PASS_BOOKING_DAYS.weekly
                      : hasDaily
                        ? PARKING_PASS_BOOKING_DAYS.daily
                        : 1),
              ),
            );

            const startDateKey = metadata.bookingStartDate
              ? String(metadata.bookingStartDate)
              : dateKeyInZone(new Date(eventRow.date), bookingTimeZone);
            const rangeStart = utcDateFromDateKey(startDateKey);
            const rangeEnd = new Date(rangeStart);
            rangeEnd.setDate(rangeEnd.getDate() + bookingDays);

            const bookingEvents: Array<typeof events.$inferSelect> = await db
              .select()
              .from(events)
              .where(
                and(
                  eq(events.hostId, eventRow.hostId),
                  eq(events.requiresPayment, true),
                  gte(events.date, rangeStart),
                  lt(events.date, rangeEnd),
                ),
              )
              .orderBy(asc(events.date));

            const eventsByDate = new Map<
              string,
              (typeof bookingEvents)[number]
            >();
            for (const row of bookingEvents) {
              const dateKey = dateKeyInZone(
                new Date(row.date),
                bookingTimeZone,
              );
              eventsByDate.set(dateKey, row);
            }

            const expectedDateKeys: string[] = [];
            for (let offset = 0; offset < bookingDays; offset += 1) {
              expectedDateKeys.push(addDaysToDateKey(startDateKey, offset));
            }

            const metadataHostPriceCents = Number(metadata.hostPriceCents || 0);
            const metadataPlatformFeeCents = Number(
              metadata.platformFeeCents || 0,
            );
            let cancelled = false;
            const cancelWithCredit = async (reason: string) => {
              if (cancelled) return;
              cancelled = true;
              const [truck] = await db
                .select({ ownerId: restaurants.ownerId })
                .from(restaurants)
                .where(eq(restaurants.id, truckId));

              if (truck?.ownerId) {
                const { addCredit } = await import("./creditService");
                await addCredit(
                  truck.ownerId,
                  amountCents / 100,
                  reason,
                  paymentIntent.id,
                );
              }

              // If we created pending holds ahead of payment, update them instead of inserting,
              // otherwise the unique constraint (event_id, truck_id) can fail.
              if (intentRows.length > 0) {
                const now = new Date();
                for (const row of intentRows) {
                  await db
                    .update(eventBookings)
                    .set({
                      status: "cancelled",
                      stripePaymentStatus: "succeeded",
                      refundStatus: "credit",
                      refundAmountCents: row.totalCents,
                      refundedAt: now,
                      refundReason: "Credit issued",
                      cancelledAt: now,
                      cancellationReason: "Overbooked - credit issued",
                      updatedAt: now,
                    })
                    .where(eq(eventBookings.id, row.id));
                }
                return;
              }

              try {
                await db
                  .insert(eventBookings)
                  .values({
                    eventId: passId,
                    truckId,
                    hostId: eventRow.hostId,
                    hostPriceCents: metadataHostPriceCents,
                    platformFeeCents: metadataPlatformFeeCents,
                    totalCents: amountCents,
                    status: "cancelled",
                    stripePaymentIntentId: paymentIntent.id,
                    stripePaymentStatus: "succeeded",
                    stripeApplicationFeeAmount: metadataPlatformFeeCents,
                    stripeTransferDestination:
                      host?.stripeConnectAccountId || null,
                    slotType: normalizedSlotTypes.join(","),
                    refundStatus: "credit",
                    refundAmountCents: amountCents,
                    refundedAt: new Date(),
                    refundReason: "Overbooked",
                    cancelledAt: new Date(),
                    cancellationReason: "Overbooked - credit issued",
                  })
                  .onConflictDoNothing();
              } catch (error) {
                console.warn(
                  "[WEBHOOK] Unable to insert cancelled booking row after credit:",
                  error,
                );
              }
            };

            const missingDates = expectedDateKeys.filter(
              (dateKey) => !eventsByDate.has(dateKey),
            );
            if (missingDates.length > 0) {
              await cancelWithCredit("parking_pass_overbook");
              break;
            }

            for (const dateKey of expectedDateKeys) {
              const row = eventsByDate.get(dateKey);
              if (!row) continue;
              if (row.status !== "open") {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              for (const slotType of normalizedSlotTypes) {
                if (
                  !isSlotWithinHours(
                    slotType as any,
                    row.startTime,
                    row.endTime,
                  )
                ) {
                  await cancelWithCredit("parking_pass_overbook");
                  break;
                }
              }
              if (cancelled) {
                break;
              }
            }
            if (cancelled) {
              break;
            }

            const eventIds = bookingEvents.map((row) => row.id);
            const counts =
              eventIds.length > 0
                ? await db
                    .select({
                      eventId: eventBookings.eventId,
                      count: sql<number>`count(*)`,
                    })
                    .from(eventBookings)
                    .where(inArray(eventBookings.eventId, eventIds))
                    .where(inArray(eventBookings.status, ["confirmed"]))
                    .groupBy(eventBookings.eventId)
                : [];

            const countsByEvent = new Map<string, number>();
            for (const row of counts) {
              countsByEvent.set(row.eventId, Number(row.count || 0));
            }

            for (const dateKey of expectedDateKeys) {
              const row = eventsByDate.get(dateKey);
              if (!row) continue;
              const count = countsByEvent.get(row.id) ?? 0;
              if (count >= (row.maxTrucks ?? 1)) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }
            }
            if (cancelled) {
              break;
            }

            const existingTruckBooking = await db
              .select({ id: eventBookings.id })
              .from(eventBookings)
              .where(inArray(eventBookings.eventId, eventIds))
              .where(eq(eventBookings.truckId, truckId))
              .where(inArray(eventBookings.status, ["confirmed"]))
              .limit(1);

            if (existingTruckBooking.length > 0) {
              await cancelWithCredit("parking_pass_duplicate");
              break;
            }

            const splitAmount = (total: number, days: number) => {
              if (days <= 1) return [total];
              const base = Math.floor(total / days);
              const remainder = total - base * days;
              return Array.from({ length: days }, (_, index) =>
                index === 0 ? base + remainder : base,
              );
            };

            const hostPriceCents = Number(metadata.hostPriceCents || 0);
            const platformFeeCents = Number(metadata.platformFeeCents || 0);
            const hostSplit = splitAmount(hostPriceCents, bookingDays);
            const platformSplit = splitAmount(platformFeeCents, bookingDays);

            const confirmedBookings = await db
              .select({
                eventId: eventBookings.eventId,
                spotNumber: eventBookings.spotNumber,
                bookingConfirmedAt: eventBookings.bookingConfirmedAt,
              })
              .from(eventBookings)
              .where(inArray(eventBookings.eventId, eventIds))
              .where(inArray(eventBookings.status, ["confirmed"]))
              .orderBy(asc(eventBookings.bookingConfirmedAt));

            const bookingsByEvent = new Map<
              string,
              (typeof confirmedBookings)[number][]
            >();
            for (const row of confirmedBookings) {
              const list = bookingsByEvent.get(row.eventId) ?? [];
              list.push(row);
              bookingsByEvent.set(row.eventId, list);
            }

            const now = new Date();
            // If the PaymentIntent succeeded but we no longer have pending holds
            // (e.g. hold expired or was cancelled), do NOT confirm a booking.
            // Instead, issue credits and mark the rows cancelled so we don't create ghost bookings.
            if (intentRows.length > 0 && pendingHolds.length === 0) {
              await cancelWithCredit("parking_pass_hold_expired");
              break;
            }

            const usesHolds = pendingHolds.length > 0;
            let bookingConfirmed = false;
            const newlyConfirmedByEventId = new Map<string, number>();
            const incrementNewlyConfirmed = (eventId: string) => {
              newlyConfirmedByEventId.set(
                eventId,
                (newlyConfirmedByEventId.get(eventId) ?? 0) + 1,
              );
            };
            const earnedEntries: Array<{
              hostId: string;
              bookingId: string;
              amountCents: number;
            }> = [];

            if (usesHolds) {
              const holdsByEventId = new Map<
                string,
                (typeof pendingHolds)[number]
              >();
              for (const row of pendingHolds) {
                holdsByEventId.set(row.eventId, row);
              }

              const plannedUpdates = expectedDateKeys.map((dateKey, index) => {
                const row = eventsByDate.get(dateKey);
                if (!row) return null;
                const hold = holdsByEventId.get(row.id);
                if (!hold) return null;

                const bookedRows = bookingsByEvent.get(row.id) ?? [];
                const usedSpotNumbers = new Set<number>();
                for (const booked of bookedRows) {
                  if (booked.spotNumber && booked.spotNumber > 0) {
                    usedSpotNumbers.add(booked.spotNumber);
                  }
                }
                let spotNumber = 1;
                while (usedSpotNumbers.has(spotNumber)) {
                  spotNumber += 1;
                }
                if (spotNumber > row.maxTrucks) {
                  return null;
                }

                // Ensure deterministic assignment for subsequent days in this loop.
                bookedRows.push({
                  eventId: row.id,
                  spotNumber,
                  bookingConfirmedAt: now,
                });
                bookingsByEvent.set(row.id, bookedRows);

                const hostCents = hostSplit[index] ?? 0;
                const feeCents = platformSplit[index] ?? 0;

                return {
                  id: hold.id,
                  eventId: row.id,
                  hostId: row.hostId,
                  hostCents,
                  feeCents,
                  spotNumber,
                };
              });

              const filtered = plannedUpdates.filter(
                (row): row is NonNullable<(typeof plannedUpdates)[number]> =>
                  Boolean(row),
              );

              if (filtered.length !== expectedDateKeys.length) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              for (const update of filtered) {
                await db
                  .update(eventBookings)
                  .set({
                    eventId: update.eventId,
                    truckId,
                    hostId: eventRow.hostId,
                    hostPriceCents: update.hostCents,
                    platformFeeCents: update.feeCents,
                    totalCents: update.hostCents + update.feeCents,
                    status: "confirmed",
                    stripePaymentIntentId: paymentIntent.id,
                    stripePaymentStatus: "succeeded",
                    stripeApplicationFeeAmount: update.feeCents,
                    stripeTransferDestination:
                      host?.stripeConnectAccountId || null,
                    slotType: normalizedSlotTypes.join(","),
                    paidAt: now,
                    bookingConfirmedAt: now,
                    spotNumber: update.spotNumber,
                    updatedAt: now,
                  })
                  .where(eq(eventBookings.id, update.id));

                incrementNewlyConfirmed(update.eventId);

                if (update.hostCents > 0) {
                  earnedEntries.push({
                    hostId: update.hostId,
                    bookingId: update.id,
                    amountCents: update.hostCents,
                  });
                }
              }
              bookingConfirmed = true;
            } else {
              const bookingRows = expectedDateKeys.map((dateKey, index) => {
                const row = eventsByDate.get(dateKey);
                if (!row) return null;

                const bookedRows = bookingsByEvent.get(row.id) ?? [];
                const usedSpotNumbers = new Set<number>();
                for (const booked of bookedRows) {
                  if (booked.spotNumber && booked.spotNumber > 0) {
                    usedSpotNumbers.add(booked.spotNumber);
                  }
                }
                let spotNumber = 1;
                while (usedSpotNumbers.has(spotNumber)) {
                  spotNumber += 1;
                }
                if (spotNumber > row.maxTrucks) {
                  return null;
                }

                const hostCents = hostSplit[index] ?? 0;
                const feeCents = platformSplit[index] ?? 0;

                return {
                  eventId: row.id,
                  truckId,
                  hostId: row.hostId,
                  hostPriceCents: hostCents,
                  platformFeeCents: feeCents,
                  totalCents: hostCents + feeCents,
                  status: "confirmed",
                  stripePaymentIntentId: paymentIntent.id,
                  stripePaymentStatus: "succeeded",
                  stripeApplicationFeeAmount: feeCents,
                  stripeTransferDestination:
                    host?.stripeConnectAccountId || null,
                  slotType: normalizedSlotTypes.join(","),
                  paidAt: now,
                  bookingConfirmedAt: now,
                  spotNumber,
                };
              });

              const filteredRows = bookingRows.filter(
                (row): row is NonNullable<(typeof bookingRows)[number]> =>
                  Boolean(row),
              );

              if (filteredRows.length !== expectedDateKeys.length) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              const insertedRows = await db
                .insert(eventBookings)
                .values(filteredRows)
                .onConflictDoNothing()
                .returning({
                  id: eventBookings.id,
                  hostId: eventBookings.hostId,
                  hostPriceCents: eventBookings.hostPriceCents,
                });

              if (insertedRows.length === 0) {
                const existingRows = await db
                  .select({
                    id: eventBookings.id,
                    eventId: eventBookings.eventId,
                    hostId: eventBookings.hostId,
                    hostPriceCents: eventBookings.hostPriceCents,
                  })
                  .from(eventBookings)
                  .where(inArray(eventBookings.eventId, eventIds))
                  .where(eq(eventBookings.truckId, truckId))
                  .where(eq(eventBookings.stripePaymentIntentId, paymentIntent.id))
                  .where(eq(eventBookings.status, "confirmed"));

                if (existingRows.length === expectedDateKeys.length) {
                  bookingConfirmed = true;
                  for (const row of existingRows) {
                    incrementNewlyConfirmed(row.eventId);
                  }
                } else {
                  await cancelWithCredit("parking_pass_duplicate");
                  break;
                }
              }

              if (insertedRows.length > 0) {
                for (const row of filteredRows) {
                  incrementNewlyConfirmed(row.eventId);
                }
              }

              for (const row of insertedRows) {
                if (Number(row.hostPriceCents || 0) > 0) {
                  earnedEntries.push({
                    hostId: row.hostId,
                    bookingId: row.id,
                    amountCents: Number(row.hostPriceCents || 0),
                  });
                }
              }

              bookingConfirmed = true;
            }

            if (bookingConfirmed) {
              try {
                const { recordHostBookingEarnings } =
                  await import("./hostEarningsService");
                await recordHostBookingEarnings(
                  earnedEntries.map((entry) => ({
                    ...entry,
                    stripePaymentIntentId: paymentIntent.id,
                  })),
                );
              } catch (ledgerError) {
                console.error(
                  "[WEBHOOK] Error recording host earnings ledger entries:",
                  ledgerError,
                );
              }

              try {
                const truck = await storage.getRestaurant(truckId);
                const owner = truck
                  ? await storage.getUser(truck.ownerId)
                  : null;
                if (owner?.email) {
                  const endDateKey =
                    expectedDateKeys[expectedDateKeys.length - 1] ||
                    startDateKey;
                  await emailService.sendBookingConfirmationEmail({
                    to: owner.email,
                    hostName: host?.businessName || "Host location",
                    startDate: startDateKey,
                    endDate: endDateKey,
                    slotSummary: normalizedSlotTypes.join(", "),
                    totalCents: amountCents,
                  });
                }

                // Best-effort: mark one-time booking-fee promo as redeemed.
                try {
                  const promoCode = String(
                    metadata.bookingPromoCode || "",
                  ).trim().toUpperCase();
                  if (promoCode === "BOOKFEE10") {
                    const explicitUserId = String(metadata.userId || "").trim();
                    const promoUserId = explicitUserId || owner?.id || "";
                    if (promoUserId) {
                      const userRecord = await storage.getUser(promoUserId);
                      const settings = (userRecord?.accountSettings as any) || {};
                      const promos = settings.promos || {};
                      const bookingFee10 = promos.bookingFee10 || {};
                      promos.bookingFee10 = {
                        ...bookingFee10,
                        redeemedAt: now.toISOString(),
                        redeemedPaymentIntentId: paymentIntent.id,
                        discountCents: Number(
                          metadata.bookingPromoDiscountCents || 0,
                        ),
                        pendingPaymentIntentId: null,
                        pendingAt: null,
                      };
                      await storage.updateUser(promoUserId, {
                        accountSettings: { ...settings, promos } as any,
                      });
                    }
                  }
                } catch (promoError) {
                  console.error(
                    "[WEBHOOK] Error persisting booking promo redemption:",
                    promoError,
                  );
                }
              } catch (emailError) {
                console.error(
                  "[WEBHOOK] Error sending booking confirmation:",
                  emailError,
                );
              }
            }

            try {
              const creditAppliedCents = Number(
                metadata.creditAppliedCents || 0,
              );
              if (creditAppliedCents > 0) {
                const [truck] = await db
                  .select({ ownerId: restaurants.ownerId })
                  .from(restaurants)
                  .where(eq(restaurants.id, truckId));

                if (truck?.ownerId) {
                  const { debitCredit, getUserCreditBalance } =
                    await import("./creditService");
                  const balance = await getUserCreditBalance(truck.ownerId);
                  const availableCents = Math.max(0, Math.floor(balance * 100));
                  const debitCents = Math.min(
                    creditAppliedCents,
                    availableCents,
                  );
                  if (debitCents > 0) {
                    await debitCredit(
                      truck.ownerId,
                      debitCents / 100,
                      "booking_credit",
                      paymentIntent.id,
                      "booking",
                    );
                  }
                }
              }
            } catch (creditError) {
              console.error(
                "[WEBHOOK] Error debiting booking credits:",
                creditError,
              );
            }

            try {
              const [truckOwner] = await db
                .select({ ownerId: restaurants.ownerId })
                .from(restaurants)
                .where(eq(restaurants.id, truckId));

              if (host?.userId && truckOwner?.ownerId) {
                const { createAffiliateCommissionsForBooking } =
                  await import("./affiliateCommissionService");
                await createAffiliateCommissionsForBooking({
                  hostOwnerId: host.userId,
                  truckOwnerId: truckOwner.ownerId,
                  platformFeeCents,
                  paymentIntentId: paymentIntent.id,
                  truckRestaurantId: truckId,
                });
              }
            } catch (commissionError) {
              console.error(
                "[WEBHOOK] Error processing booking affiliate commissions:",
                commissionError,
              );
            }

            const affectedEventIds = Array.from(
              new Set(
                expectedDateKeys
                  .map((dateKey) => eventsByDate.get(dateKey)?.id)
                  .filter((id): id is string => Boolean(id)),
              ),
            );
            if (affectedEventIds.length === 0) {
              affectedEventIds.push(passId);
            }

            const maxTrucksByEventId = new Map<string, number>();
            const bookingEventsById = new Map<
              string,
              (typeof bookingEvents)[number]
            >();
            for (const row of bookingEvents) {
              maxTrucksByEventId.set(row.id, row.maxTrucks ?? 1);
              bookingEventsById.set(row.id, row);
            }

            const countRows =
              affectedEventIds.length > 0
                ? await db
                    .select({
                      eventId: eventBookings.eventId,
                      count: sql<number>`count(*)`,
                    })
                    .from(eventBookings)
                    .where(inArray(eventBookings.eventId, affectedEventIds))
                    .where(inArray(eventBookings.status, ["confirmed"]))
                    .groupBy(eventBookings.eventId)
                : [];

            const confirmedByEventId = new Map<string, number>();
            for (const row of countRows) {
              confirmedByEventId.set(row.eventId, Number(row.count || 0));
            }

            for (const eventId of affectedEventIds) {
              const confirmedCount = confirmedByEventId.get(eventId) ?? 0;
              const maxTrucks = maxTrucksByEventId.get(eventId) ?? 1;
              const newlyConfirmed = newlyConfirmedByEventId.get(eventId) ?? 0;
              const previousCount = Math.max(
                0,
                confirmedCount - newlyConfirmed,
              );
              const previousFillRate =
                maxTrucks > 0 ? previousCount / maxTrucks : 0;
              const currentFillRate =
                maxTrucks > 0 ? confirmedCount / maxTrucks : 0;
              const crossedWarningThreshold =
                previousFillRate < 0.8 && currentFillRate >= 0.8;
              const crossedFullThreshold =
                previousCount < maxTrucks && confirmedCount >= maxTrucks;
              const newStatus = confirmedCount >= maxTrucks ? "filled" : "open";

              if (crossedWarningThreshold || crossedFullThreshold) {
                const eventRowForNotify = bookingEventsById.get(eventId);
                if (eventRowForNotify) {
                  try {
                    await notifyHostCapacityWarning({
                      hostId: eventRowForNotify.hostId,
                      eventId,
                      eventStartDate: eventRowForNotify.date ?? null,
                      confirmedCount,
                      maxTrucks,
                    });
                  } catch (notifyError) {
                    console.error(
                      "[WEBHOOK] Error sending host capacity warning:",
                      notifyError,
                    );
                  }
                }
              }

              await db
                .update(events)
                .set({
                  status: newStatus,
                  bookedRestaurantId: null,
                })
                .where(eq(events.id, eventId));
            }
          } catch (error) {
            console.error("[WEBHOOK] Error confirming booking:", error);
          }
          break;

        case "payment_intent.payment_failed":
          const failedIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${failedIntent.id} failed`);

          try {
            const { eventBookings } = await import("@shared/schema");
            const metadata = (failedIntent as any).metadata || {};

            // Supplier marketplace order payment failure
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                await db
                  .update(supplierOrders)
                  .set({
                    paymentStatus: "unpaid",
                    updatedAt: new Date(),
                  } as any)
                  .where(eq(supplierOrders.id, String(supplierOrderId)));
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order failure update failed:",
                  supplierError,
                );
              }
              break;
            }

            await db
              .update(eventBookings)
              .set({
                status: "cancelled",
                stripePaymentStatus: "failed",
                cancellationReason: "Payment failed",
                cancelledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(eventBookings.stripePaymentIntentId, failedIntent.id));
          } catch (error) {
            console.error("[WEBHOOK] Error updating failed booking:", error);
          }
          break;

        case "customer.subscription.updated":
          const subscriptionUpdated = event.data.object;
          console.log(
            `[WEBHOOK] Subscription ${subscriptionUpdated.id} updated to status: ${subscriptionUpdated.status}`,
          );

          // Find user by subscription ID
          const userForUpdate = await storage.getUserByStripeSubscriptionId(
            subscriptionUpdated.id,
          );

          if (userForUpdate) {
            console.log(
              `[WEBHOOK] Found user ${userForUpdate.id} for subscription ${subscriptionUpdated.id}`,
            );

            // If subscription becomes inactive or canceled, we might want to handle it
            // For now, we rely on real-time checks in validateSubscriptionLimits
            if (
              subscriptionUpdated.status === "canceled" ||
              subscriptionUpdated.status === "incomplete_expired"
            ) {
              console.log(
                `[WEBHOOK] Subscription ${subscriptionUpdated.id} is now ${subscriptionUpdated.status} for user ${userForUpdate.id}`,
              );
              // The validateSubscriptionLimits function will catch this on next deal creation attempt
            } else if (subscriptionUpdated.status === "active") {
              console.log(
                `[WEBHOOK] Subscription ${subscriptionUpdated.id} is active for user ${userForUpdate.id}`,
              );
            }
          } else {
            console.log(
              `[WEBHOOK] Warning: No user found for subscription ${subscriptionUpdated.id}`,
            );
          }
          break;

        case "customer.subscription.deleted":
          const subscriptionDeleted = event.data.object;
          console.log(
            `[WEBHOOK] Subscription ${subscriptionDeleted.id} was deleted`,
          );

          // Find user and clear their subscription
          const userForDeletion = await storage.getUserByStripeSubscriptionId(
            subscriptionDeleted.id,
          );

          if (userForDeletion) {
            console.log(
              `[WEBHOOK] Clearing subscription for user ${userForDeletion.id}`,
            );
            await storage.updateUser(userForDeletion.id, {
              stripeSubscriptionId: null,
            });
            console.log(
              `[WEBHOOK] Subscription cleared for user ${userForDeletion.id} (${userForDeletion.email})`,
            );
          } else {
            console.log(
              `[WEBHOOK] Warning: No user found for deleted subscription ${subscriptionDeleted.id}`,
            );
          }
          break;

        case "account.updated": {
          const account = event.data.object as Stripe.Account;
          const accountId = String(account.id || "").trim();
          if (!accountId) break;

          const status =
            account.charges_enabled && account.payouts_enabled
              ? "active"
              : "pending";
          const updateValues = {
            stripeChargesEnabled: Boolean(account.charges_enabled),
            stripePayoutsEnabled: Boolean(account.payouts_enabled),
            stripeOnboardingCompleted: Boolean(account.details_submitted),
            stripeConnectStatus: status,
            updatedAt: new Date(),
          } as any;

          const hostUpdate = await db
            .update(hosts)
            .set(updateValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(updateValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const hostRows = Number((hostUpdate as any)?.rowCount || 0);
          const supplierRows = Number((supplierUpdate as any)?.rowCount || 0);
          console.log(
            `[WEBHOOK] Synced Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows})`,
          );
          break;
        }

        case "account.application.deauthorized": {
          const deauth = event.data.object as any;
          const accountId = String(deauth?.account || "").trim();
          if (!accountId) break;

          const revokedValues = {
            stripeConnectStatus: "revoked",
            stripeOnboardingCompleted: false,
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            updatedAt: new Date(),
          } as any;

          const hostUpdate = await db
            .update(hosts)
            .set(revokedValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(revokedValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const hostRows = Number((hostUpdate as any)?.rowCount || 0);
          const supplierRows = Number((supplierUpdate as any)?.rowCount || 0);
          console.log(
            `[WEBHOOK] Deauthorized Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows})`,
          );
          break;
        }

        default:
          console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("[WEBHOOK] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Admin API endpoints
  registerAdminManagementRoutes(app);
  registerGeoAdRoutes(app);
  registerHostPayoutAdminRoutes(app);

  // Staff management and user creation endpoints
  registerStaffRoutes(app);

  // Handle frequent HEAD /api requests efficiently (likely from monitoring)
  app.head("/api", (req, res) => {
    res.status(200).end();
  });

  const resolveSitemapSiteUrl = () => {
    const normalizeCandidate = (raw?: string | null): string | null => {
      const value = String(raw || "").trim();
      if (!value) return null;
      try {
        const withProtocol = /^[a-z]+:\/\//i.test(value)
          ? value
          : `https://${value}`;
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return null;
        }
        const hostname = parsed.hostname.toLowerCase();
        const bareHost = hostname.replace(/^www\./, "");
        // Only allow first-party website hosts in sitemap/robots output.
        if (bareHost !== "mealscout.us") return null;
        return "https://www.mealscout.us";
      } catch {
        return null;
      }
    };

    return (
      normalizeCandidate(process.env.SITEMAP_SITE_URL) ||
      normalizeCandidate(process.env.CLIENT_ORIGIN) ||
      normalizeCandidate(process.env.PUBLIC_BASE_URL) ||
      "https://www.mealscout.us"
    );
  };

  // Register video stories routes (MVP Phase 1)
  const setupStoriesRoutes = (await import("./storiesRoutes")).default;
  setupStoriesRoutes(app);

  // Register incident management routes (admin-only)
  const incidentRoutes = (await import("./incidentRoutes")).default;
  app.use("/api/incidents", incidentRoutes);
  registerSystemUtilityRoutes(app, { incidentRoutes });

  // Register admin control center routes (admin-only)
  const adminRoutes = (await import("./adminRoutes")).default;
  app.use("/api/admin", adminRoutes);

  // Register admin telemetry routes (admin-only)
  const telemetryRoutes = (await import("./telemetryRoutes")).default;
  app.use("/api/admin/telemetry", telemetryRoutes);

  // Register evidence export routes (admin-only)
  const evidenceExportRoutes = (await import("./evidenceExportRoutes")).default;
  app.use("/api/admin", evidenceExportRoutes);

  // Register affiliate system routes
  const affiliateRoutes = (await import("./affiliateRoutes")).default;
  app.use("/api/affiliate", affiliateRoutes);

  // Register payout preferences routes
  const setupPayoutRoutes = (await import("./payoutRoutes")).default;
  setupPayoutRoutes(app);

  // Register empty county experience routes (Phase 6)
  const setupEmptyCountyRoutes = (await import("./emptyCountyRoutes")).default;
  setupEmptyCountyRoutes(app);

  // Register share link routes (Phase 7)
  const setupShareRoutes = (await import("./shareRoutes")).default;
  setupShareRoutes(app);

  // Register user routes (balance, search)
  const userRoutes = (await import("./userRoutes")).default;
  app.use("/api/users", userRoutes);

  // Register redemption routes (Phase R1)
  const redemptionRoutes = (await import("./redemptionRoutes")).default;
  app.use("/api/restaurants", redemptionRoutes);

  // Add share middleware (Phase 7) - adds shareUrl helpers to all handlers
  const { shareUrlMiddleware } = await import("./shareMiddleware");
  app.use(shareUrlMiddleware);

  const httpServer = createServer(app);
  return httpServer;
}

