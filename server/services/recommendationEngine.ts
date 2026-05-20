import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { events, hosts, restaurants } from "@shared/schema";

export type RecommendationEntityType =
  | "truck"
  | "restaurant"
  | "deal"
  | "event"
  | "host_spot"
  | "caterer"
  | "private_chef"
  | "supplier";

export type LocalRecommendation = {
  id: string;
  entityType: RecommendationEntityType;
  entityId: string;
  score: number;
  reasons: string[];
  availability: string;
  source: string;
  distanceMiles?: number;
  freshnessLabel?: string;
  metadata?: Record<string, unknown>;
};

type BuildLocalRecommendationsInput = {
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
  userId?: string | null;
};

type RestaurantSignalRow = {
  restaurantId: string;
  recommendationCount: number;
  reactionCount: number;
  shareCount: number;
  favoriteCount: number;
  followCount: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const milesBetween = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 3958.7613 * c;
};

const dedupeReasons = (reasons: string[]) =>
  Array.from(new Set(reasons.filter((reason) => reason.trim().length > 0)));

const toRows = <T>(result: unknown): T[] => {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
};

async function getRestaurantSignals(): Promise<Map<string, RestaurantSignalRow>> {
  const result = await db.execute(sql`
    with recs as (
      select
        rur.restaurant_id,
        count(*)::int as recommendation_count
      from restaurant_user_recommendations rur
      group by rur.restaurant_id
    ),
    reacts as (
      select
        rur.restaurant_id,
        count(*)::int as reaction_count
      from recommendation_reactions rr
      inner join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
      group by rur.restaurant_id
    ),
    shares as (
      select
        rur.restaurant_id,
        count(*)::int as share_count
      from recommendation_shares rs
      inner join restaurant_user_recommendations rur on rur.id = rs.recommendation_id
      group by rur.restaurant_id
    ),
    favs as (
      select
        rf.restaurant_id,
        count(*)::int as favorite_count
      from restaurant_favorites rf
      group by rf.restaurant_id
    ),
    follows as (
      select
        rfo.restaurant_id,
        count(*)::int as follow_count
      from restaurant_follows rfo
      group by rfo.restaurant_id
    )
    select
      r.id as "restaurantId",
      coalesce(recs.recommendation_count, 0) as "recommendationCount",
      coalesce(reacts.reaction_count, 0) as "reactionCount",
      coalesce(shares.share_count, 0) as "shareCount",
      coalesce(favs.favorite_count, 0) as "favoriteCount",
      coalesce(follows.follow_count, 0) as "followCount"
    from restaurants r
    left join recs on recs.restaurant_id = r.id
    left join reacts on reacts.restaurant_id = r.id
    left join shares on shares.restaurant_id = r.id
    left join favs on favs.restaurant_id = r.id
    left join follows on follows.restaurant_id = r.id
    where r.is_active = true
  `);

  const map = new Map<string, RestaurantSignalRow>();
  for (const row of toRows<RestaurantSignalRow>(result)) {
    map.set(String(row.restaurantId), {
      restaurantId: String(row.restaurantId),
      recommendationCount: Number(row.recommendationCount || 0),
      reactionCount: Number(row.reactionCount || 0),
      shareCount: Number(row.shareCount || 0),
      favoriteCount: Number(row.favoriteCount || 0),
      followCount: Number(row.followCount || 0),
    });
  }
  return map;
}

async function getUserRestaurantSets(userId?: string | null): Promise<{
  follows: Set<string>;
  favorites: Set<string>;
}> {
  if (!userId) return { follows: new Set<string>(), favorites: new Set<string>() };

  const [followsResult, favoritesResult] = await Promise.all([
    db.execute(sql`
      select restaurant_id as "restaurantId"
      from restaurant_follows
      where user_id = ${userId}
    `),
    db.execute(sql`
      select restaurant_id as "restaurantId"
      from restaurant_favorites
      where user_id = ${userId}
    `),
  ]);

  return {
    follows: new Set(
      toRows<{ restaurantId: string }>(followsResult).map((row) =>
        String(row.restaurantId),
      ),
    ),
    favorites: new Set(
      toRows<{ restaurantId: string }>(favoritesResult).map((row) =>
        String(row.restaurantId),
      ),
    ),
  };
}

const isRestaurantOpenNow = (restaurant: any): boolean => {
  const explicit = [
    restaurant?.isOpen,
    restaurant?.openNow,
    restaurant?.currentlyOpen,
    restaurant?.isCurrentlyOpen,
  ].find((value) => typeof value === "boolean");
  if (typeof explicit === "boolean") return explicit;
  const status = String(
    restaurant?.openStatus || restaurant?.status || restaurant?.hoursStatus || "",
  )
    .trim()
    .toLowerCase();
  if (!status) return false;
  return status.includes("open") && !status.includes("closed");
};

const isTruckServingNow = (truck: any): boolean => {
  const explicit = [
    truck?.isOpen,
    truck?.openNow,
    truck?.currentlyOpen,
    truck?.isServing,
    truck?.servingNow,
    truck?.availableNow,
  ].find((value) => typeof value === "boolean");
  if (typeof explicit === "boolean") return explicit;
  return truck?.mobileOnline !== false;
};

export async function buildLocalRecommendations(
  input: BuildLocalRecommendationsInput,
): Promise<LocalRecommendation[]> {
  const lat = clamp(input.lat, -90, 90);
  const lng = clamp(input.lng, -180, 180);
  const radiusKm = clamp(input.radiusKm, 1, 100);
  const limit = clamp(input.limit, 1, 80);

  const [nearbyRestaurants, activeDeals, liveTrucks, publicEvents, restaurantSignals, userSets] =
    await Promise.all([
      storage.getNearbyRestaurants(lat, lng, radiusKm),
      storage.getActiveDeals(),
      storage.getLiveTrucksNearby(lat, lng, radiusKm),
      db
        .select({
          id: events.id,
          hostId: events.hostId,
          name: events.name,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          status: events.status,
          requiresPayment: events.requiresPayment,
          updatedAt: events.updatedAt,
          lastConfirmedAt: events.lastConfirmedAt,
          bookedRestaurantId: events.bookedRestaurantId,
          hostName: hosts.businessName,
          hostLat: hosts.latitude,
          hostLng: hosts.longitude,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            isNotNull(events.hostId),
            gte(events.date, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        )
        .orderBy(desc(events.updatedAt))
        .limit(300),
      getRestaurantSignals(),
      getUserRestaurantSets(input.userId),
    ]);

  const recommendations: LocalRecommendation[] = [];

  for (const restaurant of nearbyRestaurants as any[]) {
    const restaurantId = String(restaurant.id);
    const latValue = toFiniteNumber(restaurant.latitude ?? restaurant.lat);
    const lngValue = toFiniteNumber(restaurant.longitude ?? restaurant.lng);
    if (latValue === null || lngValue === null) continue;

    const distanceMiles = milesBetween(lat, lng, latValue, lngValue);
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371) continue;

    const signals = restaurantSignals.get(restaurantId);
    const openNow = isRestaurantOpenNow(restaurant);
    const dealCount = Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0);
    const reasons = dedupeReasons([
      openNow ? "Open now" : "",
      dealCount > 0 ? "Deal today" : "",
      (signals?.recommendationCount || 0) > 0 ? "Recommended by locals" : "",
      (signals?.favoriteCount || 0) + (signals?.followCount || 0) > 2 ? "Popular nearby" : "",
      userSets.follows.has(restaurantId) ? "You follow this" : "",
      userSets.favorites.has(restaurantId) ? "You saved this" : "",
    ]);

    const score =
      (openNow ? 36 : 0) +
      Math.min(18, (signals?.recommendationCount || 0) * 2) +
      Math.min(12, (signals?.shareCount || 0) * 2 + (signals?.reactionCount || 0)) +
      Math.min(18, (signals?.favoriteCount || 0) + (signals?.followCount || 0)) +
      Math.min(12, dealCount * 6) +
      Math.max(0, 16 - distanceMiles * 2.2);

    recommendations.push({
      id: `restaurant:${restaurantId}`,
      entityType: "restaurant",
      entityId: restaurantId,
      score,
      reasons: reasons.length > 0 ? reasons : ["Serving nearby"],
      availability: openNow ? "open_now" : "nearby",
      source: "restaurant_signals",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: openNow ? "Open now" : undefined,
      metadata: {
        name: restaurant.businessName || restaurant.name || "Restaurant",
        activeDealsCount: dealCount,
      },
    });
  }

  for (const truck of liveTrucks as any[]) {
    const truckId = String(truck.id);
    const latValue = toFiniteNumber(truck.latitude ?? truck.lat);
    const lngValue = toFiniteNumber(truck.longitude ?? truck.lng);
    if (latValue === null || lngValue === null) continue;

    const distanceMiles = milesBetween(lat, lng, latValue, lngValue);
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371) continue;

    const servingNow = isTruckServingNow(truck);
    const reasons = dedupeReasons([
      servingNow ? "Serving nearby" : "",
      servingNow ? "Open now" : "",
      Number(truck.activeDealCount || 0) > 0 ? "Deal today" : "",
      "Popular nearby",
    ]);

    const score =
      (servingNow ? 46 : 22) +
      Math.min(12, Number(truck.activeDealCount || 0) * 6) +
      Math.max(0, 18 - distanceMiles * 2.4);

    recommendations.push({
      id: `truck:${truckId}`,
      entityType: "truck",
      entityId: truckId,
      score,
      reasons,
      availability: servingNow ? "serving_now" : "nearby",
      source: "live_trucks",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: servingNow ? "Serving now" : "Nearby",
      metadata: {
        name: truck.name || truck.businessName || "Food truck",
        cuisineType: truck.cuisineType || null,
      },
    });
  }

  const nearbyRestaurantSet = new Set(
    (nearbyRestaurants as any[]).map((restaurant: any) => String(restaurant.id)),
  );
  for (const deal of activeDeals as any[]) {
    const restaurantId = String(deal.restaurantId || "");
    if (!restaurantId || !nearbyRestaurantSet.has(restaurantId)) continue;

    const reasons = dedupeReasons(["Deal today", "Open now"]);
    const score = 38 + Math.min(15, Number(deal.discountValue || 0));
    recommendations.push({
      id: `deal:${String(deal.id)}`,
      entityType: "deal",
      entityId: String(deal.id),
      score,
      reasons,
      availability: "active_today",
      source: "active_deals",
      metadata: {
        title: deal.title || "Deal",
        restaurantId,
      },
    });
  }

  for (const eventRow of publicEvents as any[]) {
    const eventId = String(eventRow.id);
    const hostLat = toFiniteNumber(eventRow.hostLat);
    const hostLng = toFiniteNumber(eventRow.hostLng);
    if (hostLat === null || hostLng === null) continue;
    const distanceMiles = milesBetween(lat, lng, hostLat, hostLng);
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371) continue;

    const eventReasons = dedupeReasons([
      "Happening today",
      eventRow.bookedRestaurantId ? "Serving nearby" : "",
    ]);

    recommendations.push({
      id: `event:${eventId}`,
      entityType: "event",
      entityId: eventId,
      score: 30 + Math.max(0, 12 - distanceMiles),
      reasons: eventReasons,
      availability: "today",
      source: "public_events",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: "Happening today",
      metadata: {
        name: eventRow.name || "Event",
        hostId: String(eventRow.hostId || ""),
      },
    });

    if (eventRow.requiresPayment) {
      recommendations.push({
        id: `host_spot:${String(eventRow.hostId)}:${eventId}`,
        entityType: "host_spot",
        entityId: String(eventRow.hostId),
        score: 24 + Math.max(0, 10 - distanceMiles),
        reasons: dedupeReasons(["Happening today", "Serving nearby"]),
        availability: "bookable_today",
        source: "parking_pass_events",
        distanceMiles: Number(distanceMiles.toFixed(2)),
        freshnessLabel: "Confirmed today",
        metadata: {
          hostName: eventRow.hostName || "Host location",
          eventId,
        },
      });
    }
  }

  recommendations.sort((a, b) => b.score - a.score);
  const deduped = new Map<string, LocalRecommendation>();
  for (const recommendation of recommendations) {
    if (!deduped.has(recommendation.id)) deduped.set(recommendation.id, recommendation);
    if (deduped.size >= limit) break;
  }
  return Array.from(deduped.values()).slice(0, limit);
}
