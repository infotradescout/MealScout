import type { Express } from "express";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { computeParkingPassQualityFlags } from "../services/parkingPassQuality";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  deals,
  eventSeries,
  events,
  hosts,
  restaurants,
  videoStories,
} from "@shared/schema";
import {
  expandScoutSearchTerms,
  scoutSearchRelevanceScore,
} from "@shared/scoutSearchIntent";
import { recordInternalSearchOutcome } from "../services/discoveryObservatory";
import {
  AGGREGATE_SEARCH_DEAL_LIMIT,
  AGGREGATE_SEARCH_EVENT_LIMIT,
  AGGREGATE_SEARCH_HOST_LIMIT,
  AGGREGATE_SEARCH_RESTAURANT_CANDIDATE_LIMIT,
  AGGREGATE_SEARCH_RESTAURANT_LIMIT,
  AGGREGATE_SEARCH_VIDEO_LIMIT,
  MAX_SEARCH_RESPONSE_BYTES,
  PUBLIC_SEARCH_TIMEOUT_MS,
  clampJsonByBucketArrays,
  isDeadlineError,
  withDeadline,
} from "@shared/searchResponseBounds";

function publicRestaurantActivityScore(restaurant: any): number {
  return (
    Number(restaurant.homeRankingScore || restaurant.rankingScore || 0) * 10 +
    Number(restaurant.communityActivityCount || 0) * 5 +
    Number(restaurant.recommendationCount || 0) * 4 +
    Number(restaurant.favoriteCount || 0) * 3 +
    Number(restaurant.followCount || 0) * 2 +
    Number(restaurant.activeDealCount || restaurant.activeDealsCount || 0) * 4
  );
}

function restaurantSearchMatchSql(searchTerms: string[]) {
  const terms = searchTerms.length > 0 ? searchTerms : [""];
  return or(
    ...terms.map((term) => {
      const like = `%${term}%`;
      return or(
        sql`lower(${restaurants.name}) like ${like}`,
        sql`lower(coalesce(${restaurants.cuisineType}, '')) like ${like}`,
        sql`lower(coalesce(${restaurants.address}, '')) like ${like}`,
        sql`lower(coalesce(${restaurants.city}, '')) like ${like}`,
        sql`lower(coalesce(${restaurants.state}, '')) like ${like}`,
        sql`lower(coalesce(${restaurants.description}, '')) like ${like}`,
      );
    }),
  );
}

export async function searchPublicRestaurantResults(
  database: any,
  query: string,
) {
  const searchTerm = query.trim().toLowerCase();
  const searchTerms = expandScoutSearchTerms(searchTerm);
  const searchValue = `%${searchTerm}%`;
  const searchPrefixValue = `${searchTerm}%`;

  // The phrase order must run in SQL before the cap. Otherwise broad imported
  // token matches can discard the exact business before JS relevance runs.
  const restaurantMatches = await database
    .select({
      id: restaurants.id,
      name: restaurants.name,
      cuisineType: restaurants.cuisineType,
      address: restaurants.address,
      city: restaurants.city,
      state: restaurants.state,
      description: restaurants.description,
      logoUrl: restaurants.logoUrl,
      coverImageUrl: restaurants.coverImageUrl,
      businessType: restaurants.businessType,
      isFoodTruck: restaurants.isFoodTruck,
      isVerified: restaurants.isVerified,
      rankingScore: restaurants.rankingScore,
    })
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isActive, true),
        restaurantSearchMatchSql(searchTerms),
      ),
    )
    .orderBy(
      asc(sql`case
        when lower(${restaurants.name}) = ${searchTerm} then 0
        when lower(${restaurants.name}) like ${searchPrefixValue} then 1
        when lower(${restaurants.name}) like ${searchValue} then 2
        else 3
      end`),
      desc(restaurants.isVerified),
      desc(restaurants.rankingScore),
      asc(restaurants.name),
    )
    .limit(AGGREGATE_SEARCH_RESTAURANT_CANDIDATE_LIMIT);

  return restaurantMatches
    .filter((restaurant: any) => {
      if (!isPublicBusinessVisible(restaurant)) return false;
      const haystack = [
        restaurant.name,
        restaurant.cuisineType,
        restaurant.address,
        restaurant.city,
        restaurant.state,
        restaurant.description,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return searchTerms.some((term) => haystack.includes(term));
    })
    .sort((a: any, b: any) => {
      const relevanceDelta =
        scoutSearchRelevanceScore(b, searchTerm) -
        scoutSearchRelevanceScore(a, searchTerm);
      if (relevanceDelta !== 0) return relevanceDelta;

      const verifiedDelta =
        Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified));
      if (verifiedDelta !== 0) return verifiedDelta;

      const activityDelta =
        publicRestaurantActivityScore(b) - publicRestaurantActivityScore(a);
      if (activityDelta !== 0) return activityDelta;

      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .slice(0, AGGREGATE_SEARCH_RESTAURANT_LIMIT)
    .map((restaurant: any) => ({
      id: restaurant.id,
      name: restaurant.name,
      cuisineType: restaurant.cuisineType,
      address: restaurant.address,
      city: restaurant.city || null,
      state: restaurant.state || null,
      slug: null,
      description: restaurant.description || null,
      logoUrl: restaurant.logoUrl || null,
      coverImageUrl: restaurant.coverImageUrl || null,
      imageUrl: restaurant.coverImageUrl || restaurant.logoUrl || null,
      businessType: restaurant.businessType || null,
      isFoodTruck: Boolean(restaurant.isFoodTruck),
      isVerified: Boolean(restaurant.isVerified),
      activeDealCount: 0,
      favoriteCount: 0,
      followCount: 0,
      recommendationCount: 0,
      communityActivityCount: 0,
      homeRankingScore: Number(restaurant.rankingScore || 0),
    }));
}

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
        .limit(6);

      const cuisineSuggestions = new Map<string, any>();
      for (const row of restaurantRows) {
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
        const aExact = String(a.text || "").toLowerCase().startsWith(searchTerm)
          ? 1
          : 0;
        const bExact = String(b.text || "").toLowerCase().startsWith(searchTerm)
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
        });
      }

      const payload = await withDeadline(
        (async () => {
          const searchTerm = query.toLowerCase();
          const searchValue = `%${searchTerm}%`;
          const restaurantsOut = await searchPublicRestaurantResults(db, query);

          const dealsOut = (
            await storage.searchDeals({
              query,
              sortBy: "relevance",
              radius: 9999,
            })
          ).slice(0, AGGREGATE_SEARCH_DEAL_LIMIT);

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
                or(
                  sql`lower(${hosts.businessName}) like ${searchValue}`,
                  sql`lower(${hosts.address}) like ${searchValue}`,
                  sql`lower(coalesce(${hosts.city}, '')) like ${searchValue}`,
                  sql`lower(coalesce(${hosts.state}, '')) like ${searchValue}`,
                ),
              ),
            )
            .orderBy(desc(eventSeries.updatedAt))
            .limit(50);

          const bestHostById = new Map<string, any>();
          for (const row of hostSeriesRows) {
            const hostId = String((row as any).hostId);
            if (!bestHostById.has(hostId)) bestHostById.set(hostId, row);
          }

          const parkingPassHostsOut = Array.from(bestHostById.values())
            .map((row: any) => {
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
              };
            })
            .filter(
              (row: any) =>
                Array.isArray(row.qualityFlags) &&
                row.qualityFlags.length === 0,
            )
            .slice(0, AGGREGATE_SEARCH_HOST_LIMIT);

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
            .leftJoin(
              restaurants,
              eq(videoStories.restaurantId, restaurants.id),
            )
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
            .limit(AGGREGATE_SEARCH_VIDEO_LIMIT);

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
            .limit(AGGREGATE_SEARCH_EVENT_LIMIT);

          return {
            query,
            restaurants: restaurantsOut,
            deals: dealsOut,
            parkingPassHosts: parkingPassHostsOut,
            videos: videoRows,
            events: eventsRows,
          };
        })(),
        PUBLIC_SEARCH_TIMEOUT_MS,
        "public search",
      );

      const bounded = clampJsonByBucketArrays(
        payload,
        MAX_SEARCH_RESPONSE_BYTES,
      );
      if (bounded.truncated) {
        res.setHeader("X-MealScout-Search-Truncated", "1");
        res.setHeader("X-MealScout-Search-Bytes", String(bounded.bytes));
      }
      const resultCount = [
        payload.restaurants,
        payload.deals,
        payload.parkingPassHosts,
        payload.videos,
        payload.events,
      ].reduce(
        (total, bucket) => total + (Array.isArray(bucket) ? bucket.length : 0),
        0,
      );
      await recordInternalSearchOutcome({ req, query, resultCount }).catch(
        (observatoryError) => {
          console.error(
            "Failed to record internal search outcome:",
            observatoryError,
          );
        },
      );
      res.json(bounded.value);
    } catch (error) {
      if (isDeadlineError(error)) {
        console.error("Unified search timeout:", error);
        return res.status(504).json({
          message: "Search timed out",
          timeoutMs: PUBLIC_SEARCH_TIMEOUT_MS,
        });
      }
      console.error("Unified search error:", error);
      res.status(500).json({ message: "Failed to search" });
    }
  });
}
