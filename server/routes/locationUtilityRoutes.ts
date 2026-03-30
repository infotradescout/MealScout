import type { Express } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import { deals } from "@shared/schema";

type LocationUtilityRouteDependencies = {
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
};

export function registerLocationUtilityRoutes(
  app: Express,
  { hasBusinessDistributionAccess }: LocationUtilityRouteDependencies,
) {
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

      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      const dealCounts: Record<string, number> = {};

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

        allDeals.forEach((row: (typeof allDeals)[number]) => {
          dealCounts[row.restaurantId] = row.count;
        });
      }

      res.json(
        restaurants.map((restaurant) => ({
          ...restaurant,
          activeDealsCount: dealCounts[restaurant.id] || 0,
        })),
      );
    } catch (error) {
      console.error("Error fetching subscribed restaurants:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch subscribed restaurants" });
    }
  });
}
