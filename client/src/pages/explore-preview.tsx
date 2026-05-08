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
  Navigation as NavigationIcon,
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
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";

/**
 * /explore-preview — TEMPORARY testing route for the next-generation
 * MealScout discovery experience. Hidden from global nav.
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
  logoUrl?: string | null;
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
}

type EventsResponse = { events?: EventSummary[] } | EventSummary[] | null;

interface RestaurantSummary {
  id: string;
  businessName?: string | null;
  name?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  activeDealsCount?: number;
  distanceMiles?: number | null;
  distance?: number | null;
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
        `/api/trucks/live?lat=${coords.lat}&lng=${coords.lng}&radiusKm=7`,
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
    if (Array.isArray(liveTrucksData)) return liveTrucksData;
    if (Array.isArray(liveTrucksData.trucks)) return liveTrucksData.trucks;
    return [];
  }, [liveTrucksData]);

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

  /* --------- nearby restaurants --------- */

  const { data: nearbyRestaurantsData, isLoading: nearbyRestaurantsLoading } = useQuery<RestaurantSummary[]>({
    queryKey: coords
      ? ["/api/restaurants/subscribed", coords.lat, coords.lng]
      : ["/api/restaurants/subscribed", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/restaurants/subscribed/${coords.lat}/${coords.lng}?radius=25`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 120_000,
  });

  const nearbyRestaurants = useMemo<RestaurantSummary[]>(() => {
    if (!nearbyRestaurantsData) return [];
    if (Array.isArray(nearbyRestaurantsData)) return nearbyRestaurantsData;
    return [];
  }, [nearbyRestaurantsData]);

  /* --------- parking pass hosts --------- */

  interface ParkingPassListing {
    id: string;
    hostId?: string | null;
    hostName?: string | null;
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    imageUrl?: string | null;
    heroImageUrl?: string | null;
    spotCount?: number | null;
    availableSpots?: number | null;
    paymentsEnabled?: boolean | null;
    latitude?: number | null;
    longitude?: number | null;
    host?: {
      businessName?: string | null;
      city?: string | null;
      state?: string | null;
      imageUrl?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null;
  }

  const { data: parkingPassData, isLoading: parkingPassLoading } = useQuery<ParkingPassListing[]>({
    queryKey: ["/api/parking-pass"],
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

  /* --------- nearby deals (location-aware) --------- */

  const { data: nearbyDealsData } = useQuery<DealSummary[]>({
    queryKey: coords
      ? ["/api/deals/nearby", coords.lat, coords.lng]
      : ["/api/deals/nearby", "no-location"],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return [];
      const response = await fetch(
        `/api/deals/nearby/${coords.lat}/${coords.lng}`,
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

  // Merge nearby + featured deals, deduplicate by id, prefer nearby
  const allDeals = useMemo<DealSummary[]>(() => {
    const seen = new Set<string>();
    const merged: DealSummary[] = [];
    for (const d of [...nearbyDeals, ...deals]) {
      if (!seen.has(d.id)) { seen.add(d.id); merged.push(d); }
    }
    return merged;
  }, [nearbyDeals, deals]);

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

  /* --------- map state --------- */

  const HERO_ZOOM = 14;
  const [mapZoom, setMapZoom] = useState<number>(HERO_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const userPushedMapRef = useRef(false);

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
    },
    [navigate],
  );

  /* --------- pull-down-to-fullscreen sheet --------- */

  const [sheetState, setSheetState] = useState<"default" | "fullMap">("default");

  const dragStartY = useRef<number | null>(null);
  const dragLastY = useRef<number | null>(null);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragLastY.current = e.touches[0].clientY;
  }, []);
  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    dragLastY.current = e.touches[0].clientY;
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
      setSheetState("fullMap");
    }
    if (delta < -40 && sheetState === "fullMap") {
      setSheetState("default");
    }
  }, [sheetState]);

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

  return (
    <>
      <SEOHead
        title="Explore Preview | MealScout"
        description="Live local food scene with an interactive map."
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
            {sheetState === "fullMap" ? (
              hasMapKey && coords && mapCenter ? (
                <MapErrorBoundary>
                  <GoogleMapSurface
                    apiKey={GOOGLE_MAPS_WEB_API_KEY}
                    center={mapCenter}
                    zoom={mapZoom}
                    markers={truckMarkers}
                    showRoadTrafficLayer={false}
                    userLocation={coords}
                    isNightTheme={true}
                    onBoundsChanged={handleMapBoundsChanged}
                    onZoomChanged={handleMapZoomChanged}
                    onCenterChanged={handleMapCenterChanged}
                    onMarkerTap={handleMarkerTap}
                  />
                </MapErrorBoundary>
              ) : (
                <HeroMapFallback
                  reason={
                    !hasMapKey
                      ? "no-key"
                      : locationStatus === "denied"
                        ? "denied"
                        : "loading"
                  }
                />
              )
            ) : (
              <CSSMapHero
                markers={truckMarkers}
                userLocation={coords ?? { lat: 30.4213, lng: -87.2169 }}
              />
            )}
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
                onClick={() => setSheetState("fullMap")}
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
              onClick={() => setSheetState("fullMap")}
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
              onExpandMap={() => setSheetState("fullMap")}
            />

            {/* ── EXPLORE BY CRAVING ── */}
            <section className="px-5 pt-2 pb-10">
              <SectionHeader title="Explore by Craving" linkHref="/find-food" />
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
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Food Trucks Near You" linkHref="/trucks" />
              {liveTrucksLoading && liveTrucks.length === 0 ? (
                <HorizontalSkeletonRow count={3} width={200} />
              ) : liveTrucks.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list" aria-label="Food trucks near you">
                    {liveTrucks.slice(0, 12).map((t) => (
                      <li key={t.id} className="shrink-0 w-[200px] sm:w-[220px]">
                        <TruckCard truck={t} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<Flame className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No trucks broadcasting right now."
                  body="Trucks pop up throughout the day — check back later or scout the map."
                />
              )}
            </section>

            {/* ── NEARBY RESTAURANTS ── */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Restaurants Near You" linkHref="/restaurants" />
              {nearbyRestaurantsLoading && nearbyRestaurants.length === 0 ? (
                <HorizontalSkeletonRow count={3} width={200} />
              ) : nearbyRestaurants.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list" aria-label="Restaurants near you">
                    {nearbyRestaurants.slice(0, 10).map((r) => (
                      <li key={r.id} className="shrink-0 w-[200px] sm:w-[220px]">
                        <NearbyRestaurantCard restaurant={r} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<MapPin className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No restaurants in your area yet."
                  body="As more restaurants join MealScout, they'll show up here."
                />
              )}
            </section>

            {/* ── PARKING PASS HOSTS ── */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Parking Pass Hosts" linkHref="/parking-pass" />
              {parkingPassLoading && parkingPassHosts.length === 0 ? (
                <HorizontalSkeletonRow count={3} width={200} />
              ) : parkingPassHosts.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list" aria-label="Parking pass hosts">
                    {parkingPassHosts.slice(0, 8).map((h) => (
                      <li key={h.id} className="shrink-0 w-[200px] sm:w-[220px]">
                        <ParkingPassCard listing={h} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<MapPin className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No parking pass hosts near you yet."
                  body="Hosts offering truck parking spots will appear here as they go live."
                  onCta={() => navigate("/parking-pass")}
                  ctaLabel="Browse all hosts"
                />
              )}
            </section>

            {/* ── DEALS NEAR YOU ── */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Deals Near You" linkHref="/deals" />
              {allDeals.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list">
                    {allDeals.slice(0, 10).map((d) => (
                      <li key={d.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <DealCard deal={d} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<Tag className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No deals near you right now."
                  body="When local restaurants and trucks publish deals, they'll show up here."
                  onCta={() => navigate("/deals")}
                  ctaLabel="Browse all deals"
                />
              )}
            </section>

            {/* ── HAPPENING TONIGHT ── */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Happening Tonight" linkHref="/events" />
              {events.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list">
                    {events.slice(0, 8).map((e) => (
                      <li key={e.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <EventCard event={e} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<CalendarDays className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No public events on deck."
                  body="Pop-ups, food truck nights, and tastings show up here as they go live."
                  onCta={() => navigate("/events")}
                  ctaLabel="See all events"
                />
              )}
            </section>

            {/* ── YOUR SAVED ── */}
            <section className="px-5 pt-2 pb-12">
              <SectionHeader title="Your Saved" linkHref="/favorites" />
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
}: {
  title: string;
  linkHref: string;
}) {
  return (
    <div className="flex items-baseline justify-between pr-5 mb-5">
      <h2 className="text-white text-xl sm:text-2xl font-bold">{title}</h2>
      <Link
        href={linkHref}
        className="text-sm text-amber-300 inline-flex items-center gap-1 font-medium"
      >
        See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/* ============================================================
   REAL-TILE MAP HERO
   Uses Carto dark tiles loaded via <img> tags (no SDK) stitched
   into a 3×3 grid centered on the user's lat/lng at zoom 15.
   CSS perspective tilt gives the Google Earth 3D look.
   Amber overlay + real projected pins sit on top.
   ============================================================ */

const HERO_TILE_ZOOM = 15;

/** Convert lat/lng to tile x/y at a given zoom level (Mercator). */
function latlngToTile(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

/**
 * Convert a lat/lng to a pixel offset within the 3×3 tile grid (768×768px).
 * The center tile's top-left is at pixel (256, 256).
 * Returns percentage of the 768px grid width/height.
 */
function latlngToGridPct(
  lat: number,
  lng: number,
  centerTileX: number,
  centerTileY: number,
  zoom: number,
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const tileX = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const tileY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  // Offset from top-left of center tile in pixels (each tile = 256px)
  const pxX = (tileX - centerTileX + 1) * 256; // +1 because grid starts at centerTile-1
  const pxY = (tileY - centerTileY + 1) * 256;
  return { x: pxX / 768, y: pxY / 768 };
}

function CSSMapHero({
  markers,
  userLocation,
}: {
  markers: MapAdapterMarker[];
  userLocation: { lat: number; lng: number };
}) {
  // Recompute whenever userLocation changes — map tracks user movement
  const { centerTileX, centerTileY, tiles, userPct } = useMemo(() => {
    const { x: ctx, y: cty } = latlngToTile(
      userLocation.lat,
      userLocation.lng,
      HERO_TILE_ZOOM,
    );
    const t: { tx: number; ty: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        t.push({ tx: ctx + dx, ty: cty + dy });
      }
    }
    // User is always at the exact center of the 768×768 grid (50%, 50%)
    // because the tile grid is centered on their tile.
    // Sub-tile offset: how far within the center tile the user sits.
    const n = Math.pow(2, HERO_TILE_ZOOM);
    const exactTileX = ((userLocation.lng + 180) / 360) * n;
    const latRad = (userLocation.lat * Math.PI) / 180;
    const exactTileY =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    // Sub-pixel offset within the center tile (0–1 within 256px tile)
    const subX = exactTileX - Math.floor(exactTileX);
    const subY = exactTileY - Math.floor(exactTileY);
    // In the 768px grid, center tile starts at px 256
    const pxX = 256 + subX * 256;
    const pxY = 256 + subY * 256;
    return {
      centerTileX: ctx,
      centerTileY: cty,
      tiles: t,
      userPct: { x: pxX / 768, y: pxY / 768 },
    };
  }, [userLocation.lat, userLocation.lng]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes hero-tile-drift {
          /* Pure X-axis breathing only — no Z rotation, no lateral drift */
          0%   { transform: rotateX(48deg) rotateZ(-6deg); }
          50%  { transform: rotateX(49.5deg) rotateZ(-6deg); }
          100% { transform: rotateX(48deg) rotateZ(-6deg); }
        }
        @keyframes hero-pin-pulse {
          0%   { transform: scale(0.7); opacity: 0.8; }
          70%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes hero-user-pulse {
          0%   { transform: scale(0.8); opacity: 0.9; }
          70%  { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        /* Hide Leaflet attribution in hero — it's a non-interactive preview */
        .hero-tile-grid .leaflet-control { display: none !important; }
      `}</style>

      {/* Dark base */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: "#05070d" }} />

      {/* 3D perspective wrapper */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ perspective: "700px", perspectiveOrigin: "50% 25%", overflow: "hidden" }}
      >
        {/* Tilted tile plane — oversized so edges don't show after tilt */}
        <div
          style={{
            position: "absolute",
            // Center the 768×768 grid and scale up slightly to fill after tilt
            left: "50%",
            top: "50%",
            width: 768,
            height: 768,
            marginLeft: -384,
            marginTop: -384,
            transform: "rotateX(48deg) rotateZ(-6deg)",
            transformOrigin: "50% 60%",
            animation: "hero-tile-drift 20s ease-in-out infinite",
          }}
        >
          {/* 3×3 tile grid — brightness boosted so streets read clearly */}
          <div
            className="hero-tile-grid"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              gridTemplateColumns: "256px 256px 256px",
              gridTemplateRows: "256px 256px 256px",
              filter: "brightness(1.6) contrast(1.1)",
            }}
          >
            {tiles.map(({ tx, ty }) => (
              <img
                key={`${tx}-${ty}`}
                src={`https://a.basemaps.cartocdn.com/dark_all/${HERO_TILE_ZOOM}/${tx}/${ty}@2x.png`}
                width={256}
                height={256}
                alt=""
                style={{ display: "block", imageRendering: "crisp-edges" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.background = "#080b12";
                }}
              />
            ))}
          </div>

          {/* Neon street glow: a blurred copy of the tile grid, tinted orange,
              composited with screen blend. Screen blend only brightens bright
              pixels (roads) — dark land stays dark. The blur spreads the glow
              outward from the road lines without flooding the whole map. */}
          <div
            style={{
              position: "absolute",
              inset: -12,          // slightly oversized so blur doesn’t clip at edges
              display: "grid",
              gridTemplateColumns: "256px 256px 256px",
              gridTemplateRows: "256px 256px 256px",
              // sepia(1) + hue-rotate pushes the tile colors toward orange
              // blur spreads the bright road pixels outward as a glow halo
              // contrast boosts so only bright roads glow, not the dark land
              filter: "brightness(2.5) contrast(4) sepia(1) hue-rotate(-10deg) blur(5px)",
              mixBlendMode: "screen",
              opacity: 0.55,
              pointerEvents: "none",
            }}
          >
            {tiles.map(({ tx, ty }) => (
              <img
                key={`glow-${tx}-${ty}`}
                src={`https://a.basemaps.cartocdn.com/dark_all/${HERO_TILE_ZOOM}/${tx}/${ty}@2x.png`}
                width={256}
                height={256}
                alt=""
                style={{ display: "block" }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Edge fade so the tilted grid blends into the dark background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, rgba(5,7,13,0.6) 0%, transparent 22%, transparent 62%, rgba(5,7,13,0.95) 100%),
            linear-gradient(90deg, rgba(5,7,13,0.5) 0%, transparent 15%, transparent 85%, rgba(5,7,13,0.5) 100%)
          `,
        }}
      />

      {/* Pins layer — flat on top of the perspective view */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {markers
          .filter((m) => m.lat != null && m.lng != null)
          .map((marker, i) => {
            const pct = latlngToGridPct(
              marker.lat,
              marker.lng,
              centerTileX,
              centerTileY,
              HERO_TILE_ZOOM,
            );
            if (pct.x < -0.05 || pct.x > 1.05 || pct.y < -0.05 || pct.y > 1.05) return null;
            const delay = `${(i * 0.4) % 2.4}s`;
            return (
              <div
                key={marker.id}
                className="absolute"
                style={{
                  left: `${pct.x * 100}%`,
                  top: `${pct.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div style={{ position: "relative", width: 16, height: 16 }}>
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background: "rgba(245,158,11,0.35)",
                      animation: `hero-pin-pulse 2.8s ease-out ${delay} infinite`,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      inset: 3,
                      borderRadius: "50%",
                      background: "#f59e0b",
                      boxShadow: "0 0 10px 2px rgba(245,158,11,0.7)",
                    }}
                  />
                </div>
              </div>
            );
          })}

        {/* User location pin */}
        <div
          className="absolute"
          style={{
            left: `${userPct.x * 100}%`,
            top: `${userPct.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <span
            style={{
              position: "absolute",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(245,158,11,0.22)",
              animation: "hero-user-pulse 2.4s ease-out infinite",
              top: -8,
              left: -8,
            }}
          />
          <div
            style={{
              position: "relative",
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 20px 5px rgba(245,158,11,0.7), 0 0 0 3px rgba(245,158,11,0.3)",
            }}
          >
            <NavigationIcon style={{ width: 12, height: 12, color: "#000", fill: "currentColor", transform: "rotate(45deg)" }} />
          </div>
        </div>
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
  const img = restaurant.heroImageUrl || restaurant.imageUrl || restaurant.logoUrl;
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
        <SectionHeader title="Live Now" linkHref="/find-food" />
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
        <SectionHeader title="Live Now" linkHref="/find-food" />
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
            href="/find-food"
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
  const img = truck.heroImageUrl ?? truck.imageUrl ?? truck.logoUrl ?? null;

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
      href={`/trucks/${truck.id}`}
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

function ParkingPassCard({ listing }: { listing: {
  id: string;
  hostId?: string | null;
  businessName?: string | null;
  hostName?: string | null;
  city?: string | null;
  state?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  spotCount?: number | null;
  availableSpots?: number | null;
  host?: {
    businessName?: string | null;
    city?: string | null;
    state?: string | null;
    imageUrl?: string | null;
  } | null;
} }) {
  const name =
    listing.host?.businessName ??
    listing.businessName ??
    listing.hostName ??
    "Parking Host";
  const city = listing.host?.city ?? listing.city ?? null;
  const state = listing.host?.state ?? listing.state ?? null;
  const locationLabel = [city, state].filter(Boolean).join(", ") || null;
  const img =
    listing.heroImageUrl ??
    listing.imageUrl ??
    listing.host?.imageUrl ??
    null;
  const spots = listing.spotCount ?? null;
  const available = listing.availableSpots ?? null;

  return (
    <Link
      href={`/parking-pass`}
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
            <MapPin className="h-8 w-8 text-amber-400/40" aria-hidden="true" />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {available !== null && available > 0 && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-emerald-600/90 shadow">
            {available} spot{available !== 1 ? "s" : ""} open
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
