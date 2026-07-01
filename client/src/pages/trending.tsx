import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  MapPin,
  Search,
  Sparkles,
  Truck,
  Utensils,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type TrendingItem = {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  cuisineType?: string | null;
  clicks?: number;
  impressions?: number;
  trendScore?: number;
};

type TrendingCuisine = {
  cuisine: string;
  menuItems: number;
  places: number;
  clicks: number;
  impressions: number;
  trendScore: number;
};

type TrendingPlace = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  clicks?: number;
  events?: number;
  videoRecommendations?: number;
  trendScore?: number;
};

type TrendingResponse = {
  generatedAt: string;
  windowDays: number;
  cuisines: TrendingCuisine[];
  items: TrendingItem[];
  places: TrendingPlace[];
  signals: Array<{ eventName: string; count: number; lastSeenAt?: string }>;
};

const money = (cents?: number | null) =>
  typeof cents === "number" && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
    : null;

function heatLabel(score?: number | null) {
  const value = Number(score || 0);
  if (value >= 120) return "Popular";
  if (value >= 70) return "Getting attention";
  if (value >= 30) return "Trending";
  return "New signal";
}

export default function TrendingPage() {
  const { data, isLoading } = useQuery<TrendingResponse>({
    queryKey: ["/api/public/trending"],
    queryFn: async () => {
      const res = await fetch("/api/public/trending?limit=16&days=14", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load trending");
      return res.json();
    },
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const places = data?.places ?? [];
  const cuisines = data?.cuisines ?? [];
  const signals = data?.signals ?? [];
  const truckPlaces = places.filter(
    (place) =>
      place.isFoodTruck === true ||
      String(place.businessType || "")
        .trim()
        .toLowerCase()
        .includes("truck"),
  );
  const restaurantPlaces = places.filter(
    (place) =>
      !(
        place.isFoodTruck === true ||
        String(place.businessType || "")
          .trim()
          .toLowerCase()
          .includes("truck")
      ),
  );
  const recentMenuItems = items.slice(6, 10).length > 0 ? items.slice(6, 10) : items.slice(0, 4);
  const nearbyPlaces = places.slice(6, 10);
  const hasSignals = items.length + cuisines.length + places.length > 0;

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Trending Local Food - MealScout"
        description="Real menu items, trucks, restaurants, and food signals from MealScout."
      />
      <div className="mx-auto min-h-screen max-w-md bg-[var(--bg-layered)] pb-20 lg:max-w-4xl xl:max-w-6xl">
        <main>
          <section className="border-b border-[color:var(--border-subtle)] px-4 py-6 sm:px-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--accent-text)]">
              Trending
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[color:var(--text-primary)]">
              What's hot near you
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)] sm:text-base">
              Real menu items, trucks, restaurants, and food signals from MealScout.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <RouteButton href="/scout" icon={<Flame className="h-4 w-4" />} label="Open Scout" />
              <RouteButton href="/map" icon={<MapPin className="h-4 w-4" />} label="View Map" />
              <RouteButton href="/search" icon={<Search className="h-4 w-4" />} label="Browse nearby" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Window" value={`${data?.windowDays ?? 14} days`} />
              <SummaryCard label="Popular dishes" value={String(items.length)} />
              <SummaryCard label="Trending places" value={String(restaurantPlaces.length)} />
              <SummaryCard label="Food trucks" value={String(truckPlaces.length)} />
            </div>
          </section>

          {isLoading ? (
            <div className="space-y-4 px-4 py-6 sm:px-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]"
                />
              ))}
            </div>
          ) : !hasSignals ? (
            <section className="px-4 py-12 sm:px-6">
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
                <CardContent className="flex flex-col items-center px-6 py-10 text-center">
                  <Sparkles className="h-10 w-10 text-[color:var(--accent-text)]" />
                  <h2 className="mt-4 text-2xl font-bold text-[color:var(--text-primary)]">
                    Trending is still warming up here.
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--text-secondary)]">
                    Open Scout to browse nearby food, trucks, and menus.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <RouteButton href="/scout" icon={<Flame className="h-4 w-4" />} label="Open Scout" />
                    <RouteButton href="/map" icon={<MapPin className="h-4 w-4" />} label="View Map" />
                    <RouteButton href="/search" icon={<Search className="h-4 w-4" />} label="Browse nearby" />
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : (
            <div className="space-y-8 px-4 py-6 sm:px-6">
              {items.length > 0 && (
                <section>
                  <SectionHeader
                    title="Popular dishes"
                    description="Real menu items getting attention on MealScout."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.slice(0, 6).map((item) => (
                      <Link key={item.id} href={`/restaurant/${item.restaurantId}`}>
                        <Card className="overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition hover:shadow-clean-lg">
                          <TrendImage imageUrl={item.imageUrl} />
                          <CardContent className="px-4 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="line-clamp-2 text-base font-semibold text-[color:var(--text-primary)]">
                                {item.name}
                              </h3>
                              <span className="rounded-full bg-[color:var(--accent-text)]/10 px-2 py-1 text-[11px] font-semibold text-[color:var(--accent-text)]">
                                {heatLabel(item.trendScore)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-[color:var(--text-secondary)]">
                              {item.restaurantName || "Local spot"}
                            </p>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-[color:var(--text-muted)]">
                              {item.description || item.cuisineType || "Current meal activity in this market."}
                            </p>
                            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-[color:var(--text-secondary)]">
                              <span className="truncate">
                                {[item.restaurantCity, item.restaurantState].filter(Boolean).join(", ") || "Nearby"}
                              </span>
                              {money(item.priceCents) && (
                                <span className="font-semibold text-[color:var(--text-primary)]">
                                  {money(item.priceCents)}
                                </span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {restaurantPlaces.length > 0 && (
                <section>
                  <SectionHeader
                    title="Trending places"
                    description="Restaurants with real clicks, views, or approved video activity."
                  />
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {restaurantPlaces.slice(0, 6).map((place) => (
                      <PlaceCard key={place.id} place={place} />
                    ))}
                  </div>
                </section>
              )}

              {recentMenuItems.length > 0 && (
                <section>
                  <SectionHeader
                    title="Recent menu updates"
                    description="Items surfaced in this trend window because they had current meal activity or recent menu updates."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {recentMenuItems.map((item) => (
                      <Link key={`recent-${item.id}`} href={`/restaurant/${item.restaurantId}`}>
                        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition hover:shadow-clean-lg">
                          <CardContent className="px-4 py-4">
                            <p className="text-sm font-semibold text-[color:var(--text-primary)] line-clamp-2">
                              {item.name}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                              {item.restaurantName || "Local spot"}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-[color:var(--text-muted)]">
                              {item.cuisineType || "Menu activity"}{item.restaurantCity ? ` · ${item.restaurantCity}` : ""}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {truckPlaces.length > 0 && (
                <section>
                  <SectionHeader
                    title="Food trucks getting attention"
                    description="Truck profiles with recent MealScout activity."
                  />
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {truckPlaces.slice(0, 6).map((place) => (
                      <PlaceCard key={`truck-${place.id}`} place={place} />
                    ))}
                  </div>
                </section>
              )}

              {nearbyPlaces.length > 0 && (
                <section>
                  <SectionHeader
                    title="New nearby"
                    description="More nearby places surfaced in the current trend window."
                  />
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {nearbyPlaces.map((place) => (
                      <Link key={`nearby-${place.id}`} href={`/restaurant/${place.id}`}>
                        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition hover:shadow-clean-lg">
                          <CardContent className="px-4 py-4">
                            <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                              {place.name}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                              {[place.cuisineType, place.city, place.state].filter(Boolean).join(" · ")}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {(cuisines.length > 0 || signals.length > 0) && (
                <section>
                  <SectionHeader
                    title="Food signals"
                    description="A plain summary of the cuisines and activity types included in this view."
                  />
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {cuisines.slice(0, 4).map((cuisine) => (
                      <Card
                        key={cuisine.cuisine}
                        className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean"
                      >
                        <CardContent className="px-4 py-4">
                          <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                            {cuisine.cuisine}
                          </p>
                          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                            {cuisine.menuItems} menu items
                          </p>
                          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                            {cuisine.places} places
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                    {signals.slice(0, Math.max(0, 4 - Math.min(4, cuisines.length))).map((signal) => (
                      <Card
                        key={signal.eventName}
                        className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean"
                      >
                        <CardContent className="px-4 py-4">
                          <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                            {signal.eventName.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                            {signal.count} events
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
        <Navigation />
      </div>
    </div>
  );
}

function RouteButton({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href} className="inline-flex items-center gap-2">
        {icon}
        {label}
      </Link>
    </Button>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
      <CardContent className="px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
          {label}
        </p>
        <p className="mt-2 text-base font-semibold text-[color:var(--text-primary)]">{value}</p>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">{description}</p>
    </div>
  );
}

function PlaceCard({ place }: { place: TrendingPlace }) {
  return (
    <Link href={`/restaurant/${place.id}`}>
      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition hover:shadow-clean-lg">
        <CardContent className="flex items-center gap-4 px-4 py-4">
          <TrendImage
            imageUrl={place.coverImageUrl || place.logoUrl}
            className="h-16 w-16 shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[color:var(--text-primary)]">
                {place.name}
              </h3>
              <span className="rounded-full bg-[color:var(--accent-text)]/10 px-2 py-1 text-[11px] font-semibold text-[color:var(--accent-text)]">
                {heatLabel(place.trendScore)}
              </span>
            </div>
            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
              {[place.cuisineType, place.city, place.state].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 text-xs text-[color:var(--text-muted)]">
              {Number(place.clicks || 0)} clicks · {Number(place.events || 0)} signals
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function TrendImage({
  imageUrl,
  className = "h-40 w-full rounded-t-xl",
}: {
  imageUrl?: string | null;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageUrl && !imageFailed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${className} object-cover bg-[var(--bg-surface-muted)]`}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center bg-[var(--bg-surface-muted)] text-[color:var(--text-muted)]`}
    >
      <Utensils className="h-6 w-6" aria-hidden="true" />
    </div>
  );
}
