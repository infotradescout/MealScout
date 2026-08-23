import type { Express } from "express";
import { and, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../db";
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  deals,
  menuItems,
  menus,
  restaurants as restaurantsTable,
} from "@shared/schema";
import { toPublicRestaurantListingArrayWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import { filterProjectedPublicNearbyRestaurantRows } from "../services/publicRestaurantSearchProjection";
import { deriveProfileEvidenceQuarantineVisibility } from "../services/profileEvidenceQuarantine";

type LocationUtilityRouteDependencies = {
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
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

const isTruckBusiness = (restaurant: any) =>
  restaurant?.isFoodTruck === true ||
  String(restaurant?.businessType || restaurant?.business_type || "").toLowerCase() ===
    "food_truck";

export function registerLocationUtilityRoutes(
  app: Express,
  _dependencies: LocationUtilityRouteDependencies,
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
      res.setHeader("Cache-Control", "no-store");
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

      const activeRestaurantRows = await db
        .select()
        .from(restaurantsTable)
        .where(eq(restaurantsTable.isActive, true));
      const canonicalPublicRows = activeRestaurantRows
        .filter(
          (restaurant: any) =>
            isPublicBusinessVisible(restaurant) &&
            !deriveProfileEvidenceQuarantineVisibility(restaurant)
              .isQuarantined,
        )
        .map((restaurant: any) => sanitizeRestaurantMedia(restaurant));
      const projectedPublicRows =
        await toPublicRestaurantListingArrayWithVisibility(
          canonicalPublicRows,
        );
      const publicProjectedById = new Map(
        projectedPublicRows.map((restaurant: any) => [
          String(restaurant.id || ""),
          restaurant,
        ]),
      );
      const publicNearbyIds = new Set(
        filterProjectedPublicNearbyRestaurantRows(
          projectedPublicRows,
          { userLat: latitude, userLng: longitude, radiusKm: radius },
        ).map((restaurant: any) => String(restaurant.id || "")),
      );
      const nearbyRestaurants = activeRestaurantRows.filter((restaurant: any) =>
        publicNearbyIds.has(String(restaurant.id || "")),
      );
      const restaurants = nearbyRestaurants.filter((restaurant: any) =>
        publicProjectedById.has(String(restaurant.id || "")),
      );
      const publicTruckIds = new Set(
        restaurants
          .filter((restaurant: any) => isTruckBusiness(restaurant))
          .map((restaurant: any) => String(restaurant?.id || "").trim()),
      );
      if (publicTruckIds.size > 0) {
        res.setHeader("X-MealScout-Public-Truck-Profiles", String(publicTruckIds.size));
      }

      const restaurantIds = restaurants.map((restaurant: any) => restaurant.id);
      const menuEligibleIds = new Set<string>();
      const menuCounts: Record<string, number> = {};
      if (restaurantIds.length > 0) {
        const menuRows = await db
          .select({
            restaurantId: menuItems.restaurantId,
            count: sql<number>`count(*)::integer`,
          })
          .from(menuItems)
          .innerJoin(menus, eq(menuItems.menuId, menus.id))
          .where(
            and(
              inArray(menuItems.restaurantId, restaurantIds),
              eq(menus.isActive, true),
              eq(menuItems.isAvailable, true),
              gt(menuItems.priceCents, 0),
            ),
          )
          .groupBy(menuItems.restaurantId);
        for (const row of menuRows) {
          const restaurantId = String(row.restaurantId);
          const count = Number(row.count || 0);
          menuCounts[restaurantId] = count;
          if (count > 0) {
            menuEligibleIds.add(restaurantId);
          }
        }
      }
      const discoverableRestaurants = restaurants.filter((restaurant: any) => {
        const isTruck =
          restaurant?.isFoodTruck === true ||
          String(restaurant?.businessType || "").toLowerCase() === "food_truck";
        return isTruck || menuEligibleIds.has(String(restaurant.id || ""));
      });
      if (discoverableRestaurants.length !== restaurants.length) {
        res.setHeader(
          "X-MealScout-Filtered-Missing-Menu",
          String(restaurants.length - discoverableRestaurants.length),
        );
      }
      const discoverableRestaurantIds = discoverableRestaurants.map(
        (restaurant: any) => restaurant.id,
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
              or(isNull(deals.startDate), lte(deals.startDate, new Date())),
              or(isNull(deals.endDate), gte(deals.endDate, new Date())),
            ),
          )
          .groupBy(deals.restaurantId);

        allDeals.forEach((row: (typeof allDeals)[number]) => {
          dealCounts[row.restaurantId] = row.count;
        });
      }

      res.json(
        discoverableRestaurants.map((restaurant: any) => ({
          ...publicProjectedById.get(String(restaurant.id || "")),
          menuItemCount: menuCounts[String(restaurant.id)] || 0,
          menuAvailable: menuEligibleIds.has(String(restaurant.id)),
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
