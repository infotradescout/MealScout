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
import {
  insertFoodTruckLocationSchema,
  restaurants,
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
    "/api/restaurants/:id/onboarding/completion",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = String(req.params?.id || "").trim();
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID is required" });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const isAdminOrStaff =
          req.user?.userType === "admin" ||
          req.user?.userType === "super_admin" ||
          req.user?.userType === "staff";
        if (!isAdminOrStaff && String((restaurant as any).ownerId) !== String(req.user.id)) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const text = (value: unknown) => String(value || "").trim();
        const requiredChecks = [
          { key: "name", label: "Business name", ok: Boolean(text((restaurant as any).name)) },
          { key: "address", label: "Address", ok: Boolean(text((restaurant as any).address)) },
          { key: "city", label: "City", ok: Boolean(text((restaurant as any).city)) },
          { key: "state", label: "State", ok: Boolean(text((restaurant as any).state)) },
          { key: "phone", label: "Phone", ok: Boolean(text((restaurant as any).phone)) },
          {
            key: "businessType",
            label: "Business type",
            ok: Boolean(text((restaurant as any).businessType)),
          },
        ];

        const recommendedChecks = [
          {
            key: "cuisineType",
            label: "Cuisine/category",
            ok: Boolean(text((restaurant as any).cuisineType)),
          },
          {
            key: "description",
            label: "Business description",
            ok: Boolean(text((restaurant as any).description)),
          },
          {
            key: "websiteUrl",
            label: "Website or social link",
            ok: Boolean(
              text((restaurant as any).websiteUrl) ||
                text((restaurant as any).instagramUrl) ||
                text((restaurant as any).facebookPageUrl),
            ),
          },
          {
            key: "amenities",
            label: "Amenities",
            ok:
              String((restaurant as any).businessType || "").toLowerCase() === "food_truck"
                ? true
                : Boolean(
                    (restaurant as any).amenities &&
                      typeof (restaurant as any).amenities === "object" &&
                      ((restaurant as any).amenities.parking ||
                        (restaurant as any).amenities.wifi ||
                        (restaurant as any).amenities.outdoor_seating),
                  ),
          },
        ];

        const requiredDone = requiredChecks.filter((item) => item.ok).length;
        const recommendedDone = recommendedChecks.filter((item) => item.ok).length;
        const requiredTotal = requiredChecks.length;
        const recommendedTotal = recommendedChecks.length;
        const overallDone = requiredDone + recommendedDone;
        const overallTotal = requiredTotal + recommendedTotal;
        const overallPct =
          overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 100;

        let verificationStatus: "verified" | "pending" | "not_submitted" = "not_submitted";
        if (Boolean((restaurant as any).isVerified)) {
          verificationStatus = "verified";
        } else {
          const pending = await storage.hasPendingVerificationRequest(restaurantId);
          verificationStatus = pending ? "pending" : "not_submitted";
        }

        res.json({
          restaurantId,
          overallPct,
          required: {
            done: requiredDone,
            total: requiredTotal,
            missing: requiredChecks.filter((item) => !item.ok),
          },
          recommended: {
            done: recommendedDone,
            total: recommendedTotal,
            missing: recommendedChecks.filter((item) => !item.ok),
          },
          verification: {
            status: verificationStatus,
            isVerified: Boolean((restaurant as any).isVerified),
            needsSubmission: verificationStatus === "not_submitted",
          },
        });
      } catch (error) {
        console.error("Error computing onboarding completion:", error);
        res
          .status(500)
          .json({ message: "Failed to compute onboarding completion" });
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

        const location = await storage.upsertLiveLocation(
          insertFoodTruckLocationSchema.parse({
            ...req.body,
            restaurantId,
          }),
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
            if (!truck?.isVerified) return null;
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
