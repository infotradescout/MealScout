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
  Bell,
  Bookmark,
  CalendarDays,
  ChevronRight,
  Compass,
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

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("requesting");
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocationStatus("ready");
        getReverseGeocodedLocationName(latitude, longitude, (name) => {
          if (!cancelled && name) setLocationName(name);
        }).catch(() => {});
      },
      () => {
        if (!cancelled) setLocationStatus("denied");
      },
      { timeout: 10000, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
    };
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
    // Pull DOWN ≥ 60px → collapse to full map view.
    if (delta > 60 && sheetState === "default") {
      setSheetState("fullMap");
    }
    // Pull UP ≥ 60px → return to default.
    if (delta < -60 && sheetState === "fullMap") {
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
        description="Live local food scene with an interactive map. Follow The Flavor."
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
              sheetState === "fullMap" ? "100dvh" : "min(58vh, 560px)",
            transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
          }}
        >
          {/* Map */}
          <div className="absolute inset-0">
            {hasMapKey && coords && mapCenter ? (
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
                onClick={() => navigate("/find-food")}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full text-white text-sm font-medium px-4 bg-black/55 backdrop-blur-md ring-1 ring-white/15"
                aria-label={`Change location. Currently ${shortLocation}.`}
              >
                <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <span className="truncate max-w-[180px]">{shortLocation}</span>
              </button>

              <button
                type="button"
                onClick={() => navigate("/find-food")}
                aria-label="Search the local food scene"
                className="flex items-center justify-center h-12 w-12 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/15 shrink-0"
              >
                <Search className="h-5 w-5 text-white" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Hero copy (left column only). */}
          {sheetState !== "fullMap" && (
            <div className="relative z-10 px-5 pt-5 md:pt-7 pointer-events-none">
              <div className="max-w-[58%] md:max-w-[52%]">
                <p className="text-[11px] tracking-[0.32em] text-white/85 uppercase font-semibold mb-4">
                  MealScout
                </p>
                <h1
                  className="text-white font-extrabold leading-[1.0] tracking-tight"
                  style={{
                    fontFamily:
                      "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                    fontSize: "clamp(40px, 11vw, 60px)",
                    textShadow: "0 2px 28px rgba(0,0,0,0.85)",
                  }}
                >
                  {greetingFirstLine}
                  <br />
                  {greetingSecondLine}
                </h1>
                <p
                  className="mt-3 text-white/95 text-base sm:text-lg"
                  style={{ textShadow: "0 1px 14px rgba(0,0,0,0.75)" }}
                >
                  Follow The Flavor.
                </p>
              </div>
            </div>
          )}

          {/* Floating "Expand map" button (top-right) — visible in default state. */}
          {sheetState === "default" && (
            <button
              type="button"
              onClick={() => setSheetState("fullMap")}
              aria-label="Expand the map to fullscreen"
              className="absolute z-20 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] h-12 w-12 rounded-full bg-black/65 backdrop-blur-md ring-1 ring-amber-300/60 flex items-center justify-center"
              style={{
                boxShadow: "0 0 22px rgba(245,158,11,0.45)",
              }}
            >
              <Maximize2 className="h-5 w-5 text-amber-200" aria-hidden="true" />
            </button>
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

          {/* Pull-down hint pill (default state) */}
          {sheetState === "default" && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/10 text-[11px] text-white/80 pointer-events-none"
              aria-hidden="true"
            >
              Pull down to expand the map
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
            {/* Drag handle (touch-only target) */}
            <div
              role="button"
              aria-label="Drag to expand or collapse the map"
              tabIndex={0}
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              className="w-full h-7 flex items-center justify-center"
            >
              <span
                aria-hidden="true"
                className="block h-1.5 w-12 rounded-full bg-white/30"
              />
            </div>

            {/* LIVE NOW (first per Thomas) */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Live Now" linkHref="/find-food" />

              <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                <ul
                  className="flex gap-4 pr-5"
                  role="list"
                  aria-label="Live food trucks near you"
                >
                  {liveTrucks.length > 0 ? (
                    liveTrucks.slice(0, 12).map((truck) => (
                      <li key={truck.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <LiveTruckCard truck={truck} />
                      </li>
                    ))
                  ) : locationStatus !== "denied" && liveTrucksLoading ? (
                    <>
                      {[0, 1, 2].map((i) => (
                        <li key={i} className="shrink-0 w-[230px] sm:w-[260px]">
                          <LiveTruckSkeletonCard />
                        </li>
                      ))}
                    </>
                  ) : (
                    <li className="shrink-0 w-[230px] sm:w-[260px]">
                      <LiveNowEmptyCard
                        title={
                          locationStatus === "denied"
                            ? "Turn on location to see what's live near you."
                            : liveTrucksError
                              ? "We couldn't reach the live feed."
                              : "Nothing live right here, right now."
                        }
                        body={
                          locationStatus === "denied"
                            ? "MealScout uses your location only to show food trucks, deals, and events around you in real time."
                            : liveTrucksError
                              ? "Pull down to refresh, or try again in a moment."
                              : "Trucks pop up throughout the day. Open the map to scout what's planned tonight."
                        }
                        onCta={() => setSheetState("fullMap")}
                      />
                    </li>
                  )}
                </ul>
              </div>
            </section>

            {/* EXPLORE BY CRAVING (second per Thomas) */}
            <section className="px-5 pt-2 pb-10">
              <SectionHeader title="Explore by Craving" linkHref="/find-food" />
              <ul
                className="flex items-start justify-between gap-2 pb-2"
                role="list"
              >
                {CRAVING_CATEGORIES.map((cat) => (
                  <li key={cat.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => goToCraving(cat)}
                      aria-label={`Explore ${cat.label}`}
                      className="group flex flex-col items-center gap-2 w-[58px] sm:w-[68px] md:w-[88px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 rounded-2xl active:scale-[0.97] transition-transform"
                    >
                      <span
                        className="h-[58px] w-[58px] sm:h-[68px] sm:w-[68px] md:h-[84px] md:w-[84px] rounded-full overflow-hidden ring-2 ring-amber-400 bg-black/60 group-hover:ring-amber-300 transition-all"
                        style={{
                          boxShadow:
                            "0 0 0 3px rgba(245,158,11,0.16), 0 0 22px rgba(245,158,11,0.55)",
                        }}
                      >
                        <img
                          src={cat.image}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </span>
                      <span className="text-white text-[12px] sm:text-sm font-semibold">
                        {cat.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* DEALS NEAR YOU (restored) */}
            <section className="pl-5 pr-0 pt-2 pb-10">
              <SectionHeader title="Deals Near You" linkHref="/deals" />
              {deals.length > 0 ? (
                <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
                  <ul className="flex gap-4 pr-5" role="list">
                    {deals.slice(0, 8).map((d) => (
                      <li key={d.id} className="shrink-0 w-[230px] sm:w-[260px]">
                        <DealCard deal={d} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DiscoveryEmptyRow
                  icon={<Tag className="h-5 w-5 text-amber-300" aria-hidden="true" />}
                  title="No featured deals right now."
                  body="When local restaurants and trucks publish deals, they'll show up here."
                  onCta={() => navigate("/deals")}
                  ctaLabel="Browse all deals"
                />
              )}
            </section>

            {/* HAPPENING TONIGHT (restored from /events) */}
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

            {/* SAVED & FAVORITES (restored shortcut) */}
            <section className="px-5 pt-2 pb-12">
              <SectionHeader title="Your Saved" linkHref="/favorites" />
              <button
                type="button"
                onClick={() => navigate("/favorites")}
                className="w-full text-left rounded-3xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-5 hover:bg-white/8 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span
                    className="h-12 w-12 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <Bookmark className="h-5 w-5 text-amber-300" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold">Open your saved spots</p>
                    <p className="text-white/70 text-sm mt-0.5">
                      Quickly pull up the trucks, restaurants, and deals you've saved.
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-white/60" aria-hidden="true" />
                </div>
              </button>
            </section>
          </div>
        )}
      </main>

      <AtmosphericBottomNav hidden={sheetState === "fullMap"} />
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
        backgroundImage:
          "linear-gradient(135deg, #0a0c10 0%, #14181f 50%, #0a0c10 100%)",
      }}
    >
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
   FLOATING ATMOSPHERIC BOTTOM NAV (5 items: Explore / Saved /
   Scout (center, amber ring) / Alerts / Profile) — matches /explore
   ============================================================ */

function AtmosphericBottomNav({ hidden }: { hidden?: boolean }) {
  const [location, navigate] = useWouterLocation();
  const isActive = (path: string) =>
    location === path || location.startsWith(`${path}/`);

  if (hidden) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed left-0 right-0 z-50 px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <div
        className="relative mx-auto max-w-md flex items-end justify-between gap-1 h-[68px] px-4 rounded-full bg-black/65 backdrop-blur-xl ring-1 ring-white/10"
        style={{
          boxShadow:
            "0 0 0 1px rgba(245,158,11,0.10), 0 18px 48px rgba(0,0,0,0.65)",
        }}
      >
        <NavSlot
          label="Explore"
          icon={<Compass className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/explore-preview") || isActive("/explore")}
          onClick={() => navigate("/explore-preview")}
        />
        <NavSlot
          label="Saved"
          icon={<Bookmark className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/favorites")}
          onClick={() => navigate("/favorites")}
        />
        <ScoutCenterSlot
          active={isActive("/find-food")}
          onClick={() => navigate("/find-food")}
        />
        <NavSlot
          label="Alerts"
          icon={<Bell className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/alerts")}
          onClick={() => navigate("/alerts")}
        />
        <NavSlot
          label="Profile"
          icon={<UserIcon className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/profile")}
          onClick={() => navigate("/profile")}
        />
      </div>
    </nav>
  );
}

function NavSlot({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-2 transition-colors ${
        active ? "text-amber-300" : "text-white/85 hover:text-white"
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function ScoutCenterSlot({
  active,
  onClick,
}: {
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scout"
      aria-current={active ? "page" : undefined}
      className="flex flex-col items-center justify-end gap-1 flex-1 min-w-0 h-full pb-1 transition-transform active:scale-95"
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-black/70 ring-2 ring-amber-400 -mt-6"
        style={{
          boxShadow:
            "0 0 0 4px rgba(245,158,11,0.15), 0 0 24px rgba(245,158,11,0.35)",
        }}
        aria-hidden="true"
      >
        <Search className="h-5 w-5 text-amber-300" />
      </span>
      <span className="text-[11px] font-medium text-amber-300">Scout</span>
    </button>
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
      className="block w-full text-left rounded-3xl overflow-hidden bg-white/5 backdrop-blur-md ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`${title} Open the map.`}
    >
      <div className="relative aspect-[4/5] w-full p-5 flex flex-col">
        <span
          className="h-10 w-10 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <MapPin className="h-5 w-5 text-amber-300" />
        </span>
        <p className="mt-3 font-semibold text-white text-base leading-snug">
          {title}
        </p>
        <p className="mt-1 text-sm text-white/70 leading-relaxed">{body}</p>
        <span className="mt-auto inline-flex items-center gap-2 text-amber-200 text-sm font-semibold">
          <NavigationIcon className="h-4 w-4" aria-hidden="true" />
          Expand the map
        </span>
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
