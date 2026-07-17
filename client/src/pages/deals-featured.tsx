import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import DealCard from "@/components/deal-card";
import {
  CollectionLoadingState,
  CollectionState,
  ConsumerCollectionShell,
} from "@/components/consumer-collection-shell";
import { Button } from "@/components/ui/button";
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
      () => setAdLocation(null),
      { enableHighAccuracy: false, timeout: 6000 },
    );
  }, []);

  const {
    data: featuredDeals,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["/api/deals/featured"],
  });

  const { data: geoAds = [] } = useQuery<GeoAd[]>({
    queryKey: ["/api/geo-ads", "deals", adLocation?.lat, adLocation?.lng],
    enabled: Boolean(adLocation),
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
  }, [adLocation]);

  useEffect(() => {
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
    <ConsumerCollectionShell
      section="deals"
      title="Deals"
      description="Current offers from local food businesses, with the details you need before you go."
      icon={Flame}
      countLabel={
        isLoading
          ? null
          : `${allDeals.length} active ${allDeals.length === 1 ? "deal" : "deals"}`
      }
    >
      <SEOHead
        title="Local Food Deals | MealScout"
        description="Browse current offers from local restaurants, food trucks, and food businesses on MealScout."
        keywords="local food deals, restaurant specials, food truck deals"
        canonicalUrl="https://www.mealscout.us/deals"
      />

      {geoAds.length > 0 ? (
        <aside aria-label="Sponsored" className="mb-6">
          {geoAds.map((ad) => (
            <div
              key={ad.id}
              className="grid overflow-hidden rounded-[1.5rem] border border-[#683a1f]/15 bg-white/[0.92] shadow-[0_18px_45px_rgba(102,50,21,0.07)] sm:grid-cols-[12rem_minmax(0,1fr)]"
            >
              {ad.mediaUrl ? (
                <img
                  src={ad.mediaUrl}
                  alt=""
                  className="h-40 w-full object-cover sm:h-full"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="hidden bg-[#fff0e8] sm:block" />
              )}
              <div className="p-5">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-[#9a4c31]">
                  Sponsored
                </p>
                <h2 className="mt-1 text-lg font-black text-[#2b160d]">
                  {ad.title}
                </h2>
                {ad.body ? (
                  <p className="mt-1 text-sm leading-6 text-[#6b5041]">
                    {ad.body}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  className="mt-4 rounded-full bg-[#2b160d] px-4 font-bold text-white hover:bg-[#4b2a1d]"
                  onClick={() => handleGeoAdClick(ad)}
                >
                  {ad.ctaText || "Learn more"}
                </Button>
              </div>
            </div>
          ))}
        </aside>
      ) : null}

      {isLoading ? (
        <CollectionLoadingState label="Loading deals" />
      ) : isError ? (
        <CollectionState
          icon={Flame}
          title="Deals are unavailable"
          description="We could not load the current offers. Try again in a moment."
          onRetry={() => void refetch()}
        />
      ) : allDeals.length === 0 ? (
        <CollectionState
          icon={Flame}
          title="No active deals right now"
          description="Scout still has local menus, profiles, schedules, and places to try."
          actionHref="/scout"
          actionLabel="Scout"
        />
      ) : (
        <section aria-labelledby="active-deals-heading">
          <h2 id="active-deals-heading" className="sr-only">
            Active food deals
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {allDeals.map((deal: any) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        </section>
      )}
    </ConsumerCollectionShell>
  );
}
