import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Star, SlidersHorizontal, Filter } from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import {
  sendGeoPing,
  trackGeoAdEvent,
  trackGeoAdImpression,
} from "@/utils/geoAds";

interface GeoAd {
  id: string;
  title: string;
  body?: string | null;
  mediaUrl?: string | null;
  targetUrl: string;
  ctaText?: string | null;
}

export default function FeaturedDealsPage() {
  const [adLocation, setAdLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAdLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setAdLocation(null);
      },
      { enableHighAccuracy: false, timeout: 6000 },
    );
  }, []);

  const { data: featuredDeals, isLoading } = useQuery({
    queryKey: ["/api/deals/featured"],
    enabled: true,
  });

  const { data: geoAds = [] } = useQuery<GeoAd[]>({
    queryKey: ["/api/geo-ads", "deals", adLocation?.lat, adLocation?.lng],
    enabled: !!adLocation,
    queryFn: async () => {
      if (!adLocation) return [];
      const res = await fetch(
        `/api/geo-ads?placement=deals&lat=${adLocation.lat}&lng=${adLocation.lng}&limit=1`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  useEffect(() => {
    if (!adLocation) return;
    sendGeoPing({ lat: adLocation.lat, lng: adLocation.lng, source: "deals" });
  }, [adLocation?.lat, adLocation?.lng]);

  useEffect(() => {
    if (!geoAds.length) return;
    geoAds.forEach((ad) =>
      trackGeoAdImpression({ adId: ad.id, placement: "deals" }),
    );
  }, [geoAds]);

  const allDeals = Array.isArray(featuredDeals) ? featuredDeals : [];

  const handleGeoAdClick = (ad: GeoAd) => {
    trackGeoAdEvent({ adId: ad.id, eventType: "click", placement: "deals" });
    window.open(ad.targetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title="Time-Sensitive Specials - MealScout | Nearby Limited-Time Offers"
        description="Discover time-sensitive food specials near you. Limited-time offers from local restaurants, sorted by proximity."
        keywords="limited time food deals, nearby restaurant specials, today food discounts, local meal promotions, food deals near me"
        canonicalUrl="https://www.mealscout.us/deals/featured"
      />
      {/* Header */}
      <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean">
        <div className="flex items-center mb-6">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="mr-3 -ml-2"
              data-testid="button-back-featured"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gradient-to-r from-[color:var(--accent-text)] to-[color:var(--status-error)] rounded-lg flex items-center justify-center mr-3 shadow-clean">
              <Star className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Time-Sensitive Specials Nearby
              </h1>
              <p className="text-sm text-muted-foreground">
                Limited-time offers from nearby restaurants (distance-based)
              </p>
            </div>
          </div>
        </div>

        {/* Filter & Sort */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {allDeals.length} time-sensitive special
            {allDeals.length !== 1 ? "s" : ""}
          </div>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="button-sort-featured"
            >
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Sort
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-filter-featured"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-4 sm:px-6 py-6">
        {geoAds.length > 0 && (
          <div className="mb-6">
            {geoAds.map((ad) => (
              <div
                key={ad.id}
                className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-card)] p-4 shadow-clean"
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

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-[var(--bg-card)] rounded-2xl overflow-hidden animate-pulse shadow-clean border border-[color:var(--border-subtle)]"
              >
                <div className="w-full h-48 bg-muted"></div>
                <div className="p-6 space-y-3">
                  <div className="h-6 bg-muted rounded-lg w-3/4"></div>
                  <div className="h-4 bg-muted rounded-lg w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : allDeals.length > 0 ? (
          <div className="space-y-4 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-6 lg:space-y-0">
            {allDeals.map((deal: any) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-[color:var(--accent-text)]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Star className="w-8 h-8 text-[color:var(--accent-text)]" />
            </div>
            <h3 className="font-bold text-lg text-foreground mb-2">
              No time-sensitive specials yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Check back soon for nearby limited-time offers from local
              restaurants!
            </p>
            <Link href="/search">
              <Button data-testid="button-browse-all-featured">
                Browse All Specials
              </Button>
            </Link>
            <div className="mt-2">
              <Link href="/map">
                <Button
                  variant="outline"
                  data-testid="button-open-map-featured"
                >
                  Open Map
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      <Navigation />
    </div>
  );
}
