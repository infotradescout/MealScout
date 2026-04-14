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
} from "lucide-react";
import mealScoutLogo from "@assets/meal-scout-icon.png";
import { useFoodTruckSocket } from "@/hooks/useFoodTruckSocket";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { sendGeoPing, trackGeoAdEvent, trackGeoAdImpression } from "@/utils/geoAds";
import { SEOHead } from "@/components/seo-head";
import { SEOInternalLinks } from "@/components/seo-internal-links";
import { trackUxEvent } from "@/utils/uxTelemetry";
import { useIsStandalone } from "@/hooks/useIsStandalone";

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

interface BusinessDealsSummary {
  id: string;
  name: string;
  cuisineType?: string;
  businessType?: string;
  isFoodTruck?: boolean;
  distance?: number;
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
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean hover:shadow-clean-lg transition-shadow">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground truncate">
              {business.name}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {business.cuisineType || businessTypeLabel}
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {businessTypeLabel}
          </span>
        </div>

        {distanceLabel && (
          <p className="mt-2 text-xs text-muted-foreground">{distanceLabel}</p>
        )}

        <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Active Deals ({business.deals.length})
          </p>
          {business.deals.length > 0 ? (
            <div className="mt-1 space-y-1.5">
              {business.deals.slice(0, compact ? 1 : 2).map((deal) => (
                <p key={deal.id} className="text-xs text-foreground line-clamp-1">
                  {deal.title}
                </p>
              ))}
              {business.deals.length > (compact ? 1 : 2) && (
                <p className="text-[11px] text-muted-foreground">
                  +{business.deals.length - (compact ? 1 : 2)} more
                </p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No active deals yet
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
    isLoading: featuredLoading,
    isError: featuredError,
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

  const featuredBusinesses = useMemo(() => {
    const grouped = new Map<string, BusinessDealsSummary>();
    sortedFeaturedDeals.forEach((deal) => {
      const key = String(deal.restaurantId || "").trim();
      if (!key) return;
      const existing = grouped.get(key);
      if (existing) {
        existing.deals.push(deal);
        if (
          typeof deal.distance === "number" &&
          Number.isFinite(deal.distance) &&
          (existing.distance == null || deal.distance < existing.distance)
        ) {
          existing.distance = deal.distance;
        }
        return;
      }

      grouped.set(key, {
        id: key,
        name: deal.restaurant?.name || "Local Spot",
        cuisineType: deal.restaurant?.cuisineType,
        businessType: deal.restaurant?.businessType,
        isFoodTruck: deal.restaurant?.isFoodTruck,
        distance: deal.distance,
        deals: [deal],
      });
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const aDistance = a.distance ?? Number.POSITIVE_INFINITY;
      const bDistance = b.distance ?? Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });
  }, [sortedFeaturedDeals]);

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
            name: "Featured Local Deals",
            numberOfItems: sortedFeaturedDeals.slice(0, 10).length,
            itemListElement: sortedFeaturedDeals.slice(0, 10).map((deal: Deal, index: number) => ({
              "@type": "ListItem",
              position: index + 1,
              name: deal.title,
              url: `${typeof window !== "undefined" ? window.location.origin : "https://www.mealscout.us"}/deal/${deal.id}`,
            })),
          },
        },
      ],
    }),
    [sortedFeaturedDeals],
  );

  return (
    <div className="page relative overflow-hidden home-cinematic pb-12">
      <SEOHead
        title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout"
        description="Find food trucks, restaurants, and bars near you. Discover live locations, local specials, and deals in your city — all on MealScout."
        keywords="food trucks near me, food truck finder, local restaurants near me, food truck map, local food deals, restaurant specials near me, food truck events near me, find food near me"
        canonicalUrl="https://www.mealscout.us/"
        schemaData={homeSchemaData}
      />
      <Navigation />

      {/* Header with Logo and Navigation */}
      <header className="section section--full bg-[var(--bg-card)] border-b border-[color:var(--border-subtle)] sticky top-0 z-10 shadow-clean">
        <div className="content flex items-center justify-between py-3">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div className="w-14 h-14 flex items-center justify-center overflow-hidden">
              <img
                src={mealScoutLogo}
                alt="MealScout Logo"
                className="w-full h-full object-contain object-center"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {!isStandalone && (
              <Link href="/install">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Install app"
                  aria-label="Install app"
                >
                  <ArrowDownToLine className="w-5 h-5" />
                </Button>
              </Link>
            )}
            {!user ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setNavigateTo("/login")}
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Login"
                  aria-label="Log in"
                >
                  <LogIn className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setNavigateTo("/customer-signup")}
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Customer Sign Up"
                  aria-label="Customer sign up"
                >
                  <UserPlus className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setNavigateTo("/customer-signup?role=business")
                  }
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Restaurant/Bar/Food Truck Sign Up"
                  aria-label="Business sign up"
                >
                  <Store className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={retryLocation}
                  disabled={isLoadingLocation}
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Refresh Location"
                  aria-label="Refresh location"
                >
                  {isLoadingLocation ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Target className="w-4 h-4" />
                  )}
                </Button>
              </>
            ) : (
              <div className="flex items-center space-x-2">
                <span className="hidden sm:inline text-sm font-medium text-secondary">
                  {locationName.split(",")[0]}
                </span>
                <div
                  className="w-2 h-2 rounded-full bg-[color:var(--status-success)]"
                  title="Real-time location active"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={retryLocation}
                  disabled={isLoadingLocation}
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
                  title="Refresh Location"
                  aria-label="Refresh location"
                >
                  {isLoadingLocation ? (
                    <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Target className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero & Search Section */}
      <section className="section section--full section--surface border-b border-[color:var(--border-subtle)] py-3">
        <div className="content">
          <div className="home-hero-panel">
            <div className="mb-3">
              <h1 className="hero-title text-xl mb-1">
                {firstName ? `Hey ${firstName}, hungry?` : "Hungry?"}
              </h1>
              <p className="hero-subtitle text-sm">
                See what's happening{" "}
                {shortLocation === "Your Location"
                  ? "near you"
                  : `in ${shortLocation}`}
                . Fresh deals and local favorites.
              </p>
            </div>

            <SmartSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(query) =>
                setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
              }
              className="mb-6 shadow-clean-lg"
              placeholder="Search deals, restaurants..."
            />

            <div className="mb-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={retryLocation}
                disabled={isLoadingLocation}
                data-testid="button-home-use-location"
                onPointerDown={() => {
                  trackUxEvent("home_location_request_quick", {
                    surface: "home_quick_actions",
                  });
                }}
              >
                <MapPin className="w-4 h-4 mr-1" />
                {isLoadingLocation ? "Locating..." : "Use location"}
              </Button>
              <Link href="/map">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  data-testid="button-home-open-map"
                  onPointerDown={() => {
                    trackUxEvent("home_open_map_quick", {
                      surface: "home_quick_actions",
                    });
                  }}
                >
                  <MapIcon className="w-4 h-4 mr-1" />
                  Open map
                </Button>
              </Link>
              <Link href="/deals/featured">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  data-testid="button-home-featured"
                  onPointerDown={() => {
                    trackUxEvent("home_open_featured_quick", {
                      surface: "home_quick_actions",
                    });
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  Featured
                </Button>
              </Link>
            </div>

            {geoAds.length > 0 && (
              <div className="mb-5">
                {geoAds.map((ad) => (
                  <div
                    key={ad.id}
                    className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean"
                  >
                    {ad.mediaUrl && (
                      <img
                        src={ad.mediaUrl}
                        alt={ad.title}
                        className="w-full h-40 object-cover rounded-xl mb-3"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Sponsored
                    </div>
                    <div className="text-base font-semibold text-foreground mt-1">
                      {ad.title}
                    </div>
                    {ad.body && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {ad.body}
                      </p>
                    )}
                    <div className="mt-3">
                      <Button size="sm" onClick={() => handleGeoAdClick(ad)}>
                        {ad.ctaText || "Learn more"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filter Chips */}
            <div className="flex space-x-2 overflow-x-auto pb-1">
              <Link href="/deals/featured">
                <Button
                  className="filter-pill filter-pill--active flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-semibold shadow-clean hover:shadow-clean-lg transition-all"
                  size="sm"
                >
                  <Sparkles className="w-4 h-4 mr-1.5" />  Hot Deals
                </Button>
              </Link>
              <Link href="/category/pizza">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Pizza
                </Button>
              </Link>
              <Link href="/category/burgers">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Burgers
                </Button>
              </Link>
              <Link href="/category/sushi">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Sushi
                </Button>
              </Link>
              <Link href="/category/chinese">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Chinese
                </Button>
              </Link>
              <Link href="/category/mexican">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Tacos
                </Button>
              </Link>
              <Link href="/category/breakfast">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Breakfast
                </Button>
              </Link>
              <Link href="/category/seafood">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Seafood
                </Button>
              </Link>
              <Link href="/category/bbq">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   BBQ
                </Button>
              </Link>
              <Link href="/category/dessert">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Desserts
                </Button>
              </Link>
              <Link href="/category/coffee">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Coffee
                </Button>
              </Link>
              <Link href="/category/healthy">
                <Button
                  variant="outline"
                  size="sm"
                  className="filter-pill flex-shrink-0 rounded-full px-3.5 py-2 text-sm sm:text-base font-medium"
                >
                   Healthy
                </Button>
              </Link>
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
                  className="mt-2 text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
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

      {/* Food Trucks Nearby - Horizontal Scroll Row */}
      <section className="section section--full section--surface-2 border-y border-[color:var(--border-subtle)] py-3">
        <div className="content">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-[color:var(--accent-text)]" />
              <h3 className="text-sm font-bold text-foreground">
                Live Trucks:{" "}
                {shortLocation === "Your Location" ? "Nearby" : shortLocation}
              </h3>
            </div>
            <Link href="/map">
              <Button
                variant="link"
                className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)] p-0 h-auto text-xs"
              >
                View Map {"->"}
              </Button>
            </Link>
          </div>
          {liveTrucksLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-6 px-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-60 h-40 rounded-xl bg-[var(--bg-surface-muted)]/70 animate-pulse"
                />
              ))}
            </div>
          ) : liveTrucksError ? (
            <div className="text-center py-6 text-[color:var(--status-error)] text-sm">
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
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-6 px-6">
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
                    <div className="flex-shrink-0 w-60 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean hover:shadow-clean-lg transition-shadow">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-foreground truncate">
                            {truck.name}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {truck.cuisineType || "Food Truck"}
                          </p>
                        </div>
                        <span className="rounded-full bg-[color:var(--status-success)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--status-success)]">
                          Live
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                          {distanceMiles != null
                            ? `${distanceMiles.toFixed(1)} mi away`
                            : "Nearby"}
                        </span>
                        <span>{lastSeenLabel}</span>
                      </div>

                      <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Active Deals ({truckDeals.length})
                        </p>
                        {truckDeals.length > 0 ? (
                          <div className="mt-1 space-y-1.5">
                            {truckDeals.slice(0, 2).map((deal) => (
                              <p
                                key={deal.id}
                                className="text-xs text-foreground line-clamp-1"
                              >
                                {deal.title}
                              </p>
                            ))}
                            {truckDeals.length > 2 && (
                              <p className="text-[11px] text-muted-foreground">
                                +{truckDeals.length - 2} more
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            No active deals yet
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

      {/* Featured Deals Section - ORIGINAL LAYOUT */}
      <section className="section section--full border-y border-[color:var(--border-subtle)] py-3">
        <div className="content">
          <div className="mb-3">
            <h2 className="text-base font-bold text-foreground flex items-center">
              <Sparkles className="w-4 h-4 text-[color:var(--accent-text)] mr-1.5" />
              Trending in{" "}
              {shortLocation === "Your Location"
                ? "Your Neighborhood"
                : shortLocation}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fast-moving offers from spots around you
            </p>
            <Link href="/deals/featured">
              <Button
                variant="link"
                className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)] p-0 h-auto mt-1"
              >
                See all nearby deals {"->"}
              </Button>
            </Link>
          </div>

          {featuredLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-6 px-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-56 bg-[var(--bg-surface-muted)]/60 rounded-lg h-48 animate-pulse"
                />
              ))}
            </div>
          ) : featuredError ? (
            <div className="text-center py-8 text-[color:var(--status-error)] text-sm">
              <p>We couldn't load deals right now. Try again in a bit.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetchFeaturedDeals()}
              >
                Retry Deals
              </Button>
            </div>
          ) : featuredBusinesses.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-6 px-6">
              {featuredBusinesses.map((business) => (
                <div key={business.id} className="flex-shrink-0 w-64">
                  <BusinessDealsCard business={business} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-3">No deals nearby yet</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/map">
                  <Button size="sm" variant="outline">
                    Open Map
                  </Button>
                </Link>
                <Link href="/deals/featured">
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

      <section className="section section--full section--surface py-3">
        <div className="content">
          <SEOInternalLinks
            title={`What's Popular ${shortLocation === "Your Location" ? "Near You" : `in ${shortLocation}`}`}
            description="Popular food spots and cuisines people are checking out in your area."
            maxCities={8}
            maxCuisineLinksPerCity={2}
          />
        </div>
      </section>

      {/* Owner Section - MOVED UP FOR LOGGED OUT USERS */}
      {!user && (
        <section className="section section--full section--surface-2 py-2 text-foreground">
          <div className="content text-center">
            <ChefHat className="w-6 h-6 mx-auto mb-1 text-[color:var(--accent-text)]" />
            <h3 className="text-base font-bold mb-0.5">
              Bring your restaurant to the neighborhood
            </h3>
            <p className="text-secondary mb-2 text-xs">
              Post real-time deals, broadcast when you're open, reach people
              nearby
            </p>
            <Link href="/customer-signup?role=business">
              <Button
                size="sm"
                variant="secondary"
                className="px-3 py-1 text-xs"
              >
                Claim & Go Live
              </Button>
            </Link>
          </div>
        </section>
      )}

      {/* TWO-COLUMN SECTIONS - SIDE BY SIDE */}
      <section className="section section--full border-y border-[color:var(--border-subtle)] py-4">
        <div className="content">
          {!user ? (
            /* LOGGED OUT - TWO SECTIONS SIDE BY SIDE */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Stay Connected Section */}
              <div>
                <div className="text-center mb-6">
              <h3 className="text-lg font-bold text-foreground mb-2">
                Unlock the{" "}
                    {shortLocation === "Your Location"
                      ? "Local"
                      : shortLocation}{" "}
                    Scene
                  </h3>
              <p className="text-sm text-muted-foreground">
                Save go-tos, track trucks live, and get a heads-up when
                spots reopen
              </p>
            </div>

                <div className="space-y-2 mb-4">
                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-center gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <Heart className="w-4 h-4 text-[color:var(--accent-text)]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs">
                        {shortLocation === "Your Location"
                          ? "Neighborhood"
                          : shortLocation}{" "}
                        favorites
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Keep your go-tos one tap away
                      </p>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-center gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <Truck className="w-4 h-4 text-[color:var(--accent-text)]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs">
                        Food trucks{" "}
                        {shortLocation === "Your Location"
                          ? "nearby"
                          : `in ${shortLocation}`}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Live locations around you
                      </p>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-center gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <Bell className="w-4 h-4 text-[color:var(--accent-text)]" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs">
                        Deals{" "}
                        {shortLocation === "Your Location"
                          ? "nearby"
                          : `in ${shortLocation}`}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Quick wins close to you
                      </p>
                    </div>
                  </div>
                </div>

                <Link href="/customer-signup">
                  <Button className="w-full text-xs font-medium">
                    Create free account
                  </Button>
                </Link>
              </div>

              {/* Community Building Section */}
              <div>
                <div className="text-center mb-4">
                  <h3 className="text-base font-bold text-foreground mb-1">
                    Promote{" "}
                    {shortLocation === "Your Location"
                      ? "Local"
                      : shortLocation}{" "}
                    Gems
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Pass along great spots and help them stay busy
                  </p>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-start gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-[color:var(--accent-text)] font-bold text-xs">
                        1
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs mb-0.5">
                        Share Your Link
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Get a unique referral link to share with restaurants
                      </p>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-start gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-[color:var(--accent-text)] font-bold text-xs">
                        2
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs mb-0.5">
                        Restaurant Subscribes
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        When they join, you become their community partner
                      </p>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-card)] p-3 rounded-xl border border-[color:var(--border-subtle)] flex items-start gap-3">
                    <div className="w-8 h-8 bg-[var(--bg-surface-muted)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-[color:var(--accent-text)] font-bold text-xs">
                        3
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground text-xs mb-0.5">
                        Earn Recurring Income
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Receive commission as long as they remain active
                      </p>
                    </div>
                  </div>
                </div>

                <Link href={user ? "/affiliate-dashboard" : "/customer-signup"}>
                  <Button className="w-full text-xs font-medium">
                    {user ? "Community Builder Dashboard" : "Start Building"}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="max-w-[520px] mx-auto">
              <h3 className="text-lg font-bold text-foreground mb-4">
                Deals Nearby
              </h3>

              {featuredLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-40 rounded-xl bg-[var(--bg-surface-muted)]/60 animate-pulse"
                    />
                  ))}
                </div>
              ) : featuredError ? (
                <div className="text-center py-8 text-[color:var(--status-error)] text-sm">
                  <p>We couldn't load deals right now. Try again in a bit.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => refetchFeaturedDeals()}
                  >
                    Retry Deals
                  </Button>
                </div>
              ) : featuredBusinesses.length > 0 ? (
                <div className="space-y-3">
                  {featuredBusinesses.map((business) => (
                    <BusinessDealsCard
                      key={business.id}
                      business={business}
                      compact
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted bg-surface-muted rounded-lg border border-dashed border-subtle">
                  <p className="text-sm">No deals nearby yet.</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Link href="/map">
                      <Button size="sm" variant="outline">
                        Open Map
                      </Button>
                    </Link>
                    <Link href="/deals/featured">
                      <Button size="sm" variant="outline">
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

      {/* Footer */}
      <footer className="section section--full border-t border-[color:var(--border-subtle)] py-4">
        <div className="content">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground">Product</h4>
              <Link
                href="/how-it-works"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                How It Works
              </Link>
              <Link
                href="/faq"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                FAQ
              </Link>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground">Company</h4>
              <Link
                href="/about"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                About
              </Link>
              <Link
                href="/contact"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                Contact
              </Link>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground">Legal</h4>
              <Link
                href="/privacy-policy"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                Privacy
              </Link>
              <Link
                href="/terms-of-service"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                Terms
              </Link>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground">Support</h4>
              <Link
                href="/faq"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                Help Center
              </Link>
              <Link
                href="/status"
                className="block text-muted-foreground hover:text-[color:var(--accent-text)]"
              >
                Status
              </Link>
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground border-t border-[color:var(--border-subtle)] pt-4 mt-5">
            <p>&copy; 2026 MealScout. A TradeScout Product.</p>
          </div>
        </div>
      </footer>

      {!location && !showWelcomeModal && (
        <section className="section section--full md:hidden pb-4">
          <div className="content">
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean">
              <p className="text-xs text-muted-foreground mb-2">
                Turn on location to unlock nearby deals and live map updates.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={retryLocation}
                  disabled={isLoadingLocation}
                  data-testid="button-home-inline-location"
                  onPointerDown={() => {
                    trackUxEvent("home_location_request_inline", {
                      surface: "home_inline_cta",
                    });
                  }}
                >
                  {isLoadingLocation ? "Locating..." : "Use location"}
                </Button>
                <Link href="/map">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    data-testid="button-home-inline-map"
                    onPointerDown={() => {
                      trackUxEvent("home_open_map_inline", {
                        surface: "home_inline_cta",
                      });
                    }}
                  >
                    Open map
                  </Button>
                </Link>
              </div>
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






