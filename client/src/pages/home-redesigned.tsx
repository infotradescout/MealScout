import { queryClient } from "@/lib/queryClient";
import { fetchJsonWithRetry } from "@/lib/resilientFetch";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import SmartSearch from "@/components/smart-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
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
  MapPinCheck,
} from "lucide-react";
import mealScoutLogo from "@assets/meal-scout-icon.png";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import { trackUxEvent } from "@/utils/uxTelemetry";

interface LiveTruck {
  id: string;
  name: string;
  cuisineType?: string;
  address?: string;
  distance?: number;
  activeDealCount?: number;
  mobileOnline?: boolean;
}

interface Deal {
  id: string;
  title: string;
  discount?: number;
  description?: string;
}

interface BusinessDealsSummary {
  id: string;
  name: string;
  address?: string;
  cuisineType?: string;
  businessType?: string;
  isFoodTruck?: boolean;
  distance?: number;
  activeDealCount: number;
  deals: Deal[];
}

// Premium Home Page with Featured Trucks & Restaurants
export default function HomeRedesigned() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0];
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("Your Location");
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [navigateTo, setNavigateTo] = useState("");
  const [, navigate] = useLocation();

  useEffect(() => {
    if (navigateTo) {
      navigate(navigateTo);
    }
  }, [navigateTo, navigate]);

  // Fetch live trucks
  const {
    data: liveTrucksData,
    isLoading: liveTrucksLoading,
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
  });

  const liveTrucks = useMemo(() => {
    if (Array.isArray(liveTrucksData)) return liveTrucksData;
    if (Array.isArray(liveTrucksData?.trucks)) return liveTrucksData.trucks;
    return [];
  }, [liveTrucksData]);

  // Fetch featured businesses with deals
  const {
    data: featuredBusinesses = [],
    isLoading: featuredLoading,
  } = useQuery<BusinessDealsSummary[]>({
    queryKey: location
      ? ["/api/businesses/featured", location.lat, location.lng]
      : ["/api/businesses/featured", "no-location"],
    enabled: !!location,
    queryFn: async () => {
      if (!location) return [];
      const response = await fetch(
        `/api/deals/featured?lat=${location.lat}&lng=${location.lng}&limit=12`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  const retryLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
        });
      });
      const { latitude, longitude } = position.coords;
      setLocation({ lat: latitude, lng: longitude });
      await getReverseGeocodedLocationName(latitude, longitude, setLocationName);
    } catch (error) {
      console.error("Location error:", error);
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const shortLocation = locationName?.split(",")[0] || "Your Location";

  return (
    <>
      <SEOHead title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout" description="Discover food trucks, restaurants, and bars near you. Browse menus, find deals, and book parking spots with MealScout." />
      <Navigation />

      {/* HERO SECTION */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[color:var(--bg-surface)] via-[color:var(--bg-surface)] to-[color:var(--accent-text)]/5 pt-16 pb-12">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[color:var(--accent-text)]/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-[color:var(--accent-text)]/5 rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-5xl sm:text-6xl font-black mb-4 leading-tight tracking-tight">
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
            <p className="text-xl text-muted-foreground max-w-2xl">
              Live food trucks, trending deals, and local gems happening right now
            </p>
          </div>

          {/* Premium Search Bar */}
          <div className="mb-6 max-w-2xl">
            <SmartSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(query) =>
                setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
              }
              placeholder="Search food trucks, deals, restaurants..."
              className="shadow-lg"
            />
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={retryLocation}
              disabled={isLoadingLocation}
              className="action-primary"
              size="lg"
            >
              <MapPin className="w-5 h-5 mr-2" />
              {isLoadingLocation ? "Finding location..." : "Use My Location"}
            </Button>
            <Link href="/map">
              <Button variant="outline" size="lg">
                <MapIcon className="w-5 h-5 mr-2" />
                View Map
              </Button>
            </Link>
            <Link href="/deals/featured">
              <Button variant="outline" size="lg">
                <Zap className="w-5 h-5 mr-2" />
                Hot Deals
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* LIVE FOOD TRUCKS SECTION - Featured Content */}
      {liveTrucks.length > 0 && (
        <section className="py-16 bg-[color:var(--bg-surface)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 rounded-lg bg-[color:var(--accent-text)]/20">
                  <Truck className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold">Live Food Trucks</h2>
                  <p className="text-sm text-muted-foreground">Open right now in {shortLocation}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveTrucks.slice(0, 6).map((truck) => (
                <Link key={truck.id} href={`/restaurant/${truck.id}`}>
                  <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-6 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all cursor-pointer">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2">
                          {truck.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {truck.cuisineType || "Food Truck"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2">
                        <span className="w-2 h-2 rounded-full bg-[color:var(--status-success)] animate-pulse"></span>
                        <span className="text-xs font-bold text-[color:var(--status-success)]">LIVE</span>
                      </div>
                    </div>
                    {truck.address && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                        <MapPinCheck className="w-3.5 h-3.5" />
                        <span className="line-clamp-1">{truck.address}</span>
                      </div>
                    )}
                    {truck.distance && (
                      <div className="text-xs text-muted-foreground">
                        {truck.distance.toFixed(1)} mi away
                      </div>
                    )}
                    {truck.activeDealCount && truck.activeDealCount > 0 && (
                      <div className="mt-4 pt-4 border-t border-[color:var(--border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-[color:var(--accent-text)]" />
                          <span className="text-sm font-semibold text-[color:var(--accent-text)]">
                            {truck.activeDealCount} active deal{truck.activeDealCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {liveTrucks.length > 6 && (
              <div className="mt-8 text-center">
                <Link href="/map">
                  <Button variant="outline" size="lg">
                    View All {liveTrucks.length} Trucks on Map
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* FEATURED DEALS & RESTAURANTS SECTION */}
      {featuredBusinesses.length > 0 && (
        <section className="py-16 bg-gradient-to-b from-transparent to-[color:var(--accent-text)]/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 rounded-lg bg-[color:var(--accent-text)]/20">
                  <TrendingUp className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold">Trending Now</h2>
                  <p className="text-sm text-muted-foreground">Hot deals and popular spots</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {featuredBusinesses.slice(0, 9).map((business) => (
                <Link key={business.id} href={`/restaurant/${business.id}`}>
                  <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-6 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all cursor-pointer">
                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2">
                        {business.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {business.cuisineType || (business.isFoodTruck ? "Food Truck" : "Restaurant")}
                      </p>
                    </div>

                    {business.address && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                        <MapPinCheck className="w-3.5 h-3.5" />
                        <span className="line-clamp-1">{business.address}</span>
                      </div>
                    )}

                    {business.distance && (
                      <div className="text-xs text-muted-foreground mb-4">
                        {business.distance.toFixed(1)} mi away
                      </div>
                    )}

                    {business.deals && business.deals.length > 0 && (
                      <div className="space-y-2 pt-4 border-t border-[color:var(--border-subtle)]">
                        {business.deals.slice(0, 2).map((deal) => (
                          <div key={deal.id} className="flex items-start gap-2">
                            <Zap className="w-4 h-4 text-[color:var(--accent-text)] flex-shrink-0 mt-0.5" />
                            <span className="text-xs line-clamp-2">{deal.title}</span>
                          </div>
                        ))}
                        {business.deals.length > 2 && (
                          <p className="text-xs text-muted-foreground">
                            +{business.deals.length - 2} more deal{business.deals.length - 2 !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {featuredBusinesses.length > 9 && (
              <div className="mt-8 text-center">
                <Link href="/deals/featured">
                  <Button variant="outline" size="lg">
                    View All {featuredBusinesses.length} Deals
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* CUISINE CATEGORIES */}
      <section className="py-16 bg-[color:var(--bg-surface)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Explore by Cuisine</h2>
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
                <div className="group rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 hover:border-[color:var(--accent-text)]/50 hover:shadow-md transition-all cursor-pointer">
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-3 rounded-lg bg-[color:var(--accent-text)]/15 group-hover:bg-[color:var(--accent-text)]/25 transition-colors">
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

      {/* CTA SECTION */}
      <section className="py-16 bg-gradient-to-b from-transparent to-[color:var(--accent-text)]/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-12 hover:shadow-lg transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-lg bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Store className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-3xl font-bold mb-2">For Businesses</h3>
                <p className="text-muted-foreground">Join today and get 30 days free access to optional Growth Tools.</p>
              </div>
              <Link href="/customer-signup?role=business">
                <Button className="action-primary w-full">Join</Button>
              </Link>
            </div>

            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-12 hover:shadow-lg transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-lg bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Heart className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-3xl font-bold mb-2">For Diners</h3>
                <p className="text-muted-foreground">Discover amazing food near you</p>
              </div>
              <Link href="/customer-signup">
                <Button variant="outline" className="w-full">Create Account</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
