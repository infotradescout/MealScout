import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
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
  MessageCircle,
  Minimize2,
  Navigation2,
  Search,
  Sparkles,
  Tag,
  TrendingUp,
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
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";

const ThemedScoutMap = lazy(() => import("@/components/maps/themed-scout-map"));

type MapRuntimeResponse = {
  hasGoogleMapsKey: boolean;
  googleMapsApiKey?: string | null;
  hasGoogleMapsMapId?: boolean;
  googleMapsMapId?: string | null;
};

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
  discoveryReasons?: string[] | null;
  discoveryScore?: number | null;
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
  | "trending"
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
    href: "/search",
    subtitle: "Jump into local food by mood, not by chain category.",
  },
  trending: {
    title: "Trending Now",
    href: "/trending",
    subtitle: "Cuisines, dishes, videos, and local spots gaining momentum.",
  },
  menuItems: {
    title: "New Local Menu Items",
    href: "/search",
    subtitle: "Freshly available dishes from nearby restaurants and trucks.",
  },
  foodTrucks: {
    title: "Food Trucks Near You",
    href: "/truck-discovery",
    subtitle: "All nearby trucks that are broadcasting or ready to be discovered.",
  },
  restaurants: {
    title: "Restaurants Near You",
    href: "/search",
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

function getTruckCoords(truck: LiveTruckSummary): { lat: number; lng: number } | null {
  const lat = truck.latitude ?? truck.lat;
  const lng = truck.longitude ?? truck.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

function formatTruckPlace(truck: LiveTruckSummary): string {
  return [truck.address, truck.city, truck.state].filter(Boolean).join(", ") || "Live location";
}

function buildTruckDirectionsUrl(
  truck: LiveTruckSummary,
  origin?: { lat: number; lng: number } | null,
): string {
  const truckCoords = getTruckCoords(truck);
  const destination = truckCoords
    ? `${truckCoords.lat},${truckCoords.lng}`
    : encodeURIComponent(formatTruckPlace(truck));
  const originParam = origin ? `&origin=${origin.lat},${origin.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destination}&travelmode=driving`;
}

function getGreetingTime(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

const DISCOVERY_RADIUS_STORAGE_KEY = "mealscout:discovery-radius-km";
const DEFAULT_DISCOVERY_RADIUS_KM = 12; // about 7.5 miles
const MIN_DISCOVERY_RADIUS_KM = 3;
const MAX_DISCOVERY_RADIUS_KM = 40;

function clampDiscoveryRadiusKm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISCOVERY_RADIUS_KM;
  return Math.max(MIN_DISCOVERY_RADIUS_KM, Math.min(MAX_DISCOVERY_RADIUS_KM, value));
}

function readDiscoveryRadiusKm(): number {
  if (typeof window === "undefined") return DEFAULT_DISCOVERY_RADIUS_KM;
  const stored = Number(window.localStorage.getItem(DISCOVERY_RADIUS_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_DISCOVERY_RADIUS_KM;
  return clampDiscoveryRadiusKm(stored);
}

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

function parkingPassHostKey(listing: ParkingPassListing): string {
  const hostId = String(listing.hostId || "").trim();
  if (hostId) return hostId;
  const hostName = String(
    listing.hostName || listing.businessName || listing.host?.businessName || "",
  ).trim();
  const lat = String(listing.latitude ?? listing.host?.latitude ?? "").trim();
  const lng = String(listing.longitude ?? listing.host?.longitude ?? "").trim();
  return [hostName, lat, lng].filter(Boolean).join(":") || listing.id;
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
  const [discoveryRadiusKm, setDiscoveryRadiusKm] = useState<number>(() =>
    readDiscoveryRadiusKm(),
  );
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

  const updateDiscoveryRadiusKm = useCallback((value: number) => {
    const nextRadius = clampDiscoveryRadiusKm(value);
    setDiscoveryRadiusKm(nextRadius);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISCOVERY_RADIUS_STORAGE_KEY, String(nextRadius));
    }
  }, []);

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
      ? ["/api/trucks/live", coords.lat, coords.lng, discoveryRadiusKm]
      : ["/api/trucks/live", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return { trucks: [] };
      const response = await fetch(
        `/api/trucks/live?lat=${coords.lat}&lng=${coords.lng}&radiusKm=${discoveryRadiusKm}`,
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
        discoveryRadiusKm,
        fallbackKm,
      );
    });
  }, [coords, discoveryRadiusKm, liveTrucksData]);

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
        discoveryRadiusKm,
      ),
    );
  }, [coords, discoveryRadiusKm, events]);

  /* --------- nearby restaurants --------- */

  const { data: nearbyRestaurantsData, isLoading: nearbyRestaurantsLoading } = useQuery<RestaurantSummary[]>({
    queryKey: coords
      ? ["/api/restaurants/subscribed", coords.lat, coords.lng, discoveryRadiusKm]
      : ["/api/restaurants/subscribed", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/restaurants/subscribed/${coords.lat}/${coords.lng}?radius=${discoveryRadiusKm}`,
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
        discoveryRadiusKm,
        fallbackKm,
      );
    });
  }, [coords, discoveryRadiusKm, nearbyRestaurantsData]);

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
      ? ["/api/menus/local-items", coords.lat, coords.lng, discoveryRadiusKm]
      : ["/api/menus/local-items", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/menus/local-items?lat=${coords.lat}&lng=${coords.lng}&radiusKm=${discoveryRadiusKm}&limit=24`,
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
    const uniqueByHost = new Map<string, ParkingPassListing>();
    for (const listing of parkingPassHosts) {
      if (!isParkingPassListingRenderable(listing)) continue;
      if (
        !isWithinScoutRadius(
          coords,
          listing.latitude ?? listing.host?.latitude,
          listing.longitude ?? listing.host?.longitude,
          discoveryRadiusKm,
        )
      ) {
        continue;
      }

      const key = parkingPassHostKey(listing);
      if (!uniqueByHost.has(key)) {
        uniqueByHost.set(key, listing);
      }
    }
    return Array.from(uniqueByHost.values());
  }, [coords, discoveryRadiusKm, parkingPassHosts]);

  /* --------- nearby deals (location-aware) --------- */

  const { data: nearbyDealsData } = useQuery<DealSummary[]>({
    queryKey: coords
      ? ["/api/deals/nearby", coords.lat, coords.lng, discoveryRadiusKm]
      : ["/api/deals/nearby", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/deals/nearby/${coords.lat}/${coords.lng}?radius=${discoveryRadiusKm}`,
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
  const liveTruckById = useMemo(() => {
    const map = new Map<string, LiveTruckSummary>();
    for (const truck of liveTrucks) map.set(String(truck.id), truck);
    return map;
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
          id: `parking-${parkingPassHostKey(p)}`,
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
  const [selectedLiveTruck, setSelectedLiveTruck] = useState<LiveTruckSummary | null>(null);
  const [selectedMapMarker, setSelectedMapMarker] = useState<MapAdapterMarker | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBoundsLike | null>(null);
  // Once the full map has been opened once, keep GoogleMapSurface mounted
  // (just hidden) so it doesn't re-initialize on every collapse/expand.
  // Using state (not ref) so React re-renders when the map should first mount.
  const [hasOpenedFullMap, setHasOpenedFullMap] = useState(false);
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
  const { data: mapRuntime } = useQuery<MapRuntimeResponse>({
    queryKey: ["/api/map/runtime"],
    queryFn: async () => {
      const response = await fetch("/api/map/runtime");
      if (!response.ok) {
        return { hasGoogleMapsKey: false, googleMapsApiKey: null };
      }
      return response.json();
    },
    retry: 3,
    retryDelay: 800,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  const runtimeGoogleMapsApiKey = String(
    mapRuntime?.googleMapsApiKey || "",
  ).trim();
  const runtimeGoogleMapsMapId = String(
    mapRuntime?.googleMapsMapId || "",
  ).trim();
  const mapRuntimeResolved = mapRuntime !== undefined;
  const buildGoogleMapsMapId = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID || "",
  ).trim();
  const effectiveGoogleMapsApiKey = runtimeGoogleMapsApiKey ||
    (mapRuntimeResolved ? GOOGLE_MAPS_WEB_API_KEY : "");
  const effectiveGoogleMapsMapId =
    runtimeGoogleMapsMapId || buildGoogleMapsMapId;
  const hasMapKey = effectiveGoogleMapsApiKey.length > 0;

  const openScoutMap = useCallback(() => {
    if (coords) {
      setMapCenter(coords);
    }
    setHasOpenedFullMap(true);
    setGoogleMapFailed(false);
    setSheetState("fullMap");
  }, [coords]);

  const collapseScoutMap = useCallback(() => {
    setSheetState("default");
    setSelectedLiveTruck(null);
    setSelectedMapMarker(null);
  }, []);

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
      preloadGoogleMapsScript(effectiveGoogleMapsApiKey);
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
  }, [effectiveGoogleMapsApiKey, hasMapKey, sheetState]);

  // When we first get coords, set the map center to the right-quadrant offset.
  useEffect(() => {
    if (!coords || userPushedMapRef.current) return;
    setMapCenter(shiftCenterForRightQuadrant(coords.lat, coords.lng, HERO_ZOOM));
  }, [coords]);

  const handleMapBoundsChanged = useCallback((bounds: MapBoundsLike) => {
    setMapBounds(bounds);
  }, []);
  const handleMapZoomChanged = useCallback((z: number) => {
    setMapZoom(z);
    userPushedMapRef.current = true;
  }, []);
  const handleMapCenterChanged = useCallback((c: { lat: number; lng: number }) => {
    setMapCenter(c);
    userPushedMapRef.current = true;
  }, []);
  const selectLiveTruck = useCallback(
    (truck: LiveTruckSummary) => {
      const truckCoords = getTruckCoords(truck);
      setSelectedLiveTruck(truck);
      if (truckCoords) {
        setMapCenter(truckCoords);
        setMapZoom(16);
      } else if (coords) {
        setMapCenter(coords);
      }
      setHasOpenedFullMap(true);
      setGoogleMapFailed(false);
      setSheetState("fullMap");
    },
    [coords],
  );
  const handleMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      if (marker.kind === "truck") {
        const truck = liveTruckById.get(String(marker.sourceId));
        if (truck) {
          selectLiveTruck(truck);
          setSelectedMapMarker(null);
          return;
        }
        navigate(`/truck/${marker.sourceId}`);
      }
      else if (marker.kind === "restaurant" || marker.kind === "parking" || marker.kind === "event") {
        setSelectedLiveTruck(null);
        setSelectedMapMarker(marker);
        setMapCenter({ lat: marker.lat, lng: marker.lng });
        setMapZoom(Math.max(mapZoom, 15));
      }
    },
    [liveTruckById, mapZoom, navigate, selectLiveTruck],
  );
  const handlePreviewMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      setHasOpenedFullMap(true);
      setGoogleMapFailed(false);
      setSheetState("fullMap");
      handleMarkerTap(marker);
    },
    [handleMarkerTap],
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("mealscout-map-fullscreen", sheetState === "fullMap");
    return () => {
      document.body.classList.remove("mealscout-map-fullscreen");
    };
  }, [sheetState]);

  const dragStartY = useRef<number | null>(null);
  const dragLastY = useRef<number | null>(null);
  const mouseDragStartY = useRef<number | null>(null);
  const mouseDragLastY = useRef<number | null>(null);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragStartY.current = touch.clientY;
    dragLastY.current = touch.clientY;
  }, []);
  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragLastY.current = touch.clientY;
  }, []);
  const handleSheetTouchEnd = useCallback(() => {
    const start = dragStartY.current;
    const last = dragLastY.current;
    dragStartY.current = null;
    dragLastY.current = null;
    if (start === null || last === null) return;
    const delta = last - start;
    // Keep interactions simple: pull down to expand, pull up to collapse.
    if (delta > 40 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -40 && sheetState === "fullMap") {
      collapseScoutMap();
    }
  }, [collapseScoutMap, openScoutMap, sheetState]);

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
    if (delta > 24 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -24 && sheetState === "fullMap") {
      collapseScoutMap();
    }
  }, [collapseScoutMap, openScoutMap, sheetState]);

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

      {/* Atmospheric page base. The live map carries the detailed map styling. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[#fff4d6]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,168,86,0.30), transparent 34%), linear-gradient(180deg, rgba(255,247,226,0.96), rgba(16,18,22,1) 70%)",
        }}
      />

      <main
        className={`relative z-10 ${
          sheetState === "fullMap"
            ? ""
            : "pb-36 md:mx-auto md:max-w-[640px] md:min-h-screen md:bg-[#090b0f]/72 md:backdrop-blur-sm md:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_80px_rgba(0,0,0,0.55)]"
        }`}
        style={{ overscrollBehaviorY: "none" }}
      >
        {/* ============================================================
             SCOUT SURFACE
             Default: compact branded mini map.
             Full map: interactive Google Map fills the viewport.
           ============================================================ */}
        <section
          data-testid="scout-map-container"
          className="relative w-full overflow-hidden bg-[#fff4d6]"
          style={{
            height:
              sheetState === "fullMap" ? "100dvh" : "min(56vh, 470px)",
            transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
            touchAction: "auto",
            overscrollBehaviorY: "none",
            boxShadow:
              sheetState === "fullMap"
                ? undefined
                : "inset 0 -70px 90px rgba(255,255,255,0.10), inset 0 -120px 120px rgba(120,54,16,0.20)",
          }}
        >
          {/* Scout map surfaces
              ------------------
              DEFAULT state: compact interactive Google map surface.
              FULLMAP state: interactive Google Map widget for real
                pan/zoom/tap-pin exploration.
          */}
          <div className="absolute inset-0">
            <div
              data-testid="scout-map-preview"
              className="absolute inset-0"
              style={{
                visibility: "visible",
                pointerEvents: sheetState === "fullMap" ? "none" : "auto",
                zIndex: 0,
              }}
            >
              {coords ? (
                hasMapKey && !googleMapFailed && mapCenter ? (
                  <MapErrorBoundary>
                    <GoogleMapSurface
                      apiKey={effectiveGoogleMapsApiKey}
                      mapId={effectiveGoogleMapsMapId || undefined}
                      center={mapCenter}
                      zoom={13}
                      markers={allMapMarkers}
                      showRoadTrafficLayer={false}
                      userLocation={coords}
                      isNightTheme={false}
                      interactive={true}
                      onBoundsChanged={handleMapBoundsChanged}
                      onZoomChanged={handleMapZoomChanged}
                      onCenterChanged={handleMapCenterChanged}
                      onMarkerTap={handleMarkerTap}
                      onFatalError={() => setGoogleMapFailed(true)}
                    />
                  </MapErrorBoundary>
                ) : (
                  <Suspense fallback={<HeroMapFallback reason="loading" />}>
                    <ThemedScoutMap
                      userLocation={coords}
                      markers={allMapMarkers}
                      zoom={13}
                      onMarkerTap={handlePreviewMarkerTap}
                    />
                  </Suspense>
                )
              ) : (
                <HeroMapFallback
                  reason={
                    locationStatus === "denied"
                        ? "denied"
                        : "loading"
                  }
                />
              )}
            </div>

            {/* GoogleMapSurface:
                - Used for full interactive pan/zoom/tap-pin exploration.
                - Collapsed preview uses the same styled map family above.
            */}
            {sheetState === "fullMap" && hasMapKey && !googleMapFailed && coords && mapCenter ? (
              <div
                ref={googleMapContainerRef}
                data-testid="scout-interactive-map"
                className="absolute inset-0"
                style={{
                  visibility: "visible",
                  pointerEvents: sheetState === "fullMap" ? "auto" : "none",
                  zIndex: 1,
                }}
              >
                <MapErrorBoundary>
                  <GoogleMapSurface
                    apiKey={effectiveGoogleMapsApiKey}
                    mapId={effectiveGoogleMapsMapId || undefined}
                    center={mapCenter}
                    zoom={mapZoom}
                    markers={allMapMarkers}
                    showRoadTrafficLayer={false}
                    userLocation={coords}
                    isNightTheme={false}
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
                {coords ? (
                  <>
                    <Suspense fallback={<HeroMapFallback reason="loading" />}>
                      <ThemedScoutMap
                        userLocation={coords}
                        markers={allMapMarkers}
                        zoom={13}
                        interactive={true}
                        onMarkerTap={handlePreviewMarkerTap}
                      />
                    </Suspense>
                    {(!hasMapKey || googleMapFailed) && (
                      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/88 px-5 py-4 text-center text-sm font-bold text-orange-900 ring-1 ring-orange-200/60 backdrop-blur-xl">
                        Full pan and zoom are warming up. The local MealScout map is still live.
                      </div>
                    )}
                  </>
                ) : (
                  <HeroMapFallback
                    reason={locationStatus === "denied" ? "denied" : "loading"}
                  />
                )}
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
                  "linear-gradient(180deg, rgba(255,253,244,0.22) 0%, rgba(255,253,244,0.00) 38%, rgba(120,54,16,0.08) 68%, rgba(10,12,16,0.54) 100%), radial-gradient(circle at 50% 44%, rgba(255,168,86,0.18), transparent 22%)",
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
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/72 ring-1 ring-orange-200/60 backdrop-blur-md shadow-[0_8px_24px_rgba(154,72,18,0.16)]"
              >
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt={firstName ? `${firstName}'s profile` : "Your profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-5 w-5 text-orange-700" aria-hidden="true" />
                )}
              </Link>

              <button
                type="button"
                onClick={requestLocation}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white/76 px-4 text-sm font-black text-orange-900 ring-1 ring-orange-200/60 backdrop-blur-md shadow-[0_8px_24px_rgba(154,72,18,0.14)] transition-transform active:scale-95"
                aria-label={`Refresh location. Currently ${shortLocation}.`}
              >
                {locationStatus === "requesting" ? (
                    <svg className="h-4 w-4 text-orange-600 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <MapPin className="h-4 w-4 text-orange-600" aria-hidden="true" />
                )}
                <span className="truncate max-w-[180px]">{shortLocation}</span>
              </button>

              <button
                type="button"
                onClick={openScoutMap}
                aria-label="Expand map to fullscreen"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/78 ring-1 ring-orange-200/70 backdrop-blur-md"
                style={{ boxShadow: "0 8px 24px rgba(154,72,18,0.18)" }}
              >
                <Maximize2 className="h-5 w-5 text-orange-700" aria-hidden="true" />
              </button>
            </div>
          )}





          {/* Floating "Collapse" button (top-right) — visible in fullMap state. */}
          {sheetState === "fullMap" && (
            <button
              type="button"
              onClick={collapseScoutMap}
              aria-label="Collapse map and return to discover"
              className="absolute z-30 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] inline-flex h-12 items-center gap-2 rounded-full bg-white/90 px-4 font-black text-orange-800 ring-1 ring-orange-200/70 backdrop-blur-md transition-colors hover:bg-orange-50"
              style={{
                boxShadow: "0 12px 30px rgba(154,72,18,0.18)",
              }}
            >
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm">Collapse</span>
            </button>
          )}

          {sheetState === "fullMap" && (
            <ScoutMapHud
              locationLabel={shortLocation}
              liveTruckCount={liveTrucks.length}
              restaurantCount={nearbyRestaurants.length}
              parkingHostCount={localParkingPassHosts.length}
              eventCount={visibleEvents.length}
              dealCount={allDeals.length}
              localSignalCount={localSignalCount}
              discoveryRadiusKm={discoveryRadiusKm}
              onRadiusChange={updateDiscoveryRadiusKm}
              onRecenter={() => {
                if (coords) {
                  setMapCenter(coords);
                  setMapZoom(14);
                }
              }}
            />
          )}

          {sheetState === "fullMap" && selectedLiveTruck && (
            <LiveTruckMapCard
              truck={selectedLiveTruck}
              userLocation={coords}
              onClose={() => setSelectedLiveTruck(null)}
            />
          )}

          {sheetState === "fullMap" && selectedMapMarker && (
            <MapPlaceCard
              marker={selectedMapMarker}
              userLocation={coords}
              onClose={() => setSelectedMapMarker(null)}
            />
          )}

          {sheetState === "fullMap" && mapBounds && (
            <MapEdgeIndicators
              markers={allMapMarkers}
              bounds={mapBounds}
              center={mapCenter || coords}
              selectedId={selectedLiveTruck ? String(selectedLiveTruck.id) : selectedMapMarker?.id || null}
              onSelect={(marker) => {
                setMapCenter({ lat: marker.lat, lng: marker.lng });
                setMapZoom(Math.max(mapZoom, 15));
                if (marker.kind === "truck") {
                  const truck = liveTruckById.get(String(marker.sourceId));
                  if (truck) setSelectedLiveTruck(truck);
                } else {
                  setSelectedLiveTruck(null);
                  setSelectedMapMarker(marker);
                }
              }}
            />
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
            className="relative z-10 -mt-24 rounded-t-[2rem] bg-[#0a0c10]/76 backdrop-blur-xl"
            style={{
              boxShadow:
                "0 -28px 70px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
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
              className="flex h-12 w-full cursor-pointer items-center justify-center"
              style={{ touchAction: "none" }}
            >
              <span
                aria-hidden="true"
                className="block h-1.5 w-12 rounded-full bg-orange-100/35"
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
              discoveryRadiusKm={discoveryRadiusKm}
              onRadiusChange={updateDiscoveryRadiusKm}
              onRefreshLocation={requestLocation}
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
                    {localMenuItems.slice(0, 12).map((item, index) => (
                      <li key={item.id} className="shrink-0 w-[210px] sm:w-[230px]">
                        <LocalMenuItemCard item={item} position={index} />
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
                          <TruckCard truck={t} onSelect={selectLiveTruck} />
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
                        <li key={parkingPassHostKey(h)} className="shrink-0 w-[200px] sm:w-[220px]">
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
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-orange-500/12 px-2.5 py-1 ring-1 ring-orange-300/20">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-300" aria-hidden="true" />
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-200/80">
              Scout feed
            </span>
          </div>
          <h2 className="truncate text-white text-xl sm:text-2xl font-black tracking-tight">{title}</h2>
        </div>
        <Link
          href={linkHref}
          className="shrink-0 text-sm text-orange-200 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 ring-1 ring-white/10 font-semibold transition-colors hover:bg-white/[0.08]"
        >
          See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {subtitle ? (
        <p className="mt-1.5 text-xs sm:text-sm text-white/64 leading-relaxed">{subtitle}</p>
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
  discoveryRadiusKm,
  onRadiusChange,
  onRefreshLocation,
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
  discoveryRadiusKm: number;
  onRadiusChange: (value: number) => void;
  onRefreshLocation: () => void;
}) {
  const hasLocation = locationStatus === "ready";
  const signalLabel =
    localSignalCount > 0
      ? `${localSignalCount} live signal${localSignalCount === 1 ? "" : "s"}`
      : hasLocation
        ? "No live signal yet"
        : "Location off";

  const actionLanes = [
    {
      label: "Live trucks",
      count: liveTruckCount,
      href: "/truck-discovery",
      helper: liveTruckCount > 0 ? "Open now" : "Check nearby trucks",
    },
    {
      label: "Find dinner",
      count: restaurantCount,
      href: "/search",
      helper: restaurantCount > 0 ? "Nearby food spots" : "Browse all food",
    },
    {
      label: "Hot deals",
      count: dealCount,
      href: "/deals",
      helper: dealCount > 0 ? "Save money now" : "See available deals",
    },
    {
      label: "Tonight's events",
      count: eventCount,
      href: "/events",
      helper: eventCount > 0 ? "Food events nearby" : "Find upcoming events",
    },
    {
      label: "Fresh menus",
      count: menuItemCount,
      href: DISCOVERY_LAYERS.menuItems.href,
      helper: menuItemCount > 0 ? "New menu items" : "Explore menu drops",
    },
    {
      label: "Host parking",
      count: parkingHostCount,
      href: "/parking-pass",
      helper: parkingHostCount > 0 ? "Set up your spot" : "See host locations",
    },
  ];

  const sortedLanes = [...actionLanes].sort((a, b) => b.count - a.count);
  const featuredLanes = sortedLanes.slice(0, 3);
  const supportLanes = sortedLanes.slice(3);
  const hasAnythingLive = sortedLanes.some((lane) => lane.count > 0);
  const headline = !hasLocation
    ? "Enable location so Scout can load your nearby food scene."
    : hasAnythingLive
      ? "Here is the fastest way to jump into what is happening near you right now."
      : "Nothing is active yet. Widen radius or browse all categories.";

  const radiusOptions = [5, 12, 25, 40];
  const radiusMiles = Math.max(1, Math.round(discoveryRadiusKm * 0.621371));

  return (
    <section className="px-5 pt-2 pb-6">
      <div className="rounded-[1.65rem] overflow-hidden bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-md">
        <div
          className="px-4 py-4"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 0%, rgba(255,90,47,0.18), transparent 34%), radial-gradient(circle at 90% 12%, rgba(251,191,36,0.10), transparent 30%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/75 font-bold">
                What to eat right now
              </p>
              <h2 className="mt-1 text-white text-xl font-black leading-tight tracking-tight">
                {locationLabel}
              </h2>
              <p className="mt-1.5 text-white/62 text-xs leading-relaxed max-w-[32rem]">
                {headline}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[#120805]/45 ring-1 ring-orange-300/25 px-3 py-1 text-[11px] font-semibold text-orange-100">
              {signalLabel}
            </span>
          </div>

          {!hasLocation ? (
            <button
              type="button"
              onClick={onRefreshLocation}
              className="mt-3 w-full rounded-2xl bg-[#120805]/45 ring-1 ring-orange-300/30 px-4 py-3 text-left active:scale-[0.99]"
            >
              <p className="text-white text-sm font-bold">Use my location</p>
              <p className="mt-1 text-white/65 text-xs">
                This unlocks nearby trucks, deals, events, and food spots instantly.
              </p>
            </button>
          ) : null}

          <div className="mt-3 space-y-2.5">
            {featuredLanes.map((lane, index) => (
              <Link
                key={lane.label}
                href={lane.href}
                className="flex items-center justify-between gap-3 rounded-2xl bg-[#120805]/35 ring-1 ring-white/10 px-3.5 py-3 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm font-black truncate">
                    {index + 1}. {lane.label}
                  </p>
                  <p className="mt-0.5 text-white/62 text-xs truncate">{lane.helper}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="rounded-full bg-black/35 px-2 py-1 text-[11px] font-bold text-orange-100 ring-1 ring-white/10">
                    {lane.count}
                  </span>
                  <ChevronRight className="h-4 w-4 text-orange-300" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-3 rounded-2xl bg-[#120805]/30 ring-1 ring-white/8 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/70 font-bold">
                  Discovery radius
                </p>
                <p className="mt-0.5 text-white text-sm font-semibold">
                  {radiusMiles} mi around you
                </p>
              </div>
              <div className="flex rounded-full bg-black/25 p-1 ring-1 ring-white/10">
                {radiusOptions.map((radius) => {
                  const isActive = discoveryRadiusKm === radius;
                  return (
                    <button
                      key={radius}
                      type="button"
                      onClick={() => onRadiusChange(radius)}
                      className={[
                        "rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                        isActive
                          ? "bg-orange-400 text-[#1b0b02]"
                          : "text-white/62 hover:text-white",
                      ].join(" ")}
                      aria-pressed={isActive}
                    >
                      {Math.round(radius * 0.621371)} mi
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onRefreshLocation}
                className="shrink-0 inline-flex items-center gap-2 rounded-full bg-[#120805]/35 ring-1 ring-white/12 text-white px-3 py-2 text-xs font-semibold active:scale-[0.98]"
              >
                <Search className="h-3.5 w-3.5 text-orange-200" aria-hidden="true" />
                Refresh location
              </button>
              <div className="min-w-0 flex-1 overflow-x-auto atmo-hide-scrollbar">
                <div className="flex gap-2 pr-1">
                  {supportLanes.length > 0 ? (
                    supportLanes.map((lane) => (
                      <Link
                        key={`${lane.label}:${lane.href}`}
                        href={lane.href}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3 py-2 text-xs font-semibold text-white/82 active:scale-[0.98]"
                      >
                        {lane.label}
                        <span className="text-orange-100/80">{lane.count}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-orange-200" aria-hidden="true" />
                      </Link>
                    ))
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3 py-2 text-xs font-semibold text-white/62">
                      All food lanes already shown above
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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

function trackLocalMenuItemEngagement(payload: {
  eventName: "menu_item_impression" | "menu_item_click";
  itemId: string;
  restaurantId?: string | null;
  layerId?: string;
  surface?: string;
  position?: number;
  discoveryScore?: number | null;
  discoveryReasons?: string[] | null;
}) {
  void fetch("/api/menus/local-items/engagement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function LocalMenuItemCard({
  item,
  position,
}: {
  item: LocalMenuItemFeedItem;
  position: number;
}) {
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

  useEffect(() => {
    trackLocalMenuItemEngagement({
      eventName: "menu_item_impression",
      itemId: item.id,
      restaurantId: item.restaurantId,
      layerId: "menuItems",
      surface: "scout",
      position,
      discoveryScore: item.discoveryScore,
      discoveryReasons: item.discoveryReasons,
    });
  }, [item.id, item.restaurantId, item.discoveryScore, item.discoveryReasons, position]);

  return (
    <Link
      href={`/restaurant/${item.restaurantId}`}
      onClick={() =>
        trackLocalMenuItemEngagement({
          eventName: "menu_item_click",
          itemId: item.id,
          restaurantId: item.restaurantId,
          layerId: "menuItems",
          surface: "scout",
          position,
          discoveryScore: item.discoveryScore,
          discoveryReasons: item.discoveryReasons,
        })
      }
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
        {Array.isArray(item.discoveryReasons) &&
          item.discoveryReasons.length > 0 && (
            <p className="mt-2 text-[10px] font-semibold text-orange-200/70">
              {item.discoveryReasons.slice(0, 2).join(" + ")}
            </p>
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

function LiveTruckMapCard({
  truck,
  userLocation,
  onClose,
}: {
  truck: LiveTruckSummary;
  userLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const place = formatTruckPlace(truck);
  const directionsUrl = buildTruckDirectionsUrl(truck, userLocation);

  return (
    <div
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/35 backdrop-blur-xl"
      style={{ boxShadow: "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/25">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-300 animate-pulse" />
            Live truck
          </div>
          <h3 className="mt-2 truncate text-lg font-black">{truck.name || "Food Truck"}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-orange-100/80">
            <MapPin className="h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
            <span className="truncate">{place}</span>
          </p>
          <p className="mt-1 text-xs text-white/60">
            {[distance, wait].filter(Boolean).join(" · ") || "Center map to compare it with your location."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-bold text-white/60 ring-1 ring-white/10"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-orange-500 px-2 py-3 text-center text-xs font-black text-[#160904]"
        >
          <Navigation2 className="h-4 w-4" aria-hidden="true" />
          Directions
        </a>
        <Link
          href={`/truck/${truck.id}`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <Flame className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Profile
        </Link>
        <Link
          href={`/truck/${truck.id}?message=1`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <MessageCircle className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Message
        </Link>
      </div>
    </div>
  );
}

function MapPlaceCard({
  marker,
  userLocation,
  onClose,
}: {
  marker: MapAdapterMarker;
  userLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const destination =
    marker.kind === "restaurant"
      ? `/restaurant/${marker.sourceId}`
      : marker.kind === "parking"
        ? "/parking-pass"
        : "/events";
  const label =
    marker.kind === "restaurant"
      ? "Food spot"
      : marker.kind === "parking"
        ? "Truck host"
        : "Local event";
  const action =
    marker.kind === "restaurant"
      ? "Open profile"
      : marker.kind === "parking"
        ? "See host spots"
        : "See events";
  const originParam = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${marker.lat},${marker.lng}&travelmode=driving`;

  return (
    <div
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/35 backdrop-blur-xl"
      style={{ boxShadow: "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/25">
            {label}
          </div>
          <h3 className="mt-2 truncate text-lg font-black">
            {marker.title || label}
          </h3>
          {marker.subtitle ? (
            <p className="mt-1 text-sm text-orange-100/75">{marker.subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-bold text-white/60 ring-1 ring-white/10"
        >
          Close
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href={destination}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-3 py-3 text-center text-xs font-black text-[#160904]"
        >
          {action}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/8 px-3 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          Directions
          <Navigation2 className="h-4 w-4 text-orange-300" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function ScoutMapHud({
  locationLabel,
  liveTruckCount,
  restaurantCount,
  parkingHostCount,
  eventCount,
  dealCount,
  localSignalCount,
  discoveryRadiusKm,
  onRadiusChange,
  onRecenter,
}: {
  locationLabel: string;
  liveTruckCount: number;
  restaurantCount: number;
  parkingHostCount: number;
  eventCount: number;
  dealCount: number;
  localSignalCount: number;
  discoveryRadiusKm: number;
  onRadiusChange: (value: number) => void;
  onRecenter: () => void;
}) {
  const radiusOptions = [5, 12, 25, 40];
  const [isExpanded, setIsExpanded] = useState(false);
  const totalPins =
    liveTruckCount + restaurantCount + parkingHostCount + eventCount;
  const sceneLine =
    totalPins > 0
      ? `${liveTruckCount} trucks • ${dealCount} deals • ${eventCount} events`
      : "No live pins yet - move map or widen radius";

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 sm:left-4 sm:right-auto sm:w-[360px]">
      <div
        className="pointer-events-auto rounded-2xl bg-[#120805]/88 p-3 text-white ring-1 ring-orange-200/35 backdrop-blur-xl"
        style={{ boxShadow: "0 18px 54px rgba(0,0,0,0.52), 0 0 26px rgba(255,90,47,0.2)" }}
      >
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15 ring-1 ring-orange-200/30">
              <img
                src={mealScoutIcon}
                alt=""
                className="h-7 w-7 object-contain"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200/75">
                Scout live
              </p>
              <p className="truncate text-sm font-black text-white">
                Local food scene
              </p>
            </div>
          </div>
          <span className="rounded-full bg-orange-500/16 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-100 ring-1 ring-orange-200/25">
            Live
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-black text-orange-50">
              {locationLabel}
            </h2>
            <p className="text-[11px] font-semibold text-white/58">
              {sceneLine}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="rounded-full bg-white/8 px-3 py-2 text-xs font-black text-orange-100 ring-1 ring-orange-200/20 transition-colors hover:bg-white/12"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Less" : "Details"}
            </button>
            <button
              type="button"
              onClick={onRecenter}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ff5a2f] text-[#160904] ring-1 ring-orange-200/40 shadow-[0_0_18px_rgba(255,90,47,0.32)]"
              aria-label="Recenter map on your location"
            >
              <Navigation2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-3">
            <p className="text-xs text-white/62">
              Tap the glowing pins to jump into what's cooking near you right now.
            </p>
            <div className="mt-3 grid grid-cols-5 gap-2 text-center">
              <MapHudCount label="Trucks" value={liveTruckCount} />
              <MapHudCount label="Food" value={restaurantCount} />
              <MapHudCount label="Deals" value={dealCount} />
              <MapHudCount label="Hosts" value={parkingHostCount} />
              <MapHudCount label="Events" value={eventCount} />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-white/7 px-3 py-2 ring-1 ring-orange-200/12">
          <span className="text-xs font-bold text-white/72">
            Radius
          </span>
          <div className="flex rounded-full bg-black/25 p-1">
            {radiusOptions.map((radius) => {
              const isActive = discoveryRadiusKm === radius;
              return (
                <button
                  key={radius}
                  type="button"
                  onClick={() => onRadiusChange(radius)}
                  className={[
                    "rounded-full px-2 py-1 text-[10px] font-black transition-colors",
                    isActive
                      ? "bg-[#ff5a2f] text-[#1b0b02] shadow-[0_0_14px_rgba(255,90,47,0.3)]"
                      : "text-white/58 hover:text-white",
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  {Math.round(radius * 0.621371)} mi
                </button>
              );
            })}
          </div>
        </div>

        {isExpanded && localSignalCount === 0 ? (
          <div className="mt-3 rounded-2xl bg-white/7 px-3 py-2 text-xs text-white/72 ring-1 ring-white/10">
            No live local pins right here yet. Move the map or widen discovery from the feed below.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapHudCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/7 px-2 py-2 ring-1 ring-white/10">
      <p className="text-base font-black text-orange-200">{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide text-white/48">{label}</p>
    </div>
  );
}

function MapEdgeIndicators({
  markers,
  bounds,
  center,
  selectedId,
  onSelect,
}: {
  markers: MapAdapterMarker[];
  bounds: MapBoundsLike;
  center?: { lat: number; lng: number } | null;
  selectedId?: string | null;
  onSelect: (marker: MapAdapterMarker) => void;
}) {
  if (!center) return null;
  const offscreen = markers
    .filter((marker) => marker.kind !== "user")
    .filter((marker) => marker.id !== selectedId && marker.sourceId !== selectedId)
    .filter((marker) => !bounds.contains([marker.lat, marker.lng]))
    .map((marker) => {
      const dx = marker.lng - center.lng;
      const dy = marker.lat - center.lat;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const edge = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "top" : "bottom";
      const distanceScore = Math.sqrt(dx * dx + dy * dy);
      return { marker, edge, distanceScore };
    })
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, 8);

  if (offscreen.length === 0) return null;

  const byEdge = offscreen.reduce<Record<string, typeof offscreen>>(
    (acc, item) => {
      acc[item.edge] = acc[item.edge] || [];
      acc[item.edge].push(item);
      return acc;
    },
    {},
  );

  const edgeClass: Record<string, string> = {
    top: "left-1/2 top-[calc(env(safe-area-inset-top)+15.5rem)] -translate-x-1/2 flex-row",
    right: "right-3 top-1/2 -translate-y-1/2 flex-col",
    bottom: "left-1/2 bottom-[calc(env(safe-area-inset-bottom)+12rem)] -translate-x-1/2 flex-row",
    left: "left-3 top-1/2 -translate-y-1/2 flex-col",
  };

  return (
    <>
      {Object.entries(byEdge).map(([edge, items]) => (
        <div
          key={edge}
          className={`pointer-events-none absolute z-25 flex gap-2 ${edgeClass[edge]}`}
        >
          {items.slice(0, 3).map(({ marker }) => (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSelect(marker)}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1b0d05]/88 px-3 py-2 text-xs font-black text-orange-100 ring-1 ring-orange-300/35 backdrop-blur-xl"
              style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.42), 0 0 18px rgba(255,90,47,0.16)" }}
              aria-label={`Move map to ${marker.title || marker.kind}`}
            >
              <span className="text-orange-300">
                {edge === "left" ? "‹" : edge === "right" ? "›" : edge === "top" ? "⌃" : "⌄"}
              </span>
              <span>{marker.kind === "truck" ? "Truck" : marker.kind === "restaurant" ? "Food" : marker.kind === "parking" ? "Host" : "Event"}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function TruckCard({
  truck,
  onSelect,
}: {
  truck: LiveTruckSummary;
  onSelect?: (truck: LiveTruckSummary) => void;
}) {
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
      onClick={(event) => {
        if (!onSelect) return;
        event.preventDefault();
        onSelect(truck);
      }}
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
