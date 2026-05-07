import { useQuery } from "@tanstack/react-query";
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
  Target,
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
  Tag,
} from "lucide-react";
import mealScoutLogo from "@assets/meal-scout-icon.png";
import { useFoodTruckSocket } from "@/hooks/useFoodTruckSocket";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { sendGeoPing, trackGeoAdEvent, trackGeoAdImpression } from "@/utils/geoAds";
import { SEOHead } from "@/components/seo-head";
import { SEOInternalLinks } from "@/components/seo-internal-links";
import { trackUxEvent } from "@/utils/uxTelemetry";
import { MapPreviewSheet } from "@/components/MapPreviewSheet";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";
import { useIsStandalone } from "@/hooks/useIsStandalone";
import { computeHomeRankingScore, getHomeRankingReasons } from "@shared/rankingPolicy";

const WelcomeLocationModal = lazy(() => import("@/components/WelcomeLocationModal"));

// Version marker for deployment verification
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

function BusinessDealsCard({
  business,
  compact = false,
}: {
  business: BusinessDealsSummary;
  compact?: boolean;
}) {
  const businessTypeLabel = formatBusinessTypeLabel(business);
  const distanceLabel =
    typeof business.distance === "number" && Number.isFinite(business.distance)
      ? `${business.distance.toFixed(1)} mi away`
      : null;

  return (
    <Link href={`/restaurant/${business.id}`}>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-md hover:bg-white/10 transition-all group h-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-base font-bold text-white truncate group-hover:text-primary transition-colors">
              {business.name}
            </h4>
            <p className="text-xs text-white/40 truncate mt-1 uppercase tracking-widest font-bold">
              {business.cuisineType || businessTypeLabel}
            </p>
          </div>
          <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
            {businessTypeLabel}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-white/40 uppercase tracking-widest">
          <span className="flex items-center gap-1 text-primary">
            <Sparkles className="w-3 h-3" />
            {business.recommendationCount} Recs
          </span>
          <span>{business.favoriteCount} Favs</span>
          {distanceLabel && <span>{distanceLabel}</span>}
        </div>

        <p className="mt-3 text-[11px] text-white/40 leading-relaxed italic line-clamp-2">
          "{business.rankReason}"
        </p>

        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
              Active Deals
            </p>
            <span className="text-[10px] font-bold text-primary">{business.deals.length}</span>
          </div>
          {business.deals.length > 0 ? (
            <div className="space-y-2">
              {business.deals.slice(0, compact ? 1 : 2).map((deal) => (
                <div key={deal.id} className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-primary" />
                  <p className="text-xs text-white/80 font-medium line-clamp-1">
                    {deal.title}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold italic">
              No deals active
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const isStandalone = useIsStandalone();
  const { user } = useAuth();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locationName, setLocationName] = useState("Your Location");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [, setNavigateTo] = useLocation();
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const { isConnected, subscribeToNearby } = useFoodTruckSocket();

  // Show welcome modal only for anonymous users.
  useEffect(() => {
    const hasSeenWelcome = sessionStorage.getItem("mealscout_welcome_seen");

    if (user) {
      setShowWelcomeModal(false);
      return;
    }

    if (!hasSeenWelcome && !location) {
      setShowWelcomeModal(true);
    }
  }, [user, location]);

  useEffect(() => {
    if (user) return;
    trackFunnelEventOncePerSession(FUNNEL_EVENTS.landingView, "home_anonymous", {
      page: "home",
      audience: "anonymous",
    });
  }, [user]);

  const handleLocationDetection = async () => {
    if (navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 0,
            });
          }
        );

        const newLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setLocation(newLocation);
        setLocationError(null);

        await getReverseGeocodedLocationName(
          newLocation.lat,
          newLocation.lng,
          setLocationName
        );

        queryClient.invalidateQueries({ queryKey: ["/api/deals/nearby"] });

        if (isConnected) {
          subscribeToNearby(newLocation.lat, newLocation.lng, 5000);
        }
      } catch (error: any) {
        setLocationError(
          "Unable to detect location automatically. Please set your location."
        );
      } finally {
        setIsLoadingLocation(false);
      }
    }
  };

  const handleLocationUpdate = (newLocation: { lat: number; lng: number }) => {
    setLocation(newLocation);
    setLocationError(null);
    queryClient.invalidateQueries({ queryKey: ["/api/deals/nearby"] });
  };

  const handleLocationNameUpdate = (name: string) => {
    setLocationName(name);
  };

  const handleLocationErrorUpdate = (error: string | null) => {
    setLocationError(error);
    setIsLoadingLocation(false);
  };

  const handleManualLocation = async () => {
    if (!manualLocation.trim()) return;

    setIsLoadingLocation(true);
    try {
      const response = await fetch(
        `/api/location/search?q=${encodeURIComponent(
          manualLocation
        )}&limit=1`
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
          "Could not find that location. Please try a different city name."
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

  const handleWelcomeLocationSet = (
    newLocation: { lat: number; lng: number },
    name: string
  ) => {
    setLocation(newLocation);
    setLocationName(name);
    setLocationError(null);
    sessionStorage.setItem("mealscout_welcome_seen", "true");
    setShowWelcomeModal(false);
    queryClient.invalidateQueries({ queryKey: ["/api/deals/nearby"] });

    if (isConnected) {
      subscribeToNearby(newLocation.lat, newLocation.lng, 5000);
    }
  };

  const handleWelcomeSkip = () => {
    sessionStorage.setItem("mealscout_welcome_seen", "true");
    setShowWelcomeModal(false);
  };

  const fetchFeaturedDealsWithRetry = async (): Promise<Deal[]> => {
    const { response, data } = await fetchJsonWithRetry<Deal[]>(
      "/api/deals/featured",
      { credentials: "include" },
      {
        attempts: 2,
        retryStatuses: [503],
        baseDelayMs: 700,
        timeoutMs: 10000,
        fallbackValue: [],
      },
    );

    if (response.status === 503) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`Featured deals request failed (${response.status})`);
    }

    return Array.isArray(data) ? data : [];
  };

  const {
    data: featuredDeals,
    refetch: refetchFeaturedDeals,
  } = useQuery<Deal[]>({
    queryKey: ["/api/deals/featured"],
    queryFn: fetchFeaturedDealsWithRetry,
    retry: (failureCount, error: any) => {
      const message = String(error?.message || "").toLowerCase();
      const isTransient =
        message.includes("network") ||
        message.includes("failed to fetch") ||
        message.includes("timeout") ||
        message.includes("503") ||
        message.includes("service unavailable");
      return isTransient && failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
  });

  const sortedFeaturedDeals = useMemo(
    () =>
      featuredDeals
        ? [...featuredDeals].sort((a: Deal, b: Deal) => {
            const aDistance = a.distance ?? Number.POSITIVE_INFINITY;
            const bDistance = b.distance ?? Number.POSITIVE_INFINITY;
            return aDistance - bDistance;
          })
        : [],
    [featuredDeals],
  );

  const dealsByRestaurant = useMemo(() => {
    const grouped = new Map<string, Deal[]>();
    sortedFeaturedDeals.forEach((deal) => {
      const key = String(deal.restaurantId || "").trim();
      if (!key) return;
      const existing = grouped.get(key) || [];
      existing.push(deal);
      grouped.set(key, existing);
    });
    return grouped;
  }, [sortedFeaturedDeals]);

  const {
    data: publicProfiles = [],
    isLoading: publicProfilesLoading,
    isError: publicProfilesError,
    refetch: refetchPublicProfiles,
  } = useQuery<PublicBusinessProfile[]>({
    queryKey: location
      ? ["/api/restaurants/public", location.lat, location.lng]
      : ["/api/restaurants/public", "all"],
    queryFn: async () => {
      const base = "/api/restaurants/public";
      const url = location
        ? `${base}?lat=${location.lat}&lng=${location.lng}&radius=12&limit=120`
        : `${base}?limit=120`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch public profiles");
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const featuredBusinesses = useMemo(() => {
    const profiles = Array.isArray(publicProfiles) ? publicProfiles : [];
    const computeFairnessScore = (profile: PublicBusinessProfile, dealCount: number) => {
      const recommendationCount = Number(profile.recommendationCount || 0);
      const videoRecommendationCount = Number(
        profile.videoRecommendationCount || 0,
      );
      const followCount = Number(profile.followCount || 0);
      const favoriteCount = Number(profile.favoriteCount || 0);
      const communityActivityCount = Number(profile.communityActivityCount || 0);
      const activeDealCount = Math.max(
        Number(profile.activeDealCount || 0),
        dealCount,
      );
      const locationBoost =
        typeof profile.distance === "number" && Number.isFinite(profile.distance)
          ? Math.max(0, 12 - Math.min(profile.distance, 12)) / 12
          : 0;
      const liveTruckBoost =
        profile.isFoodTruck && profile.mobileOnline ? 1.5 : 0;
      return computeHomeRankingScore({
        recommendationCount,
        videoRecommendationCount,
        followCount,
        favoriteCount,
        activeDealCount,
        locationBoost,
        liveTruckBoost,
        communityActivityCount,
      });
    };

    return profiles
      .map((profile) => {
        const profileDeals = dealsByRestaurant.get(String(profile.id)) || [];
        const recommendationCount = Number(profile.recommendationCount || 0);
        const videoRecommendationCount = Number(
          profile.videoRecommendationCount || 0,
        );
        const followCount = Number(profile.followCount || 0);
        const favoriteCount = Number(profile.favoriteCount || 0);
        const communityActivityCount = Number(profile.communityActivityCount || 0);
        const activeDealCount = Math.max(
          Number(profile.activeDealCount || 0),
          profileDeals.length,
        );
        const fairnessScore = computeFairnessScore(profile, profileDeals.length);
        const rankReason = getHomeRankingReasons({
          recommendationCount,
          videoRecommendationCount,
          followCount,
          favoriteCount,
          activeDealCount,
          hasLocationBoost:
            typeof profile.distance === "number" &&
            Number.isFinite(profile.distance) &&
            profile.distance <= 12,
        });
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
            typeof profile.distance === "number" && Number.isFinite(profile.distance)
              ? profile.distance
              : undefined,
          updatedAt: profile.updatedAt,
          recommendationCount,
          videoRecommendationCount,
          followCount,
          favoriteCount,
          communityActivityCount,
          activeDealCount,
          fairnessScore,
          rankReason,
          deals: profileDeals,
        } as BusinessDealsSummary;
      })
      .sort((a, b) => {
        if (a.fairnessScore !== b.fairnessScore) {
          return b.fairnessScore - a.fairnessScore;
        }

        const aDistance =
          typeof a.distance === "number" && Number.isFinite(a.distance)
            ? a.distance
            : Number.POSITIVE_INFINITY;
        const bDistance =
          typeof b.distance === "number" && Number.isFinite(b.distance)
            ? b.distance
            : Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;

        const aUpdated = new Date(a.updatedAt || 0).getTime();
        const bUpdated = new Date(b.updatedAt || 0).getTime();
        return bUpdated - aUpdated;
      });
  }, [publicProfiles, dealsByRestaurant]);

  // Apply inline category filter from chip selection
  const filteredBusinesses = useMemo(() => {
    if (!activeCategory || activeCategory === "deals") return featuredBusinesses;
    return featuredBusinesses.filter((b) => {
      const cuisine = (b.cuisineType || "").toLowerCase();
      const type = (b.businessType || "").toLowerCase();
      return cuisine.includes(activeCategory) || type.includes(activeCategory);
    });
  }, [featuredBusinesses, activeCategory]);

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
      if (!location) return { trucks: [] };
      const response = await fetch(
        `/api/trucks/live?lat=${location.lat}&lng=${location.lng}&radiusKm=7`,
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

  const { data: geoAds = [] } = useQuery<GeoAd[]>({
    queryKey: ["/api/geo-ads", "home", location?.lat, location?.lng],
    enabled: !!location,
    queryFn: async () => {
      if (!location) return [];
      const res = await fetch(
        `/api/geo-ads?placement=home&lat=${location.lat}&lng=${location.lng}&limit=1`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: weeklyTrendingVideos = [] } = useQuery<TrendingStory[]>({
    queryKey: ["/api/stories/leaderboards/trending", "week"],
    queryFn: async () => {
      const response = await fetch(
        "/api/stories/leaderboards/trending?timeframe=week",
        { credentials: "include" },
      );
      if (!response.ok) return [];
      const payload = await response.json();
      const list = Array.isArray(payload?.trending) ? payload.trending : [];
      return list.slice(0, 6);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  useEffect(() => {
    if (!location) return;
    sendGeoPing({ lat: location.lat, lng: location.lng, source: "home" });
  }, [location?.lat, location?.lng]);

  useEffect(() => {
    if (!geoAds.length) return;
    geoAds.forEach((ad) =>
      trackGeoAdImpression({ adId: ad.id, placement: "home" })
    );
  }, [geoAds]);

  const shortLocation = locationName?.split(",")[0] || "your area";
  const firstName =
    (user as any)?.firstName?.trim() ||
    (user as any)?.name?.split?.(" ")?.[0] ||
    "";
  const welcomeName = firstName || "there";

  const handleGeoAdClick = (ad: GeoAd) => {
    trackGeoAdEvent({ adId: ad.id, eventType: "click", placement: "home" });
    window.open(ad.targetUrl, "_blank", "noopener,noreferrer");
  };

  const homeSchemaData = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          name: "MealScout",
          url: "https://www.mealscout.us/",
          potentialAction: {
            "@type": "SearchAction",
            target: "https://www.mealscout.us/search?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        },
        {
          "@type": "CollectionPage",
          name: "MealScout Home",
          description:
            "Find food trucks near you, discover live locations, and browse local deals from restaurants, bars, and hosts with MealScout.",
          url: "https://www.mealscout.us/",
            mainEntity: {
              "@type": "ItemList",
              name: "Public Local Food Profiles",
              numberOfItems: featuredBusinesses.slice(0, 12).length,
              itemListElement: featuredBusinesses.slice(0, 12).map((business, index: number) => ({
                "@type": "ListItem",
                position: index + 1,
                name: business.name,
                url: `${typeof window !== "undefined" ? window.location.origin : "https://www.mealscout.us"}/restaurant/${business.id}`,
              })),
            },
          },
        ],
      }),
    [featuredBusinesses],
  );

  return (
    <div className="home-page pb-24 min-h-screen bg-background">
      <SEOHead
        title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout"
        description="Find food trucks, restaurants, and bars near you. Discover live locations, local specials, and deals in your city — all on MealScout."
        keywords="food trucks near me, food truck finder, local restaurants near me, food truck map, local food deals, restaurant specials near me, food truck events near me, find food near me"
        canonicalUrl="https://www.mealscout.us/"
        schemaData={homeSchemaData}
      />
      <Navigation />

      {/* Map Preview Sheet Integration */}
      <MapPreviewSheet location={location} liveTrucks={liveTrucks} />

      {/* Header with Logo and Navigation - Atmospheric Adaptation */}
      <header className="px-6 py-4 bg-black/20 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 flex items-center justify-center">
              <img
                src={mealScoutLogo}
                alt="MealScout Logo"
                className="w-full h-full object-contain brightness-125"
                loading="lazy"
                decoding="async"
              />
            </div>
            <h2 className="text-xl font-serif font-bold text-white tracking-tight hidden sm:block">MEALSCOUT</h2>
          </div>

          <div className="flex items-center space-x-2">
            {!isStandalone && (
              <Link href="/install">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/40 hover:text-white"
                  title="Install app"
                >
                  <ArrowDownToLine className="w-5 h-5" />
                </Button>
              </Link>
            )}
            {!user ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={() => setNavigateTo("/login")}
                  className="text-white/60 hover:text-white text-xs font-bold uppercase tracking-widest"
                >
                  Log In
                </Button>
                <Button
                  onClick={() => setNavigateTo("/customer-signup")}
                  className="bg-primary text-black text-xs font-bold uppercase tracking-widest rounded-xl px-4"
                >
                  Join
                </Button>
              </div>
            ) : (
              <div className="flex items-center space-x-3 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(245,158,11,0.8)]" />
                <span className="text-xs font-bold text-white/80 uppercase tracking-wider">
                  {locationName.split(",")[0]}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={retryLocation}
                  disabled={isLoadingLocation}
                  className="h-6 w-6 text-white/40 hover:text-white"
                >
                  {isLoadingLocation ? (
                    <RotateCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Target className="w-3 h-3" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!user && (
        <section className="border-b border-white/5 py-3 bg-black/30 backdrop-blur-md">
          <div className="px-6">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                Traction Sprint Offer
              </p>
              <h2 className="mt-1 text-lg font-bold text-foreground">
                Get your restaurant or truck live in minutes
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Post deals, appear on discovery, and start converting nearby regulars.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/customer-signup?role=business">
                  <Button
                    size="sm"
                    className="bg-primary text-black font-bold rounded-xl hover:shadow-[0_0_20px_rgba(245,158,11,0.4)]"
                    data-testid="button-home-focused-business-cta"
                    onClick={() => {
                      trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
                        page: "home",
                        cta: "focused_business_offer",
                        destination: "/customer-signup?role=business",
                        role: "business",
                      });
                    }}
                  >
                    Start business signup
                  </Button>
                </Link>
                <Link href="/customer-signup">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="button-home-focused-diner-cta"
                    onClick={() => {
                      trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
                        page: "home",
                        cta: "focused_diner_offer",
                        destination: "/customer-signup",
                        role: "diner",
                      });
                    }}
                  >
                    I am a diner
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Hero & Search Section - Atmospheric Adaptation */}
      <section className="px-6 py-8 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col items-start text-left">
            <div className="mb-6">
              <h1 className="text-3xl font-serif font-bold text-white tracking-tight">
                {firstName ? `Hey ${firstName}, hungry?` : "Hungry?"}
              </h1>
              <p className="text-primary text-sm font-medium uppercase tracking-[0.2em] mt-2">
                {shortLocation === "Your Location"
                  ? "Happening near you"
                  : `Live in ${shortLocation}`}
              </p>
            </div>

            <SmartSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(query) =>
                setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
              }
              className="mb-8 w-full"
              placeholder="Search deals, restaurants..."
            />

            <div className="mb-8 grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={retryLocation}
                disabled={isLoadingLocation}
                className="w-full bg-white/5 border border-white/10 text-white font-bold rounded-xl py-6 hover:bg-white/10 transition-all"
                data-testid="button-home-use-location"
                onPointerDown={() => {
                  trackUxEvent("home_location_request_quick", {
                    surface: "home_quick_actions",
                  });
                }}
              >
                <MapPin className="w-4 h-4 mr-2 text-primary" />
                {isLoadingLocation ? "Locating..." : "Use location"}
              </Button>
              <Link href="/map" className="w-full">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full bg-white/5 border border-white/10 text-white font-bold rounded-xl py-6 hover:bg-white/10 transition-all"
                  data-testid="button-home-open-map"
                  onPointerDown={() => {
                    trackUxEvent("home_open_map_quick", {
                      surface: "home_quick_actions",
                    });
                  }}
                >
                  <MapIcon className="w-4 h-4 mr-2 text-primary" />
                  Open map
                </Button>
              </Link>
              <Link href="#scout-deals-section" className="w-full">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full bg-white/5 border border-white/10 text-white font-bold rounded-xl py-6 hover:bg-white/10 transition-all"
                  data-testid="button-home-featured"
                  onPointerDown={() => {
                    trackUxEvent("home_open_featured_quick", {
                      surface: "home_quick_actions",
                    });
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-2 text-primary" />
                  Featured
                </Button>
              </Link>
            </div>

            {geoAds.length > 0 && (
              <div className="mb-8 w-full">
                {geoAds.map((ad) => (
                  <div
                    key={ad.id}
                    className="p-6 rounded-3xl border border-primary/20 bg-primary/5 backdrop-blur-sm shadow-[0_8px_32px_rgba(245,158,11,0.1)]"
                  >
                    {ad.mediaUrl && (
                      <img
                        src={ad.mediaUrl}
                        alt={ad.title}
                        className="w-full h-48 object-cover rounded-2xl mb-4 grayscale contrast-125 brightness-75"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                        Local Spotlight
                      </span>
                    </div>
                    <div className="text-xl font-serif font-bold text-white">
                      {ad.title}
                    </div>
                    {ad.body && (
                      <p className="text-sm text-white/60 mt-2 leading-relaxed">
                        {ad.body}
                      </p>
                    )}
                    <div className="mt-4">
                      <Button 
                        size="sm" 
                        onClick={() => handleGeoAdClick(ad)}
                        className="rounded-xl bg-primary text-black font-bold hover:shadow-[0_0_20px_rgba(245,158,11,0.4)]"
                      >
                        {ad.ctaText || "Pull Up"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filter Chips - Inline category filtering (no navigation away) */}
            <div className="flex space-x-3 overflow-x-auto pb-2 w-full">
              {[
                { label: "Hot Deals", key: "deals", icon: "✦" },
                { label: "Pizza", key: "pizza", icon: "🍕" },
                { label: "Burgers", key: "burgers", icon: "🍔" },
                { label: "Sushi", key: "sushi", icon: "🍣" },
                { label: "Chinese", key: "chinese", icon: "🥡" },
                { label: "Tacos", key: "mexican", icon: "🌮" },
                { label: "Breakfast", key: "breakfast", icon: "🍳" },
                { label: "Seafood", key: "seafood", icon: "🦞" },
                { label: "BBQ", key: "bbq", icon: "🔥" },
                { label: "Desserts", key: "dessert", icon: "🍰" },
                { label: "Coffee", key: "coffee", icon: "☕" },
                { label: "Healthy", key: "healthy", icon: "🥗" },
              ].map((chip) => (
                <Button
                  key={chip.key}
                  onClick={() => setActiveCategory(activeCategory === chip.key ? null : chip.key)}
                  className={`flex-shrink-0 rounded-2xl px-5 py-6 font-bold transition-all ${
                    activeCategory === chip.key
                      ? "bg-primary text-black shadow-[0_8px_20px_rgba(245,158,11,0.4)] scale-105"
                      : "bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                  size="sm"
                  id={chip.key === "deals" ? "scout-deals-section" : undefined}
                >
                  <span className="mr-1.5">{chip.icon}</span> {chip.label}
                </Button>
              ))}
            </div>

            {/* Manual location input (only when we don't have a location) */}
            {!location && !showWelcomeModal && (
              <div className="mt-4 w-full max-w-md">
                <div className="manual-location-shell">
                  <Input
                    type="text"
                    placeholder="Enter city or zip"
                    value={manualLocation}
                    onChange={(e) => setManualLocation(e.target.value)}
                    className="manual-location-input"
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleManualLocation()
                    }
                  />
                  <Button
                    onClick={handleManualLocation}
                    disabled={!manualLocation.trim() || isLoadingLocation}
                    className="manual-location-button"
                  >
                    {isLoadingLocation ? "..." : "Go"}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={retryLocation}
                  disabled={isLoadingLocation}
                  className="mt-2 text-primary hover:text-primary/80"
                >
                  Use my location
                </Button>
                {locationError && (
                  <p className="manual-location-error" role="alert">{locationError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Food Trucks Nearby - Atmospheric Adaptation */}
      <section className="py-8 border-b border-white/5 bg-black/40">
        <div className="px-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.8)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Live Now</span>
              </div>
              <h3 className="text-2xl font-serif font-bold text-white">
                {shortLocation === "Your Location" ? "Nearby Trucks" : `Open in ${shortLocation}`}
              </h3>
            </div>
            <Link href="/map">
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest"
              >
                Full Map
              </Button>
            </Link>
          </div>
          {liveTrucksLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-60 h-40 rounded-xl bg-white/5 animate-pulse"
                />
              ))}
            </div>
          ) : liveTrucksError ? (
            <div className="text-center py-6 text-red-400 text-sm">
              <p>We couldn't load live trucks right now.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetchLiveTrucks()}
              >
                Retry Live Trucks
              </Button>
            </div>
          ) : !location ? (
            <p className="text-xs text-muted-foreground py-3">
              Use your location to see live trucks nearby.
            </p>
          ) : liveTrucks.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {liveTrucks.map((truck) => {
                const truckDeals = dealsByRestaurant.get(String(truck.id)) || [];
                const distanceMiles =
                  typeof truck.distance === "number" && Number.isFinite(truck.distance)
                    ? truck.distance * 0.621371
                    : null;
                const lastSeenLabel = truck.lastBroadcastAt
                  ? `Updated ${new Date(truck.lastBroadcastAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : "Live location active";

                return (
                  <Link key={truck.id} href={`/restaurant/${truck.id}`}>
                    <div className="flex-shrink-0 w-64 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-md hover:bg-white/10 transition-all group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-base font-bold text-white truncate group-hover:text-primary transition-colors">
                            {truck.name}
                          </h4>
                          <p className="text-xs text-white/40 truncate mt-1 uppercase tracking-widest font-bold">
                            {truck.cuisineType || "Food Truck"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-1 border border-primary/20">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                            Live
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-white/40 uppercase tracking-widest">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {distanceMiles != null
                            ? `${distanceMiles.toFixed(1)} mi`
                            : "Nearby"}
                        </span>
                        <span>{lastSeenLabel}</span>
                      </div>

                      <div className="mt-4 pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                            Active Deals
                          </p>
                          <span className="text-[10px] font-bold text-primary">{truckDeals.length}</span>
                        </div>
                        {truckDeals.length > 0 ? (
                          <div className="space-y-2">
                            {truckDeals.slice(0, 1).map((deal) => (
                              <div key={deal.id} className="flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-primary" />
                                <p className="text-xs text-white/80 font-medium line-clamp-1">
                                  {deal.title}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold italic">
                            No deals active
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-3">
              No live trucks nearby right now.
            </p>
          )}
        </div>
      </section>

      {/* Tonight's Specials - Deals Discovery Section */}
      <section className="py-10 border-b border-white/5 bg-black/50">
        <div className="px-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Tonight's Specials</span>
              </div>
              <h3 className="text-2xl font-serif font-bold text-white">Deals Near You</h3>
            </div>
            <Link href="#scout-deals-section">
              <Button variant="ghost" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">
                See All
              </Button>
            </Link>
          </div>

          {sortedFeaturedDeals.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {sortedFeaturedDeals.slice(0, 8).map((deal) => (
                <Link key={deal.id} href={`/deal/${deal.id}`}>
                  <div className="flex-shrink-0 w-56 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-md hover:bg-white/10 transition-all group">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-full">
                        {deal.dealType === "percentage" ? `${deal.discountValue}% OFF` : `$${deal.discountValue} OFF`}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">{deal.dealType}</span>
                    </div>
                    <h4 className="text-sm font-bold text-white line-clamp-2 group-hover:text-primary transition-colors mb-2">
                      {deal.title}
                    </h4>
                    {deal.restaurantId && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 truncate">
                        {(dealsByRestaurant.get(String(deal.restaurantId)) || []).length > 0
                          ? "View deal"
                          : "Stop in tonight"}
                      </p>
                    )}
                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest">
                        {deal.startTime && deal.endTime
                          ? `${deal.startTime.slice(0,5)} – ${deal.endTime.slice(0,5)}`
                          : "All day"}
                      </span>
                      <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Pull Up →</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">No specials posted nearby yet.</p>
              <Link href="#scout-deals-section">
                <Button className="mt-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl px-5 py-2 hover:bg-white/10">Browse Featured</Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Public Profiles Section - Atmospheric Adaptation */}
      <section className="py-12 border-b border-white/5 bg-black/60">
        <div className="px-6">
          <div className="flex items-end justify-between mb-8">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Discover</span>
              </div>
              <h2 className="text-3xl font-serif font-bold text-white">
                {shortLocation === "Your Location"
                  ? "Local Favorites"
                  : `Best of ${shortLocation}`}
              </h2>
              <p className="text-white/40 text-sm font-medium max-w-md">
                Public truck, restaurant, and bar profiles. Community recommendations carry extra weight.
              </p>
            </div>
            <Link href="#scout-deals-section">
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest"
              >
                View All
              </Button>
            </Link>
          </div>

          {publicProfilesLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-64 bg-white/5 rounded-lg h-52 animate-pulse"
                />
              ))}
            </div>
          ) : publicProfilesError ? (
            <div className="text-center py-8 text-red-400 text-sm">
              <p>We couldn't load profiles right now. Try again in a bit.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  refetchPublicProfiles();
                  refetchFeaturedDeals();
                }}
              >
                Retry Profiles
              </Button>
            </div>
          ) : filteredBusinesses.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {filteredBusinesses.map((business) => (
                <div key={business.id} className="flex-shrink-0 w-64">
                  <BusinessDealsCard business={business} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-3">No public profiles to show yet.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/map">
                  <Button size="sm" variant="outline">
                    Open Map
                  </Button>
                </Link>
                <Link href="#scout-deals-section">
                  <Button size="sm" variant="outline">
                    View Featured
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button size="sm" variant="outline">
                    Recommend a Spot
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Video Recommendations - Atmospheric Adaptation */}
      <section className="py-12 border-b border-white/5 bg-black/40">
        <div className="px-6">
          <div className="flex items-end justify-between mb-8">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Watch</span>
              </div>
              <h2 className="text-3xl font-serif font-bold text-white">Trending Stories</h2>
              <p className="text-white/40 text-sm font-medium">Community food recommendations that are moving the needle this week.</p>
            </div>
            <Link href="/video">
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest"
              >
                Post Video
              </Button>
            </Link>
          </div>

          {weeklyTrendingVideos.length > 0 ? (
            <div className="grid grid-cols-1 gap-3">
              {weeklyTrendingVideos.map((story) => (
                <Link key={story.id} href={`/video/${story.id}`}>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 hover:bg-white/10 transition-all group">
                    <p className="text-base font-bold text-white group-hover:text-primary transition-colors">
                      {story.title || "Food recommendation"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                      <span>{story.creatorName || "MealScout User"}</span>
                      <span>{Number(story.viewCount || 0).toLocaleString()} views</span>
                      <span>{Number(story.likeCount || 0).toLocaleString()} likes</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/20 font-bold uppercase tracking-widest">
              No trending stories yet.
            </div>
          )}
        </div>
      </section>

      <section className="py-3 bg-black/20 border-b border-white/5">
        <div className="px-6">
          <SEOInternalLinks
            title={`What's Popular ${shortLocation === "Your Location" ? "Near You" : `in ${shortLocation}`}`}
            description="Popular food spots and cuisines people are checking out in your area."
            maxCities={8}
            maxCuisineLinksPerCity={2}
          />
        </div>
      </section>

      {/* Owner Section - Atmospheric Adaptation */}
      {!user && (
        <section className="py-12 border-b border-white/5 bg-primary/5 backdrop-blur-md">
          <div className="px-6 text-center max-w-lg mx-auto">
            <div className="p-3 rounded-2xl bg-primary/10 w-fit mx-auto mb-6">
              <ChefHat className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-2xl font-serif font-bold text-white mb-3">
              Bring your place to the neighborhood
            </h3>
            <p className="text-white/60 mb-8 text-sm leading-relaxed">
              Post real-time deals, broadcast when you're open, and start converting nearby regulars today.
            </p>
            <Link href="/customer-signup?role=business">
              <Button
                size="lg"
                className="bg-primary text-black font-bold uppercase tracking-widest px-8 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.3)]"
                onClick={() => {
                  trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
                    page: "home",
                    cta: "owner_section_claim_go_live",
                    destination: "/customer-signup?role=business",
                    role: "business",
                  });
                }}
              >
                Claim & Go Live
              </Button>
            </Link>
          </div>
        </section>
      )}

      {/* TWO-COLUMN SECTIONS - Atmospheric Adaptation */}
      <section className="py-16 border-b border-white/5 bg-black/80">
        <div className="px-6">
          {!user ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {/* Stay Connected Section */}
              <div className="space-y-8">
                <div className="flex flex-col gap-2 text-center md:text-left">
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <Heart className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Join Us</span>
                  </div>
                  <h3 className="text-3xl font-serif font-bold text-white">
                    Unlock the{" "}
                    {shortLocation === "Your Location" ? "Local" : shortLocation}{" "}
                    Scene
                  </h3>
                  <p className="text-white/40 text-sm font-medium">
                    Save go-tos, track trucks live, and get a heads-up when spots reopen.
                  </p>
                </div>

                <div className="space-y-4">
                  {[
                    { icon: Heart, title: `${shortLocation === "Your Location" ? "Neighborhood" : shortLocation} Favorites`, desc: "Keep your go-tos one tap away" },
                    { icon: Truck, title: `Food trucks ${shortLocation === "Your Location" ? "nearby" : `in ${shortLocation}`}`, desc: "Live locations around you" },
                    { icon: Bell, title: `Deals ${shortLocation === "Your Location" ? "nearby" : `in ${shortLocation}`}`, desc: "Quick wins close to you" }
                  ].map((item, idx) => (
                    <div key={idx} className="bg-white/5 p-4 rounded-2xl border border-white/10 flex items-center gap-4 group hover:bg-white/10 transition-all">
                      <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <item.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-white text-sm">{item.title}</h4>
                        <p className="text-xs text-white/40 font-medium">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Link href="/customer-signup">
                  <Button
                    className="w-full bg-white text-black font-bold uppercase tracking-widest py-6 rounded-2xl hover:bg-primary transition-all"
                    onClick={() => {
                      trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
                        page: "home",
                        cta: "stay_connected_create_account",
                        destination: "/customer-signup",
                        role: "diner",
                      });
                    }}
                  >
                    Create Free Account
                  </Button>
                </Link>
              </div>

              {/* Community Building Section */}
              <div className="space-y-8">
                <div className="flex flex-col gap-2 text-center md:text-left">
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Promote</span>
                  </div>
                  <h3 className="text-3xl font-serif font-bold text-white">
                    Support Local Gems
                  </h3>
                  <p className="text-white/40 text-sm font-medium">
                    Pass along great spots and help them stay busy.
                  </p>
                </div>

                <div className="space-y-4">
                  {[
                    { step: "1", title: "Share Your Link", desc: "Get a unique referral link to share with restaurants" },
                    { step: "2", title: "Restaurant Subscribes", desc: "When they join, you become their community partner" },
                    { step: "3", title: "Earn Recurring Income", desc: "Receive commission as long as they remain active" }
                  ].map((item, idx) => (
                    <div key={idx} className="bg-white/5 p-4 rounded-2xl border border-white/10 flex items-start gap-4 group hover:bg-white/10 transition-all">
                      <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <span className="text-primary font-bold text-lg">{item.step}</span>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-white text-sm mb-1">{item.title}</h4>
                        <p className="text-xs text-white/40 font-medium leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Link href={user ? "/affiliate-dashboard" : "/customer-signup"}>
                  <Button className="w-full bg-primary/10 border border-primary/20 text-primary font-bold uppercase tracking-widest py-6 rounded-2xl hover:bg-primary/20 transition-all">
                    {user ? "Community Builder Dashboard" : "Start Building"}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="max-w-[600px] mx-auto">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-bold text-white">Nearby Profiles</h3>
                <Link href="#scout-deals-section">
                  <Button variant="ghost" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">
                    View All
                  </Button>
                </Link>
              </div>

              {publicProfilesLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-48 rounded-3xl bg-white/5 animate-pulse border border-white/10" />
                  ))}
                </div>
              ) : publicProfilesError ? (
                <div className="text-center py-12 rounded-3xl border border-white/10 bg-white/5">
                  <p className="text-white/40 text-sm font-medium mb-4">We couldn't load profiles right now.</p>
                  <Button
                    variant="ghost"
                    className="text-primary font-bold uppercase tracking-widest text-xs"
                    onClick={() => {
                      refetchPublicProfiles();
                      refetchFeaturedDeals();
                    }}
                  >
                    Retry Profiles
                  </Button>
                </div>
              ) : filteredBusinesses.length > 0 ? (
                <div className="space-y-4">
                  {filteredBusinesses.map((business) => (
                    <BusinessDealsCard key={business.id} business={business} compact />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 rounded-3xl border border-dashed border-white/10 bg-white/5">
                  <p className="text-white/40 text-sm font-medium mb-6">No deals nearby yet.</p>
                  <div className="flex flex-wrap justify-center gap-4">
                    <Link href="/map">
                      <Button className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest px-6 rounded-xl hover:bg-white/10">
                        Open Map
                      </Button>
                    </Link>
                    <Link href="#scout-deals-section">
                      <Button className="bg-primary/10 border border-primary/20 text-primary font-bold uppercase tracking-widest px-6 rounded-xl hover:bg-primary/20">
                        Featured Deals
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Footer - Atmospheric Adaptation */}
      <footer className="py-16 border-t border-white/5 bg-black">
        <div className="px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
            {[
              { title: "Product", links: [{ label: "How It Works", href: "/how-it-works" }, { label: "FAQ", href: "/faq" }] },
              { title: "Company", links: [{ label: "About", href: "/about" }, { label: "Comparisons", href: "/compare" }, { label: "Delivery Alternatives", href: "/delivery-app-alternatives" }, { label: "Ordering Platforms", href: "/online-ordering-platforms" }, { label: "Contact", href: "/contact" }] },
              { title: "Legal", links: [{ label: "Privacy", href: "/privacy-policy" }, { label: "Terms", href: "/terms-of-service" }, { label: "Moderation Policy", href: "/moderation-policy" }] },
              { title: "Support", links: [{ label: "Help Center", href: "/faq" }, { label: "Status", href: "/status" }] }
            ].map((section, idx) => (
              <div key={idx} className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{section.title}</h4>
                <ul className="space-y-3">
                  {section.links.map((link, lIdx) => (
                    <li key={lIdx}>
                      <Link href={link.href} className="text-sm font-medium text-white/60 hover:text-primary transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">
              © 2026 MealScout. Follow The Flavor.
            </p>
            <div className="flex items-center gap-6">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">Mobile First</span>
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">Fast Loading</span>
            </div>
          </div>
        </div>
      </footer>

      {!location && !showWelcomeModal && (
        <section className="px-6 md:hidden pb-8">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Location Required</span>
            </div>
            <p className="text-sm text-white/60 font-medium mb-6">
              Turn on location to unlock nearby deals and live map updates.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="bg-white text-black font-bold uppercase tracking-widest text-[10px] rounded-xl py-6 hover:bg-primary transition-all"
                onClick={retryLocation}
                disabled={isLoadingLocation}
                onPointerDown={() => {
                  trackUxEvent("home_location_request_inline", {
                    surface: "home_inline_cta",
                  });
                }}
              >
                {isLoadingLocation ? "Locating..." : "Use Location"}
              </Button>
              <Link href="/map">
                <Button
                  className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl py-6 hover:bg-white/10 transition-all"
                  onPointerDown={() => {
                    trackUxEvent("home_open_map_inline", {
                      surface: "home_inline_cta",
                    });
                  }}
                >
                  Open Map
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Welcome Modal for First-Time Session Visitors */}
      <Suspense fallback={null}>
        <WelcomeLocationModal
          open={showWelcomeModal}
          onLocationSet={handleWelcomeLocationSet}
          onSkip={handleWelcomeSkip}
        />
      </Suspense>
    </div>
  );
}






