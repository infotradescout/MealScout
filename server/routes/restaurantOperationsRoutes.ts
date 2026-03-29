import type { Express } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { storage } from "../storage";
import { checkRateLimit } from "../documentValidation";
import { isAuthenticated } from "../unifiedAuth";
import { reverseGeocode } from "../utils/geocoding";
import { broadcastLocationUpdate, broadcastStatusUpdate } from "../websocket";
import {
  insertFoodTruckLocationSchema,
  restaurants,
  updateRestaurantLocationSchema,
  updateRestaurantMobileSettingsSchema,
  updateRestaurantOperatingHoursSchema,
} from "@shared/schema";

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
  app.get(
    "/api/restaurants/my-restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantsByOwner = await storage.getRestaurantsByOwner(
          req.user.id,
        );
        res.json(restaurantsByOwner);
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
        const deals = await storage.getDealsByRestaurant(req.params.restaurantId);
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
            (await storage.getRestaurantAverageRating(req.params.restaurantId)) ||
            0,
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
            error instanceof Error ? error.message : "Failed to update location",
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
        const { restaurantId } = req.params;
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
        res.json({ success: true, location });
      } catch (error) {
        console.error("Error updating location:", error);
        res.status(400).json({
          message:
            error instanceof Error ? error.message : "Failed to update location",
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

      const trucks = await storage.getLiveTrucksNearby(latitude, longitude, radius);
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
