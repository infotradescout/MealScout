import type { Express } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import { deals, menuItems } from "@shared/schema";

type LocationUtilityRouteDependencies = {
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
};

const GOOGLE_PLACE_PHOTO_HOST_RE = /(^|\/\/)(lh\d*\.googleusercontent\.com|maps\.googleapis\.com)(\/|$)/i;

const isGooglePlacePhotoUrl = (value: unknown): boolean => {
  const url = String(value || "").trim();
  if (!url) return false;
  return GOOGLE_PLACE_PHOTO_HOST_RE.test(url);
};

const sanitizeRestaurantMedia = <T extends Record<string, unknown>>(restaurant: T): T => {
  const next = { ...restaurant } as T & {
    coverImageUrl?: unknown;
    logoUrl?: unknown;
    heroImageUrl?: unknown;
    imageUrl?: unknown;
    isVerified?: unknown;
    claimedFromImportId?: unknown;
  };
  if (isGooglePlacePhotoUrl(next.coverImageUrl)) next.coverImageUrl = null;
  if (isGooglePlacePhotoUrl(next.heroImageUrl)) next.heroImageUrl = null;
  if (isGooglePlacePhotoUrl(next.imageUrl)) next.imageUrl = null;
  if (isGooglePlacePhotoUrl(next.logoUrl)) next.logoUrl = null;
  const importedClaim =
    String(next.claimedFromImportId || "").trim().length > 0;
  const verified = Boolean(next.isVerified);
  // Imported + unverified records are most likely to carry stale third-party cover photos.
  // Keep logo (if present), but suppress broader hero/cover/image fields until verified.
  if (importedClaim && !verified) {
    next.coverImageUrl = null;
    next.heroImageUrl = null;
    next.imageUrl = null;
  }
  return next as T;
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
      const subscribedRestaurants = (
        await Promise.all(
          nearbyRestaurants.map(async (restaurant) => {
            const ownerId = String((restaurant as any)?.ownerId || "").trim();
            if (!ownerId) return null;
            const hasAccess = await hasBusinessDistributionAccess(ownerId);
            return hasAccess ? restaurant : null;
          }),
        )
      ).filter(Boolean) as any[];

      const restaurants =
        subscribedRestaurants.length > 0 || nearbyRestaurants.length === 0
          ? subscribedRestaurants
          : nearbyRestaurants;

      if (subscribedRestaurants.length === 0 && nearbyRestaurants.length > 0) {
        res.setHeader("X-MealScout-Fallback", "unfiltered-restaurants");
      }

      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      const menuEligibleIds = new Set<string>();
      if (restaurantIds.length > 0) {
        const menuRows = await db
          .select({
            restaurantId: menuItems.restaurantId,
            count: sql<number>`count(*)::integer`,
          })
          .from(menuItems)
          .where(inArray(menuItems.restaurantId, restaurantIds))
          .groupBy(menuItems.restaurantId);
        for (const row of menuRows) {
          if (Number(row.count || 0) > 0) {
            menuEligibleIds.add(String(row.restaurantId));
          }
        }
      }
      const discoverableRestaurants = restaurants.filter((restaurant: any) =>
        menuEligibleIds.has(String(restaurant.id || "")),
      );
      if (discoverableRestaurants.length !== restaurants.length) {
        res.setHeader(
          "X-MealScout-Filtered-Missing-Menu",
          String(restaurants.length - discoverableRestaurants.length),
        );
      }
      const discoverableRestaurantIds = discoverableRestaurants.map(
        (restaurant) => restaurant.id,
      );
      const dealCounts: Record<string, number> = {};

      if (discoverableRestaurantIds.length > 0) {
        const allDeals = await db
          .select({
            restaurantId: deals.restaurantId,
            count: sql<number>`count(*)::integer`,
          })
          .from(deals)
          .where(
            and(
              inArray(deals.restaurantId, discoverableRestaurantIds),
              eq(deals.isActive, true),
            ),
          )
          .groupBy(deals.restaurantId);

        allDeals.forEach((row: (typeof allDeals)[number]) => {
          dealCounts[row.restaurantId] = row.count;
        });
      }

      res.json(
        discoverableRestaurants.map((restaurant) => ({
          ...sanitizeRestaurantMedia(restaurant),
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
