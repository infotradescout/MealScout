import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import { hasTruckScheduleSignal } from "../utils/truckListingEligibility";
import { buildLocalRecommendations } from "./recommendationEngine";
import {
  deals,
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  videoStories,
} from "@shared/schema";
import type {
  ScoutSurfaceCard,
  ScoutSurfaceResponse,
  ScoutSurfaceSection,
} from "@shared/constants/scoutSurface";

type BuildScoutSurfaceInput = {
  lat?: number;
  lng?: number;
  radiusMiles: number;
  limit: number;
  userId?: string | null;
};

type RecommendationSignals = {
  favoriteCount: number;
  followCount: number;
  recommendationCount: number;
  videoRecommendationCount: number;
  reactionScore: number;
  shareCount: number;
  activeDealCount: number;
};

type CandidateBucket = {
  trucksServing: ScoutSurfaceCard[];
  recommended: ScoutSurfaceCard[];
  dealsToday: ScoutSurfaceCard[];
  happeningToday: ScoutSurfaceCard[];
  openNearYou: ScoutSurfaceCard[];
  nearbyNow: ScoutSurfaceCard[];
  moreNearby: ScoutSurfaceCard[];
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const buildPublicProfilePath = (
  entityType: "restaurant" | "truck" | "location",
  entityId: string,
  name?: string | null,
) => {
  const slug = `${toSlug(name) || entityId}--${entityId}`;
  if (entityType === "truck") return `/truck/${encodeURIComponent(slug)}`;
  if (entityType === "location") return `/location/${encodeURIComponent(slug)}`;
  return `/restaurant/${encodeURIComponent(slug)}`;
};

type InitialBlendRule = {
  broadLocalScene: number;
  communityFavorites: number;
  userSpecificRelevance: number;
  newOrUnderScouted: number;
};

const INITIAL_SCOUT_BLEND: InitialBlendRule = {
  broadLocalScene: 0.4,
  communityFavorites: 0.3,
  userSpecificRelevance: 0.2,
  newOrUnderScouted: 0.1,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toFinite = (value: unknown): number | null => {
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

const dedupe = (items: string[]) =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const GOOGLE_PLACE_PHOTO_HOST_RE = /(^|\/\/)(lh\d*\.googleusercontent\.com|maps\.googleapis\.com)(\/|$)/i;
const isGooglePlacePhotoUrl = (value: unknown): boolean => {
  const url = String(value || "").trim();
  if (!url) return false;
  return GOOGLE_PLACE_PHOTO_HOST_RE.test(url);
};
const pickTrustedBusinessImage = (...candidates: Array<unknown>): string | null => {
  const urls = candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!urls.length) return null;
  const firstNonGoogle = urls.find((url) => !isGooglePlacePhotoUrl(url));
  return firstNonGoogle || null;
};

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

const hasRestaurantScheduleSignal = (restaurant: any): boolean => {
  const directSchedule =
    restaurant?.operatingHours ??
    restaurant?.hours ??
    restaurant?.businessHours ??
    restaurant?.schedule;
  if (Array.isArray(directSchedule)) return directSchedule.length > 0;
  if (directSchedule && typeof directSchedule === "object") {
    return Object.keys(directSchedule).length > 0;
  }
  if (typeof directSchedule === "string" && directSchedule.trim().length > 0) return true;
  const explicitOpenFields = [
    restaurant?.isOpen,
    restaurant?.openNow,
    restaurant?.currentlyOpen,
    restaurant?.isCurrentlyOpen,
  ];
  if (explicitOpenFields.some((value) => typeof value === "boolean")) return true;
  return false;
};

const getRestaurantAvailabilityState = (
  restaurant: any,
): "open_now" | "closed_now" | "no_schedule" => {
  const hasSchedule = hasRestaurantScheduleSignal(restaurant);
  if (!hasSchedule) return "no_schedule";
  return isRestaurantOpenNow(restaurant) ? "open_now" : "closed_now";
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
  return truck?.mobileOnline === true;
};

const isToday = (value: unknown): boolean => {
  const date = value ? new Date(value as any) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate()
  );
};

const byScoreThenDistance = (a: ScoutSurfaceCard, b: ScoutSurfaceCard) => {
  if (a.score !== b.score) return b.score - a.score;
  const ad = typeof a.distanceMiles === "number" ? a.distanceMiles : Number.POSITIVE_INFINITY;
  const bd = typeof b.distanceMiles === "number" ? b.distanceMiles : Number.POSITIVE_INFINITY;
  return ad - bd;
};

const normalizeEntityType = (
  entityType: string,
  fallbackEntity?: any,
): ScoutSurfaceCard["entityType"] => {
  if (entityType === "truck") return "truck";
  if (entityType === "restaurant") return "restaurant";
  if (entityType === "deal") return "deal";
  if (entityType === "event") return "event";
  if (entityType === "host_spot") return "host_spot";
  if (entityType === "caterer") return "caterer";
  if (entityType === "private_chef") return "private_chef";
  if (fallbackEntity?.isFoodTruck) return "truck";
  return "restaurant";
};

const normalizeSource = (value: string): ScoutSurfaceCard["source"] => {
  if (value === "recommendation") return "recommendation";
  if (value === "community") return "community";
  if (value === "deal") return "deal";
  if (value === "event") return "event";
  if (value === "host_spot") return "host_spot";
  if (value === "truck_activity") return "truck_activity";
  if (value === "restaurant_public") return "restaurant_public";
  if (value === "local_activity") return "truck_activity";
  if (value === "user_behavior") return "community";
  return "community";
};

const normalizeAvailability = (
  value: string,
): ScoutSurfaceCard["availability"] => {
  if (value === "serving_now") return "serving_now";
  if (value === "open_now") return "open_now";
  if (value === "deal_today") return "deal_today";
  if (value === "event_today") return "event_today";
  if (value === "upcoming") return "upcoming";
  if (value === "nearby") return "nearby";
  return "unknown";
};

const getStatusLabel = (
  entityType: ScoutSurfaceCard["entityType"],
  availability: ScoutSurfaceCard["availability"],
) => {
  if (entityType === "truck" && availability === "serving_now") return "Serving now";
  if (availability === "open_now") return "Open now";
  if (availability === "deal_today") return "Deal today";
  if (availability === "event_today") return "Happening today";
  if (availability === "upcoming") return "Upcoming";
  return "Nearby";
};

const getCta = (card: ScoutSurfaceCard): ScoutSurfaceCard["cta"] => {
  const metadata = (card.metadata || {}) as Record<string, unknown>;
  const parkingPassBookable = metadata.parkingPassBookable === true;
  const parkingPassId = String(
    metadata.parkingPassId || metadata.eventId || "",
  ).trim();
  const eventMenuId = String(
    metadata.eventMenuId || metadata.menuId || "",
  ).trim();
  const locationId = String(
    metadata.locationId || metadata.hostId || card.entityId || "",
  ).trim();
  const spotId = String(metadata.spotId || "").trim();
  const buildParkingPassHref = () => {
    const params = new URLSearchParams();
    params.set("setup", "book");
    params.set("view", "map");
    params.set("source", "scout");
    if (parkingPassId) params.set("pass", parkingPassId);
    if (locationId) params.set("hostId", locationId);
    if (spotId) params.set("spotId", spotId);
    if (parkingPassId) params.set("eventId", parkingPassId);
    if (locationId) params.set("locationId", locationId);
    if (eventMenuId) params.set("eventMenuId", eventMenuId);
    return `/parking-pass?${params.toString()}`;
  };

  if (card.entityType === "deal") {
    return { label: "View details", href: `/deal/${encodeURIComponent(card.entityId)}` };
  }
  if (card.entityType === "event") {
    if (parkingPassBookable) {
      return { label: "Book spot", href: buildParkingPassHref() };
    }
    return { label: "View details", href: `/events/${encodeURIComponent(card.entityId)}` };
  }
  if (card.entityType === "host_spot") {
    return {
      label: "View details",
      href: buildPublicProfilePath("location", String(card.entityId), card.title),
    };
  }
  if (card.entityType === "truck") {
    return {
      label: "View details",
      href: buildPublicProfilePath("truck", String(card.entityId), card.title),
    };
  }
  return {
    label: "View menu",
    href: buildPublicProfilePath("restaurant", String(card.entityId), card.title),
  };
};

const isRecommendationBacked = (card: ScoutSurfaceCard) => {
  const metadata = (card.metadata || {}) as Record<string, unknown>;
  const sourceDetail = String(metadata.sourceDetail || "");
  const reasons = card.reasons || [];
  if (card.source === "recommendation" || card.source === "community") return true;
  if (sourceDetail.includes("private_behavior")) return true;
  if (sourceDetail.includes("restaurant_signals")) return true;
  if (sourceDetail.includes("active_deal_linked")) return true;
  return reasons.some((reason) =>
    /recommended by locals|local favorite|popular nearby|you follow this|you recommended this|one of your favorites/i.test(
      reason,
    ),
  );
};

const isUserSpecificRecommendation = (card: ScoutSurfaceCard) => {
  const reasons = card.reasons || [];
  const metadata = (card.metadata || {}) as Record<string, unknown>;
  const sourceDetail = String(metadata.sourceDetail || "");
  if (sourceDetail.includes("viewer_")) return true;
  return reasons.some((reason) =>
    /one of your favorites|you follow this|you recommended this/i.test(reason),
  );
};

const isUnderScoutedDiscovery = (card: ScoutSurfaceCard) => {
  if (card.source !== "restaurant_public" && card.source !== "truck_activity") return false;
  if (isRecommendationBacked(card)) return false;
  const reasons = (card.reasons || []).map((reason) => reason.toLowerCase());
  const hasHeavyMomentumReason = reasons.some((reason) =>
    /recommended by locals|local favorite|popular nearby|strong community activity/i.test(
      reason,
    ),
  );
  return !hasHeavyMomentumReason;
};

async function getRestaurantSignals(
  restaurantIds: string[],
): Promise<Map<string, RecommendationSignals>> {
  if (restaurantIds.length === 0) return new Map();

  const [favoriteRows, followRows, recommendationRows, dealRows, videoRows] =
    await Promise.all([
      db
        .select({
          restaurantId: restaurantFavorites.restaurantId,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(restaurantFavorites)
        .where(inArray(restaurantFavorites.restaurantId, restaurantIds))
        .groupBy(restaurantFavorites.restaurantId),
      db
        .select({
          restaurantId: restaurantFollows.restaurantId,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(restaurantFollows)
        .where(inArray(restaurantFollows.restaurantId, restaurantIds))
        .groupBy(restaurantFollows.restaurantId),
      db
        .select({
          restaurantId: restaurantUserRecommendations.restaurantId,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(restaurantUserRecommendations)
        .where(inArray(restaurantUserRecommendations.restaurantId, restaurantIds))
        .groupBy(restaurantUserRecommendations.restaurantId),
      db
        .select({
          restaurantId: deals.restaurantId,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(deals)
        .where(and(eq(deals.isActive, true), inArray(deals.restaurantId, restaurantIds)))
        .groupBy(deals.restaurantId),
      db
        .select({
          restaurantId: videoStories.restaurantId,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(videoStories)
        .where(
          and(
            inArray(videoStories.restaurantId, restaurantIds),
            eq(videoStories.status, "ready"),
            isNull(videoStories.deletedAt),
          ),
        )
        .groupBy(videoStories.restaurantId),
    ]);

  const restaurantIdSqlList = sql.join(
    restaurantIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const [reactionRows, shareRows] = await Promise.all([
    db.execute(sql<{
      restaurant_id: string;
      score: number;
    }>`
      select
        rur.restaurant_id,
        cast(sum(case rr.reaction_type when 'like' then 1 when 'dislike' then -1 else 0 end) as integer) as score
      from recommendation_reactions rr
      inner join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
      where rur.restaurant_id in (${restaurantIdSqlList})
      group by rur.restaurant_id
    `),
    db.execute(sql<{
      restaurant_id: string;
      count: number;
    }>`
      select
        rur.restaurant_id,
        cast(count(*) as integer) as count
      from recommendation_shares rs
      inner join restaurant_user_recommendations rur on rur.id = rs.recommendation_id
      where rur.restaurant_id in (${restaurantIdSqlList})
      group by rur.restaurant_id
    `),
  ]);

  const map = new Map<string, RecommendationSignals>();
  for (const id of restaurantIds) {
    map.set(id, {
      favoriteCount: 0,
      followCount: 0,
      recommendationCount: 0,
      videoRecommendationCount: 0,
      reactionScore: 0,
      shareCount: 0,
      activeDealCount: 0,
    });
  }

  for (const row of favoriteRows as any[]) {
    const key = String(row.restaurantId || "");
    const target = map.get(key);
    if (target) target.favoriteCount = Number(row.count || 0);
  }
  for (const row of followRows as any[]) {
    const key = String(row.restaurantId || "");
    const target = map.get(key);
    if (target) target.followCount = Number(row.count || 0);
  }
  for (const row of recommendationRows as any[]) {
    const key = String(row.restaurantId || "");
    const target = map.get(key);
    if (target) target.recommendationCount = Number(row.count || 0);
  }
  for (const row of dealRows as any[]) {
    const key = String(row.restaurantId || "");
    const target = map.get(key);
    if (target) target.activeDealCount = Number(row.count || 0);
  }
  for (const row of videoRows as any[]) {
    const key = String(row.restaurantId || "");
    const target = map.get(key);
    if (target) target.videoRecommendationCount = Number(row.count || 0);
  }

  const reactionItems = (reactionRows as any)?.rows || [];
  for (const row of reactionItems) {
    const key = String(row.restaurant_id || "");
    const target = map.get(key);
    if (target) target.reactionScore = Number(row.score || 0);
  }

  const shareItems = (shareRows as any)?.rows || [];
  for (const row of shareItems) {
    const key = String(row.restaurant_id || "");
    const target = map.get(key);
    if (target) target.shareCount = Number(row.count || 0);
  }

  return map;
}

const parseLatLng = (entity: any): { lat: number; lng: number } | null => {
  const lat =
    toFinite(entity?.lat) ??
    toFinite(entity?.latitude) ??
    toFinite(entity?.currentLatitude) ??
    toFinite(entity?.hostLat);
  const lng =
    toFinite(entity?.lng) ??
    toFinite(entity?.longitude) ??
    toFinite(entity?.currentLongitude) ??
    toFinite(entity?.hostLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Number(lat), lng: Number(lng) };
};

const section = (
  id: string,
  title: string,
  placement: ScoutSurfaceSection["placement"],
  layout: ScoutSurfaceSection["layout"],
  cards: ScoutSurfaceCard[],
  subtitle?: string,
): ScoutSurfaceSection | null => {
  if (!cards.length) return null;
  return {
    id,
    title,
    placement,
    layout,
    subtitle,
    cards,
  };
};

export async function buildScoutSurface(
  input: BuildScoutSurfaceInput,
): Promise<ScoutSurfaceResponse> {
  const radiusMiles = clamp(input.radiusMiles, 1, 50);
  const limit = clamp(input.limit, 6, 120);
  const lat = toFinite(input.lat);
  const lng = toFinite(input.lng);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const radiusKm = radiusMiles * 1.609344;

  const [allRestaurants, activeDeals, upcomingEvents, liveTrucks, localRecommendations] =
    await Promise.all([
    storage.getAllRestaurants(),
    hasLocation
      ? storage.getNearbyDeals(Number(lat), Number(lng), radiusKm)
      : storage.getActiveDeals(),
    storage.getAllUpcomingEvents(),
    hasLocation
      ? storage.getLiveTrucksNearby(Number(lat), Number(lng), radiusKm)
      : Promise.resolve([]),
    hasLocation
      ? buildLocalRecommendations({
          lat: Number(lat),
          lng: Number(lng),
          radiusKm,
          limit: Math.max(limit, 40),
          userId: input.userId || null,
        })
      : Promise.resolve([]),
    ]);

  const restaurants = (Array.isArray(allRestaurants) ? allRestaurants : [])
    .filter((row: any) => row?.isActive)
    .filter((row: any) => isPublicBusinessVisible(row));
  const scoutEligibleRestaurants = restaurants;

  const restaurantById = new Map(
    scoutEligibleRestaurants.map((restaurant: any) => [String(restaurant.id), restaurant]),
  );

  const restaurantIds = scoutEligibleRestaurants
    .map((restaurant: any) => String(restaurant.id || "").trim())
    .filter(Boolean);
  const recommendationSignals = await (async () => {
    try {
      return await getRestaurantSignals(restaurantIds);
    } catch (error) {
      console.warn(
        "[scout/surface] recommendation signal aggregation failed; continuing without extra signal rollups",
        error,
      );
      return new Map<string, RecommendationSignals>();
    }
  })();

  const cardPool: CandidateBucket = {
    trucksServing: [],
    nearbyNow: [],
    recommended: [],
    dealsToday: [],
    happeningToday: [],
    openNearYou: [],
    moreNearby: [],
  };

  const recommendationCards: ScoutSurfaceCard[] = [];
  for (const rec of Array.isArray(localRecommendations) ? localRecommendations : []) {
    const entityType = normalizeEntityType(String(rec.entityType || ""));
    const availability = normalizeAvailability(String(rec.availability || "unknown"));
    const metadata = (rec.metadata || {}) as Record<string, unknown>;
    const title =
      String(metadata.name || metadata.title || "").trim() ||
      (entityType === "deal" ? "Deal" : entityType === "event" ? "Event" : "Nearby place");
    const subtitle =
      typeof metadata.cuisineType === "string" && metadata.cuisineType.trim()
        ? metadata.cuisineType.trim()
        : undefined;
    const statusLabel = rec.freshnessLabel || getStatusLabel(entityType, availability);
    const source = normalizeSource(String(rec.source || ""));
    const card: ScoutSurfaceCard = {
      id: String(rec.id || `${entityType}:${String(rec.entityId || "")}`),
      entityType,
      entityId: String(rec.entityId || ""),
      title,
      subtitle,
      imageUrl: null,
      distanceMiles:
        typeof rec.distanceMiles === "number" && Number.isFinite(rec.distanceMiles)
          ? Number(rec.distanceMiles.toFixed(2))
          : null,
      statusLabel,
      badges: dedupe([
        statusLabel,
        availability === "serving_now" ? "Serving now" : "",
        availability === "open_now" ? "Open now" : "",
        availability === "deal_today" ? "Deal today" : "",
        availability === "event_today" ? "Today" : "",
      ]),
      reasons: dedupe(rec.reasons || []),
      availability,
      cta: {
        label: "View details",
        href: "#",
      },
      score: Number(rec.score || 0),
      source,
      metadata: {
        ...metadata,
        sourceDetail: String(metadata.sourceDetail || ""),
      },
    };
    card.cta = getCta(card);
    recommendationCards.push(card);
  }

  for (const truck of Array.isArray(liveTrucks) ? liveTrucks : []) {
    if (!hasTruckScheduleSignal(truck)) {
      // Menu-only trucks should not be treated as "live".
      continue;
    }
    const truckId = String((truck as any)?.id || "").trim();
    if (!truckId) continue;
    const coords = parseLatLng(truck);
    const distanceMiles = toFinite((truck as any)?.distanceMiles);
    const servingNow = isTruckServingNow(truck);

    const card: ScoutSurfaceCard = {
      id: `truck:${truckId}`,
      entityType: "truck",
      entityId: truckId,
      title: String((truck as any)?.name || "Food truck"),
      subtitle: String((truck as any)?.cuisineType || "").trim() || undefined,
      imageUrl: ((truck as any)?.coverImageUrl || (truck as any)?.logoUrl || null) as
        | string
        | null,
      distanceMiles: Number.isFinite(distanceMiles) ? Number(distanceMiles?.toFixed(2)) : null,
      statusLabel: servingNow ? "Serving now" : "Nearby",
      badges: dedupe([
        servingNow ? "Serving now" : "Nearby",
        String((truck as any)?.city || "").trim(),
      ]),
      reasons: dedupe([
        servingNow ? "Currently serving in your area" : "Close to your location",
        distanceMiles !== null && Number.isFinite(distanceMiles)
          ? `${Number(distanceMiles).toFixed(1)} mi away`
          : "Available nearby",
      ]),
      availability: servingNow ? "serving_now" : "nearby",
      cta: {
        label: servingNow ? "Go now" : "View details",
        href: buildPublicProfilePath(
          "truck",
          truckId,
          String((truck as any)?.name || "Food truck"),
        ),
      },
      score: 90 - Math.min(40, Number(distanceMiles || 0) * 4),
      source: "truck_activity",
      metadata: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
    };

    if (servingNow) {
      cardPool.trucksServing.push(card);
      cardPool.nearbyNow.push(card);
    } else {
      cardPool.moreNearby.push(card);
    }
  }

  for (const restaurant of scoutEligibleRestaurants) {
    const restaurantId = String((restaurant as any)?.id || "").trim();
    if (!restaurantId) continue;
    const coords = parseLatLng(restaurant);
    const distanceMiles =
      hasLocation && coords
        ? milesBetween(Number(lat), Number(lng), coords.lat, coords.lng)
        : null;
    if (
      hasLocation &&
      typeof distanceMiles === "number" &&
      Number.isFinite(distanceMiles) &&
      distanceMiles > radiusMiles
    ) {
      continue;
    }

    const availabilityState = getRestaurantAvailabilityState(restaurant);
    const openNow = availabilityState === "open_now";
    const hasSchedule = availabilityState !== "no_schedule";
    const signals =
      recommendationSignals.get(restaurantId) ||
      ({
        favoriteCount: 0,
        followCount: 0,
        recommendationCount: 0,
        videoRecommendationCount: 0,
        reactionScore: 0,
        shareCount: 0,
        activeDealCount: 0,
      } as RecommendationSignals);

    const entityType = normalizeEntityType("", restaurant);
    const baseCard: ScoutSurfaceCard = {
      id: `${entityType}:${restaurantId}`,
      entityType,
      entityId: restaurantId,
      title: String((restaurant as any)?.name || "Restaurant"),
      subtitle: String((restaurant as any)?.cuisineType || "").trim() || undefined,
      imageUrl: pickTrustedBusinessImage(
        (restaurant as any)?.logoUrl,
        (restaurant as any)?.coverImageUrl,
        (restaurant as any)?.heroImageUrl,
        (restaurant as any)?.imageUrl,
      ),
      distanceMiles:
        typeof distanceMiles === "number" && Number.isFinite(distanceMiles)
          ? Number(distanceMiles.toFixed(2))
          : null,
      statusLabel: openNow ? "Open now" : hasSchedule ? "Closed now" : "No schedule",
      badges: dedupe([
        openNow ? "Open now" : hasSchedule ? "Closed now" : "No schedule",
        String((restaurant as any)?.city || "").trim(),
        signals.activeDealCount > 0 ? "Deal today" : "",
      ]),
      reasons: dedupe([
        openNow
          ? "Open and available now"
          : hasSchedule
            ? "Closed right now"
            : "Schedule not published yet",
        signals.activeDealCount > 0 ? "Has active deals today" : "",
      ]),
      availability: openNow ? "open_now" : "nearby",
      cta: {
        label: "View menu",
        href: buildPublicProfilePath(
          entityType === "truck" ? "truck" : "restaurant",
          restaurantId,
          String((restaurant as any)?.name || "Restaurant"),
        ),
      },
      score:
        (openNow ? 70 : hasSchedule ? 42 : 30) +
        Math.min(14, signals.activeDealCount * 3) +
        Math.min(10, signals.favoriteCount + signals.followCount) +
        Math.min(12, signals.recommendationCount + signals.videoRecommendationCount) -
        Math.min(30, Number(distanceMiles || 0) * 2.5),
      source: "restaurant_public",
      metadata: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
    };

    const recommendationBacking =
      signals.recommendationCount > 0 ||
      signals.videoRecommendationCount > 0 ||
      signals.favoriteCount > 0 ||
      signals.followCount > 0 ||
      signals.reactionScore > 0 ||
      signals.shareCount > 0;

    if (openNow) {
      cardPool.nearbyNow.push(baseCard);
      cardPool.openNearYou.push(baseCard);
    } else {
      cardPool.moreNearby.push(baseCard);
    }

    if (recommendationBacking) {
      const recommendationScore =
        baseCard.score +
        Math.min(16, signals.recommendationCount * 2 + signals.videoRecommendationCount * 2) +
        Math.min(12, signals.favoriteCount + signals.followCount) +
        Math.min(8, signals.shareCount + Math.max(0, signals.reactionScore));

      cardPool.recommended.push({
        ...baseCard,
        id: `recommended:${restaurantId}`,
        source:
          signals.recommendationCount > 0 || signals.videoRecommendationCount > 0
            ? "recommendation"
            : "community",
        reasons: dedupe([
          signals.recommendationCount > 0 ? "Backed by local recommendations" : "",
          signals.videoRecommendationCount > 0 ? "Backed by local videos" : "",
          signals.favoriteCount > 0 ? "Saved by diners" : "",
          signals.followCount > 0 ? "Followed by diners" : "",
          signals.shareCount > 0 || signals.reactionScore > 0
            ? "Strong community activity"
            : "",
        ]),
        score: recommendationScore,
      });
    }
  }

  for (const deal of Array.isArray(activeDeals) ? activeDeals : []) {
    const dealId = String((deal as any)?.id || "").trim();
    const restaurantId = String((deal as any)?.restaurantId || "").trim();
    if (!dealId || !restaurantId) continue;

    const restaurant =
      (deal as any)?.restaurant || restaurantById.get(restaurantId) || null;
    const coords = parseLatLng(restaurant);
    const distanceMiles =
      hasLocation && coords
        ? milesBetween(Number(lat), Number(lng), coords.lat, coords.lng)
        : toFinite((deal as any)?.distance) !== null
          ? Number(toFinite((deal as any)?.distance)!) * 0.621371
          : null;

    if (
      hasLocation &&
      typeof distanceMiles === "number" &&
      Number.isFinite(distanceMiles) &&
      distanceMiles > radiusMiles
    ) {
      continue;
    }

    const title = String((deal as any)?.title || "Deal").trim() || "Deal";
    const subtitle = restaurant
      ? String((restaurant as any)?.name || "").trim() || undefined
      : undefined;

    const card: ScoutSurfaceCard = {
      id: `deal:${dealId}`,
      entityType: "deal",
      entityId: dealId,
      title,
      subtitle,
      imageUrl: ((deal as any)?.imageUrl || null) as string | null,
      distanceMiles:
        typeof distanceMiles === "number" && Number.isFinite(distanceMiles)
          ? Number(distanceMiles.toFixed(2))
          : null,
      statusLabel: "Deal today",
      badges: dedupe([
        "Deal today",
        (deal as any)?.dealType ? String((deal as any).dealType) : "",
      ]),
      reasons: dedupe([
        "Available right now",
        subtitle ? `From ${subtitle}` : "Nearby option",
      ]),
      availability: "deal_today",
      cta: {
        label: "View details",
        href: `/deal/${encodeURIComponent(dealId)}`,
      },
      score:
        74 +
        Math.min(15, Number((deal as any)?.discountValue || 0)) -
        Math.min(24, Number(distanceMiles || 0) * 2),
      source: "deal",
      metadata: coords
        ? { lat: coords.lat, lng: coords.lng, restaurantId }
        : { restaurantId },
    };

    cardPool.dealsToday.push(card);
  }

  for (const event of Array.isArray(upcomingEvents) ? upcomingEvents : []) {
    const eventId = String((event as any)?.id || "").trim();
    if (!eventId) continue;
    const host = (event as any)?.host || null;
    const coords = parseLatLng(host);
    if (!coords) continue;

    const distanceMiles = hasLocation
      ? milesBetween(Number(lat), Number(lng), coords.lat, coords.lng)
      : null;

    if (
      hasLocation &&
      typeof distanceMiles === "number" &&
      Number.isFinite(distanceMiles) &&
      distanceMiles > radiusMiles
    ) {
      continue;
    }

    const today = isToday((event as any)?.date);
    const requiresPayment = Boolean((event as any)?.requiresPayment);

    const baseEventCard: ScoutSurfaceCard = {
      id: `event:${eventId}`,
      entityType: "event",
      entityId: eventId,
      title: String((event as any)?.name || "Event"),
      subtitle: String((host as any)?.businessName || "").trim() || undefined,
      imageUrl: ((event as any)?.imageUrl || null) as string | null,
      distanceMiles:
        typeof distanceMiles === "number" && Number.isFinite(distanceMiles)
          ? Number(distanceMiles.toFixed(2))
          : null,
      statusLabel: today ? "Happening today" : "Upcoming",
      badges: dedupe([today ? "Today" : "Upcoming"]),
      reasons: dedupe([
        today ? "Scheduled for today" : "Upcoming local event",
        (host as any)?.businessName ? `Hosted by ${(host as any).businessName}` : "",
      ]),
      availability: today ? "event_today" : "upcoming",
      cta: {
        label: "View details",
        href: `/events/${encodeURIComponent(eventId)}`,
      },
      score: (today ? 72 : 54) - Math.min(18, Number(distanceMiles || 0) * 1.8),
      source: "event",
      metadata: { lat: coords.lat, lng: coords.lng },
    };

    if (today && !requiresPayment) {
      cardPool.happeningToday.push(baseEventCard);
      cardPool.nearbyNow.push(baseEventCard);
    } else if (!today && !requiresPayment) {
      cardPool.moreNearby.push(baseEventCard);
    }

    if (requiresPayment) {
      const hostId = String((host as any)?.id || (event as any)?.hostId || "").trim();
      if (!hostId) continue;
      cardPool.moreNearby.push({
        id: `host_spot:${hostId}:${eventId}`,
        entityType: "event",
        entityId: eventId,
        title: String((host as any)?.businessName || "Host spot"),
        subtitle: String((event as any)?.name || "").trim() || undefined,
        imageUrl: ((host as any)?.spotImageUrl || null) as string | null,
        distanceMiles:
          typeof distanceMiles === "number" && Number.isFinite(distanceMiles)
            ? Number(distanceMiles.toFixed(2))
            : null,
        statusLabel: today ? "Happening today" : "Upcoming",
        badges: dedupe(["Host spot", today ? "Today" : "Upcoming"]),
        reasons: dedupe([
          "Bookable host location",
          today ? "Available today" : "Upcoming availability",
        ]),
        availability: today ? "event_today" : "upcoming",
        cta: {
          label: "Book spot",
          href: `/parking-pass?setup=book&view=map&source=scout&pass=${encodeURIComponent(eventId)}&hostId=${encodeURIComponent(hostId)}&eventId=${encodeURIComponent(eventId)}&locationId=${encodeURIComponent(hostId)}`,
        },
        score: (today ? 68 : 50) - Math.min(18, Number(distanceMiles || 0) * 2),
        source: "event",
        metadata: {
          lat: coords.lat,
          lng: coords.lng,
          eventId,
          hostId,
          locationId: hostId,
          parkingPassId: eventId,
          parkingPassBookable: true,
        },
      });
    }
  }

  for (const key of Object.keys(cardPool) as Array<keyof typeof cardPool>) {
    cardPool[key].sort(byScoreThenDistance);
  }

  for (const recCard of recommendationCards) {
    if (!recCard.entityId) continue;
    if (recCard.entityType === "truck" && recCard.availability === "serving_now") {
      cardPool.trucksServing.push(recCard);
      cardPool.nearbyNow.push(recCard);
      continue;
    }
    if (recCard.entityType === "deal" || recCard.availability === "deal_today") {
      cardPool.dealsToday.push(recCard);
      continue;
    }
    if (recCard.entityType === "event" && recCard.availability === "event_today") {
      cardPool.happeningToday.push(recCard);
      continue;
    }
    if (isRecommendationBacked(recCard)) {
      cardPool.recommended.push(recCard);
    }
    if (recCard.availability === "open_now") {
      cardPool.openNearYou.push(recCard);
      cardPool.nearbyNow.push(recCard);
    } else if (recCard.availability === "nearby" || recCard.availability === "upcoming") {
      cardPool.moreNearby.push(recCard);
    }
  }

  for (const key of Object.keys(cardPool) as Array<keyof typeof cardPool>) {
    cardPool[key].sort(byScoreThenDistance);
  }

  const usedEntityKeys = new Set<string>();
  const pickUnique = (cards: ScoutSurfaceCard[], maxItems: number) => {
    const picked: ScoutSurfaceCard[] = [];
    for (const card of cards) {
      const key = `${card.entityType}:${card.entityId}`;
      if (usedEntityKeys.has(key)) continue;
      usedEntityKeys.add(key);
      picked.push(card);
      if (picked.length >= maxItems) break;
    }
    return picked;
  };

  const pickBlend = (targetCount: number) => {
    const clampCount = clamp(targetCount, 4, 12);
    const broadTarget = Math.max(
      1,
      Math.round(clampCount * INITIAL_SCOUT_BLEND.broadLocalScene),
    );
    const communityTarget = Math.max(
      1,
      Math.round(clampCount * INITIAL_SCOUT_BLEND.communityFavorites),
    );
    const userTarget = Math.max(
      1,
      Math.round(clampCount * INITIAL_SCOUT_BLEND.userSpecificRelevance),
    );
    const discoveryTarget = Math.max(
      1,
      clampCount - broadTarget - communityTarget - userTarget,
    );

    const broadPool = [...cardPool.nearbyNow, ...cardPool.openNearYou].sort(
      byScoreThenDistance,
    );
    const communityPool = cardPool.recommended
      .filter(isRecommendationBacked)
      .sort(byScoreThenDistance);
    const userPool = communityPool
      .filter(isUserSpecificRecommendation)
      .sort(byScoreThenDistance);
    const discoveryPool = [...cardPool.moreNearby, ...cardPool.openNearYou]
      .filter(isUnderScoutedDiscovery)
      .sort(byScoreThenDistance);

    const localUsed = new Set<string>();
    const addUnique = (from: ScoutSurfaceCard[], maxItems: number) => {
      const picked: ScoutSurfaceCard[] = [];
      for (const card of from) {
        const key = `${card.entityType}:${card.entityId}`;
        if (localUsed.has(key)) continue;
        localUsed.add(key);
        picked.push(card);
        if (picked.length >= maxItems) break;
      }
      return picked;
    };

    const blended = [
      ...addUnique(broadPool, broadTarget),
      ...addUnique(communityPool, communityTarget),
      ...addUnique(userPool, userTarget),
      ...addUnique(discoveryPool, discoveryTarget),
    ];

    if (blended.length < clampCount) {
      const fallbackPool = [
        ...broadPool,
        ...communityPool,
        ...cardPool.trucksServing,
        ...cardPool.dealsToday,
        ...cardPool.happeningToday,
        ...cardPool.moreNearby,
      ].sort(byScoreThenDistance);
      blended.push(...addUnique(fallbackPool, clampCount - blended.length));
    }

    return blended.slice(0, clampCount).sort(byScoreThenDistance);
  };

  const sections: ScoutSurfaceSection[] = [];

  {
    const blendedCards = pickUnique(
      pickBlend(Math.min(10, Math.max(6, Math.floor(limit * 0.6)))),
      Math.min(10, Math.max(6, Math.floor(limit * 0.6))),
    );
    const rail = section(
      "nearby-now",
      "Today Around You",
      "primary",
      "hero_cards",
      blendedCards,
      undefined,
    );
    if (rail) sections.push(rail);
  }

  if (cardPool.trucksServing.length > 0) {
    const cards = pickUnique(cardPool.trucksServing, Math.min(8, limit));
    const rail = section(
      "trucks-serving-now",
      "Trucks Serving Now",
      "secondary",
      "horizontal_cards",
      cards,
    );
    if (rail) sections.push(rail);
  }

  {
    const cards = pickUnique(
      cardPool.recommended.filter(isRecommendationBacked),
      Math.min(6, Math.max(3, Math.floor(limit / 2))),
    );
    const rail = section(
      "recommended-nearby",
      "Recommended Nearby",
      "secondary",
      "horizontal_cards",
      cards,
    );
    if (rail) sections.push(rail);
  }

  {
    const cards = pickUnique(cardPool.dealsToday, Math.min(8, limit));
    const rail = section(
      "deals-today",
      "Deals Today",
      "secondary",
      "compact_deals",
      cards,
    );
    if (rail) sections.push(rail);
  }

  {
    const cards = pickUnique(cardPool.happeningToday, Math.min(8, limit));
    const rail = section(
      "happening-today",
      "Happening Today",
      "supporting",
      "horizontal_cards",
      cards,
    );
    if (rail) sections.push(rail);
  }

  {
    const cards = pickUnique(cardPool.openNearYou, Math.min(10, limit));
    const rail = section(
      "open-near-you",
      "Open Near You",
      "supporting",
      "vertical_list",
      cards,
    );
    if (rail) sections.push(rail);
  }

  {
    const cards = pickUnique(cardPool.moreNearby, Math.min(12, limit));
    const rail = section(
      "more-nearby",
      "More Nearby",
      "lower",
      "vertical_list",
      cards,
    );
    if (rail) sections.push(rail);
  }

  const markerById = new Map<string, ScoutSurfaceResponse["map"]["markers"][number]>();
  for (const sectionRow of sections) {
    for (const card of sectionRow.cards) {
      const latValue = toFinite((card.metadata as any)?.lat);
      const lngValue = toFinite((card.metadata as any)?.lng);
      if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) continue;

      const markerId = `${card.entityType}:${card.entityId}`;
      if (markerById.has(markerId)) continue;
      markerById.set(markerId, {
        id: markerId,
        entityType: card.entityType,
        entityId: card.entityId,
        lat: Number(latValue),
        lng: Number(lngValue),
        label: card.title,
        status: card.statusLabel || undefined,
        source: card.source,
      });
    }
  }

  const totalCards = sections.reduce((sum, sectionRow) => sum + sectionRow.cards.length, 0);
  const activityScore =
    cardPool.trucksServing.length * 2 +
    cardPool.dealsToday.length * 1.5 +
    cardPool.happeningToday.length * 1.5 +
    cardPool.openNearYou.length +
    cardPool.recommended.length;
  const mode: ScoutSurfaceResponse["mode"] =
    totalCards < 3 ? "quiet" : activityScore >= 8 ? "activity" : "discovery";

  const response: ScoutSurfaceResponse = {
    generatedAt: new Date().toISOString(),
    mode,
    map: {
      markers: Array.from(markerById.values()),
    },
    sections,
  };

  if (hasLocation) {
    response.location = {
      lat: Number(lat),
      lng: Number(lng),
      radiusMiles,
    };
  }

  return response;
}
