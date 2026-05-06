import { useEffect, useMemo, useState } from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Flame,
  Heart,
  MapPin,
  Navigation as NavigationIcon,
  Search,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";

/**
 * /explore (alias /home-scene) — Local Food Scene at your fingertips
 *
 * Logged-in home built on the Atmospheric UI foundation.
 * Renders its own immersive food-park background image scoped to this page,
 * then layers the editorial headline, glowing pill CTA, photo+glow craving
 * bubbles, and image-overlay LIVE NOW cards on top.
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
  image: string;
  query: string;
};

const CRAVING_CATEGORIES: CravingCategory[] = [
  {
    id: "tacos",
    label: "Tacos",
    image: "/atmospheric/craving-tacos.jpg",
    query: "tacos",
  },
  {
    id: "burgers",
    label: "Burgers",
    image: "/atmospheric/craving-burgers.jpg",
    query: "burgers",
  },
  {
    id: "ramen",
    label: "Ramen",
    image: "/atmospheric/craving-ramen.jpg",
    query: "ramen",
  },
  {
    id: "pizza",
    label: "Pizza",
    image: "/atmospheric/craving-pizza.jpg",
    query: "pizza",
  },
  {
    id: "drinks",
    label: "Drinks",
    image: "/atmospheric/craving-drinks.jpg",
    query: "drinks",
  },
  {
    id: "dessert",
    label: "Dessert",
    image: "/atmospheric/craving-dessert.jpg",
    query: "dessert",
  },
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
} {
  const raw = (truck.crowdLevel || truck.vibe || "").toLowerCase();
  if (raw.includes("hot") || raw.includes("packed")) {
    return { label: "Crowd is Hot" };
  }
  if (raw.includes("busy")) {
    return { label: "Busy Right Now" };
  }
  if (raw.includes("lively")) {
    return { label: "Lively Crowd" };
  }
  return { label: "Open & Serving" };
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
  const greetingFirstLine = `Good ${greetingTime},`;
  const greetingSecondLine = firstName ? `${firstName}.` : "Welcome.";

  const goToCraving = (cat: CravingCategory) => {
    navigate(`/find-food?cuisine=${encodeURIComponent(cat.query)}`);
  };

  return (
    <>
      <SEOHead
        title="Your Local Food Scene | MealScout"
        description="Live food trucks, crowd vibes, and what's happening right now in your local food scene."
      />

      {/* SOLID PAGE BASE — keeps the lower band a true black so craving bubbles
          and LIVE cards pop and don't ghost the global theme. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none bg-[#0a0c10]"
      />

      {/* Top glass bar — contextual header above the immersive backdrop. */}
      <header
        className="fixed top-0 left-0 right-0 z-40"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/profile"
            aria-label="Open profile"
            className="flex items-center justify-center h-11 w-11 rounded-full overflow-hidden ring-2 ring-white/20 bg-black/50 backdrop-blur-md"
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
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full text-white text-sm font-medium px-4 bg-black/40 backdrop-blur-md ring-1 ring-white/10"
            aria-label={`Change location. Currently ${shortLocation}.`}
          >
            <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <span className="truncate max-w-[160px]">{shortLocation}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/find-food")}
            aria-label="Search the local food scene"
            className="flex items-center justify-center h-11 w-11 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10"
          >
            <Search className="h-5 w-5 text-white" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Page body — bottom padding clears the floating glass nav. */}
      <main className="relative z-10 pb-36">
        {/* HERO BAND — full-bleed food-park photo with the eyebrow, headline,
            and Explore the Map CTA layered on the LEFT column only. The top
            right ~40% is intentionally left empty as a reserved slot for the
            upcoming live map widget (data-slot="hero-map"). */}
        <section
          className="relative w-full overflow-hidden"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 4.5rem)",
          }}
        >
          {/* Hero photo */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "url('/atmospheric/foodpark-night-hero.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center center",
              backgroundRepeat: "no-repeat",
            }}
          />
          {/* Soft top + strong bottom gradient so the headline reads cleanly
              and the band fades into the black lower band underneath. */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(8,10,15,0.45) 0%, rgba(8,10,15,0.10) 28%, rgba(8,10,15,0.10) 55%, rgba(8,10,15,0.85) 92%, rgba(10,12,16,1) 100%)",
            }}
          />

          {/* Hero content. On mobile (<md) the headline takes full width and
              the hero-map slot lives BELOW the CTA so it never steals headline
              real estate. At md+ the layout becomes a 7/5 grid with the map
              slot reserved on the right. */}
          <div className="relative px-5 pt-2 pb-8 md:pb-10 md:grid md:grid-cols-12 md:gap-6 md:min-h-[520px]">
            {/* LEFT COLUMN (full width on mobile) — eyebrow, headline, CTA */}
            <div className="md:col-span-7 flex flex-col">
              <p className="text-[11px] tracking-[0.32em] text-white/85 uppercase mb-3 font-medium">
                MealScout
              </p>
              <h1
                className="text-white font-extrabold leading-[0.95] tracking-tight text-[52px] sm:text-[60px] md:text-[64px]"
                style={{
                  fontFamily:
                    "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                  textShadow: "0 2px 28px rgba(0,0,0,0.65)",
                }}
              >
                {greetingFirstLine}
                <br />
                {greetingSecondLine}
              </h1>
              <p className="mt-3 text-white/90 text-base sm:text-lg">
                Your local scene.
              </p>

              <div className="mt-6 md:mt-auto md:pt-10">
                <button
                  type="button"
                  onClick={() => navigate("/map")}
                  className="inline-flex items-center justify-center gap-3 h-14 px-6 rounded-full text-amber-100 font-semibold text-base sm:text-lg w-full bg-black/55 backdrop-blur-md atmo-glow-amber ring-1 ring-amber-300/60"
                  aria-label="Explore the live food scene on the map"
                >
                  <span
                    className="h-9 w-9 rounded-full bg-amber-400/15 ring-1 ring-amber-300/50 flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <NavigationIcon className="h-4 w-4 text-amber-200" />
                  </span>
                  Explore the Map
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN — reserved slot for the upcoming live map widget.
                Hidden on mobile (the map will live in its own row when needed).
                On md+ it occupies the right ~40% of the hero band so the map
                can render and accept interactions without any layout fight. */}
            <div
              data-slot="hero-map"
              aria-hidden="true"
              className="hidden md:block md:col-span-5"
            />
          </div>
        </section>

        {/* EXPLORE BY CRAVING — circular photo bubbles with amber glow rings */}
        <section className="pl-5 pr-5 pt-8 pb-10 bg-[#0a0c10]">
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
            <ul className="flex gap-4 sm:gap-5 pb-2" role="list">
              {CRAVING_CATEGORIES.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => goToCraving(cat)}
                    className="flex flex-col items-center gap-2 w-[92px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 rounded-2xl"
                    aria-label={`Explore ${cat.label}`}
                  >
                    <span
                      className="h-[88px] w-[88px] rounded-full overflow-hidden ring-2 ring-amber-300 bg-black/60"
                      style={{
                        boxShadow:
                          "0 0 0 4px rgba(245,158,11,0.18), 0 0 28px rgba(245,158,11,0.55)",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cat.image}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </span>
                    <span className="text-white text-sm font-semibold">
                      {cat.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* LIVE NOW — full-bleed image cards with LIVE pill, name, vibe, distance */}
        <section className="pl-5 pr-0 pb-12 bg-[#0a0c10]">
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
                  <li key={truck.id} className="shrink-0 w-[200px] sm:w-[230px]">
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
      className="block rounded-3xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 bg-black/40 ring-1 ring-white/10"
      aria-label={`Open ${truck.name}`}
      style={{
        boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
      }}
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
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />

        {/* LIVE pill, top-left */}
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-white bg-amber-500 shadow-md">
          <span
            className="h-1.5 w-1.5 rounded-full bg-white atmo-pulse-amber"
            aria-hidden="true"
          />
          Live
        </span>

        {/* Heart, top-right */}
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

function LiveTrucksSkeleton() {
  return (
    <div
      className="overflow-x-auto atmo-hide-scrollbar -mr-1"
      aria-hidden="true"
    >
      <ul className="flex gap-4 pr-5" role="list">
        {[0, 1, 2].map((i) => (
          <li key={i} className="shrink-0 w-[260px]">
            <div className="rounded-3xl overflow-hidden bg-white/5">
              <div className="aspect-[4/5] w-full animate-pulse bg-white/5" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
