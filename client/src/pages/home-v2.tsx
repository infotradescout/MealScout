import { queryClient } from "@/lib/queryClient";
import { fetchJsonWithRetry } from "@/lib/resilientFetch";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type SVGProps,
} from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import SmartSearch from "@/components/smart-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MapPin,
  Sparkles,
  Rocket,
  Pizza,
  DollarSign,
  Truck,
  RotateCw,
  ChefHat,
  Clock,
  Heart,
  Bell,
  Map as MapIcon,
  LogIn,
  UserPlus,
  Bug,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Croissant,
  Salad,
  Fish,
  Coffee,
  Cake,
  Flame,
  ArrowDownToLine,
  PlayCircle,
  TrendingUp,
  Zap,
  ChevronRight,
  Wine,
  Utensils,
} from "lucide-react";
import mealScoutLogo from "@assets/meal-scout-icon.png";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { readDeviceLocation, writeDeviceLocation } from "@/lib/device-location";
import {
  sendGeoPing,
  trackGeoAdEvent,
  trackGeoAdImpression,
} from "@/utils/geoAds";
import { SEOHead } from "@/components/seo-head";
import {
  AdminEditableText,
  AdminEditButton,
} from "@/components/admin-inline-copy";
import { trackUxEvent } from "@/utils/uxTelemetry";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";
import { useIsStandalone } from "@/hooks/useIsStandalone";
import {
  computeHomeRankingScore,
  getHomeRankingReasons,
} from "@shared/rankingPolicy";

const WelcomeLocationModal = lazy(
  () => import("@/components/WelcomeLocationModal"),
);

function BurgerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 11a8 8 0 0 1 16 0" />
      <path d="M3 12h18" />
      <path d="M5 15h14" />
      <path d="M5 18h14" />
      <path d="M7 8h.01" />
      <path d="M12 6h.01" />
      <path d="M17 8h.01" />
    </svg>
  );
}

console.log("MealScout Client Loaded - Build: " + new Date().toISOString());

function getMealPrompt(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 21 || hour < 5) return "Late Night Snack?";
  if (hour < 10) return "Breakfast?";
  if (hour < 12) return "Brunch?";
  if (hour < 16) return "Lunch?";
  return "Dinner?";
}

interface Deal {
  id: string;
  restaurantId: string;
  title: string;
  description: string;
  dealType: string;
  discountValue: string;
  minOrderAmount?: string;
  imageUrl?: string;
  isFeatured: boolean;
  restaurant?: {
    name: string;
    cuisineType?: string;
    businessType?: string;
    isFoodTruck?: boolean;
    address?: string;
  };
  distance?: number;
}

interface LiveTruck {
  id: string;
  name: string;
  address?: string;
  cuisineType?: string;
  businessType?: string;
  isFoodTruck?: boolean;
  isVerified?: boolean;
  distance?: number;
  lastBroadcastAt?: string;
}

interface PublicBusinessProfile {
  id: string;
  name: string;
  address?: string;
  cuisineType?: string;
  businessType?: string;
  isFoodTruck?: boolean;
  isVerified?: boolean;
  mobileOnline?: boolean;
  distance?: number | null;
  updatedAt?: string;
  favoriteCount?: number;
  followCount?: number;
  recommendationCount?: number;
  videoRecommendationCount?: number;
  communityActivityCount?: number;
  activeDealCount?: number;
}

interface BusinessDealsSummary {
  id: string;
  name: string;
  address?: string;
  cuisineType?: string;
  businessType?: string;
  isFoodTruck?: boolean;
  isVerified?: boolean;
  mobileOnline?: boolean;
  distance?: number;
  updatedAt?: string;
  favoriteCount: number;
  followCount: number;
  recommendationCount: number;
  videoRecommendationCount: number;
  communityActivityCount: number;
  activeDealCount: number;
  fairnessScore: number;
  rankReason: string;
  deals: Deal[];
}

interface GeoAd {
  id: string;
  title: string;
  body?: string | null;
  mediaUrl?: string | null;
  targetUrl: string;
  ctaText?: string | null;
}

interface TrendingStory {
  id: string;
  title: string;
  creatorName?: string;
  viewCount?: number;
  likeCount?: number;
}

function formatBusinessTypeLabel(business: {
  isFoodTruck?: boolean;
  businessType?: string;
}): string {
  if (business.isFoodTruck) return "Food Truck";
  const normalizedType = String(business.businessType || "")
    .toLowerCase()
    .trim();
  if (normalizedType.includes("bar")) return "Bar";
  return "Restaurant";
}

// Premium truck card component
function TruckCard({ truck, deals }: { truck: LiveTruck; deals: Deal[] }) {
  const distanceMiles =
    typeof truck.distance === "number" && Number.isFinite(truck.distance)
      ? truck.distance.toFixed(1)
      : null;

  return (
    <Link href={`/restaurant/${truck.id}`}>
      <div className="group relative rounded-3xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden">
        {/* Background accent */}
        <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--accent-text)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="relative z-10">
          {/* Live badge */}
          <div className="absolute top-5 right-5 flex items-center gap-1.5 bg-[color:var(--status-success)]/15 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-[color:var(--status-success)] animate-pulse" />
            <span className="text-xs font-bold text-[color:var(--status-success)]">
              LIVE
            </span>
          </div>

          {/* Content */}
          <div className="pr-20">
            <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2 group-hover:text-[color:var(--accent-text)] transition-colors">
              {truck.name}
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              {truck.cuisineType || "Food Truck"}
            </p>
          </div>

          {/* Location and distance */}
          {(truck.address || distanceMiles) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 pb-4 border-b border-[color:var(--border-subtle)]">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="line-clamp-1">
                {truck.address || `${distanceMiles} mi away`}
              </span>
            </div>
          )}

          {/* Deals */}
          {deals.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[color:var(--accent-text)] uppercase tracking-wide">
                {deals.length} Active Deal{deals.length !== 1 ? "s" : ""}
              </p>
              {deals.slice(0, 2).map((deal) => (
                <div key={deal.id} className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-[color:var(--accent-text)] flex-shrink-0 mt-0.5" />
                  <span className="text-xs line-clamp-1 text-foreground">
                    {deal.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// Premium business card component
function BusinessCard({ business }: { business: BusinessDealsSummary }) {
  const businessTypeLabel = formatBusinessTypeLabel(business);
  const distanceLabel =
    typeof business.distance === "number" && Number.isFinite(business.distance)
      ? `${business.distance.toFixed(1)} mi`
      : null;

  return (
    <Link href={`/restaurant/${business.id}`}>
      <div className="group relative rounded-3xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden">
        {/* Background accent */}
        <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--accent-text)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="relative z-10">
          {/* Header */}
          <div className="mb-4">
            <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2 group-hover:text-[color:var(--accent-text)] transition-colors">
              {business.name}
            </h3>
            <p className="text-sm text-muted-foreground">
              {business.cuisineType || businessTypeLabel}
            </p>
          </div>

          {/* Location and distance */}
          {(business.address || distanceLabel) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 pb-4 border-b border-[color:var(--border-subtle)]">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="line-clamp-1">
                {business.address || distanceLabel}
              </span>
            </div>
          )}

          {/* Deals */}
          {business.deals.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[color:var(--accent-text)] uppercase tracking-wide">
                {business.deals.length} Deal
                {business.deals.length !== 1 ? "s" : ""}
              </p>
              {business.deals.slice(0, 2).map((deal) => (
                <div key={deal.id} className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-[color:var(--accent-text)] flex-shrink-0 mt-0.5" />
                  <span className="text-xs line-clamp-1 text-foreground">
                    {deal.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// Main component - using original home.tsx logic but with new design
export default function Home() {
  const { user } = useAuth();
  const isStandalone = useIsStandalone();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locationName, setLocationName] = useState("Your Location");
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [navigateTo, setNavigateTo] = useState("");
  const [, navigate] = useLocation();
  const mealPrompt = useMemo(() => getMealPrompt(), []);
  const firstName =
    (user as any)?.firstName?.trim() ||
    (user as any)?.name?.split?.(" ")?.[0] ||
    "";

  useEffect(() => {
    if (navigateTo) {
      navigate(navigateTo);
    }
  }, [navigateTo, navigate]);

  useEffect(() => {
    const seen = sessionStorage.getItem("mealscout_welcome_seen");
    if (!seen && !user) {
      setShowWelcomeModal(true);
    }
  }, [user]);

  // Auto-detect location on mount
  useEffect(() => {
    const cached = readDeviceLocation();
    if (cached && !location) {
      setLocation({ lat: cached.lat, lng: cached.lng });
      if (cached.name) setLocationName(cached.name);
    }
    if (!location) {
      handleLocationDetection();
    }
  }, []);

  const handleLocationDetection = async () => {
    // Don't show loading state for automatic detection
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 10000,
          });
        },
      );

      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setLocation(newLocation);
      setLocationError(null);
      writeDeviceLocation({
        ...newLocation,
        accuracy: position.coords.accuracy,
      });

      await getReverseGeocodedLocationName(
        newLocation.lat,
        newLocation.lng,
        (name) => {
          setLocationName(name);
          writeDeviceLocation({
            ...newLocation,
            accuracy: position.coords.accuracy,
            name,
          });
        },
      );

      queryClient.invalidateQueries({ queryKey: ["/api/deals/nearby"] });
    } catch (error: any) {
      // Silent fail for auto-detection
    }
  };

  const handleManualLocation = async () => {
    if (!manualLocation.trim()) return;

    setIsLoadingLocation(true);
    try {
      const response = await fetch(
        `/api/location/search?q=${encodeURIComponent(manualLocation)}&limit=1`,
      );
      const data = await response.json();

      if (data && data[0]) {
        const newLocation = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
        setLocation(newLocation);
        setLocationName(data[0].display_name);
        writeDeviceLocation({
          ...newLocation,
          name: data[0].display_name,
        });
        setLocationError(null);
        queryClient.invalidateQueries({ queryKey: ["/api/deals/nearby"] });
      } else {
        setLocationError(
          "Could not find that location. Please try a different city name.",
        );
      }
    } catch (error) {
      setLocationError("Failed to search for location. Please try again.");
    } finally {
      setIsLoadingLocation(false);
    }
  };
  const retryLocation = () => {
    setLocationError(null);
    setIsLoadingLocation(true);
    handleLocationDetection();
  };

  // Fetch live trucks
  const {
    data: liveTrucksData,
    isLoading: liveTrucksLoading,
    isError: liveTrucksError,
    refetch: refetchLiveTrucks,
  } = useQuery<{ trucks?: LiveTruck[] } | LiveTruck[]>({
    queryKey: location
      ? ["/api/trucks/live", location.lat, location.lng]
      : ["/api/trucks/live", "no-location"],
    enabled: !!location,
    queryFn: async () => {
      if (!location) {
        return { trucks: [] };
      }
      const response = await fetch(
        `/api/trucks/live?lat=${location.lat}&lng=${location.lng}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to fetch live trucks");
      return response.json();
    },
    staleTime: 15 * 1000,
    refetchInterval: 20 * 1000,
    refetchIntervalInBackground: false,
  });

  const liveTrucks = useMemo(() => {
    if (Array.isArray(liveTrucksData)) return liveTrucksData;
    if (Array.isArray(liveTrucksData?.trucks)) return liveTrucksData.trucks;
    return [];
  }, [liveTrucksData]);

  // Fetch featured businesses
  const { data: publicProfiles = [], isLoading: profilesLoading } = useQuery<
    PublicBusinessProfile[]
  >({
    queryKey: location
      ? ["/api/restaurants/public", location.lat, location.lng]
      : ["/api/restaurants/public", "no-location"],
    enabled: true,
    queryFn: async () => {
      if (!location) {
        try {
          const response = await fetch("/api/restaurants/public", {
            credentials: "include",
          });
          if (!response.ok) return [];
          return response.json();
        } catch {
          return [];
        }
      }
      const response = await fetch(
        `/api/restaurants/public?lat=${location.lat}&lng=${location.lng}`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  // Fetch deals
  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: location
      ? ["/api/deals/nearby", location.lat, location.lng]
      : ["/api/deals/nearby", "no-location"],
    enabled: true,
    queryFn: async () => {
      if (!location) {
        try {
          const response = await fetch("/api/deals/active", {
            credentials: "include",
          });
          if (!response.ok) return [];
          return response.json();
        } catch {
          return [];
        }
      }
      const response = await fetch(
        `/api/deals/nearby/${location.lat}/${location.lng}`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  const dealsByRestaurant = useMemo(() => {
    const map = new Map<string, Deal[]>();
    deals.forEach((deal) => {
      const key = String(deal.restaurantId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(deal);
    });
    return map;
  }, [deals]);

  const featuredBusinesses = useMemo(() => {
    return publicProfiles
      .map((profile) => {
        const profileDeals = dealsByRestaurant.get(String(profile.id)) || [];
        return {
          id: profile.id,
          name: profile.name || "Local Spot",
          address: profile.address,
          cuisineType: profile.cuisineType,
          businessType: profile.businessType,
          isFoodTruck: Boolean(profile.isFoodTruck),
          isVerified: Boolean(profile.isVerified),
          mobileOnline: Boolean(profile.mobileOnline),
          distance:
            typeof profile.distance === "number" &&
            Number.isFinite(profile.distance)
              ? profile.distance
              : undefined,
          updatedAt: profile.updatedAt,
          favoriteCount: profile.favoriteCount || 0,
          followCount: profile.followCount || 0,
          recommendationCount: profile.recommendationCount || 0,
          videoRecommendationCount: profile.videoRecommendationCount || 0,
          communityActivityCount: profile.communityActivityCount || 0,
          activeDealCount: profileDeals.length,
          fairnessScore: 0,
          rankReason: "",
          deals: profileDeals,
        } as BusinessDealsSummary;
      })
      .sort((a, b) => {
        const aDistance =
          typeof a.distance === "number" && Number.isFinite(a.distance)
            ? a.distance
            : Number.POSITIVE_INFINITY;
        const bDistance =
          typeof b.distance === "number" && Number.isFinite(b.distance)
            ? b.distance
            : Number.POSITIVE_INFINITY;
        return aDistance - bDistance;
      })
      .slice(0, 12);
  }, [publicProfiles, dealsByRestaurant]);

  // Split businesses by type
  const foodTrucks = useMemo(() => {
    return featuredBusinesses.filter((b) => b.isFoodTruck);
  }, [featuredBusinesses]);

  const restaurants = useMemo(() => {
    return featuredBusinesses.filter(
      (b) =>
        !b.isFoodTruck &&
        !String(b.businessType || "")
          .toLowerCase()
          .includes("bar"),
    );
  }, [featuredBusinesses]);

  const bars = useMemo(() => {
    return featuredBusinesses.filter(
      (b) =>
        !b.isFoodTruck &&
        String(b.businessType || "")
          .toLowerCase()
          .includes("bar"),
    );
  }, [featuredBusinesses]);

  const shortLocation = locationName?.split(",")[0] || "your area";
  const mealPromptWord = mealPrompt.replace(/\?+$/, "").toLowerCase();

  return (
    <>
      <SEOHead
        title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout"
        description="Discover food trucks, restaurants, and bars near you. Browse menus, find deals, and book parking spots with MealScout."
      />
      <Navigation />

      {/* Hero Section */}
      <section className="relative overflow-visible">
        <div className="absolute inset-0 opacity-25">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-[color:var(--accent-text)]/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[color:var(--accent-text)]/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-12">
          {/* Main heading */}
          <div className="mb-4 sm:mb-6">
            <div className="mb-2 flex items-start justify-between gap-2 sm:gap-3">
              <div className="inline-flex items-start gap-2">
                <h1 className="text-3xl sm:text-5xl font-black leading-[0.95] sm:leading-tight tracking-tight text-[color:var(--text-primary)]">
                  {firstName ? (
                    <>
                      Hey {firstName}, what's for{" "}
                      <span className="text-[color:var(--accent-text)]">
                        {mealPromptWord}
                      </span>
                      ?
                    </>
                  ) : (
                    <span className="text-[color:var(--accent-text)]">
                      {mealPrompt}
                    </span>
                  )}
                </h1>
              </div>
              {!isStandalone && (
                <Link href="/install">
                  <Button
                    className="h-9 sm:h-11 px-3 sm:px-4 rounded-full font-bold text-xs sm:text-sm shadow-clean-lg"
                    data-testid="button-download-app-hero"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                    Download App
                  </Button>
                </Link>
              )}
            </div>
            <p className="text-sm font-medium text-[color:var(--text-secondary)] max-w-2xl leading-snug sm:leading-relaxed">
              <AdminEditableText
                textKey="home.hero.subtitle"
                defaultText="Discover live food trucks, trending deals, and local gems happening right now"
              />
            </p>
            <div className="mt-1 hidden sm:block">
              <AdminEditButton
                textKey="home.hero.subtitle"
                defaultText="Discover live food trucks, trending deals, and local gems happening right now"
                label="Home hero subtitle"
              />
            </div>
          </div>

          {/* Search bar */}
          <div className="mb-3 sm:mb-4 max-w-2xl">
            <SmartSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(query) =>
                setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
              }
              placeholder="Search food trucks, deals, restaurants..."
            />
          </div>

          {/* Quick action buttons */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <Button
              onClick={retryLocation}
              disabled={isLoadingLocation}
              className="action-primary h-9 sm:h-10 px-3 sm:px-4 rounded-full font-semibold text-xs sm:text-sm"
              size="sm"
            >
              <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
              {isLoadingLocation ? "Finding..." : "My Location"}
            </Button>
            <Link href="/map">
              <Button
                variant="outline"
                className="h-9 sm:h-10 px-3 sm:px-4 rounded-full font-semibold text-xs sm:text-sm"
                size="sm"
              >
                <MapIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                Map
              </Button>
            </Link>
            <Link href="/deals/featured">
              <Button
                variant="outline"
                className="h-9 sm:h-10 px-3 sm:px-4 rounded-full font-semibold text-xs sm:text-sm"
                size="sm"
              >
                <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                Deals
              </Button>
            </Link>
          </div>

          {/* Manual location input */}
          {!location && !showWelcomeModal && (
            <div className="mt-4 max-w-sm">
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Enter city or zip"
                  value={manualLocation}
                  onChange={(e) => setManualLocation(e.target.value)}
                  className="h-12 rounded-full px-6"
                  onKeyDown={(e) => e.key === "Enter" && handleManualLocation()}
                />
                <Button
                  onClick={handleManualLocation}
                  disabled={!manualLocation.trim() || isLoadingLocation}
                  className="h-12 px-6 rounded-full font-semibold"
                >
                  {isLoadingLocation ? "..." : "Go"}
                </Button>
              </div>
              {locationError && (
                <p className="text-sm text-[color:var(--status-error)] mt-3">
                  {locationError}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Food Scene Sections ── */}

      {/* Live Food Trucks */}
      {liveTrucks.length > 0 && (
        <section className="py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-green-500/15">
                  <Truck className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-2">
                    <h2 className="text-2xl sm:text-3xl font-black">
                      <AdminEditableText
                        textKey="home.section.liveTrucks.title"
                        defaultText="Live Food Trucks"
                      />
                    </h2>
                    <AdminEditButton
                      textKey="home.section.liveTrucks.title"
                      defaultText="Live Food Trucks"
                      label="Live food trucks section title"
                    />
                  </div>
                  <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                    <AdminEditableText
                      textKey="home.section.liveTrucks.subtitlePrefix"
                      defaultText="Broadcasting now in"
                    />{" "}
                    {shortLocation}
                  </p>
                </div>
              </div>
              {liveTrucks.length > 0 && (
                <Link href="/map">
                  <Button
                    variant="outline"
                    className="rounded-full text-sm font-semibold"
                    size="sm"
                  >
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {liveTrucks.slice(0, 6).map((truck) => (
                <TruckCard
                  key={truck.id}
                  truck={truck}
                  deals={dealsByRestaurant.get(String(truck.id)) || []}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Restaurants */}
      {restaurants.length > 0 && (
        <section className="py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[color:var(--accent-text)]/15">
                  <Utensils className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-2">
                    <h2 className="text-2xl sm:text-3xl font-black">
                      <AdminEditableText
                        textKey="home.section.restaurants.title"
                        defaultText="Restaurants"
                      />
                    </h2>
                    <AdminEditButton
                      textKey="home.section.restaurants.title"
                      defaultText="Restaurants"
                      label="Restaurants section title"
                    />
                  </div>
                  <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                    <AdminEditableText
                      textKey="home.section.restaurants.subtitle"
                      defaultText="Local favorites near you"
                    />
                  </p>
                </div>
              </div>
              {restaurants.length > 0 && (
                <Link href="/search?type=restaurant">
                  <Button
                    variant="outline"
                    className="rounded-full text-sm font-semibold"
                    size="sm"
                  >
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {restaurants.slice(0, 6).map((biz) => (
                <BusinessCard key={biz.id} business={biz} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Bars */}
      {bars.length > 0 && (
        <section className="py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-purple-500/15">
                  <Wine className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black">
                    Bars &amp; Nightlife
                  </h2>
                  <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                    Drinks and vibes nearby
                  </p>
                </div>
              </div>
              {bars.length > 0 && (
                <Link href="/search?type=bar">
                  <Button
                    variant="outline"
                    className="rounded-full text-sm font-semibold"
                    size="sm"
                  >
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {bars.slice(0, 6).map((biz) => (
                <BusinessCard key={biz.id} business={biz} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Hot Deals */}
      {deals.length > 0 && (
        <section className="py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500/15">
                  <Zap className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black">Hot Deals</h2>
                  <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                    Save on your next meal
                  </p>
                </div>
              </div>
              {deals.length > 0 && (
                <Link href="/deals/featured">
                  <Button
                    variant="outline"
                    className="rounded-full text-sm font-semibold"
                    size="sm"
                  >
                    All Deals <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {deals.slice(0, 6).map((deal) => (
                <Link key={deal.id} href={`/restaurant/${deal.restaurantId}`}>
                  <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)] p-5 hover:border-amber-500/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-amber-500/15 flex-shrink-0">
                        <Zap className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-foreground line-clamp-1 group-hover:text-amber-600 transition-colors">
                          {deal.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {deal.restaurant?.name || "Local Spot"}
                        </p>
                      </div>
                    </div>
                    {deal.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {deal.description}
                      </p>
                    )}
                    {deal.discountValue && (
                      <div className="mt-3 inline-block px-3 py-1 rounded-full bg-amber-500/15 text-xs font-bold text-amber-700">
                        {deal.dealType === "fixed"
                          ? `$${deal.discountValue} OFF`
                          : `${deal.discountValue}% OFF`}
                      </div>
                    )}
                    {!deal.discountValue && (
                      <div className="mt-3 inline-block px-3 py-1 rounded-full bg-amber-500/15 text-xs font-bold text-amber-700">
                        Limited Time
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Explore by Cuisine */}
      <section className="py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-black mb-2">
                <AdminEditableText
                  textKey="home.section.cuisine.title"
                  defaultText="Explore by Cuisine"
                />
              </h2>
              <AdminEditButton
                textKey="home.section.cuisine.title"
                defaultText="Explore by Cuisine"
                label="Cuisine section title"
              />
            </div>
            <p className="font-medium text-[color:var(--text-secondary)]">
              <AdminEditableText
                textKey="home.section.cuisine.subtitle"
                defaultText="Find exactly what you're craving"
              />
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {[
              { name: "Pizza", icon: Pizza, href: "/category/pizza" },
              { name: "Burgers", icon: BurgerIcon, href: "/category/burgers" },
              { name: "Sushi", icon: Fish, href: "/category/sushi" },
              { name: "Tacos", icon: Sandwich, href: "/category/mexican" },
              {
                name: "Breakfast",
                icon: Croissant,
                href: "/category/breakfast",
              },
              { name: "Coffee", icon: Coffee, href: "/category/coffee" },
            ].map((cuisine) => (
              <Link key={cuisine.name} href={cuisine.href}>
                <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-2.5 rounded-xl bg-[color:var(--accent-text)]/15 group-hover:bg-[color:var(--accent-text)]/25 transition-colors">
                      <cuisine.icon className="w-5 h-5 text-[color:var(--accent-text)]" />
                    </div>
                    <span className="text-xs font-semibold text-center">
                      {cuisine.name}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA / Quick Access Section */}
      <section className="pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 md:pb-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {!user ? (
            <div className="mx-auto flex max-w-sm flex-col gap-3 sm:max-w-md sm:flex-row sm:justify-center">
              <Link href="/customer-signup" className="sm:flex-1">
                <Button className="action-primary h-11 w-full rounded-full text-sm font-semibold">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create Account
                </Button>
              </Link>
              <Link href="/login" className="sm:flex-1">
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-full border-[color:var(--border-subtle)] bg-[var(--bg-card)] text-sm font-semibold"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  Log In
                </Button>
              </Link>
            </div>
          ) : (
            /* Logged-in: quick access cards */
            <div className="space-y-6">
              <div className="mb-6">
                <div className="inline-flex items-center gap-2">
                  <h2 className="text-3xl font-black mb-2 text-[color:var(--text-primary)]">
                    <AdminEditableText
                      textKey="home.section.quickAccess.title"
                      defaultText="Quick Access"
                    />
                  </h2>
                  <AdminEditButton
                    textKey="home.section.quickAccess.title"
                    defaultText="Quick Access"
                    label="Quick access section title"
                  />
                </div>
                <p className="font-medium text-[color:var(--text-secondary)]">
                  <AdminEditableText
                    textKey="home.section.quickAccess.subtitle"
                    defaultText="Jump to your most-used features"
                  />
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Link href="/map">
                  <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all duration-300 cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="rounded-2xl bg-[color:var(--accent-text)]/15 p-3 group-hover:bg-[color:var(--accent-text)]/25 transition-colors">
                        <MapIcon className="h-6 w-6 text-[color:var(--accent-text)]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-[color:var(--text-primary)]">
                          Explore Nearby
                        </h3>
                        <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                          Open the live map for trucks, spots, and deals around{" "}
                          {shortLocation}.
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
                <Link href="/deals/featured">
                  <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean hover:border-amber-500/50 hover:shadow-lg transition-all duration-300 cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="rounded-2xl bg-amber-500/15 p-3 group-hover:bg-amber-500/25 transition-colors">
                        <Zap className="h-6 w-6 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-[color:var(--text-primary)]">
                          Find Deals
                        </h3>
                        <p className="text-sm font-medium text-[color:var(--text-secondary)]">
                          Browse current specials and limited-time offers.
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/favorites">
                  <div className="group min-h-[8.5rem] rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-xl bg-red-500/15 group-hover:bg-red-500/25 transition-colors">
                        <Heart className="w-6 h-6 text-red-500" />
                      </div>
                      <span className="text-sm font-semibold text-center">
                        Favorites
                      </span>
                    </div>
                  </div>
                </Link>
                <Link href="/orders">
                  <div className="group min-h-[8.5rem] rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-xl bg-blue-500/15 group-hover:bg-blue-500/25 transition-colors">
                        <Clock className="w-6 h-6 text-blue-500" />
                      </div>
                      <span className="text-sm font-semibold text-center">
                        Orders
                      </span>
                    </div>
                  </div>
                </Link>
                <Link href="/dashboard">
                  <div className="group min-h-[8.5rem] rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-xl bg-[color:var(--accent-text)]/15 group-hover:bg-[color:var(--accent-text)]/25 transition-colors">
                        <Rocket className="w-6 h-6 text-[color:var(--accent-text)]" />
                      </div>
                      <span className="text-sm font-semibold text-center">
                        Dashboard
                      </span>
                    </div>
                  </div>
                </Link>
                <Link href="/events">
                  <div className="group min-h-[8.5rem] rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-xl bg-purple-500/15 group-hover:bg-purple-500/25 transition-colors">
                        <Bell className="w-6 h-6 text-purple-500" />
                      </div>
                      <span className="text-sm font-semibold text-center">
                        Events
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// Add useQuery import
import { useQuery } from "@tanstack/react-query";
