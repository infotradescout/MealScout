import type { Express } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { computeParkingPassQualityFlags } from "../services/parkingPassQuality";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import { searchPlacesFreeText } from "../services/googleProfileService";
import {
  deals,
  eventSeries,
  events,
  hosts,
  restaurants,
  truckImportListings,
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

const parseUSCityStateFromFormatted = (
  formatted: string,
): { city: string | null; state: string | null } => {
  if (!formatted) return { city: null, state: null };
  const m = formatted.match(
    /,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*,?\s*(?:USA|United States)?\s*$/,
  );
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  return { city: null, state: null };
};


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

export function registerPublicSearchRoutes(app: Express) {
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
          address: restaurants.address,
          isVerified: restaurants.isVerified,
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
        .limit(20);

      const rankedRestaurantRows = restaurantRows
        .filter((row: any) =>
          isPublicBusinessVisible({
            name: row.name,
            address: row.address,
            cuisineType: row.cuisineType,
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

      const restaurantMatches = await storage.getAllRestaurants();
      const restaurantsBase = restaurantMatches
        .map((restaurant: any) => {
          if (!restaurant?.isActive) return false;
          if (!isPublicBusinessVisible(restaurant)) return false;
          const name = String(restaurant.name || "").toLowerCase();
          const cuisine = String(restaurant.cuisineType || "").toLowerCase();
          const address = String(restaurant.address || "").toLowerCase();
          const score = scoreSearchFields(
            [name, cuisine, address],
            searchTerms,
            primaryTerm,
          );
          if (score <= 0) return null;
          return {
            restaurant,
            score: score + (restaurant?.isVerified ? 3 : 0),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 12)
        .map(({ restaurant }: any) => ({
          id: restaurant.id,
          name: restaurant.name,
          cuisineType: restaurant.cuisineType,
          address: restaurant.address,
          isFoodTruck: Boolean(restaurant.isFoodTruck),
          isVerified: Boolean(restaurant.isVerified),
          operatingHours:
            restaurant.operatingHours ??
            restaurant.businessHours ??
            null,
        }));

      const restaurantsOut = await Promise.all(
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
            rating,
          };
        }),
      );

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
            Number(row.matchScore || 0) > 0,
        )
        .sort((a: any, b: any) => b.matchScore - a.matchScore)
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

      // ----- Unclaimed listings (existing + auto-seed via Google Places) -----
      const unclaimedSearchValue = `%${searchTerm}%`;
      const existingUnclaimed = await db
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

      let unclaimedOut = existingUnclaimed.map((row: any) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        city: row.city,
        state: row.state,
        source: row.source || null,
        status: row.status || "unclaimed",
        autoSeeded: false,
      }));

      // If nothing matched in restaurants OR existing unclaimed listings, and
      // the query is substantial enough, ask Google Places and seed an unclaimed
      // profile so the user sees the place they were looking for and can claim it.
      const SEED_MIN_QUERY_LEN = 5;
      const shouldAutoSeed =
        restaurantsOut.length === 0 &&
        unclaimedOut.length === 0 &&
        query.length >= SEED_MIN_QUERY_LEN &&
        Boolean(
          process.env.GOOGLE_MAPS_API_KEY ||
            process.env.GOOGLE_PLACES_API_KEY ||
            process.env.GOOGLE_API_KEY,
        );

      if (shouldAutoSeed) {
        try {
          const candidates = await searchPlacesFreeText(query, 5);
          const foodCandidate = candidates.find((c) =>
            c.types.some((t) => FOOD_PLACE_TYPE_ALLOWLIST.has(t)),
          );

          if (foodCandidate) {
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
            } else {
              const { city, state } = parseUSCityStateFromFormatted(
                foodCandidate.formattedAddress,
              );
              const insertValues: any = {
                source: "google_places",
                externalId,
                name: foodCandidate.name,
                address: foodCandidate.formattedAddress || foodCandidate.name,
                city,
                state,
                confidenceScore: Math.min(
                  100,
                  Math.round(
                    50 +
                      Math.min(20, (foodCandidate.userRatingCount || 0) / 50) +
                      (foodCandidate.rating || 0) * 5,
                  ),
                ),
                status: "unclaimed",
                rawData: {
                  placeId: foodCandidate.placeId,
                  types: foodCandidate.types,
                  rating: foodCandidate.rating,
                  userRatingCount: foodCandidate.userRatingCount,
                  seededFromQuery: query,
                },
              };
              if (
                Number.isFinite(foodCandidate.latitude) &&
                Number.isFinite(foodCandidate.longitude)
              ) {
                insertValues.latitude = String(foodCandidate.latitude);
                insertValues.longitude = String(foodCandidate.longitude);
              }

              const [inserted] = await db
                .insert(truckImportListings)
                .values(insertValues)
                .returning({
                  id: truckImportListings.id,
                  name: truckImportListings.name,
                  address: truckImportListings.address,
                  city: truckImportListings.city,
                  state: truckImportListings.state,
                  source: truckImportListings.source,
                  status: truckImportListings.status,
                });

              if (inserted) {
                unclaimedOut = [
                  {
                    id: inserted.id,
                    name: inserted.name,
                    address: inserted.address,
                    city: inserted.city,
                    state: inserted.state,
                    source: inserted.source || "google_places",
                    status: inserted.status || "unclaimed",
                    autoSeeded: true,
                  },
                ];
              }
            }
          }
        } catch (seedErr) {
          console.warn("[search] auto-seed unclaimed listing failed:", seedErr);
        }
      }

      res.json({
        query,
        restaurants: restaurantsOut,
        deals: dealsOut,
        parkingPassHosts: parkingPassHostsOut,
        videos: videoRows,
        events: eventsRows,
        unclaimedListings: unclaimedOut,
      });
    } catch (error) {
      console.error("Unified search error:", error);
      res.status(500).json({ message: "Failed to search" });
    }
  });
}
