import { useEffect, useMemo, useState } from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Flame,
  MapPin,
  Navigation as NavigationIcon,
  Search,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";

/**
 * /home-scene — Local Food Scene at your fingertips
 *
 * Logged-in home built on the Atmospheric UI foundation.
 * Relies on the global TimeOfDayBackground (theme-night) that is already
 * mounted at the app root, so the immersive dark backdrop is inherited.
 *
 * This page is purely additive. It does not modify any existing route,
 * style, or component contract.
 */

interface LiveTruckSummary {
  id: string;
  name: string;
  cuisineType?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  logoUrl?: string | null;
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

type CravingCategory = {
  id: string;
  label: string;
  emoji: string;
  query: string;
};

const CRAVING_CATEGORIES: CravingCategory[] = [
  { id: "tacos", label: "Tacos", emoji: "🌮", query: "tacos" },
  { id: "burgers", label: "Burgers", emoji: "🍔", query: "burgers" },
  { id: "ramen", label: "Ramen", emoji: "🍜", query: "ramen" },
  { id: "pizza", label: "Pizza", emoji: "🍕", query: "pizza" },
  { id: "drinks", label: "Drinks", emoji: "🍹", query: "drinks" },
  { id: "dessert", label: "Dessert", emoji: "🍰", query: "dessert" },
  { id: "bbq", label: "BBQ", emoji: "🍖", query: "bbq" },
  { id: "seafood", label: "Seafood", emoji: "🍤", query: "seafood" },
];

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

function getCrowdVibe(truck: LiveTruckSummary): {
  label: string;
  tone: "hot" | "lively" | "steady";
} {
  const raw = (truck.crowdLevel || truck.vibe || "").toLowerCase();
  if (raw.includes("hot") || raw.includes("packed")) {
    return { label: "Crowd is hot", tone: "hot" };
  }
  if (raw.includes("lively") || raw.includes("busy")) {
    return { label: "Lively crowd", tone: "lively" };
  }
  return { label: "Open & serving", tone: "steady" };
}

function getGreetingTime(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export default function HomeScene() {
  const { user } = useAuth();
  const [, navigate] = useWouterLocation();

  const firstName =
    typeof user?.name === "string" && user.name.trim().length > 0
      ? user.name.trim().split(" ")[0]
      : null;

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locationName, setLocationName] = useState<string>("Your area");
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "ready" | "denied"
  >("idle");

  // Request browser location on mount (best-effort, never blocks the UI).
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
        }).catch(() => {
          /* non-fatal */
        });
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

  // Live trucks query — same shape as the legacy home pages so it shares
  // the existing API contract and React Query cache.
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

  const greetingTime = getGreetingTime();
  const greetingLine = firstName
    ? `Good ${greetingTime}, ${firstName}.`
    : `Good ${greetingTime}.`;

  const goToCraving = (cat: CravingCategory) => {
    navigate(`/find-food?cuisine=${encodeURIComponent(cat.query)}`);
  };

  return (
    <>
      <SEOHead
        title="Your Local Food Scene | MealScout"
        description="Live food trucks, crowd vibes, and what's happening right now in your local food scene."
      />

      {/* Top glass bar — does not replace the global app navigation, this is
          a thin contextual header layered on top of the immersive backdrop. */}
      <header
        className="fixed top-0 left-0 right-0 z-40 atmo-glass-soft"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/profile"
            aria-label="Open profile"
            className="flex items-center justify-center h-11 w-11 rounded-full overflow-hidden atmo-glass atmo-shadow-glass"
          >
            {user?.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
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
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full atmo-glass text-white/90 text-sm font-medium px-4"
            aria-label={`Change location. Currently ${shortLocation}.`}
          >
            <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <span className="truncate max-w-[160px]">{shortLocation}</span>
            <ChevronRight className="h-4 w-4 text-white/50" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => navigate("/find-food")}
            aria-label="Search the local food scene"
            className="flex items-center justify-center h-11 w-11 rounded-full atmo-glass atmo-shadow-glass"
          >
            <Search className="h-5 w-5 text-white" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Page body — sits on top of the global TimeOfDayBackground (theme-night). */}
      <main
        className="relative z-10 pb-32"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 4.5rem)",
        }}
      >
        {/* HERO */}
        <section className="px-5 pt-2 pb-8">
          <p className="text-[11px] tracking-[0.32em] text-amber-300/80 uppercase mb-3">
            MealScout
          </p>
          <h1 className="text-white font-extrabold leading-[0.95] tracking-tight text-[44px] sm:text-[56px] md:text-[64px]">
            {greetingLine.split(",")[0]},
            <br />
            {greetingLine.split(",")[1]?.trim() || "Welcome."}
          </h1>
          <p className="mt-4 text-white/70 text-base sm:text-lg">
            Your local scene.
          </p>

          <button
            type="button"
            onClick={() => navigate("/map")}
            className="mt-7 inline-flex items-center justify-center gap-3 h-14 px-7 rounded-full bg-amber-400/10 text-amber-200 font-semibold text-base sm:text-lg atmo-glow-amber w-full sm:w-auto"
            aria-label="Explore the live food scene on the map"
          >
            <NavigationIcon className="h-5 w-5" aria-hidden="true" />
            Explore the Map
          </button>
        </section>

        {/* EXPLORE BY CRAVING */}
        <section className="pl-5 pr-5 pb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-white text-xl sm:text-2xl font-bold">
              Explore by Craving
            </h2>
            <Link
              href="/find-food"
              className="text-sm text-amber-300 inline-flex items-center gap-1"
            >
              See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="-mx-5 px-5 overflow-x-auto atmo-hide-scrollbar">
            <ul className="flex gap-4 sm:gap-5 pb-1" role="list">
              {CRAVING_CATEGORIES.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => goToCraving(cat)}
                    className="flex flex-col items-center gap-2 w-[88px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 rounded-xl"
                    aria-label={`Explore ${cat.label}`}
                  >
                    <span className="h-[88px] w-[88px] rounded-full atmo-ring-glow flex items-center justify-center text-[40px] bg-black/40">
                      <span aria-hidden="true">{cat.emoji}</span>
                    </span>
                    <span className="text-white text-sm font-medium">
                      {cat.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* LIVE NOW */}
        <section className="pl-5 pr-0 pb-12">
          <div className="flex items-baseline justify-between pr-5 mb-4">
            <h2 className="text-white text-xl sm:text-2xl font-bold">
              Live Now
            </h2>
            <Link
              href="/find-food"
              className="text-sm text-amber-300 inline-flex items-center gap-1"
            >
              See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {locationStatus === "denied" && !coords && (
            <div className="mr-5 atmo-glass rounded-2xl p-5 text-white/80">
              <p className="font-semibold text-white mb-1">
                Turn on location to see what's live near you.
              </p>
              <p className="text-sm text-white/70">
                We use your location only to show food trucks, deals, and
                events around you in real time.
              </p>
            </div>
          )}

          {locationStatus !== "denied" && liveTrucksLoading && (
            <LiveTrucksSkeleton />
          )}

          {locationStatus !== "denied" &&
            !liveTrucksLoading &&
            liveTrucksError && (
              <div className="mr-5 atmo-glass rounded-2xl p-5 text-white/80">
                <p className="font-semibold text-white mb-1">
                  We couldn't reach the live feed.
                </p>
                <p className="text-sm text-white/70">
                  Pull down to refresh, or try again in a moment.
                </p>
              </div>
            )}

          {locationStatus !== "denied" &&
            !liveTrucksLoading &&
            !liveTrucksError &&
            liveTrucks.length === 0 && (
              <div className="mr-5 atmo-glass rounded-2xl p-5 text-white/80">
                <p className="font-semibold text-white mb-1">
                  Nothing live in your area yet.
                </p>
                <p className="text-sm text-white/70">
                  Trucks pop up throughout the day. Check back soon, or open
                  the map to see what's planned.
                </p>
              </div>
            )}

          {liveTrucks.length > 0 && (
            <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
              <ul
                className="flex gap-4 pr-5"
                role="list"
                aria-label="Live food trucks near you"
              >
                {liveTrucks.slice(0, 12).map((truck) => (
                  <li key={truck.id} className="shrink-0 w-[260px]">
                    <LiveTruckCard truck={truck} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/* -------------------------- subcomponents -------------------------- */

function LiveTruckCard({ truck }: { truck: LiveTruckSummary }) {
  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const vibe = getCrowdVibe(truck);
  const heroImage = truck.heroImageUrl || truck.imageUrl || truck.logoUrl;

  return (
    <Link
      href={`/truck/${truck.id}`}
      className="block atmo-glass atmo-shadow-glass rounded-3xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
      aria-label={`Open ${truck.name}`}
    >
      <div className="relative aspect-[4/5] w-full bg-black/60">
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
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
              "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)",
          }}
          aria-hidden="true"
        />

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide text-white bg-amber-500/90 atmo-glow-amber-soft">
          <span
            className="h-1.5 w-1.5 rounded-full bg-white atmo-pulse-amber"
            aria-hidden="true"
          />
          Live
        </span>

        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight truncate">
            {truck.name}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-amber-200 text-sm font-medium">
            <Flame className="h-4 w-4" aria-hidden="true" />
            <span>{vibe.label}</span>
          </p>
          <p className="mt-1 text-white/70 text-xs">
            {[wait, distance].filter(Boolean).join(" • ") || "Open now"}
          </p>
        </div>
      </div>
    </Link>
  );
}

function LiveTrucksSkeleton() {
  return (
    <div
      className="overflow-x-auto atmo-hide-scrollbar -mr-1"
      aria-hidden="true"
    >
      <ul className="flex gap-4 pr-5" role="list">
        {[0, 1, 2].map((i) => (
          <li key={i} className="shrink-0 w-[260px]">
            <div className="atmo-glass-soft rounded-3xl overflow-hidden">
              <div className="aspect-[4/5] w-full animate-pulse bg-white/5" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

