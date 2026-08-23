import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { getPrivateBehaviorScoresForRestaurants } from "./privateBehaviorScoreService";
import { events, hosts, restaurants, users } from "@shared/schema";
import { loadConfirmedEventTrucks } from "./confirmedEventTrucks";
import { resolveCityTimeZoneSync } from "./cityTimeZone";
import { buildSlotDateTimes } from "./timeIntent";
import { dateKeyInZone } from "./dateKeys";
import { isSlotPublic } from "./publicSlotGate";
import { toPublicRestaurantListingArrayWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import { filterProjectedPublicNearbyRestaurantRows } from "./publicRestaurantSearchProjection";
import { resolvePublicHostProximityCoordinates } from "./publicHostProximityProjection";
import { deriveProfileEvidenceQuarantineVisibility } from "./profileEvidenceQuarantine";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

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
  availability:
    | "serving_now"
    | "open_now"
    | "deal_today"
    | "event_today"
    | "available_today"
    | "upcoming"
    | "nearby"
    | "unknown";
  source:
    | "community"
    | "user_behavior"
    | "operator_update"
    | "local_activity"
    | "system";
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
  recommendationLikeCount: number;
  recommendationDislikeCount: number;
  shareCount: number;
  favoriteCount: number;
  followCount: number;
  storyLikeCount: number;
  storyCommentCount: number;
  storyShareCount: number;
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
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).rows)
  ) {
    return (result as any).rows as T[];
  }
  return [];
};

async function getRestaurantSignals(): Promise<
  Map<string, RestaurantSignalRow>
> {
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
        count(*) filter (where lower(coalesce(rr.reaction_type, '')) in ('like', 'liked', 'upvote', 'thumbs_up', 'positive'))::int as recommendation_like_count,
        count(*) filter (where lower(coalesce(rr.reaction_type, '')) in ('dislike', 'disliked', 'downvote', 'thumbs_down', 'negative'))::int as recommendation_dislike_count
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
    ),
    story_engagement as (
      select
        vs.restaurant_id,
        coalesce(sum(vs.like_count), 0)::int as story_like_count,
        coalesce(sum(vs.comment_count), 0)::int as story_comment_count,
        coalesce(sum(vs.share_count), 0)::int as story_share_count
      from video_stories vs
      inner join users story_creator on story_creator.id = vs.user_id
      where vs.restaurant_id is not null
        and vs.status = 'ready'
        and vs.is_approved = true
        and vs.deleted_at is null
        and vs.expires_at >= now()
        and story_creator.is_disabled = false
      group by vs.restaurant_id
    )
    select
      r.id as "restaurantId",
      coalesce(recs.recommendation_count, 0) as "recommendationCount",
      coalesce(reacts.recommendation_like_count, 0) as "recommendationLikeCount",
      coalesce(reacts.recommendation_dislike_count, 0) as "recommendationDislikeCount",
      coalesce(shares.share_count, 0) as "shareCount",
      coalesce(favs.favorite_count, 0) as "favoriteCount",
      coalesce(follows.follow_count, 0) as "followCount",
      coalesce(story_engagement.story_like_count, 0) as "storyLikeCount",
      coalesce(story_engagement.story_comment_count, 0) as "storyCommentCount",
      coalesce(story_engagement.story_share_count, 0) as "storyShareCount"
    from restaurants r
    inner join users restaurant_owner on restaurant_owner.id = r.owner_id
    left join recs on recs.restaurant_id = r.id
    left join reacts on reacts.restaurant_id = r.id
    left join shares on shares.restaurant_id = r.id
    left join favs on favs.restaurant_id = r.id
    left join follows on follows.restaurant_id = r.id
    left join story_engagement on story_engagement.restaurant_id = r.id
    where r.is_active = true
      and restaurant_owner.is_disabled = false
  `);

  const map = new Map<string, RestaurantSignalRow>();
  for (const row of toRows<RestaurantSignalRow>(result)) {
    map.set(String(row.restaurantId), {
      restaurantId: String(row.restaurantId),
      recommendationCount: Number(row.recommendationCount || 0),
      recommendationLikeCount: Number(row.recommendationLikeCount || 0),
      recommendationDislikeCount: Number(row.recommendationDislikeCount || 0),
      shareCount: Number(row.shareCount || 0),
      favoriteCount: Number(row.favoriteCount || 0),
      followCount: Number(row.followCount || 0),
      storyLikeCount: Number(row.storyLikeCount || 0),
      storyCommentCount: Number(row.storyCommentCount || 0),
      storyShareCount: Number(row.storyShareCount || 0),
    });
  }
  return map;
}

async function getUserRestaurantSets(userId?: string | null): Promise<{
  follows: Set<string>;
  favorites: Set<string>;
  recommendations: Set<string>;
}> {
  if (!userId) {
    return {
      follows: new Set<string>(),
      favorites: new Set<string>(),
      recommendations: new Set<string>(),
    };
  }

  const [followsResult, favoritesResult, recommendationsResult] =
    await Promise.all([
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
      db.execute(sql`
      select restaurant_id as "restaurantId"
      from restaurant_user_recommendations
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
    recommendations: new Set(
      toRows<{ restaurantId: string }>(recommendationsResult).map((row) =>
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
    restaurant?.openStatus ||
      restaurant?.status ||
      restaurant?.hoursStatus ||
      "",
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

  const [
    activeRestaurantRows,
    activeDeals,
    liveTrucks,
    publicEvents,
    restaurantSignals,
    userSets,
  ] = await Promise.all([
    db
      .select()
      .from(restaurants)
      .where(eq(restaurants.isActive, true)),
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
        updatedAt: events.updatedAt,
        lastConfirmedAt: events.lastConfirmedAt,
        hostName: hosts.businessName,
        hostCity: hosts.city,
        hostState: hosts.state,
        hostLat: hosts.latitude,
        hostLng: hosts.longitude,
        hostUserId: hosts.userId,
        hostPublicProfileSettings: users.publicProfileSettings,
      })
      .from(events)
      .innerJoin(hosts, eq(events.hostId, hosts.id))
      .innerJoin(users, eq(hosts.userId, users.id))
      .where(
        and(
          isNotNull(events.hostId),
          inArray(events.status, ["open", "booked", "filled"]),
          or(eq(events.requiresPayment, false), isNull(events.requiresPayment)),
          gte(events.date, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          lte(events.date, new Date(Date.now() + 24 * 60 * 60 * 1000)),
          eq(users.isDisabled, false),
        ),
      )
      .orderBy(desc(events.updatedAt))
      .limit(300),
    getRestaurantSignals(),
    getUserRestaurantSets(input.userId),
  ]);
  const publicRestaurantCandidates = (activeRestaurantRows as any[]).filter(
    (restaurant) =>
      isPublicBusinessVisible(restaurant) &&
      !deriveProfileEvidenceQuarantineVisibility(restaurant).isQuarantined,
  );
  const nearbyRestaurants = filterProjectedPublicNearbyRestaurantRows(
    await toPublicRestaurantListingArrayWithVisibility(
      publicRestaurantCandidates,
    ),
    { userLat: lat, userLng: lng, radiusKm },
  );
  const publicLiveTrucks = (
    await toPublicRestaurantListingArrayWithVisibility(
      (liveTrucks as any[]).filter(
        (truck) =>
          !deriveProfileEvidenceQuarantineVisibility(truck).isQuarantined,
      ),
    )
  ).filter(
    (truck: any) =>
      truck?.mobileOnline === true && isPublicBusinessVisible(truck),
  );
  const confirmedTrucksByEvent = await loadConfirmedEventTrucks(
    (publicEvents as any[]).map((event) => String(event.id || "")),
  );

  const candidateRestaurantIds = Array.from(
    new Set(
      [
        ...(nearbyRestaurants as any[]).map((restaurant: any) =>
          String(restaurant?.id || "").trim(),
        ),
        ...(publicLiveTrucks as any[]).map((truck: any) =>
          String(truck?.id || "").trim(),
        ),
        ...(activeDeals as any[]).map((deal: any) =>
          String(deal?.restaurantId || "").trim(),
        ),
      ].filter(Boolean),
    ),
  );
  const privateBehaviorByRestaurant = await (async () => {
    try {
      return await getPrivateBehaviorScoresForRestaurants(
        candidateRestaurantIds,
      );
    } catch (error) {
      console.warn(
        "[recommendations/local] private behavior score lookup failed; continuing without private boosts",
        error,
      );
      return new Map();
    }
  })();

  const recommendations: LocalRecommendation[] = [];

  for (const restaurant of nearbyRestaurants as any[]) {
    const restaurantId = String(restaurant.id);
    // A truck's stored business address is not a serving location. Trucks enter
    // local recommendations through the live/scheduled truck lane below, where
    // location freshness is enforced.
    if (
      restaurant.isFoodTruck === true ||
      String(restaurant.businessType || "").toLowerCase() === "food_truck"
    ) {
      continue;
    }
    const latValue = toFiniteNumber(restaurant.latitude ?? restaurant.lat);
    const lngValue = toFiniteNumber(restaurant.longitude ?? restaurant.lng);
    if (latValue === null || lngValue === null) continue;

    const distanceMiles = milesBetween(lat, lng, latValue, lngValue);
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371)
      continue;

    const signals = restaurantSignals.get(restaurantId);
    const openNow = isRestaurantOpenNow(restaurant);
    const dealCount = Number(
      restaurant.activeDealsCount || restaurant.activeDealCount || 0,
    );
    const viewerFavorited = userSets.favorites.has(restaurantId);
    const viewerFollows = userSets.follows.has(restaurantId);
    const viewerRecommended = userSets.recommendations.has(restaurantId);
    const privateBehavior = privateBehaviorByRestaurant.get(restaurantId);
    const privateBoost = Number(privateBehavior?.privateBoostScore || 0);
    const boostedByPrivateActivity = privateBoost >= 12;
    const hasFreshMenuSignal =
      Number(privateBehavior?.freshnessActivityScore || 0) >= 10;
    const reasons = dedupeReasons([
      openNow ? "Open now" : "",
      dealCount > 0 ? "Deal today" : "",
      viewerFavorited || (signals?.favoriteCount || 0) > 0
        ? "Local favorite"
        : "",
      (signals?.recommendationCount || 0) > 0 ? "Recommended by locals" : "",
      (signals?.favoriteCount || 0) +
        (signals?.followCount || 0) +
        (signals?.shareCount || 0) +
        (signals?.recommendationLikeCount || 0) >
      2
        ? "Popular nearby"
        : "",
      hasFreshMenuSignal ? "Menu updated" : "",
    ]);

    const publicTrustScore =
      Math.min(52, (signals?.favoriteCount || 0) * 11) +
      Math.min(36, (signals?.recommendationCount || 0) * 8) +
      Math.min(16, (signals?.recommendationLikeCount || 0) * 2.5) +
      Math.min(14, (signals?.followCount || 0) * 2) +
      Math.min(
        16,
        (signals?.shareCount || 0) * 3 + (signals?.storyShareCount || 0) * 1.5,
      ) +
      Math.min(
        10,
        ((signals?.storyLikeCount || 0) + (signals?.storyCommentCount || 0)) *
          0.4,
      ) -
      Math.min(24, (signals?.recommendationDislikeCount || 0) * 4);

    const availabilityScore =
      (openNow ? 18 : 0) +
      Math.min(12, dealCount * 5) +
      (viewerFavorited ? 14 : 0) +
      (viewerRecommended ? 9 : 0) +
      (viewerFollows ? 5 : 0);

    const distanceRefinement = Math.max(0, 7 - distanceMiles * 0.7);

    const score =
      publicTrustScore + availabilityScore + privateBoost + distanceRefinement;

    recommendations.push({
      id: `restaurant:${restaurantId}`,
      entityType: "restaurant",
      entityId: restaurantId,
      score,
      reasons: reasons.length > 0 ? reasons : ["Serving nearby"],
      availability: openNow ? "open_now" : "nearby",
      source: boostedByPrivateActivity ? "user_behavior" : "community",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: openNow ? "Open now" : undefined,
      metadata: {
        name: restaurant.businessName || restaurant.name || "Restaurant",
        activeDealsCount: dealCount,
        boostedByPrivateActivity,
        sourceDetail: boostedByPrivateActivity
          ? "private_behavior"
          : "public_trust",
      },
    });
  }

  for (const truck of publicLiveTrucks as any[]) {
    const truckId = String(truck.id);
    const latValue = toFiniteNumber(
      truck.currentLatitude ?? truck.current_latitude ?? truck.latitude ?? truck.lat,
    );
    const lngValue = toFiniteNumber(
      truck.currentLongitude ??
        truck.current_longitude ??
        truck.longitude ??
        truck.lng,
    );
    if (latValue === null || lngValue === null) continue;

    const distanceMiles = milesBetween(lat, lng, latValue, lngValue);
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371)
      continue;

    const servingNow = isTruckServingNow(truck);
    const privateBehavior = privateBehaviorByRestaurant.get(truckId);
    const privateBoost = Number(privateBehavior?.privateBoostScore || 0);
    const boostedByPrivateActivity = privateBoost >= 12;
    const reasons = dedupeReasons([
      servingNow ? "Serving nearby" : "",
      servingNow ? "Open now" : "",
      Number(truck.activeDealCount || 0) > 0 ? "Deal today" : "",
      "Popular nearby",
      Number(privateBehavior?.freshnessActivityScore || 0) >= 10
        ? "Menu updated"
        : "",
    ]);

    const score =
      (servingNow ? 46 : 22) +
      Math.min(12, Number(truck.activeDealCount || 0) * 6) +
      Math.max(0, 18 - distanceMiles * 2.4) +
      Math.round(privateBoost * 0.55);

    recommendations.push({
      id: `truck:${truckId}`,
      entityType: "truck",
      entityId: truckId,
      score,
      reasons,
      availability: servingNow ? "serving_now" : "nearby",
      source: boostedByPrivateActivity ? "user_behavior" : "local_activity",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: servingNow ? "Serving now" : "Nearby",
      metadata: {
        name: truck.name || truck.businessName || "Food truck",
        cuisineType: truck.cuisineType || null,
        boostedByPrivateActivity,
        sourceDetail: boostedByPrivateActivity
          ? "private_behavior"
          : "live_truck_presence",
      },
    });
  }

  const nearbyRestaurantSet = new Set(
    (nearbyRestaurants as any[]).map((restaurant: any) =>
      String(restaurant.id),
    ),
  );
  for (const deal of activeDeals as any[]) {
    const restaurantId = String(deal.restaurantId || "");
    if (!restaurantId || !nearbyRestaurantSet.has(restaurantId)) continue;

    const parentRestaurant = (nearbyRestaurants as any[]).find(
      (restaurant: any) => String(restaurant?.id || "") === restaurantId,
    );
    const openNow = isRestaurantOpenNow(parentRestaurant);
    const reasons = dedupeReasons(["Deal today", openNow ? "Open now" : ""]);
    const signals = restaurantSignals.get(restaurantId);
    const viewerFavorited = userSets.favorites.has(restaurantId);
    const viewerFollows = userSets.follows.has(restaurantId);
    const viewerRecommended = userSets.recommendations.has(restaurantId);
    const privateBehavior = privateBehaviorByRestaurant.get(restaurantId);
    const privateBoost = Number(privateBehavior?.privateBoostScore || 0);
    const boostedByPrivateActivity = privateBoost >= 12;
    if (viewerFavorited || (signals?.favoriteCount || 0) > 0) {
      reasons.unshift("Local favorite");
    }
    if (viewerFollows || (signals?.followCount || 0) > 0)
      reasons.push("Popular nearby");
    if ((signals?.recommendationCount || 0) > 0)
      reasons.push("Recommended by locals");
    if (Number(privateBehavior?.freshnessActivityScore || 0) >= 10) {
      reasons.push("Menu updated");
    }
    const score = 38 + Math.min(15, Number(deal.discountValue || 0));
    recommendations.push({
      id: `deal:${String(deal.id)}`,
      entityType: "deal",
      entityId: String(deal.id),
      score:
        score +
        (viewerFavorited ? 22 : 0) +
        Math.min(18, Number(signals?.favoriteCount || 0) * 4) +
        Math.min(12, Number(signals?.recommendationCount || 0) * 3) +
        Math.round(privateBoost * 0.45),
      reasons,
      availability: "deal_today",
      source: boostedByPrivateActivity ? "user_behavior" : "local_activity",
      metadata: {
        title: deal.title || "Deal",
        restaurantId,
        boostedByPrivateActivity,
        sourceDetail: boostedByPrivateActivity
          ? "private_behavior"
          : "active_deal_linked_to_restaurant_signals",
      },
    });
  }

  for (const eventRow of publicEvents as any[]) {
    if (
      !isPublicBusinessVisible({
        name: eventRow.hostName,
        city: eventRow.hostCity,
        state: eventRow.hostState,
      })
    ) {
      continue;
    }
    const eventId = String(eventRow.id);
    const hostCoordinates = resolvePublicHostProximityCoordinates({
      latitude: eventRow.hostLat,
      longitude: eventRow.hostLng,
      publicProfileSettings: eventRow.hostPublicProfileSettings,
    });
    if (!hostCoordinates) continue;
    const distanceMiles = milesBetween(
      lat,
      lng,
      hostCoordinates.latitude,
      hostCoordinates.longitude,
    );
    if (!Number.isFinite(distanceMiles) || distanceMiles > radiusKm * 0.621371)
      continue;
    const timeZone = resolveCityTimeZoneSync({
      city: eventRow.hostCity || null,
      state: eventRow.hostState || null,
    });
    const interval = buildSlotDateTimes({
      timeZone,
      date: eventRow.date,
      startTime: String(eventRow.startTime || ""),
      endTime: String(eventRow.endTime || ""),
    });
    const now = new Date();
    if (
      !interval ||
      interval.endUtc.getTime() < now.getTime() ||
      dateKeyInZone(interval.startUtc, timeZone) !==
        dateKeyInZone(now, timeZone)
    ) {
      continue;
    }

    const confirmedTrucks =
      confirmedTrucksByEvent.get(String(eventRow.id || "")) || [];
    const lastConfirmedAtUtc = confirmedTrucks
      .map((truck) => truck.bookingConfirmedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (
      !lastConfirmedAtUtc ||
      !isSlotPublic({
        slot: {
          source: "parking_pass_booking",
          status: "confirmed",
          startsAtUtc: interval.startUtc,
          endsAtUtc: interval.endUtc,
          lastConfirmedAtUtc,
        },
        ttlHours: 24 * 365 * 100,
      })
    ) {
      continue;
    }
    const eventReasons = dedupeReasons([
      "Happening today",
      confirmedTrucks.length === 1
        ? "1 food truck confirmed"
        : confirmedTrucks.length > 1
          ? `${confirmedTrucks.length} food trucks confirmed`
          : "",
    ]);

    recommendations.push({
      id: `event:${eventId}`,
      entityType: "event",
      entityId: eventId,
      score: 30 + Math.max(0, 12 - distanceMiles),
      reasons: eventReasons,
      availability: "event_today",
      source: "operator_update",
      distanceMiles: Number(distanceMiles.toFixed(2)),
      freshnessLabel: "Happening today",
      metadata: {
        name: eventRow.name || "Event",
        hostId: String(eventRow.hostId || ""),
        sourceDetail: "public_events_feed",
      },
    });
  }

  recommendations.sort((a, b) => b.score - a.score);
  const deduped = new Map<string, LocalRecommendation>();
  for (const recommendation of recommendations) {
    if (!deduped.has(recommendation.id))
      deduped.set(recommendation.id, recommendation);
    if (deduped.size >= limit) break;
  }
  return Array.from(deduped.values()).slice(0, limit);
}
