import type { Express } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import { deals, menuItems, restaurants as restaurantsTable } from "@shared/schema";

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

const PENSACOLA_MARKET = { lat: 30.4213, lng: -87.2169 };
const PENSACOLA_SERVICE_CITIES = new Set([
  "pensacola",
  "brent",
  "gulf breeze",
  "pensacola beach",
  "milton",
  "pace",
  "navarre",
  "fort walton beach",
  "destin",
  "escambia county",
  "santa rosa county",
]);
const PENSACOLA_SERVICE_COUNTIES = new Set(["12033", "12113"]);

const distanceMilesBetween = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa =
    s1 * s1 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
};

const isPensacolaMarketRequest = (lat: number, lng: number, radiusMiles: number) =>
  distanceMilesBetween(lat, lng, PENSACOLA_MARKET.lat, PENSACOLA_MARKET.lng) <=
  Math.max(radiusMiles, 25);

const isTruckBusiness = (restaurant: any) =>
  restaurant?.isFoodTruck === true ||
  String(restaurant?.businessType || restaurant?.business_type || "").toLowerCase() ===
    "food_truck";

const canonicalRestaurantKey = (restaurant: any) =>
  String(restaurant?.id || "").trim();

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
      const pensacolaServiceCitySql = sql.join(
        Array.from(PENSACOLA_SERVICE_CITIES).map((city) => sql`${city}`),
        sql`, `,
      );
      const pensacolaServiceCountySql = sql.join(
        Array.from(PENSACOLA_SERVICE_COUNTIES).map((county) => sql`${county}`),
        sql`, `,
      );
      const serviceAreaTrucks = isPensacolaMarketRequest(latitude, longitude, radius)
        ? (
            await db
              .select()
              .from(restaurantsTable)
              .where(
                and(
                  eq(restaurantsTable.isActive, true),
                  sql`(${restaurantsTable.isFoodTruck} = true OR lower(coalesce(${restaurantsTable.businessType}, '')) = 'food_truck')`,
                  sql`(${restaurantsTable.latitude} is null OR ${restaurantsTable.longitude} is null)`,
                  sql`(
                    lower(trim(coalesce(${restaurantsTable.city}, ''))) in (${pensacolaServiceCitySql})
                    OR coalesce(${restaurantsTable.countyFips}, '') in (${pensacolaServiceCountySql})
                  )`,
                ),
              )
          ).filter((restaurant: any) => isPublicBusinessVisible(restaurant))
        : [];

      const candidatesById = new Map<string, any>();
      for (const restaurant of [...nearbyRestaurants, ...serviceAreaTrucks]) {
        const key = canonicalRestaurantKey(restaurant);
        if (key) candidatesById.set(key, restaurant);
      }
      const candidateRestaurants = Array.from(candidatesById.values());

      const accessEligibleRestaurants = (
        await Promise.all(
          candidateRestaurants.map(async (restaurant) => {
            const ownerId = String((restaurant as any)?.ownerId || "").trim();
            if (!ownerId) return null;
            const hasAccess = await hasBusinessDistributionAccess(ownerId);
            return hasAccess ? restaurant : null;
          }),
        )
      ).filter(Boolean) as any[];

      const publicTruckProfiles = candidateRestaurants.filter((restaurant) =>
        isTruckBusiness(restaurant),
      );
      const publicTruckIds = new Set(publicTruckProfiles.map(canonicalRestaurantKey));
      const mergedAccessAndTruckProfiles = [
        ...accessEligibleRestaurants,
        ...publicTruckProfiles.filter(
          (restaurant) =>
            !accessEligibleRestaurants.some(
              (eligible) => canonicalRestaurantKey(eligible) === canonicalRestaurantKey(restaurant),
            ),
        ),
      ];

      const restaurants =
        mergedAccessAndTruckProfiles.length > 0 || candidateRestaurants.length === 0
          ? mergedAccessAndTruckProfiles
          : candidateRestaurants;

      if (accessEligibleRestaurants.length === 0 && candidateRestaurants.length > 0) {
        res.setHeader("X-MealScout-Fallback", "unfiltered-restaurants");
      }
      if (publicTruckIds.size > 0) {
        res.setHeader("X-MealScout-Public-Truck-Profiles", String(publicTruckIds.size));
      }

      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      const menuEligibleIds = new Set<string>();
      const menuCounts: Record<string, number> = {};
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
