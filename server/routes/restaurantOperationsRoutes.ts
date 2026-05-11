import type { Express } from "express";
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

export function registerRestaurantOperationsRoutes(
  app: Express,
  {
    validateAnalyticsAccess,
    hasBusinessDistributionAccess,
  }: RestaurantOperationsRouteDependencies,
) {
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
        res.json({ restaurantId, connections });
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
