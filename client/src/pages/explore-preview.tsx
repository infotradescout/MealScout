import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarDays,
  ChevronRight,
  Flame,
  Heart,
  MapPin,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  Tag,
  Utensils,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import {
  GoogleMapSurface,
  preloadGoogleMapsScript,
} from "@/components/maps/google-map-surface";
import { MapErrorBoundary } from "@/components/maps/map-error-boundary";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import { SVGStreetMap } from "@/components/maps/svg-street-map";
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";

/**
 * /scout — The canonical MealScout food discovery page.
 * Legacy explore routes redirect here from App.tsx.
 *
 * Goals (from Thomas):
 *  1. Live interactive Google Map REPLACES the food-park hero photo.
 *  2. The user's location is centered such that their pin renders in the
 *     RIGHT QUADRANT of the visible hero map. (The hero text on the left
 *     visually balances the layout.)
 *  3. No "Explore the Map" CTA — the map IS the page.
 *  4. Section order under the hero: Live Now first, Explore by Craving
 *     second, then restored discovery sections (Deals, Events, Favorites).
 *  5. Pull DOWN on the page → map full-screens. A floating "Collapse"
 *     button (top-right of map) returns to default sheet position.
 *  6. Bottom nav drops "Scout" (it conflicted with Explore + the search
 *     button in the top bar). Four items: Explore / Saved / Alerts / Profile.
 */

/* ============================================================
   TYPES
   ============================================================ */

interface LiveTruckSummary {
  id: string;
  name: string;
  cuisineType?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  distance?: number | null;
  distanceMiles?: number | null;
  waitMinutes?: number | null;
  estimatedWaitMinutes?: number | null;
  vibe?: string | null;
  crowdLevel?: string | null;
  mobileOnline?: boolean;
  activeDealCount?: number | null;
}

type LiveTrucksResponse =
  | { trucks?: LiveTruckSummary[] }
  | LiveTruckSummary[]
  | null;

interface DealSummary {
  id: string;
  title?: string | null;
  description?: string | null;
  restaurantName?: string | null;
  imageUrl?: string | null;
  discountText?: string | null;
}

type DealsResponse = { deals?: DealSummary[] } | DealSummary[] | null;

interface EventSummary {
  id: string;
  title?: string | null;
  name?: string | null;
  startsAt?: string | null;
  startTime?: string | null;
  venueName?: string | null;
  locationName?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  venueLat?: number | null;
  venueLng?: number | null;
}

type EventsResponse = { events?: EventSummary[] } | EventSummary[] | null;

interface RestaurantSummary {
  id: string;
  businessName?: string | null;
  name?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  activeDealsCount?: number;
  activeDealCount?: number;
  favoriteCount?: number | null;
  followCount?: number | null;
  recommendationCount?: number | null;
  videoRecommendationCount?: number | null;
  communityActivityCount?: number | null;
  homeRankingScore?: number | null;
  homeRankingReason?: string | null;
  distanceMiles?: number | null;
  distance?: number | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}

interface MenuPreviewItem {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  priceCents?: number | null;
}

interface LocalMenuItemFeedItem extends MenuPreviewItem {
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  cuisineType?: string | null;
  distanceMiles?: number | null;
  dietaryTags?: string[] | null;
}

interface RestaurantRelationshipSnapshot {
  favoriteIds: Set<string>;
  followIds: Set<string>;
  recommendationIds: Set<string>;
}

interface ParkingPassListing {
  id: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  hostId?: string | null;
  hostName?: string | null;
  businessName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  spotImageUrl?: string | null;
  spotCount?: number | null;
  maxTrucks?: number | null;
  bookedSpots?: number | null;
  availableSpotNumbers?: number[] | null;
  availableSpots?: number | null;
  hostPriceCents?: number | null;
  breakfastPriceCents?: number | null;
  lunchPriceCents?: number | null;
  dinnerPriceCents?: number | null;
  dailyPriceCents?: number | null;
  weeklyPriceCents?: number | null;
  monthlyPriceCents?: number | null;
  paymentsEnabled?: boolean | null;
  status?: string | null;
  seriesStatus?: string | null;
  seriesPublishedAt?: string | null;
  publishedAt?: string | null;
  deletedAt?: string | null;
  archivedAt?: string | null;
  cancelledAt?: string | null;
  canceledAt?: string | null;
  expiresAt?: string | null;
  endDate?: string | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
  isDeleted?: boolean | null;
  isCancelled?: boolean | null;
  isCanceled?: boolean | null;
  isAvailable?: boolean | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  host?: {
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    imageUrl?: string | null;
    spotImageUrl?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    deletedAt?: string | null;
    archivedAt?: string | null;
    isActive?: boolean | null;
    isArchived?: boolean | null;
    isDeleted?: boolean | null;
  } | null;
}

type CravingCategory = {
  id: string;
  label: string;
  image: string;
  query: string;
};

const CRAVING_CATEGORIES: CravingCategory[] = [
  { id: "tacos",   label: "Tacos",   image: "/atmospheric/craving-tacos.jpg",   query: "tacos"   },
  { id: "burgers", label: "Burgers", image: "/atmospheric/craving-burgers.jpg", query: "burgers" },
  { id: "ramen",   label: "Ramen",   image: "/atmospheric/craving-ramen.jpg",   query: "ramen"   },
  { id: "pizza",   label: "Pizza",   image: "/atmospheric/craving-pizza.jpg",   query: "pizza"   },
  { id: "drinks",  label: "Drinks",  image: "/atmospheric/craving-drinks.jpg",  query: "drinks"  },
  { id: "dessert", label: "Dessert", image: "/atmospheric/craving-dessert.jpg", query: "dessert" },
];

type DiscoveryLayerId =
  | "liveNow"
  | "localBoard"
  | "cravings"
  | "menuItems"
  | "foodTrucks"
  | "restaurants"
  | "parkingHosts"
  | "deals"
  | "events"
  | "saved";

const DISCOVERY_LAYERS: Record<
  DiscoveryLayerId,
  { title: string; href: string; subtitle?: string }
> = {
  liveNow: {
    title: "Live Now",
    href: "/truck-discovery",
    subtitle: "Trucks broadcasting service nearby right now.",
  },
  localBoard: {
    title: "Today's Food Board",
    href: "/scout",
    subtitle: "Your local dashboard for independent food discovery.",
  },
  cravings: {
    title: "Explore by Craving",
    href: "/find-food",
    subtitle: "Jump into local food by mood, not by chain category.",
  },
  menuItems: {
    title: "New Local Menu Items",
    href: "/find-food",
    subtitle: "Freshly available dishes from nearby restaurants and trucks.",
  },
  foodTrucks: {
    title: "Food Trucks Near You",
    href: "/truck-discovery",
    subtitle: "All nearby trucks that are broadcasting or ready to be discovered.",
  },
  restaurants: {
    title: "Restaurants Near You",
    href: "/find-food",
    subtitle: "Local restaurants and bars worth knowing about - not a fast-food feed.",
  },
  parkingHosts: {
    title: "Parking Pass Hosts",
    href: "/parking-pass",
    subtitle: "Host locations are places that let food trucks park, serve, and build a route.",
  },
  deals: {
    title: "Deals Near You",
    href: "/deals",
    subtitle: "Active offers from nearby restaurants, bars, and food trucks.",
  },
  events: {
    title: "Happening Tonight",
    href: "/events",
    subtitle: "Upcoming events, pop-ups, and food nights near you.",
  },
  saved: {
    title: "Your Saved",
    href: "/favorites",
    subtitle: "Your personal shortlist for trucks, restaurants, deals, and places to revisit.",
  },
};

/* ============================================================
   FORMATTERS
   ============================================================ */

function formatDistance(truck: LiveTruckSummary): string | null {
  const miles = truck.distanceMiles;
  if (typeof miles === "number" && Number.isFinite(miles)) {
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }
  const km = truck.distance;
  if (typeof km === "number" && Number.isFinite(km)) {
    const asMiles = km * 0.621371;
    return `${asMiles.toFixed(asMiles < 10 ? 1 : 0)} mi`;
  }
  return null;
}

function formatWait(truck: LiveTruckSummary): string | null {
  const wait = truck.waitMinutes ?? truck.estimatedWaitMinutes;
  if (typeof wait === "number" && Number.isFinite(wait) && wait > 0) {
    return `${Math.round(wait)} min wait`;
  }
  return null;
}

function getCrowdVibe(truck: LiveTruckSummary): { label: string } {
  const raw = (truck.crowdLevel || truck.vibe || "").toLowerCase();
  if (raw.includes("hot") || raw.includes("packed")) return { label: "Crowd is Hot" };
  if (raw.includes("busy")) return { label: "Busy Right Now" };
  if (raw.includes("lively")) return { label: "Lively Crowd" };
  return { label: "Open & Serving" };
}

function getGreetingTime(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

const SCOUT_TRUCK_RADIUS_KM = 8; // about 5 miles
const SCOUT_LOCAL_RADIUS_KM = 12; // about 7.5 miles
const SCOUT_EVENT_RADIUS_KM = 24; // events can justify a slightly wider local lane

type ScoutCoords = { lat: number; lng: number };

function toScoutNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceKmBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isWithinScoutRadius(
  origin: ScoutCoords | null,
  latValue: unknown,
  lngValue: unknown,
  radiusKm: number,
  fallbackDistanceKm?: number | null,
): boolean {
  if (!origin) return false;
  const lat = toScoutNumber(latValue);
  const lng = toScoutNumber(lngValue);
  if (lat !== null && lng !== null) {
    return distanceKmBetween(origin.lat, origin.lng, lat, lng) <= radiusKm;
  }
  if (typeof fallbackDistanceKm === "number" && Number.isFinite(fallbackDistanceKm)) {
    return fallbackDistanceKm <= radiusKm;
  }
  return false;
}

const BLOCKED_PARKING_PASS_STATUSES = new Set([
  "archived",
  "cancelled",
  "canceled",
  "closed",
  "completed",
  "deleted",
  "disabled",
  "draft",
  "expired",
  "inactive",
  "unavailable",
]);

function normalizeScoutStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parkingPassHasAvailability(listing: ParkingPassListing): boolean {
  if (Array.isArray(listing.availableSpotNumbers)) {
    return listing.availableSpotNumbers.length > 0;
  }
  if (typeof listing.availableSpots === "number") {
    return listing.availableSpots > 0;
  }
  const capacity = Number(listing.spotCount ?? listing.maxTrucks ?? 0);
  const booked = Number(listing.bookedSpots ?? 0);
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  if (!Number.isFinite(booked)) return true;
  return capacity - booked > 0;
}

function parkingPassIsCurrent(listing: ParkingPassListing): boolean {
  const rawDate = listing.date ?? listing.endDate ?? listing.expiresAt;
  if (!rawDate) return true;
  const parsed = new Date(rawDate);
  if (!Number.isFinite(parsed.getTime())) return true;
  const endTime = String(listing.endTime || "").trim();
  const match = endTime.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    parsed.setHours(Number(match[1]), Number(match[2]), 0, 0);
  }
  return parsed.getTime() >= Date.now() - 30 * 60 * 1000;
}

function isParkingPassListingRenderable(listing: ParkingPassListing): boolean {
  const status = normalizeScoutStatus(listing.status || "open");
  const seriesStatus = normalizeScoutStatus(listing.seriesStatus || "published");
  if (BLOCKED_PARKING_PASS_STATUSES.has(status)) return false;
  if (seriesStatus && seriesStatus !== "published") return false;
  if (listing.isActive === false || listing.host?.isActive === false) return false;
  if (listing.isAvailable === false) return false;
  if (listing.isArchived || listing.host?.isArchived) return false;
  if (listing.isDeleted || listing.host?.isDeleted) return false;
  if (listing.isCancelled || listing.isCanceled) return false;
  if (
    listing.deletedAt ||
    listing.archivedAt ||
    listing.cancelledAt ||
    listing.canceledAt ||
    listing.host?.deletedAt ||
    listing.host?.archivedAt
  ) {
    return false;
  }
  if (!parkingPassIsCurrent(listing)) return false;
  return parkingPassHasAvailability(listing);
}

function extractMenuPreviewItems(data: any): MenuPreviewItem[] {
  const menus = Array.isArray(data?.menus) ? data.menus : [];
  const items: MenuPreviewItem[] = [];
  const seen = new Set<string>();
  for (const menu of menus) {
    const categoryItems = Array.isArray(menu?.categories)
      ? menu.categories.flatMap((category: any) =>
          Array.isArray(category?.items) ? category.items : [],
        )
      : [];
    const uncategorized = Array.isArray(menu?.uncategorizedItems)
      ? menu.uncategorizedItems
      : [];
    for (const item of [...categoryItems, ...uncategorized]) {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || "").trim();
      if (!id || !name || seen.has(id) || item?.isAvailable === false) continue;
      seen.add(id);
      items.push({
        id,
        name,
        description: item?.description ?? null,
        imageUrl: item?.imageUrl ?? null,
        priceCents:
          typeof item?.priceCents === "number" && Number.isFinite(item.priceCents)
            ? item.priceCents
            : null,
      });
      if (items.length >= 3) return items;
    }
  }
  return items;
}

/* ============================================================
   MAP CENTER OFFSET
   ----
   To place the user's pin in the RIGHT QUADRANT of the visible
   hero map, we shift the *map center* WEST of the user by ~1/4
   of the visible longitude span at the current zoom. The user
   coordinate then renders at roughly x = 75% across the viewport.
   ============================================================ */

function shiftCenterForRightQuadrant(
  lat: number,
  lng: number,
  zoom: number,
): { lat: number; lng: number } {
  // Rough longitude span at a given zoom level for a ~430px-wide viewport.
  // 360 deg / 2^zoom ~= world span per 256px tile, scaled for viewport.
  const tilesAcross = 430 / 256;
  const lngSpan = (360 / Math.pow(2, zoom)) * tilesAcross;
  // Shift center ~25% west so user pin lands in the right ~75% column.
  const lngOffset = lngSpan * 0.25;
  return { lat, lng: lng - lngOffset };
}

/* ============================================================
   PAGE
   ============================================================ */

export default function ExplorePreview() {
  const { user } = useAuth();
  const [, navigate] = useWouterLocation();

  const firstName =
    typeof user?.name === "string" && user.name.trim().length > 0
      ? user.name.trim().split(" ")[0]
      : null;

  /* --------- location --------- */

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState<string>("Your area");
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "ready" | "denied"
  >("idle");

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocationStatus("ready");
        getReverseGeocodedLocationName(latitude, longitude, (name) => {
          if (name) setLocationName(name);
        }).catch(() => {});
      },
      () => {
        setLocationStatus("denied");
      },
      { timeout: 10000, maximumAge: 0 },
    );
  }, []);

  // Auto-request on mount
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const shortLocation = useMemo(() => {
    if (!locationName) return "Your area";
    return locationName.split(",")[0] || locationName;
  }, [locationName]);

  /* --------- live trucks --------- */

  const {
    data: liveTrucksData,
    isLoading: liveTrucksLoading,
    isError: liveTrucksError,
  } = useQuery<LiveTrucksResponse>({
    queryKey: coords
      ? ["/api/trucks/live", coords.lat, coords.lng]
      : ["/api/trucks/live", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return { trucks: [] };
      const response = await fetch(
        `/api/trucks/live?lat=${coords.lat}&lng=${coords.lng}&radiusKm=${SCOUT_TRUCK_RADIUS_KM}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load live trucks");
      return response.json();
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const liveTrucks = useMemo<LiveTruckSummary[]>(() => {
    if (!liveTrucksData) return [];
    const raw = Array.isArray(liveTrucksData)
      ? liveTrucksData
      : Array.isArray(liveTrucksData.trucks)
        ? liveTrucksData.trucks
        : [];
    return raw.filter((truck) => {
      const fallbackKm =
        typeof truck.distanceMiles === "number"
          ? truck.distanceMiles * 1.609344
          : typeof truck.distance === "number"
            ? truck.distance
            : null;
      return isWithinScoutRadius(
        coords,
        truck.latitude ?? truck.lat,
        truck.longitude ?? truck.lng,
        SCOUT_TRUCK_RADIUS_KM,
        fallbackKm,
      );
    });
  }, [coords, liveTrucksData]);

  /* --------- featured deals --------- */

  const { data: dealsData } = useQuery<DealsResponse>({
    queryKey: ["/api/deals/featured"],
    queryFn: async () => {
      const response = await fetch(`/api/deals/featured`, {
        credentials: "include",
      });
      if (!response.ok) return { deals: [] };
      return response.json();
    },
    staleTime: 60_000,
  });

  const deals = useMemo<DealSummary[]>(() => {
    if (!dealsData) return [];
    if (Array.isArray(dealsData)) return dealsData;
    if (Array.isArray(dealsData.deals)) return dealsData.deals;
    return [];
  }, [dealsData]);

  /* --------- events --------- */

  const { data: eventsData } = useQuery<EventsResponse>({
    queryKey: ["/api/events/public"],
    enabled: !!coords,
    queryFn: async () => {
      const response = await fetch(`/api/events/public`, {
        credentials: "include",
      });
      if (!response.ok) return { events: [] };
      return response.json();
    },
    staleTime: 60_000,
  });

  const events = useMemo<EventSummary[]>(() => {
    if (!eventsData) return [];
    if (Array.isArray(eventsData)) return eventsData;
    if (Array.isArray(eventsData.events)) return eventsData.events;
    return [];
  }, [eventsData]);

  const visibleEvents = useMemo<EventSummary[]>(() => {
    return events.filter((event) =>
      isWithinScoutRadius(
        coords,
        event.latitude ?? event.lat ?? event.venueLat,
        event.longitude ?? event.lng ?? event.venueLng,
        SCOUT_EVENT_RADIUS_KM,
      ),
    );
  }, [coords, events]);

  /* --------- nearby restaurants --------- */

  const { data: nearbyRestaurantsData, isLoading: nearbyRestaurantsLoading } = useQuery<RestaurantSummary[]>({
    queryKey: coords
      ? ["/api/restaurants/subscribed", coords.lat, coords.lng]
      : ["/api/restaurants/subscribed", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/restaurants/subscribed/${coords.lat}/${coords.lng}?radius=${SCOUT_LOCAL_RADIUS_KM}`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 120_000,
  });

  const nearbyRestaurants = useMemo<RestaurantSummary[]>(() => {
    if (!nearbyRestaurantsData) return [];
    if (!Array.isArray(nearbyRestaurantsData)) return [];
    return nearbyRestaurantsData.filter((restaurant) => {
      const fallbackKm =
        typeof restaurant.distanceMiles === "number"
          ? restaurant.distanceMiles * 1.609344
          : typeof restaurant.distance === "number"
            ? restaurant.distance
            : null;
      return isWithinScoutRadius(
        coords,
        restaurant.latitude ?? restaurant.lat,
        restaurant.longitude ?? restaurant.lng,
        SCOUT_LOCAL_RADIUS_KM,
        fallbackKm,
      );
    });
  }, [coords, nearbyRestaurantsData]);

  const restaurantMenuPreviewQueries = useQueries({
    queries: nearbyRestaurants.slice(0, 8).map((restaurant) => ({
      queryKey: ["/api/menus", restaurant.id, "scout-preview"],
      queryFn: async () => {
        const response = await fetch(
          `/api/menus/${encodeURIComponent(String(restaurant.id))}`,
          { credentials: "include" },
        );
        if (!response.ok) return [];
        const data = await response.json();
        return extractMenuPreviewItems(data);
      },
      staleTime: 120_000,
      retry: false,
    })),
  });

  const menuPreviewByRestaurantId = useMemo(() => {
    const map = new Map<string, MenuPreviewItem[]>();
    nearbyRestaurants.slice(0, 8).forEach((restaurant, index) => {
      const result = restaurantMenuPreviewQueries[index];
      map.set(
        String(restaurant.id),
        Array.isArray(result?.data) ? result.data : [],
      );
    });
    return map;
  }, [nearbyRestaurants, restaurantMenuPreviewQueries]);

  const { data: localMenuItemsData = [] } = useQuery<LocalMenuItemFeedItem[]>({
    queryKey: coords
      ? ["/api/menus/local-items", coords.lat, coords.lng]
      : ["/api/menus/local-items", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/menus/local-items?lat=${coords.lat}&lng=${coords.lng}&radiusKm=${SCOUT_LOCAL_RADIUS_KM}&limit=24`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data?.items) ? data.items : [];
    },
    staleTime: 120_000,
    retry: false,
  });

  const localMenuItems = useMemo<LocalMenuItemFeedItem[]>(() => {
    return Array.isArray(localMenuItemsData) ? localMenuItemsData : [];
  }, [localMenuItemsData]);

  const { data: favoriteRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/favorites/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/favorites/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const { data: followedRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/following/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/following/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const { data: recommendedRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/recommendations/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/recommendations/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const restaurantRelationships = useMemo<RestaurantRelationshipSnapshot>(() => {
    const pickId = (row: any) =>
      String(row?.restaurantId || row?.restaurant?.id || "").trim();
    return {
      favoriteIds: new Set(
        favoriteRestaurantsData.map(pickId).filter((id) => id.length > 0),
      ),
      followIds: new Set(
        followedRestaurantsData.map(pickId).filter((id) => id.length > 0),
      ),
      recommendationIds: new Set(
        recommendedRestaurantsData.map(pickId).filter((id) => id.length > 0),
      ),
    };
  }, [
    favoriteRestaurantsData,
    followedRestaurantsData,
    recommendedRestaurantsData,
  ]);

  const savedRestaurants = useMemo<RestaurantSummary[]>(() => {
    return favoriteRestaurantsData
      .map((favorite: any) => favorite?.restaurant)
      .filter((restaurant: any): restaurant is RestaurantSummary =>
        Boolean(restaurant?.id),
      );
  }, [favoriteRestaurantsData]);

  /* --------- parking pass hosts --------- */

  const { data: parkingPassData, isLoading: parkingPassLoading } = useQuery<ParkingPassListing[]>({
    queryKey: ["/api/parking-pass"],
    enabled: !!coords,
    queryFn: async () => {
      const response = await fetch("/api/parking-pass", { credentials: "include" });
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.listings)) return data.listings;
      if (Array.isArray(data.passes)) return data.passes;
      return [];
    },
    staleTime: 120_000,
  });

  const parkingPassHosts = useMemo<ParkingPassListing[]>(() => {
    if (!parkingPassData) return [];
    if (Array.isArray(parkingPassData)) return parkingPassData;
    return [];
  }, [parkingPassData]);

  const localParkingPassHosts = useMemo<ParkingPassListing[]>(() => {
    return parkingPassHosts.filter((listing) => {
      if (!isParkingPassListingRenderable(listing)) return false;
      return isWithinScoutRadius(
        coords,
        listing.latitude ?? listing.host?.latitude,
        listing.longitude ?? listing.host?.longitude,
        SCOUT_LOCAL_RADIUS_KM,
      );
    });
  }, [coords, parkingPassHosts]);

  /* --------- nearby deals (location-aware) --------- */

  const { data: nearbyDealsData } = useQuery<DealSummary[]>({
    queryKey: coords
      ? ["/api/deals/nearby", coords.lat, coords.lng]
      : ["/api/deals/nearby", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/deals/nearby/${coords.lat}/${coords.lng}?radius=${SCOUT_LOCAL_RADIUS_KM}`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.deals)) return data.deals;
      return [];
    },
    staleTime: 60_000,
  });

  const nearbyDeals = useMemo<DealSummary[]>(() => {
    if (!nearbyDealsData) return [];
    if (Array.isArray(nearbyDealsData)) return nearbyDealsData;
    return [];
  }, [nearbyDealsData]);

  // Scout is a local dashboard. Do not leak global featured deals into this lane.
  const allDeals = useMemo<DealSummary[]>(() => {
    const seen = new Set<string>();
    const merged: DealSummary[] = [];
    for (const d of nearbyDeals) {
      if (!seen.has(d.id)) { seen.add(d.id); merged.push(d); }
    }
    return merged;
  }, [nearbyDeals]);

  /* --------- markers for the hero map --------- */

  const truckMarkers = useMemo<MapAdapterMarker[]>(() => {
    return liveTrucks
      .map((t) => {
        const lat = t.latitude ?? t.lat;
        const lng = t.longitude ?? t.lng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        return {
          id: String(t.id),
          sourceId: String(t.id),
          kind: "truck" as const,
          lat,
          lng,
          title: t.name,
          subtitle: t.cuisineType ?? undefined,
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [liveTrucks]);

  const restaurantMarkers = useMemo<MapAdapterMarker[]>(() => {
    return nearbyRestaurants
      .map((r) => {
        const lat = r.latitude ?? r.lat;
        const lng = r.longitude ?? r.lng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        return {
          id: `restaurant-${r.id}`,
          sourceId: String(r.id),
          kind: "restaurant" as const,
          lat,
          lng,
          title: r.businessName ?? r.name ?? undefined,
          subtitle: r.cuisineType ?? undefined,
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [nearbyRestaurants]);

  const parkingMarkers = useMemo<MapAdapterMarker[]>(() => {
    return localParkingPassHosts
      .map((p) => {
        const parseCoord = (value: number | string | null | undefined) => {
          if (value === null || value === undefined) return null;
          const parsed = typeof value === "string" ? Number(value) : value;
          return Number.isFinite(parsed) ? parsed : null;
        };
        // Coordinates may be on the listing directly or nested under host.
        const lat = parseCoord(p.latitude ?? p.host?.latitude);
        const lng = parseCoord(p.longitude ?? p.host?.longitude);
        if (lat === null || lng === null) return null;
        const name = p.businessName ?? p.hostName ?? p.host?.businessName ?? undefined;
        const capacity = p.spotCount ?? p.maxTrucks ?? null;
        const openSpots = Array.isArray(p.availableSpotNumbers)
          ? p.availableSpotNumbers.length
          : typeof p.availableSpots === "number"
            ? p.availableSpots
            : typeof capacity === "number" && typeof p.bookedSpots === "number"
              ? Math.max(0, capacity - p.bookedSpots)
              : null;
        return {
          id: `parking-${p.id}`,
          sourceId: String(p.id),
          kind: "parking" as const,
          lat,
          lng,
          title: name,
          subtitle:
            typeof openSpots === "number" && openSpots >= 0
              ? `${openSpots} spot${openSpots === 1 ? "" : "s"} open`
              : undefined,
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [localParkingPassHosts]);

  const eventMarkers = useMemo<MapAdapterMarker[]>(() => {
    return visibleEvents
      .map((e) => {
        const lat = e.latitude ?? e.lat ?? e.venueLat;
        const lng = e.longitude ?? e.lng ?? e.venueLng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        return {
          id: `event-${e.id}`,
          sourceId: String(e.id),
          kind: "event" as const,
          lat,
          lng,
          title: e.title ?? e.name ?? undefined,
          subtitle: e.venueName ?? e.locationName ?? undefined,
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [visibleEvents]);

  // Combined markers for the full Google Map view
  const allMapMarkers = useMemo<MapAdapterMarker[]>(
    () => [...truckMarkers, ...restaurantMarkers, ...parkingMarkers, ...eventMarkers],
    [truckMarkers, restaurantMarkers, parkingMarkers, eventMarkers],
  );

  /* --------- map state --------- */

  const HERO_ZOOM = 14;
  const [mapZoom, setMapZoom] = useState<number>(HERO_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const userPushedMapRef = useRef(false);
  const [sheetState, setSheetState] = useState<"default" | "fullMap">("default");
  // Once the full map has been opened once, keep GoogleMapSurface mounted
  // (just hidden) so it doesn't re-initialize on every collapse/expand.
  // Using state (not ref) so React re-renders when the map should first mount.
  const [hasOpenedFullMap, setHasOpenedFullMap] = useState(false);
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
  const hasMapKey = GOOGLE_MAPS_WEB_API_KEY.length > 0;

  const openScoutMap = useCallback(() => {
    if (coords) {
      setMapCenter(coords);
    }
    setHasOpenedFullMap(true);
    setGoogleMapFailed(false);
    setSheetState("fullMap");
  }, [coords]);

  useEffect(() => {
    if (!hasMapKey) return;
    if (sheetState !== "default") return;
    if (typeof window === "undefined") return;
    const connection = (navigator as any).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const startPrefetch = () => {
      if (cancelled) return;
      if (window.location.pathname !== "/scout") return;
      preloadGoogleMapsScript(GOOGLE_MAPS_WEB_API_KEY);
    };

    timeoutId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(startPrefetch, {
          timeout: 2500,
        });
        return;
      }
      startPrefetch();
    }, 2500);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [hasMapKey, sheetState]);

  // When we first get coords, set the map center to the right-quadrant offset.
  useEffect(() => {
    if (!coords || userPushedMapRef.current) return;
    setMapCenter(shiftCenterForRightQuadrant(coords.lat, coords.lng, HERO_ZOOM));
  }, [coords]);

  const handleMapBoundsChanged = useCallback((_b: MapBoundsLike) => {
    /* no-op for preview */
  }, []);
  const handleMapZoomChanged = useCallback((z: number) => {
    setMapZoom(z);
    userPushedMapRef.current = true;
  }, []);
  const handleMapCenterChanged = useCallback((c: { lat: number; lng: number }) => {
    setMapCenter(c);
    userPushedMapRef.current = true;
  }, []);
  const handleMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      if (marker.kind === "truck") navigate(`/truck/${marker.sourceId}`);
      else if (marker.kind === "restaurant") navigate(`/restaurant/${marker.sourceId}`);
      else if (marker.kind === "parking") navigate(`/parking-pass`);
      else if (marker.kind === "event") navigate(`/events`);
    },
    [navigate],
  );

  /* --------- pull-down-to-fullscreen sheet --------- */

  // When sheetState transitions to fullMap:
  // 1. Set hasOpenedFullMap so GoogleMapSurface mounts for the first time.
  // 2. After the 320ms CSS height transition completes, fire a resize event
  //    so Google Maps re-tiles to the full 100dvh container dimensions.
  useEffect(() => {
    if (sheetState === "fullMap") {
      setHasOpenedFullMap(true);
      const timer = setTimeout(() => {
        // Dispatch a native resize event on the window — Google Maps listens
        // for this and re-tiles automatically.
        window.dispatchEvent(new Event("resize"));
      }, 340); // slightly after the 320ms CSS transition
      return () => clearTimeout(timer);
    }
  }, [sheetState]);

  const dragStartY = useRef<number | null>(null);
  const dragLastY = useRef<number | null>(null);
  const mouseDragStartY = useRef<number | null>(null);
  const mouseDragLastY = useRef<number | null>(null);
  const topPullStartY = useRef<number | null>(null);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragLastY.current = e.touches[0].clientY;
  }, []);
  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    dragLastY.current = y;
  }, []);
  const handleSheetTouchEnd = useCallback(() => {
    const start = dragStartY.current;
    const last = dragLastY.current;
    dragStartY.current = null;
    dragLastY.current = null;
    if (start === null || last === null) return;
    const delta = last - start;
    // On the MAP hero: swipe DOWN (delta > 0) expands to fullMap.
    // On the DRAG HANDLE: swipe UP (delta < 0) also expands to fullMap.
    // Either direction works — we just check both thresholds.
    if (Math.abs(delta) > 40 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -40 && sheetState === "fullMap") {
      setSheetState("default");
    }
  }, [openScoutMap, sheetState]);

  const handleSheetMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDragStartY.current = e.clientY;
    mouseDragLastY.current = e.clientY;
  }, []);

  const handleSheetMouseMove = useCallback((e: React.MouseEvent) => {
    if (mouseDragStartY.current === null) return;
    mouseDragLastY.current = e.clientY;
  }, []);

  const handleSheetMouseUp = useCallback(() => {
    const start = mouseDragStartY.current;
    const last = mouseDragLastY.current;
    mouseDragStartY.current = null;
    mouseDragLastY.current = null;
    if (start === null || last === null) return;
    const delta = last - start;
    if (Math.abs(delta) > 24 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -24 && sheetState === "fullMap") {
      setSheetState("default");
    }
  }, [openScoutMap, sheetState]);

  useEffect(() => {
    if (sheetState !== "default") return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverscroll = html.style.overscrollBehaviorY;
    const previousBodyOverscroll = body.style.overscrollBehaviorY;

    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    const handleTopPullStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0) {
        topPullStartY.current = null;
        return;
      }
      topPullStartY.current = e.touches[0].clientY;
    };

    const handleTopPullMove = (e: TouchEvent) => {
      const start = topPullStartY.current;
      if (start === null || e.touches.length !== 1 || window.scrollY > 0) return;
      const delta = e.touches[0].clientY - start;
      if (delta > 10 && e.cancelable) e.preventDefault();
    };

    const handleTopPullEnd = (e: TouchEvent) => {
      const start = topPullStartY.current;
      topPullStartY.current = null;
      if (start === null || window.scrollY > 0 || e.changedTouches.length === 0) return;
      const delta = e.changedTouches[0].clientY - start;
      if (delta > 40) openScoutMap();
    };

    document.addEventListener("touchstart", handleTopPullStart, { passive: true });
    document.addEventListener("touchmove", handleTopPullMove, { passive: false });
    document.addEventListener("touchend", handleTopPullEnd, { passive: true });
    document.addEventListener("touchcancel", handleTopPullEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTopPullStart);
      document.removeEventListener("touchmove", handleTopPullMove);
      document.removeEventListener("touchend", handleTopPullEnd);
      document.removeEventListener("touchcancel", handleTopPullEnd);
      html.style.overscrollBehaviorY = previousHtmlOverscroll;
      body.style.overscrollBehaviorY = previousBodyOverscroll;
      topPullStartY.current = null;
    };
  }, [openScoutMap, sheetState]);

  /* --------- greeting --------- */

  const greetingTime = getGreetingTime();
  const greetingFirstLine = `Good ${greetingTime},`;
  const greetingSecondLine = firstName ? `${firstName}.` : "Welcome.";

  /* --------- render --------- */

  const goToCraving = (cat: CravingCategory) => {
    navigate(`/search?q=${encodeURIComponent(cat.query)}`);
  };

  const showFoodTrucksSection = liveTrucksLoading || liveTrucks.length > 0;
  const showMenuItemsSection = localMenuItems.length > 0;
  const showRestaurantsSection =
    nearbyRestaurantsLoading || nearbyRestaurants.length > 0;
  const showParkingHostsSection = parkingPassLoading || localParkingPassHosts.length > 0;
  const showDealsSection = allDeals.length > 0;
  const showEventsSection = visibleEvents.length > 0;
  const localSignalCount =
    liveTrucks.length +
    localMenuItems.length +
    nearbyRestaurants.length +
    localParkingPassHosts.length +
    allDeals.length +
    visibleEvents.length;

  return (
    <>
      <SEOHead
        title="Scout | MealScout — Follow The Flavor."
        description="Discover live food trucks, restaurants, and deals near you. MealScout puts the local food scene right in your hands."
      />

      {/* True-black page base */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none bg-[#0a0c10]"
      />

      <main
        className={`relative z-10 ${
          sheetState === "fullMap" ? "" : "pb-36"
        }`}
        style={{ overscrollBehaviorY: "none" }}
      >
        {/* ============================================================
             HERO MAP — live Google Map. When sheetState === "fullMap"
             the map fills the viewport. Otherwise it occupies ~58vh
             behind the hero text + sits above the lower content sheet.
           ============================================================ */}
        <section
          data-testid="scout-map-container"
          className="relative w-full overflow-hidden"
          style={{
            height:
              sheetState === "fullMap" ? "100dvh" : "min(38vh, 320px)",
            transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
            touchAction: sheetState === "fullMap" ? "auto" : "none",
            overscrollBehaviorY: "none",
          }}
          onTouchStart={sheetState !== "fullMap" ? handleSheetTouchStart : undefined}
          onTouchMove={sheetState !== "fullMap" ? handleSheetTouchMove : undefined}
          onTouchEnd={sheetState !== "fullMap" ? handleSheetTouchEnd : undefined}
          onMouseDown={sheetState !== "fullMap" ? handleSheetMouseDown : undefined}
          onMouseMove={sheetState !== "fullMap" ? handleSheetMouseMove : undefined}
          onMouseUp={sheetState !== "fullMap" ? handleSheetMouseUp : undefined}
          onMouseLeave={sheetState !== "fullMap" ? handleSheetMouseUp : undefined}
        >
          {/* Map
              ----
              DEFAULT state: a lightweight ScoutMapPreview
                that uses real map data but renders in MealScout's brand
                aesthetic — dark, glowing amber pins, user pin anchored to
                the right third, slow drift animation. NO Google Maps SDK
                is mounted in this state, so referrer/billing failures on
                the JS API can never break the hero.
              FULLMAP state: the real interactive Google Map widget
                (GoogleMapSurface) for full pan/zoom/tap-pin exploration.
          */}
          <div className="absolute inset-0">
            {/* ScoutMapPreview: atmospheric SVG hero — always mounted and
                Google-free. In full map mode it remains behind the Google
                canvas so expansion has an instant visual while the script
                finishes loading. */}
            <div
              data-testid="scout-map-preview"
              className="absolute inset-0"
              style={{
                visibility: "visible",
                pointerEvents: sheetState === "fullMap" ? "none" : "auto",
                zIndex: 0,
              }}
            >
              <ScoutMapPreview
                markers={allMapMarkers}
                userLocation={coords ?? { lat: 30.4213, lng: -87.2169 }}
              />
            </div>

            {/* GoogleMapSurface:
                - Only mounts the FIRST TIME sheetState becomes "fullMap"
                  (hasOpenedFullMapRef). This guarantees the map initializes
                  at full 100dvh height, not at the collapsed 38vh height.
                - Once mounted, stays mounted (keep-alive) so subsequent
                  collapse/expand cycles don't re-initialize.
                - Hidden (visibility:hidden, pointer-events:none) when
                  collapsed so it doesn't intercept hero touch events.
            */}
            {hasMapKey && !googleMapFailed && coords && mapCenter && hasOpenedFullMap ? (
              <div
                ref={googleMapContainerRef}
                data-testid="scout-interactive-map"
                className="absolute inset-0"
                style={{
                  visibility: sheetState === "fullMap" ? "visible" : "hidden",
                  pointerEvents: sheetState === "fullMap" ? "auto" : "none",
                  zIndex: sheetState === "fullMap" ? 1 : 0,
                }}
              >
                <MapErrorBoundary>
                  <GoogleMapSurface
                    apiKey={GOOGLE_MAPS_WEB_API_KEY}
                    center={mapCenter}
                    zoom={mapZoom}
                    markers={allMapMarkers}
                    showRoadTrafficLayer={false}
                    userLocation={coords}
                    isNightTheme={true}
                    onBoundsChanged={handleMapBoundsChanged}
                    onZoomChanged={handleMapZoomChanged}
                    onCenterChanged={handleMapCenterChanged}
                    onMarkerTap={handleMarkerTap}
                    onFatalError={() => setGoogleMapFailed(true)}
                  />
                </MapErrorBoundary>
              </div>
            ) : sheetState === "fullMap" && (googleMapFailed || !hasMapKey || !coords || !mapCenter) ? (
              <div
                data-testid="scout-interactive-map"
                className="absolute inset-0"
                style={{ zIndex: 1 }}
              >
                <HeroMapFallback
                  reason={
                    !hasMapKey || googleMapFailed
                      ? "no-key"
                      : locationStatus === "denied"
                        ? "denied"
                        : "loading"
                  }
                />
              </div>
            ) : null}
          </div>

          {/* Left-side gradient so headline reads cleanly. We KEEP the
              right side (where user pin lives) clear of overlay. */}
          {sheetState !== "fullMap" && (
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, rgba(8,10,15,0.78) 0%, rgba(8,10,15,0.55) 28%, rgba(8,10,15,0.20) 52%, rgba(8,10,15,0.00) 70%), linear-gradient(180deg, rgba(8,10,15,0.40) 0%, rgba(8,10,15,0.00) 26%, rgba(8,10,15,0.00) 70%, rgba(10,12,16,0.92) 100%)",
              }}
            />
          )}

          {/* Top bar */}
          {sheetState !== "fullMap" && (
            <div
              className="relative z-10 px-4 flex items-center gap-3"
              style={{
                paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
              }}
            >
              <Link
                href="/profile"
                aria-label="Open profile"
                className="flex items-center justify-center h-12 w-12 rounded-full overflow-hidden ring-2 ring-white/30 bg-[#120805]/60 backdrop-blur-md shrink-0"
              >
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt={firstName ? `${firstName}'s profile` : "Your profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-5 w-5 text-orange-300" aria-hidden="true" />
                )}
              </Link>

              <button
                type="button"
                onClick={requestLocation}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full text-white text-sm font-medium px-4 bg-[#120805]/55 backdrop-blur-md ring-1 ring-white/15 active:scale-95 transition-transform"
                aria-label={`Refresh location. Currently ${shortLocation}.`}
              >
                {locationStatus === "requesting" ? (
                  <svg className="h-4 w-4 text-orange-300 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <MapPin className="h-4 w-4 text-orange-300" aria-hidden="true" />
                )}
                <span className="truncate max-w-[180px]">{shortLocation}</span>
              </button>

              <button
                type="button"
                onClick={openScoutMap}
                aria-label="Expand map to fullscreen"
                className="flex items-center justify-center h-12 w-12 rounded-full bg-[#120805]/55 backdrop-blur-md ring-1 ring-orange-300/40 shrink-0"
                style={{ boxShadow: "0 0 14px rgba(255,90,47,0.3)" }}
              >
                <Maximize2 className="h-5 w-5 text-orange-300" aria-hidden="true" />
              </button>
            </div>
          )}





          {/* Floating "Collapse" button (top-right) — visible in fullMap state. */}
          {sheetState === "fullMap" && (
            <button
              type="button"
              onClick={() => setSheetState("default")}
              aria-label="Collapse map and return to discover"
              className="absolute z-30 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] inline-flex items-center gap-2 h-12 px-4 rounded-full bg-[#120805]/75 backdrop-blur-md ring-1 ring-orange-300/60 text-orange-100 font-semibold"
              style={{
                boxShadow: "0 0 22px rgba(255,90,47,0.45)",
              }}
            >
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm">Collapse</span>
            </button>
          )}

          {/* Pull bar indicator (default state) */}
          {sheetState === "default" && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20"
              aria-hidden="true"
            >
              <span className="block h-1 w-8 rounded-full bg-white/25" />
            </div>
          )}
        </section>

        {/* ============================================================
             LOWER SHEET — discovery sections. Hidden when fullMap.
             Touch-swipe handlers live on a thin drag handle at the top.
           ============================================================ */}
        {sheetState !== "fullMap" && (
          <div
            className="relative z-10 -mt-4 rounded-t-3xl bg-[#0a0c10]"
            style={{ boxShadow: "0 -24px 48px rgba(0,0,0,0.55)" }}
          >
            {/* Drag handle — pull UP on this to expand map, pull DOWN to stay */}
            <div
              role="button"
              aria-label="Pull up to expand map"
              tabIndex={0}
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              onMouseDown={handleSheetMouseDown}
              onMouseMove={handleSheetMouseMove}
              onMouseUp={handleSheetMouseUp}
              onMouseLeave={handleSheetMouseUp}
              onClick={openScoutMap}
              className="w-full h-10 flex items-center justify-center cursor-pointer"
              style={{ touchAction: "none" }}
            >
              <span
                aria-hidden="true"
                className="block h-1.5 w-12 rounded-full bg-white/30"
              />
            </div>

            {/* LIVE NOW — collapsed when empty, expanded when trucks are live */}
            <LiveNowSection
              liveTrucks={liveTrucks}
              liveTrucksLoading={liveTrucksLoading}
              liveTrucksError={!!liveTrucksError}
              locationStatus={locationStatus}
              onExpandMap={openScoutMap}
            />

            <LocalFoodDashboard
              locationLabel={shortLocation}
              locationStatus={locationStatus}
              liveTruckCount={liveTrucks.length}
              restaurantCount={nearbyRestaurants.length}
              menuItemCount={localMenuItems.length}
              parkingHostCount={localParkingPassHosts.length}
              dealCount={allDeals.length}
              eventCount={visibleEvents.length}
              localSignalCount={localSignalCount}
              onRefreshLocation={requestLocation}
              onOpenMap={openScoutMap}
            />

            {/* ── EXPLORE BY CRAVING ── */}
            <section className="px-5 pt-2 pb-10">
              <SectionHeader
                title={DISCOVERY_LAYERS.cravings.title}
                linkHref={DISCOVERY_LAYERS.cravings.href}
                subtitle={DISCOVERY_LAYERS.cravings.subtitle}
              />
              <ul className="flex items-start justify-between gap-2 pb-2" role="list">
                {CRAVING_CATEGORIES.map((cat) => (
                  <li key={cat.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => goToCraving(cat)}
                      aria-label={`Explore ${cat.label}`}
                      className="group flex flex-col items-center gap-2 w-[52px] sm:w-[64px] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 rounded-2xl active:scale-[0.97] transition-transform"
                    >
                      <span
                        className="h-[52px] w-[52px] sm:h-[64px] sm:w-[64px] rounded-full overflow-hidden ring-2 ring-orange-500/70 bg-[#120805]/60 group-hover:ring-orange-300 transition-all"
                        style={{ boxShadow: "0 0 0 3px rgba(255,90,47,0.14), 0 0 18px rgba(255,90,47,0.45)" }}
                      >
                        <img src={cat.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </span>
                      <span className="text-white text-[11px] sm:text-xs font-semibold">{cat.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── NEW LOCAL MENU ITEMS ── */}
            {showMenuItemsSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.menuItems.title}
                  linkHref={DISCOVERY_LAYERS.menuItems.href}
                  subtitle={DISCOVERY_LAYERS.menuItems.subtitle}
                />
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list" aria-label="New local menu items">
                    {localMenuItems.slice(0, 12).map((item) => (
                      <li key={item.id} className="shrink-0 w-[210px] sm:w-[230px]">
                        <LocalMenuItemCard item={item} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* ── FOOD TRUCKS NEAR YOU ── */}
            {showFoodTrucksSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.foodTrucks.title}
                  linkHref={DISCOVERY_LAYERS.foodTrucks.href}
                  subtitle={DISCOVERY_LAYERS.foodTrucks.subtitle}
                />
                {liveTrucksLoading && liveTrucks.length === 0 ? (
                  <HorizontalSkeletonRow count={3} width={200} />
                ) : (
                  <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                    <ul className="flex gap-4 pr-5" role="list" aria-label="Food trucks near you">
                      {liveTrucks.slice(0, 12).map((t) => (
                        <li key={t.id} className="shrink-0 w-[200px] sm:w-[220px]">
                          <TruckCard truck={t} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* ── NEARBY RESTAURANTS ── */}
            {showRestaurantsSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.restaurants.title}
                  linkHref={DISCOVERY_LAYERS.restaurants.href}
                  subtitle={DISCOVERY_LAYERS.restaurants.subtitle}
                />
                {nearbyRestaurantsLoading && nearbyRestaurants.length === 0 ? (
                  <HorizontalSkeletonRow count={3} width={200} />
                ) : (
                  <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                    <ul className="flex gap-4 pr-5" role="list" aria-label="Restaurants near you">
                      {nearbyRestaurants.slice(0, 10).map((r) => (
                        <li key={r.id} className="shrink-0 w-[200px] sm:w-[220px]">
                          <NearbyRestaurantCard
                            restaurant={r}
                            menuPreview={
                              menuPreviewByRestaurantId.get(String(r.id)) ?? []
                            }
                            isSignedIn={!!user}
                            relationshipSnapshot={restaurantRelationships}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* ── PARKING PASS HOSTS ── */}
            {showParkingHostsSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.parkingHosts.title}
                  linkHref={DISCOVERY_LAYERS.parkingHosts.href}
                  subtitle={DISCOVERY_LAYERS.parkingHosts.subtitle}
                />
                {parkingPassLoading && localParkingPassHosts.length === 0 ? (
                  <HorizontalSkeletonRow count={3} width={200} />
                ) : (
                  <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                    <ul className="flex gap-4 pr-5" role="list" aria-label="Parking pass hosts">
                      {localParkingPassHosts.slice(0, 8).map((h) => (
                        <li key={h.id} className="shrink-0 w-[200px] sm:w-[220px]">
                          <ParkingPassCard listing={h} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* ── DEALS NEAR YOU ── */}
            {showDealsSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.deals.title}
                  linkHref={DISCOVERY_LAYERS.deals.href}
                  subtitle={DISCOVERY_LAYERS.deals.subtitle}
                />
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list">
                    {allDeals.slice(0, 10).map((d) => (
                      <li key={d.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <DealCard deal={d} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* ── HAPPENING TONIGHT ── */}
            {showEventsSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title={DISCOVERY_LAYERS.events.title}
                  linkHref={DISCOVERY_LAYERS.events.href}
                  subtitle={DISCOVERY_LAYERS.events.subtitle}
                />
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list">
                    {visibleEvents.slice(0, 8).map((e) => (
                      <li key={e.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <EventCard event={e} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* ── YOUR SAVED ── */}
            <section className="px-5 pt-2 pb-12">
              <SectionHeader
                title={DISCOVERY_LAYERS.saved.title}
                linkHref={DISCOVERY_LAYERS.saved.href}
                subtitle={DISCOVERY_LAYERS.saved.subtitle}
              />
              {user && savedRestaurants.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-5">
                  <ul className="flex gap-3 pr-5" role="list" aria-label="Your saved restaurants">
                    {savedRestaurants.slice(0, 8).map((restaurant) => (
                      <li key={restaurant.id} className="shrink-0 w-[210px]">
                        <SavedRestaurantCard restaurant={restaurant} />
                      </li>
                    ))}
                    <li className="shrink-0 w-[150px]">
                      <button
                        type="button"
                        onClick={() => navigate("/favorites")}
                        className="h-full min-h-[132px] w-full rounded-3xl bg-white/5 ring-1 ring-white/10 px-4 py-5 text-left hover:bg-white/8 transition-colors"
                      >
                        <Bookmark className="mb-4 h-5 w-5 text-orange-300" />
                        <p className="text-sm font-semibold text-white">View all saved</p>
                        <p className="mt-1 text-xs text-white/50">Restaurants and deals</p>
                      </button>
                    </li>
                  </ul>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(user ? "/favorites" : "/login?redirect=/scout")}
                  className="w-full text-left rounded-3xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-5 hover:bg-white/8 transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-center gap-4">
                    <span className="h-12 w-12 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 flex items-center justify-center shrink-0" aria-hidden="true">
                      <Bookmark className="h-5 w-5 text-orange-300" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold">
                        {user ? "No saved spots yet" : "Save your food map"}
                      </p>
                      <p className="text-white/60 text-sm mt-0.5">
                        {user
                          ? "Tap Save on restaurants worth coming back to."
                          : "Sign in to keep restaurants, deals, and places you want to revisit."}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-white/50" aria-hidden="true" />
                  </div>
                </button>
              )}
            </section>
          </div>
        )}
      </main>

    </>
  );
}

/* ============================================================
   SHARED SECTION HEADER
   ============================================================ */

function SectionHeader({
  title,
  linkHref,
  subtitle,
}: {
  title: string;
  linkHref: string;
  subtitle?: string;
}) {
  return (
    <div className="pr-5 mb-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-white text-xl sm:text-2xl font-bold">{title}</h2>
        <Link
          href={linkHref}
          className="text-sm text-orange-300 inline-flex items-center gap-1 font-medium"
        >
          See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {subtitle ? (
        <p className="mt-1 text-xs sm:text-sm text-white/60">{subtitle}</p>
      ) : null}
    </div>
  );
}

/* ============================================================
   LOCAL FOOD DASHBOARD
   A persistent dashboard strip so Scout still feels useful when
   individual data sections are collapsed because there is no data.
   ============================================================ */

function LocalFoodDashboard({
  locationLabel,
  locationStatus,
  liveTruckCount,
  restaurantCount,
  menuItemCount,
  parkingHostCount,
  dealCount,
  eventCount,
  localSignalCount,
  onRefreshLocation,
  onOpenMap,
}: {
  locationLabel: string;
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  liveTruckCount: number;
  restaurantCount: number;
  menuItemCount: number;
  parkingHostCount: number;
  dealCount: number;
  eventCount: number;
  localSignalCount: number;
  onRefreshLocation: () => void;
  onOpenMap: () => void;
}) {
  const hasLocation = locationStatus === "ready";
  const signalLabel =
    localSignalCount > 0
      ? `${localSignalCount} local signal${localSignalCount === 1 ? "" : "s"}`
      : hasLocation
        ? "Building local signal"
        : "Location needed";

  const stats = [
    {
      label: "Trucks",
      value: liveTruckCount,
      detail: liveTruckCount > 0 ? "live now" : "watching",
      href: "/truck-discovery",
      icon: <Flame className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Local spots",
      value: restaurantCount,
      detail: restaurantCount > 0 ? "nearby" : "scouting",
      href: "/find-food",
      icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Menu items",
      value: menuItemCount,
      detail: menuItemCount > 0 ? "available" : "scanning",
      href: DISCOVERY_LAYERS.menuItems.href,
      icon: <Utensils className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Deals",
      value: dealCount,
      detail: dealCount > 0 ? "active" : "none posted",
      href: "/deals",
      icon: <Tag className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Events",
      value: eventCount,
      detail: eventCount > 0 ? "coming up" : "quiet",
      href: "/events",
      icon: <CalendarDays className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Truck hosts",
      value: parkingHostCount,
      detail: parkingHostCount > 0 ? "places to park" : "none nearby",
      href: "/parking-pass",
      icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  const lanes = [
    { label: "All trucks", href: "/truck-discovery" },
    { label: "Find dinner", href: "/find-food" },
    { label: "Menus", href: DISCOVERY_LAYERS.menuItems.href },
    { label: "Deals", href: "/deals" },
    { label: "Events", href: "/events" },
    { label: "Host spots", href: "/parking-pass" },
    { label: "Saved", href: "/favorites" },
  ];

  return (
    <section className="px-5 pt-1 pb-10">
      <div className="rounded-[2rem] overflow-hidden bg-white/[0.045] ring-1 ring-white/10 backdrop-blur-md">
        <div
          className="px-5 pt-5 pb-4"
          style={{
            backgroundImage:
              "radial-gradient(circle at 16% 0%, rgba(255,90,47,0.22), transparent 34%), radial-gradient(circle at 84% 8%, rgba(34,197,94,0.10), transparent 30%)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-orange-200/75 font-bold">
                Today's Food Board
              </p>
              <h2 className="mt-1 text-white text-2xl font-bold leading-tight">
                {locationLabel}
              </h2>
              <p className="mt-2 text-white/66 text-sm leading-relaxed max-w-[36rem]">
                Your local dashboard for food trucks, independent restaurants,
                bars, deals, events, host spots, and saved places. Built for
                local food discovery, not generic fast-food noise.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[#120805]/35 ring-1 ring-orange-300/25 px-3 py-1 text-[11px] font-semibold text-orange-100">
              {signalLabel}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenMap}
              className="inline-flex items-center gap-2 rounded-full bg-orange-300 text-[#1a0d08] px-3.5 py-2 text-sm font-bold active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Open map
            </button>
            <button
              type="button"
              onClick={onRefreshLocation}
              className="inline-flex items-center gap-2 rounded-full bg-[#120805]/35 ring-1 ring-white/12 text-white px-3.5 py-2 text-sm font-semibold active:scale-[0.98]"
            >
              <Search className="h-4 w-4 text-orange-200" aria-hidden="true" />
              Refresh local signal
            </button>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {stats.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-2xl bg-[#120805]/30 ring-1 ring-white/8 px-3 py-3 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-300/12 text-orange-200 ring-1 ring-orange-300/20">
                  {item.icon}
                </span>
                <p className="mt-2 text-white text-lg font-bold leading-none">
                  {item.value}
                </p>
                <p className="mt-1 text-white/82 text-xs font-semibold">
                  {item.label}
                </p>
                <p className="mt-0.5 text-white/45 text-[11px]">
                  {item.detail}
                </p>
              </Link>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto atmo-hide-scrollbar -mr-4">
            <div className="flex gap-2 pr-4">
              {lanes.map((lane) => (
                <Link
                  key={lane.href}
                  href={lane.href}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3 py-2 text-sm font-semibold text-white/82 active:scale-[0.98]"
                >
                  {lane.label}
                  <ChevronRight className="h-4 w-4 text-orange-200" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   REAL-TILE MAP HERO
   Uses Carto dark tiles loaded via <img> tags (no SDK) stitched
   into a 3×3 grid centered on the user's lat/lng at zoom 15.
   CSS perspective tilt gives the Google Earth 3D look.
   Amber overlay + real projected pins sit on top.
   ============================================================ */

function TearDropPin({ delay = "0s", hasTruck = true }: { delay?: string; hasTruck?: boolean }) {
  // Classic Google Maps teardrop shape — wide circle top, pointed bottom
  // Rendered as SVG so it scales perfectly at any DPR
  return (
    <div
      style={{
        position: "relative",
        width: 52,
        height: 68,
        filter: "drop-shadow(0 0 14px rgba(251,146,60,0.95)) drop-shadow(0 0 28px rgba(255,90,47,0.6)) drop-shadow(0 0 48px rgba(255,90,47,0.35))",
      }}
    >
      {/* Outer pulse ring */}
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 64,
          height: 64,
          marginTop: -32,
          marginLeft: -32,
          borderRadius: "50%",
          background: "rgba(255,90,47,0.18)",
          animation: `hero-pin-pulse 3s ease-out ${delay} infinite`,
          pointerEvents: "none",
        }}
      />
      <svg
        viewBox="0 0 52 68"
        width="52"
        height="68"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Pin body — filled amber with bright inner highlight */}
        <path
          d="M26 2C14.954 2 6 10.954 6 22c0 15 20 44 20 44s20-29 20-44C46 10.954 37.046 2 26 2z"
          fill="#f97316"
          stroke="#fbbf24"
          strokeWidth="1.5"
        />
        {/* Inner bright highlight to give the glowing-from-inside look */}
        <path
          d="M26 5C16.611 5 9 12.611 9 22c0 12.5 17 38 17 38s17-25.5 17-38C43 12.611 35.389 5 26 5z"
          fill="url(#pinGrad)"
          opacity="0.55"
        />
        <defs>
          <radialGradient id="pinGrad" cx="40%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Food truck icon centered in the pin circle (circle center ≈ 26,22) */}
        {hasTruck && (
          <g transform="translate(13, 12)">
            {/* Truck body */}
            <rect x="0" y="5" width="18" height="9" rx="1.5" fill="#fff" opacity="0.95" />
            {/* Cab */}
            <rect x="13" y="3" width="5" height="7" rx="1" fill="#fff" opacity="0.95" />
            {/* Window */}
            <rect x="14" y="4" width="3" height="3" rx="0.5" fill="#f97316" opacity="0.8" />
            {/* Wheels */}
            <circle cx="4" cy="14.5" r="2" fill="#fff" opacity="0.95" />
            <circle cx="14" cy="14.5" r="2" fill="#fff" opacity="0.95" />
            {/* Serving window */}
            <rect x="4" y="6.5" width="6" height="4" rx="0.5" fill="#f97316" opacity="0.7" />
          </g>
        )}
        {/* Plain dot for non-truck pins */}
        {!hasTruck && (
          <circle cx="26" cy="22" r="7" fill="#fff" opacity="0.95" />
        )}
      </svg>
    </div>
  );
}

function ScoutMapPreview({
  markers,
  userLocation,
}: {
  markers: MapAdapterMarker[];
  userLocation: { lat: number; lng: number };
}) {

  return (
    <div className="absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes hero-svg-drift {
          0%   { transform: perspective(900px) rotateX(52deg) rotateZ(-8deg) scale(1.15); }
          50%  { transform: perspective(900px) rotateX(53.5deg) rotateZ(-8deg) scale(1.15); }
          100% { transform: perspective(900px) rotateX(52deg) rotateZ(-8deg) scale(1.15); }
        }
        @keyframes hero-pin-pulse {
          0%   { transform: scale(0.6); opacity: 0.7; }
          70%  { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes hero-pin-float {
          0%   { transform: translate(-50%, -100%) translateY(0px); }
          50%  { transform: translate(-50%, -100%) translateY(-6px); }
          100% { transform: translate(-50%, -100%) translateY(0px); }
        }
      `}</style>

      {/* SVG street map — real OSM geometry with amber neon glow, perspective tilted */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          transformOrigin: "50% 65%",
          animation: "hero-svg-drift 22s ease-in-out infinite",
        }}
      >
        <SVGStreetMap
          lat={userLocation.lat}
          lng={userLocation.lng}
          className="absolute inset-0"
        />
      </div>

      {/* Atmospheric amber bloom — warm glow radiating from map center */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 70% 55% at 52% 48%, rgba(255,90,47,0.13) 0%, rgba(249,115,22,0.07) 40%, transparent 72%)",
          mixBlendMode: "screen",
        }}
      />

      {/* Edge fade so the tilted grid blends into the dark background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, rgba(5,7,13,0.55) 0%, transparent 18%, transparent 60%, rgba(5,7,13,0.95) 100%),
            linear-gradient(90deg, rgba(5,7,13,0.5) 0%, transparent 10%, transparent 90%, rgba(5,7,13,0.5) 100%)
          `,
        }}
      />

      {/* Truck marker pins — large glowing teardrop pins floating above the grid.
          Mercator projection centered on userLocation.
          BOX_DEG matches the viewport span used inside SVGStreetMap (0.011 lat, 0.0154 lng).
          SVGStreetMap renders the user pin internally, so no user pin here. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {markers
          .filter((m) => m.lat != null && m.lng != null)
          .slice(0, 8) // cap at 8 pins to avoid clutter
          .map((marker, i) => {
            const LAT_SPAN = 0.011;
            const LNG_SPAN = 0.011 * 1.4;
            const dx = (marker.lng - userLocation.lng) / LNG_SPAN;
            const dy = (marker.lat - userLocation.lat) / LAT_SPAN;
            const px = 0.5 + dx;
            const py = 0.5 - dy;
            if (px < -0.08 || px > 1.08 || py < -0.08 || py > 1.08) return null;
            const delay = `${(i * 0.55) % 3.3}s`;
            const floatDelay = `${(i * 0.7) % 4}s`;
            return (
              <div
                key={marker.id}
                className="absolute"
                style={{
                  left: `${px * 100}%`,
                  top: `${py * 100}%`,
                  // translate(-50%, -100%) so the pin tip sits exactly on the location
                  animation: `hero-pin-float 4s ease-in-out ${floatDelay} infinite`,
                  transform: "translate(-50%, -100%)",
                }}
              >
                <TearDropPin delay={delay} hasTruck={marker.kind === "truck"} />
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ============================================================
   HERO MAP FALLBACK
   ============================================================ */

function HeroMapFallback({
  reason,
}: {
  reason: "no-key" | "denied" | "loading";
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, #080a0f 0%, #0f1117 40%, #080a0f 100%)",
        animation: "heroAtmosphere 8s ease-in-out infinite",
      }}
    >
      {/* CSS animation keyframes injected inline */}
      <style>{`
        @keyframes heroAtmosphere {
          0%   { background: radial-gradient(ellipse at 20% 60%, rgba(255,90,47,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          25%  { background: radial-gradient(ellipse at 55% 70%, rgba(255,90,47,0.14) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 20% 25%, rgba(180,83,9,0.16) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          50%  { background: radial-gradient(ellipse at 70% 50%, rgba(255,90,47,0.20) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 30% 70%, rgba(180,83,9,0.10) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          75%  { background: radial-gradient(ellipse at 35% 35%, rgba(255,90,47,0.15) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 65% 65%, rgba(180,83,9,0.18) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          100% { background: radial-gradient(ellipse at 20% 60%, rgba(255,90,47,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
        }
        @keyframes heroAtmosphereGrain {
          0%   { opacity: 0.04; transform: translate(0,0); }
          20%  { opacity: 0.06; transform: translate(-1px, 1px); }
          40%  { opacity: 0.03; transform: translate(1px, -1px); }
          60%  { opacity: 0.05; transform: translate(-1px, -1px); }
          80%  { opacity: 0.04; transform: translate(1px, 1px); }
          100% { opacity: 0.04; transform: translate(0,0); }
        }
      `}</style>
      {/* Subtle noise grain overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
          mixBlendMode: "overlay",
          animation: "heroAtmosphereGrain 3s steps(1) infinite",
          pointerEvents: "none",
        }}
      />
      <div className="max-w-[280px] text-center px-6">
        <span
          className="inline-flex h-12 w-12 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 items-center justify-center mb-3"
          aria-hidden="true"
        >
          <MapPin className="h-5 w-5 text-orange-300" />
        </span>
        <p className="text-white font-semibold">
          {reason === "no-key"
            ? "Map unavailable in this preview."
            : reason === "denied"
              ? "Turn on location to load the live map."
              : "Loading the live map…"}
        </p>
        <p className="text-white/70 text-sm mt-1">
          {reason === "no-key"
            ? "Configure VITE_GOOGLE_MAPS_WEB_API_KEY to enable the hero map."
            : reason === "denied"
              ? "MealScout uses your location only to show what's live around you."
              : "Centering on your area now."}
        </p>
      </div>
    </div>
  );
}



/* ============================================================
   CARDS
   ============================================================ */

function LiveNowEmptyCard({
  title,
  body,
  onCta,
}: {
  title: string;
  body: string;
  onCta: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCta}
      className="block w-full text-left rounded-2xl overflow-hidden bg-white/5 backdrop-blur-md ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
      aria-label={title}
    >
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <span
            className="h-9 w-9 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 flex items-center justify-center shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <MapPin className="h-4 w-4 text-orange-300" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm leading-snug">{title}</p>
            <p className="mt-1 text-xs text-white/60 leading-relaxed">{body}</p>
          </div>
        </div>

      </div>
    </button>
  );
}

function LiveTruckSkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="rounded-3xl overflow-hidden bg-white/5 ring-1 ring-white/10"
    >
      <div className="aspect-[4/5] w-full animate-pulse bg-white/5" />
    </div>
  );
}

function LiveTruckCard({ truck }: { truck: LiveTruckSummary }) {
  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const vibe = getCrowdVibe(truck);
  const heroImage = truck.heroImageUrl || truck.imageUrl || truck.logoUrl;

  return (
    <Link
      href={`/truck/${truck.id}`}
      className="block rounded-3xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 bg-[#120805]/40 ring-1 ring-white/10"
      aria-label={`Open ${truck.name}`}
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {heroImage ? (
          <img
            src={heroImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(255,90,47,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow-md">
          <span
            className="h-1.5 w-1.5 rounded-full bg-white atmo-pulse-amber"
            aria-hidden="true"
          />
          Live
        </span>

        <button
          type="button"
          aria-label="Save"
          onClick={(e) => {
            e.preventDefault();
          }}
          className="absolute top-2.5 right-2.5 h-9 w-9 rounded-full flex items-center justify-center bg-[#120805]/30 backdrop-blur-sm hover:bg-[#120805]/50 transition-colors"
        >
          <Heart className="h-5 w-5 text-white" aria-hidden="true" />
        </button>

        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight truncate">
            {truck.name}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-orange-200 text-sm font-semibold">
            <Flame className="h-4 w-4" aria-hidden="true" />
            <span>{vibe.label}</span>
          </p>
          <p className="mt-1 text-white/75 text-xs">
            {[wait, distance].filter(Boolean).join(" • ") || "Open now"}
          </p>
        </div>
      </div>
    </Link>
  );
}

function DealCard({ deal }: { deal: DealSummary }) {
  return (
    <Link
      href={`/deal/${deal.id}`}
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open deal ${deal.title || ""}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {deal.imageUrl ? (
          <img
            src={deal.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(34,197,94,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        {deal.discountText && (
          <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-[#1a0d08] bg-orange-300 shadow-md">
            {deal.discountText}
          </span>
        )}
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight line-clamp-2">
            {deal.title || "Featured Deal"}
          </p>
          {deal.restaurantName && (
            <p className="mt-1 text-white/75 text-xs truncate">
              {deal.restaurantName}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function LocalMenuItemCard({ item }: { item: LocalMenuItemFeedItem }) {
  const price =
    typeof item.priceCents === "number" && Number.isFinite(item.priceCents)
      ? `$${(item.priceCents / 100).toFixed(item.priceCents % 100 === 0 ? 0 : 2)}`
      : null;
  const distLabel =
    typeof item.distanceMiles === "number" && Number.isFinite(item.distanceMiles)
      ? `${item.distanceMiles.toFixed(item.distanceMiles < 10 ? 1 : 0)} mi`
      : null;
  const tags = Array.isArray(item.dietaryTags)
    ? item.dietaryTags.filter(Boolean).slice(0, 2)
    : [];

  return (
    <Link
      href={`/restaurant/${item.restaurantId}`}
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open ${item.name} from ${item.restaurantName || "local menu"}`}
      data-testid="scout-local-menu-item-card"
    >
      <div className="relative aspect-[4/3] w-full bg-[#120805]/60">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 28% 20%, rgba(255,120,55,0.36), transparent 34%), linear-gradient(160deg, rgba(255,90,47,0.16), rgba(0,0,0,0.66))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 34%, rgba(0,0,0,0.9) 100%)",
          }}
          aria-hidden="true"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-orange-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1a0d08]">
          <Utensils className="h-3 w-3" aria-hidden="true" />
          Menu
        </span>
        {price && (
          <span className="absolute top-3 right-3 rounded-full bg-[#120805]/75 px-2.5 py-1 text-[11px] font-bold text-orange-100 ring-1 ring-orange-300/30">
            {price}
          </span>
        )}
      </div>
      <div className="px-3 py-3">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-white">
          {item.name}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-orange-200/85">
          {item.restaurantName || "Local spot"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/55">
          {item.cuisineType && <span>{item.cuisineType}</span>}
          {item.restaurantCity && <span>{item.restaurantCity}</span>}
          {distLabel && <span>{distLabel}</span>}
        </div>
        {item.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-snug text-white/58">
            {item.description}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/8 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white/65"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const title = event.title || event.name || "Event";
  const venue = event.venueName || event.locationName || "";
  const start = event.startsAt || event.startTime;
  const startLabel = start
    ? new Date(start).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const img = event.heroImageUrl || event.imageUrl;
  return (
    <Link
      href={`/event/${event.id}`}
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open event ${title}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(217,70,239,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight line-clamp-2">
            {title}
          </p>
          {venue && (
            <p className="mt-1 text-white/80 text-xs truncate">{venue}</p>
          )}
          {startLabel && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-orange-200 text-xs font-semibold">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {startLabel}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function DiscoveryEmptyRow({
  icon,
  title,
  body,
  ctaLabel,
  onCta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="mr-5 rounded-3xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-5">
      <div className="flex items-start gap-4">
        <span
          className="h-10 w-10 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold">{title}</p>
          <p className="text-white/70 text-sm mt-1">{body}</p>
          <button
            type="button"
            onClick={onCta}
            className="mt-3 inline-flex items-center gap-1.5 text-orange-200 text-sm font-semibold"
          >
            {ctaLabel} <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NearbyRestaurantCard({
  restaurant,
  menuPreview = [],
  isSignedIn,
  relationshipSnapshot,
}: {
  restaurant: RestaurantSummary;
  menuPreview?: MenuPreviewItem[];
  isSignedIn: boolean;
  relationshipSnapshot: RestaurantRelationshipSnapshot;
}) {
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const img = restaurant.coverImageUrl || restaurant.heroImageUrl || restaurant.imageUrl || restaurant.logoUrl;
  const cuisine = restaurant.cuisineType;
  const location = restaurant.neighborhood || restaurant.city;
  const dealCount = restaurant.activeDealsCount ?? restaurant.activeDealCount ?? 0;
  const favoriteCount = Number(restaurant.favoriteCount || 0);
  const followCount = Number(restaurant.followCount || 0);
  const recommendationCount = Number(restaurant.recommendationCount || 0);
  const videoRecommendationCount = Number(
    restaurant.videoRecommendationCount || 0,
  );
  const communityActivityCount = Number(restaurant.communityActivityCount || 0);
  const dist = restaurant.distanceMiles ?? (restaurant.distance ? restaurant.distance * 0.621371 : null);
  const distLabel = typeof dist === "number" && Number.isFinite(dist)
    ? `${dist.toFixed(dist < 10 ? 1 : 0)} mi`
    : null;
  const restaurantId = String(restaurant.id);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isFollowed, setIsFollowed] = useState(false);
  const [isRecommended, setIsRecommended] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    setIsFavorite(relationshipSnapshot.favoriteIds.has(restaurantId));
    setIsFollowed(relationshipSnapshot.followIds.has(restaurantId));
    setIsRecommended(relationshipSnapshot.recommendationIds.has(restaurantId));
  }, [relationshipSnapshot, restaurantId]);

  const formatPrice = (cents?: number | null) =>
    typeof cents === "number" && Number.isFinite(cents) && cents > 0
      ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
      : null;
  const trustSignals = [
    videoRecommendationCount > 0
      ? `${videoRecommendationCount} video rec${videoRecommendationCount === 1 ? "" : "s"}`
      : null,
    recommendationCount > 0
      ? `${recommendationCount} rec${recommendationCount === 1 ? "" : "s"}`
      : null,
    favoriteCount > 0
      ? `${favoriteCount} save${favoriteCount === 1 ? "" : "s"}`
      : null,
    followCount > 0
      ? `${followCount} follow${followCount === 1 ? "" : "s"}`
      : null,
    communityActivityCount > 0 ? "active buzz" : null,
  ].filter((signal): signal is string => Boolean(signal));
  const rankingReason =
    typeof restaurant.homeRankingReason === "string" &&
    restaurant.homeRankingReason.trim().length > 0
      ? restaurant.homeRankingReason.trim()
      : trustSignals.length > 0
      ? `Ranked by ${trustSignals.slice(0, 2).join(" + ")}`
      : distLabel
        ? "Ranked by nearby local relevance"
        : "Ranked by local relevance";

  const sendRestaurantAction = async (
    action: "favorite" | "follow" | "recommend",
    nextState: boolean,
  ) => {
    if (!isSignedIn) {
      window.location.href = `/login?redirect=${encodeURIComponent("/scout")}`;
      return;
    }

    const method = nextState ? "POST" : "DELETE";
    if (action === "recommend" && !nextState) return;
    setPendingAction(action);
    try {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(restaurantId)}/${action}`,
        {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        },
      );
      if (!response.ok) throw new Error("Restaurant action failed");
    } finally {
      setPendingAction(null);
    }
  };

  const toggleFavorite = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !isFavorite;
    setIsFavorite(nextState);
    try {
      await sendRestaurantAction("favorite", nextState);
    } catch {
      setIsFavorite(!nextState);
    }
  };

  const toggleFollow = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !isFollowed;
    setIsFollowed(nextState);
    try {
      await sendRestaurantAction("follow", nextState);
    } catch {
      setIsFollowed(!nextState);
    }
  };

  const recommend = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isRecommended) return;
    setIsRecommended(true);
    try {
      await sendRestaurantAction("recommend", true);
    } catch {
      setIsRecommended(false);
    }
  };

  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="block rounded-2xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 bg-[#120805]/40 ring-1 ring-white/10"
      aria-label={`Open ${name}`}
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
      data-testid="scout-restaurant-card"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/60">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(160deg, rgba(255,90,47,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {dealCount > 0 && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            {dealCount} deal{dealCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && (
            <span className="text-orange-300/80 text-[11px]">{cuisine}</span>
          )}
          {cuisine && (location || distLabel) && (
            <span className="text-white/30 text-[11px]">·</span>
          )}
          {location && (
            <span className="text-white/60 text-[11px] truncate">{location}</span>
          )}
          {distLabel && (
            <>
              <span className="text-white/30 text-[11px]">·</span>
              <span className="text-white/50 text-[11px]">{distLabel}</span>
            </>
          )}
        </div>
        {menuPreview.length > 0 && (
          <div
            className="mt-2 rounded-xl bg-orange-300/10 ring-1 ring-orange-300/20 px-2.5 py-2"
            data-testid="scout-menu-preview"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-200">
              <Utensils className="h-3 w-3" aria-hidden="true" />
              Menu preview
            </div>
            <div className="mt-1.5 space-y-1">
              {menuPreview.slice(0, 2).map((item) => {
                const price = formatPrice(item.priceCents);
                return (
                  <div
                    key={item.id}
                    className="flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-white/82">
                      {item.name}
                    </span>
                    {price && (
                      <span className="shrink-0 text-orange-200/85">
                        {price}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          {trustSignals.slice(0, 2).map((signal) => (
            <span
              key={signal}
              className="rounded-full bg-emerald-300/12 px-2 py-1 text-emerald-200"
            >
              {signal}
            </span>
          ))}
          <span className="rounded-full bg-white/8 px-2 py-1 text-white/65">
            Menu
          </span>
          {dealCount > 0 && (
            <span className="rounded-full bg-orange-300/15 px-2 py-1 text-orange-200">
              Deals
            </span>
          )}
        </div>
        <p className="mt-2 text-[10px] font-semibold text-white/45">
          {rankingReason}
        </p>
        <div
          className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-bold"
          aria-label={`${name} quick actions`}
        >
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={pendingAction === "favorite"}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isFavorite
                ? "bg-orange-300 text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isFavorite}
          >
            <Bookmark className="h-3 w-3" aria-hidden="true" />
            Save
          </button>
          <button
            type="button"
            onClick={toggleFollow}
            disabled={pendingAction === "follow"}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isFollowed
                ? "bg-white text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isFollowed}
          >
            <Heart className="h-3 w-3" aria-hidden="true" />
            Follow
          </button>
          <button
            type="button"
            onClick={recommend}
            disabled={pendingAction === "recommend" || isRecommended}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isRecommended
                ? "bg-emerald-300 text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isRecommended}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {isRecommended ? "Rec'd" : "Rec"}
          </button>
        </div>
      </div>
    </Link>
  );
}

function SavedRestaurantCard({ restaurant }: { restaurant: RestaurantSummary }) {
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const img =
    restaurant.coverImageUrl ||
    restaurant.heroImageUrl ||
    restaurant.imageUrl ||
    restaurant.logoUrl;
  const location = restaurant.neighborhood || restaurant.city || restaurant.address;
  const cuisine = restaurant.cuisineType;

  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="block overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/8 hover:ring-orange-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      aria-label={`Open saved restaurant ${name}`}
    >
      <div className="relative h-24 bg-[#120805]/50">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(145deg, rgba(255,90,47,0.22), rgba(2,6,23,0.92))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.78))",
          }}
          aria-hidden="true"
        />
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-orange-300 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1a0d08]">
          <Bookmark className="h-3 w-3" aria-hidden="true" />
          Saved
        </span>
      </div>
      <div className="px-3 py-3">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          {cuisine && <span className="text-orange-200/80">{cuisine}</span>}
          {cuisine && location && <span className="text-white/25">·</span>}
          {location && <span className="truncate text-white/55">{location}</span>}
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
   LIVE NOW SECTION
   Collapsed when empty (just the header + quiet status chip).
   Expanded automatically when trucks are live.
   No "open the map" CTA — the map is already on the page.
   ============================================================ */

function LiveNowSection({
  liveTrucks,
  liveTrucksLoading,
  liveTrucksError,
  locationStatus,
  onExpandMap: _onExpandMap,
}: {
  liveTrucks: LiveTruckSummary[];
  liveTrucksLoading: boolean;
  liveTrucksError: boolean;
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  onExpandMap: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isEmpty =
    !liveTrucksLoading &&
    liveTrucks.length === 0;

  // Auto-expand when trucks go live
  const hadTrucks = useRef(false);
  useEffect(() => {
    if (liveTrucks.length > 0) hadTrucks.current = true;
  }, [liveTrucks.length]);

  // While loading, show skeletons (no collapse needed)
  if (liveTrucksLoading && liveTrucks.length === 0) {
    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Live Now"
          linkHref="/truck-discovery"
          subtitle="Trucks currently broadcasting service nearby."
        />
        <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
          <ul className="flex gap-4 pr-5" role="list">
            {[0, 1, 2].map((i) => (
              <li key={i} className="shrink-0 w-[230px] sm:w-[260px]">
                <LiveTruckSkeletonCard />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // Trucks are live — show them fully expanded
  if (liveTrucks.length > 0) {
    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Live Now"
          linkHref="/truck-discovery"
          subtitle="Trucks currently broadcasting service nearby."
        />
        <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
          <ul className="flex gap-4 pr-5" role="list" aria-label="Live food trucks near you">
            {liveTrucks.slice(0, 12).map((truck) => (
              <li key={truck.id} className="shrink-0 w-[230px] sm:w-[260px]">
                <LiveTruckCard truck={truck} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // Empty state — collapsed by default, expand on tap to show context
  const statusChip =
    locationStatus === "denied"
      ? "Location off"
      : liveTrucksError
        ? "Feed unavailable"
        : "Nothing live right now";

  return (
    <section className="px-5 pt-2 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-white text-xl sm:text-2xl font-bold">Live Now</h2>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/8 ring-1 ring-white/10 text-white/50 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-white/30" aria-hidden="true" />
            {statusChip}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isEmpty && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
              aria-expanded={expanded}
            >
              {expanded ? "Less" : "Why?"}
            </button>
          )}
          <Link
            href="/truck-discovery"
            className="text-sm text-orange-300 inline-flex items-center gap-1 font-medium"
          >
            See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Expandable context — only shown when user taps "Why?" */}
      {expanded && (
        <div className="mt-3 rounded-2xl bg-white/5 ring-1 ring-white/10 px-4 py-3">
          <p className="text-white/70 text-sm leading-relaxed">
            {locationStatus === "denied"
              ? "Turn on location so MealScout can show food trucks, deals, and events near you in real time."
              : liveTrucksError
                ? "We couldn't reach the live feed. Pull down to refresh."
                : "Trucks pop up throughout the day. Check back later or scroll down to discover restaurants and events near you."}
          </p>
        </div>
      )}
    </section>
  );
}

/* ============================================================
   TRUCK CARD
   Shows a live food truck in the Food Trucks Near You section.
   ============================================================ */

function TruckCard({ truck }: { truck: LiveTruckSummary }) {
  const name = truck.name || "Food Truck";
  const cuisine = truck.cuisineType ?? null;
  const img = truck.coverImageUrl ?? truck.heroImageUrl ?? truck.imageUrl ?? truck.logoUrl ?? null;

  const distMiles = truck.distanceMiles;
  const distKm = truck.distance;
  let distLabel: string | null = null;
  if (typeof distMiles === "number" && Number.isFinite(distMiles)) {
    distLabel = `${distMiles.toFixed(distMiles < 10 ? 1 : 0)} mi`;
  } else if (typeof distKm === "number" && Number.isFinite(distKm)) {
    const m = distKm * 0.621371;
    distLabel = `${m.toFixed(m < 10 ? 1 : 0)} mi`;
  }

  const wait = truck.waitMinutes ?? truck.estimatedWaitMinutes;
  const waitLabel =
    typeof wait === "number" && Number.isFinite(wait) && wait > 0
      ? `~${Math.round(wait)} min`
      : null;

  return (
    <Link
      href={`/truck/${truck.id}`}
      className="block rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-orange-500/40 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    >
      {/* Hero image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/40 overflow-hidden">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Flame className="h-8 w-8 text-orange-500/40" aria-hidden="true" />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {/* Live badge */}
        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-red-500/90 shadow">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
          Live
        </span>
        {truck.activeDealCount && truck.activeDealCount > 0 ? (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            Deal
          </span>
        ) : null}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && <span className="text-orange-300/80 text-[11px]">{cuisine}</span>}
          {cuisine && (distLabel || waitLabel) && <span className="text-white/30 text-[11px]">·</span>}
          {distLabel && <span className="text-white/60 text-[11px]">{distLabel}</span>}
          {distLabel && waitLabel && <span className="text-white/30 text-[11px]">·</span>}
          {waitLabel && <span className="text-white/50 text-[11px]">{waitLabel} wait</span>}
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
   PARKING PASS CARD
   Shows a parking pass host in the Parking Pass Hosts section.
   ============================================================ */

function ParkingPassCard({ listing }: { listing: ParkingPassListing }) {
  const name =
    listing.host?.businessName ??
    listing.businessName ??
    listing.hostName ??
    "Parking Host";
  const address = listing.host?.address ?? listing.address ?? null;
  const city = listing.host?.city ?? listing.city ?? null;
  const state = listing.host?.state ?? listing.state ?? null;
  const cityState = [city, state].filter(Boolean).join(", ");
  const locationLabel = address
    ? [address, cityState].filter(Boolean).join(", ")
    : cityState || null;
  const img =
    listing.spotImageUrl ??
    listing.host?.spotImageUrl ??
    listing.heroImageUrl ??
    listing.imageUrl ??
    listing.host?.imageUrl ??
    null;
  const spots = listing.spotCount ?? listing.maxTrucks ?? null;
  const available = Array.isArray(listing.availableSpotNumbers)
    ? listing.availableSpotNumbers.length
    : typeof listing.availableSpots === "number"
      ? listing.availableSpots
      : typeof spots === "number" && typeof listing.bookedSpots === "number"
        ? Math.max(0, spots - listing.bookedSpots)
        : null;
  const isFull = typeof available === "number" && available <= 0;

  const toCents = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  };

  const startingCents = [
    listing.hostPriceCents,
    listing.breakfastPriceCents,
    listing.lunchPriceCents,
    listing.dinnerPriceCents,
    listing.dailyPriceCents,
    listing.weeklyPriceCents,
    listing.monthlyPriceCents,
  ]
    .map(toCents)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0] ?? null;
  const startingPrice =
    startingCents !== null ? `$${(startingCents / 100).toFixed(2)}` : null;

  const formatClock = (value?: string | null) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) {
      const hour24 = Number(match[1]);
      const minute = match[2];
      if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return raw;
      const suffix = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 % 12 || 12;
      return `${hour12}:${minute} ${suffix}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return raw;
  };

  const dateLabel = (() => {
    const raw = String(listing.date || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  })();
  const startLabel = formatClock(listing.startTime);
  const endLabel = formatClock(listing.endTime);
  const timeLabel =
    startLabel && endLabel
      ? `${startLabel} - ${endLabel}`
      : startLabel || endLabel || null;
  const scheduleLabel =
    dateLabel && timeLabel
      ? `${dateLabel} · ${timeLabel}`
      : dateLabel || timeLabel || null;

  return (
    <Link
      href={listing.id ? `/parking-pass?pass=${encodeURIComponent(String(listing.id))}` : "/parking-pass"}
      className="block rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-orange-500/40 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    >
      {/* Hero image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/40 overflow-hidden">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full relative">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(150deg, rgba(255,90,47,0.24), rgba(2,6,23,0.92))",
              }}
              aria-hidden="true"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <MapPin className="h-8 w-8 text-orange-300/70" aria-hidden="true" />
            </div>
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {available !== null && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-emerald-600/90 shadow">
            {isFull
              ? "Full"
              : `${available} spot${available !== 1 ? "s" : ""} open`}
          </span>
        )}
        {startingPrice && (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-[#1a0d08] bg-orange-300 shadow">
            From {startingPrice}
          </span>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {locationLabel && (
            <span className="text-white/60 text-[11px] truncate">{locationLabel}</span>
          )}
          {locationLabel && spots !== null && (
            <span className="text-white/30 text-[11px]">·</span>
          )}
          {spots !== null && (
            <span className="text-orange-300/70 text-[11px]">{spots} spot{spots !== 1 ? "s" : ""}</span>
          )}
        </div>
        {scheduleLabel && (
          <p className="mt-1 text-white/55 text-[11px] truncate">{scheduleLabel}</p>
        )}
      </div>
    </Link>
  );
}

/* ============================================================
   HORIZONTAL SKELETON ROW
   Loading placeholder for any horizontal scroll section.
   ============================================================ */

function HorizontalSkeletonRow({
  count = 3,
  width = 200,
}: {
  count?: number;
  width?: number;
}) {
  return (
    <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
      <ul className="flex gap-4 pr-5" role="list" aria-label="Loading…">
        {Array.from({ length: count }).map((_, i) => (
          <li key={i} className="shrink-0" style={{ width }}>
            <div className="rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10">
              <div className="aspect-[4/3] w-full animate-pulse bg-white/5" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-3/4 rounded bg-white/10 animate-pulse" />
                <div className="h-2.5 w-1/2 rounded bg-white/8 animate-pulse" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
