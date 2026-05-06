import type { Express } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { computeParkingPassQualityFlags } from "../services/parkingPassQuality";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  ensureGoogleRestaurantProfile,
  getGooglePhotoUrl,
  sanitizeGoogleRestaurantMedia,
  searchPlacesFreeText,
} from "../services/googleProfileService";
import {
  deals,
  eventSeries,
  events,
  hosts,
  restaurants,
  truckImportListings,
  users,
  videoStories,
} from "@shared/schema";

const FOOD_PLACE_TYPE_ALLOWLIST = new Set([
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "cafe",
  "bakery",
  "bar",
  "night_club",
  "food_court",
  "ice_cream_shop",
  "coffee_shop",
  "sandwich_shop",
  "pizza_restaurant",
  "hamburger_restaurant",
  "mexican_restaurant",
  "italian_restaurant",
  "chinese_restaurant",
  "japanese_restaurant",
  "thai_restaurant",
  "indian_restaurant",
  "american_restaurant",
  "seafood_restaurant",
  "steak_house",
  "sushi_restaurant",
  "vegetarian_restaurant",
  "vegan_restaurant",
  "breakfast_restaurant",
  "barbecue_restaurant",
  "fast_food_restaurant",
  "diner",
  "brewery",
  "wine_bar",
  "pub",
]);

const normalizeSearchTerm = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchTerms = (query: string) => {
  const terms = new Set<string>();
  const normalized = normalizeSearchTerm(query);
  if (normalized) terms.add(normalized);

  String(query || "")
    .split(",")
    .map(normalizeSearchTerm)
    .filter((part) => part.length >= 2)
    .forEach((part) => terms.add(part));

  return Array.from(terms)
    .filter((term) => term.length >= 2)
    .slice(0, 6);
};

const firstSearchSegment = (query: string) =>
  normalizeSearchTerm(String(query || "").split(",")[0] || "");

const searchTokens = (term: string) =>
  normalizeSearchTerm(term)
    .split(" ")
    .filter((token) => token.length >= 3 && token !== "the");

const GENERIC_FOOD_DISCOVERY_TOKENS = new Set([
  "american",
  "asian",
  "bakery",
  "barbecue",
  "bbq",
  "breakfast",
  "brunch",
  "burger",
  "burgers",
  "cafe",
  "cajun",
  "chinese",
  "coffee",
  "creole",
  "cuban",
  "deal",
  "deals",
  "deli",
  "delivery",
  "dinner",
  "fast",
  "fish",
  "food",
  "foods",
  "healthy",
  "ice",
  "indian",
  "italian",
  "japanese",
  "korean",
  "lunch",
  "mexican",
  "near",
  "nearby",
  "open",
  "pizza",
  "restaurant",
  "restaurants",
  "seafood",
  "shrimp",
  "shop",
  "sushi",
  "taco",
  "tacos",
  "thai",
  "truck",
  "trucks",
  "vegan",
  "vegetarian",
]);

const isBroadFoodDiscoveryQuery = (query: string) => {
  const primary = firstSearchSegment(query);
  if (!primary) return false;

  const tokens = primary
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token !== "best");

  return (
    tokens.length > 0 &&
    tokens.every((token) => GENERIC_FOOD_DISCOVERY_TOKENS.has(token))
  );
};

const toSearchCoordinate = (value: unknown, maxAbs: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > maxAbs) return null;
  return parsed;
};

const DEFAULT_LOCAL_SEARCH_RADIUS_KM = 80;
const MAX_LOCAL_SEARCH_RADIUS_KM = 250;

const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseLocalOnly = (value: unknown) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const distanceKmBetween = (
  lat1: number,
  lng1: number,
  lat2Input: unknown,
  lng2Input: unknown,
) => {
  const lat2 = Number(lat2Input);
  const lng2 = Number(lng2Input);
  if (
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2) ||
    Math.abs(lat2) > 90 ||
    Math.abs(lng2) > 180
  ) {
    return null;
  }

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

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const isGoogleLocalityOnly = (candidate: {
  types?: string[];
  formattedAddress?: string | null;
}) => {
  const types = Array.isArray(candidate.types) ? candidate.types : [];
  return types.some((type) =>
    [
      "locality",
      "political",
      "administrative_area_level_1",
      "country",
    ].includes(type),
  );
};

const candidateLooksLikeRequestedPlace = (
  candidate: { name?: string | null; formattedAddress?: string | null },
  primaryTerm: string,
) => {
  const requestedTokens = searchTokens(primaryTerm);
  if (requestedTokens.length === 0) return false;
  const haystack = normalizeSearchTerm(
    `${candidate.name || ""} ${candidate.formattedAddress || ""}`,
  );
  const hits = requestedTokens.filter((token) =>
    haystack.includes(token),
  ).length;
  return hits >= Math.min(2, requestedTokens.length);
};

const hasAllowedFoodPlaceType = (candidate: { types?: string[] }) => {
  const types = Array.isArray(candidate.types) ? candidate.types : [];
  return types.some((type) => FOOD_PLACE_TYPE_ALLOWLIST.has(type));
};

const shouldAutoPopulateGoogleProfile = (
  candidate: {
    placeId?: string | null;
    name?: string | null;
    formattedAddress?: string | null;
    types?: string[];
    businessStatus?: string | null;
  },
  query: string,
  primaryTerm: string,
) => {
  const placeId = String(candidate.placeId || "").trim();
  const name = String(candidate.name || "").trim();
  const address = String(candidate.formattedAddress || "").trim();
  if (!placeId || !name || !address) return false;
  if (isGoogleLocalityOnly(candidate)) return false;
  if (!hasAllowedFoodPlaceType(candidate)) return false;

  const status = String(candidate.businessStatus || "").toUpperCase();
  if (status === "CLOSED_PERMANENTLY") return false;

  if (candidateLooksLikeRequestedPlace(candidate, primaryTerm)) return true;

  const normalizedQuery = normalizeSearchTerm(query);
  const normalizedName = normalizeSearchTerm(name);
  const normalizedPrimary = normalizeSearchTerm(primaryTerm);
  if (normalizedName.length >= 4 && normalizedQuery.includes(normalizedName)) {
    return true;
  }
  if (
    normalizedPrimary.length >= 4 &&
    normalizedName.includes(normalizedPrimary)
  ) {
    return true;
  }

  return false;
};

const scoreSearchFields = (
  fields: unknown[],
  terms: string[],
  primaryTerm: string,
) => {
  if (terms.length === 0 && !primaryTerm) return 0;
  const haystack = fields.map(normalizeSearchTerm).join(" ");
  let score = 0;
  let primaryScore = 0;

  if (primaryTerm) {
    if (haystack.includes(primaryTerm)) {
      primaryScore += 100;
    } else {
      const tokens = searchTokens(primaryTerm);
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      const requiredHits = Math.min(2, tokens.length);
      if (requiredHits > 0 && hits >= requiredHits) {
        primaryScore += hits * 20;
      }
    }
  }

  if (primaryTerm && terms.length > 1 && primaryScore === 0) return 0;
  score += primaryScore;

  terms.forEach((term, index) => {
    if (term && haystack.includes(term)) score += Math.max(1, 12 - index);
  });

  return score;
};

const fetchGooglePhotoResponse = async (photoUrl: string) => {
  const response = await fetch(photoUrl, {
    headers: {
      "user-agent":
        "MealScoutBot/1.0 (+https://www.mealscout.us; Google photo proxy)",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) return null;

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 8 * 1024 * 1024) return null;

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) return null;

  return {
    contentType,
    buffer: Buffer.from(arrayBuffer),
  };
};

export function registerPublicSearchRoutes(app: Express) {
  app.get("/api/google/photo", async (req, res) => {
    const photoName = String(req.query.name || "").trim();
    const maxWidth = Math.max(
      120,
      Math.min(1600, Number(req.query.maxWidth || 960) || 960),
    );

    if (!photoName || !photoName.startsWith("places/")) {
      return res
        .status(400)
        .json({ message: "Valid Google photo name is required" });
    }

    const photoUrl = getGooglePhotoUrl(photoName, maxWidth);
    if (!photoUrl) {
      return res.status(404).json({ message: "Google photo is not available" });
    }

    try {
      const image = await fetchGooglePhotoResponse(photoUrl);
      if (!image) {
        return res.status(404).json({ message: "Google photo is not available" });
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(image.buffer);
    } catch (error) {
      console.warn("[google/photo] proxy failed:", error);
      res.status(404).json({ message: "Google photo is not available" });
    }
  });

  app.post("/api/search/google-place/:placeId/profile", async (req, res) => {
    try {
      const placeId = String(req.params.placeId || "").trim();
      if (!placeId) {
        return res.status(400).json({ message: "placeId is required" });
      }

      const result = await ensureGoogleRestaurantProfile(placeId);
      const restaurant = result.restaurant as any;
      res.json({
        restaurantId: restaurant.id,
        profileUrl: `/restaurant/${restaurant.id}`,
        created: result.created,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          address: restaurant.address,
          cuisineType: restaurant.cuisineType,
          isVerified: Boolean(restaurant.isVerified),
          isFoodTruck: Boolean(restaurant.isFoodTruck),
          googleRating: restaurant.googleRating,
          googleReviewCount: restaurant.googleReviewCount,
        },
      });
    } catch (error: any) {
      console.error("[search/google-place/profile] failed:", error);
      res.status(500).json({
        message: "Failed to create Google-backed profile",
        error: String(error?.message || error),
      });
    }
  });

  app.get("/api/search/suggestions/:query", async (req, res) => {
    try {
      const { query } = req.params;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const searchTerm = query.toLowerCase();
      const searchValue = `%${searchTerm}%`;
      const suggestionsV2: any[] = [];

      const restaurantRows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          cuisineType: restaurants.cuisineType,
          businessType: restaurants.businessType,
          address: restaurants.address,
          city: restaurants.city,
          state: restaurants.state,
          description: restaurants.description,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          isVerified: restaurants.isVerified,
          googleBusinessStatus: restaurants.googleBusinessStatus,
          profileSource: restaurants.profileSource,
          ownerEmail: users.email,
        })
        .from(restaurants)
        .leftJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.isActive, true),
            or(
              sql`lower(${restaurants.name}) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.cuisineType}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${restaurants.state}, '')) like ${searchValue}`,
            ),
          ),
        )
        .limit(20);

      const rankedRestaurantRows = restaurantRows
        .filter((row: any) =>
          isPublicBusinessVisible({
            name: row.name,
            address: row.address,
            city: row.city,
            state: row.state,
            cuisineType: row.cuisineType,
            businessType: row.businessType,
            description: row.description,
            logoUrl: row.logoUrl,
            coverImageUrl: row.coverImageUrl,
            googleBusinessStatus: row.googleBusinessStatus,
            profileSource: row.profileSource,
            ownerEmail: row.ownerEmail,
          }),
        )
        .sort(
          (a: any, b: any) =>
            Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified)),
        )
        .slice(0, 6);

      const cuisineSuggestions = new Map<string, any>();
      for (const row of rankedRestaurantRows) {
        suggestionsV2.push({
          id: `restaurant-${row.id}`,
          text: row.name,
          type: "restaurant",
          subtitle:
            `${row.cuisineType || row.businessType || "Restaurant"} - ${
              row.address ||
              [row.city, row.state].filter(Boolean).join(", ")
            }`.trim(),
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
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantBusinessType: restaurants.businessType,
          restaurantDescription: restaurants.description,
          restaurantLogoUrl: restaurants.logoUrl,
          restaurantCoverImageUrl: restaurants.coverImageUrl,
          restaurantGoogleBusinessStatus: restaurants.googleBusinessStatus,
          restaurantProfileSource: restaurants.profileSource,
          restaurantOwnerEmail: users.email,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .leftJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(deals.isActive, true),
            eq(restaurants.isActive, true),
            or(
              sql`lower(${deals.title}) like ${searchValue}`,
              sql`lower(${restaurants.name}) like ${searchValue}`,
            ),
          ),
        )
        .limit(12);
      for (const row of dealRows) {
        if (
          !isPublicBusinessVisible({
            name: row.restaurantName,
            address: row.restaurantAddress,
            city: row.restaurantCity,
            state: row.restaurantState,
            cuisineType: row.restaurantCuisineType,
            businessType: row.restaurantBusinessType,
            description: row.restaurantDescription,
            logoUrl: row.restaurantLogoUrl,
            coverImageUrl: row.restaurantCoverImageUrl,
            googleBusinessStatus: row.restaurantGoogleBusinessStatus,
            profileSource: row.restaurantProfileSource,
            ownerEmail: row.restaurantOwnerEmail,
          })
        ) {
          continue;
        }
        suggestionsV2.push({
          id: `deal-${row.id}`,
          text: row.title,
          type: "deal",
          subtitle: `${row.restaurantName || "Restaurant"} - ${row.discountValue}% off`,
        });
        if (suggestionsV2.filter((item) => item.type === "deal").length >= 6) {
          break;
        }
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
            or(
              isNull(videoStories.expiresAt),
              gte(videoStories.expiresAt, nowSql as any),
            ),
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
    } catch (error) {
      console.error("Search suggestions error:", error);
      res.status(500).json({ message: "Failed to get search suggestions" });
    }
  });

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
          unclaimedListings: [],
        });
      }

      const searchTerm = query.toLowerCase();
      const searchValue = `%${searchTerm}%`;
      const searchTerms = buildSearchTerms(query);
      const primaryTerm = firstSearchSegment(query);
      const biasLat = toSearchCoordinate(req.query.lat, 90);
      const biasLng = toSearchCoordinate(req.query.lng, 180);
      const hasBiasCoordinates = biasLat !== null && biasLng !== null;
      const localOnly = parseLocalOnly(req.query.localOnly);
      const localRadiusKm = Math.min(
        MAX_LOCAL_SEARCH_RADIUS_KM,
        Math.max(
          1,
          toPositiveNumber(req.query.radiusKm) ??
            toPositiveNumber(req.query.radius) ??
            DEFAULT_LOCAL_SEARCH_RADIUS_KM,
        ),
      );
      if (localOnly && !hasBiasCoordinates) {
        return res.json({
          query,
          restaurants: [],
          deals: [],
          parkingPassHosts: [],
          videos: [],
          events: [],
          unclaimedListings: [],
        });
      }
      const getDistanceFromSearchBias = (lat: unknown, lng: unknown) =>
        hasBiasCoordinates ? distanceKmBetween(biasLat!, biasLng!, lat, lng) : null;
      const isInsideRequestedLocalRadius = (lat: unknown, lng: unknown) => {
        if (!localOnly || !hasBiasCoordinates) return true;
        const distanceKm = getDistanceFromSearchBias(lat, lng);
        return typeof distanceKm === "number" && distanceKm <= localRadiusKm;
      };

      const restaurantMatches = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          cuisineType: restaurants.cuisineType,
          address: restaurants.address,
          claimedFromImportId: restaurants.claimedFromImportId,
          isActive: restaurants.isActive,
          isFoodTruck: restaurants.isFoodTruck,
          isVerified: restaurants.isVerified,
          city: restaurants.city,
          state: restaurants.state,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          businessType: restaurants.businessType,
          description: restaurants.description,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          googlePhotos: restaurants.googlePhotos,
          facebookCoverUrl: restaurants.facebookCoverUrl,
          facebookPhotos: restaurants.facebookPhotos,
          operatingHours: restaurants.operatingHours,
          googleRating: restaurants.googleRating,
          googleReviewCount: restaurants.googleReviewCount,
          googleBusinessStatus: restaurants.googleBusinessStatus,
          profileSource: restaurants.profileSource,
          ownerEmail: users.email,
        })
        .from(restaurants)
        .leftJoin(users, eq(restaurants.ownerId, users.id));
      const restaurantsBase = restaurantMatches
        .map((restaurant: any) => {
          restaurant = sanitizeGoogleRestaurantMedia(restaurant) as any;
          if (!restaurant?.isActive) return false;
          if (!isPublicBusinessVisible(restaurant)) return false;
          const name = String(restaurant.name || "").toLowerCase();
          const cuisine = String(restaurant.cuisineType || "").toLowerCase();
          const address = String(restaurant.address || "").toLowerCase();
          const score = scoreSearchFields(
            [
              name,
              cuisine,
              address,
              restaurant.city,
              restaurant.state,
              restaurant.businessType,
            ],
            searchTerms,
            primaryTerm,
          );
          if (score <= 0) return null;

          const distanceKm = hasBiasCoordinates
            ? distanceKmBetween(
                biasLat!,
                biasLng!,
                restaurant.latitude,
                restaurant.longitude,
              )
            : null;
          if (
            localOnly &&
            hasBiasCoordinates &&
            (distanceKm === null || distanceKm > localRadiusKm)
          ) {
            return null;
          }

          return {
            restaurant,
            distanceKm,
            score:
              score +
              (restaurant?.isVerified ? 3 : 0) +
              (distanceKm === null ? 0 : Math.max(0, 20 - distanceKm / 4)),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          if (localOnly && hasBiasCoordinates) {
            const aDistance = Number.isFinite(a.distanceKm)
              ? Number(a.distanceKm)
              : Number.POSITIVE_INFINITY;
            const bDistance = Number.isFinite(b.distanceKm)
              ? Number(b.distanceKm)
              : Number.POSITIVE_INFINITY;
            if (Math.abs(aDistance - bDistance) > 0.1) {
              return aDistance - bDistance;
            }
          }
          return b.score - a.score;
        })
        .slice(0, 12)
        .map(({ restaurant, distanceKm }: any) => ({
          id: restaurant.id,
          name: restaurant.name,
          cuisineType: restaurant.cuisineType,
          address: restaurant.address,
          city: restaurant.city,
          state: restaurant.state,
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          businessType: restaurant.businessType,
          description: restaurant.description,
          logoUrl: restaurant.logoUrl,
          coverImageUrl: restaurant.coverImageUrl,
          googlePhotos: restaurant.googlePhotos,
          facebookCoverUrl: restaurant.facebookCoverUrl,
          facebookPhotos: restaurant.facebookPhotos,
          isFoodTruck: Boolean(restaurant.isFoodTruck),
          isVerified: Boolean(restaurant.isVerified),
          operatingHours:
            restaurant.operatingHours ?? restaurant.businessHours ?? null,
          googleRating: restaurant.googleRating,
          googleReviewCount: restaurant.googleReviewCount,
          distance:
            typeof distanceKm === "number"
              ? Number(distanceKm.toFixed(2))
              : undefined,
        }));

      let restaurantsOut = await Promise.all(
        restaurantsBase.map(async (restaurant: any) => {
          let rating: number | null = null;
          try {
            const avg = await storage.getRestaurantAverageRating(
              String(restaurant.id),
            );
            if (Number.isFinite(avg) && avg > 0) {
              rating = Number(avg);
            }
          } catch {
            rating = null;
          }

          return {
            ...restaurant,
            rating:
              rating ??
              (restaurant.googleRating
                ? Number(restaurant.googleRating)
                : null),
          };
        }),
      );

      let dealsOut: any[] = [];
      try {
        dealsOut = (
          await storage.searchDeals({
            query,
            sortBy: "relevance",
            latitude: localOnly && hasBiasCoordinates ? biasLat! : undefined,
            longitude: localOnly && hasBiasCoordinates ? biasLng! : undefined,
            radius: localOnly && hasBiasCoordinates ? localRadiusKm : 9999,
          })
        ).slice(0, 12);
      } catch (dealSearchError) {
        console.warn(
          "[search] deals lookup failed; returning place results without deals:",
          dealSearchError,
        );
      }

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
          ),
        )
        .orderBy(desc(eventSeries.updatedAt))
        .limit(300);

      const bestHostById = new Map<string, any>();
      for (const row of hostSeriesRows) {
        const hostId = String((row as any).hostId);
        if (!bestHostById.has(hostId)) bestHostById.set(hostId, row);
      }

      const parkingPassHostsOut = Array.from(bestHostById.values())
        .map((row: any) => {
          const matchScore = scoreSearchFields(
            [row.businessName, row.address, row.city, row.state],
            searchTerms,
            primaryTerm,
          );
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
            matchScore,
          };
        })
        .filter(
          (row: any) =>
            Array.isArray(row.qualityFlags) &&
            row.qualityFlags.length === 0 &&
            Number(row.matchScore || 0) > 0 &&
            isInsideRequestedLocalRadius(row.latitude, row.longitude),
        )
        .sort((a: any, b: any) => b.matchScore - a.matchScore)
        .slice(0, 12);

      const nowSql = sql`NOW()`;
      const videoRows = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          description: videoStories.description,
          thumbnailUrl: videoStories.thumbnailUrl,
          restaurantId: videoStories.restaurantId,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantBusinessType: restaurants.businessType,
          restaurantLogoUrl: restaurants.logoUrl,
          restaurantCoverImageUrl: restaurants.coverImageUrl,
          restaurantGooglePhotos: restaurants.googlePhotos,
          restaurantFacebookCoverUrl: restaurants.facebookCoverUrl,
          restaurantFacebookPhotos: restaurants.facebookPhotos,
          restaurantProfileSource: restaurants.profileSource,
          restaurantGoogleBusinessStatus: restaurants.googleBusinessStatus,
          restaurantOwnerEmail: users.email,
          restaurantLatitude: restaurants.latitude,
          restaurantLongitude: restaurants.longitude,
          createdAt: videoStories.createdAt,
        })
        .from(videoStories)
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .leftJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(videoStories.status, "ready"),
            or(
              isNull(videoStories.expiresAt),
              gte(videoStories.expiresAt, nowSql as any),
            ),
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
      const videosOut = videoRows.filter((row: any) => {
        if (
          row.restaurantId &&
          !isPublicBusinessVisible({
            name: row.restaurantName,
            address: row.restaurantAddress,
            city: row.restaurantCity,
            state: row.restaurantState,
            cuisineType: row.restaurantCuisineType,
            businessType: row.restaurantBusinessType,
            logoUrl: row.restaurantLogoUrl,
            coverImageUrl: row.restaurantCoverImageUrl,
            googleBusinessStatus: row.restaurantGoogleBusinessStatus,
            profileSource: row.restaurantProfileSource,
            ownerEmail: row.restaurantOwnerEmail,
          })
        ) {
          return false;
        }
        return isInsideRequestedLocalRadius(
          row.restaurantLatitude,
          row.restaurantLongitude,
        );
      });

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
          hostSpotImageUrl: hosts.spotImageUrl,
          hostLatitude: hosts.latitude,
          hostLongitude: hosts.longitude,
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
      const eventsOut = eventsRows.filter((row: any) =>
        isInsideRequestedLocalRadius(row.hostLatitude, row.hostLongitude),
      );

      // ----- Unclaimed listings (existing imports only; search stays read-only) -----
      const unclaimedSearchValue = `%${searchTerm}%`;
      const existingUnclaimed = await db
        .select({
          id: truckImportListings.id,
          name: truckImportListings.name,
          address: truckImportListings.address,
          city: truckImportListings.city,
          state: truckImportListings.state,
          latitude: truckImportListings.latitude,
          longitude: truckImportListings.longitude,
          phone: truckImportListings.phone,
          cuisineType: truckImportListings.cuisineType,
          externalId: truckImportListings.externalId,
          confidenceScore: truckImportListings.confidenceScore,
          email: truckImportListings.email,
          invitedUserId: truckImportListings.invitedUserId,
          source: truckImportListings.source,
          status: truckImportListings.status,
        })
        .from(truckImportListings)
        .where(
          and(
            inArray(truckImportListings.status, [
              "unclaimed",
              "claim_requested",
            ] as any),
            or(
              sql`lower(${truckImportListings.name}) like ${unclaimedSearchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${unclaimedSearchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${unclaimedSearchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${unclaimedSearchValue}`,
            ),
          ),
        )
        .orderBy(desc(truckImportListings.confidenceScore))
        .limit(6);

      let unclaimedOut = existingUnclaimed
        .map((row: any) => {
          const distanceKm = getDistanceFromSearchBias(
            row.latitude,
            row.longitude,
          );

          return {
            id: row.id,
            name: row.name,
            address: row.address,
            city: row.city,
            state: row.state,
            latitude: row.latitude,
            longitude: row.longitude,
            cuisineType: row.cuisineType,
            distance:
              typeof distanceKm === "number"
                ? Number(distanceKm.toFixed(2))
                : undefined,
            source: row.source || null,
            status: row.status || "unclaimed",
            autoSeeded: false,
          };
        })
        .filter((row: any) =>
          isInsideRequestedLocalRadius(row.latitude, row.longitude),
        );

      // If nothing matched locally, Google Places can create a generated
      // restaurant profile only after it gives us a concrete food-business
      // Place ID. Plain search text must never become a restaurant row.
      const LOOKUP_MIN_QUERY_LEN = 5;
      const hasPlacesApiKey = Boolean(
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_PLACES_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.VITE_GOOGLE_MAPS_WEB_API_KEY,
      );
      const shouldAttemptExternalLookup =
        restaurantsOut.length === 0 &&
        unclaimedOut.length === 0 &&
        query.length >= LOOKUP_MIN_QUERY_LEN &&
        !isBroadFoodDiscoveryQuery(query);

      if (shouldAttemptExternalLookup) {
        try {
          if (hasPlacesApiKey) {
            const candidates = await searchPlacesFreeText(query, 5, {
              latitude: biasLat,
              longitude: biasLng,
            });
            const foodCandidate = candidates.find((candidate) =>
              shouldAutoPopulateGoogleProfile(candidate, query, primaryTerm),
            );

            if (foodCandidate) {
              const candidateDistanceKm =
                hasBiasCoordinates && localOnly
                  ? distanceKmBetween(
                      biasLat!,
                      biasLng!,
                      foodCandidate.latitude,
                      foodCandidate.longitude,
                    )
                  : null;
              if (
                localOnly &&
                hasBiasCoordinates &&
                (candidateDistanceKm === null ||
                  candidateDistanceKm > localRadiusKm)
              ) {
                res.setHeader(
                  "X-MealScout-Auto-Profile",
                  "skipped-out-of-radius",
                );
              } else {
                try {
                  const result = await ensureGoogleRestaurantProfile(
                    foodCandidate.placeId,
                  );
                  const restaurant = result.restaurant as any;
                  const distanceKm =
                    hasBiasCoordinates && localOnly
                      ? distanceKmBetween(
                          biasLat!,
                          biasLng!,
                          restaurant?.latitude,
                          restaurant?.longitude,
                        )
                      : null;
                  if (
                    restaurant?.isActive !== false &&
                    isPublicBusinessVisible(restaurant) &&
                    (!localOnly ||
                      !hasBiasCoordinates ||
                      (typeof distanceKm === "number" &&
                        distanceKm <= localRadiusKm))
                  ) {
                    let rating: number | null = null;
                    try {
                      const avg = await storage.getRestaurantAverageRating(
                        String(restaurant.id),
                      );
                      if (Number.isFinite(avg) && avg > 0) {
                        rating = Number(avg);
                      }
                    } catch {
                      rating = null;
                    }

                    restaurantsOut = [
                      {
                        id: restaurant.id,
                        name: restaurant.name,
                        cuisineType: restaurant.cuisineType,
                        address: restaurant.address,
                        city: restaurant.city,
                        state: restaurant.state,
                        latitude: restaurant.latitude,
                        longitude: restaurant.longitude,
                        businessType: restaurant.businessType,
                        description: restaurant.description,
                        logoUrl: restaurant.logoUrl,
                        coverImageUrl: restaurant.coverImageUrl,
                        googlePhotos: restaurant.googlePhotos,
                        facebookCoverUrl: restaurant.facebookCoverUrl,
                        facebookPhotos: restaurant.facebookPhotos,
                        isFoodTruck: Boolean(restaurant.isFoodTruck),
                        isVerified: Boolean(restaurant.isVerified),
                        operatingHours:
                          restaurant.operatingHours ??
                          restaurant.businessHours ??
                          null,
                        googleRating: restaurant.googleRating,
                        googleReviewCount: restaurant.googleReviewCount,
                        rating:
                          rating ??
                          (restaurant.googleRating
                            ? Number(restaurant.googleRating)
                            : null),
                        autoPopulated: true,
                        created: result.created,
                      },
                    ];
                    res.setHeader("X-MealScout-Auto-Profile", "google");
                  }
                } catch (profileErr) {
                  console.warn(
                    "[search] Google profile creation failed:",
                    profileErr,
                  );
                }
              }

              if (restaurantsOut.length === 0) {
                const externalId = `google:${foodCandidate.placeId}`;
                const [existing] = await db
                  .select({
                    id: truckImportListings.id,
                    name: truckImportListings.name,
                    address: truckImportListings.address,
                    city: truckImportListings.city,
                    state: truckImportListings.state,
                    source: truckImportListings.source,
                    status: truckImportListings.status,
                  })
                  .from(truckImportListings)
                  .where(eq(truckImportListings.externalId, externalId))
                  .limit(1);

                if (existing) {
                  unclaimedOut = [
                    {
                      id: existing.id,
                      name: existing.name,
                      address: existing.address,
                      city: existing.city,
                      state: existing.state,
                      source: existing.source || "google_places",
                      status: existing.status || "unclaimed",
                      autoSeeded: false,
                    },
                  ];
                }
              }
            }
          }
        } catch (lookupErr) {
          console.warn("[search] external claimable lookup failed:", lookupErr);
        }
      }

      res.json({
        query,
        restaurants: restaurantsOut,
        deals: dealsOut,
        parkingPassHosts: parkingPassHostsOut,
        videos: videosOut,
        events: eventsOut,
        unclaimedListings: unclaimedOut,
      });
    } catch (error) {
      console.error("Unified search error:", error);
      res.status(500).json({ message: "Failed to search" });
    }
  });
}
