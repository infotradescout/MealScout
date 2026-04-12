import type { Express } from "express";
import { createServer, type Server } from "http";
import {
  getParkingPassOnboardingQueue,
  getParkingPassPricingAudit,
  repairParkingPassPricingDrift,
} from "./parkingPassReminder";
import { getLocationDemandFunnelKpis } from "./services/locationDemandActivation";
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
  restaurantSubscriptions,
  truckInterests,
  suppliers,
  socialPostQueue,
} from "@shared/schema";
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
import { registerGrowthRoutes } from "./routes/growthRoutes";
import { registerHostInterestRoutes } from "./routes/hostInterestRoutes";
import { registerPublicDiscoveryRoutes } from "./routes/publicDiscoveryRoutes";
import { registerPublicMapRoutes } from "./routes/publicMapRoutes";
import { registerRestaurantCoreRoutes } from "./routes/restaurantCoreRoutes";
import { registerRestaurantOperationsRoutes } from "./routes/restaurantOperationsRoutes";
import { registerRestaurantSignupRoutes } from "./routes/restaurantSignupRoutes";
import { registerPublicSearchRoutes } from "./routes/publicSearchRoutes";
import { registerSeoRoutes } from "./routes/seoRoutes";
import { registerSubscriptionRoutes } from "./routes/subscriptionRoutes";
import { registerRuntimeBootstrapRoutes } from "./routes/runtimeBootstrapRoutes";
import { registerStripeWebhookRoutes } from "./routes/stripeWebhookRoutes";
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

    if (await hasLifetimeRestaurantAccess(userId)) {
      return { hasAccess: true, subscriptionTier: "lifetime" };
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

    if (await hasLifetimeRestaurantAccess(userId)) {
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
      } else if (await hasLifetimeRestaurantAccess(key)) {
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

async function hasLifetimeRestaurantAccess(userId: string): Promise<boolean> {
  const ownerId = String(userId || "").trim();
  if (!ownerId) return false;
  try {
    const rows = await db
      .select({ id: restaurantSubscriptions.id })
      .from(restaurantSubscriptions)
      .innerJoin(
        restaurants,
        eq(restaurantSubscriptions.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurants.ownerId, ownerId),
          eq(restaurantSubscriptions.isLifetimeFree, true),
          eq(restaurantSubscriptions.status, "active"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    console.warn("[subscription] Failed lifetime access lookup", {
      userId: ownerId,
      error: (error as any)?.message || error,
    });
    return false;
  }
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
  await setupUnifiedAuth(app);

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
    hasBusinessDistributionAccess,
    queueSocialPost,
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
  registerEventRoutes(app, { hasBusinessDistributionAccess });
  registerDiscoveryRoutes(app);
  registerEventCoordinatorRoutes(app, { hasBusinessDistributionAccess });

  // Booking Management
  registerBookingRoutes(app, { hasBusinessDistributionAccess });

  // Supplier marketplace (suppliers + food truck pickup orders)
  registerSupplierMarketplaceRoutes(app);
  if (String(process.env.ENABLE_SUPPLY_SCOUT || "").toLowerCase() === "true") {
    registerSupplyScoutRoutes(app);
  }
  registerStripeWebhookRoutes(app, { notifyHostCapacityWarning });

  // Admin API endpoints
  registerAdminManagementRoutes(app);
  registerGeoAdRoutes(app);
  registerHostPayoutAdminRoutes(app);
  registerGrowthRoutes(app);
  // Staff management and user creation endpoints
  registerStaffRoutes(app);

  await registerRuntimeBootstrapRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
