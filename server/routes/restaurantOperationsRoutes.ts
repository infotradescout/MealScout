import type { Express } from "express";
import { createHash, randomBytes } from "crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { checkRateLimit } from "../documentValidation";
import { isAuthenticated } from "../unifiedAuth";
import { reverseGeocode } from "../utils/geocoding";
import { broadcastLocationUpdate, broadcastStatusUpdate } from "../websocket";
import { getSuppressedLocationResourceIds } from "../services/truckLocationTrust";
import {
  getActiveSocialConnection,
  listSocialConnectionStatus,
} from "../services/socialPublishing";
import {
  insertFoodTruckLocationSchema,
  moderationEvents,
  restaurants,
  socialPostQueue,
  socialPublishingConnections,
  telemetryEvents,
  truckManualSchedules,
  truckParkingReports,
  updateRestaurantLocationSchema,
  updateRestaurantMobileSettingsSchema,
  updateRestaurantOperatingHoursSchema,
} from "@shared/schema";
import { getBusinessAccessContext } from "../services/businessTeamAccess";

type AnalyticsAccessResult = {
  hasAccess: boolean;
  error?: string;
  subscriptionTier?: string;
};

type RestaurantOperationsRouteDependencies = {
  validateAnalyticsAccess: (userId: string) => Promise<AnalyticsAccessResult>;
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
};

type SocialPublishPlatform = "facebook" | "instagram" | "x";
type SocialOAuthSession = {
  provider: "meta" | "x";
  restaurantId: string;
  platform: SocialPublishPlatform;
  redirectPath: string;
  state: string;
  codeVerifier?: string;
  createdAt: string;
};

const META_API_VERSION = "v24.0";

function getPublicBaseUrl(req: any) {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
}

function getSocialPublishingConfig(req: any) {
  const baseUrl = getPublicBaseUrl(req);
  const metaConfigured = Boolean(
    process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET,
  );
  const xConfigured = Boolean(
    process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID,
  );

  return {
    baseUrl,
    platforms: {
      facebook: {
        provider: "meta",
        configured: metaConfigured,
        callbackUrl: `${baseUrl}/api/social-connections/meta/callback`,
      },
      instagram: {
        provider: "meta",
        configured: metaConfigured,
        callbackUrl: `${baseUrl}/api/social-connections/meta/callback`,
      },
      x: {
        provider: "x",
        configured: xConfigured,
        callbackUrl: `${baseUrl}/api/social-connections/x/callback`,
      },
    },
    missing: [
      !process.env.PUBLIC_BASE_URL && !process.env.APP_BASE_URL
        ? "PUBLIC_BASE_URL"
        : null,
      !process.env.FACEBOOK_APP_ID ? "FACEBOOK_APP_ID" : null,
      !process.env.FACEBOOK_APP_SECRET ? "FACEBOOK_APP_SECRET" : null,
      !xConfigured ? "X_CLIENT_ID" : null,
    ].filter(Boolean),
  };
}

function getSafeRedirectPath(value: unknown, fallback = "/parking-pass?tab=schedule") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }
  return trimmed;
}

function appendSocialStatus(
  redirectPath: string,
  status: "connected" | "error",
  message?: string,
) {
  const url = new URL(redirectPath, "https://mealscout.local");
  url.searchParams.set("social", status);
  if (message) {
    url.searchParams.set("socialMessage", message.slice(0, 240));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function saveSession(req: any) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error: unknown) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createOAuthState() {
  return base64Url(randomBytes(32));
}

function createPkceChallenge(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function getSocialOAuthSession(req: any): SocialOAuthSession | null {
  return (req.session?.socialPublishOAuth || null) as SocialOAuthSession | null;
}

async function setSocialOAuthSession(req: any, value: SocialOAuthSession | null) {
  req.session.socialPublishOAuth = value;
  await saveSession(req);
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error_description ||
      body?.message ||
      response.statusText ||
      "Provider request failed";
    throw new Error(message);
  }
  return body;
}

export function registerRestaurantOperationsRoutes(
  app: Express,
  {
    validateAnalyticsAccess,
    hasBusinessDistributionAccess,
  }: RestaurantOperationsRouteDependencies,
) {
  const isAdminLikeUserType = (userType?: string | null) =>
    userType === "admin" ||
    userType === "duper_admin" ||
    userType === "super_admin" ||
    userType === "staff";

  const buildPremiumWeeklySummary = async (userId: string) => {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - 6);

    const ownedRestaurants = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.ownerId, userId));

    const restaurantIds = ownedRestaurants.map(
      (restaurant: { id: string }) => restaurant.id,
    );

    if (restaurantIds.length === 0) {
      return {
        hasAccess: true,
        weekStart: windowStart.toISOString(),
        weekEnd: now.toISOString(),
        restaurantCount: 0,
        stopsCovered: 0,
        liveLocationActivations: 0,
        manualScheduleUsage: 0,
        parkingReportsCompleted: 0,
      };
    }

    const [manualSchedules, parkingReports, liveLocationEvents] =
      await Promise.all([
        db
          .select({
            id: truckManualSchedules.id,
            date: truckManualSchedules.date,
            address: truckManualSchedules.address,
          })
          .from(truckManualSchedules)
          .where(
            and(
              inArray(truckManualSchedules.truckId, restaurantIds),
              gte(truckManualSchedules.createdAt, windowStart),
            ),
          ),
        db
          .select({
            id: truckParkingReports.id,
            date: truckParkingReports.date,
            address: truckParkingReports.address,
            locationName: truckParkingReports.locationName,
          })
          .from(truckParkingReports)
          .where(
            and(
              inArray(truckParkingReports.truckId, restaurantIds),
              gte(truckParkingReports.createdAt, windowStart),
            ),
          ),
        db
          .select({ id: telemetryEvents.id })
          .from(telemetryEvents)
          .where(
            and(
              eq(telemetryEvents.eventName, "premium_live_location_used"),
              eq(telemetryEvents.userId, userId),
              gte(telemetryEvents.createdAt, windowStart),
            ),
          ),
      ]);

    const stopKeys = new Set<string>();
    for (const schedule of manualSchedules) {
      const dateKey = schedule.date
        ? schedule.date.toISOString().split("T")[0]
        : "unknown-date";
      const addressKey = String(schedule.address || "unknown-address").trim();
      stopKeys.add(`${dateKey}:${addressKey}`);
    }

    for (const report of parkingReports) {
      const dateKey = report.date
        ? report.date.toISOString().split("T")[0]
        : "unknown-date";
      const place = String(
        report.address || report.locationName || report.id || "unknown-place",
      ).trim();
      stopKeys.add(`${dateKey}:${place}`);
    }

    return {
      hasAccess: true,
      weekStart: windowStart.toISOString(),
      weekEnd: now.toISOString(),
      restaurantCount: restaurantIds.length,
      stopsCovered: stopKeys.size,
      liveLocationActivations: liveLocationEvents.length,
      manualScheduleUsage: manualSchedules.length,
      parkingReportsCompleted: parkingReports.length,
    };
  };

  app.get(
    "/api/restaurants/my-restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        if (isAdminLikeUserType(req.user?.userType)) {
          const allRestaurants = await storage.getAllRestaurants();
          return res.json(allRestaurants);
        }

        const restaurantsByOwner = await storage.getRestaurantsByOwner(req.user.id);
        const context = await getBusinessAccessContext(req.user.id);

        const ownedIds = new Set(restaurantsByOwner.map((r: any) => r.id));
        const collaboratorRestaurantIds = context.restaurants
          .filter((r) => !r.isOwner)
          .map((r) => r.id);

        if (!collaboratorRestaurantIds.length) {
          return res.json(restaurantsByOwner);
        }

        const collaboratorRestaurants = await db
          .select()
          .from(restaurants)
          .where(inArray(restaurants.id, collaboratorRestaurantIds));

        const merged = [...restaurantsByOwner];
        for (const restaurant of collaboratorRestaurants) {
          if (!ownedIds.has(restaurant.id)) {
            merged.push(restaurant);
          }
        }

        res.json(merged);
      } catch (error) {
        console.error("Error fetching user restaurants:", error);
        res.status(500).json({ message: "Failed to fetch restaurants" });
      }
    },
  );

  app.patch(
    "/api/restaurants/:restaurantId/profile-basics",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const canBypassOwnership = isAdminLikeUserType(req.user?.userType);
        if (!canBypassOwnership) {
          const isAuthorized = await storage.verifyRestaurantOwnership(
            restaurantId,
            req.user.id,
            "manageProfile",
          );
          if (!isAuthorized) {
            return res.status(403).json({
              message:
                "Unauthorized: You can only update profile details for restaurants you own",
            });
          }
        }

        const profileSchema = z.object({
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(4000).optional().nullable(),
          cuisineType: z.string().trim().max(160).optional().nullable(),
          businessType: z.string().trim().max(80).optional().nullable(),
          address: z.string().trim().max(240).optional().nullable(),
          city: z.string().trim().max(120).optional().nullable(),
          state: z.string().trim().max(120).optional().nullable(),
          phone: z.string().trim().max(40).optional().nullable(),
          websiteUrl: z.string().trim().max(500).optional().nullable(),
          facebookPageUrl: z.string().trim().max(500).optional().nullable(),
          instagramUrl: z.string().trim().max(500).optional().nullable(),
          xUrl: z.string().trim().max(500).optional().nullable(),
          menuUrl: z.string().trim().max(500).optional().nullable(),
          logoUrl: z.string().trim().max(500).optional().nullable(),
          coverImageUrl: z.string().trim().max(500).optional().nullable(),
          onlineOrderingUrl: z.string().trim().max(500).optional().nullable(),
          deliveryUrl: z.string().trim().max(500).optional().nullable(),
          doordashUrl: z.string().trim().max(500).optional().nullable(),
          uberEatsUrl: z.string().trim().max(500).optional().nullable(),
          toastUrl: z.string().trim().max(500).optional().nullable(),
          squareUrl: z.string().trim().max(500).optional().nullable(),
          chowNowUrl: z.string().trim().max(500).optional().nullable(),
          grubhubUrl: z.string().trim().max(500).optional().nullable(),
          cateringInquiryUrl: z.string().trim().max(500).optional().nullable(),
          truckBookingInquiryUrl: z.string().trim().max(500).optional().nullable(),
        });

        const parsed = profileSchema.parse(req.body || {});
        const normalize = (value: unknown) => {
          const text = String(value ?? "").trim();
          return text.length > 0 ? text : null;
        };

        const actionLinkKeys = new Set([
          "onlineOrderingUrl",
          "deliveryUrl",
          "doordashUrl",
          "uberEatsUrl",
          "toastUrl",
          "squareUrl",
          "chowNowUrl",
          "grubhubUrl",
          "cateringInquiryUrl",
          "truckBookingInquiryUrl",
        ]);

        const baseUpdates = Object.fromEntries(
          Object.entries(parsed)
            .filter(([key, value]) => value !== undefined && !actionLinkKeys.has(key))
            .map(([key, value]) => [key, normalize(value)]),
        );

        const actionLinkUpdates = Object.fromEntries(
          Object.entries(parsed)
            .filter(([key, value]) => value !== undefined && actionLinkKeys.has(key))
            .map(([key, value]) => [key, normalize(value)]),
        );

        const updates: Record<string, unknown> = { ...baseUpdates };
        if (Object.keys(actionLinkUpdates).length > 0) {
          const restaurant = await storage.getRestaurant(restaurantId);
          const existingSettings =
            restaurant && typeof (restaurant as any).socialAutopostSettings === "object"
              ? { ...((restaurant as any).socialAutopostSettings || {}) }
              : {};
          const existingPublicActionLinks =
            existingSettings &&
            typeof (existingSettings as any).publicActionLinks === "object"
              ? { ...((existingSettings as any).publicActionLinks || {}) }
              : {};
          updates.socialAutopostSettings = {
            ...existingSettings,
            publicActionLinks: {
              ...existingPublicActionLinks,
              ...actionLinkUpdates,
            },
          };
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No profile fields provided" });
        }

        const updatedRestaurant = await storage.updateRestaurant(
          restaurantId,
          updates as any,
        );

        res.json({ success: true, restaurant: updatedRestaurant });
      } catch (error) {
        console.error("Error updating restaurant profile basics:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update business profile",
        });
      }
    },
  );

  app.get(
    "/api/business/premium-weekly-summary",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required for weekly summary.",
            hasAccess: false,
          });
        }

        const summary = await buildPremiumWeeklySummary(req.user.id);

        await db.insert(telemetryEvents).values({
          eventName: "premium_summary_viewed",
          userId: req.user.id,
          properties: {
            weekStart: summary.weekStart,
            weekEnd: summary.weekEnd,
            restaurantCount: summary.restaurantCount,
          },
        });

        res.json(summary);
      } catch (error) {
        console.error("Error fetching premium weekly summary:", error);
        res.status(500).json({ message: "Failed to fetch weekly summary" });
      }
    },
  );

  app.post(
    "/api/business/premium-weekly-summary/email",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required to email weekly summary.",
          });
        }

        const user = await storage.getUser(req.user.id);
        const recipientEmail = String(user?.email || "").trim();
        if (!recipientEmail) {
          return res
            .status(400)
            .json({ message: "No account email found for this user." });
        }

        const summary = await buildPremiumWeeklySummary(req.user.id);
        const recipientName =
          String(user?.firstName || "").trim() || "MealScout operator";

        const sent = await emailService.sendPremiumWeeklySummaryEmail(
          recipientEmail,
          recipientName,
          {
            weekStart: summary.weekStart,
            weekEnd: summary.weekEnd,
            stopsCovered: summary.stopsCovered,
            liveLocationActivations: summary.liveLocationActivations,
            manualScheduleUsage: summary.manualScheduleUsage,
            parkingReportsCompleted: summary.parkingReportsCompleted,
          },
        );

        if (!sent) {
          return res.status(500).json({
            message: "Failed to send weekly summary email.",
          });
        }

        await db.insert(telemetryEvents).values({
          eventName: "premium_summary_emailed",
          userId: req.user.id,
          properties: {
            recipientEmail,
            weekStart: summary.weekStart,
            weekEnd: summary.weekEnd,
          },
        });

        res.json({ ok: true });
      } catch (error) {
        console.error("Error emailing premium weekly summary:", error);
        res.status(500).json({ message: "Failed to send weekly summary" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/stats",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const deals = await storage.getDealsByRestaurant(
          req.params.restaurantId,
        );
        const stats = {
          totalDeals: deals.length,
          activeDeals: deals.filter((deal) => deal.isActive).length,
          totalViews: deals.reduce(
            (sum, deal) => sum + ((deal as any).viewCount || 0),
            0,
          ),
          totalClaims: deals.reduce(
            (sum, deal) => sum + (deal.currentUses || 0),
            0,
          ),
          conversionRate: 0,
          averageRating:
            (await storage.getRestaurantAverageRating(
              req.params.restaurantId,
            )) || 0,
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

  app.patch(
    "/api/restaurants/:restaurantId/mobile-settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.patch(
    "/api/restaurants/:restaurantId/location",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.patch(
    "/api/restaurants/:restaurantId/operating-hours",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.patch(
    "/api/restaurants/:restaurantId/social-settings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Premium subscription required to use social auto-posting.",
          });
        }

        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.get(
    "/api/restaurants/:restaurantId/social-connections/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only view social connections for restaurants you own",
          });
        }

        const connections = await listSocialConnectionStatus(restaurantId);
        res.json({
          restaurantId,
          connections,
          publishingConfig: getSocialPublishingConfig(req),
        });
      } catch (error) {
        console.error("Error loading social connections:", error);
        res.status(500).json({ message: "Failed to load social connections" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/social-connections",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only connect social accounts for restaurants you own",
          });
        }

        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required to connect publishing.",
          });
        }

        const schema = z.object({
          platform: z.enum(["facebook", "instagram", "x"]),
          displayName: z.string().trim().max(160).optional().nullable(),
          externalAccountId: z.string().trim().max(200).optional().nullable(),
          externalAccountUrl: z
            .string()
            .url()
            .optional()
            .nullable()
            .or(z.literal("")),
          accessToken: z.string().trim().min(1).max(10000),
          refreshToken: z.string().trim().max(10000).optional().nullable(),
          tokenExpiresAt: z.string().datetime().optional().nullable(),
          scopes: z.array(z.string().trim()).optional().default([]),
          metadata: z.record(z.any()).optional().default({}),
        });
        const parsed = schema.parse(req.body || {});
        const tokenExpiresAt = parsed.tokenExpiresAt
          ? new Date(parsed.tokenExpiresAt)
          : null;

        const [connection] = await db
          .insert(socialPublishingConnections)
          .values({
            restaurantId,
            createdByUserId: req.user.id,
            platform: parsed.platform,
            displayName: parsed.displayName || null,
            externalAccountId: parsed.externalAccountId || null,
            externalAccountUrl: parsed.externalAccountUrl || null,
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken || null,
            tokenExpiresAt,
            scopes: parsed.scopes,
            metadata: parsed.metadata,
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              socialPublishingConnections.restaurantId,
              socialPublishingConnections.platform,
            ],
            set: {
              createdByUserId: req.user.id,
              displayName: parsed.displayName || null,
              externalAccountId: parsed.externalAccountId || null,
              externalAccountUrl: parsed.externalAccountUrl || null,
              accessToken: parsed.accessToken,
              refreshToken: parsed.refreshToken || null,
              tokenExpiresAt,
              scopes: parsed.scopes,
              metadata: parsed.metadata,
              status: "active",
              lastError: null,
              updatedAt: new Date(),
            },
          })
          .returning();

        res.status(201).json({
          ...connection,
          accessToken: undefined,
          refreshToken: undefined,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid social connection",
            errors: error.errors,
          });
        }
        console.error("Error saving social connection:", error);
        res.status(500).json({ message: "Failed to save social connection" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/social-connections/:platform",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId, platform } = req.params;
        if (!["facebook", "instagram", "x"].includes(platform)) {
          return res.status(400).json({ message: "Invalid platform" });
        }

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only disconnect social accounts for restaurants you own",
          });
        }

        await db
          .update(socialPublishingConnections)
          .set({
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            status: "disconnected",
            lastError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialPublishingConnections.restaurantId, restaurantId),
              eq(socialPublishingConnections.platform, platform),
            ),
          );

        res.json({ success: true });
      } catch (error) {
        console.error("Error disconnecting social connection:", error);
        res
          .status(500)
          .json({ message: "Failed to disconnect social connection" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/social-connections/meta/start",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const platform = String(req.query.platform || "facebook").toLowerCase();
        if (platform !== "facebook" && platform !== "instagram") {
          return res.status(400).json({ message: "Invalid Meta platform" });
        }

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only connect social accounts for restaurants you own",
          });
        }

        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required to connect publishing.",
          });
        }

        const clientId = process.env.FACEBOOK_APP_ID;
        const clientSecret = process.env.FACEBOOK_APP_SECRET;
        if (!clientId || !clientSecret) {
          return res.status(503).json({
            message: "Meta publishing is not configured on this environment.",
          });
        }

        const state = createOAuthState();
        const redirectUri = `${getPublicBaseUrl(req)}/api/social-connections/meta/callback`;
        await setSocialOAuthSession(req, {
          provider: "meta",
          restaurantId,
          platform,
          redirectPath: getSafeRedirectPath(req.query.redirect),
          state,
          createdAt: new Date().toISOString(),
        });

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          response_type: "code",
          scope: [
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_posts",
            "instagram_basic",
            "instagram_content_publish",
          ].join(","),
        });

        res.redirect(
          `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`,
        );
      } catch (error) {
        console.error("Error starting Meta social connection:", error);
        res
          .status(500)
          .json({ message: "Failed to start Meta publishing connection" });
      }
    },
  );

  app.get(
    "/api/social-connections/meta/callback",
    isAuthenticated,
    async (req: any, res) => {
      const oauth = getSocialOAuthSession(req);
      const redirectPath = oauth?.redirectPath || "/parking-pass?tab=schedule";
      try {
        const code = String(req.query.code || "");
        const state = String(req.query.state || "");
        if (!oauth || oauth.provider !== "meta" || oauth.state !== state) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "Connection expired"),
          );
        }
        if (!code) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "Meta did not approve"),
          );
        }

        const clientId = process.env.FACEBOOK_APP_ID;
        const clientSecret = process.env.FACEBOOK_APP_SECRET;
        if (!clientId || !clientSecret) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "Meta is not configured"),
          );
        }

        const redirectUri = `${getPublicBaseUrl(req)}/api/social-connections/meta/callback`;
        const tokenParams = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        });
        const token = await fetchJson(
          `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${tokenParams.toString()}`,
        );

        const exchangeParams = new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: token.access_token,
        });
        const longLived = await fetchJson(
          `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${exchangeParams.toString()}`,
        );
        const userAccessToken = longLived.access_token || token.access_token;

        const pageParams = new URLSearchParams({
          fields:
            "id,name,link,access_token,instagram_business_account{id,username}",
          access_token: userAccessToken,
        });
        const pagesPayload = await fetchJson(
          `https://graph.facebook.com/${META_API_VERSION}/me/accounts?${pageParams.toString()}`,
        );
        const pages = Array.isArray(pagesPayload?.data)
          ? pagesPayload.data
          : [];
        const selectedPage =
          oauth.platform === "instagram"
            ? pages.find((page: any) => page?.instagram_business_account?.id)
            : pages[0];

        if (!selectedPage?.id || !selectedPage?.access_token) {
          return res.redirect(
            appendSocialStatus(
              redirectPath,
              "error",
              oauth.platform === "instagram"
                ? "No Instagram Business account found"
                : "No Facebook Page found",
            ),
          );
        }

        const instagramAccount = selectedPage.instagram_business_account || null;
        const externalAccountUrl =
          oauth.platform === "instagram" && instagramAccount?.username
            ? `https://www.instagram.com/${instagramAccount.username}`
            : selectedPage.link || null;
        const displayName =
          oauth.platform === "instagram"
            ? instagramAccount?.username || selectedPage.name || "Instagram"
            : selectedPage.name || "Facebook Page";

        const [connection] = await db
          .insert(socialPublishingConnections)
          .values({
            restaurantId: oauth.restaurantId,
            createdByUserId: req.user.id,
            platform: oauth.platform,
            displayName,
            externalAccountId:
              oauth.platform === "instagram"
                ? instagramAccount?.id
                : selectedPage.id,
            externalAccountUrl,
            accessToken: selectedPage.access_token,
            refreshToken: userAccessToken,
            tokenExpiresAt: longLived.expires_in
              ? new Date(Date.now() + Number(longLived.expires_in) * 1000)
              : null,
            scopes: [
              "pages_show_list",
              "pages_read_engagement",
              "pages_manage_posts",
              "instagram_basic",
              "instagram_content_publish",
            ],
            metadata: {
              provider: "meta",
              pageId: selectedPage.id,
              pageName: selectedPage.name || null,
              instagramBusinessAccountId: instagramAccount?.id || null,
              instagramUsername: instagramAccount?.username || null,
            },
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              socialPublishingConnections.restaurantId,
              socialPublishingConnections.platform,
            ],
            set: {
              createdByUserId: req.user.id,
              displayName,
              externalAccountId:
                oauth.platform === "instagram"
                  ? instagramAccount?.id
                  : selectedPage.id,
              externalAccountUrl,
              accessToken: selectedPage.access_token,
              refreshToken: userAccessToken,
              tokenExpiresAt: longLived.expires_in
                ? new Date(Date.now() + Number(longLived.expires_in) * 1000)
                : null,
              scopes: [
                "pages_show_list",
                "pages_read_engagement",
                "pages_manage_posts",
                "instagram_basic",
                "instagram_content_publish",
              ],
              metadata: {
                provider: "meta",
                pageId: selectedPage.id,
                pageName: selectedPage.name || null,
                instagramBusinessAccountId: instagramAccount?.id || null,
                instagramUsername: instagramAccount?.username || null,
              },
              status: "active",
              lastError: null,
              updatedAt: new Date(),
            },
          })
          .returning();

        if (connection.externalAccountUrl) {
          await db
            .update(restaurants)
            .set({
              facebookPageUrl:
                oauth.platform === "facebook"
                  ? connection.externalAccountUrl
                  : undefined,
              instagramUrl:
                oauth.platform === "instagram"
                  ? connection.externalAccountUrl
                  : undefined,
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, oauth.restaurantId));
        }

        await setSocialOAuthSession(req, null);
        res.redirect(appendSocialStatus(redirectPath, "connected"));
      } catch (error) {
        console.error("Error completing Meta social connection:", error);
        await setSocialOAuthSession(req, null).catch(() => undefined);
        res.redirect(
          appendSocialStatus(
            redirectPath,
            "error",
            error instanceof Error ? error.message : "Meta connection failed",
          ),
        );
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/social-connections/x/start",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only connect social accounts for restaurants you own",
          });
        }

        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required to connect publishing.",
          });
        }

        const clientId = process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
        if (!clientId) {
          return res.status(503).json({
            message: "X publishing is not configured on this environment.",
          });
        }

        const state = createOAuthState();
        const codeVerifier = base64Url(randomBytes(48));
        await setSocialOAuthSession(req, {
          provider: "x",
          restaurantId,
          platform: "x",
          redirectPath: getSafeRedirectPath(req.query.redirect),
          state,
          codeVerifier,
          createdAt: new Date().toISOString(),
        });

        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: `${getPublicBaseUrl(req)}/api/social-connections/x/callback`,
          scope: "tweet.read tweet.write users.read offline.access",
          state,
          code_challenge: createPkceChallenge(codeVerifier),
          code_challenge_method: "S256",
        });

        res.redirect(`https://x.com/i/oauth2/authorize?${params.toString()}`);
      } catch (error) {
        console.error("Error starting X social connection:", error);
        res
          .status(500)
          .json({ message: "Failed to start X publishing connection" });
      }
    },
  );

  app.get(
    "/api/social-connections/x/callback",
    isAuthenticated,
    async (req: any, res) => {
      const oauth = getSocialOAuthSession(req);
      const redirectPath = oauth?.redirectPath || "/parking-pass?tab=schedule";
      try {
        const code = String(req.query.code || "");
        const state = String(req.query.state || "");
        if (
          !oauth ||
          oauth.provider !== "x" ||
          oauth.platform !== "x" ||
          oauth.state !== state ||
          !oauth.codeVerifier
        ) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "Connection expired"),
          );
        }
        if (!code) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "X did not approve"),
          );
        }

        const clientId = process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
        const clientSecret =
          process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET;
        if (!clientId) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "X is not configured"),
          );
        }

        const tokenBody = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${getPublicBaseUrl(req)}/api/social-connections/x/callback`,
          code_verifier: oauth.codeVerifier,
        });
        const tokenHeaders: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
        };
        if (clientSecret) {
          tokenHeaders.Authorization = `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`,
          ).toString("base64")}`;
        } else {
          tokenBody.set("client_id", clientId);
        }
        const token = await fetchJson("https://api.x.com/2/oauth2/token", {
          method: "POST",
          headers: tokenHeaders,
          body: tokenBody.toString(),
        });

        const me = await fetchJson(
          "https://api.x.com/2/users/me?user.fields=username,name",
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
            },
          },
        );
        const account = me?.data || {};
        if (!account?.id) {
          return res.redirect(
            appendSocialStatus(redirectPath, "error", "No X account found"),
          );
        }

        const username = account.username || account.name || "X account";
        const externalAccountUrl = account.username
          ? `https://x.com/${account.username}`
          : null;
        const [connection] = await db
          .insert(socialPublishingConnections)
          .values({
            restaurantId: oauth.restaurantId,
            createdByUserId: req.user.id,
            platform: "x",
            displayName: username,
            externalAccountId: account.id,
            externalAccountUrl,
            accessToken: token.access_token,
            refreshToken: token.refresh_token || null,
            tokenExpiresAt: token.expires_in
              ? new Date(Date.now() + Number(token.expires_in) * 1000)
              : null,
            scopes: String(token.scope || "")
              .split(" ")
              .filter(Boolean),
            metadata: { provider: "x", username: account.username || null },
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              socialPublishingConnections.restaurantId,
              socialPublishingConnections.platform,
            ],
            set: {
              createdByUserId: req.user.id,
              displayName: username,
              externalAccountId: account.id,
              externalAccountUrl,
              accessToken: token.access_token,
              refreshToken: token.refresh_token || null,
              tokenExpiresAt: token.expires_in
                ? new Date(Date.now() + Number(token.expires_in) * 1000)
                : null,
              scopes: String(token.scope || "")
                .split(" ")
                .filter(Boolean),
              metadata: { provider: "x", username: account.username || null },
              status: "active",
              lastError: null,
              updatedAt: new Date(),
            },
          })
          .returning();

        if (connection.externalAccountUrl) {
          await db
            .update(restaurants)
            .set({ xUrl: connection.externalAccountUrl, updatedAt: new Date() })
            .where(eq(restaurants.id, oauth.restaurantId));
        }

        await setSocialOAuthSession(req, null);
        res.redirect(appendSocialStatus(redirectPath, "connected"));
      } catch (error) {
        console.error("Error completing X social connection:", error);
        await setSocialOAuthSession(req, null).catch(() => undefined);
        res.redirect(
          appendSocialStatus(
            redirectPath,
            "error",
            error instanceof Error ? error.message : "X connection failed",
          ),
        );
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/live-share-card",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only share location for restaurants you own",
          });
        }

        const [restaurant] = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            description: restaurants.description,
            cuisineType: restaurants.cuisineType,
            city: restaurants.city,
            state: restaurants.state,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            facebookPageUrl: restaurants.facebookPageUrl,
            instagramUrl: restaurants.instagramUrl,
            xUrl: restaurants.xUrl,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);

        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const baseUrl = (process.env.PUBLIC_BASE_URL || "https://www.mealscout.us")
          .replace(/\/+$/, "");
        const profileUrl = `${baseUrl}/restaurant/${restaurant.id}`;
        const place = [restaurant.city, restaurant.state]
          .filter(Boolean)
          .join(", ");
        const description = String(
          restaurant.description ||
            restaurant.cuisineType ||
            "Food truck",
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
        const message = [
          `${restaurant.name} is serving now.`,
          place ? `Find us in ${place}.` : "",
          description,
          "Live location + menu:",
        ]
          .filter(Boolean)
          .join(" ");

        res.json({
          title: "Share live location",
          message,
          link: profileUrl,
          imageUrl: restaurant.coverImageUrl || restaurant.logoUrl || null,
          businessPageUrl: profileUrl,
          socialUrls: {
            facebook: restaurant.facebookPageUrl || null,
            instagram: restaurant.instagramUrl || null,
            x: restaurant.xUrl || null,
          },
        });
      } catch (error) {
        console.error("Error building live share card:", error);
        res.status(500).json({ message: "Failed to build share card" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/social-posts",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only queue social posts for restaurants you own",
          });
        }

        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required to queue social posts.",
          });
        }

        const rateLimitResult = checkRateLimit(
          `social_post_${req.user.id}_${restaurantId}`,
        );
        if (!rateLimitResult.allowed) {
          return res.status(429).json({
            message: "Please wait before queuing another social post.",
            nextAllowedTime: rateLimitResult.nextAllowedTime,
          });
        }

        const schema = z.object({
          message: z.string().trim().min(1).max(1200),
          link: z.string().url().optional().nullable(),
          imageUrl: z.string().url().optional().nullable(),
          source: z.string().trim().max(80).optional().nullable(),
          platforms: z.object({
            facebook: z.boolean().optional(),
            instagram: z.boolean().optional(),
            x: z.boolean().optional(),
          }),
        });
        const parsed = schema.parse(req.body || {});
        const selectedPlatforms = Object.entries(parsed.platforms)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([platform]) => platform);

        if (selectedPlatforms.length === 0) {
          return res.status(400).json({ message: "Select at least one platform" });
        }

        const [restaurant] = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            ownerId: restaurants.ownerId,
            facebookPageUrl: restaurants.facebookPageUrl,
            instagramUrl: restaurants.instagramUrl,
            xUrl: restaurants.xUrl,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);

        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const targetByPlatform: Record<string, string | null> = {
          facebook: restaurant.facebookPageUrl || null,
          instagram: restaurant.instagramUrl || null,
          x: restaurant.xUrl || null,
        };

        const rows = [];
        for (const platform of selectedPlatforms) {
          const connection = await getActiveSocialConnection(restaurantId, platform);
          const instagramNeedsImage = platform === "instagram" && !parsed.imageUrl;
          rows.push({
            platform,
            target:
              connection?.externalAccountUrl ||
              connection?.externalAccountId ||
              targetByPlatform[platform] ||
              null,
            message: parsed.message,
            link: parsed.link || null,
            imageUrl: parsed.imageUrl || null,
            restaurantId,
            createdByUserId: req.user.id,
            source: parsed.source || "owner_prompt",
            status: connection && !instagramNeedsImage ? "pending" : "manual_required",
            errorMessage: connection
              ? instagramNeedsImage
                ? "Instagram publishing requires an image. Use the manual share handoff."
                : null
              : "Publishing is not connected for this platform. Use the manual share handoff.",
            metadata: {
              restaurantName: restaurant.name,
              intendedOwnerId: restaurant.ownerId || null,
              queuedFrom: "parking_pass",
              hasPublishingConnection: Boolean(connection),
              connectionId: connection?.id || null,
              userAgent: req.headers["user-agent"] || null,
            },
            updatedAt: new Date(),
          });
        }

        const created = await db.insert(socialPostQueue).values(rows).returning();
        const pendingCount = created.filter(
          (post: { status: string }) => post.status === "pending",
        ).length;
        const manualCount = created.filter(
          (post: { status: string }) => post.status === "manual_required",
        ).length;

        try {
          await db.insert(telemetryEvents).values({
            eventName: "owner_social_post_queued",
            userId: req.user.id,
            properties: {
              restaurantId,
              platforms: selectedPlatforms,
              source: parsed.source || "owner_prompt",
              hasImage: Boolean(parsed.imageUrl),
              hasLink: Boolean(parsed.link),
            },
          });
        } catch (trackingError) {
          console.warn("Failed to track social post queue:", trackingError);
        }

        res.json({
          success: true,
          posts: created,
          queuedForPublishing: pendingCount,
          manualRequired: manualCount > 0,
          manualRequiredCount: manualCount,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid social post",
            errors: error.errors,
          });
        }
        console.error("Error queueing social post:", error);
        res.status(500).json({ message: "Failed to queue social post" });
      }
    },
  );

  app.get("/api/restaurants/:restaurantId/is-open", async (req: any, res) => {
    try {
      const isOpen = await storage.isRestaurantOpenNow(req.params.restaurantId);
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

  app.post(
    "/api/restaurants/:restaurantId/truck-session/start",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { deviceId } = req.body;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

        const latitude = Number(req.body?.latitude);
        const longitude = Number(req.body?.longitude);
        const liveForMinutesRaw = Number(req.body?.liveForMinutes);
        const liveForMinutes = Number.isFinite(liveForMinutesRaw)
          ? Math.min(240, Math.max(15, liveForMinutesRaw))
          : null;
        const liveUntilAt = new Date(
          Date.now() + (liveForMinutes || 240) * 60_000,
        );
        let location = null;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          location = await storage.upsertLiveLocation(
            insertFoodTruckLocationSchema.parse({
              restaurantId,
              latitude,
              longitude,
            }),
            { liveUntilAt },
          );
          broadcastLocationUpdate(restaurantId, location);
        }

        res.json({ success: true, session, location });
      } catch (error) {
        console.error("Error starting truck session:", error);
        res.status(500).json({ message: "Failed to start truck session" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/truck-session/end",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.post(
    "/api/restaurants/:restaurantId/location",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Premium subscription required for one-click live location updates.",
          });
        }

        const { restaurantId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update location for restaurants you own",
          });
        }

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

        const liveForMinutesRaw = Number(req.body?.liveForMinutes);
        const liveForMinutes = Number.isFinite(liveForMinutesRaw)
          ? Math.min(240, Math.max(15, liveForMinutesRaw))
          : 240;
        const liveUntilAt = new Date(Date.now() + liveForMinutes * 60_000);
        const location = await storage.upsertLiveLocation(
          insertFoodTruckLocationSchema.parse({
            ...req.body,
            restaurantId,
          }),
          { liveUntilAt },
        );

        broadcastLocationUpdate(restaurantId, location);

        try {
          await db.insert(telemetryEvents).values({
            eventName: "premium_live_location_used",
            userId: req.user.id,
            properties: {
              restaurantId,
              latitude: location.latitude,
              longitude: location.longitude,
              liveForMinutes,
              liveUntilAt: liveUntilAt.toISOString(),
            },
          });
        } catch (trackingError) {
          console.warn("Failed to track live location usage:", trackingError);
        }

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
      const radius = Math.min(parseFloat(radiusKm as string), 50);

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

      const payloadTrucks =
        visibleTrucks.length > 0 || trucks.length === 0 ? visibleTrucks : trucks;
      if (visibleTrucks.length === 0 && trucks.length > 0) {
        res.setHeader("X-MealScout-Fallback", "unfiltered-live-trucks");
      }

      const truckIds = payloadTrucks
        .map((truck: any) => String(truck?.id || "").trim())
        .filter(Boolean);
      const suppressedTruckIds = await getSuppressedLocationResourceIds({
        resourceIds: truckIds,
        targetType: "live_location",
      });

      const trustedPayloadTrucks = payloadTrucks.filter(
        (truck: any) => !suppressedTruckIds.has(String(truck?.id || "")),
      );
      if (suppressedTruckIds.size > 0) {
        res.setHeader(
          "X-MealScout-Suppressed-Live-Trucks",
          String(suppressedTruckIds.size),
        );
      }

      res.json({ trucks: trustedPayloadTrucks });
    } catch (error) {
      console.error("Error fetching live trucks:", error);
      res.status(500).json({ message: "Failed to fetch live trucks" });
    }
  });

  app.post("/api/trucks/:truckId/location-reports", async (req: any, res) => {
    try {
      const { truckId } = req.params;
      const rateLimitKey = `truck_missing_${truckId}_${req.user?.id || req.ip || "anon"}`;
      const rateLimitResult = checkRateLimit(rateLimitKey);
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          message: "Please wait before reporting this truck again.",
          nextAllowedTime: rateLimitResult.nextAllowedTime,
        });
      }

      const schema = z.object({
        targetType: z
          .enum(["live_location", "manual_schedule", "event_schedule"])
          .default("live_location"),
        manualScheduleId: z.string().optional(),
        eventId: z.string().optional(),
        expectedLatitude: z.coerce.number().min(-90).max(90).optional(),
        expectedLongitude: z.coerce.number().min(-180).max(180).optional(),
        reporterLatitude: z.coerce.number().min(-90).max(90).optional(),
        reporterLongitude: z.coerce.number().min(-180).max(180).optional(),
        sourceLabel: z.string().max(160).optional(),
        notes: z.string().max(500).optional(),
        observedAt: z.string().datetime().optional(),
      });
      const parsed = schema.parse(req.body || {});

      const [truck] = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          ownerId: restaurants.ownerId,
          isFoodTruck: restaurants.isFoodTruck,
          isActive: restaurants.isActive,
        })
        .from(restaurants)
        .where(eq(restaurants.id, truckId))
        .limit(1);

      if (!truck || !truck.isFoodTruck || !truck.isActive) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const [created] = await db
        .insert(moderationEvents)
        .values({
          eventType: "truck_location_missing_report",
          severity: "medium",
          reportedUserId: truck.ownerId || null,
          reportedResourceType: parsed.targetType,
          reportedResourceId:
            parsed.manualScheduleId || parsed.eventId || truckId,
          reporterUserId: req.user?.id || null,
          reason: "truck_not_at_expected_location",
          description:
            parsed.notes ||
            `${truck.name} was reported missing from its expected map location.`,
          metadata: {
            truckId,
            truckName: truck.name,
            targetType: parsed.targetType,
            manualScheduleId: parsed.manualScheduleId || null,
            eventId: parsed.eventId || null,
            expectedLatitude: parsed.expectedLatitude ?? null,
            expectedLongitude: parsed.expectedLongitude ?? null,
            reporterLatitude: parsed.reporterLatitude ?? null,
            reporterLongitude: parsed.reporterLongitude ?? null,
            sourceLabel: parsed.sourceLabel || null,
            observedAt: parsed.observedAt || new Date().toISOString(),
            userAgent: req.headers["user-agent"] || null,
            ip: req.ip || null,
          },
          status: "open",
        })
        .returning();

      res.json({ success: true, report: created });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid location report",
          errors: error.errors,
        });
      }
      console.error("Error creating truck location report:", error);
      res.status(500).json({ message: "Failed to submit location report" });
    }
  });

  app.get(
    "/api/restaurants/:restaurantId/locations",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate } = req.query;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageProfile",
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

  app.get(
    "/api/restaurants/:restaurantId/analytics/summary",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { startDate, endDate } = req.query;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

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

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

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

        const timeseries = await storage.getRestaurantAnalyticsTimeseries(
          restaurantId,
          {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          },
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

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

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

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

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

        res.json({
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
        });
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

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

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

        const exportData = await storage.getRestaurantAnalyticsExport(
          restaurantId,
          {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          },
        );

        if (format === "csv") {
          const csvHeader = "Deal Title,Date,Views,Claims,Revenue\n";
          const csvRows = exportData
            .map((row: any) => {
              const sanitizeCSV = (value: any): string => {
                if (value === null || value === undefined) return "";
                const str = String(value);
                if (/^[=+@-]/.test(str)) {
                  return `"'${str.replace(/"/g, '""')}"`;
                }
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
          return res.send(csvHeader + csvRows);
        }

        res.json(exportData);
      } catch (error) {
        console.error("Error exporting analytics:", error);
        res.status(500).json({ message: "Failed to export analytics" });
      }
    },
  );
}
