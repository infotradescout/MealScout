import { queryClient } from "@/lib/queryClient";
import { fetchJsonWithRetry } from "@/lib/resilientFetch";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Store,
  Bug,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Croissant,
  Salad,
  Fish,
  Coffee,
  Cake,
  Beef,
  Flame,
  ArrowDownToLine,
  PlayCircle,
  TrendingUp,
  Zap,
  ChevronRight,
  Users,
} from "lucide-react";
import mealScoutLogo from "@assets/meal-scout-icon.png";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import {
  sendGeoPing,
  trackGeoAdEvent,
  trackGeoAdImpression,
} from "@/utils/geoAds";
import { SEOHead } from "@/components/seo-head";
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

console.log("MealScout Client Loaded - Build: " + new Date().toISOString());

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
            <span className="text-xs font-bold text-[color:var(--status-success)]">LIVE</span>
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
                {deals.length} Active Deal{deals.length !== 1 ? 's' : ''}
              </p>
              {deals.slice(0, 2).map((deal) => (
                <div key={deal.id} className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-[color:var(--accent-text)] flex-shrink-0 mt-0.5" />
                  <span className="text-xs line-clamp-1 text-foreground">{deal.title}</span>
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
function BusinessCard({
  business,
}: {
  business: BusinessDealsSummary;
}) {
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
                {business.deals.length} Deal{business.deals.length !== 1 ? 's' : ''}
              </p>
              {business.deals.slice(0, 2).map((deal) => (
                <div key={deal.id} className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-[color:var(--accent-text)] flex-shrink-0 mt-0.5" />
                  <span className="text-xs line-clamp-1 text-foreground">{deal.title}</span>
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
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("Your Location");
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [navigateTo, setNavigateTo] = useState("");
  const [, navigate] = useLocation();

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
    if (!location) {
      handleLocationDetection();
    }
  }, []);

  const handleLocationDetection = async () => {
    // Don't show loading state for automatic detection
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
        });
      });

      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setLocation(newLocation);
      setLocationError(null);

      await getReverseGeocodedLocationName(
        newLocation.lat,
        newLocation.lng,
        setLocationName,
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
    enabled: true,
    queryFn: async () => {
      if (!location) {
        try {
          const response = await fetch("/api/trucks/live", { credentials: "include" });
          if (!response.ok) return { trucks: [] };
          return response.json();
        } catch {
          return { trucks: [] };
        }
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
  const {
    data: publicProfiles = [],
    isLoading: profilesLoading,
  } = useQuery<PublicBusinessProfile[]>({
    queryKey: location
      ? ["/api/restaurants/public", location.lat, location.lng]
      : ["/api/restaurants/public", "no-location"],
    enabled: true,
    queryFn: async () => {
      if (!location) {
        try {
          const response = await fetch("/api/restaurants/public", { credentials: "include" });
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
  const {
    data: deals = [],
    isLoading: dealsLoading,
  } = useQuery<Deal[]>({
    queryKey: location
      ? ["/api/deals/nearby", location.lat, location.lng]
      : ["/api/deals/nearby", "no-location"],
    enabled: true,
    queryFn: async () => {
      if (!location) {
        try {
          const response = await fetch("/api/deals/active", { credentials: "include" });
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

  const shortLocation = locationName?.split(",")[0] || "your area";
  const firstName =
    (user as any)?.firstName?.trim() ||
    (user as any)?.name?.split?.(" ")?.[0] ||
    "";

  return (
    <>
      <SEOHead title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout" />
      <Navigation />

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[color:var(--bg-surface)] via-[color:var(--bg-surface)] to-[color:var(--bg-card)]">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-[color:var(--accent-text)]/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[color:var(--accent-text)]/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {/* Main heading */}
          <div className="mb-6">
            <h1 className="text-4xl sm:text-5xl font-black mb-2 leading-tight tracking-tight">
              {firstName ? (
                <>
                  Hey <span className="text-[color:var(--accent-text)]">{firstName}</span>
                </>
              ) : (
                <>
                  What's for <span className="text-[color:var(--accent-text)]">dinner?</span>
                </>
              )}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Discover live food trucks, trending deals, and local gems happening right now
            </p>
          </div>

          {/* Search bar */}
          <div className="mb-4 max-w-2xl">
            <SmartSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(query) =>
                setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
              }
              placeholder="Search food trucks, deals, restaurants..."
              className="shadow-2xl"
            />
          </div>

          {/* Quick action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={retryLocation}
              disabled={isLoadingLocation}
              className="action-primary h-10 px-4 rounded-full font-semibold text-sm"
              size="sm"
            >
              <MapPin className="w-4 h-4 mr-2" />
              {isLoadingLocation ? "Finding..." : "My Location"}
            </Button>
            <Link href="/map">
              <Button variant="outline" className="h-10 px-4 rounded-full font-semibold text-sm" size="sm">
                <MapIcon className="w-4 h-4 mr-2" />
                Map
              </Button>
            </Link>
            <Link href="/deals/featured">
              <Button variant="outline" className="h-10 px-4 rounded-full font-semibold text-sm" size="sm">
                <Zap className="w-4 h-4 mr-2" />
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
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleManualLocation()
                  }
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
                <p className="text-sm text-[color:var(--status-error)] mt-3">{locationError}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Live Food Trucks Section */}
      {liveTrucks.length > 0 && (
        <section className="py-8 bg-[color:var(--bg-surface)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 rounded-xl bg-[color:var(--accent-text)]/15">
                  <Truck className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div>
                  <h2 className="text-3xl font-black">Live Food Trucks</h2>
                  <p className="text-sm text-muted-foreground">Open right now in {shortLocation}</p>
                </div>
              </div>
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

            {liveTrucks.length > 6 && (
              <div className="mt-10 text-center">
                <Link href="/map">
                  <Button variant="outline" className="h-12 px-8 rounded-full font-semibold" size="lg">
                    View All {liveTrucks.length} Trucks
                    <ChevronRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Featured Businesses Section */}
      {featuredBusinesses.length > 0 && (
        <section className="py-16 bg-gradient-to-b from-transparent to-[color:var(--accent-text)]/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 rounded-xl bg-[color:var(--accent-text)]/15">
                  <TrendingUp className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div>
                  <h2 className="text-3xl font-black">Trending Now</h2>
                  <p className="text-sm text-muted-foreground">Hot deals and popular spots</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {featuredBusinesses.map((business) => (
                <BusinessCard key={business.id} business={business} />
              ))}
            </div>
          </div>
        </section>
      )}
      {/* Explore by Cuisine Section */}
      <section className="py-8 bg-[color:var(--bg-card)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-6">
            <h2 className="text-3xl font-black mb-2">Explore by Cuisine</h2>
            <p className="text-muted-foreground">Find exactly what you're craving</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[
              { name: "Hot Deals", icon: Zap, href: "/deals/featured" },
              { name: "Pizza", icon: Pizza, href: "/category/pizza" },
              { name: "Burgers", icon: Beef, href: "/category/burgers" },
              { name: "Sushi", icon: Fish, href: "/category/sushi" },
              { name: "Tacos", icon: Sandwich, href: "/category/mexican" },
              { name: "Breakfast", icon: Croissant, href: "/category/breakfast" },
            ].map((cuisine) => (
              <Link key={cuisine.name} href={cuisine.href}>
                <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer">
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-3 rounded-xl bg-[color:var(--accent-text)]/15 group-hover:bg-[color:var(--accent-text)]/25 transition-colors">
                      <cuisine.icon className="w-6 h-6 text-[color:var(--accent-text)]" />
                    </div>
                    <span className="text-sm font-semibold text-center">{cuisine.name}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Sections */}
      <section className="py-8 bg-gradient-to-b from-[color:var(--bg-card)] to-[color:var(--bg-surface)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-3xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-8 hover:shadow-xl hover:border-[color:var(--accent-text)]/50 transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-xl bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Store className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-2xl font-black mb-2">For Businesses</h3>
                <p className="text-muted-foreground text-sm">Get discovered by hungry customers in your area</p>
              </div>
              <Link href="/customer-signup?role=business">
                <Button className="action-primary w-full h-10 rounded-full font-semibold text-sm">
                  Start Free Trial
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>

            <div className="rounded-3xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-8 hover:shadow-xl hover:border-[color:var(--accent-text)]/50 transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-xl bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-2xl font-black mb-2">For Diners</h3>
                <p className="text-muted-foreground text-sm">Discover amazing food happening around you</p>
              </div>
              <Link href="/customer-signup?role=diner">
                <Button className="action-primary w-full h-10 rounded-full font-semibold text-sm">
                  Create Account
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// Add useQuery import
import { useQuery } from "@tanstack/react-query";
