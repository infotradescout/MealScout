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
import { forwardGeocode } from "./utils/geocoding";
import {
  computeParkingPassQualityFlags,
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
  isAuthenticated,
  isRestaurantOwner,
  isRestaurantOwnerOrAdmin,
  isAdmin,
  isStaffOrAdmin,
  verifyResourceOwnership,
} from "./unifiedAuth";
import { emailService, isEmailConfigured } from "./emailService";
import {
  insertRestaurantSchema,
  insertDealSchema,
  insertReviewSchema,
  insertVerificationRequestSchema,
  insertDealViewSchema,
  insertFoodTruckLocationSchema,
  updateRestaurantMobileSettingsSchema,
  insertFoodTruckSessionSchema,
  insertRestaurantFavoriteSchema,
  insertRestaurantFollowSchema,
  insertRestaurantRecommendationSchema,
  insertRestaurantUserRecommendationSchema,
  insertUserAddressSchema,
  insertPasswordResetTokenSchema,
  updateRestaurantLocationSchema,
  updateRestaurantOperatingHoursSchema,
  insertDealFeedbackSchema,
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
  eventSeries,
  hostEarningsLedger,
  hostPayoutRequests,
  insertImageUploadSchema,
  insertAwardHistorySchema,
  imageUploads,
  passwordResetTokens,
  users,
  userAddresses,
  locationRequests,
  restaurants,
  truckInterests,
  suppliers,
  supplierProducts,
  videoStories,
  truckImportListings,
  truckClaimRequests,
  awardHistory,
  socialPostQueue,
  searchQueryEvents,
} from "@shared/schema";
import {
  PARKING_PASS_BOOKING_DAYS,
  PARKING_PASS_SLOT_TYPES,
  isSlotWithinHours,
} from "@shared/parkingPassSlots";
import { z } from "zod";
import { validateDocuments, checkRateLimit } from "./documentValidation";
import { randomBytes, timingSafeEqual, createHash } from "crypto";
import { sanitizeUser } from "./utils/sanitize";
import { ensureAffiliateTag } from "./affiliateTagService";
import { sendAccountSetupInvite } from "./utils/accountSetup";
import { sendEmailVerificationIfNeeded } from "./utils/emailVerification";
import {
  isPasswordStrong,
  PASSWORD_REQUIREMENTS,
} from "./utils/passwordPolicy";
import {
  upload,
  uploadToCloudinary,
  deleteFromCloudinary,
  isCloudinaryConfigured,
} from "./imageUpload";
import {
  calculateUserInfluenceScore,
  checkGoldenForkEligibility,
  awardGoldenFork,
  calculateRestaurantRankingScore,
  awardGoldenPlatesForArea,
  getAreaLeaderboard,
  getUserRecommendationCount,
} from "./awardCalculations";
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
import { vacEvaluateRestaurantSignup } from "./vacLite";
import { broadcastLocationUpdate, broadcastStatusUpdate } from "./websocket";
import { reverseGeocode } from "./utils/geocoding";
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
import {
  getMapEndpointWatchdogSnapshot,
  runMapEndpointWatchdog,
} from "./mapEndpointWatchdog";

function normalizeSearchQuery(input: string) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function shouldDropSearchQuery(normalized: string) {
  if (!normalized || normalized.length < 2 || normalized.length > 80)
    return true;
  if (normalized.includes("@")) return true; // avoid storing emails
  if (normalized.includes("http://") || normalized.includes("https://"))
    return true; // avoid URLs
  if (normalized.includes("www.")) return true;
  if (/\d{7,}/.test(normalized)) return true; // likely phone/order/account style strings
  return false;
}

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

const publicProfileSettingsSchema = z.object({
  templatePreset: z.enum(["classic", "story", "bold", "minimal"]).optional(),
  theme: z.enum(["sunset", "slate", "forest", "amber"]).optional(),
  accentColor: z.string().max(32).optional(),
  fontFamily: z.enum(["system", "serif", "display", "mono"]).optional(),
  heroLayout: z.enum(["center", "left", "split"]).optional(),
  heroTitle: z.string().max(120).optional(),
  heroSubtitle: z.string().max(220).optional(),
  ctaLabel: z.string().max(50).optional(),
  ctaUrl: z.string().max(300).optional(),
  about: z.string().max(2000).optional(),
  highlights: z.array(z.string().max(120)).max(8).optional(),
  featuredLinks: z
    .array(
      z.object({
        label: z.string().max(40),
        url: z.string().max(300),
      }),
    )
    .max(8)
    .optional(),
  galleryUrls: z.array(z.string().max(500)).max(12).optional(),
  sectionOrder: z
    .array(
      z.enum([
        "about",
        "highlights",
        "links",
        "gallery",
        "contact",
        "location",
        "metrics",
      ]),
    )
    .max(12)
    .optional(),
  showAddress: z.boolean().optional(),
  showContact: z.boolean().optional(),
  showHours: z.boolean().optional(),
  hideProfileBadge: z.boolean().optional(),
});

const accountSettingsSchema = z.object({
  language: z.string().max(24).optional(),
  currency: z.string().max(12).optional(),
  locationServices: z.boolean().optional(),
  analytics: z.boolean().optional(),
  marketing: z.boolean().optional(),
  notifications: z
    .object({
      channels: z
        .object({
          push: z.boolean().optional(),
          email: z.boolean().optional(),
          sms: z.boolean().optional(),
        })
        .optional(),
      topics: z
        .object({
          dealAlerts: z.boolean().optional(),
          orderUpdates: z.boolean().optional(),
          newRestaurants: z.boolean().optional(),
          weeklyDigest: z.boolean().optional(),
          nearbyEvents: z.boolean().optional(),
        })
        .optional(),
      location: z
        .object({
          enabled: z.boolean().optional(),
          radiusKm: z.number().min(0.5).max(50).optional(),
          maxPerDay: z.number().int().min(1).max(50).optional(),
          quietHours: z
            .object({
              start: z.string().regex(/^\d{2}:\d{2}$/),
              end: z.string().regex(/^\d{2}:\d{2}$/),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  customDomain: z
    .object({
      hostname: z.string().max(255),
      status: z
        .enum(["unverified", "verified", "mismatch", "error"])
        .optional(),
      lastCheckedAt: z.string().optional(),
      expectedTarget: z.string().optional(),
      diagnostics: z.string().optional(),
    })
    .optional(),
});

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
  // Health check endpoint - responds immediately with 200 for deployment health checks
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: "MealScout API",
    });
  });

  // Public reverse-geocode helper for client-side location labeling.
  // This keeps third-party geocoding calls on the server side to avoid browser CORS failures.
  app.get("/api/location/reverse", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return res.status(400).json({ message: "Invalid lat/lng" });
    }

    try {
      const resolved = await reverseGeocode(lat, lng).catch(() => null);
      const city = String(resolved?.city || "").trim();
      const state = String(resolved?.state || "").trim();
      const label = [city, state].filter(Boolean).join(", ") || "Location";
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.json({
        city: city || null,
        state: state || null,
        label,
      });
    } catch (error) {
      console.error("Error reverse geocoding location:", error);
      return res.json({ city: null, state: null, label: "Location" });
    }
  });

  // Public forward-geocode helper for client-side address search/pinning.
  app.get("/api/location/search", async (req, res) => {
    const query = String(req.query.q || "").trim();
    const limitRaw = Number(req.query.limit || 1);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(5, Math.max(1, Math.floor(limitRaw)))
      : 1;
    if (!query) {
      return res.json([]);
    }

    try {
      const resolved = await forwardGeocode(query).catch(() => null);
      if (!resolved) return res.json([]);
      return res.json(
        [
          {
            lat: String(resolved.lat),
            lon: String(resolved.lng),
            display_name: query,
          },
        ].slice(0, limit),
      );
    } catch (error) {
      console.error("Error forward geocoding location:", error);
      return res.json([]);
    }
  });

  // Auth routes
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      console.log(
        "📋 /api/auth/user called, isAuthenticated:",
        req.isAuthenticated(),
      );
      console.log("📋 Session ID:", req.sessionID);
      console.log("📋 Session data:", req.session);

      if (!req.isAuthenticated()) {
        console.log("❌ User not authenticated");
        return res.status(401).json({ error: "Not authenticated" });
      }

      let user = req.user;

      // Safety: legacy/imported accounts may still be "customer" after creating a truck profile.
      // Correct the role so profile labels/navigation stay consistent.
      if (String(user?.userType || "") === "customer") {
        const ownedRestaurants = await storage.getRestaurantsByOwner(user.id);
        const hasFoodTruckProfile = ownedRestaurants.some(
          (row: any) =>
            Boolean(row?.isFoodTruck) ||
            String(row?.businessType || "").toLowerCase() === "food_truck",
        );

        if (hasFoodTruckProfile) {
          try {
            await storage.updateUserType(user.id, "food_truck");
            user = { ...user, userType: "food_truck" };
            req.user = user;
          } catch (roleFixError) {
            console.warn(
              "Unable to auto-correct userType to food_truck:",
              roleFixError,
            );
          }
        }
      }

      console.log("✅ Returning user:", user.id, user.email, user.userType);

      // Check if user must reset password
      const safeUser = sanitizeUser(user);

      if (user.mustResetPassword) {
        return res.json({ ...safeUser, requiresPasswordReset: true });
      }

      res.json(safeUser);
    } catch (error) {
      console.error("❌ Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/settings/me", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const [ownedRestaurants, ownedHosts, ownedSuppliers] = await Promise.all([
        storage.getRestaurantsByOwner(user.id),
        storage.getHostsByUserId(user.id),
        db
          .select({
            id: suppliers.id,
            businessName: suppliers.businessName,
            isActive: suppliers.isActive,
          })
          .from(suppliers)
          .where(eq(suppliers.userId, user.id)),
      ]);

      const profileLinks = [
        ...ownedRestaurants
          .filter((row: any) => row?.isActive)
          .map((row: any) => ({
            entity: "restaurant",
            id: row.id,
            title: row.name,
            path: `/p/restaurant/${row.id}/${toSlug(row.name) || row.id}`,
          })),
        ...ownedHosts.map((row: any) => ({
          entity: "host",
          id: row.id,
          title: row.businessName,
          path: `/p/host/${row.id}/${toSlug(row.businessName) || row.id}`,
        })),
        ...ownedSuppliers
          .filter((row: any) => row?.isActive)
          .map((row: any) => ({
            entity: "supplier",
            id: row.id,
            title: row.businessName,
            path: `/p/supplier/${row.id}/${toSlug(row.businessName) || row.id}`,
          })),
      ];

      res.json({
        accountSettings: user.accountSettings || {},
        publicProfileSettings: user.publicProfileSettings || {},
        profileLinks,
        media: {
          provider: isCloudinaryConfigured() ? "cloudinary" : "none",
          configured: isCloudinaryConfigured(),
        },
      });
    } catch (error) {
      console.error("Error fetching user settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings/me", isAuthenticated, async (req: any, res) => {
    try {
      const payloadSchema = z.object({
        accountSettings: accountSettingsSchema.optional(),
        publicProfileSettings: publicProfileSettingsSchema.optional(),
      });
      const parsed = payloadSchema.parse(req.body || {});
      const current = await storage.getUser(req.user.id);
      if (!current) {
        return res.status(404).json({ message: "User not found" });
      }

      const nextAccountSettings = {
        ...(current.accountSettings || {}),
        ...(parsed.accountSettings || {}),
      };
      const nextPublicProfileSettings = {
        ...(current.publicProfileSettings || {}),
        ...(parsed.publicProfileSettings || {}),
      };

      const updated = await storage.updateUser(req.user.id, {
        accountSettings: nextAccountSettings as any,
        publicProfileSettings: nextPublicProfileSettings as any,
      });

      res.json({
        accountSettings: updated.accountSettings || {},
        publicProfileSettings: updated.publicProfileSettings || {},
      });
    } catch (error: any) {
      console.error("Error updating user settings:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid settings payload",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post(
    "/api/settings/public-profile/gallery",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }
        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "public-profiles",
          `profile-${user.id}-${Date.now()}`,
        );

        const current = (user.publicProfileSettings || {}) as any;
        const galleryUrls = Array.isArray(current.galleryUrls)
          ? current.galleryUrls
          : [];
        const nextGalleryUrls = [result.secureUrl, ...galleryUrls].slice(0, 12);

        await storage.updateUser(user.id, {
          publicProfileSettings: {
            ...current,
            galleryUrls: nextGalleryUrls,
          } as any,
        });

        res.json({
          url: result.secureUrl,
          thumbnailUrl: result.thumbnailUrl,
          galleryUrls: nextGalleryUrls,
        });
      } catch (error) {
        console.error("Error uploading public profile image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.post(
    "/api/settings/custom-domain/verify",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const payloadSchema = z.object({
          hostname: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Invalid hostname"),
        });
        const { hostname } = payloadSchema.parse(req.body || {});
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const dns = await import("dns/promises");
        const expectedTarget = String(
          process.env.PROFILE_DOMAIN_CNAME_TARGET ||
            process.env.RENDER_EXTERNAL_HOSTNAME ||
            (process.env.PUBLIC_BASE_URL || "mealscout.us")
              .replace(/^https?:\/\//, "")
              .replace(/\/+$/, ""),
        )
          .toLowerCase()
          .trim();
        let status: "unverified" | "verified" | "mismatch" | "error" =
          "unverified";
        let diagnostics = "";

        try {
          const cnames = await dns.resolveCname(hostname);
          const normalized = cnames.map((c) =>
            String(c || "")
              .toLowerCase()
              .replace(/\.$/, ""),
          );
          const expected = expectedTarget.replace(/\.$/, "");
          if (normalized.includes(expected)) {
            status = "verified";
          } else {
            status = "mismatch";
            diagnostics = `CNAME points to ${normalized.join(", ") || "none"}, expected ${expected}`;
          }
        } catch (e: any) {
          status = "error";
          diagnostics = e?.message || "DNS lookup failed";
        }

        const accountSettings = {
          ...(user.accountSettings || {}),
          customDomain: {
            hostname,
            status,
            lastCheckedAt: new Date().toISOString(),
            expectedTarget,
            diagnostics,
          },
        };
        await storage.updateUser(user.id, {
          accountSettings: accountSettings as any,
        });

        res.json(accountSettings.customDomain);
      } catch (error: any) {
        console.error("Error verifying custom domain:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid domain payload",
            errors: error.errors,
          });
        }
        res.status(500).json({ message: "Failed to verify custom domain" });
      }
    },
  );

  // Password reset endpoints are registered in setupUnifiedAuth (server/unifiedAuth.ts).

  // Endpoint for authenticated users to change their temporary password
  app.post(
    "/api/auth/change-temp-password",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const schema = z.object({
          currentPassword: z.string().min(1, "Current password is required"),
          newPassword: z
            .string()
            .min(1, PASSWORD_REQUIREMENTS)
            .refine(isPasswordStrong, PASSWORD_REQUIREMENTS),
        });

        const { currentPassword, newPassword } = schema.parse(req.body);
        const user = req.user;

        if (!user.passwordHash) {
          return res.status(400).json({
            success: false,
            error: "Account uses OAuth authentication",
          });
        }

        // Verify current password
        const isValid = await bcrypt.compare(
          currentPassword,
          user.passwordHash,
        );
        if (!isValid) {
          return res.status(400).json({
            success: false,
            error: "Current password is incorrect",
          });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update the user's password
        await storage.upsertUser({
          id: user.id,
          userType: user.userType,
          email: user.email!,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          passwordHash: hashedPassword,
          emailVerified: user.emailVerified,
          facebookId: user.facebookId,
          facebookAccessToken: user.facebookAccessToken,
          googleId: user.googleId,
          googleAccessToken: user.googleAccessToken,
          stripeCustomerId: user.stripeCustomerId,
          stripeSubscriptionId: user.stripeSubscriptionId,
          subscriptionBillingInterval: user.subscriptionBillingInterval,
          birthYear: user.birthYear,
          gender: user.gender,
          postalCode: user.postalCode,
          mustResetPassword: false, // Clear the flag after successful reset
        });

        res.json({
          success: true,
          message: "Password has been successfully changed",
        });
      } catch (error) {
        console.error("Password change error:", error);
        if (error instanceof z.ZodError) {
          res.status(400).json({
            success: false,
            error: "Invalid request",
            details: error.errors,
          });
        } else {
          res.status(500).json({
            success: false,
            error: "Unable to change password",
          });
        }
      }
    },
  );

  // User address routes
  app.get("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const addresses = await storage.getUserAddresses(userId);
      res.json(addresses);
    } catch (error) {
      console.error("Error fetching user addresses:", error);
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  app.post("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const addressData = insertUserAddressSchema.parse({
        ...req.body,
        userId,
      });

      const address = await storage.createUserAddress(addressData);
      await storage.syncHostFromUserAddress(userId, address);
      res.status(201).json(address);
    } catch (error) {
      console.error("Error creating address:", error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Invalid address data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create address" });
      }
    }
  });

  app.put(
    "/api/user/addresses/:addressId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        // Verify the address belongs to the user
        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        const updates = insertUserAddressSchema.partial().parse(req.body);
        const updatedAddress = await storage.updateUserAddress(
          addressId,
          updates,
        );
        await storage.syncHostFromUserAddress(
          userId,
          updatedAddress,
          existingAddress,
        );
        res.json(updatedAddress);
      } catch (error) {
        console.error("Error updating address:", error);
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ message: "Invalid address data", errors: error.errors });
        } else {
          res.status(500).json({ message: "Failed to update address" });
        }
      }
    },
  );

  app.delete(
    "/api/user/addresses/:addressId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        // Verify the address belongs to the user
        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        await storage.deleteUserAddress(addressId);
        await storage.deleteHostForUserAddress(userId, existingAddress);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting address:", error);
        res.status(500).json({ message: "Failed to delete address" });
      }
    },
  );

  app.post(
    "/api/user/addresses/:addressId/set-default",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        // Verify the address belongs to the user
        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        await storage.setDefaultAddress(userId, addressId);
        res.status(200).json({ message: "Default address updated" });
      } catch (error) {
        console.error("Error setting default address:", error);
        res.status(500).json({ message: "Failed to set default address" });
      }
    },
  );

  // Host location request routes
  app.post("/api/location-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const parsed = insertLocationRequestSchema.parse({
        ...req.body,
        postedByUserId: userId,
      });

      let coords: { lat: number; lng: number } | null = null;
      if (parsed.address) {
        const geocodeAddress = [parsed.address, "USA"].join(", ");
        try {
          coords = await forwardGeocode(geocodeAddress);
        } catch {
          coords = null;
        }
      }

      const created = await storage.createLocationRequest({
        ...parsed,
        latitude: coords ? coords.lat.toString() : (parsed.latitude ?? null),
        longitude: coords ? coords.lng.toString() : (parsed.longitude ?? null),
      });
      res
        .status(201)
        .json({ message: "Location request submitted", request: created });
    } catch (error: any) {
      console.error("Error creating location request:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid location request data",
          errors: error.errors,
        });
      }
      res.status(400).json({
        message: error.message || "Failed to create location request",
      });
    }
  });

  app.get("/api/location-requests/demand", async (req: any, res) => {
    try {
      const limit = Number(req.query?.limit ?? 100) || 100;
      const queue = await storage.getLocationDemandQueue(limit);
      res.json({
        generatedAt: new Date().toISOString(),
        count: queue.length,
        queue: queue.map((row) => ({
          id: row.id,
          businessName: row.businessName,
          address: row.address,
          locationType: row.locationType,
          preferredDates: row.preferredDates,
          expectedFootTraffic: row.expectedFootTraffic,
          minInterestedTrucks: row.minInterestedTrucks,
          demandStatus: row.demandStatus,
          status: row.status,
          thresholdReachedAt: row.thresholdReachedAt,
          interestCount: row.interestCount,
          thresholdRemaining: row.thresholdRemaining,
          latitude: row.latitude,
          longitude: row.longitude,
          createdAt: row.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error loading location demand queue:", error);
      res.status(500).json({ message: "Failed to load location demand queue" });
    }
  });

  app.get(
    "/api/location-requests/demand/me",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const limit = Number(req.query?.limit ?? 100) || 100;
        const queue = await storage.getLocationDemandQueueByUser(
          String(req.user?.id || ""),
          limit,
        );
        res.json({
          generatedAt: new Date().toISOString(),
          count: queue.length,
          queue: queue.map((row) => ({
            id: row.id,
            businessName: row.businessName,
            address: row.address,
            locationType: row.locationType,
            preferredDates: row.preferredDates,
            expectedFootTraffic: row.expectedFootTraffic,
            minInterestedTrucks: row.minInterestedTrucks,
            demandStatus: row.demandStatus,
            status: row.status,
            thresholdReachedAt: row.thresholdReachedAt,
            interestCount: row.interestCount,
            thresholdRemaining: row.thresholdRemaining,
            createdAt: row.createdAt,
          })),
        });
      } catch (error) {
        console.error("Error loading my location demand queue:", error);
        res.status(500).json({ message: "Failed to load my location demand queue" });
      }
    },
  );

  app.get("/api/location-requests/:id/summary", async (req: any, res) => {
    try {
      const requestId = String(req.params?.id || "").trim();
      if (!requestId) {
        return res.status(400).json({ message: "Location request ID required" });
      }

      const locationRequest = await storage.getLocationRequestById(requestId);
      if (!locationRequest) {
        return res.status(404).json({ message: "Location request not found" });
      }

      const queue = await storage.getLocationDemandQueue(250);
      const match = queue.find((row) => String(row.id) === requestId);
      const interestCount = Number(match?.interestCount ?? 0);
      const minInterestedTrucks = Math.max(
        1,
        Number(locationRequest.minInterestedTrucks ?? 3) || 3,
      );

      res.json({
        id: locationRequest.id,
        demandStatus: locationRequest.demandStatus,
        status: locationRequest.status,
        interestCount,
        minInterestedTrucks,
        thresholdRemaining: Math.max(0, minInterestedTrucks - interestCount),
        thresholdReached: interestCount >= minInterestedTrucks,
        thresholdReachedAt: locationRequest.thresholdReachedAt,
        createdAt: locationRequest.createdAt,
      });
    } catch (error) {
      console.error("Error loading location request summary:", error);
      res.status(500).json({ message: "Failed to load location request summary" });
    }
  });

  app.post(
    "/api/location-requests/:id/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const locationRequestId = String(req.params?.id || "").trim();
        if (!locationRequestId) {
          return res.status(400).json({ message: "Location request ID required" });
        }

        const parsed = insertHostLocationClaimSchema.parse({
          ...req.body,
          locationRequestId,
          claimedByUserId: req.user.id,
        });

        const locationRequest =
          await storage.getLocationRequestById(locationRequestId);
        if (!locationRequest) {
          return res.status(404).json({ message: "Location request not found" });
        }
        if (locationRequest.status !== "open") {
          return res.status(400).json({ message: "Location request is closed" });
        }

        const claim = await storage.createHostLocationClaim(parsed);
        res.status(201).json({
          message: "Demand location claimed",
          claimId: claim.id,
          status: claim.status,
        });
      } catch (error: any) {
        console.error("Error creating location request claim:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid claim data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "You already claimed this location request",
          });
        }
        res.status(500).json({ message: "Failed to claim location request" });
      }
    },
  );

  app.post(
    "/api/location-requests/:id/interests",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const { id: locationRequestId } = req.params;
        const { restaurantId, message } = req.body;

        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID is required" });
        }

        const ownsRestaurant = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!ownsRestaurant) {
          return res
            .status(403)
            .json({ message: "You can only respond for restaurants you own" });
        }

        const parsed = insertTruckInterestSchema.parse({
          locationRequestId,
          restaurantId,
          message,
        });

        const result = await storage.createTruckInterest(parsed);
        await sendTruckInterestNotification(
          result.locationRequest,
          restaurantId,
          message,
        );

        if (result.thresholdReached) {
          const hostUser = await storage.getUser(result.locationRequest.postedByUserId);
          if (hostUser?.email) {
            const thresholdSubject = `${result.locationRequest.businessName} is now demand-qualified`;
            const thresholdHtml = `
              <p>Your requested location reached its demand threshold.</p>
              <p><strong>Location:</strong> ${result.locationRequest.businessName}</p>
              <p><strong>Address:</strong> ${result.locationRequest.address}</p>
              <p><strong>Interested trucks:</strong> ${result.interestCount}</p>
              <p><strong>Required:</strong> ${result.minInterestedTrucks}</p>
              <p><a href="${(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/host-signup">Claim this demand and publish your first paid slot</a></p>
            `;
            await emailService
              .sendBasicEmail(hostUser.email, thresholdSubject, thresholdHtml)
              .catch(() => undefined);
          }

          const truckAudience = await db
            .selectDistinct({
              email: users.email,
            })
            .from(truckInterests)
            .innerJoin(
              restaurants,
              eq(restaurants.id, truckInterests.restaurantId),
            )
            .innerJoin(users, eq(users.id, restaurants.ownerId))
            .where(eq(truckInterests.locationRequestId, locationRequestId));
          const truckEmails = truckAudience
            .map((row: { email: string | null }) => String(row.email || "").trim())
            .filter(Boolean);

          if (truckEmails.length > 0) {
            const baseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
            const truckSubject = `${result.locationRequest.businessName} is opening for booking`;
            const truckHtml = `
              <p>This location request hit its demand threshold and is moving into host onboarding.</p>
              <p><strong>Location:</strong> ${result.locationRequest.businessName}</p>
              <p><strong>Address:</strong> ${result.locationRequest.address}</p>
              <p><strong>Interested trucks:</strong> ${result.interestCount}</p>
              <p><a href="${baseUrl}/parking-pass">Open Parking Pass bookings</a></p>
            `;
            await Promise.all(
              truckEmails.map((email: string) =>
                emailService
                  .sendBasicEmail(email, truckSubject, truckHtml)
                  .catch(() => undefined),
              ),
            );
          }
        }

        res.status(201).json({
          message: "Interest sent to host",
          interestId: result.interestId,
          interestCount: result.interestCount,
          minInterestedTrucks: result.minInterestedTrucks,
          thresholdReached: result.thresholdReached,
        });
      } catch (error: any) {
        console.error("Error expressing truck interest:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid truck interest data",
            errors: error.errors,
          });
        }

        if (error.message === "Location request not found") {
          return res
            .status(404)
            .json({ message: "Location request not found" });
        }
        if (error.message === "Location request is not open") {
          return res.status(400).json({
            message: "Location request is not accepting new interest",
          });
        }
        if (error.message === "Truck already interested") {
          return res.status(409).json({
            message: "This truck has already shown interest in this location",
          });
        }

        res.status(500).json({ message: "Failed to submit interest" });
      }
    },
  );

  // Public map feed: hosts (open location requests) + upcoming events (hosted slots)
  let mapLocationsCache: {
    expiresAt: number;
    payload: { hostLocations: any[]; eventLocations: any[] };
  } | null = null;
  let mapLocationsLastGood: {
    payload: { hostLocations: any[]; eventLocations: any[] };
  } | null = null;
  app.get("/api/map/locations", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=60");
      if (mapLocationsCache && mapLocationsCache.expiresAt > Date.now()) {
        return res.json(mapLocationsCache.payload);
      }

      const VALID_US_STATE_ABBRS = new Set([
        "AL",
        "AK",
        "AZ",
        "AR",
        "CA",
        "CO",
        "CT",
        "DE",
        "FL",
        "GA",
        "HI",
        "ID",
        "IL",
        "IN",
        "IA",
        "KS",
        "KY",
        "LA",
        "ME",
        "MD",
        "MA",
        "MI",
        "MN",
        "MS",
        "MO",
        "MT",
        "NE",
        "NV",
        "NH",
        "NJ",
        "NM",
        "NY",
        "NC",
        "ND",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VT",
        "VA",
        "WA",
        "WV",
        "WI",
        "WY",
        "DC",
      ]);

      const extractStateAbbr = (value?: string | null) => {
        const raw = String(value || "").toUpperCase();
        if (!raw) return "";
        const matches = raw.match(/\b[A-Z]{2}\b/g) || [];
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          const candidate = matches[i];
          if (VALID_US_STATE_ABBRS.has(candidate)) return candidate;
        }
        return "";
      };

      const expectedStateAbbrFor = (hostLike: {
        address?: string | null;
        city?: string | null;
        state?: string | null;
      }) => {
        const state = normalizeUsStateAbbr(String(hostLike.state || "").trim());
        if (state && VALID_US_STATE_ABBRS.has(state)) return state;
        const fromAddress = extractStateAbbr(hostLike.address);
        if (fromAddress) return fromAddress;
        const fromCity = extractStateAbbr(hostLike.city);
        if (fromCity) return fromCity;
        return "";
      };
      const parseCoord = (value?: string | number | null) => {
        if (value === null || value === undefined) return null;
        const parsed = typeof value === "string" ? Number(value) : value;
        return Number.isFinite(parsed) ? parsed : null;
      };
      const buildFullAddress = (
        address?: string | null,
        city?: string | null,
        state?: string | null,
      ) => {
        const base = (address ?? "").trim();
        if (!base) return "";
        const baseLower = base.toLowerCase();
        const normalizedCity = (city ?? "").trim();
        const normalizedState = (state ?? "").trim();

        const parts: string[] = [base];
        if (
          normalizedCity &&
          !baseLower.includes(normalizedCity.toLowerCase())
        ) {
          parts.push(normalizedCity);
        }
        if (
          normalizedState &&
          !baseLower.includes(normalizedState.toLowerCase())
        ) {
          parts.push(normalizedState);
        }
        parts.push("USA");
        return parts.join(", ");
      };
      const MAX_GEOCODE_PER_REQUEST =
        Math.max(0, Number(process.env.MAP_LOCATIONS_MAX_GEOCODE || 0) || 0) ||
        (process.env.NODE_ENV === "production" ? 5 : 25);
      const GEOCODE_BUDGET_MS =
        Math.max(0, Number(process.env.MAP_LOCATIONS_GEOCODE_BUDGET_MS || 0) || 0) ||
        (process.env.NODE_ENV === "production" ? 1500 : 5000);
      const GEOCODE_TIMEOUT_MS =
        Math.max(0, Number(process.env.MAP_LOCATIONS_GEOCODE_TIMEOUT_MS || 0) || 0) ||
        (process.env.NODE_ENV === "production" ? 750 : 2000);
      const MAX_REVERSE_GEOCODE_PER_REQUEST =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_MAX_REVERSE_GEOCODE || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 2 : 10);
      const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
        if (timeoutMs <= 0) return promise;
        return await Promise.race([
          promise,
          new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
          ),
        ]);
      };
      type PendingGeocode = {
        address: string;
        onResolved: Array<(coords: { lat: number; lng: number }) => void>;
        persist: Array<(coords: { lat: number; lng: number }) => Promise<void>>;
      };
      const pendingByAddress = new Map<string, PendingGeocode>();
      const normalizeAddressKey = (value: string) => value.trim().toLowerCase();
      const queueGeocode = (
        address: string,
        onResolved: (coords: { lat: number; lng: number }) => void,
        persist?: (coords: { lat: number; lng: number }) => Promise<void>,
      ) => {
        const key = normalizeAddressKey(address);
        if (!key) return;
        const existing = pendingByAddress.get(key);
        if (existing) {
          existing.onResolved.push(onResolved);
          if (persist) existing.persist.push(persist);
          return;
        }
        pendingByAddress.set(key, {
          address,
          onResolved: [onResolved],
          persist: persist ? [persist] : [],
        });
      };
      const locationKey = (
        address?: string | null,
        city?: string | null,
        state?: string | null,
      ) =>
        `${(address ?? "").trim().toLowerCase()}|${(city ?? "")
          .trim()
          .toLowerCase()}|${(state ?? "").trim().toLowerCase()}`;

      const [openLocations, upcomingEvents] = await Promise.all([
        storage.getOpenLocationRequests(),
        storage.getAllUpcomingEvents(),
      ]);

      // Use storage's safe host projection so older DBs missing newer columns
      // do not break the map feed.
      const allHosts = (await storage.getAllHosts()) as Array<{
        id: string;
        userId?: string | null;
        businessName: string;
        address: string;
        city?: string | null;
        state?: string | null;
        latitude?: string | null;
        longitude?: string | null;
        locationType?: string | null;
        expectedFootTraffic?: number | null;
        notes?: string | null;
        isVerified?: boolean | null;
      }>;
      const hostUserIds = Array.from(
        new Set(
          allHosts
            .map((host) => String(host.userId || "").trim())
            .filter(Boolean),
        ),
      );
      const activeHostUserIds =
        hostUserIds.length > 0
          ? new Set(
              (
                await db
                  .select({ id: users.id })
                  .from(users)
                  .where(
                    and(
                      inArray(users.id, hostUserIds),
                      or(eq(users.isDisabled, false), isNull(users.isDisabled)),
                    ),
                  )
              ).map((row: { id: string }) => row.id),
            )
          : null;
      const hostProfiles = allHosts.filter((host) => {
        const address = String(host.address || "").trim();
        if (!address) return false;
        if (
          !isHostProfileMapEligible({
            businessName: host.businessName,
            address: host.address,
            city: host.city,
            state: host.state,
          })
        ) {
          return false;
        }
        if (!activeHostUserIds) return true;
        const userId = String(host.userId || "").trim();
        // Legacy host rows may not be tied to a user. Only hide a host when we explicitly
        // know the owning user is disabled.
        return userId ? activeHostUserIds.has(userId) : true;
      });

      const hostProfileById = new Map<string, (typeof hostProfiles)[number]>();
      hostProfiles.forEach((host) => {
        hostProfileById.set(String(host.id), host);
      });

      const publicEvents = upcomingEvents.filter((event) => {
        if (event.requiresPayment) return false;
        const hostId = String(event.hostId || event.host?.id || "").trim();
        if (!hostId) return true;
        const fromProfile = hostProfileById.get(hostId);
        if (fromProfile) return true;
        // Fall back to event host projection for legacy rows.
        return isHostProfileMapEligible({
          businessName: event.host?.businessName,
          address: event.host?.address,
          city: event.host?.city,
          state: event.host?.state,
        });
      });

      const primaryHostLocations = hostProfiles.map((host) => ({
        id: host.id,
        type: "host_location" as const,
        hostId: host.id,
        locationRequestId: null,
        name: host.businessName,
        address: host.address,
        city: host.city ?? null,
        state: host.state ?? null,
        spotImageUrl: null,
        locationType: host.locationType || "other",
        expectedFootTraffic: host.expectedFootTraffic ?? null,
        notes: host.notes ?? null,
        preferredDates: [],
        status: host.isVerified ? "verified" : "active",
        latitude: host.latitude ?? null,
        longitude: host.longitude ?? null,
      }));

      const hostLocations = [
        ...openLocations
          .filter((loc) =>
            isHostProfileMapEligible({
              businessName: loc.businessName,
              address: loc.address,
            }),
          )
          .map((loc) => ({
            id: loc.id,
            type: "host_location" as const,
            hostId: null,
            name: loc.businessName,
            address: loc.address,
            city: null,
            state: null,
            locationType: loc.locationType,
            expectedFootTraffic: loc.expectedFootTraffic,
            notes: loc.notes,
            preferredDates: loc.preferredDates,
            status: loc.status,
            latitude: loc.latitude,
            longitude: loc.longitude,
            locationRequestId: loc.id,
          })),
        ...primaryHostLocations,
      ];

      const eventLocations = publicEvents.map((event) => ({
        id: event.id,
        type: "event" as const,
        name: event.name || "Host Event",
        description: event.description,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        maxTrucks: event.maxTrucks,
        status: event.status,
        hostId: event.hostId,
        hostName: event.host?.businessName,
        hostAddress: event.host?.address,
        hostCity: event.host?.city ?? null,
        hostState: event.host?.state ?? null,
        hostLatitude: event.host?.latitude,
        hostLongitude: event.host?.longitude,
        hardCapEnabled: event.hardCapEnabled,
        seriesId: event.seriesId,
        bookedRestaurantId: event.bookedRestaurantId,
      }));

      const applyCoords = (
        target: { latitude?: string | null; longitude?: string | null },
        coords: { lat: number; lng: number },
      ) => {
        target.latitude = coords.lat.toString();
        target.longitude = coords.lng.toString();
      };

      // Optional fix-up guard: this is expensive (reverse geocoding) so keep it off in prod by default.
      const MAX_COORD_MISMATCH_FIXES =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_MAX_COORD_MISMATCH_FIXES || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 0 : 10);
      let mismatchFixes = 0;
      let reverseGeocodeChecks = 0;
      const deadline = Date.now() + GEOCODE_BUDGET_MS;

      for (const host of hostLocations) {
        const lat = parseCoord(host.latitude);
        const lng = parseCoord(host.longitude);
        const expectedState = expectedStateAbbrFor(host);
        if (
          lat !== null &&
          lng !== null &&
          expectedState &&
          Date.now() <= deadline &&
          reverseGeocodeChecks < MAX_REVERSE_GEOCODE_PER_REQUEST &&
          mismatchFixes < MAX_COORD_MISMATCH_FIXES
        ) {
          reverseGeocodeChecks += 1;
          const reversed = await withTimeout(
            reverseGeocode(lat, lng),
            GEOCODE_TIMEOUT_MS,
          ).catch(() => null);
          const reversedState = normalizeUsStateAbbr(
            String(reversed?.state || "").trim(),
          );
          if (reversedState && reversedState !== expectedState) {
            mismatchFixes += 1;
            if (Date.now() > deadline) {
              continue;
            }

            // Try to re-geocode with a more explicit query and only accept it if the reverse state matches.
            host.latitude = null;
            host.longitude = null;
            const address = buildFullAddress(
              host.address,
              host.city,
              host.state,
            );
            if (address) {
              const coords = await withTimeout(
                forwardGeocode(address, {
                  force: true,
                }),
                GEOCODE_TIMEOUT_MS,
              ).catch(() => null);
              if (coords) {
                if (Date.now() > deadline) {
                  continue;
                }
                const verify = await withTimeout(
                  reverseGeocode(coords.lat, coords.lng),
                  GEOCODE_TIMEOUT_MS,
                ).catch(() => null);
                const verifyState = normalizeUsStateAbbr(
                  String(verify?.state || "").trim(),
                );
                if (!verifyState || verifyState === expectedState) {
                  applyCoords(host, coords);
                  if (host.hostId) {
                    await storage
                      .updateHostCoordinates(
                        host.hostId,
                        coords.lat,
                        coords.lng,
                      )
                      .catch(() => undefined);
                  } else if (host.locationRequestId) {
                    await db
                      .update(locationRequests)
                      .set({
                        latitude: coords.lat.toString(),
                        longitude: coords.lng.toString(),
                      })
                      .where(eq(locationRequests.id, host.locationRequestId))
                      .catch(() => undefined);
                  }
                }
              }
            }
          }
        }

        if (
          parseCoord(host.latitude) !== null &&
          parseCoord(host.longitude) !== null
        ) {
          continue;
        }
        const address = buildFullAddress(host.address, host.city, host.state);
        if (!address) continue;
        queueGeocode(
          address,
          (coords) => applyCoords(host, coords),
          host.hostId
            ? async (coords) => {
                await storage.updateHostCoordinates(
                  host.hostId,
                  coords.lat,
                  coords.lng,
                );
              }
            : host.locationRequestId
              ? async (coords) => {
                  await db
                    .update(locationRequests)
                    .set({
                      latitude: coords.lat.toString(),
                      longitude: coords.lng.toString(),
                    })
                    .where(eq(locationRequests.id, host.locationRequestId));
                }
              : undefined,
        );
      }

      for (const event of eventLocations) {
        const lat = parseCoord(event.hostLatitude);
        const lng = parseCoord(event.hostLongitude);
        if (lat !== null && lng !== null) continue;
        const address = buildFullAddress(
          event.hostAddress,
          event.hostCity,
          event.hostState,
        );
        if (!address) continue;
        queueGeocode(address, (coords) => {
          event.hostLatitude = coords.lat.toString();
          event.hostLongitude = coords.lng.toString();
        });
      }

      const pendingTasks = Array.from(pendingByAddress.values()).slice(
        0,
        MAX_GEOCODE_PER_REQUEST,
      );
      for (const task of pendingTasks) {
        if (Date.now() > deadline) break;
        const coords = await withTimeout(
          forwardGeocode(task.address),
          GEOCODE_TIMEOUT_MS,
        ).catch(() => null);
        if (!coords) continue;
        task.onResolved.forEach((handler) => handler(coords));
        await Promise.all(
          task.persist.map((handler) => handler(coords).catch(() => undefined)),
        );
      }

      const payload = { hostLocations, eventLocations };
      mapLocationsCache = {
        payload,
        expiresAt:
          Date.now() +
          (Math.max(
            0,
            Number(process.env.MAP_LOCATIONS_CACHE_TTL_MS || 0) || 0,
          ) || 300_000),
      };
      mapLocationsLastGood = { payload };
      res.json(payload);
    } catch (error) {
      console.error("Error building map locations feed:", error);
      if (mapLocationsLastGood?.payload) {
        res.setHeader("X-MealScout-Stale", "1");
        return res.json(mapLocationsLastGood.payload);
      }
      res.status(200).json({ hostLocations: [], eventLocations: [] });
    }
  });

  app.post(
    "/api/admin/map/locations-cache/clear",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      mapLocationsCache = null;
      mapLocationsLastGood = null;
      res.json({ success: true });
    },
  );

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

  app.patch(
    "/api/hosts/interests/:interestId/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { interestId } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        if (!["accepted", "declined"].includes(status)) {
          return res.status(400).json({ message: "Invalid status" });
        }

        // Verify host owns the event associated with this interest
        const { interest, event, host } = await getInterestEventAndHostForUser(
          interestId,
          userId,
        );

        if (!interest) {
          return res.status(404).json({ message: "Interest not found" });
        }

        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        if (!userOwnsEvent(userId, host, event)) {
          return res
            .status(403)
            .json({ message: "Not authorized to manage this event" });
        }

        // Idempotency Check: If already in desired status, return success
        if (interest.status === status) {
          return res.json(interest);
        }

        // CAPACITY GUARD v2.2
        // If hard cap is enabled, block acceptance if full
        if (status === "accepted" && event.hardCapEnabled) {
          const currentInterests = await storage.getEventInterestsByEventId(
            event.id,
          );
          // Note: interest.status is definitely NOT 'accepted' here due to idempotency check above
          const acceptedCount = computeAcceptedCount(currentInterests);

          if (
            shouldBlockAcceptance({
              hardCapEnabled: event.hardCapEnabled,
              acceptedCount,
              maxTrucks: event.maxTrucks,
            })
          ) {
            // Telemetry: Blocked Attempt
            await storage.createTelemetryEvent({
              eventName: "interest_accept_blocked",
              userId: req.user.id,
              properties: {
                eventId: event.id,
                truckId: interest.truckId,
                reason: "capacity_guard_limit_reached",
                maxTrucks: event.maxTrucks,
                acceptedCount,
              },
            });

            const capacityError = buildCapacityFullError();

            return res.status(400).json(capacityError);
          }
        }

        const updatedInterest = await storage.updateEventInterestStatus(
          interestId,
          status,
        );

        // Send notification to truck (fire and forget)
        (async () => {
          try {
            // Telemetry: Interest Status Changed
            const allInterests = await storage.getEventInterestsByEventId(
              event.id,
            );
            const acceptedCount = computeAcceptedCount(allInterests);
            const isOverCap = acceptedCount >= event.maxTrucks;

            await storage.createTelemetryEvent({
              eventName:
                status === "accepted"
                  ? "interest_accepted"
                  : "interest_declined",
              userId: req.user.id,
              properties: {
                eventId: event.id,
                truckId: interest.truckId,
                fillRate: computeFillRate({
                  acceptedCount,
                  maxTrucks: event.maxTrucks,
                }),
                acceptedCount,
                maxTrucks: event.maxTrucks,
                isOverCap,
              },
            });

            const truck = await storage.getRestaurant(interest.truckId);
            if (truck) {
              // Get truck owner's email
              // Note: getRestaurant doesn't return ownerId directly in all schemas, but let's check schema.ts
              // restaurants table has ownerId.
              const owner = await storage.getUser(truck.ownerId);
              if (owner && owner.email) {
                await emailService.sendInterestStatusUpdate(
                  owner.email,
                  truck.name,
                  host!.businessName,
                  new Date(event.date).toLocaleDateString(),
                  status as "accepted" | "declined",
                );
              }
            }
          } catch (err) {
            console.error("Failed to send status update notification:", err);
          }
        })();

        res.json(updatedInterest);
      } catch (error: any) {
        console.error("Error updating interest status:", error);
        res.status(500).json({ message: "Failed to update status" });
      }
    },
  );

  app.get(
    "/api/hosts/events/:eventId/interests",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { eventId } = req.params;
        const userId = req.user.id;

        // Verify host owns this event (indirectly via host profile)
        const host = await getHostByUserId(userId);
        if (!host) {
          return res.status(403).json({ message: "Not a host" });
        }

        const { event } = await getEventAndHostForUser(eventId, userId);
        if (!event || !userOwnsEvent(userId, host, event)) {
          return res.status(404).json({ message: "Event not found" });
        }

        const interests = await storage.getEventInterestsByEventId(eventId);
        res.json(interests);
      } catch (error: any) {
        console.error("Error fetching event interests:", error);
        res.status(500).json({ message: "Failed to fetch interests" });
      }
    },
  );

  // Restaurant routes
  // Get subscribed restaurants (public endpoint)
  app.get("/api/restaurants/subscribed/:lat/:lng", async (req: any, res) => {
    try {
      const { lat, lng } = req.params;
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      if (
        isNaN(latitude) ||
        isNaN(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      // Default radius is 50km, max 100km
      const radius = req.query.radius
        ? Math.min(parseFloat(req.query.radius as string), 100)
        : 50;

      if (isNaN(radius) || radius <= 0) {
        return res.status(400).json({ message: "Invalid radius" });
      }

      const nearbyRestaurants = await storage.getNearbyRestaurants(
        latitude,
        longitude,
        radius,
      );
      const restaurants = (
        await Promise.all(
          nearbyRestaurants.map(async (restaurant) => {
            const ownerId = String((restaurant as any)?.ownerId || "").trim();
            if (!ownerId) return null;
            const hasAccess = await hasBusinessDistributionAccess(ownerId);
            return hasAccess ? restaurant : null;
          }),
        )
      ).filter(Boolean) as any[];

      // Get all restaurant IDs to fetch deal counts efficiently
      const restaurantIds = restaurants.map((r) => r.id);

      // Fetch all active deal counts in one query
      const dealCounts: { [restaurantId: string]: number } = {};
      if (restaurantIds.length > 0) {
        const allDeals = await db
          .select({
            restaurantId: deals.restaurantId,
            count: sql<number>`count(*)::integer`,
          })
          .from(deals)
          .where(
            and(
              inArray(deals.restaurantId, restaurantIds),
              eq(deals.isActive, true),
            ),
          )
          .groupBy(deals.restaurantId);

        allDeals.forEach(
          ({
            restaurantId,
            count,
          }: {
            restaurantId: string;
            count: number;
          }) => {
            dealCounts[restaurantId] = count;
          },
        );
      }

      // Add active deal count for each restaurant
      const restaurantsWithDeals = restaurants.map((restaurant) => ({
        ...restaurant,
        activeDealsCount: dealCounts[restaurant.id] || 0,
      }));

      res.json(restaurantsWithDeals);
    } catch (error) {
      console.error("Error fetching subscribed restaurants:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch subscribed restaurants" });
    }
  });

  // Restaurant owner routes
  app.get(
    "/api/restaurants/my-restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const restaurants = await storage.getRestaurantsByOwner(userId);
        res.json(restaurants);
      } catch (error) {
        console.error("Error fetching user restaurants:", error);
        res.status(500).json({ message: "Failed to fetch restaurants" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/stats",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const deals = await storage.getDealsByRestaurant(restaurantId);

        const stats = {
          totalDeals: deals.length,
          activeDeals: deals.filter((d) => d.isActive).length,
          totalViews: deals.reduce(
            (sum, d) => sum + ((d as any).viewCount || 0),
            0,
          ),
          totalClaims: deals.reduce((sum, d) => sum + (d.currentUses || 0), 0),
          conversionRate: 0,
          averageRating:
            (await storage.getRestaurantAverageRating(restaurantId)) || 0,
        };

        if (stats.totalViews > 0) {
          stats.conversionRate = (stats.totalClaims / stats.totalViews) * 100;
        }

        res.json(stats);
      } catch (error) {
        console.error("Error fetching restaurant stats:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
      }
    },
  );

  // Get claimed deals for user
  app.get("/api/deals/claimed", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const claimedDeals = await storage.getUserDealClaimsWithDetails(userId);
      res.json(claimedDeals);
    } catch (error) {
      console.error("Error fetching claimed deals:", error);
      res.status(500).json({ message: "Failed to fetch claimed deals" });
    }
  });

  // 🔒 SECURITY: Update deal - requires ownership of restaurant
  app.patch(
    "/api/deals/:dealId",
    isAuthenticated,
    verifyResourceOwnership("deal"),
    async (req: any, res) => {
      try {
        await logAudit(
          req.user.id,
          "deal_edit",
          "deal",
          req.params.dealId,
          req.ip,
          req.headers["user-agent"],
          req.body,
        );
        const { dealId } = req.params;
        const updates = req.body;
        const userId = req.user.id;

        // Get current deal (ownership already verified by middleware)
        const currentDeal = await storage.getDeal(dealId);
        if (!currentDeal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        // If activating a deal, validate subscription limits
        if (updates.isActive === true && !currentDeal.isActive) {
          const subscriptionValidation = await validateSubscriptionLimits(
            userId,
            dealId,
          );
          if (!subscriptionValidation.isValid) {
            return res.status(402).json({
              message: subscriptionValidation.error,
              currentCount: subscriptionValidation.currentCount,
              maxDeals: subscriptionValidation.maxDeals,
            });
          }
        }

        const updatedDeal = await storage.updateDeal(dealId, updates);
        res.json(updatedDeal);
      } catch (error) {
        console.error("Error updating deal:", error);
        res.status(500).json({ message: "Failed to update deal" });
      }
    },
  );

  // 🔒 SECURITY: Delete deal - requires ownership of restaurant
  app.delete(
    "/api/deals/:dealId",
    isAuthenticated,
    verifyResourceOwnership("deal"),
    async (req: any, res) => {
      try {
        await logAudit(
          req.user.id,
          "deal_delete",
          "deal",
          req.params.dealId,
          req.ip,
          req.headers["user-agent"],
          {},
        );
        const { dealId } = req.params;
        // Ownership verified by middleware - safe to delete
        await storage.deleteDeal(dealId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting deal:", error);
        res.status(500).json({ message: "Failed to delete deal" });
      }
    },
  );

  // Event ingestion endpoints
  // Deal view tracking endpoint with proper per-identity rate limiting
  app.post("/api/deals/:dealId/view", async (req: any, res) => {
    try {
      const { dealId } = req.params;
      const userId = req.user?.id; // Optional for anonymous views
      const sessionId = req.sessionID;

      // Skip tracking if the deal does not exist (prevents noisy 500s on stale IDs)
      const deal = await storage.getDeal(dealId);
      if (!deal) {
        console.warn(
          `[deals:view] deal not found for id ${dealId} - skipping view tracking`,
        );
        return res.json({
          success: true,
          message: "Deal not found; view skipped",
        });
      }

      // Proper per-identity rate limiting: check if this specific user/session has already viewed this deal recently
      const hasRecentView = await storage.hasRecentDealView(
        dealId,
        userId,
        sessionId,
        3600000,
      ); // 1 hour window

      if (hasRecentView) {
        return res.json({
          success: true,
          message: "View already recorded recently",
        });
      }

      const viewData = insertDealViewSchema.parse({
        dealId,
        userId,
        sessionId,
      });

      const view = await storage.recordDealView(viewData);
      res.json({ success: true, view });
    } catch (error) {
      console.error("Error recording deal view:", error);
      res.status(500).json({ message: "Failed to record view" });
    }
  });

  // Mark deal claim as used with order amount
  app.patch(
    "/api/deal-claims/:claimId/use",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { claimId } = req.params;

        // Validate optional order amount
        const amountSchema = z.object({
          orderAmount: z.number().positive().min(0.01).max(10000).optional(),
        });

        const { orderAmount } = amountSchema.parse(req.body ?? {});

        // Verify that the user owns the restaurant associated with this claim
        const isAuthorized = await storage.verifyRestaurantOwnershipByClaim(
          claimId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only mark claims as used for your own restaurants",
          });
        }

        const updatedClaim = await storage.markClaimAsUsed(
          claimId,
          orderAmount ?? null,
        );
        if (!updatedClaim) {
          return res
            .status(400)
            .json({ message: "Claim not found or already used" });
        }
        res.json({ success: true, claim: updatedClaim });
      } catch (error) {
        console.error("Error marking claim as used:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to mark claim as used",
        });
      }
    },
  );

  // Food truck endpoints
  // Update restaurant mobile settings (owner only)
  app.patch(
    "/api/restaurants/:restaurantId/mobile-settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update settings for restaurants you own",
          });
        }

        const settings = updateRestaurantMobileSettingsSchema.parse(req.body);
        const updatedRestaurant = await storage.setRestaurantMobileSettings(
          restaurantId,
          settings,
        );

        // Broadcast status update via WebSocket if mobile status changed
        if (settings.mobileOnline !== undefined) {
          broadcastStatusUpdate(restaurantId, {
            isOnline: updatedRestaurant.mobileOnline || false,
            mobileOnline: updatedRestaurant.mobileOnline || false,
          });
        }

        res.json({ success: true, restaurant: updatedRestaurant });
      } catch (error) {
        console.error("Error updating mobile settings:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update mobile settings",
        });
      }
    },
  );

  // Update restaurant location (owner only)
  app.patch(
    "/api/restaurants/:restaurantId/location",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update location for restaurants you own",
          });
        }

        const locationData = updateRestaurantLocationSchema.parse(req.body);
        const resolvedLocation = await reverseGeocode(
          locationData.latitude,
          locationData.longitude,
        );
        const updatedRestaurant = await storage.updateRestaurantLocation(
          restaurantId,
          {
            ...locationData,
            city: resolvedLocation.city,
            state: resolvedLocation.state,
          },
        );

        // Broadcast location update via WebSocket
        broadcastLocationUpdate(restaurantId, {
          latitude: updatedRestaurant.currentLatitude
            ? parseFloat(updatedRestaurant.currentLatitude)
            : 0,
          longitude: updatedRestaurant.currentLongitude
            ? parseFloat(updatedRestaurant.currentLongitude)
            : 0,
          mobileOnline: updatedRestaurant.mobileOnline || false,
          lastBroadcastAt: updatedRestaurant.lastBroadcastAt || new Date(),
        });

        res.json({ success: true, restaurant: updatedRestaurant });
      } catch (error) {
        console.error("Error updating restaurant location:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update location",
        });
      }
    },
  );

  // Update restaurant operating hours (owner only)
  app.patch(
    "/api/restaurants/:restaurantId/operating-hours",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update operating hours for restaurants you own",
          });
        }

        const hoursData = updateRestaurantOperatingHoursSchema.parse(req.body);
        const updatedRestaurant = await storage.setRestaurantOperatingHours(
          restaurantId,
          hoursData.operatingHours,
        );

        res.json({ success: true, restaurant: updatedRestaurant });
      } catch (error) {
        console.error("Error updating operating hours:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update operating hours",
        });
      }
    },
  );

  // Update restaurant social settings (owner only)
  app.patch(
    "/api/restaurants/:restaurantId/social-settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update social settings for restaurants you own",
          });
        }

        const schema = z.object({
          facebookPageUrl: z
            .string()
            .url()
            .optional()
            .nullable()
            .or(z.literal("")),
          instagramUrl: z
            .string()
            .url()
            .optional()
            .nullable()
            .or(z.literal("")),
          xUrl: z.string().url().optional().nullable().or(z.literal("")),
          socialAutopostSettings: z.record(z.any()).optional().nullable(),
        });

        const parsed = schema.parse(req.body);
        const [updated] = await db
          .update(restaurants)
          .set({
            facebookPageUrl: parsed.facebookPageUrl || null,
            instagramUrl: parsed.instagramUrl || null,
            xUrl: parsed.xUrl || null,
            socialAutopostSettings: parsed.socialAutopostSettings ?? null,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, restaurantId))
          .returning();

        res.json({ success: true, restaurant: updated });
      } catch (error) {
        console.error("Error updating social settings:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update social settings",
        });
      }
    },
  );

  // Check if restaurant is currently open (public endpoint)
  app.get("/api/restaurants/:restaurantId/is-open", async (req: any, res) => {
    try {
      const { restaurantId } = req.params;
      const isOpen = await storage.isRestaurantOpenNow(restaurantId);

      res.json({ success: true, isOpen });
    } catch (error) {
      console.error("Error checking restaurant hours:", error);
      res.status(400).json({
        message:
          error instanceof Error
            ? error.message
            : "Failed to check restaurant hours",
      });
    }
  });

  // Start food truck session
  app.post(
    "/api/restaurants/:restaurantId/truck-session/start",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { deviceId } = req.body;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only start sessions for restaurants you own",
          });
        }

        if (!deviceId) {
          return res.status(400).json({ message: "deviceId is required" });
        }

        const session = await storage.startTruckSession(
          restaurantId,
          deviceId,
          req.user.id,
        );
        await storage.setRestaurantMobileSettings(restaurantId, {
          mobileOnline: true,
        });
        res.json({ success: true, session });
      } catch (error) {
        console.error("Error starting truck session:", error);
        res.status(500).json({ message: "Failed to start truck session" });
      }
    },
  );

  // End food truck session
  app.post(
    "/api/restaurants/:restaurantId/truck-session/end",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only end sessions for restaurants you own",
          });
        }

        await storage.endTruckSession(restaurantId, req.user.id);
        await storage.setRestaurantMobileSettings(restaurantId, {
          mobileOnline: false,
        });
        res.json({ success: true });
      } catch (error) {
        console.error("Error ending truck session:", error);
        res.status(500).json({ message: "Failed to end truck session" });
      }
    },
  );

  // Update food truck location with rate limiting
  app.post(
    "/api/restaurants/:restaurantId/location",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update location for restaurants you own",
          });
        }

        // Rate limiting: check if too many requests from this user/restaurant
        const rateLimitResult = checkRateLimit(
          `location_update_${req.user.id}_${restaurantId}`,
        );
        if (!rateLimitResult.allowed) {
          return res.status(429).json({
            message:
              "Too many location updates. Please wait before trying again.",
            nextAllowedTime: rateLimitResult.nextAllowedTime,
          });
        }

        const locationData = insertFoodTruckLocationSchema.parse({
          ...req.body,
          restaurantId,
        });

        const location = await storage.upsertLiveLocation(locationData);

        // Broadcast location update via WebSocket
        broadcastLocationUpdate(restaurantId, location);

        res.json({ success: true, location });
      } catch (error) {
        console.error("Error updating location:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update location",
        });
      }
    },
  );

  // Get live food trucks nearby (public endpoint)
  app.get("/api/trucks/live", async (req: any, res) => {
    try {
      const { lat, lng, radiusKm = 5 } = req.query;

      if (!lat || !lng) {
        return res
          .status(400)
          .json({ message: "lat and lng query parameters are required" });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      const radius = Math.min(parseFloat(radiusKm as string), 50); // Max 50km radius

      if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
        return res
          .status(400)
          .json({ message: "Invalid coordinates or radius" });
      }

      if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({ message: "Invalid coordinates range" });
      }

      const trucks = await storage.getLiveTrucksNearby(
        latitude,
        longitude,
        radius,
      );
      const visibleTrucks = (
        await Promise.all(
          trucks.map(async (truck: any) => {
            const ownerId = String(truck?.ownerId || "").trim();
            if (!ownerId) return null;
            const hasAccess = await hasBusinessDistributionAccess(ownerId);
            return hasAccess ? truck : null;
          }),
        )
      ).filter(Boolean);
      res.json({ trucks: visibleTrucks });
    } catch (error) {
      console.error("Error fetching live trucks:", error);
      res.status(500).json({ message: "Failed to fetch live trucks" });
    }
  });

  // Get food truck location history (owner only)
  app.get(
    "/api/restaurants/:restaurantId/locations",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate } = req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access location history for restaurants you own",
          });
        }

        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const locations = await storage.getTruckLocationHistory(
          restaurantId,
          dateRange,
        );
        res.json({ locations });
      } catch (error) {
        console.error("Error fetching location history:", error);
        res.status(500).json({ message: "Failed to fetch location history" });
      }
    },
  );

  // Analytics API endpoints (require authentication to verify restaurant ownership)
  app.get(
    "/api/restaurants/:restaurantId/analytics/summary",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate } = req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(req.user.id);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const summary = await storage.getRestaurantAnalyticsSummary(
          restaurantId,
          dateRange,
        );
        res.json(summary);
      } catch (error) {
        console.error("Error fetching analytics summary:", error);
        res.status(500).json({ message: "Failed to fetch analytics summary" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/timeseries",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate, interval = "day" } = req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(req.user.id);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        if (!startDate || !endDate) {
          return res
            .status(400)
            .json({ message: "startDate and endDate are required" });
        }

        const dateRange = {
          start: new Date(startDate as string),
          end: new Date(endDate as string),
        };

        const timeseries = await storage.getRestaurantAnalyticsTimeseries(
          restaurantId,
          dateRange,
          interval as "day" | "week",
        );
        res.json(timeseries);
      } catch (error) {
        console.error("Error fetching analytics timeseries:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch analytics timeseries" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/customers",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate } = req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(req.user.id);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const insights = await storage.getRestaurantCustomerInsights(
          restaurantId,
          dateRange,
        );
        res.json(insights);
      } catch (error) {
        console.error("Error fetching customer insights:", error);
        res.status(500).json({ message: "Failed to fetch customer insights" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/compare",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { currentStart, currentEnd, previousStart, previousEnd } =
          req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(req.user.id);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        if (!currentStart || !currentEnd || !previousStart || !previousEnd) {
          return res.status(400).json({
            message:
              "currentStart, currentEnd, previousStart, and previousEnd are required",
          });
        }

        const [currentPeriod, previousPeriod] = await Promise.all([
          storage.getRestaurantAnalyticsSummary(restaurantId, {
            start: new Date(currentStart as string),
            end: new Date(currentEnd as string),
          }),
          storage.getRestaurantAnalyticsSummary(restaurantId, {
            start: new Date(previousStart as string),
            end: new Date(previousEnd as string),
          }),
        ]);

        // Calculate percentage changes
        const comparison = {
          current: currentPeriod,
          previous: previousPeriod,
          changes: {
            viewsChange:
              previousPeriod.totalViews > 0
                ? ((currentPeriod.totalViews - previousPeriod.totalViews) /
                    previousPeriod.totalViews) *
                  100
                : 0,
            claimsChange:
              previousPeriod.totalClaims > 0
                ? ((currentPeriod.totalClaims - previousPeriod.totalClaims) /
                    previousPeriod.totalClaims) *
                  100
                : 0,
            revenueChange:
              previousPeriod.totalRevenue > 0
                ? ((currentPeriod.totalRevenue - previousPeriod.totalRevenue) /
                    previousPeriod.totalRevenue) *
                  100
                : 0,
            conversionRateChange:
              currentPeriod.conversionRate - previousPeriod.conversionRate,
          },
        };

        res.json(comparison);
      } catch (error) {
        console.error("Error fetching analytics comparison:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch analytics comparison" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/export",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate, format = "csv" } = req.query;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(req.user.id);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        if (!startDate || !endDate) {
          return res
            .status(400)
            .json({ message: "startDate and endDate are required" });
        }

        const dateRange = {
          start: new Date(startDate as string),
          end: new Date(endDate as string),
        };

        const exportData = await storage.getRestaurantAnalyticsExport(
          restaurantId,
          dateRange,
        );

        if (format === "csv") {
          // Generate CSV with proper security measures to prevent injection attacks
          const csvHeader = "Deal Title,Date,Views,Claims,Revenue\n";
          const csvRows = exportData
            .map((row: any) => {
              // Secure CSV sanitization to prevent injection attacks
              const sanitizeCSV = (value: any): string => {
                if (value === null || value === undefined) return "";
                const str = String(value);

                // If cell starts with dangerous characters, prefix with apostrophe to prevent formula execution
                if (/^[=+@-]/.test(str)) {
                  return `"'${str.replace(/"/g, '""')}"`;
                }

                // Always quote strings and escape internal quotes
                return `"${str.replace(/"/g, '""')}"`;
              };

              return [
                sanitizeCSV(row.dealTitle),
                sanitizeCSV(row.date),
                sanitizeCSV(row.views),
                sanitizeCSV(row.claims),
                sanitizeCSV(row.revenue),
              ].join(",");
            })
            .join("\n");

          const csv = csvHeader + csvRows;

          // Secure headers with proper MIME type and safe filename
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="analytics-${encodeURIComponent(
              restaurantId,
            )}-${encodeURIComponent(startDate as string)}-${encodeURIComponent(
              endDate as string,
            )}.csv"`,
          );
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.send(csv);
        } else {
          res.json(exportData);
        }
      } catch (error) {
        console.error("Error exporting analytics:", error);
        res.status(500).json({ message: "Failed to export analytics" });
      }
    },
  );

  // Restaurant owner signup endpoint (creates user account + restaurant in one flow)
  app.post("/api/restaurants/signup", async (req: any, res) => {
    try {
      const { userData, restaurantData } = req.body;

      let user: User;

      // Check if user is already authenticated (e.g., via Google OAuth)
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        // User is already authenticated, use existing user
        user = req.user as User;
        console.log("Using authenticated user for restaurant signup:", {
          userId: user.id,
          userType: user.userType,
        });

        if (!user.emailVerified) {
          return res.status(403).json({
            message: "Please verify your email before continuing.",
            code: "email_not_verified",
          });
        }

        // If user is currently a customer, upgrade them to restaurant_owner
        if (user.userType === "customer") {
          console.log(
            "Converting customer account to restaurant owner:",
            user.id,
          );
          await storage.updateUserType(user.id, "restaurant_owner");
          // Update the user object to reflect the change
          user = (await storage.getUserById(user.id)) || user;
        }
      } else {
        // User is not authenticated, create new account
        // Validate user data with password required
        const userValidation = z.object({
          email: z.string().email(),
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          phone: z.string().min(10),
          password: z
            .string()
            .min(1, PASSWORD_REQUIREMENTS)
            .refine(isPasswordStrong, PASSWORD_REQUIREMENTS),
        });

        const validatedUserData = userValidation.parse(userData);

        // Check if user already exists
        const existingUser = await storage.getUserByEmail(
          validatedUserData.email,
        );
        if (existingUser) {
          return res
            .status(400)
            .json({ message: "User with this email already exists" });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(validatedUserData.password, 10);

        // Create restaurant owner user account using email auth
        user = await storage.upsertUserByAuth(
          "email",
          {
            ...validatedUserData,
            passwordHash,
          },
          "restaurant_owner",
        );

        // Require email verification before proceeding (no session or restaurant created yet).
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await storage.createEmailVerificationToken({
          userId: user.id,
          tokenHash,
          expiresAt,
          requestIp: req.ip || req.connection?.remoteAddress || undefined,
          userAgent: req.get("User-Agent") || undefined,
        });

        const apiBaseUrl = (
          process.env.PUBLIC_BASE_URL ||
          (req.get("host") ? `${req.protocol}://${req.get("host")}` : null) ||
          "http://localhost:5000"
        ).replace(/\/+$/, "");
        const verifyUrl = `${apiBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(
          token,
        )}`;
        await emailService.sendEmailVerificationEmail(user, verifyUrl);

        return res.status(201).json({
          message:
            "Account created. Please verify your email before completing signup.",
          requiresEmailVerification: true,
        });
      }

      // Validate restaurant data
      const restaurantValidation = insertRestaurantSchema.omit({
        ownerId: true,
      });
      const validatedRestaurantData =
        restaurantValidation.parse(restaurantData);

      // Create restaurant profile
      const restaurant = await storage.createRestaurant({
        ...validatedRestaurantData,
        ownerId: user.id,
      });

      // If this is a food truck profile, ensure the user account is a `food_truck` so booking is allowed.
      if (String((restaurant as any)?.businessType || "") === "food_truck") {
        const currentType = String((user as any)?.userType || "");
        const allowedToPromote = ["customer", "restaurant_owner"].includes(
          currentType,
        );
        if (allowedToPromote && currentType !== "food_truck") {
          await storage.updateUserType(user.id, "food_truck");
          user = (await storage.getUserById(user.id)) || user;
        }
      }

      // If this is a Pensacola food truck, trigger the automated drip (step 1) immediately.
      if (String((restaurant as any)?.businessType || "") === "food_truck") {
        try {
          const { maybeTriggerPensacolaFoodTruckDrip } =
            await import("./services/pensacolaFoodTruckDrip");
          await maybeTriggerPensacolaFoodTruckDrip({
            userId: user.id,
            restaurant,
          });
        } catch (error) {
          console.warn(
            "[drip] Unable to trigger Pensacola food truck drip:",
            error,
          );
        }
      }

      // VAC-lite auto-verify (with fallback to manual verification request)
      try {
        const enabled =
          String(
            process.env.VAC_AUTO_VERIFY_ENABLED || "true",
          ).toLowerCase() !== "false";
        if (enabled) {
          const vac = await vacEvaluateRestaurantSignup({
            user,
            restaurant,
            req,
          });
          console.log("🔍 VAC-lite evaluation:", {
            restaurantId: restaurant.id,
            restaurantName: (restaurant as any).name,
            score: vac.score,
            threshold: vac.threshold,
            shouldAutoVerify: vac.shouldAutoVerify,
            signals: vac.signals,
          });

          if (vac.shouldAutoVerify) {
            console.log("✅ Auto-verifying restaurant:", restaurant.id);
            await storage.setRestaurantVerified(restaurant.id, true);
            (restaurant as any).isVerified = true;
            try {
              user = (await ensureTrialForUser(user)) || user;
            } catch (e) {
              console.warn("ensureTrialForUser failed after auto-verify:", e);
            }
          } else {
            console.log(
              "⚠️  Creating manual verification request for:",
              restaurant.id,
            );
            const hasPending = await storage.hasPendingVerificationRequest(
              restaurant.id,
            );
            if (!hasPending) {
              await storage.createVerificationRequest({
                restaurantId: restaurant.id,
                documents: [],
              });
            } else {
              console.log("ℹ️  Pending verification request already exists");
            }
          }
        }
      } catch (e) {
        console.warn("VAC-lite failed", e);
        // Never block signup due to VAC issues
      }

      // Auto-post to MealScout Facebook page when a new food truck joins
      if ((restaurant as any).businessType === "food_truck") {
        try {
          const baseUrl = (
            process.env.PUBLIC_BASE_URL || "https://www.mealscout.us"
          ).replace(/\/+$/, "");
          const link = `${baseUrl}/restaurant/${restaurant.id}`;
          const message = `Welcome ${restaurant.name} to MealScout! Catch them on the map and follow their schedule.`;
          await queueSocialPost({
            platform: "facebook",
            target: "mealscout_page",
            message,
            link,
          });
        } catch (error) {
          console.error("Failed to queue social post:", error);
        }
      }

      // PHASE 2: Attach referral if present in request
      const referralId =
        req.body?.referralId ||
        req.query?.referralId ||
        req.cookies?.referralRecordId ||
        req.cookies?.referralId;
      if (referralId) {
        try {
          const { attachReferralToSignup } = await import("./referralService");
          await attachReferralToSignup(referralId, restaurant.id);
          console.log("[Phase 2] Referral attached:", {
            referralId,
            restaurantId: restaurant.id,
          });
        } catch (err) {
          console.error("[Phase 2] Error attaching referral:", err);
          // Don't fail signup if referral attachment fails
        }
      }

      if (referralId && user?.id) {
        try {
          const { resolveAffiliateUserId } =
            await import("./affiliateTagService");
          const affiliateUserId = await resolveAffiliateUserId(referralId);
          if (affiliateUserId && affiliateUserId !== user.id) {
            const [existingUser] = await db
              .select({ affiliateCloserUserId: users.affiliateCloserUserId })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1);

            if (!existingUser?.affiliateCloserUserId) {
              const [affiliate] = await db
                .select({ affiliatePercent: users.affiliatePercent })
                .from(users)
                .where(eq(users.id, affiliateUserId))
                .limit(1);
              const percentSnapshot = Math.max(
                Number(affiliate?.affiliatePercent ?? 5),
                0,
              );

              await db
                .update(users)
                .set({
                  affiliateCloserUserId: affiliateUserId,
                  affiliateCloserPercent: percentSnapshot,
                  updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));
            }
          }
        } catch (err) {
          console.error("[Phase 2] Error attaching user referral:", err);
        }
      }

      res.json({
        user,
        restaurant,
        message: "Restaurant owner account created successfully",
      });
    } catch (error: any) {
      console.error("Error in restaurant signup:", error);
      res.status(400).json({
        message: error.message || "Failed to create restaurant account",
      });
    }
  });

  const decorateTruckClaimRows = (
    rows: any[],
    opts?: { currentUserId?: string | null },
  ) => {
    const now = Date.now();
    const COOLDOWN_MS = 6 * 60 * 60 * 1000;
    return rows.map((row) => {
      const hasEmail = Boolean(String(row.email || "").trim());
      const hasInviteUser = Boolean(row.invitedUserId);
      const isInviteOwner =
        row.invitedUserId &&
        opts?.currentUserId &&
        String(row.invitedUserId) === String(opts.currentUserId);

      const lastInviteSentAtMs = row.lastInviteSentAt
        ? new Date(row.lastInviteSentAt).getTime()
        : 0;
      const cooldownRemainingMs = lastInviteSentAtMs
        ? Math.max(0, lastInviteSentAtMs + COOLDOWN_MS - now)
        : 0;

      const canClaim = hasInviteUser ? Boolean(isInviteOwner) : true;
      const canRequest = hasEmail && !isInviteOwner;

      return {
        id: row.id,
        name: row.name,
        address: row.address,
        city: row.city,
        state: row.state,
        phone: row.phone,
        externalId: row.externalId,
        confidenceScore: row.confidenceScore,
        invited: Boolean(hasInviteUser || hasEmail),
        hasEmail,
        canClaim,
        canRequest,
        requestCooldownMinutes: cooldownRemainingMs
          ? Math.ceil(cooldownRemainingMs / 60000)
          : 0,
      };
    });
  };

  app.get(
    "/api/truck-claims/search",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const query = String(req.query?.q || "").trim();
        if (!query) {
          return res.json([]);
        }

        const externalMatch = await db
          .select({
            id: truckImportListings.id,
            name: truckImportListings.name,
            address: truckImportListings.address,
            city: truckImportListings.city,
            state: truckImportListings.state,
            phone: truckImportListings.phone,
            externalId: truckImportListings.externalId,
            confidenceScore: truckImportListings.confidenceScore,
            email: truckImportListings.email,
            invitedUserId: truckImportListings.invitedUserId,
            lastInviteSentAt: truckImportListings.lastInviteSentAt,
          })
          .from(truckImportListings)
          .where(
            and(
              eq(truckImportListings.externalId, query),
              inArray(truckImportListings.status, [
                "unclaimed",
                "claim_requested",
              ] as any),
            ),
          )
          .limit(10);

        if (externalMatch.length > 0) {
          return res.json(
            decorateTruckClaimRows(externalMatch, {
              currentUserId: req.user?.id,
            }),
          );
        }

        const searchValue = `%${query.toLowerCase()}%`;
        const matches = await db
          .select({
            id: truckImportListings.id,
            name: truckImportListings.name,
            address: truckImportListings.address,
            city: truckImportListings.city,
            state: truckImportListings.state,
            phone: truckImportListings.phone,
            externalId: truckImportListings.externalId,
            confidenceScore: truckImportListings.confidenceScore,
            email: truckImportListings.email,
            invitedUserId: truckImportListings.invitedUserId,
            lastInviteSentAt: truckImportListings.lastInviteSentAt,
          })
          .from(truckImportListings)
          .where(
            and(
              inArray(truckImportListings.status, [
                "unclaimed",
                "claim_requested",
              ] as any),
              or(
                sql`lower(${truckImportListings.name}) like ${searchValue}`,
                sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
                sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
                sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
                sql`lower(coalesce(${truckImportListings.externalId}, '')) like ${searchValue}`,
                sql`lower(coalesce(${truckImportListings.phone}, '')) like ${searchValue}`,
              ),
            ),
          )
          .orderBy(desc(truckImportListings.confidenceScore))
          .limit(10);

        res.json(
          decorateTruckClaimRows(matches, { currentUserId: req.user?.id }),
        );
      } catch (error) {
        console.error("Error searching truck listings:", error);
        res.status(500).json({ message: "Failed to search truck listings" });
      }
    },
  );

  // Public search for claim flow (no email/invite info revealed).
  app.get("/api/truck-claims/public-search", async (req: any, res) => {
    try {
      const query = String(req.query?.q || "").trim();
      if (!query) return res.json([]);

      const searchValue = `%${query.toLowerCase()}%`;
      const rows = await db
        .select({
          id: truckImportListings.id,
          name: truckImportListings.name,
          address: truckImportListings.address,
          city: truckImportListings.city,
          state: truckImportListings.state,
          phone: truckImportListings.phone,
          externalId: truckImportListings.externalId,
          confidenceScore: truckImportListings.confidenceScore,
          lastInviteSentAt: truckImportListings.lastInviteSentAt,
          invitedUserId: truckImportListings.invitedUserId,
          email: truckImportListings.email,
        })
        .from(truckImportListings)
        .where(
          and(
            inArray(truckImportListings.status, [
              "unclaimed",
              "claim_requested",
            ] as any),
            or(
              sql`lower(${truckImportListings.name}) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.externalId}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(truckImportListings.confidenceScore))
        .limit(15);

      // No user context => `canClaim` means "claim is possible once logged in".
      res.json(decorateTruckClaimRows(rows, { currentUserId: null }));
    } catch (error) {
      console.error("Error public-searching truck listings:", error);
      res.status(500).json({ message: "Failed to search truck listings" });
    }
  });

  // Public: allow anyone to request a reminder email for an unclaimed (or claim-requested) imported truck.
  // Guarded by per-listing cooldown + server-side email config checks.
  app.post("/api/truck-claims/request", async (req: any, res) => {
    try {
      const payloadSchema = z.object({ listingId: z.string().min(1) });
      const { listingId } = payloadSchema.parse(req.body);

      const [listing] = await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingId))
        .limit(1);

      if (
        !listing ||
        !["unclaimed", "claim_requested"].includes(String(listing.status))
      ) {
        return res
          .status(404)
          .json({ message: "Truck listing is not available." });
      }

      const inviteEmail = String(listing.email || "")
        .trim()
        .toLowerCase();
      const hadEmail = Boolean(inviteEmail);
      if (!listing.invitedUserId && !inviteEmail) {
        return res.status(400).json({
          message:
            "This listing doesn't have an email on file. Ask an admin to add one, or claim it manually.",
          hadEmail: false,
        });
      }

      const COOLDOWN_MS = 6 * 60 * 60 * 1000;
      if (listing.lastInviteSentAt) {
        const lastMs = new Date(listing.lastInviteSentAt).getTime();
        if (Date.now() - lastMs < COOLDOWN_MS) {
          const minutes = Math.ceil(
            (COOLDOWN_MS - (Date.now() - lastMs)) / 60000,
          );
          return res.status(429).json({
            message: `A reminder was already sent recently. Try again in about ${minutes} minutes.`,
            cooldownMinutes: minutes,
            hadEmail,
          });
        }
      }

      let inviteUser: any | null = null;
      if (listing.invitedUserId) {
        inviteUser = await storage.getUser(listing.invitedUserId);
      }
      if (!inviteUser && inviteEmail) {
        inviteUser = await storage.getUserByEmail(inviteEmail);
        if (!inviteUser) {
          inviteUser = await storage.createUserInvite({
            email: inviteEmail,
            firstName: null,
            lastName: null,
            phone: null,
            userType: "food_truck",
          });
        }
        await db
          .update(truckImportListings)
          .set({ invitedUserId: inviteUser.id, updatedAt: new Date() })
          .where(eq(truckImportListings.id, listing.id));
      }

      if (!inviteUser) {
        return res.status(500).json({ message: "Unable to send reminder." });
      }

      const emailSent = await sendAccountSetupInvite({
        user: inviteUser,
        createdBy: null,
        req,
      });

      await db
        .update(truckImportListings)
        .set({
          lastInviteSentAt: new Date(),
          status: "claim_requested",
          updatedAt: new Date(),
        })
        .where(eq(truckImportListings.id, listing.id));

      res.json({
        success: true,
        emailSent,
        hadEmail,
        cooldownMinutes: 0,
        status: "claim_requested",
      });
    } catch (error: any) {
      console.error("Error requesting truck setup reminder:", error);
      res.status(400).json({
        message: error.message || "Failed to request reminder",
      });
    }
  });

  app.post("/api/truck-claims", isAuthenticated, async (req: any, res) => {
    try {
      const payloadSchema = z.object({
        listingId: z.string().min(1),
        restaurantData: insertRestaurantSchema
          .omit({ ownerId: true })
          .partial(),
      });
      const { listingId, restaurantData } = payloadSchema.parse(req.body);

      const [listing] = await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingId))
        .limit(1);

      if (!listing || listing.status !== "unclaimed") {
        return res
          .status(404)
          .json({ message: "Truck listing is not available to claim" });
      }

      if (
        listing.invitedUserId &&
        String(listing.invitedUserId) !== String(req.user.id)
      ) {
        return res.status(409).json({
          message:
            "This truck already has an invited owner. Use “Request this truck” to notify them to finish setup.",
        });
      }

      const mergedRestaurant = {
        name: restaurantData.name || listing.name,
        address: restaurantData.address || listing.address,
        city: restaurantData.city || listing.city,
        state: restaurantData.state || listing.state,
        phone: restaurantData.phone || listing.phone,
        cuisineType: restaurantData.cuisineType || listing.cuisineType,
        websiteUrl: restaurantData.websiteUrl || listing.websiteUrl,
        instagramUrl: restaurantData.instagramUrl || listing.instagramUrl,
        facebookPageUrl:
          restaurantData.facebookPageUrl || listing.facebookPageUrl,
        latitude: restaurantData.latitude || listing.latitude,
        longitude: restaurantData.longitude || listing.longitude,
        description: restaurantData.description || null,
        amenities: restaurantData.amenities || null,
      };

      if (!mergedRestaurant.name || !mergedRestaurant.address) {
        return res.status(400).json({
          message: "Name and address are required to claim this listing",
        });
      }

      const importSystemEmail =
        process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us";
      const importSystemUser = await storage.getUserByEmail(importSystemEmail);
      const seededRestaurantCandidate = importSystemUser
        ? (
            await db
              .select()
              .from(restaurants)
              .where(
                and(
                  eq(restaurants.claimedFromImportId, listing.id),
                  eq(restaurants.ownerId, importSystemUser.id),
                ),
              )
              .limit(1)
          )[0]
        : null;

      // If the admin import job pre-seeded a food truck record, transfer ownership to the claimant.
      const restaurant = seededRestaurantCandidate
        ? (
            await db
              .update(restaurants)
              .set({
                ownerId: req.user.id,
                name: mergedRestaurant.name,
                address: mergedRestaurant.address,
                phone: mergedRestaurant.phone || null,
                businessType: "food_truck",
                cuisineType: mergedRestaurant.cuisineType || null,
                city: mergedRestaurant.city || null,
                state: mergedRestaurant.state || null,
                websiteUrl: mergedRestaurant.websiteUrl || null,
                instagramUrl: mergedRestaurant.instagramUrl || null,
                facebookPageUrl: mergedRestaurant.facebookPageUrl || null,
                latitude: mergedRestaurant.latitude || null,
                longitude: mergedRestaurant.longitude || null,
                description: mergedRestaurant.description || null,
                amenities: mergedRestaurant.amenities || null,
                isFoodTruck: true,
                isActive: false,
                // Imported listings still require document verification.
                isVerified: false,
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, seededRestaurantCandidate.id))
              .returning()
          )[0]
        : await storage.createRestaurant({
            ownerId: req.user.id,
            name: mergedRestaurant.name,
            address: mergedRestaurant.address,
            phone: mergedRestaurant.phone || null,
            businessType: "food_truck",
            cuisineType: mergedRestaurant.cuisineType || null,
            city: mergedRestaurant.city || null,
            state: mergedRestaurant.state || null,
            websiteUrl: mergedRestaurant.websiteUrl || null,
            instagramUrl: mergedRestaurant.instagramUrl || null,
            facebookPageUrl: mergedRestaurant.facebookPageUrl || null,
            latitude: mergedRestaurant.latitude || null,
            longitude: mergedRestaurant.longitude || null,
            description: mergedRestaurant.description || null,
            amenities: mergedRestaurant.amenities || null,
            isFoodTruck: true,
            isActive: false,
            isVerified: false,
            claimedFromImportId: listing.id,
          });

      // Claiming a truck should immediately unlock premium features (trial) for the owner.
      // If they were a plain customer before, upgrade them to a truck account.
      if (req.user?.userType === "customer") {
        await storage.updateUserType(req.user.id, "food_truck");
      }

      const [claimRequest] = await db
        .insert(truckClaimRequests)
        .values({
          listingId: listing.id,
          restaurantId: restaurant.id,
          userId: req.user.id,
        })
        .returning();

      await db
        .update(truckImportListings)
        .set({
          status: "claim_requested",
          updatedAt: new Date(),
        })
        .where(eq(truckImportListings.id, listing.id));

      const verification = await sendEmailVerificationIfNeeded(
        req.user,
        req,
      ).catch((error) => {
        console.error(
          "[email] Failed to send verification after truck claim:",
          error,
        );
        return {
          sent: false,
          skippedReason: "provider_not_configured" as const,
        };
      });

      const notificationEmail = "notifications@mealscout.us";
      await emailService.sendBasicEmail(
        notificationEmail,
        "Food Truck Claim Submitted",
        `
          <p>A food truck claim was submitted.</p>
          <p><strong>Truck:</strong> ${restaurant.name}</p>
          <p><strong>Listing ID:</strong> ${listing.id}</p>
          <p><strong>User ID:</strong> ${req.user.id}</p>
          <p><strong>Email:</strong> ${req.user.email || "Unknown"}</p>
        `,
      );

      res.json({
        restaurant,
        claimRequestId: claimRequest?.id,
        usedSeededRestaurant: Boolean(seededRestaurantCandidate),
        emailVerificationSent: verification.sent,
      });
    } catch (error: any) {
      console.error("Error creating truck claim:", error);
      res.status(400).json({
        message: error.message || "Failed to claim truck listing",
      });
    }
  });

  // Restaurant routes (require restaurant owner authentication)
  app.post("/api/restaurants", isRestaurantOwner, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const restaurantData = insertRestaurantSchema.parse({
        ...req.body,
        ownerId: userId,
      });

      const restaurant = await storage.createRestaurant(restaurantData);

      // VAC-lite auto-verify (with fallback to manual verification request)
      try {
        const enabled =
          String(
            process.env.VAC_AUTO_VERIFY_ENABLED || "true",
          ).toLowerCase() !== "false";
        if (enabled) {
          const vac = await vacEvaluateRestaurantSignup({
            user: req.user,
            restaurant,
            req,
          });
          console.log("🔍 VAC-lite evaluation:", {
            restaurantId: restaurant.id,
            restaurantName: (restaurant as any).name,
            score: vac.score,
            threshold: vac.threshold,
            shouldAutoVerify: vac.shouldAutoVerify,
            signals: vac.signals,
          });

          if (vac.shouldAutoVerify) {
            console.log("✅ Auto-verifying restaurant:", restaurant.id);
            await storage.setRestaurantVerified(restaurant.id, true);
            (restaurant as any).isVerified = true;
            try {
              await ensureTrialForUser(req.user);
            } catch (e) {
              console.warn(
                "ensureTrialForUser failed after /api/restaurants auto-verify:",
                e,
              );
            }
          } else {
            console.log(
              "⚠️  Creating manual verification request for:",
              restaurant.id,
            );
            const hasPending = await storage.hasPendingVerificationRequest(
              restaurant.id,
            );
            if (!hasPending) {
              await storage.createVerificationRequest({
                restaurantId: restaurant.id,
                documents: [],
              });
            } else {
              console.log("ℹ️  Pending verification request already exists");
            }
          }
        }
      } catch (e) {
        console.warn("VAC-lite failed", e);
        // Never block creation due to VAC issues
      }

      res.json(restaurant);
    } catch (error: any) {
      console.error("Error creating restaurant:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/restaurants/my", isRestaurantOwner, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const restaurants = await storage.getRestaurantsByOwner(userId);
      res.json(restaurants);
    } catch (error) {
      console.error("Error fetching restaurants:", error);
      res.status(500).json({ message: "Failed to fetch restaurants" });
    }
  });

  // Restaurant owner authentication check endpoint
  app.get(
    "/api/auth/restaurant/user",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const user = req.user;
        res.json(sanitizeUser(user));
      } catch (error) {
        console.error("Error fetching restaurant owner:", error);
        res.status(500).json({ message: "Failed to fetch user" });
      }
    },
  );

  // Restaurant search endpoint (returns restaurants matching search query)
  // Must come before /:id route to avoid matching "search" as an ID
  app.get("/api/restaurants/search", async (req, res) => {
    try {
      const { q: query, lat, lng, radius = 10 } = req.query;

      console.log("🔍 Restaurant search request:", { query, lat, lng, radius });

      if (!query || typeof query !== "string" || query.length < 2) {
        console.log("⚠️  Empty or short query, returning empty array");
        return res.json([]);
      }

      const searchTerm = query.toLowerCase();
      const restaurants = await storage.getAllRestaurants();

      let filteredRestaurants = restaurants.filter(
        (restaurant: any) =>
          restaurant.isActive &&
          (restaurant.name.toLowerCase().includes(searchTerm) ||
            restaurant.cuisineType?.toLowerCase().includes(searchTerm) ||
            restaurant.address?.toLowerCase().includes(searchTerm)),
      );

      // Filter by distance if coordinates provided
      if (lat && lng && typeof lat === "string" && typeof lng === "string") {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const radiusKm = parseFloat(radius as string);

        filteredRestaurants = filteredRestaurants.filter((restaurant: any) => {
          if (!restaurant.latitude || !restaurant.longitude) return false;

          // Calculate distance using Haversine formula
          const R = 6371; // Earth's radius in km
          const dLat = ((restaurant.latitude - userLat) * Math.PI) / 180;
          const dLng = ((restaurant.longitude - userLng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((userLat * Math.PI) / 180) *
              Math.cos((restaurant.latitude * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c;

          return distance <= radiusKm;
        });
      }

      res.json(filteredRestaurants);
    } catch (error) {
      console.error("Error searching restaurants:", error);
      res.status(500).json({ message: "Failed to search restaurants" });
    }
  });

  app.get("/api/restaurants/:id", async (req, res) => {
    try {
      const restaurant = await storage.getRestaurant(req.params.id);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      res.json(restaurant);
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  app.get("/api/restaurants/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = parseFloat(req.query.radius as string) || 5; // Default 5km radius

      const restaurants = await storage.getNearbyRestaurants(lat, lng, radius);
      res.json(restaurants);
    } catch (error) {
      console.error("Error fetching nearby restaurants:", error);
      res.status(500).json({ message: "Failed to fetch nearby restaurants" });
    }
  });

  // Restaurant favorites endpoints
  app.post(
    "/api/restaurants/:restaurantId/favorite",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const MAX_FAVORITES = 3;

        // Check if restaurant exists
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const favoriteCount =
          await storage.getUserRestaurantFavoritesCount(userId);
        if (favoriteCount >= MAX_FAVORITES) {
          return res.status(400).json({
            message: `You can favorite up to ${MAX_FAVORITES} restaurants.`,
          });
        }

        const favoriteData = insertRestaurantFavoriteSchema.parse({
          restaurantId,
          userId,
        });

        const favorite = await storage.createRestaurantFavorite(favoriteData);
        res.json(favorite);
      } catch (error: any) {
        console.error("Error adding restaurant favorite:", error);
        if (error.code === "23505") {
          // Unique constraint violation
          return res
            .status(400)
            .json({ message: "Restaurant already favorited" });
        }
        res
          .status(400)
          .json({ message: error.message || "Failed to add favorite" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/favorite",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        await storage.removeRestaurantFavorite(restaurantId, userId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing restaurant favorite:", error);
        res.status(500).json({ message: "Failed to remove favorite" });
      }
    },
  );

  app.get(
    "/api/favorites/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const favorites = await storage.getUserRestaurantFavorites(userId);
        res.json(favorites);
      } catch (error) {
        console.error("Error fetching user restaurant favorites:", error);
        res.status(500).json({ message: "Failed to fetch favorites" });
      }
    },
  );

  // Restaurant follow endpoints
  app.post(
    "/api/restaurants/:restaurantId/follow",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const followData = insertRestaurantFollowSchema.parse({
          restaurantId,
          userId,
        });

        const follow = await storage.createRestaurantFollow(followData);
        res.json(follow);
      } catch (error: any) {
        console.error("Error adding restaurant follow:", error);
        if (error.code === "23505") {
          return res
            .status(400)
            .json({ message: "Restaurant already followed" });
        }
        res
          .status(400)
          .json({ message: error.message || "Failed to follow restaurant" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/follow",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        await storage.removeRestaurantFollow(restaurantId, userId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing restaurant follow:", error);
        res.status(500).json({ message: "Failed to unfollow restaurant" });
      }
    },
  );

  app.get(
    "/api/following/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const follows = await storage.getUserRestaurantFollows(userId);
        res.json(follows);
      } catch (error) {
        console.error("Error fetching user restaurant follows:", error);
        res.status(500).json({ message: "Failed to fetch follows" });
      }
    },
  );

  // Restaurant recommend endpoints (one per restaurant)
  app.post(
    "/api/restaurants/:restaurantId/recommend",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const recommendationData =
          insertRestaurantUserRecommendationSchema.parse({
            restaurantId,
            userId,
          });

        const recommendation =
          await storage.createRestaurantUserRecommendation(recommendationData);
        res.json(recommendation);
      } catch (error: any) {
        console.error("Error adding restaurant recommendation:", error);
        if (error.code === "23505") {
          return res
            .status(400)
            .json({ message: "Restaurant already recommended" });
        }
        res.status(400).json({
          message: error.message || "Failed to recommend restaurant",
        });
      }
    },
  );

  app.get(
    "/api/recommendations/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const recommendations =
          await storage.getUserRestaurantRecommendations(userId);
        res.json(recommendations);
      } catch (error) {
        console.error("Error fetching user restaurant recommendations:", error);
        res.status(500).json({ message: "Failed to fetch recommendations" });
      }
    },
  );

  // Analytics endpoint for restaurant owners to see favorites (paid feature)
  app.get(
    "/api/restaurants/:restaurantId/analytics/favorites",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          userId,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(userId);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        const { startDate, endDate } = req.query;
        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const favoritesAnalytics =
          await storage.getRestaurantFavoritesAnalytics(
            restaurantId,
            dateRange,
          );
        res.json(favoritesAnalytics);
      } catch (error) {
        console.error("Error fetching favorites analytics:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch favorites analytics" });
      }
    },
  );

  // Analytics endpoint for restaurant owners to see recommendations (paid feature)
  app.get(
    "/api/restaurants/:restaurantId/analytics/recommendations",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          userId,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        // Validate analytics access (paid feature)
        const analyticsAccess = await validateAnalyticsAccess(userId);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        const { startDate, endDate } = req.query;
        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const recommendationsAnalytics =
          await storage.getRestaurantRecommendationsAnalytics(
            restaurantId,
            dateRange,
          );
        res.json(recommendationsAnalytics);
      } catch (error) {
        console.error("Error fetching recommendations analytics:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch recommendations analytics" });
      }
    },
  );

  // Track recommendation click-through (public endpoint for tracking)
  app.post(
    "/api/restaurants/:restaurantId/recommendation/click",
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { recommendationId } = req.body;

        if (recommendationId) {
          await storage.markRecommendationClicked(recommendationId);
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Error tracking recommendation click:", error);
        res
          .status(500)
          .json({ message: "Failed to track recommendation click" });
      }
    },
  );

  // Verification routes for restaurant owners
  app.post(
    "/api/restaurants/:id/verification/request",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = req.params.id;
        const userId = req.user.id;

        // Verify restaurant ownership
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant || restaurant.ownerId !== userId) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        // Imported food trucks must submit a license number that matches the gov registry ID we seeded.
        if (restaurant.claimedFromImportId) {
          const [listing] = await db
            .select({
              externalId: truckImportListings.externalId,
            })
            .from(truckImportListings)
            .where(eq(truckImportListings.id, restaurant.claimedFromImportId))
            .limit(1);
          const expected = String(listing?.externalId || "").trim();
          if (expected) {
            const provided = String(req.body?.licenseNumber || "").trim();
            if (!provided) {
              return res.status(400).json({
                message: "License number is required for imported food trucks.",
              });
            }
            if (provided.toLowerCase() !== expected.toLowerCase()) {
              return res.status(400).json({
                message:
                  "License number does not match the registry record for this truck.",
              });
            }
          }
        }

        // Check rate limiting
        const rateLimit = checkRateLimit(restaurantId);
        if (!rateLimit.allowed) {
          return res.status(429).json({
            message:
              "Rate limit exceeded. Only one verification request per restaurant per hour is allowed.",
            nextAllowedTime: rateLimit.nextAllowedTime,
          });
        }

        // Check for existing pending requests (dedupe)
        const hasPendingRequest =
          await storage.hasPendingVerificationRequest(restaurantId);
        if (hasPendingRequest) {
          return res.status(409).json({
            message:
              "A verification request is already pending for this restaurant. Please wait for admin review.",
          });
        }

        // Validate request body with schema first
        const verificationData = insertVerificationRequestSchema.parse({
          ...req.body,
          restaurantId,
        });

        // Additional server-side document validation for security
        const documentValidation = validateDocuments(
          verificationData.documents,
        );
        if (!documentValidation.valid) {
          return res.status(400).json({
            message: "Document validation failed",
            errors: documentValidation.errors,
          });
        }

        const verificationRequest =
          await storage.createVerificationRequest(verificationData);
        res.json(verificationRequest);
      } catch (error: any) {
        console.error("Error creating verification request:", error);
        res.status(400).json({
          message: error.message || "Failed to create verification request",
        });
      }
    },
  );

  app.get(
    "/api/restaurants/my/verifications",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const verifications =
          await storage.getVerificationRequestsByOwner(userId);
        res.json(verifications);
      } catch (error) {
        console.error("Error fetching verification requests:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch verification requests" });
      }
    },
  );

  // Deal routes
  app.post("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      console.log("🟢 POST /api/deals - incoming request", {
        userId: req.user?.id,
        ip: req.ip,
        ua: req.headers["user-agent"],
      });
      await logAudit(
        req.user.id,
        "deal_create",
        "deal",
        undefined,
        req.ip,
        req.headers["user-agent"],
        req.body,
      );
      const userId = req.user.id;

      // Normalize incoming payload to expected types to avoid Zod parse hangs
      const raw = req.body || {};
      const normalized = {
        ...raw,
        // discountValue should remain as string for decimal type
        discountValue:
          typeof raw.discountValue === "number"
            ? raw.discountValue.toString()
            : raw.discountValue,
        minOrderAmount:
          raw.minOrderAmount === "" || raw.minOrderAmount == null
            ? null
            : typeof raw.minOrderAmount === "number"
              ? raw.minOrderAmount.toString()
              : raw.minOrderAmount,
        totalUsesLimit:
          raw.totalUsesLimit === "" || raw.totalUsesLimit == null
            ? null
            : typeof raw.totalUsesLimit === "string"
              ? parseInt(raw.totalUsesLimit)
              : raw.totalUsesLimit,
        perCustomerLimit:
          raw.perCustomerLimit === "" || raw.perCustomerLimit == null
            ? 1
            : typeof raw.perCustomerLimit === "string"
              ? parseInt(raw.perCustomerLimit)
              : raw.perCustomerLimit,
        // Convert date strings to Date objects
        startDate:
          typeof raw.startDate === "string"
            ? new Date(raw.startDate)
            : raw.startDate,
        endDate:
          raw.isOngoing || raw.endDate === "" || raw.endDate == null
            ? null
            : typeof raw.endDate === "string"
              ? new Date(raw.endDate)
              : raw.endDate,
        // Times nullable if business hours
        startTime: raw.availableDuringBusinessHours ? null : raw.startTime,
        endTime: raw.availableDuringBusinessHours ? null : raw.endTime,
      };

      console.log("🧭 Normalized deal payload", {
        restaurantId: normalized.restaurantId,
        title: normalized.title,
        dealType: normalized.dealType,
        discountValue: normalized.discountValue,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
      });

      const dealData = insertDealSchema.parse(normalized);

      // Verify restaurant ownership
      const restaurant = await storage.getRestaurant(dealData.restaurantId);
      if (!restaurant || restaurant.ownerId !== userId) {
        console.warn(
          "🚫 Deal creation rejected - unauthorized restaurant ownership",
          {
            userId,
            restaurantId: dealData.restaurantId,
            ownerId: restaurant?.ownerId,
          },
        );
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Validate subscription limits
      const subscriptionValidation = await validateSubscriptionLimits(userId);
      console.log("📊 Subscription validation", subscriptionValidation);
      if (!subscriptionValidation.isValid) {
        return res.status(402).json({
          message: subscriptionValidation.error,
          currentCount: subscriptionValidation.currentCount,
          maxDeals: subscriptionValidation.maxDeals,
        });
      }

      const deal = await storage.createDeal(dealData);
      console.log("✅ Deal created", {
        id: deal.id,
        restaurantId: deal.restaurantId,
        title: deal.title,
      });

      const restaurantLat = toNumeric((restaurant as any)?.latitude);
      const restaurantLng = toNumeric((restaurant as any)?.longitude);
      if (restaurantLat != null && restaurantLng != null) {
        void notifyNearbyDealSubscribers({
          creatorUserId: userId,
          dealId: deal.id,
          dealTitle: deal.title,
          restaurantName: restaurant.name,
          lat: restaurantLat,
          lng: restaurantLng,
        }).catch((err) => {
          console.error("Failed to send nearby deal notifications:", err);
        });
      }

      res.json(deal);
    } catch (error: any) {
      console.error("❌ Error creating deal:", error?.message || error);
      if (error?.stack) {
        console.error(error.stack);
      }
      res
        .status(400)
        .json({ message: error?.message || "Failed to create deal" });
    }
  });

  app.get("/api/deals/active", async (req, res) => {
    try {
      const deals = await storage.getActiveDeals();
      const filteredDeals = await filterDealsByBusinessAccess(deals as any[]);
      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching active deals:", error);
      res.status(500).json({ message: "Failed to fetch deals" });
    }
  });

  // Get all active deals for the authenticated restaurant owner's restaurants
  app.get("/api/deals/my-active", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      // Get all restaurants owned by this user
      const restaurants = await storage.getRestaurantsByOwner(userId);

      // Get all active deals for all restaurants
      const allDeals = await Promise.all(
        restaurants.map(async (restaurant) => {
          const deals = await storage.getDealsByRestaurant(restaurant.id);
          return deals.filter((deal) => deal.isActive);
        }),
      );

      // Flatten the array of arrays into a single array
      const activeDeals = allDeals.flat();

      res.json(activeDeals);
    } catch (error) {
      console.error("Error fetching my active deals:", error);
      res.status(500).json({ message: "Failed to fetch active deals" });
    }
  });

  app.get("/api/deals/featured", async (req, res) => {
    try {
      // Support filtering: ?filter=limited-time for limited time deals only, or no filter for all deals
      const filter = req.query.filter as string;
      const showLimitedTimeOnly = filter === "limited-time";

      const deals = await storage.getFilteredDeals(showLimitedTimeOnly);
      const filteredDeals = await filterDealsByBusinessAccess(deals as any[]);

      // Add cache headers for client-side caching
      res.set({
        "Cache-Control": "public, max-age=300", // 5 minutes
        ETag: `"deals-${filter || "all"}-${Date.now()}"`,
      });

      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching featured deals:", error);
      res.status(500).json({ message: "Failed to fetch featured deals" });
    }
  });

  // City-indexed deals: freshness-first (only active, in-window deals).
  app.get("/api/public/deals/city/:citySlug", async (req, res) => {
    try {
      const { cities, deals, restaurants } = await import("@shared/schema");
      const citySlug = String(req.params.citySlug || "").trim().toLowerCase();
      if (!citySlug) return res.status(400).json({ message: "City slug required" });

      const [city] = await db.select().from(cities).where(eq(cities.slug, citySlug)).limit(1);
      if (!city) return res.status(404).json({ message: "City not found" });

      const now = new Date();
      const cityName = String(city.name || "").trim();
      const cityLike = `%${cityName}%`;

      const rows = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          imageUrl: deals.imageUrl,
          startDate: deals.startDate,
          endDate: deals.endDate,
          discountValue: deals.discountValue,
          dealType: deals.dealType,
          restaurantId: restaurants.id,
          restaurantName: restaurants.name,
          cuisineType: restaurants.cuisineType,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(
          and(
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
            or(ilike(restaurants.city, cityLike), ilike(restaurants.address, cityLike)),
          ),
        )
        .orderBy(desc(deals.updatedAt))
        .limit(500);

      const baseUrl = resolveSitemapSiteUrl();
      const payload = rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
        startDate: row.startDate ? new Date(row.startDate).toISOString() : null,
        endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
        dealType: row.dealType,
        discountValue: row.discountValue,
        dealPath: `/deal/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
        restaurant: {
          id: row.restaurantId,
          name: row.restaurantName,
          cuisineType: row.cuisineType || null,
          city: row.restaurantCity || null,
          state: row.restaurantState || null,
          entityPath:
            row.businessType === "bar"
              ? `/bar/${encodeURIComponent(`${toSlug(row.restaurantName) || row.restaurantId}--${row.restaurantId}`)}`
              : `/truck/${encodeURIComponent(`${toSlug(row.restaurantName) || row.restaurantId}--${row.restaurantId}`)}`,
        },
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      }));

      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({
        city: { name: city.name, slug: city.slug, state: city.state || null },
        generatedAt: new Date().toISOString(),
        totalDeals: payload.length,
        canonicalUrl: `${baseUrl}/deals/${encodeURIComponent(city.slug)}`,
        deals: payload,
      });
    } catch (error) {
      console.error("[deals-city] error:", error);
      res.status(500).json({ message: "Unable to load city deals" });
    }
  });

  // New endpoint: Get all active deals for a specific restaurant
  app.get("/api/deals/restaurant/:restaurantId", async (req, res) => {
    try {
      // Validate restaurant ID parameter
      const restaurantIdSchema = z
        .string()
        .uuid("Invalid restaurant ID format");
      const restaurantId = restaurantIdSchema.parse(req.params.restaurantId);

      // Get restaurant info first
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      const isOwnerViewing =
        Boolean(req.isAuthenticated?.()) &&
        String((req as any)?.user?.id || "") ===
          String((restaurant as any).ownerId || "");
      const ownerHasAccess = await hasBusinessDistributionAccess(
        String((restaurant as any).ownerId || ""),
      );
      if (!ownerHasAccess && !isOwnerViewing) {
        return res.json([]);
      }

      // Get all active deals for this restaurant with restaurant data included
      const allRestaurantDeals =
        await storage.getDealsByRestaurant(restaurantId);
      const activeDeals = allRestaurantDeals
        .filter((deal) => deal.isActive)
        .map((deal) => ({
          ...deal,
          restaurant: {
            name: restaurant.name,
            cuisineType: restaurant.cuisineType,
            phone: restaurant.phone,
          },
        }));

      // Add cache headers
      res.set({
        "Cache-Control": "public, max-age=180", // 3 minutes
        ETag: `"restaurant-deals-${restaurantId}-${Date.now()}"`,
      });

      res.json(activeDeals);
    } catch (error: any) {
      console.error("Error fetching restaurant deals:", error);
      if (error.name === "ZodError") {
        return res
          .status(400)
          .json({ message: "Invalid restaurant ID format" });
      }
      res.status(500).json({ message: "Failed to fetch restaurant deals" });
    }
  });

  app.get("/api/deals/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = parseFloat(req.query.radius as string) || 5;

      const deals = await storage.getNearbyDeals(lat, lng, radius);
      const filteredDeals = await filterDealsByBusinessAccess(deals as any[]);
      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching nearby deals:", error);
      res.status(500).json({ message: "Failed to fetch nearby deals" });
    }
  });

  // Advanced search endpoint with filters
  app.get("/api/deals/search", async (req, res) => {
    try {
      const {
        q: query,
        cuisine,
        minPrice,
        maxPrice,
        radius = 10,
        lat,
        lng,
        sortBy = "relevance",
      } = req.query;

      const deals = await storage.searchDeals({
        query: query as string,
        cuisineType: cuisine as string,
        minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
        latitude: lat ? parseFloat(lat as string) : undefined,
        longitude: lng ? parseFloat(lng as string) : undefined,
        radius: parseFloat(radius as string),
        sortBy: sortBy as string,
      });

      const filteredDeals = await filterDealsByBusinessAccess(deals as any[]);
      res.json(filteredDeals);
    } catch (error) {
      console.error("Error searching deals:", error);
      res.status(500).json({ message: "Failed to search deals" });
    }
  });

  // Deals recommendations endpoint (missing implementation)
  app.get("/api/deals/recommended", async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID || "anonymous";

      // For now, return featured deals (active deals)
      // In a real implementation, this would use ML/AI recommendations
      const recommendedDeals = await storage.getActiveDeals();
      const filteredDeals = await filterDealsByBusinessAccess(
        recommendedDeals as any[],
      );

      // Track restaurant recommendations for analytics (background task)
      if (filteredDeals.length > 0) {
        // Track recommendations for analytics (don't wait for completion)
        Promise.all(
          filteredDeals.slice(0, 10).map(async (deal: any) => {
            try {
              await storage.trackRestaurantRecommendation({
                restaurantId: deal.restaurantId,
                userId,
                sessionId,
                recommendationType: "personalized",
                recommendationContext: "deals_recommended_endpoint",
              });
            } catch (err) {
              console.error("Error tracking recommendation:", err);
            }
          }),
        ).catch((err) =>
          console.error("Error tracking recommendations batch:", err),
        );
      }

      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching recommended deals:", error);
      res.status(500).json({ message: "Failed to fetch recommended deals" });
    }
  });

  app.get("/api/deals/:id", async (req, res) => {
    try {
      const deal = await storage.getDeal(req.params.id);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      const restaurant = await storage.getRestaurant(String(deal.restaurantId));
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      const isOwnerViewing =
        Boolean(req.isAuthenticated?.()) &&
        String((req as any)?.user?.id || "") ===
          String((restaurant as any).ownerId || "");
      const ownerHasAccess = await hasBusinessDistributionAccess(
        String((restaurant as any).ownerId || ""),
      );
      if (!ownerHasAccess && !isOwnerViewing) {
        return res.status(404).json({ message: "Deal not found" });
      }
      res.json(deal);
    } catch (error) {
      console.error("Error fetching deal:", error);
      res.status(500).json({ message: "Failed to fetch deal" });
    }
  });

  // Review routes
  app.post("/api/reviews", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        userId,
      });

      const review = await storage.createReview(reviewData);
      res.json(review);
    } catch (error: any) {
      console.error("Error creating review:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/reviews/restaurant/:restaurantId", async (req, res) => {
    try {
      const reviews = await storage.getRestaurantReviews(
        req.params.restaurantId,
      );
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  app.get("/api/reviews/restaurant/:restaurantId/rating", async (req, res) => {
    try {
      const rating = await storage.getRestaurantAverageRating(
        req.params.restaurantId,
      );
      res.json({ rating });
    } catch (error) {
      console.error("Error fetching rating:", error);
      res.status(500).json({ message: "Failed to fetch rating" });
    }
  });

  // New idempotent subscription initialization endpoint (read-only: no Stripe mutation)
  app.post(
    "/api/subscriptions/initialize",
    isAuthenticated,
    async (req: any, res) => {
      const user = req.user;
      const {
        hasMultipleDealsAddon = false,
        billingInterval = "month",
        promoCode = "",
      } = req.body;

      const testModeEnabled =
        String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true" ||
        process.env.NODE_ENV !== "production";
      const testPromosRequireAdmin =
        String(process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() ===
        "true";
      const normalizedPromoCode = String(promoCode || "").trim().toUpperCase();
      const isTestDollarPromo =
        normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
      const isAdminUser = ["admin", "super_admin", "staff"].includes(String(user?.userType || ""));

      console.log("=== Subscription Initialize Request ===");
      console.log("User ID:", user?.id);
      console.log("User Email:", user?.email);
      console.log("Promo Code:", promoCode);
      console.log("Billing Interval:", billingInterval);

      if (["restaurant_owner", "food_truck"].includes(user?.userType)) {
        const restaurantsByOwner = await storage.getRestaurantsByOwner(user.id);
        const hasVerified = restaurantsByOwner.some(
          (restaurant) => restaurant.isVerified,
        );
        if (!hasVerified) {
          return res.status(403).json({
            error: {
              message:
                "Verification is required before enabling premium features.",
            },
          });
        }
      }

      const hydratedUser = await ensureTrialForUser(user);
      if (isTrialActive(hydratedUser)) {
        return res.send({
          status: "active",
          subscriptionId: null,
          trialAccess: true,
          message:
            "Your 30-day premium trial is active. We'll prompt you to pay before it ends.",
        });
      }

      if (!stripe) {
        return res
          .status(503)
          .json({ error: { message: "Payment processing is not configured" } });
      }

      // TEST1: read-only preview; actual subscription created in /api/create-subscription
      if (isTestDollarPromo) {
        if (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser)) {
          return res.status(403).json({ error: { message: "Not authorized" } });
        }
        if (!user.email) {
          return res
            .status(400)
            .json({ error: { message: "No user email on file" } });
        }
        return res.send({
          status: "quote",
          promo: normalizedPromoCode,
          testPricing: true,
          label: "$1 test plan",
          billingInterval: "month",
        });
      }

      if (!user.email) {
        return res
          .status(400)
          .json({ error: { message: "No user email on file" } });
      }

      // Read-only quote: select Price ID by stored signup date (no mutation)
      try {
        const { locked, priceId, label } = await getLockedPriceForUser(user.id);
        return res.send({
          status: "quote",
          priceId,
          locked,
          label,
          billingInterval: "month",
        });
      } catch (error: any) {
        console.error("Initialize quote error:", error);
        return res.status(503).json({
          error: {
            message: error.message || "Unable to provide pricing quote",
          },
        });
      }
    },
  );

  // Legacy Stripe subscription route for restaurant fees (kept for backward compatibility)
  app.post(
    "/api/create-subscription",
    isAuthenticated,
    async (req: any, res) => {
      const user = req.user;
      const {
        hasMultipleDealsAddon,
        promoCode,
        billingInterval = "month",
        applyCreditsCents,
      } = req.body; // boolean for multiple deals addon, billing interval

      const testModeEnabled =
        String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true" ||
        process.env.NODE_ENV !== "production";
      const testPromosRequireAdmin =
        String(process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() ===
        "true";
      const normalizedPromoCode = String(promoCode || "").trim().toUpperCase();
      const isTestDollarPromo =
        normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
      const isAdminUser = ["admin", "super_admin", "staff"].includes(String(user?.userType || ""));

      const hydratedUser = await ensureTrialForUser(user);
      if (isTrialActive(hydratedUser)) {
        return res.status(400).json({
          error: {
            message:
              "Your 30-day premium trial is already active. We'll prompt you to pay before it ends.",
          },
        });
      }

      if (["restaurant_owner", "food_truck"].includes(user?.userType)) {
        const restaurantsByOwner = await storage.getRestaurantsByOwner(user.id);
        const hasVerified = restaurantsByOwner.some(
          (restaurant) => restaurant.isVerified,
        );
        if (!hasVerified) {
          return res.status(403).json({
            error: {
              message:
                "Verification is required before enabling premium features.",
            },
          });
        }
      }

      // Check for test promo code (charges $1 for testing)
      if (isTestDollarPromo) {
        if (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser)) {
          return res.status(403).json({
            error: { message: "Not authorized" },
          });
        }
        if (!stripe) {
          return res.status(503).json({
            error: { message: "Payment service temporarily unavailable" },
          });
        }

        if (!user.email) {
          return res
            .status(400)
            .json({ error: { message: "No user email on file" } });
        }

        try {
          let customerId = user.stripeCustomerId;

          if (!customerId) {
            const customer = await stripe.customers.create({
              email: user.email,
              name:
                user.firstName && user.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : user.email,
            });
            customerId = customer.id;
          }

          // Create a $1 test subscription directly
          const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [
              {
                price_data: {
                  currency: "usd",
                  product: (
                    await stripe.products.create({ name: "MealScout Test $1" })
                  ).id,
                  unit_amount: 100,
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
            payment_behavior: "default_incomplete",
            expand: ["latest_invoice.payment_intent"],
          });

          await storage.updateUserStripeInfo(
            user.id,
            customerId,
            subscription.id,
            `standard-${billingInterval}`,
          );

          const latestInvoice = subscription.latest_invoice;
          const paymentIntent =
            typeof latestInvoice === "object" && latestInvoice
              ? (latestInvoice as any).payment_intent
              : null;
          return res.send({
            subscriptionId: subscription.id,
            clientSecret:
              typeof paymentIntent === "object" && paymentIntent
                ? paymentIntent.client_secret
                : null,
            testPricing: true,
            message: "Test pricing applied - $1 charge",
          });
        } catch (error: any) {
          console.error("Error creating test subscription:", error);
          return res.status(400).send({ error: { message: error.message } });
        }
      }

      if (!stripe) {
        return res
          .status(503)
          .json({ error: { message: "Payment processing is not configured" } });
      }

      // Support monthly only
      const validIntervals = ["month"];
      const interval = validIntervals.includes(billingInterval)
        ? billingInterval
        : "month";

      if (user.stripeSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(
            user.stripeSubscriptionId,
            {
              expand: ["latest_invoice.payment_intent"],
            },
          );

          // If subscription is incomplete or incomplete_expired, cancel it and create a new one
          if (
            subscription.status === "incomplete" ||
            subscription.status === "incomplete_expired"
          ) {
            console.log(
              `Canceling incomplete subscription ${subscription.id} to create new one`,
            );
            await stripe.subscriptions.cancel(subscription.id);
            // Clear the subscription ID so we create a new one below
            await storage.updateUser(user.id, { stripeSubscriptionId: null });
          } else {
            // If subscription is active, return existing
            const latestInvoice = subscription.latest_invoice;
            const paymentIntent =
              typeof latestInvoice === "object" && latestInvoice
                ? (latestInvoice as any).payment_intent
                : null;

            res.send({
              subscriptionId: subscription.id,
              clientSecret:
                typeof paymentIntent === "object" && paymentIntent
                  ? paymentIntent.client_secret
                  : null,
            });
            return;
          }
        } catch (error) {
          console.error("Error retrieving subscription:", error);
        }
      }

      if (!user.email) {
        return res
          .status(400)
          .json({ error: { message: "No user email on file" } });
      }

      try {
        let customerId = user.stripeCustomerId;

        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name:
              user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.email,
          });
          customerId = customer.id;
        }

        let creditAppliedCents = 0;
        const requestedCreditCents = Number(applyCreditsCents || 0);
        if (requestedCreditCents > 0) {
          const { getUserCreditBalance, debitCredit } =
            await import("./creditService");
          const balance = await getUserCreditBalance(user.id);
          const availableCents = Math.max(0, Math.floor(balance * 100));
          creditAppliedCents = Math.min(requestedCreditCents, availableCents);

          if (creditAppliedCents > 0) {
            const balanceTx = await stripe.customers.createBalanceTransaction(
              customerId,
              {
                amount: -creditAppliedCents,
                currency: "usd",
                description: "MealScout credits applied",
              },
            );
            await debitCredit(
              user.id,
              creditAppliedCents / 100,
              "subscription_credit",
              balanceTx.id,
              "subscription",
            );
          }
        }

        // Record signup date at first actual subscription creation
        if (!user.subscriptionSignupDate) {
          await storage.updateUser(user.id, {
            subscriptionSignupDate: new Date(),
          });
        }

        // Select Stripe Price by stored signup date
        const { locked, priceId, label } = await getLockedPriceForUser(user.id);
        const amount = 2500; // for email display only

        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId }],
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent"],
          metadata:
            creditAppliedCents > 0
              ? { creditAppliedCents: creditAppliedCents.toString() }
              : undefined,
        });

        await storage.updateUserStripeInfo(
          user.id,
          customerId,
          subscription.id,
          `standard-${interval}`,
        );

        // Send payment confirmation email asynchronously
        const planType = `standard-${interval}`;
        emailService
          .sendPaymentConfirmation(user, amount, planType, subscription.id)
          .catch((err) =>
            console.error("Failed to send payment confirmation email:", err),
          );

        const latestInvoice = subscription.latest_invoice;
        const paymentIntent =
          typeof latestInvoice === "object" && latestInvoice
            ? (latestInvoice as any).payment_intent
            : null;
        res.send({
          subscriptionId: subscription.id,
          clientSecret:
            typeof paymentIntent === "object" && paymentIntent
              ? paymentIntent.client_secret
              : null,
          priceId,
          locked,
          label,
        });
      } catch (error: any) {
        console.error("Error creating subscription:", error);
        return res.status(400).send({ error: { message: error.message } });
      }
    },
  );

  // Check subscription status
  app.get(
    "/api/subscription/status",
    isAuthenticated,
    async (req: any, res) => {
      // Disable caching for subscription status
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(401).json({ status: "none", hasAccess: false });
      }

      const hydratedUser = await ensureTrialForUser(user);
      if (isTrialActive(hydratedUser)) {
        return res.json({
          status: "active",
          hasAccess: true,
          trialAccess: true,
          trialEndsAt: hydratedUser.trialEndsAt,
          message: "30-day premium trial active",
        });
      }

      if (!stripe) {
        return res.status(503).json({ message: "Payment service unavailable" });
      }

      try {
        if (!hydratedUser.stripeSubscriptionId) {
          return res.json({ status: "none", hasAccess: false });
        }

        // SECURITY FIX: Do NOT grant access based on billing interval alone
        // This field is set during initialization, NOT after payment confirmation
        // Only Stripe subscription status can confirm actual payment

        const subscription = await stripe.subscriptions.retrieve(
          hydratedUser.stripeSubscriptionId,
          {
            expand: ["latest_invoice.payment_intent"],
          },
        );

        // If subscription is incomplete, try to pay the invoice directly
        if (subscription.status === "incomplete") {
          // For test mode, force pay the invoice to complete the subscription
          const latestInvoice = subscription.latest_invoice;
          if (latestInvoice && typeof latestInvoice === "object") {
            const invoice = latestInvoice as any;
            console.log(
              `Force paying invoice ${invoice.id} to complete subscription...`,
            );

            try {
              const paidInvoice = await stripe.invoices.pay(invoice.id);
              console.log(
                `Successfully paid invoice ${invoice.id}, status: ${paidInvoice.status}`,
              );

              // Check subscription status after payment
              const refreshedSubscription = await stripe.subscriptions.retrieve(
                hydratedUser.stripeSubscriptionId,
              );
              console.log(
                `After paying invoice, subscription status: ${refreshedSubscription.status}`,
              );

              res.json({
                status: refreshedSubscription.status,
                currentPeriodEnd: (refreshedSubscription as any)
                  .current_period_end,
                cancelAtPeriodEnd: (refreshedSubscription as any)
                  .cancel_at_period_end,
              });
              return;
            } catch (payError: any) {
              console.log(`Error paying invoice: ${payError.message}`);
              // If paying fails, continue with status check below
            }
          }
        }

        res.json({
          status: subscription.status,
          currentPeriodEnd: (subscription as any).current_period_end,
          cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
        });
      } catch (error: any) {
        console.error("Subscription status error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Pause subscription endpoint
  app.post(
    "/api/subscription/pause",
    isAuthenticated,
    async (req: any, res) => {
      if (!stripe) {
        return res.status(503).json({ message: "Payment service unavailable" });
      }

      try {
        const user = req.user;

        if (!user.stripeSubscriptionId) {
          return res.status(400).json({ message: "No active subscription" });
        }

        // Pause subscription by setting pause collection
        const subscription = await stripe.subscriptions.update(
          user.stripeSubscriptionId,
          {
            pause_collection: {
              behavior: "keep_as_draft",
            },
          },
        );

        res.json({
          message: "Subscription paused successfully",
          status: subscription.status,
        });
      } catch (error: any) {
        console.error("Pause subscription error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

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

  // Cancel subscription
  app.post(
    "/api/subscription/cancel",
    isAuthenticated,
    async (req: any, res) => {
      if (!stripe) {
        return res.status(503).json({ message: "Payment service unavailable" });
      }

      try {
        const user = req.user;
        if (!user.stripeSubscriptionId) {
          return res.status(400).json({ message: "No active subscription" });
        }

        const subscription = await stripe.subscriptions.cancel(
          user.stripeSubscriptionId,
        );

        await storage.updateUser(user.id, {
          stripeSubscriptionId: null,
          subscriptionBillingInterval: null,
        });

        await storage.deactivateUserDeals(user.id);

        res.json({
          message: "Subscription cancelled immediately.",
          cancelAt: subscription.cancel_at,
        });
      } catch (error: any) {
        console.error("Cancel subscription error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Deal claiming route with Facebook integration
  app.post(
    "/api/deals/:dealId/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const dealId = req.params.dealId;
        const userId = req.user.id;

        // Get deal and restaurant info
        const deal = await storage.getDeal(dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        const restaurant = await storage.getRestaurant(deal.restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        // Check if user has already claimed this deal
        const existingClaims = await storage.getDealClaimsCount(dealId, userId);
        if (existingClaims >= (deal.perCustomerLimit || 1)) {
          return res
            .status(400)
            .json({ message: "Deal already claimed by user" });
        }

        // Check if deal is still available
        if (
          deal.totalUsesLimit &&
          (deal.currentUses || 0) >= deal.totalUsesLimit
        ) {
          return res
            .status(400)
            .json({ message: "Deal is no longer available" });
        }

        // Create the deal claim and capture the identifier so the client can show/QR it
        const claim = await storage.claimDeal({
          dealId,
          userId,
        });

        // Increment deal uses after successful claim write
        await storage.incrementDealUses(dealId);

        // Send notification to restaurant owner (best effort)
        try {
          await sendDealClaimedNotification(dealId, userId);
        } catch (emailError) {
          console.error(
            "Failed to send deal claimed notification:",
            emailError,
          );
        }

        // Prepare Facebook post data
        const facebookMessage = `🍽️ Just claimed an amazing deal at ${
          restaurant.name
        }!\n\n${deal.title}\n${deal.discountValue}% OFF (Min order: $${
          deal.minOrderAmount || "15"
        })\n\nFound this through MealScout - check it out! #MealScout #FoodDeals`;

        res.json({
          success: true,
          claimId: claim.id,
          dealTitle: deal.title,
          restaurantName: restaurant.name,
          restaurantAddress: restaurant.address,
          facebookPostData: {
            message: facebookMessage,
            place: (restaurant as any).facebookPlaceId || undefined,
          },
        });
      } catch (error: any) {
        console.error("Error claiming deal:", error);
        res.status(500).json({ message: "Failed to claim deal" });
      }
    },
  );

  // Get claims for restaurant owner's deals
  app.get(
    "/api/restaurants/:restaurantId/claims",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { status } = req.query; // pending, used, all

        // Verify user owns this restaurant
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        const claims = await storage.getRestaurantDealClaims(
          restaurantId,
          status as string,
        );
        res.json(claims);
      } catch (error) {
        console.error("Error fetching restaurant claims:", error);
        res.status(500).json({ message: "Failed to fetch restaurant claims" });
      }
    },
  );

  // Search suggestions endpoint
  app.get("/api/search/suggestions/:query", async (req, res) => {
    try {
      const { query } = req.params;

      if (!query || query.length < 2) {
        return res.json([]);
      }

      const searchTerm = query.toLowerCase();
      const searchValue = `%${searchTerm}%`;

      // v2 suggestions: restaurants + deals + parking pass spots + videos + events
      const suggestionsV2: any[] = [];

      const restaurantRows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          cuisineType: restaurants.cuisineType,
          address: restaurants.address,
        })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.isActive, true),
            or(
              sql`lower(${restaurants.name}) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.cuisineType}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.address}, '')) like ${searchValue}`,
            ),
          ),
        )
        .limit(6);

      const cuisineSuggestions = new Map<string, any>();
      for (const row of restaurantRows) {
        suggestionsV2.push({
          id: `restaurant-${row.id}`,
          text: row.name,
          type: "restaurant",
          subtitle:
            `${row.cuisineType || "Restaurant"} - ${row.address || ""}`.trim(),
        });

        const cuisine = String(row.cuisineType || "").trim();
        if (cuisine && cuisine.toLowerCase().includes(searchTerm)) {
          const key = cuisine.toLowerCase();
          if (!cuisineSuggestions.has(key)) {
            cuisineSuggestions.set(key, {
              id: `cuisine-${key}`,
              text: cuisine,
              type: "cuisine",
              subtitle: "Food category",
            });
          }
        }
      }
      suggestionsV2.push(...Array.from(cuisineSuggestions.values()));

      const dealRows = await db
        .select({
          id: deals.id,
          title: deals.title,
          discountValue: deals.discountValue,
          restaurantName: restaurants.name,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(
          and(
            eq(deals.isActive, true),
            or(
              sql`lower(${deals.title}) like ${searchValue}`,
              sql`lower(${restaurants.name}) like ${searchValue}`,
            ),
          ),
        )
        .limit(6);
      for (const row of dealRows) {
        suggestionsV2.push({
          id: `deal-${row.id}`,
          text: row.title,
          type: "deal",
          subtitle: `${row.restaurantName || "Restaurant"} - ${row.discountValue}% off`,
        });
      }

      const hostRows = await db
        .select({
          hostId: hosts.id,
          businessName: hosts.businessName,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
          latitude: hosts.latitude,
          longitude: hosts.longitude,
          spotImageUrl: hosts.spotImageUrl,
          stripeConnectAccountId: hosts.stripeConnectAccountId,
          stripeChargesEnabled: hosts.stripeChargesEnabled,
          defaultStartTime: eventSeries.defaultStartTime,
          defaultEndTime: eventSeries.defaultEndTime,
          defaultMaxTrucks: eventSeries.defaultMaxTrucks,
          breakfastPriceCents: eventSeries.defaultBreakfastPriceCents,
          lunchPriceCents: eventSeries.defaultLunchPriceCents,
          dinnerPriceCents: eventSeries.defaultDinnerPriceCents,
          dailyPriceCents: eventSeries.defaultDailyPriceCents,
          weeklyPriceCents: eventSeries.defaultWeeklyPriceCents,
          monthlyPriceCents: eventSeries.defaultMonthlyPriceCents,
        })
        .from(eventSeries)
        .innerJoin(hosts, eq(eventSeries.hostId, hosts.id))
        .where(
          and(
            eq(eventSeries.seriesType, "parking_pass"),
            eq(eventSeries.status, "published"),
            or(
              sql`lower(${hosts.businessName}) like ${searchValue}`,
              sql`lower(${hosts.address}) like ${searchValue}`,
              sql`lower(coalesce(${hosts.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${hosts.state}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(eventSeries.updatedAt))
        .limit(10);
      for (const row of hostRows.slice(0, 4)) {
        const qualityFlags = computeParkingPassQualityFlags({
          host: {
            address: row.address,
            city: row.city,
            state: row.state,
            latitude: row.latitude,
            longitude: row.longitude,
            stripeConnectAccountId: row.stripeConnectAccountId,
            stripeChargesEnabled: row.stripeChargesEnabled,
          },
          startTime: row.defaultStartTime,
          endTime: row.defaultEndTime,
          maxTrucks: row.defaultMaxTrucks,
          breakfastPriceCents: row.breakfastPriceCents,
          lunchPriceCents: row.lunchPriceCents,
          dinnerPriceCents: row.dinnerPriceCents,
          dailyPriceCents: row.dailyPriceCents,
          weeklyPriceCents: row.weeklyPriceCents,
          monthlyPriceCents: row.monthlyPriceCents,
        });
        if (qualityFlags.length > 0) continue;
        suggestionsV2.push({
          id: `parking-pass-${row.hostId}`,
          text: row.businessName || "Parking Pass spot",
          type: "parking_pass",
          subtitle: `${row.address}${row.city ? `, ${row.city}` : ""}${row.state ? `, ${row.state}` : ""}`,
        });
      }

      const nowSql = sql`NOW()`;
      const storyRows = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          restaurantName: restaurants.name,
        })
        .from(videoStories)
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            eq(videoStories.status, "ready"),
            gte(videoStories.expiresAt, nowSql as any),
            isNull(videoStories.deletedAt),
            or(
              sql`lower(coalesce(${videoStories.title}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.name}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(4);
      for (const row of storyRows) {
        suggestionsV2.push({
          id: `video-${row.id}`,
          text: row.title || "Video",
          type: "video",
          subtitle: row.restaurantName
            ? `From ${row.restaurantName}`
            : "Video story",
        });
      }

      const eventRows = await db
        .select({
          id: events.id,
          name: events.name,
          date: events.date,
          hostBusinessName: hosts.businessName,
          hostCity: hosts.city,
          hostState: hosts.state,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            eq(events.eventType, "event"),
            gte(events.date, nowSql as any),
            or(
              sql`lower(coalesce(${events.name}, '')) like ${searchValue}`,
              sql`lower(${hosts.businessName}) like ${searchValue}`,
              sql`lower(coalesce(${hosts.city}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(asc(events.date))
        .limit(4);
      for (const row of eventRows) {
        suggestionsV2.push({
          id: `event-${row.id}`,
          text: row.name || row.hostBusinessName || "Event",
          type: "event",
          subtitle: `${row.hostBusinessName}${row.hostCity ? ` - ${row.hostCity}` : ""}${row.hostState ? `, ${row.hostState}` : ""}`,
        });
      }

      const limitedSuggestionsV2 = suggestionsV2.slice(0, 10).sort((a, b) => {
        const aExact = String(a.text || "")
          .toLowerCase()
          .startsWith(searchTerm)
          ? 1
          : 0;
        const bExact = String(b.text || "")
          .toLowerCase()
          .startsWith(searchTerm)
          ? 1
          : 0;
        return bExact - aExact;
      });

      return res.json(limitedSuggestionsV2);

      // Get all deals and restaurants for suggestions
      const allDealsForSuggestions = await storage.getAllDeals();
      const allRestaurantsForSuggestions = await storage.getAllRestaurants();

      const suggestions: any[] = [];

      // Restaurant suggestions
      allRestaurantsForSuggestions.forEach((restaurant: any) => {
        if (restaurant.name.toLowerCase().includes(searchTerm)) {
          suggestions.push({
            id: `restaurant-${restaurant.id}`,
            text: restaurant.name,
            type: "restaurant",
            subtitle: `${restaurant.cuisineType} • ${
              restaurant.address || "Restaurant"
            }`,
          });
        }

        // Cuisine type suggestions
        if (
          restaurant.cuisineType &&
          restaurant.cuisineType.toLowerCase().includes(searchTerm)
        ) {
          const existing = suggestions.find(
            (s) =>
              s.text.toLowerCase() === restaurant.cuisineType.toLowerCase(),
          );
          if (!existing) {
            suggestions.push({
              id: `cuisine-${restaurant.cuisineType}`,
              text: restaurant.cuisineType,
              type: "cuisine",
              subtitle: "Food category",
            });
          }
        }
      });

      // Deal suggestions
      allDealsForSuggestions.forEach((deal: any) => {
        if (deal.title.toLowerCase().includes(searchTerm)) {
          suggestions.push({
            id: `deal-${deal.id}`,
            text: deal.title,
            type: "deal",
            subtitle: `${deal.restaurant?.name || "Restaurant"} • ${
              deal.discountValue
            }% off`,
          });
        }
      });

      // Limit to 8 suggestions and sort by relevance
      const limitedSuggestions = suggestions.slice(0, 8).sort((a, b) => {
        // Prioritize exact matches
        const aExact = a.text.toLowerCase().startsWith(searchTerm) ? 1 : 0;
        const bExact = b.text.toLowerCase().startsWith(searchTerm) ? 1 : 0;
        return bExact - aExact;
      });

      res.json(limitedSuggestions);
    } catch (error) {
      console.error("Search suggestions error:", error);
      res.status(500).json({ message: "Failed to get search suggestions" });
    }
  });

  app.get("/api/public/profiles/:entity/:id", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase();
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({ message: "Profile id is required" });
      }

      const baseUrl = (
        process.env.PUBLIC_BASE_URL ||
        process.env.SERVICE_URL ||
        "https://www.mealscout.us"
      ).replace(/\/+$/, "");

      if (entity === "restaurant") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const slug = toSlug(row.name) || row.id;
        const profilePath = `/p/restaurant/${row.id}/${slug}`;
        return res.json({
          entity: "restaurant",
          id: row.id,
          title: row.name,
          subtitle:
            row.cuisineType || (row.isFoodTruck ? "Food Truck" : "Restaurant"),
          description:
            row.description ||
            `${row.name} on MealScout. Local hours, deals, and direct booking visibility.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.phone || null : null,
          websiteUrl: row.websiteUrl || null,
          imageUrl: row.coverImageUrl || row.logoUrl || null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          social: {
            instagramUrl: row.instagramUrl || null,
            facebookPageUrl: row.facebookPageUrl || null,
            xUrl: row.xUrl || null,
          },
        });
      }

      if (entity === "host") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const slug = toSlug(row.businessName) || row.id;
        const profilePath = `/p/host/${row.id}/${slug}`;
        return res.json({
          entity: "host",
          id: row.id,
          title: row.businessName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          description:
            row.notes ||
            `${row.businessName} hosts trucks on MealScout with live event and parking availability.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.contactPhone || null : null,
          websiteUrl: null,
          imageUrl: row.spotImageUrl || null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          social: {
            instagramUrl: null,
            facebookPageUrl: null,
            xUrl: null,
          },
        });
      }

      if (entity === "supplier") {
        const [row] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, id), eq(suppliers.isActive, true)))
          .limit(1);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [counts] = await db
          .select({
            activeProductCount: sql<number>`count(*)`,
          })
          .from(supplierProducts)
          .where(
            and(
              eq(supplierProducts.supplierId, row.id),
              eq(supplierProducts.isActive, true),
            ),
          );
        const slug = toSlug(row.businessName) || row.id;
        const profilePath = `/p/supplier/${row.id}/${slug}`;
        return res.json({
          entity: "supplier",
          id: row.id,
          title: row.businessName,
          subtitle: "Supplier",
          description:
            row.onlinePaymentsNotes ||
            row.deliveryNotes ||
            `${row.businessName} supplies local trucks and kitchens on MealScout.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.contactPhone || null : null,
          websiteUrl: null,
          imageUrl: null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          metrics: {
            activeProductCount: Number(counts?.activeProductCount || 0),
          },
          social: {
            instagramUrl: null,
            facebookPageUrl: null,
            xUrl: null,
          },
        });
      }

      return res.status(400).json({ message: "Unsupported profile entity" });
    } catch (error) {
      console.error("Error fetching public profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // Trending searches (public).
  app.get("/api/search/trending", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          count(*)::int as count,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by count desc, last_seen desc
        limit ${limit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const payload = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        query: String(row.display_query || row.normalized_query || "").trim(),
        count: Number(row.count || 0),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      }));
      res.json(payload.filter((x: any) => x.query));
    } catch (error) {
      console.error("Error fetching trending searches:", error);
      res.status(500).json({ message: "Failed to fetch trending searches" });
    }
  });

  // Latest unique searches (public).
  app.get("/api/search/latest", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by last_seen desc
        limit ${limit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const payload = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        query: String(row.display_query || row.normalized_query || "").trim(),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      }));
      res.json(payload.filter((x: any) => x.query));
    } catch (error) {
      console.error("Error fetching latest searches:", error);
      res.status(500).json({ message: "Failed to fetch latest searches" });
    }
  });

  // Track a completed user search (not suggestions / keystrokes).
  app.post("/api/search/track", async (req: any, res) => {
    try {
      const bodySchema = z.object({
        query: z.string().min(1).max(200),
        source: z.string().min(1).max(64).optional(),
      });
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success)
        return res.status(400).json({ message: "Invalid request" });

      const rawQuery = String(parsed.data.query || "");
      const compacted = rawQuery.trim().replace(/\s+/g, " ");
      const normalized = normalizeSearchQuery(compacted);
      if (shouldDropSearchQuery(normalized)) return res.status(204).end();

      const source = String(parsed.data.source || "unknown").slice(0, 64);
      const userId = req.user?.id ? String(req.user.id) : null;

      await db.insert(searchQueryEvents).values({
        query: compacted,
        source,
        userId,
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error tracking search query:", error);
      res.status(500).json({ message: "Failed to track search query" });
    }
  });

  // Unified search endpoint for /search (sitewide).
  app.get("/api/search", async (req, res) => {
    try {
      const query = String(req.query?.q || "").trim();
      if (!query || query.length < 2) {
        return res.json({
          query,
          restaurants: [],
          deals: [],
          parkingPassHosts: [],
          videos: [],
          events: [],
        });
      }

      const searchTerm = query.toLowerCase();
      const searchValue = `%${searchTerm}%`;

      const restaurantMatches = await storage.getAllRestaurants();
      const restaurantsOut = restaurantMatches
        .filter((restaurant: any) => {
          if (!restaurant?.isActive) return false;
          const name = String(restaurant.name || "").toLowerCase();
          const cuisine = String(restaurant.cuisineType || "").toLowerCase();
          const address = String(restaurant.address || "").toLowerCase();
          return (
            name.includes(searchTerm) ||
            cuisine.includes(searchTerm) ||
            address.includes(searchTerm)
          );
        })
        .slice(0, 12)
        .map((restaurant: any) => ({
          id: restaurant.id,
          name: restaurant.name,
          cuisineType: restaurant.cuisineType,
          address: restaurant.address,
          isFoodTruck: Boolean(restaurant.isFoodTruck),
          isVerified: Boolean(restaurant.isVerified),
        }));

      const dealsOut = (
        await storage.searchDeals({
          query,
          sortBy: "relevance",
          radius: 9999,
        })
      ).slice(0, 12);

      const hostSeriesRows = await db
        .select({
          hostId: hosts.id,
          businessName: hosts.businessName,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
          latitude: hosts.latitude,
          longitude: hosts.longitude,
          spotImageUrl: hosts.spotImageUrl,
          stripeConnectAccountId: hosts.stripeConnectAccountId,
          stripeChargesEnabled: hosts.stripeChargesEnabled,
          defaultStartTime: eventSeries.defaultStartTime,
          defaultEndTime: eventSeries.defaultEndTime,
          defaultMaxTrucks: eventSeries.defaultMaxTrucks,
          breakfastPriceCents: eventSeries.defaultBreakfastPriceCents,
          lunchPriceCents: eventSeries.defaultLunchPriceCents,
          dinnerPriceCents: eventSeries.defaultDinnerPriceCents,
          dailyPriceCents: eventSeries.defaultDailyPriceCents,
          weeklyPriceCents: eventSeries.defaultWeeklyPriceCents,
          monthlyPriceCents: eventSeries.defaultMonthlyPriceCents,
          updatedAt: eventSeries.updatedAt,
        })
        .from(eventSeries)
        .innerJoin(hosts, eq(eventSeries.hostId, hosts.id))
        .where(
          and(
            eq(eventSeries.seriesType, "parking_pass"),
            eq(eventSeries.status, "published"),
            or(
              sql`lower(${hosts.businessName}) like ${searchValue}`,
              sql`lower(${hosts.address}) like ${searchValue}`,
              sql`lower(coalesce(${hosts.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${hosts.state}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(eventSeries.updatedAt))
        .limit(50);

      const bestHostById = new Map<string, any>();
      for (const row of hostSeriesRows) {
        const hostId = String((row as any).hostId);
        if (!bestHostById.has(hostId)) bestHostById.set(hostId, row);
      }

      const parkingPassHostsOut = Array.from(bestHostById.values())
        .map((row: any) => {
          const qualityFlags = computeParkingPassQualityFlags({
            host: {
              address: row.address,
              city: row.city,
              state: row.state,
              latitude: row.latitude,
              longitude: row.longitude,
              stripeConnectAccountId: row.stripeConnectAccountId,
              stripeChargesEnabled: row.stripeChargesEnabled,
            },
            startTime: row.defaultStartTime,
            endTime: row.defaultEndTime,
            maxTrucks: row.defaultMaxTrucks,
            breakfastPriceCents: row.breakfastPriceCents,
            lunchPriceCents: row.lunchPriceCents,
            dinnerPriceCents: row.dinnerPriceCents,
            dailyPriceCents: row.dailyPriceCents,
            weeklyPriceCents: row.weeklyPriceCents,
            monthlyPriceCents: row.monthlyPriceCents,
          });

          return {
            hostId: row.hostId,
            businessName: row.businessName,
            address: row.address,
            city: row.city,
            state: row.state,
            latitude: row.latitude,
            longitude: row.longitude,
            spotImageUrl: row.spotImageUrl,
            qualityFlags,
          };
        })
        .filter(
          (row: any) =>
            Array.isArray(row.qualityFlags) && row.qualityFlags.length === 0,
        )
        .slice(0, 12);

      const nowSql = sql`NOW()`;
      const videoRows = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          description: videoStories.description,
          restaurantId: videoStories.restaurantId,
          restaurantName: restaurants.name,
          createdAt: videoStories.createdAt,
        })
        .from(videoStories)
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            eq(videoStories.status, "ready"),
            gte(videoStories.expiresAt, nowSql as any),
            isNull(videoStories.deletedAt),
            or(
              sql`lower(coalesce(${videoStories.title}, '')) like ${searchValue}`,
              sql`lower(coalesce(${videoStories.description}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.name}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(12);

      const eventsRows = await db
        .select({
          id: events.id,
          name: events.name,
          description: events.description,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          hostId: hosts.id,
          hostBusinessName: hosts.businessName,
          hostAddress: hosts.address,
          hostCity: hosts.city,
          hostState: hosts.state,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            eq(events.eventType, "event"),
            gte(events.date, nowSql as any),
            or(
              sql`lower(coalesce(${events.name}, '')) like ${searchValue}`,
              sql`lower(coalesce(${events.description}, '')) like ${searchValue}`,
              sql`lower(${hosts.businessName}) like ${searchValue}`,
              sql`lower(coalesce(${hosts.city}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(asc(events.date))
        .limit(12);

      res.json({
        query,
        restaurants: restaurantsOut,
        deals: dealsOut,
        parkingPassHosts: parkingPassHostsOut,
        videos: videoRows,
        events: eventsRows,
      });
    } catch (error) {
      console.error("Unified search error:", error);
      res.status(500).json({ message: "Failed to search" });
    }
  });

  // Admin API endpoints
  registerAdminManagementRoutes(app);
  registerGeoAdRoutes(app);

  // Staff management and user creation endpoints
  registerStaffRoutes(app);

  // Bug report endpoint
  app.post("/api/bug-report", async (req, res) => {
    try {
      const { screenshot, currentUrl, userAgent } = req.body;

      if (!currentUrl || !userAgent) {
        return res
          .status(400)
          .json({ message: "Missing required bug report data" });
      }

      const user = req.user as User | undefined;
      const userName = user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : undefined;
      const userEmail = user?.email || undefined;

      const bugReportData = {
        userEmail,
        userName,
        userAgent,
        currentUrl,
        timestamp: new Date().toLocaleString(),
        screenshotUrl: screenshot || undefined,
      };

      // Log bug report to console if email service not configured
      console.log("🐛 Bug Report Received:");
      console.log("   User:", userName || "Anonymous");
      console.log("   Email:", userEmail || "N/A");
      console.log("   URL:", currentUrl);
      console.log("   User Agent:", userAgent);
      console.log("   Time:", bugReportData.timestamp);
      console.log(
        "   Screenshot:",
        screenshot ? `${screenshot.substring(0, 50)}...` : "None",
      );

      const success = await emailService.sendBugReport(bugReportData);

      // Always return success even if email fails (logged to console)
      res.json({
        success: true,
        message: success
          ? "Bug report sent successfully"
          : "Bug report logged (email service not configured)",
      });
    } catch (error) {
      console.error("Error submitting bug report:", error);
      res.status(500).json({ message: "Failed to submit bug report" });
    }
  });

  // Deal feedback endpoints
  app.post("/api/deals/:dealId/feedback", async (req: any, res) => {
    try {
      const { dealId } = req.params;
      const feedbackData = req.body;

      const validatedData = insertDealFeedbackSchema.parse({
        ...feedbackData,
        dealId,
        userId: req.user?.id || null,
      });

      const feedback = await storage.createDealFeedback(validatedData);
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid feedback data", errors: error.errors });
      }
      console.error("Error creating deal feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback", async (req, res) => {
    try {
      const { dealId } = req.params;
      const feedback = await storage.getDealFeedback(dealId);
      res.json(feedback);
    } catch (error) {
      console.error("Error fetching deal feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback/stats", async (req, res) => {
    try {
      const { dealId } = req.params;
      const stats = await storage.getDealFeedbackStats(dealId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching feedback stats:", error);
      res.status(500).json({ message: "Failed to fetch feedback stats" });
    }
  });

  // Handle frequent HEAD /api requests efficiently (likely from monitoring)
  app.head("/api", (req, res) => {
    res.status(200).end();
  });

  // OAuth configuration status check
  app.get(
    "/api/admin/oauth/status",
    isAuthenticated,
    isAdmin,
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

  // Health check endpoint for monitoring
  app.get("/api/health", async (req, res) => {
    try {
      // Test database connectivity
      await storage.getUser("health-check");
      const endpointWatchdog = getMapEndpointWatchdogSnapshot();

      // Avoid a recursive failure mode: the watchdog checks /api/health,
      // and /api/health previously returned 503 when the watchdog reported "not ok",
      // which makes the watchdog keep itself in a failed state.
      const isHealthy = Boolean(endpointWatchdog?.ok ?? true);

      res.status(200).json({
        status: isHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        version: "1.0.0",
        criticalEndpointWatchdog: endpointWatchdog,
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        error: "Database connection failed",
        timestamp: new Date().toISOString(),
      });
    }
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

  const toIsoDateOrNull = (value: unknown): string | null => {
    if (!value) return null;
    const dt = new Date(value as any);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.toISOString();
  };

  const sendUrlsetXml = (
    res: any,
    params: { baseUrl: string; entries: Array<{ loc: string; lastmod?: unknown }> },
  ) => {
    const lastmodByLoc = new Map<string, string | null>();
    const normalizeSitemapLoc = (loc: string): string | null => {
      const value = String(loc || "").trim();
      if (!value) return null;
      try {
        const parsed = new URL(value);
        const bareHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
        if (bareHost !== "mealscout.us") return null;
        parsed.protocol = "https:";
        parsed.hostname = "www.mealscout.us";
        parsed.hash = "";
        parsed.search = "";
        return parsed.toString();
      } catch {
        return null;
      }
    };
    const mergeUrl = (loc: string, lastmod?: unknown) => {
      const normalized = normalizeSitemapLoc(loc);
      if (!normalized) return;
      const next = toIsoDateOrNull(lastmod);
      const existing = lastmodByLoc.get(normalized) || null;
      if (!existing) {
        lastmodByLoc.set(normalized, next);
        return;
      }
      if (!next) return;
      if (new Date(next).getTime() > new Date(existing).getTime()) {
        lastmodByLoc.set(normalized, next);
      }
    };

    for (const entry of params.entries) {
      mergeUrl(entry.loc, entry.lastmod);
    }

    const urls = Array.from(lastmodByLoc.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([loc, lastmod]) => ({ loc, lastmod }));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map(
        (entry) =>
          `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`,
      )
      .join("\n")}\n</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
    res.send(xml);
  };

  // Dynamic sitemap.xml (proxied by Vercel)
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const { cities } = await import("@shared/schema");
      const cityRows = await db
        .select()
        .from(cities)
        .orderBy(desc(cities.createdAt));
      const restaurantRows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          city: restaurants.city,
          cuisineType: restaurants.cuisineType,
          isFoodTruck: restaurants.isFoodTruck,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt));
      const hostRows = await db
        .select({
          id: hosts.id,
          name: hosts.businessName,
          updatedAt: hosts.updatedAt,
        })
        .from(hosts)
        .orderBy(desc(hosts.updatedAt));
      const supplierRows = await db
        .select({
          id: suppliers.id,
          name: suppliers.businessName,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt));

      const baseUrl = resolveSitemapSiteUrl();
      const lastmodByLoc = new Map<string, string | null>();
      const normalizeSitemapLoc = (loc: string): string | null => {
        const value = String(loc || "").trim();
        if (!value) return null;
        try {
          const parsed = new URL(value);
          const bareHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
          if (bareHost !== "mealscout.us") return null;
          parsed.protocol = "https:";
          parsed.hostname = "www.mealscout.us";
          parsed.hash = "";
          parsed.search = "";
          return parsed.toString();
        } catch {
          return null;
        }
      };
      const mergeUrl = (loc: string, lastmod?: unknown) => {
        const normalizedLoc = normalizeSitemapLoc(loc);
        if (!normalizedLoc) return;
        const nextLastmod = toIsoDateOrNull(lastmod);
        const prevLastmod = lastmodByLoc.get(normalizedLoc) || null;
        if (!prevLastmod) {
          lastmodByLoc.set(normalizedLoc, nextLastmod);
          return;
        }
        if (!nextLastmod) return;
        if (new Date(nextLastmod).getTime() > new Date(prevLastmod).getTime()) {
          lastmodByLoc.set(normalizedLoc, nextLastmod);
        }
      };

      const staticPaths = [
        "/",
        "/truck-landing",
        "/for-hosts",
        "/for-restaurants",
        "/for-bars",
        "/for-events",
        "/find-food",
        "/restaurant-signup",
        "/host-signup",
        "/event-signup",
        "/search",
        "/map",
        "/parking-pass",
        "/deals",
        "/deals/featured",
        "/video",
        "/suppliers",
        "/events/public",
        "/about",
        "/faq",
        "/how-it-works",
        "/contact",
        "/install",
        "/terms-of-service",
        "/privacy-policy",
        "/sitemap",
        "/status",
      ];
      staticPaths.forEach((path) => mergeUrl(`${baseUrl}${path}`));

      const latestCityBySlug = new Map<string, any>();
      for (const city of cityRows as any[]) {
        const slug = String(city?.slug || "")
          .trim()
          .toLowerCase();
        if (!slug) continue;
        const existing = latestCityBySlug.get(slug);
        if (!existing) {
          latestCityBySlug.set(slug, city);
          continue;
        }
        const existingTs = new Date(
          existing.updatedAt || existing.createdAt || 0,
        ).getTime();
        const nextTs = new Date(
          city.updatedAt || city.createdAt || 0,
        ).getTime();
        if (nextTs >= existingTs) {
          latestCityBySlug.set(slug, city);
        }
      }
      const uniqueCityRows = Array.from(latestCityBySlug.values());

      uniqueCityRows.forEach((city: any) => {
        mergeUrl(
          `${baseUrl}/food-trucks/${encodeURIComponent(city.slug)}`,
          city.updatedAt || city.createdAt,
        );
      });

      restaurantRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/p/restaurant/${encodeURIComponent(row.id)}/${encodeURIComponent(
            toSlug(row.name) || row.id,
          )}`,
          row.updatedAt,
        );
      });

      hostRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/p/host/${encodeURIComponent(row.id)}/${encodeURIComponent(
            toSlug(row.name) || row.id,
          )}`,
          row.updatedAt,
        );
      });

      supplierRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/p/supplier/${encodeURIComponent(row.id)}/${encodeURIComponent(
            toSlug(row.name) || row.id,
          )}`,
          row.updatedAt,
        );
      });

      const citySlugByName = new Map<string, string>();
      uniqueCityRows.forEach((city: any) => {
        const key = String(city?.name || "")
          .trim()
          .toLowerCase();
        const slug = String(city?.slug || "").trim();
        if (!key || !slug || citySlugByName.has(key)) return;
        citySlugByName.set(key, slug);
      });

      const cuisineLastmodByCity = new Map<string, string | null>();
      for (const row of restaurantRows as any[]) {
        const cityName = String(row.city || "")
          .trim()
          .toLowerCase();
        const citySlug = citySlugByName.get(cityName);
        const cuisineSlug = toSlug(row.cuisineType || "");
        if (!citySlug || !cuisineSlug) continue;
        const key = `${citySlug}:${cuisineSlug}`;
        const existing = cuisineLastmodByCity.get(key) || null;
        const next = toIsoDateOrNull(row.updatedAt);
        if (!existing) {
          cuisineLastmodByCity.set(key, next);
          continue;
        }
        if (!next) continue;
        if (new Date(next).getTime() > new Date(existing).getTime()) {
          cuisineLastmodByCity.set(key, next);
        }
      }
      cuisineLastmodByCity.forEach((lastmod, key) => {
        const [citySlug, cuisineSlug] = key.split(":");
        if (!citySlug || !cuisineSlug) return;
        mergeUrl(
          `${baseUrl}/food-trucks/${encodeURIComponent(citySlug)}/${encodeURIComponent(cuisineSlug)}`,
          lastmod || undefined,
        );
      });

      const urls = Array.from(lastmodByLoc.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([loc, lastmod]) => ({ loc, lastmod }));

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map(
          (entry) =>
            `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`,
        )
        .join("\n")}\n</urlset>`;

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      );
      res.send(xml);
    } catch (e) {
      console.error("sitemap failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  // Split sitemaps (Zillow/Yelp-style): entity + discovery pages.
  app.get("/sitemap-trucks.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          updatedAt: restaurants.updatedAt,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter((row: any) => Boolean(row.isFoodTruck) || row.businessType === "food_truck")
        .map((row: any) => ({
          loc: `${baseUrl}/truck/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
          lastmod: row.updatedAt,
        }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-trucks failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-bars.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          updatedAt: restaurants.updatedAt,
          businessType: restaurants.businessType,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter((row: any) => row.businessType === "bar")
        .map((row: any) => ({
          loc: `${baseUrl}/bar/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
          lastmod: row.updatedAt,
        }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-bars failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-locations.xml", async (_req, res) => {
    try {
      const { events } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();

      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7);
      const ttlHours = Number.isFinite(ttlHoursRaw) ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30)) : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

      const eligibleHostIds = await db
        .select({ hostId: events.hostId })
        .from(events)
        .where(
          and(
            isNotNull(events.bookedRestaurantId),
            ne(events.status, "cancelled"),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
            gte(events.lastConfirmedAt, cutoff),
          ),
        )
        .groupBy(events.hostId)
        .limit(50000)
        .then((rows: any[]) => rows.map((r) => String(r.hostId)));

      const rows =
        eligibleHostIds.length === 0
          ? []
          : await db
              .select({
                id: hosts.id,
                name: hosts.businessName,
                updatedAt: hosts.updatedAt,
              })
              .from(hosts)
              .where(inArray(hosts.id, eligibleHostIds))
              .orderBy(desc(hosts.updatedAt))
              .limit(50000);

      const entries = rows.map((row: any) => ({
        loc: `${baseUrl}/location/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
        lastmod: row.updatedAt,
      }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-locations failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-cities.xml", async (_req, res) => {
    try {
      const { cities, events, hosts, truckManualSchedules } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db.select().from(cities).orderBy(desc(cities.createdAt));

      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7);
      const ttlHours = Number.isFinite(ttlHoursRaw) ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30)) : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

      const entries: Array<{ loc: string; lastmod?: unknown }> = [];
      for (const row of rows as any[]) {
        const slug = String(row.slug || "").trim();
        const cityName = String(row.name || "").trim();
        if (!slug || !cityName) continue;
        const cityLike = `%${cityName}%`;

        const hasTruck = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(
            and(
              eq(restaurants.isActive, true),
              or(eq(restaurants.isFoodTruck, true), eq(restaurants.businessType, "food_truck")),
              or(ilike(restaurants.city, cityLike), ilike(restaurants.address, cityLike)),
            ),
          )
          .limit(1);

        const hasEvent = await db
          .select({ id: events.id })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(
            and(
              isNotNull(events.bookedRestaurantId),
              ne(events.status, "cancelled"),
              gte(events.date, windowStart),
              lte(events.date, windowEnd),
              gte(events.lastConfirmedAt, cutoff),
              or(ilike(hosts.city, cityLike), ilike(hosts.address, cityLike)),
            ),
          )
          .limit(1);

        const hasManual = await db
          .select({ id: truckManualSchedules.id })
          .from(truckManualSchedules)
          .where(
            and(
              eq(truckManualSchedules.isPublic, true),
              gte(truckManualSchedules.date, windowStart),
              lte(truckManualSchedules.date, windowEnd),
              gte(truckManualSchedules.lastConfirmedAt, cutoff),
              or(ilike(truckManualSchedules.city, cityLike), ilike(truckManualSchedules.address, cityLike)),
            ),
          )
          .limit(1);

        if (hasTruck.length === 0 && hasEvent.length === 0 && hasManual.length === 0) continue;

        entries.push({
          loc: `${baseUrl}/city/${encodeURIComponent(slug)}`,
          lastmod: row.createdAt,
        });
      }
      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-cities failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-cuisines.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          cuisineType: restaurants.cuisineType,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const lastmodByCuisine = new Map<string, string | null>();
      for (const row of rows as any[]) {
        const slug = toSlug(row.cuisineType || "");
        if (!slug) continue;
        const next = toIsoDateOrNull(row.updatedAt);
        const existing = lastmodByCuisine.get(slug) || null;
        if (!existing) {
          lastmodByCuisine.set(slug, next);
          continue;
        }
        if (!next) continue;
        if (new Date(next).getTime() > new Date(existing).getTime()) {
          lastmodByCuisine.set(slug, next);
        }
      }

      const entries = Array.from(lastmodByCuisine.entries()).map(([slug, lastmod]) => ({
        loc: `${baseUrl}/cuisine/${encodeURIComponent(slug)}`,
        lastmod,
      }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-cuisines failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-time-pages.xml", async (_req, res) => {
    try {
      const { cities, events, hosts, truckManualSchedules } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db.select().from(cities).orderBy(desc(cities.createdAt));
      const modes = [
        "food-trucks-now",
        "food-trucks-breakfast",
        "food-trucks-lunch",
        "food-trucks-dinner",
        "food-trucks-tonight",
        "food-trucks-this-weekend",
      ];
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7);
      const ttlHours = Number.isFinite(ttlHoursRaw) ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30)) : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

      const entries: Array<{ loc: string; lastmod?: unknown }> = [];
      for (const row of rows as any[]) {
        const slug = String(row.slug || "").trim();
        if (!slug) continue;
        const cityName = String(row.name || "").trim();
        if (!cityName) continue;
        const cityLike = `%${cityName}%`;

        const hasEvent = await db
          .select({ id: events.id })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(
            and(
              isNotNull(events.bookedRestaurantId),
              ne(events.status, "cancelled"),
              gte(events.date, windowStart),
              lte(events.date, windowEnd),
              gte(events.lastConfirmedAt, cutoff),
              or(ilike(hosts.city, cityLike), ilike(hosts.address, cityLike)),
            ),
          )
          .limit(1);

        const hasManual = await db
          .select({ id: truckManualSchedules.id })
          .from(truckManualSchedules)
          .where(
            and(
              eq(truckManualSchedules.isPublic, true),
              gte(truckManualSchedules.date, windowStart),
              lte(truckManualSchedules.date, windowEnd),
              gte(truckManualSchedules.lastConfirmedAt, cutoff),
              or(ilike(truckManualSchedules.city, cityLike), ilike(truckManualSchedules.address, cityLike)),
            ),
          )
          .limit(1);

        if (hasEvent.length === 0 && hasManual.length === 0) continue;
        for (const mode of modes) {
          entries.push({
            loc: `${baseUrl}/city/${encodeURIComponent(slug)}/${encodeURIComponent(mode)}`,
            lastmod: row.createdAt,
          });
        }
      }
      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-time-pages failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-events.xml", async (_req, res) => {
    try {
      const { events, hosts } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7);
      const ttlHours = Number.isFinite(ttlHoursRaw) ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30)) : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

      const rows = await db
        .select({
          id: events.id,
          name: events.name,
          hostName: hosts.businessName,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          status: events.status,
          lastConfirmedAt: events.lastConfirmedAt,
          updatedAt: events.updatedAt,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            isNotNull(events.bookedRestaurantId),
            ne(events.status, "cancelled"),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
            gte(events.lastConfirmedAt, cutoff),
          ),
        )
        .orderBy(desc(events.updatedAt))
        .limit(50000);

      const entries = rows.map((row: any) => {
        const title = row.name || row.hostName || row.id;
        const slug = `${toSlug(title) || row.id}--${row.id}`;
        return {
          loc: `${baseUrl}/event/${encodeURIComponent(slug)}`,
          lastmod: row.updatedAt,
        };
      });

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-events failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-deals.xml", async (_req, res) => {
    try {
      const { deals } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();
      const now = new Date();
      const rows = await db
        .select({ id: deals.id, title: deals.title, updatedAt: deals.updatedAt })
        .from(deals)
        .where(
          and(
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
          ),
        )
        .orderBy(desc(deals.updatedAt))
        .limit(50000);

      const entries = rows.map((row: any) => ({
        loc: `${baseUrl}/deal/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
        lastmod: row.updatedAt,
      }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-deals failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-suppliers.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          id: suppliers.id,
          name: suppliers.businessName,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt))
        .limit(50000);

      const entries = rows.map((row: any) => ({
        loc: `${baseUrl}/supplier/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
        lastmod: row.updatedAt,
      }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-suppliers failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-videos.xml", async (_req, res) => {
    try {
      const { videoStories } = await import("@shared/schema");
      const baseUrl = resolveSitemapSiteUrl();
      const now = new Date();
      const rows = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          createdAt: videoStories.createdAt,
          status: videoStories.status,
          isApproved: videoStories.isApproved,
          deletedAt: videoStories.deletedAt,
          expiresAt: videoStories.expiresAt,
          transcriptSource: videoStories.transcriptSource,
        })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.status, "ready"),
            eq(videoStories.isApproved, true),
            isNull(videoStories.deletedAt),
            gte(videoStories.expiresAt, now),
            isNotNull(videoStories.transcriptSource),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(50000);

      const entries = rows.map((row: any) => ({
        loc: `${baseUrl}/video/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
        lastmod: row.createdAt,
      }));

      sendUrlsetXml(res, { baseUrl, entries });
    } catch (e) {
      console.error("sitemap-videos failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/robots.txt", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const robots = [
        "User-agent: *",
        "Allow: /truck/",
        "Allow: /location/",
        "Allow: /city/",
        "Allow: /event/",
        "Allow: /cuisine/",
        "Allow: /deal/",
        "Allow: /bar/",
        "Allow: /supplier/",
        "Allow: /video/",
        "",
        "Disallow: /dashboard",
        "Disallow: /admin",
        "Disallow: /api",
        "Disallow: /vendor-dashboard",
        "Disallow: /supplier-portal",
        "",
        `Sitemap: ${baseUrl}/sitemap.xml`,
        `Sitemap: ${baseUrl}/sitemap-trucks.xml`,
        `Sitemap: ${baseUrl}/sitemap-bars.xml`,
        `Sitemap: ${baseUrl}/sitemap-locations.xml`,
        `Sitemap: ${baseUrl}/sitemap-cities.xml`,
        `Sitemap: ${baseUrl}/sitemap-cuisines.xml`,
        `Sitemap: ${baseUrl}/sitemap-time-pages.xml`,
        `Sitemap: ${baseUrl}/sitemap-events.xml`,
        `Sitemap: ${baseUrl}/sitemap-deals.xml`,
        `Sitemap: ${baseUrl}/sitemap-suppliers.xml`,
        `Sitemap: ${baseUrl}/sitemap-videos.xml`,
        "",
      ].join("\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(robots);
    } catch (e) {
      console.error("robots failed", e);
      res.status(500).send("User-agent: *\nAllow: /\n");
    }
  });

  // Public cities index for dynamic sitemap/discovery pages
  app.get("/api/cities", async (_req, res) => {
    try {
      const { cities, restaurants } = await import("@shared/schema");
      const cityRows = await db
        .select({
          id: cities.id,
          name: cities.name,
          slug: cities.slug,
          state: cities.state,
          createdAt: cities.createdAt,
        })
        .from(cities)
        .orderBy(desc(cities.createdAt));

      const restaurantRows = await db
        .select({
          city: restaurants.city,
          cuisineType: restaurants.cuisineType,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true));

      const cuisineByCity = new Map<string, Map<string, number>>();
      for (const row of restaurantRows as any[]) {
        const cityName = String(row.city || "")
          .trim()
          .toLowerCase();
        const cuisine = toSlug(row.cuisineType || "");
        if (!cityName || !cuisine) continue;
        if (!cuisineByCity.has(cityName))
          cuisineByCity.set(cityName, new Map());
        const cityMap = cuisineByCity.get(cityName)!;
        cityMap.set(cuisine, (cityMap.get(cuisine) || 0) + 1);
      }

      const payload = cityRows.map((city: any) => {
        const cityCuisineMap =
          cuisineByCity.get(String(city.name || "").toLowerCase()) || new Map();
        const cuisines = Array.from(cityCuisineMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([slug, count]) => ({ slug, count }));
        return {
          id: city.id,
          name: city.name,
          slug: city.slug,
          state: city.state,
          updatedAt: city.createdAt,
          cuisines,
        };
      });

      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=600, stale-while-revalidate=1200",
      );
      res.json(payload);
    } catch (error) {
      console.error("Error loading cities index:", error);
      res.status(500).json({ message: "Failed to load cities" });
    }
  });

  // City landing page API: returns real data for a city slug
  app.get("/api/cities/:slug", async (req, res) => {
    try {
      const { slug } = req.params as { slug: string };
      const { cities, restaurants, hosts, events, videoStories } =
        await import("@shared/schema");
      // Find city record
      const [city] = await db
        .select()
        .from(cities)
        .where(eq(cities.slug, slug));
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }
      // Restaurants and trucks in this city
      const cityRestaurants = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.city, city.name));
      const trucks = cityRestaurants.filter((r: any) => r.isFoodTruck);
      const restaurantsOnly = cityRestaurants.filter(
        (r: any) => !r.isFoodTruck,
      );

      // Upcoming events in this city (via hosts.city)
      const hostRows = await db
        .select()
        .from(hosts)
        .where(eq(hosts.city, city.name));
      const hostIds = hostRows.map((h: any) => h.id);
      let upcomingEvents: any[] = [];
      if (hostIds.length) {
        const now = new Date();
        upcomingEvents = await db
          .select()
          .from(events)
          .where(eq(events.status, "open"));
        upcomingEvents = upcomingEvents.filter(
          (e: any) => new Date(e.date) >= now && hostIds.includes(e.hostId),
        );
      }

      // Recent video stories linked to restaurants in this city
      const restaurantIds = cityRestaurants.map((r: any) => r.id);
      let stories: any[] = [];
      if (restaurantIds.length) {
        stories = await db
          .select()
          .from(videoStories)
          .orderBy(desc(videoStories.createdAt));
        stories = stories.filter(
          (s: any) => s.restaurantId && restaurantIds.includes(s.restaurantId),
        );
        stories = stories.slice(0, 8);
      }

      // Cuisine counts
      const cuisineCounts: Record<string, number> = {};
      for (const r of cityRestaurants) {
        if ((r as any).cuisineType) {
          const c = String((r as any).cuisineType).toLowerCase();
          cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
        }
      }

      res.json({
        city: { name: city.name, slug: city.slug, state: city.state },
        stats: {
          restaurants: restaurantsOnly.length,
          trucks: trucks.length,
          events: upcomingEvents.length,
        },
        restaurants: restaurantsOnly,
        trucks,
        events: upcomingEvents,
        cuisines: Object.entries(cuisineCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        stories,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error building city page:", error);
      res.status(500).json({ message: "Failed to load city" });
    }
  });

  // ==================== IMAGE UPLOAD ROUTES ====================

  // Upload restaurant logo
  app.post(
    "/api/upload/restaurant-logo",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }

        const restaurantId = req.body.restaurantId;
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID required" });
        }

        // Verify user owns this restaurant
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant || restaurant.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Not authorized" });
        }

        // Upload to Cloudinary
        const result = await uploadToCloudinary(
          req.file.buffer,
          "restaurant-logos",
          `restaurant-${restaurantId}-logo`,
        );

        // Save to database
        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "restaurant_logo",
            entityId: restaurantId,
            entityType: "restaurant",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        // Update restaurant with new logo URL
        await storage.updateRestaurant(restaurantId, {
          logoUrl: result.secureUrl,
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading restaurant logo:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  // Upload restaurant cover image
  app.post(
    "/api/upload/restaurant-cover",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }

        const restaurantId = req.body.restaurantId;
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID required" });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant || restaurant.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "restaurant-covers",
          `restaurant-${restaurantId}-cover`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "restaurant_cover",
            entityId: restaurantId,
            entityType: "restaurant",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        await storage.updateRestaurant(restaurantId, {
          coverImageUrl: result.secureUrl,
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading restaurant cover:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  // Upload deal image
  app.post(
    "/api/upload/deal-image",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }

        const dealId = req.body.dealId;
        if (!dealId) {
          return res.status(400).json({ message: "Deal ID required" });
        }

        const deal = await storage.getDeal(dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        const restaurant = await storage.getRestaurant(deal.restaurantId);
        if (!restaurant || restaurant.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "deal-images",
          `deal-${dealId}`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "deal",
            entityId: dealId,
            entityType: "deal",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        // Update deal with image URL
        await storage.updateDeal(dealId, { imageUrl: result.secureUrl });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading deal image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  // Upload user profile image
  app.post(
    "/api/upload/user-profile",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "user-profiles",
          `user-${req.user.id}`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "user_profile",
            entityId: req.user.id,
            entityType: "user",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        // Update user profile image
        await storage.upsertUser({
          ...req.user,
          profileImageUrl: result.secureUrl,
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading user profile image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  // Delete uploaded image
  app.delete("/api/upload/:imageId", isAuthenticated, async (req: any, res) => {
    try {
      const imageId = req.params.imageId;
      const images = await db
        .select()
        .from(imageUploads)
        .where(eq(imageUploads.id, imageId))
        .limit(1);
      const image = images[0];

      if (!image) {
        return res.status(404).json({ message: "Image not found" });
      }

      // Check authorization
      if (
        image.uploadedByUserId !== req.user.id &&
        req.user.userType !== "admin" &&
        req.user.userType !== "super_admin"
      ) {
        return res.status(403).json({ message: "Not authorized" });
      }

      // Delete from Cloudinary
      if (image.cloudinaryPublicId) {
        await deleteFromCloudinary(image.cloudinaryPublicId);
      }

      // Delete from database
      await db.delete(imageUploads).where({ id: imageId });

      res.json({ message: "Image deleted successfully" });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ message: "Failed to delete image" });
    }
  });

  // ==================== GOLDEN FORK AWARD ROUTES ====================

  // Check Golden Fork eligibility
  app.get(
    "/api/awards/golden-fork/eligibility",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const eligibility = await checkGoldenForkEligibility(req.user.id);
        res.json(eligibility);
      } catch (error) {
        console.error("Error checking Golden Fork eligibility:", error);
        res.status(500).json({ message: "Failed to check eligibility" });
      }
    },
  );

  // Claim Golden Fork award
  app.post(
    "/api/awards/golden-fork/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const awarded = await awardGoldenFork(req.user.id);
        if (awarded) {
          res.json({ message: "Golden Fork awarded!", awarded: true });
        } else {
          res
            .status(400)
            .json({ message: "Not eligible for Golden Fork", awarded: false });
        }
      } catch (error) {
        console.error("Error claiming Golden Fork:", error);
        res.status(500).json({ message: "Failed to claim award" });
      }
    },
  );

  // Get all Golden Fork holders
  app.get("/api/awards/golden-fork/holders", async (req, res) => {
    try {
      const holders = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          influenceScore: users.influenceScore,
          reviewCount: users.reviewCount,
          goldenForkEarnedAt: users.goldenForkEarnedAt,
        })
        .from(users)
        .where(eq(users.hasGoldenFork, true));
      const holdersWithRecommendations = await Promise.all(
        holders.map(async (holder: (typeof holders)[number]) => {
          const recommendationCount = await getUserRecommendationCount(
            holder.id,
          );
          return { ...holder, recommendationCount };
        }),
      );

      res.json(holdersWithRecommendations);
    } catch (error) {
      console.error("Error fetching Golden Fork holders:", error);
      res.status(500).json({ message: "Failed to fetch holders" });
    }
  });

  // Get user influence stats
  app.get("/api/user/:userId/influence-stats", async (req, res) => {
    try {
      const userId = req.params.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const influenceScore = await calculateUserInfluenceScore(userId);
      const recommendationCount = await getUserRecommendationCount(userId);

      res.json({
        userId: user.id,
        hasGoldenFork: user.hasGoldenFork,
        goldenForkEarnedAt: user.goldenForkEarnedAt,
        reviewCount: user.reviewCount || 0,
        recommendationCount,
        influenceScore,
      });
    } catch (error) {
      console.error("Error fetching influence stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // ==================== GOLDEN PLATE AWARD ROUTES ====================

  // Get all Golden Plate winners
  app.get("/api/awards/golden-plate/winners", async (req, res) => {
    try {
      const winners = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.hasGoldenPlate, true));
      res.json(winners);
    } catch (error) {
      console.error("Error fetching Golden Plate winners:", error);
      res.status(500).json({ message: "Failed to fetch winners" });
    }
  });

  // Get Golden Plate winners by area
  app.get("/api/awards/golden-plate/winners/:area", async (req, res) => {
    try {
      const area = req.params.area;
      const winners = await db
        .select()
        .from(restaurants)
        .where(
          and(
            eq(restaurants.hasGoldenPlate, true),
            like(restaurants.address, `%${area}%`),
          ),
        );
      res.json(winners);
    } catch (error) {
      console.error("Error fetching area Golden Plate winners:", error);
      res.status(500).json({ message: "Failed to fetch winners" });
    }
  });

  // Get leaderboard for an area
  app.get("/api/awards/golden-plate/leaderboard/:area", async (req, res) => {
    try {
      const area = req.params.area;
      const limit = parseInt(req.query.limit as string) || 50;
      const leaderboard = await getAreaLeaderboard(area, limit);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  // Get restaurant ranking stats
  app.get("/api/restaurants/:restaurantId/ranking-stats", async (req, res) => {
    try {
      const restaurantId = req.params.restaurantId;
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const rankingScore = await calculateRestaurantRankingScore(restaurantId);

      res.json({
        restaurantId: restaurant.id,
        hasGoldenPlate: restaurant.hasGoldenPlate,
        goldenPlateCount: restaurant.goldenPlateCount || 0,
        goldenPlateEarnedAt: restaurant.goldenPlateEarnedAt,
        rankingScore,
      });
    } catch (error) {
      console.error("Error fetching ranking stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Admin: Award Golden Plates for a specific area (manual trigger)
  app.post(
    "/api/admin/awards/golden-plate/:area",
    isAdmin,
    async (req: any, res) => {
      try {
        const area = req.params.area;
        const awardedCount = await awardGoldenPlatesForArea(area);
        res.json({
          message: `Awarded Golden Plates to ${awardedCount} restaurants in ${area}`,
          awardedCount,
        });
      } catch (error) {
        console.error("Error awarding Golden Plates:", error);
        res.status(500).json({ message: "Failed to award Golden Plates" });
      }
    },
  );

  // Get award history
  app.get("/api/awards/history", async (req, res) => {
    try {
      const awardType = req.query.awardType as string;
      const recipientId = req.query.recipientId as string;

      const query = await db
        .select()
        .from(awardHistory)
        .orderBy(desc(awardHistory.awardedAt))
        .limit(100);

      res.json(query);
    } catch (error) {
      console.error("Error fetching award history:", error);
      res.status(500).json({ message: "Failed to fetch award history" });
    }
  });

  // Register video stories routes (MVP Phase 1)
  const setupStoriesRoutes = (await import("./storiesRoutes")).default;
  setupStoriesRoutes(app);

  app.get(
    "/api/admin/host-payout-requests",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const pageRaw = Number((req as any)?.query?.page ?? 1);
        const pageSizeRaw = Number((req as any)?.query?.pageSize ?? 20);
        const page = Number.isFinite(pageRaw)
          ? Math.max(1, Math.floor(pageRaw))
          : 1;
        const pageSize = Number.isFinite(pageSizeRaw)
          ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw)))
          : 20;
        const statusFilterRaw = String((req as any)?.query?.status || "all")
          .trim()
          .toLowerCase();
        const statusFilter = [
          "all",
          "pending",
          "approved",
          "paid",
          "rejected",
          "cancelled",
        ].includes(statusFilterRaw)
          ? statusFilterRaw
          : "all";
        const searchTerm = String((req as any)?.query?.q || "").trim();
        const fromDateRaw = String((req as any)?.query?.from || "").trim();
        const toDateRaw = String((req as any)?.query?.to || "").trim();
        const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromDateRaw)
          ? new Date(`${fromDateRaw}T00:00:00.000Z`)
          : null;
        const toDateExclusive = /^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)
          ? new Date(
              new Date(`${toDateRaw}T00:00:00.000Z`).getTime() + 86400000,
            )
          : null;

        const filters: any[] = [];
        if (statusFilter !== "all") {
          filters.push(eq(hostPayoutRequests.status, statusFilter));
        }
        if (searchTerm.length > 0) {
          const likePattern = `%${searchTerm}%`;
          filters.push(
            or(
              like(hosts.businessName, likePattern),
              like(users.email, likePattern),
              like(hosts.address, likePattern),
            ),
          );
        }
        if (fromDate) {
          filters.push(gte(hostPayoutRequests.createdAt, fromDate));
        }
        if (toDateExclusive) {
          filters.push(lt(hostPayoutRequests.createdAt, toDateExclusive));
        }
        const whereClause =
          filters.length > 0 ? and(...(filters as [any, ...any[]])) : undefined;

        const [totalsRow] = await db
          .select({
            pending: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'pending' then 1 else 0 end), 0)`,
            approved: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'approved' then 1 else 0 end), 0)`,
            paid: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'paid' then 1 else 0 end), 0)`,
            rejected: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'rejected' then 1 else 0 end), 0)`,
          })
          .from(hostPayoutRequests);

        const countQuery = db
          .select({ count: sql<number>`count(*)` })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id));

        if (whereClause) {
          countQuery.where(whereClause as any);
        }

        const [countRow] = await countQuery;
        const filteredTotal = Number(countRow?.count || 0);

        const rowsQuery = db
          .select({
            id: hostPayoutRequests.id,
            hostId: hostPayoutRequests.hostId,
            userId: hostPayoutRequests.userId,
            amountCents: hostPayoutRequests.amountCents,
            status: hostPayoutRequests.status,
            notes: hostPayoutRequests.notes,
            reviewedByUserId: hostPayoutRequests.reviewedByUserId,
            reviewedByEmail: sql<string>`(select u.email from users u where u.id = ${hostPayoutRequests.reviewedByUserId} limit 1)`,
            reviewedAt: hostPayoutRequests.reviewedAt,
            paidAt: hostPayoutRequests.paidAt,
            createdAt: hostPayoutRequests.createdAt,
            updatedAt: hostPayoutRequests.updatedAt,
            hostBusinessName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
            requesterEmail: users.email,
          })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id))
          .orderBy(desc(hostPayoutRequests.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        if (whereClause) {
          rowsQuery.where(whereClause as any);
        }

        const rows = await rowsQuery;

        const totals = {
          pending: Number(totalsRow?.pending || 0),
          approved: Number(totalsRow?.approved || 0),
          paid: Number(totalsRow?.paid || 0),
          rejected: Number(totalsRow?.rejected || 0),
        };

        res.json({
          ok: true,
          totals,
          rows,
          pagination: {
            page,
            pageSize,
            total: filteredTotal,
            totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)),
            hasNext: page * pageSize < filteredTotal,
            hasPrev: page > 1,
          },
          filters: {
            status: statusFilter,
            q: searchTerm,
            from: fromDateRaw,
            to: toDateRaw,
          },
        });
      } catch (error: any) {
        console.error("Failed to load host payout requests:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to load host payout requests",
        });
      }
    },
  );

  app.patch(
    "/api/admin/host-payout-requests/:requestId",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const requestId = String(req.params.requestId || "").trim();
        const nextStatus = String(req.body?.status || "")
          .trim()
          .toLowerCase();
        const notes =
          typeof req.body?.notes === "string" && req.body.notes.trim()
            ? req.body.notes.trim()
            : null;

        if (!requestId) {
          return res.status(400).json({ message: "Request ID is required" });
        }

        if (
          !["approved", "rejected", "paid", "cancelled"].includes(nextStatus)
        ) {
          return res.status(400).json({
            message:
              "Status must be one of: approved, rejected, paid, cancelled",
          });
        }

        const [existing] = await db
          .select()
          .from(hostPayoutRequests)
          .where(eq(hostPayoutRequests.id, requestId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }

        if (existing.status === "paid") {
          return res.status(400).json({
            message: "Paid requests cannot be modified",
          });
        }

        if (nextStatus === "approved" && existing.status !== "pending") {
          return res.status(400).json({
            message: "Only pending requests can be approved",
          });
        }

        if (nextStatus === "paid" && existing.status !== "approved") {
          return res.status(400).json({
            message: "Only approved requests can be marked paid",
          });
        }

        if (
          nextStatus === "rejected" &&
          !["pending", "approved"].includes(String(existing.status || ""))
        ) {
          return res.status(400).json({
            message: "Only pending or approved requests can be rejected",
          });
        }

        if (
          nextStatus === "cancelled" &&
          !["pending", "approved"].includes(String(existing.status || ""))
        ) {
          return res.status(400).json({
            message: "Only pending or approved requests can be cancelled",
          });
        }

        const now = new Date();
        const [updated] = await db
          .update(hostPayoutRequests)
          .set({
            status: nextStatus,
            notes: notes ?? existing.notes ?? null,
            reviewedByUserId: req.user?.id || null,
            reviewedAt: now,
            paidAt: nextStatus === "paid" ? now : existing.paidAt,
            updatedAt: now,
          })
          .where(eq(hostPayoutRequests.id, requestId))
          .returning();

        if (nextStatus === "paid") {
          await db.insert(hostEarningsLedger).values({
            hostId: existing.hostId,
            bookingId: null,
            stripePaymentIntentId: null,
            entryType: "payout",
            sourceType: "host_payout_request",
            amountCents: -Math.abs(Number(existing.amountCents || 0)),
            description: `Host payout processed (${existing.id})`,
            createdAt: now,
          });
        }

        const { getHostEarningsSummary } =
          await import("./hostEarningsService");
        const summary = await getHostEarningsSummary(existing.hostId);

        res.json({ ok: true, request: updated, summary });
      } catch (error: any) {
        console.error("Failed to update host payout request:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to update host payout request",
        });
      }
    },
  );

  app.get(
    "/api/admin/host-payout-requests/export.csv",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const statusFilterRaw = String((req as any)?.query?.status || "all")
          .trim()
          .toLowerCase();
        const statusFilter = [
          "all",
          "pending",
          "approved",
          "paid",
          "rejected",
          "cancelled",
        ].includes(statusFilterRaw)
          ? statusFilterRaw
          : "all";
        const searchTerm = String((req as any)?.query?.q || "").trim();
        const fromDateRaw = String((req as any)?.query?.from || "").trim();
        const toDateRaw = String((req as any)?.query?.to || "").trim();
        const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromDateRaw)
          ? new Date(`${fromDateRaw}T00:00:00.000Z`)
          : null;
        const toDateExclusive = /^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)
          ? new Date(
              new Date(`${toDateRaw}T00:00:00.000Z`).getTime() + 86400000,
            )
          : null;

        const filters: any[] = [];
        if (statusFilter !== "all") {
          filters.push(eq(hostPayoutRequests.status, statusFilter));
        }
        if (searchTerm.length > 0) {
          const likePattern = `%${searchTerm}%`;
          filters.push(
            or(
              like(hosts.businessName, likePattern),
              like(users.email, likePattern),
              like(hosts.address, likePattern),
            ),
          );
        }
        if (fromDate) {
          filters.push(gte(hostPayoutRequests.createdAt, fromDate));
        }
        if (toDateExclusive) {
          filters.push(lt(hostPayoutRequests.createdAt, toDateExclusive));
        }
        const whereClause =
          filters.length > 0 ? and(...(filters as [any, ...any[]])) : undefined;

        const rowsQuery = db
          .select({
            id: hostPayoutRequests.id,
            hostId: hostPayoutRequests.hostId,
            amountCents: hostPayoutRequests.amountCents,
            status: hostPayoutRequests.status,
            notes: hostPayoutRequests.notes,
            reviewedByUserId: hostPayoutRequests.reviewedByUserId,
            reviewedByEmail: sql<string>`(select u.email from users u where u.id = ${hostPayoutRequests.reviewedByUserId} limit 1)`,
            reviewedAt: hostPayoutRequests.reviewedAt,
            paidAt: hostPayoutRequests.paidAt,
            createdAt: hostPayoutRequests.createdAt,
            updatedAt: hostPayoutRequests.updatedAt,
            hostBusinessName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
            requesterEmail: users.email,
          })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id))
          .orderBy(desc(hostPayoutRequests.createdAt));

        if (whereClause) {
          rowsQuery.where(whereClause as any);
        }

        const rows = await rowsQuery;

        const sanitizeCSV = (value: any): string => {
          if (value === null || value === undefined) return "";
          const str = String(value);
          if (/^[=+@-]/.test(str)) {
            return `"'${str.replace(/"/g, '""')}"`;
          }
          return `"${str.replace(/"/g, '""')}"`;
        };

        const header =
          "Request ID,Host ID,Host Name,Requester Email,Amount USD,Status,Requested At,Reviewed At,Reviewed By,Paid At,Address,Notes\n";

        const csvRows = rows
          .map((row: (typeof rows)[number]) => {
            const amountUsd = (Number(row.amountCents || 0) / 100).toFixed(2);
            const address = [row.hostAddress, row.hostCity, row.hostState]
              .filter(Boolean)
              .join(", ");

            return [
              sanitizeCSV(row.id),
              sanitizeCSV(row.hostId),
              sanitizeCSV(row.hostBusinessName || ""),
              sanitizeCSV(row.requesterEmail || ""),
              sanitizeCSV(amountUsd),
              sanitizeCSV(row.status || ""),
              sanitizeCSV(
                row.createdAt ? new Date(row.createdAt).toISOString() : "",
              ),
              sanitizeCSV(
                row.reviewedAt ? new Date(row.reviewedAt).toISOString() : "",
              ),
              sanitizeCSV(row.reviewedByEmail || row.reviewedByUserId || ""),
              sanitizeCSV(row.paidAt ? new Date(row.paidAt).toISOString() : ""),
              sanitizeCSV(address),
              sanitizeCSV(row.notes || ""),
            ].join(",");
          })
          .join("\n");

        const csv = header + csvRows;
        const dateStamp = new Date().toISOString().slice(0, 10);

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="host-payout-requests-${encodeURIComponent(statusFilter)}-${dateStamp}.csv"`,
        );
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(csv);
      } catch (error: any) {
        console.error("Failed to export host payout requests:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to export host payout requests",
        });
      }
    },
  );

  // Register incident management routes (admin-only)
  const incidentRoutes = (await import("./incidentRoutes")).default;
  app.use("/api/incidents", incidentRoutes);

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

  // Register cron/scheduler endpoints
  app.post(
    "/api/cron/escalations",
    incidentRoutes.stack.find(
      (layer: any) => layer.route?.path === "/cron/escalations",
    )?.handle || ((_req, res) => res.status(404).json({ error: "Not found" })),
  );

  // Clean affiliate links: /ref/<tag>
  app.get("/ref/:tag", (req, res) => {
    const tag = req.params?.tag || "";
    const safeTag = encodeURIComponent(tag);
    res.redirect(`/?ref=${safeTag}`);
  });

  app.post(
    "/api/cron/auto-close",
    incidentRoutes.stack.find(
      (layer: any) => layer.route?.path === "/cron/auto-close",
    )?.handle || ((_req, res) => res.status(404).json({ error: "Not found" })),
  );

  const httpServer = createServer(app);
  return httpServer;
}

