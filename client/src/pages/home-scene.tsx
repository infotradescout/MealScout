import { useEffect, useMemo, useState } from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bookmark,
  ChevronRight,
  Compass,
  Flame,
  Heart,
  MapPin,
  Navigation as NavigationIcon,
  Search,
  Search as ScoutIcon,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";

/**
 * /explore — MealScout home for logged-in users.
 *
 * Mobile-first Atmospheric UI rebuild that matches the approved
 * MealScout_dashboard_reference_match.png mockup, point-for-point:
 *
 *  - Hero photo (food-park night) extends from the very top of the page
 *    THROUGH the "Explore the Map" CTA, then fades into a true black band
 *    that hosts cravings + Live Now.
 *  - Top bar (avatar + location chip + search) sits directly on the photo,
 *    no header background of its own.
 *  - "MEALSCOUT" eyebrow sits left, on the photo, just under the top bar.
 *  - Editorial serif headline ("Good evening,\nThomas.") sized so the first
 *    line fits on one row at 430px.
 *  - Sub-line "Follow The Flavor." (locked tagline). Upright, NOT italic.
 *  - "Explore the Map" CTA: ~85% width pill, dark transparent fill, 2px
 *    amber border + glow, sitting ON the photo.
 *  - 6 craving bubbles (tacos, burgers, ramen, pizza, drinks, dessert) in a
 *    horizontal scroll, each a real button with a glowing amber ring as the
 *    button affordance.
 *  - Live Now: image-overlay portrait cards. Real empty/error/loading states
 *    so the section never collapses to ghost rectangles.
 *  - Reserved hero-map slot on the right at md+ for the upcoming live map.
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
  { id: "tacos",   label: "Tacos",   image: "/atmospheric/craving-tacos.jpg",   query: "tacos"   },
  { id: "burgers", label: "Burgers", image: "/atmospheric/craving-burgers.jpg", query: "burgers" },
  { id: "ramen",   label: "Ramen",   image: "/atmospheric/craving-ramen.jpg",   query: "ramen"   },
  { id: "pizza",   label: "Pizza",   image: "/atmospheric/craving-pizza.jpg",   query: "pizza"   },
  { id: "drinks",  label: "Drinks",  image: "/atmospheric/craving-drinks.jpg",  query: "drinks"  },
  { id: "dessert", label: "Dessert", image: "/atmospheric/craving-dessert.jpg", query: "dessert" },
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

export default function HomeScene() {
  const { user } = useAuth();
  const [, navigate] = useWouterLocation();

  const firstName =
    typeof user?.name === "string" && user.name.trim().length > 0
      ? user.name.trim().split(" ")[0]
      : null;

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

      {/* True-black page base so the lower band is solid. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none bg-[#0a0c10]"
      />

      <main className="relative z-10 pb-36">
        {/* ============================================================
             HERO BAND — food-park photo extends from the very top of the
             page through the "Explore the Map" CTA, then fades to true
             black. Top bar, eyebrow, headline, sub-line, and CTA all sit
             ON the photo.
           ============================================================ */}
        <section className="relative w-full overflow-hidden">
          {/* Hero photo */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: "url('/atmospheric/foodpark-night-hero.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center 22%",
              backgroundRepeat: "no-repeat",
            }}
          />
          {/* Subtle top fade for top-bar legibility, soft vignette,
              strong fade-to-black at the very bottom of the band. */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(8,10,15,0.55) 0%, rgba(8,10,15,0.20) 18%, rgba(8,10,15,0.10) 45%, rgba(8,10,15,0.45) 78%, rgba(10,12,16,1) 100%)",
            }}
          />

          {/* Top bar (avatar + location chip + search) — overlays the photo */}
          <div
            className="relative z-10 px-4 flex items-center gap-3"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
            }}
          >
            <Link
              href="/profile"
              aria-label="Open profile"
              className="flex items-center justify-center h-12 w-12 rounded-full overflow-hidden ring-2 ring-white/30 bg-black/50 backdrop-blur-md shrink-0"
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
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full text-white text-sm font-medium px-4 bg-black/45 backdrop-blur-md ring-1 ring-white/15"
              aria-label={`Change location. Currently ${shortLocation}.`}
            >
              <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <span className="truncate max-w-[180px]">{shortLocation}</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/find-food")}
              aria-label="Search the local food scene"
              className="flex items-center justify-center h-12 w-12 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/15 shrink-0"
            >
              <Search className="h-5 w-5 text-white" aria-hidden="true" />
            </button>
          </div>

          {/* Hero copy + CTA. On mobile this is one column. At md+ the
              right ~40% becomes a reserved slot for the upcoming map widget. */}
          <div className="relative z-10 px-5 pt-5 pb-9 md:grid md:grid-cols-12 md:gap-6">
            <div className="md:col-span-7 flex flex-col">
              <p className="text-[11px] tracking-[0.32em] text-white/85 uppercase font-semibold mb-5">
                MealScout
              </p>

              <h1
                className="text-white font-extrabold leading-[1.0] tracking-tight"
                style={{
                  fontFamily:
                    "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                  fontSize: "clamp(48px, 12.5vw, 68px)",
                  textShadow: "0 2px 28px rgba(0,0,0,0.7)",
                }}
              >
                {greetingFirstLine}
                <br />
                {greetingSecondLine}
              </h1>

              <p className="mt-3 text-white/90 text-base sm:text-lg">
                Follow The Flavor.
              </p>

              {/* CTA — ~85% width pill, sits ON the photo */}
              <div className="mt-7 md:mt-auto md:pt-10">
                <button
                  type="button"
                  onClick={() => navigate("/map")}
                  aria-label="Explore the live food scene on the map"
                  className="inline-flex items-center gap-3 h-[60px] pl-2 pr-7 rounded-full font-semibold text-base sm:text-lg w-[88%] max-w-[420px] bg-black/55 backdrop-blur-md text-amber-100 ring-2 ring-amber-400"
                  style={{
                    boxShadow:
                      "0 0 0 4px rgba(245,158,11,0.18), 0 0 36px rgba(245,158,11,0.55), 0 12px 32px rgba(0,0,0,0.55)",
                  }}
                >
                  <span
                    className="h-11 w-11 rounded-full bg-amber-400/20 ring-1 ring-amber-300/60 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <NavigationIcon className="h-5 w-5 text-amber-200" />
                  </span>
                  <span className="flex-1 text-center -ml-11">
                    Explore the Map
                  </span>
                </button>
              </div>
            </div>

            {/* Reserved map slot — md+ only, right column, intentionally empty.
                Drop the live map component inside this div when ready. */}
            <div
              data-slot="hero-map"
              aria-hidden="true"
              className="hidden md:block md:col-span-5"
            />
          </div>
        </section>

        {/* ============================================================
             EXPLORE BY CRAVING — 6 circular photo bubbles with amber
             glow rings. Each bubble + label is one tap target.
           ============================================================ */}
        <section className="px-5 pt-8 pb-10 bg-[#0a0c10]">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-white text-xl sm:text-2xl font-bold">
              Explore by Craving
            </h2>
            <Link
              href="/find-food"
              className="text-sm text-amber-300 inline-flex items-center gap-1 font-medium"
            >
              See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/* All 6 bubbles must fit on a 430px viewport without scrolling. */}
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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

        {/* ============================================================
             LIVE NOW — image-overlay portrait cards. Real empty / loading
             / error states so the section never collapses to ghost boxes.
           ============================================================ */}
        <section className="pl-5 pr-0 pb-12 bg-[#0a0c10]">
          <div className="flex items-baseline justify-between pr-5 mb-5">
            <h2 className="text-white text-xl sm:text-2xl font-bold">
              Live Now
            </h2>
            <Link
              href="/find-food"
              className="text-sm text-amber-300 inline-flex items-center gap-1 font-medium"
            >
              See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/* The carousel structure is ALWAYS rendered so the section
              keeps its mockup-correct shape. When there are no trucks
              (loading, error, denied, empty), a single card-shaped slot
              appears with a designed empty state inside it. */}
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul
              className="flex gap-4 pr-5"
              role="list"
              aria-label="Live food trucks near you"
            >
              {liveTrucks.length > 0 ? (
                liveTrucks.slice(0, 12).map((truck) => (
                  <li
                    key={truck.id}
                    className="shrink-0 w-[230px] sm:w-[260px]"
                  >
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
                    onCta={() => navigate("/map")}
                  />
                </li>
              )}
            </ul>
          </div>
        </section>
      </main>

      <AtmosphericBottomNav />
    </>
  );
}

/* -------------------- Floating Atmospheric Bottom Nav -------------------- */

function AtmosphericBottomNav() {
  const [location, navigate] = useWouterLocation();
  const isActive = (path: string) =>
    location === path || location.startsWith(`${path}/`);

  return (
    <nav
      aria-label="Primary"
      className="fixed left-0 right-0 z-50 px-4"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
      }}
    >
      <div
        className="mx-auto max-w-md flex items-center justify-between gap-1 h-[68px] px-3 rounded-full bg-black/65 backdrop-blur-xl ring-1 ring-white/10"
        style={{
          boxShadow:
            "0 0 0 1px rgba(245,158,11,0.10), 0 18px 48px rgba(0,0,0,0.65)",
        }}
      >
        <NavSlot
          label="Explore"
          icon={<Compass className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/explore") || isActive("/home-scene")}
          onClick={() => navigate("/explore")}
        />
        <NavSlot
          label="Saved"
          icon={<Bookmark className="h-5 w-5" aria-hidden="true" />}
          active={isActive("/saved")}
          onClick={() => navigate("/saved")}
        />

        {/* Center Scout button — amber RING (not filled) per mockup */}
        <button
          type="button"
          onClick={() => navigate("/find-food")}
          aria-label="Scout the local food scene"
          className="flex flex-col items-center justify-center -mt-6 shrink-0"
        >
          <span
            className="h-[58px] w-[58px] rounded-full bg-black/70 flex items-center justify-center ring-2 ring-amber-400"
            style={{
              boxShadow:
                "0 0 0 4px rgba(245,158,11,0.18), 0 0 28px rgba(245,158,11,0.55)",
            }}
          >
            <ScoutIcon className="h-6 w-6 text-amber-200" aria-hidden="true" />
          </span>
          <span className="mt-1 text-[11px] font-semibold text-amber-200">
            Scout
          </span>
        </button>

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
      className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full transition-colors ${
        active ? "text-amber-300" : "text-white/85 hover:text-white"
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

/* -------------------------- subcomponents -------------------------- */

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
          Open the map
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

