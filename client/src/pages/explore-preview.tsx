import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
  Tag,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import { GoogleMapSurface } from "@/components/maps/google-map-surface";
import { ThemedScoutMap } from "@/components/maps/themed-scout-map";
import { MapErrorBoundary } from "@/components/maps/map-error-boundary";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import { SVGStreetMap } from "@/components/maps/svg-street-map";
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";

/**
 * /scout — The canonical MealScout food discovery page.
 * Also accessible at /explore-preview (backward-compat alias).
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
  distanceMiles?: number | null;
  distance?: number | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
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

// ============================================================
// ACCESS GATE (TEMPORARY)
// /explore-preview is hidden behind an email allow-list so we can
// validate against real backend data without exposing it to anyone
// else. To roll out publicly, remove this gate and rename the route.
// ============================================================
const EXPLORE_PREVIEW_ALLOWED_EMAILS = ["info.mealscout@gmail.com"];

export default function ExplorePreview() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useWouterLocation();

  // ---- account gate ----
  const userEmail = (user?.email || "").trim().toLowerCase();
  const isAllowed = EXPLORE_PREVIEW_ALLOWED_EMAILS.includes(userEmail);

  useEffect(() => {
    if (authLoading) return; // wait until auth resolves
    if (!isAllowed) {
      navigate("/explore");
    }
    // we deliberately depend only on the resolved auth state and the
    // computed allow flag so the redirect fires once per gate change
  }, [authLoading, isAllowed, navigate]);

  // While auth is resolving, render a quiet dark splash so non-allowed
  // visitors never see a flash of the preview UI before the redirect.
  if (authLoading || !isAllowed) {
    return (
      <div
        className="min-h-[100dvh] w-full bg-[#0a0c10]"
        aria-hidden="true"
      />
    );
  }

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
    return parkingPassHosts.filter((listing) =>
      isWithinScoutRadius(
        coords,
        listing.latitude ?? listing.host?.latitude,
        listing.longitude ?? listing.host?.longitude,
        SCOUT_LOCAL_RADIUS_KM,
      ),
    );
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

  const openScoutMap = useCallback(() => {
    const params = new URLSearchParams();
    params.set("src", "scout");
    if (
      coords &&
      Number.isFinite(coords.lat) &&
      Number.isFinite(coords.lng)
    ) {
      params.set("lat", String(coords.lat));
      params.set("lng", String(coords.lng));
      params.set("z", String(Math.max(12, Math.round(mapZoom || HERO_ZOOM))));
    }
    const q = params.toString();
    navigate(q ? `/map?${q}` : "/map");
  }, [coords, mapZoom, navigate]);

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

  const [sheetState, setSheetState] = useState<"default" | "fullMap">("default");
  // Once the full map has been opened once, keep GoogleMapSurface mounted
  // (just hidden) so it doesn't re-initialize on every collapse/expand.
  // Using state (not ref) so React re-renders when the map should first mount.
  const [hasOpenedFullMap, setHasOpenedFullMap] = useState(false);
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null);

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
    const start = dragStartY.current;
    if (start !== null && window.scrollY <= 0 && y - start > 10) {
      e.preventDefault();
    }
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
      if (delta > 10) e.preventDefault();
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

  /* --------- map availability flag --------- */

  const hasMapKey = GOOGLE_MAPS_WEB_API_KEY.length > 0;

  /* --------- render --------- */

  const goToCraving = (cat: CravingCategory) => {
    navigate(`/find-food?cuisine=${encodeURIComponent(cat.query)}`);
  };

  const showFoodTrucksSection = liveTrucksLoading || liveTrucks.length > 0;
  const showRestaurantsSection =
    nearbyRestaurantsLoading || nearbyRestaurants.length > 0;
  const showParkingHostsSection = parkingPassLoading || localParkingPassHosts.length > 0;
  const showDealsSection = allDeals.length > 0;
  const showEventsSection = visibleEvents.length > 0;
  const localSignalCount =
    liveTrucks.length +
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
          className="relative w-full overflow-hidden"
          style={{
            height:
              sheetState === "fullMap" ? "100dvh" : "min(38vh, 320px)",
            transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
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
              DEFAULT state: a custom themed atmospheric overlay (ThemedScoutMap)
                that uses real map data but renders in MealScout's brand
                aesthetic — dark, glowing amber pins, user pin anchored to
                the right third, slow drift animation. NO Google Maps SDK
                is mounted in this state, so referrer/billing failures on
                the JS API can never break the hero.
              FULLMAP state: the real interactive Google Map widget
                (GoogleMapSurface) for full pan/zoom/tap-pin exploration.
          */}
          <div className="absolute inset-0">
            {/* CSSMapHero: atmospheric SVG hero — always mounted, hidden in fullMap */}
            <div
              className="absolute inset-0"
              style={{
                visibility: sheetState === "fullMap" ? "hidden" : "visible",
                pointerEvents: sheetState === "fullMap" ? "none" : "auto",
              }}
            >
              <CSSMapHero
                markers={truckMarkers}
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
            {hasMapKey && coords && mapCenter && hasOpenedFullMap ? (
              <div
                ref={googleMapContainerRef}
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
                  />
                </MapErrorBoundary>
              </div>
            ) : sheetState === "fullMap" && (!hasMapKey || !coords || !mapCenter) ? (
              <div className="absolute inset-0" style={{ zIndex: 1 }}>
                <HeroMapFallback
                  reason={
                    !hasMapKey
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
                className="flex items-center justify-center h-12 w-12 rounded-full overflow-hidden ring-2 ring-white/30 bg-black/60 backdrop-blur-md shrink-0"
              >
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt={firstName ? `${firstName}'s profile` : "Your profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-5 w-5 text-amber-300" aria-hidden="true" />
                )}
              </Link>

              <button
                type="button"
                onClick={requestLocation}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full text-white text-sm font-medium px-4 bg-black/55 backdrop-blur-md ring-1 ring-white/15 active:scale-95 transition-transform"
                aria-label={`Refresh location. Currently ${shortLocation}.`}
              >
                {locationStatus === "requesting" ? (
                  <svg className="h-4 w-4 text-amber-300 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
                )}
                <span className="truncate max-w-[180px]">{shortLocation}</span>
              </button>

              <button
                type="button"
                onClick={openScoutMap}
                aria-label="Expand map to fullscreen"
                className="flex items-center justify-center h-12 w-12 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-amber-300/40 shrink-0"
                style={{ boxShadow: "0 0 14px rgba(245,158,11,0.3)" }}
              >
                <Maximize2 className="h-5 w-5 text-amber-300" aria-hidden="true" />
              </button>
            </div>
          )}





          {/* Floating "Collapse" button (top-right) — visible in fullMap state. */}
          {sheetState === "fullMap" && (
            <button
              type="button"
              onClick={() => setSheetState("default")}
              aria-label="Collapse map and return to discover"
              className="absolute z-30 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] inline-flex items-center gap-2 h-12 px-4 rounded-full bg-black/75 backdrop-blur-md ring-1 ring-amber-300/60 text-amber-100 font-semibold"
              style={{
                boxShadow: "0 0 22px rgba(245,158,11,0.45)",
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
                title="Explore by Craving"
                linkHref="/find-food"
                subtitle="Jump into local food by mood, not by chain category."
              />
              <ul className="flex items-start justify-between gap-2 pb-2" role="list">
                {CRAVING_CATEGORIES.map((cat) => (
                  <li key={cat.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => goToCraving(cat)}
                      aria-label={`Explore ${cat.label}`}
                      className="group flex flex-col items-center gap-2 w-[52px] sm:w-[64px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 rounded-2xl active:scale-[0.97] transition-transform"
                    >
                      <span
                        className="h-[52px] w-[52px] sm:h-[64px] sm:w-[64px] rounded-full overflow-hidden ring-2 ring-amber-400/70 bg-black/60 group-hover:ring-amber-300 transition-all"
                        style={{ boxShadow: "0 0 0 3px rgba(245,158,11,0.14), 0 0 18px rgba(245,158,11,0.45)" }}
                      >
                        <img src={cat.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </span>
                      <span className="text-white text-[11px] sm:text-xs font-semibold">{cat.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── FOOD TRUCKS NEAR YOU ── */}
            {showFoodTrucksSection && (
              <section className="pl-5 pr-0 pt-2 pb-10">
                <SectionHeader
                  title="Food Trucks Near You"
                  linkHref="/truck-discovery"
                  subtitle="All nearby trucks that are broadcasting or ready to be discovered."
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
                  title="Restaurants Near You"
                  linkHref="/find-food"
                  subtitle="Local restaurants and bars worth knowing about - not a fast-food feed."
                />
                {nearbyRestaurantsLoading && nearbyRestaurants.length === 0 ? (
                  <HorizontalSkeletonRow count={3} width={200} />
                ) : (
                  <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                    <ul className="flex gap-4 pr-5" role="list" aria-label="Restaurants near you">
                      {nearbyRestaurants.slice(0, 10).map((r) => (
                        <li key={r.id} className="shrink-0 w-[200px] sm:w-[220px]">
                          <NearbyRestaurantCard restaurant={r} />
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
                  title="Parking Pass Hosts"
                  linkHref="/parking-pass"
                  subtitle="Host locations are places that let food trucks park, serve, and build a route."
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
                  title="Deals Near You"
                  linkHref="/deals"
                  subtitle="Active offers from nearby restaurants, bars, and food trucks."
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
                  title="Happening Tonight"
                  linkHref="/events"
                  subtitle="Upcoming events, pop-ups, and food nights near you."
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
                title="Your Saved"
                linkHref="/favorites"
                subtitle="Your personal shortlist for trucks, restaurants, deals, and places to revisit."
              />
              <button
                type="button"
                onClick={() => navigate("/favorites")}
                className="w-full text-left rounded-3xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-5 hover:bg-white/8 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-center gap-4">
                  <span className="h-12 w-12 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0" aria-hidden="true">
                    <Bookmark className="h-5 w-5 text-amber-300" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold">Your saved spots</p>
                    <p className="text-white/60 text-sm mt-0.5">Trucks, restaurants, and deals you've saved.</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-white/50" aria-hidden="true" />
                </div>
              </button>
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
          className="text-sm text-amber-300 inline-flex items-center gap-1 font-medium"
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
              "radial-gradient(circle at 16% 0%, rgba(245,158,11,0.22), transparent 34%), radial-gradient(circle at 84% 8%, rgba(34,197,94,0.10), transparent 30%)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/75 font-bold">
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
            <span className="shrink-0 rounded-full bg-black/35 ring-1 ring-amber-300/25 px-3 py-1 text-[11px] font-semibold text-amber-100">
              {signalLabel}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenMap}
              className="inline-flex items-center gap-2 rounded-full bg-amber-300 text-black px-3.5 py-2 text-sm font-bold active:scale-[0.98]"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Open map
            </button>
            <button
              type="button"
              onClick={onRefreshLocation}
              className="inline-flex items-center gap-2 rounded-full bg-black/35 ring-1 ring-white/12 text-white px-3.5 py-2 text-sm font-semibold active:scale-[0.98]"
            >
              <Search className="h-4 w-4 text-amber-200" aria-hidden="true" />
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
                className="rounded-2xl bg-black/30 ring-1 ring-white/8 px-3 py-3 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-300/12 text-amber-200 ring-1 ring-amber-300/20">
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
                  <ChevronRight className="h-4 w-4 text-amber-200" aria-hidden="true" />
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
        filter: "drop-shadow(0 0 14px rgba(251,146,60,0.95)) drop-shadow(0 0 28px rgba(245,158,11,0.6)) drop-shadow(0 0 48px rgba(245,158,11,0.35))",
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
          background: "rgba(245,158,11,0.18)",
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

function CSSMapHero({
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
          background: "radial-gradient(ellipse 70% 55% at 52% 48%, rgba(245,158,11,0.13) 0%, rgba(249,115,22,0.07) 40%, transparent 72%)",
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
          0%   { background: radial-gradient(ellipse at 20% 60%, rgba(245,158,11,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          25%  { background: radial-gradient(ellipse at 55% 70%, rgba(245,158,11,0.14) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 20% 25%, rgba(180,83,9,0.16) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          50%  { background: radial-gradient(ellipse at 70% 50%, rgba(245,158,11,0.20) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 30% 70%, rgba(180,83,9,0.10) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          75%  { background: radial-gradient(ellipse at 35% 35%, rgba(245,158,11,0.15) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 65% 65%, rgba(180,83,9,0.18) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          100% { background: radial-gradient(ellipse at 20% 60%, rgba(245,158,11,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
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
          className="inline-flex h-12 w-12 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 items-center justify-center mb-3"
          aria-hidden="true"
        >
          <MapPin className="h-5 w-5 text-amber-300" />
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
      className="block w-full text-left rounded-2xl overflow-hidden bg-white/5 backdrop-blur-md ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
      aria-label={title}
    >
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <span
            className="h-9 w-9 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <MapPin className="h-4 w-4 text-amber-300" />
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
      className="block rounded-3xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 bg-black/40 ring-1 ring-white/10"
      aria-label={`Open ${truck.name}`}
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
    >
      <div className="relative aspect-[4/5] w-full bg-black/60">
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
                "linear-gradient(160deg, rgba(245,158,11,0.18), rgba(0,0,0,0.6))",
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

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-white bg-amber-500 shadow-md">
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
          className="absolute top-2.5 right-2.5 h-9 w-9 rounded-full flex items-center justify-center bg-black/30 backdrop-blur-sm hover:bg-black/50 transition-colors"
        >
          <Heart className="h-5 w-5 text-white" aria-hidden="true" />
        </button>

        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight truncate">
            {truck.name}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-amber-200 text-sm font-semibold">
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
      className="block rounded-3xl overflow-hidden bg-black/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open deal ${deal.title || ""}`}
    >
      <div className="relative aspect-[4/5] w-full bg-black/60">
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
          <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-black bg-amber-300 shadow-md">
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
      className="block rounded-3xl overflow-hidden bg-black/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open event ${title}`}
    >
      <div className="relative aspect-[4/5] w-full bg-black/60">
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
            <p className="mt-1 inline-flex items-center gap-1.5 text-amber-200 text-xs font-semibold">
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
          className="h-10 w-10 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0"
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
            className="mt-3 inline-flex items-center gap-1.5 text-amber-200 text-sm font-semibold"
          >
            {ctaLabel} <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NearbyRestaurantCard({ restaurant }: { restaurant: RestaurantSummary }) {
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const img = restaurant.coverImageUrl || restaurant.heroImageUrl || restaurant.imageUrl || restaurant.logoUrl;
  const cuisine = restaurant.cuisineType;
  const location = restaurant.neighborhood || restaurant.city;
  const dealCount = restaurant.activeDealsCount ?? 0;
  const dist = restaurant.distanceMiles ?? (restaurant.distance ? restaurant.distance * 0.621371 : null);
  const distLabel = typeof dist === "number" && Number.isFinite(dist)
    ? `${dist.toFixed(dist < 10 ? 1 : 0)} mi`
    : null;

  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="block rounded-2xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 bg-black/40 ring-1 ring-white/10"
      aria-label={`Open ${name}`}
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] w-full bg-black/60">
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
              backgroundImage: "linear-gradient(160deg, rgba(245,158,11,0.18), rgba(0,0,0,0.6))",
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
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-amber-500 shadow">
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
            <span className="text-amber-300/80 text-[11px]">{cuisine}</span>
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
            className="text-sm text-amber-300 inline-flex items-center gap-1 font-medium"
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
      className="block rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-amber-400/40 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
    >
      {/* Hero image */}
      <div className="relative aspect-[4/3] w-full bg-black/40 overflow-hidden">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Flame className="h-8 w-8 text-amber-400/40" aria-hidden="true" />
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
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-amber-500 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            Deal
          </span>
        ) : null}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && <span className="text-amber-300/80 text-[11px]">{cuisine}</span>}
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
      className="block rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-amber-400/40 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
    >
      {/* Hero image */}
      <div className="relative aspect-[4/3] w-full bg-black/40 overflow-hidden">
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
                  "linear-gradient(150deg, rgba(245,158,11,0.24), rgba(2,6,23,0.92))",
              }}
              aria-hidden="true"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <MapPin className="h-8 w-8 text-amber-300/70" aria-hidden="true" />
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
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-black bg-amber-300 shadow">
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
            <span className="text-amber-300/70 text-[11px]">{spots} spot{spots !== 1 ? "s" : ""}</span>
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
