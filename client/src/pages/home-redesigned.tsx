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

// Premium Home Page Redesign
// Focus: Visual richness, strategic content organization, premium feel
export default function HomeRedesigned() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0];
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [shortLocation, setShortLocation] = useState("Your Location");
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [navigateTo, setNavigateTo] = useState("");
  const [, navigate] = useLocation();

  useEffect(() => {
    if (navigateTo) {
      navigate(navigateTo);
    }
  }, [navigateTo, navigate]);

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
      const locationName = await getReverseGeocodedLocationName(latitude, longitude);
      setShortLocation(locationName);
    } catch (error) {
      console.error("Location error:", error);
    } finally {
      setIsLoadingLocation(false);
    }
  };

  return (
    <>
      <SEOHead title="Food Trucks Near Me | Find Local Restaurants, Bars & Deals | MealScout" />
      <Navigation />

      {/* HERO SECTION - Premium Entry Point */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[color:var(--bg-surface)] via-[color:var(--bg-surface)] to-[color:var(--accent-text)]/5 pt-16 pb-24">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[color:var(--accent-text)]/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-[color:var(--accent-text)]/5 rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
          {/* Hero Content */}
          <div className="mb-12">
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
              Discover live food trucks, trending deals, and local gems happening right now {shortLocation === "Your Location" ? "near you" : `in ${shortLocation}`}
            </p>
          </div>

          {/* Premium Search Bar */}
          <div className="mb-8 max-w-2xl">
            <div className="relative group">
              <SmartSearch
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={(query) =>
                  setNavigateTo(`/search?q=${encodeURIComponent(query)}`)
                }
                placeholder="Search food trucks, deals, restaurants..."
                className="shadow-lg group-hover:shadow-xl transition-shadow"
              />
              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-[color:var(--accent-text)]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            </div>
          </div>

          {/* Quick Actions - Horizontal Layout */}
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

      {/* LIVE ACTIVITY SECTION - Real-time engagement */}
      <section className="py-16 bg-[color:var(--bg-surface)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {/* Live Trucks Card */}
            <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-8 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-lg bg-[color:var(--accent-text)]/20">
                  <Truck className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[color:var(--status-success)] animate-pulse"></span>
                  <span className="text-sm font-bold text-[color:var(--status-success)]">LIVE NOW</span>
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-2">Food Trucks</h3>
              <p className="text-muted-foreground mb-6">Open right now, ready to serve</p>
              <Link href="/map">
                <Button variant="outline" className="w-full">
                  View Live Map
                </Button>
              </Link>
            </div>

            {/* Trending Deals Card */}
            <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-8 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-lg bg-[color:var(--accent-text)]/20">
                  <TrendingUp className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[color:var(--accent-text)]">TRENDING</span>
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-2">Hot Deals</h3>
              <p className="text-muted-foreground mb-6">Most popular offers this week</p>
              <Link href="/deals/featured">
                <Button variant="outline" className="w-full">
                  Browse Deals
                </Button>
              </Link>
            </div>

            {/* Community Card */}
            <div className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-8 hover:border-[color:var(--accent-text)]/50 hover:shadow-lg transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-lg bg-[color:var(--accent-text)]/20">
                  <Sparkles className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[color:var(--accent-text)]">COMMUNITY</span>
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-2">Local Gems</h3>
              <p className="text-muted-foreground mb-6">Top-rated spots near you</p>
              <Link href="/category/pizza">
                <Button variant="outline" className="w-full">
                  Explore
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CUISINE CATEGORIES - Visual Grid */}
      <section className="py-16 bg-gradient-to-b from-transparent to-[color:var(--accent-text)]/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-12">
            <h2 className="text-4xl font-bold mb-2">Explore by Cuisine</h2>
            <p className="text-lg text-muted-foreground">Find exactly what you're craving</p>
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

      {/* CALL TO ACTION SECTION */}
      <section className="py-16 bg-[color:var(--bg-surface)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-8">
            {/* For Businesses */}
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-12 hover:shadow-lg transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-lg bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Store className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-3xl font-bold mb-2">For Businesses</h3>
                <p className="text-muted-foreground">Get discovered by hungry customers in your area</p>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3 text-sm">
                  <Zap className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Post deals and broadcast your location
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <TrendingUp className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Reach customers ready to buy
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <Clock className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Go live in minutes
                </li>
              </ul>
              <Link href="/customer-signup?role=business">
                <Button className="action-primary w-full">
                  Start Free Trial
                </Button>
              </Link>
            </div>

            {/* For Diners */}
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-[var(--bg-card)] to-[color:var(--accent-text)]/5 p-12 hover:shadow-lg transition-all">
              <div className="mb-6">
                <div className="w-12 h-12 rounded-lg bg-[color:var(--accent-text)]/20 flex items-center justify-center mb-4">
                  <Heart className="w-6 h-6 text-[color:var(--accent-text)]" />
                </div>
                <h3 className="text-3xl font-bold mb-2">For Diners</h3>
                <p className="text-muted-foreground">Discover amazing food happening around you</p>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Real-time food truck locations
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <Sparkles className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Trending deals and recommendations
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <Bell className="w-4 h-4 text-[color:var(--accent-text)]" />
                  Get notified when favorites are nearby
                </li>
              </ul>
              <Link href="/customer-signup">
                <Button variant="outline" className="w-full">
                  Create Account
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
