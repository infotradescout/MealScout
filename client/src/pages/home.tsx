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
  Pizza,
  Truck,
  RotateCw,
  ChefHat,
  Target,
  Map as MapIcon,
  Store,
  Sandwich,
  Soup,
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
  startTime?: string;
  endTime?: string;
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
      <section className="px-6 pt-8 pb-28 md:pb-8 border-b border-white/5 bg-black/20 backdrop-blur-md">
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
              <Link href="/scout" className="w-full">
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
                  Open Scout
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

            {/* Filter Chips - Inline category filtering (no navigation away) */}
            <div className="flex space-x-3 overflow-x-auto pb-2 w-full">
              {[
                { label: "Hot Deals", key: "deals", icon: Sparkles },
                { label: "Pizza", key: "pizza", icon: Pizza },
                { label: "Burgers", key: "burgers", icon: Beef },
                { label: "Sushi", key: "sushi", icon: Fish },
                { label: "Chinese", key: "chinese", icon: Soup },
                { label: "Tacos", key: "mexican", icon: Flame },
                { label: "Breakfast", key: "breakfast", icon: Croissant },
                { label: "Seafood", key: "seafood", icon: Fish },
                { label: "BBQ", key: "bbq", icon: Flame },
                { label: "Desserts", key: "dessert", icon: Cake },
                { label: "Coffee", key: "coffee", icon: Coffee },
                { label: "Healthy", key: "healthy", icon: Salad },
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
                >
                  <chip.icon className="mr-1.5 h-4 w-4" />
                  {chip.label}
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
            <Link href="/scout">
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

      {/* Relevance-first Scout feed */}
      <section className="py-10 border-b border-white/5 bg-black/55">
        <div className="px-6 space-y-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Scout Picks
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-serif font-bold text-white">
                Food that makes sense nearby
              </h2>
              <p className="mt-1 text-sm text-white/40">
                Ranked by local food signal, not general map noise.
              </p>
            </div>
            <Link href="/search">
              <Button variant="ghost" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">
                Search
              </Button>
            </Link>
          </div>

          {publicProfilesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : publicProfilesError ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-red-300">
              <p>Scout signal did not load.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  refetchPublicProfiles();
                  refetchFeaturedDeals();
                }}
              >
                Retry
              </Button>
            </div>
          ) : filteredBusinesses.length > 0 ? (
            <div className="space-y-3">
              {filteredBusinesses.slice(0, 6).map((business, index) => (
                <Link key={business.id} href={`/restaurant/${business.id}`}>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 hover:bg-white/10 transition-all">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-black text-primary">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-bold text-white">
                              {business.name}
                            </h3>
                            <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-widest text-white/35">
                              {business.isFoodTruck
                                ? "Food truck"
                                : business.businessType === "bar"
                                  ? "Bar"
                                  : business.businessType === "private_chef"
                                    ? "Private chef"
                                    : "Restaurant"}
                              {business.cuisineType ? ` · ${business.cuisineType}` : ""}
                            </p>
                          </div>
                          {business.mobileOnline && (
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-primary">
                              Live
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/30">
                          {business.distance != null && Number.isFinite(business.distance) && (
                            <span>{Number(business.distance).toFixed(1)} mi</span>
                          )}
                          {business.activeDealCount > 0 && (
                            <span>{business.activeDealCount} deal{business.activeDealCount === 1 ? "" : "s"}</span>
                          )}
                          {business.favoriteCount > 0 && (
                            <span>{business.favoriteCount} saved</span>
                          )}
                          <span>{business.rankReason}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-7 text-center">
              <p className="text-sm text-white/45">No strong Scout picks here yet.</p>
              <Link href="/contact">
                <Button size="sm" variant="outline" className="mt-4">
                  Recommend a spot
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      <section id="scout-deals-section" className="py-10 border-b border-white/5 bg-black/45">
        <div className="px-6 space-y-8">
          <div>
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Deals
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-serif font-bold text-white">
              Current value nearby
            </h2>
          </div>

          {sortedFeaturedDeals.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
              {sortedFeaturedDeals.slice(0, 8).map((deal) => (
                <Link key={deal.id} href={`/deal/${deal.id}`}>
                  <div className="flex-shrink-0 w-56 rounded-2xl border border-white/10 bg-white/[0.06] p-4 hover:bg-white/10 transition-all">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                      {deal.dealType === "percentage"
                        ? `${deal.discountValue}% off`
                        : `$${deal.discountValue} off`}
                    </span>
                    <h3 className="mt-3 line-clamp-2 text-sm font-bold text-white">
                      {deal.title}
                    </h3>
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/30">
                      {deal.restaurant?.name || "MealScout spot"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/35">
              No active deals posted nearby.
            </div>
          )}

          <div>
            <div className="mb-4 flex items-center gap-2">
              <Sandwich className="w-4 h-4 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Cravings
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Pizza", key: "pizza", icon: Pizza },
                { label: "Burgers", key: "burgers", icon: Beef },
                { label: "Tacos", key: "mexican", icon: Flame },
                { label: "Breakfast", key: "breakfast", icon: Croissant },
                { label: "Seafood", key: "seafood", icon: Fish },
                { label: "Coffee", key: "coffee", icon: Coffee },
                { label: "Healthy", key: "healthy", icon: Salad },
                { label: "Dessert", key: "dessert", icon: Cake },
              ].map((item) => (
                <Button
                  key={item.key}
                  variant="ghost"
                  onClick={() => setActiveCategory(activeCategory === item.key ? null : item.key)}
                  className={`h-14 justify-start rounded-2xl border px-4 ${
                    activeCategory === item.key
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-white/10 bg-white/[0.05] text-white/75 hover:bg-white/10"
                  }`}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 border-b border-white/5 bg-black/60">
        <div className="px-6 space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Community Signal
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-serif font-bold text-white">
                What locals are checking
              </h2>
            </div>
            <Link href="/video">
              <Button variant="ghost" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">
                Stories
              </Button>
            </Link>
          </div>

          {weeklyTrendingVideos.length > 0 ? (
            <div className="space-y-3">
              {weeklyTrendingVideos.slice(0, 4).map((story) => (
                <Link key={story.id} href={`/video/${story.id}`}>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 hover:bg-white/10 transition-all">
                    <p className="text-sm font-bold text-white">
                      {story.title || "Food recommendation"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
                      <span>{story.creatorName || "MealScout user"}</span>
                      <span>{Number(story.viewCount || 0).toLocaleString()} views</span>
                      <span>{Number(story.likeCount || 0).toLocaleString()} likes</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/35">
              No community stories trending yet.
            </div>
          )}

          {geoAds.length > 0 && (
            <div className="pt-2">
              <div className="mb-3 flex items-center gap-2">
                <Store className="h-4 w-4 text-white/35" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                  Sponsored local
                </span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6">
                {geoAds.slice(0, 4).map((ad) => (
                  <button
                    key={ad.id}
                    type="button"
                    onClick={() => handleGeoAdClick(ad)}
                    className="flex-shrink-0 w-60 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/10 transition-all"
                  >
                    <p className="text-sm font-bold text-white">{ad.title}</p>
                    {ad.body && (
                      <p className="mt-2 line-clamp-2 text-xs text-white/40">
                        {ad.body}
                      </p>
                    )}
                    <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-primary">
                      {ad.ctaText || "Open"}
                    </p>
                  </button>
                ))}
              </div>
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

      <section className="py-12 border-b border-white/5 bg-black/80">
        <div className="px-6">
          <div className="mx-auto max-w-xl rounded-2xl border border-primary/20 bg-primary/[0.08] p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <ChefHat className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                  For food businesses
                </p>
                <h3 className="mt-1 text-xl font-serif font-bold text-white">
                  Show up where local food decisions happen.
                </h3>
                <p className="mt-2 text-sm text-white/50">
                  Claim your profile, post deals, go live, and share the same signal to your socials.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/customer-signup?role=business">
                    <Button
                      size="sm"
                      className="bg-primary text-black font-bold"
                      onClick={() => {
                        trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
                          page: "home",
                          cta: "scout_business_claim",
                          destination: "/customer-signup?role=business",
                          role: "business",
                        });
                      }}
                    >
                      Claim business
                    </Button>
                  </Link>
                  <Link href="/share-hub">
                    <Button size="sm" variant="outline">
                      Share MealScout
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
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
              <Link href="/scout">
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






