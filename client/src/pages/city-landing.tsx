import { useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Utensils,
  Truck,
  CalendarDays,
  ChevronRight,
  Tag,
  Share2,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { SEOInternalLinks } from "@/components/seo-internal-links";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  buildFoodTrucksCityCanonicalUrl,
  buildFoodTrucksCityPath,
  deslugSeoTerm,
  normalizeSeoTerm,
  slugifySeoTerm,
  titleCaseSeoTerm,
} from "@/lib/seo-city";

type CityPayload = {
  city: { name: string; slug: string; state?: string | null };
  stats: { restaurants: number; trucks: number; events: number };
  restaurants: Array<{ id: string; name: string; cuisineType?: string | null }>;
  trucks: Array<{ id: string; name: string; cuisineType?: string | null }>;
  events: Array<{
    id: string;
    name?: string | null;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
  }>;
  cuisines: Array<{ name: string; count: number }>;
  stories: Array<{ id: string; title?: string | null }>;
  updatedAt: string;
};

type CityIndexItem = {
  id: string;
  name: string;
  slug: string;
  state?: string | null;
  cuisines: Array<{ slug: string; count: number }>;
};

type SearchTrend = {
  query: string;
  count?: number;
  lastSeen?: string | null;
};

type CityDeal = {
  id: string;
  title: string;
  description?: string | null;
  discountValue?: string | null;
  dealType?: string | null;
  dealPath: string;
  restaurant: {
    id: string;
    name: string;
    cuisineType?: string | null;
  };
};

type AffiliateTag = {
  tag: string;
  sharePath: string;
};

function fetchCity(slug: string) {
  return fetch(apiUrl(`/api/cities/${encodeURIComponent(slug)}`)).then(
    async (r) => {
      if (!r.ok) throw new Error("City not found");
      return r.json() as Promise<CityPayload>;
    },
  );
}

export default function CityLanding() {
  const params = useParams() as Record<string, string | undefined>;
  const citySlug = String(params.citySlug || params.city || "").trim();
  const cuisineSlug = String(params.cuisineSlug || "").trim();
  const cuisineNeedle = deslugSeoTerm(cuisineSlug);
  const { isAuthenticated } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["city", citySlug],
    queryFn: () => fetchCity(citySlug),
    enabled: Boolean(citySlug),
    staleTime: 60_000,
  });

  const { data: cityIndexData } = useQuery<CityIndexItem[]>({
    queryKey: ["/api/cities", "city-landing-related"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/cities"));
      if (!res.ok) throw new Error("Failed to fetch city index");
      return res.json();
    },
    staleTime: 60_000,
  });
  const { data: trendingSearches = [] } = useQuery<SearchTrend[]>({
    queryKey: ["/api/search/trending", "city-landing", citySlug],
    queryFn: async () => {
      const res = await fetch(
        apiUrl("/api/search/trending?limit=6&windowDays=7"),
      );
      if (!res.ok) throw new Error("Failed to fetch trending searches");
      return res.json();
    },
    staleTime: 60_000,
  });
  const { data: latestSearches = [] } = useQuery<SearchTrend[]>({
    queryKey: ["/api/search/latest", "city-landing", citySlug],
    queryFn: async () => {
      const res = await fetch(
        apiUrl("/api/search/latest?limit=6&windowDays=7"),
      );
      if (!res.ok) throw new Error("Failed to fetch latest searches");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: cityDealsPayload } = useQuery<{
    deals: CityDeal[];
    totalDeals: number;
  }>({
    queryKey: ["/api/public/deals/city", citySlug],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/deals/city/${encodeURIComponent(citySlug)}`),
      );
      if (!res.ok) return { deals: [], totalDeals: 0 };
      return res.json();
    },
    enabled: Boolean(citySlug),
    staleTime: 120_000,
  });

  const { data: affiliateTagData } = useQuery<AffiliateTag>({
    queryKey: ["/api/affiliate/tag", "city-landing"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/affiliate/tag"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Not available");
      return res.json();
    },
    enabled: isAuthenticated,
    staleTime: 300_000,
  });

  const filtered = useMemo(() => {
    if (!data) return { trucks: [], restaurants: [] };
    if (!cuisineNeedle) {
      return { trucks: data.trucks, restaurants: data.restaurants };
    }
    const byCuisine = (entry: { cuisineType?: string | null }) =>
      normalizeSeoTerm(entry.cuisineType).includes(cuisineNeedle);
    return {
      trucks: data.trucks.filter(byCuisine),
      restaurants: data.restaurants.filter(byCuisine),
    };
  }, [data, cuisineNeedle]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">City Not Found</h1>
        <p className="text-[color:var(--text-muted)]">
          This city may not have any activity yet.
        </p>
        <div className="mt-5">
          <Link href="/search">
            <Button>Explore All Deals</Button>
          </Link>
        </div>
      </div>
    );
  }

  const cityLabel = `${data.city.name}${data.city.state ? `, ${data.city.state}` : ""}`;
  const cuisineLabel = cuisineNeedle
    ? titleCaseSeoTerm(cuisineNeedle)
    : "";
  const pageTitle = cuisineLabel
    ? `${cuisineLabel} Food Trucks in ${cityLabel} | MealScout`
    : `Food Trucks in ${cityLabel} | MealScout`;
  const pageDescription = cuisineLabel
    ? `Find ${cuisineLabel.toLowerCase()} food trucks and local restaurant deals in ${cityLabel}. Browse live spots, events, and nearby offers on MealScout.`
    : `Find food trucks, local restaurant deals, and nearby events in ${cityLabel}. Browse live local offers on MealScout.`;
  const canonicalPath = buildFoodTrucksCityCanonicalUrl(
    data.city.slug,
    cuisineLabel ? slugifySeoTerm(cuisineLabel) : undefined,
  );

  const cityDeals = (cityDealsPayload?.deals ?? []).slice(0, 6);

  const faqEntries = [
    {
      q: `Are there food trucks in ${data.city.name}?`,
      a:
        filtered.trucks.length > 0
          ? `Yes! MealScout currently tracks ${filtered.trucks.length} food truck${filtered.trucks.length > 1 ? "s" : ""} in ${cityLabel}. Browse their profiles and deals above.`
          : `MealScout is actively tracking food trucks in ${cityLabel}. Check back soon or explore restaurants and deals nearby.`,
    },
    {
      q: `What cuisines can I find in ${data.city.name}?`,
      a:
        data.cuisines.length > 0
          ? `In ${cityLabel} you can find ${data.cuisines
              .slice(0, 5)
              .map((c) => c.name)
              .join(", ")} and more on MealScout.`
          : `MealScout is building out cuisine coverage for ${cityLabel}. Explore restaurants above or browse deals.`,
    },
    {
      q: `Are there restaurant deals in ${data.city.name}?`,
      a:
        cityDeals.length > 0
          ? `Yes! There are currently ${cityDealsPayload?.totalDeals ?? cityDeals.length} active deal${(cityDealsPayload?.totalDeals ?? cityDeals.length) > 1 ? "s" : ""} in ${cityLabel}. Claim them free with a MealScout account.`
          : `Restaurants in ${cityLabel} are joining MealScout. Sign up free to get notified when deals go live near you.`,
    },
    {
      q: `What events are happening in ${data.city.name}?`,
      a:
        data.stats.events > 0
          ? `MealScout shows ${data.stats.events} upcoming food event${data.stats.events > 1 ? "s" : ""} in ${cityLabel}. See dates and times in the events section above.`
          : `There are no events listed in ${cityLabel} right now. Check back or explore nearby city pages.`,
    },
  ];

  const schemaData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: pageTitle,
        description: pageDescription,
        url: canonicalPath,
      },
      {
        "@type": "ItemList",
        name: cuisineLabel
          ? `${cuisineLabel} food trucks in ${cityLabel}`
          : `Food trucks in ${cityLabel}`,
        numberOfItems: filtered.trucks.slice(0, 12).length,
        itemListElement: filtered.trucks.slice(0, 12).map((truck, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: truck.name,
          url: `https://www.mealscout.us/restaurant/${truck.id}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqEntries.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };

  const topCuisineLinks = data.cuisines.slice(0, 8);
  const relatedCities = (Array.isArray(cityIndexData) ? cityIndexData : [])
    .filter((city) => city.slug !== data.city.slug)
    .slice(0, 8);
  const fallbackIntentQueries = [
    `${data.city.name} food truck deals`,
    `${data.city.name} restaurants near me`,
    `${data.city.name} food trucks open now`,
    cuisineLabel
      ? `${cuisineLabel} in ${data.city.name}`
      : `${data.city.name} local food`,
  ];
  const trendingIntentQueries = (
    Array.isArray(trendingSearches) ? trendingSearches : []
  )
    .map((row) => String(row?.query || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const latestIntentQueries = (
    Array.isArray(latestSearches) ? latestSearches : []
  )
    .map((row) => String(row?.query || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const resolvedTrendingIntent =
    trendingIntentQueries.length > 0
      ? trendingIntentQueries
      : fallbackIntentQueries;
  const resolvedLatestIntent =
    latestIntentQueries.length > 0
      ? latestIntentQueries
      : fallbackIntentQueries
          .slice(1)
          .concat(fallbackIntentQueries.slice(0, 1));
  const topDealsLink = cuisineLabel
    ? `/search?q=${encodeURIComponent(`${cuisineLabel} ${data.city.name} food truck`)}`
    : `/search?q=${encodeURIComponent(`${data.city.name} food truck deals`)}`;

  return (
    <div className="max-w-5xl mx-auto bg-[var(--bg-layered)] min-h-screen pb-20">
      <SEOHead
        title={pageTitle}
        description={pageDescription}
        canonicalUrl={canonicalPath}
        schemaData={schemaData}
      />
      <BackHeader title={cityLabel} fallbackHref="/search" icon={MapPin} />

      <main className="px-4 sm:px-6 py-6 space-y-6">
        <nav className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link href="/">
            <span className="hover:text-[color:var(--accent-text)]">Home</span>
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/for-restaurants">
            <span className="hover:text-[color:var(--accent-text)]">
              Food Trucks
            </span>
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/food-trucks/${data.city.slug}`}>
            <span className="hover:text-[color:var(--accent-text)]">
              {data.city.name}
              {data.city.state ? `, ${data.city.state}` : ""}
            </span>
          </Link>
          {cuisineLabel && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground">{cuisineLabel}</span>
            </>
          )}
        </nav>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h1 className="text-2xl font-bold text-foreground">
            {cuisineLabel
              ? `${cuisineLabel} in ${cityLabel}`
              : `Food Trucks in ${cityLabel}`}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Live local discovery page with active trucks, restaurant offers, and
            nearby food events.
          </p>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Food Trucks</div>
                <div className="text-lg font-semibold">
                  {filtered.trucks.length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Restaurants</div>
                <div className="text-lg font-semibold">
                  {filtered.restaurants.length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Open Events</div>
                <div className="text-lg font-semibold">{data.stats.events}</div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Top Food Trucks
          </h2>
          {filtered.trucks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No matching trucks yet for this page.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {filtered.trucks.slice(0, 10).map((truck) => (
                <Link key={truck.id} href={`/restaurant/${truck.id}`}>
                  <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean hover:shadow-clean-lg transition-shadow">
                    <CardContent className="p-4">
                      <div className="font-medium text-foreground">
                        {truck.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {truck.cuisineType || "Food Truck"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Utensils className="w-4 h-4" />
            Restaurants Nearby
          </h2>
          {filtered.restaurants.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No matching restaurants yet for this page.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {filtered.restaurants.slice(0, 8).map((restaurant) => (
                <Link key={restaurant.id} href={`/restaurant/${restaurant.id}`}>
                  <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean hover:shadow-clean-lg transition-shadow">
                    <CardContent className="p-4">
                      <div className="font-medium text-foreground">
                        {restaurant.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {restaurant.cuisineType || "Restaurant"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {cityDeals.length > 0 && (
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Active Deals in {data.city.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {cityDealsPayload?.totalDeals ?? cityDeals.length} active deal
              {(cityDealsPayload?.totalDeals ?? cityDeals.length) !== 1
                ? "s"
                : ""}{" "}
              available right now — claim them free with a MealScout account.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {cityDeals.map((deal) => (
                <Link key={deal.id} href={deal.dealPath}>
                  <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean hover:shadow-clean-lg transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-foreground text-sm leading-snug">
                          {deal.title}
                        </div>
                        {deal.discountValue && (
                          <span className="shrink-0 rounded-full bg-[color:var(--status-success)]/15 px-2 py-0.5 text-xs font-semibold text-[color:var(--status-success)]">
                            {deal.discountValue}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {deal.restaurant.name}
                        {deal.restaurant.cuisineType
                          ? ` · ${deal.restaurant.cuisineType}`
                          : ""}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.events.length > 0 && (
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Upcoming Events
            </h2>
            <div className="mt-3 space-y-2">
              {data.events.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="font-medium text-foreground">
                    {event.name || "Local event"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(event.date).toLocaleDateString()}{" "}
                    {event.startTime ? ` - ${event.startTime}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {relatedCities.length > 0 && (
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
            <h2 className="text-lg font-semibold text-foreground">
              More Active Cities
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep exploring active city pages with live truck, cuisine, and
              event discovery.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {relatedCities.map((city) => (
                <Link key={city.id} href={`/food-trucks/${city.slug}`}>
                  <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean hover:shadow-clean-lg transition-shadow">
                    <CardContent className="p-4">
                      <div className="font-medium text-foreground">
                        {city.name}
                        {city.state ? `, ${city.state}` : ""}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {city.cuisines.length} cuisine pages available
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Common questions about food trucks and deals in {cityLabel}.
          </p>
          <div className="mt-4 space-y-4">
            {faqEntries.map(({ q, a }) => (
              <div
                key={q}
                className="border-b border-[color:var(--border-subtle)] pb-3 last:border-b-0 last:pb-0"
              >
                <h3 className="font-semibold text-sm text-foreground">{q}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">
            Trending + Latest Searches
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Search intent happening now across MealScout. Use it to discover
            where demand is moving.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Trending now
              </h3>
              <div className="mt-3 space-y-2">
                {resolvedTrendingIntent.map((query) => (
                  <Link
                    key={`city-trend-${query}`}
                    href={`/search?q=${encodeURIComponent(query)}`}
                  >
                    <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean transition-shadow hover:shadow-clean-lg">
                      <CardContent className="p-3">
                        <div className="text-sm font-medium text-foreground">
                          {query}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Latest searches
              </h3>
              <div className="mt-3 space-y-2">
                {resolvedLatestIntent.map((query) => (
                  <Link
                    key={`city-latest-${query}`}
                    href={`/search?q=${encodeURIComponent(query)}`}
                  >
                    <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean transition-shadow hover:shadow-clean-lg">
                      <CardContent className="p-3">
                        <div className="text-sm font-medium text-foreground">
                          {query}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">
            Explore By Cuisine
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the most popular food categories in {cityLabel}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {topCuisineLinks.map((cuisine) => (
              <Link
                key={cuisine.name}
                href={buildFoodTrucksCityPath(
                  data.city.slug,
                  slugifySeoTerm(cuisine.name),
                )}
              >
                <Button variant="outline" size="sm">
                  {cuisine.name} ({cuisine.count})
                </Button>
              </Link>
            ))}
          </div>
        </section>

        <SEOInternalLinks
          title={`More Popular Spots Near ${data.city.name}`}
          description="Explore more nearby city and cuisine picks people are viewing."
          excludeCitySlug={data.city.slug}
          maxCities={6}
          maxCuisineLinksPerCity={3}
        />

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share {data.city.name} with Friends
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Know someone who loves food in {cityLabel}? Share this page and earn
            credits when they join.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {affiliateTagData?.sharePath ? (
              <Button
                size="sm"
                className="food-gradient-primary border-0"
                onClick={() => {
                  const url = `${window.location.origin}/food-trucks/${data.city.slug}?ref=${affiliateTagData.tag}`;
                  if (navigator.share) {
                    navigator.share({
                      title: `Food Trucks in ${cityLabel}`,
                      url,
                    });
                  } else {
                    navigator.clipboard
                      .writeText(url)
                      .then(() => alert("Link copied!"));
                  }
                }}
              >
                Share & Earn Credits
              </Button>
            ) : (
              <Link
                href={`/food-trucks/${data.city.slug}?q=${encodeURIComponent(cityLabel + " food trucks")}`}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[color:var(--border-subtle)]"
                >
                  Share this page
                </Button>
              </Link>
            )}
            <Link href="/search">
              <Button
                size="sm"
                variant="outline"
                className="border-[color:var(--border-subtle)]"
              >
                Explore more cities
              </Button>
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">
            Continue Exploring
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Link href={topDealsLink}>
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:shadow-clean-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="font-medium text-foreground">
                    Search Local Deals
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Run a local search tuned for this city and cuisine intent.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/scout">
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:shadow-clean-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="font-medium text-foreground">
                    Open Live Map
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    View active trucks, deals, and parking/event pins near you.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Last refreshed: {new Date(data.updatedAt).toLocaleString()}
          </p>
        </section>
      </main>
    </div>
  );
}
