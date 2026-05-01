import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import SmartSearch from "@/components/smart-search";
import RestaurantCard from "@/components/restaurant-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackHeader } from "@/components/back-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Filter,
  MapPin,
  Clock,
  X,
  SlidersHorizontal,
  Utensils,
  Pizza,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Salad,
  Coffee,
  Fish,
  Cake,
  Croissant,
  Beef,
  ChefHat,
  Crown,
  ArrowDownToLine,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import {
  AdminEditableText,
  AdminEditButton,
  useAdminInlineCopy,
} from "@/components/admin-inline-copy";
import { trackUxEvent } from "@/utils/uxTelemetry";
import { useIsStandalone } from "@/hooks/useIsStandalone";
import { readDeviceLocation, writeDeviceLocation } from "@/lib/device-location";

type DiscoveryCity = {
  id: string;
  name: string;
  slug: string;
  state?: string | null;
  cuisines: Array<{ slug: string; count: number }>;
};

const titleCaseSlug = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// Category configuration mapping (from category.tsx)
const categoryConfig = {
  pizza: { title: "Pizza", icon: Pizza, keywords: ["pizza", "italian"] },
  burgers: {
    title: "Burgers",
    icon: Sandwich,
    keywords: ["american", "burger", "sandwich"],
  },
  asian: {
    title: "Asian",
    icon: Soup,
    keywords: ["asian", "chinese", "japanese", "sushi", "noodle"],
  },
  mexican: {
    title: "Mexican",
    icon: UtensilsCrossed,
    keywords: ["mexican", "taco", "burrito"],
  },
  healthy: {
    title: "Healthy",
    icon: Salad,
    keywords: ["healthy", "salad", "smoothie"],
  },
  breakfast: {
    title: "Breakfast",
    icon: Croissant,
    keywords: ["breakfast", "brunch", "pancake", "coffee"],
  },
  seafood: {
    title: "Seafood",
    icon: Fish,
    keywords: ["seafood", "fish", "shrimp"],
  },
  coffee: {
    title: "Coffee",
    icon: Coffee,
    keywords: ["cafe", "coffee", "latte"],
  },
  dessert: {
    title: "Desserts",
    icon: Cake,
    keywords: ["dessert", "ice cream", "cake"],
  },
};

const synonymGroups = [
  ["bbq", "barbecue", "smokehouse"],
  ["burger", "burgers", "sandwich"],
  ["taco", "tacos", "burrito", "mexican"],
  ["pizza", "pizzeria", "italian"],
  ["coffee", "cafe", "latte"],
  ["dessert", "desserts", "sweet", "sweets", "bakery"],
  ["seafood", "fish", "shrimp"],
  ["vegan", "vegetarian", "plant"],
  ["breakfast", "brunch"],
];

const synonymIndex = synonymGroups.reduce<Record<string, string[]>>(
  (acc, group) => {
    group.forEach((term) => {
      acc[term] = group.filter((candidate) => candidate !== term);
    });
    return acc;
  },
  {},
);

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenVariants = (token: string): string[] => {
  const variants = new Set<string>();
  const normalized = normalizeSearchText(token);
  if (!normalized) return [];

  variants.add(normalized);
  if (normalized.endsWith("s") && normalized.length > 3) {
    variants.add(normalized.slice(0, -1));
  } else if (normalized.length > 3) {
    variants.add(`${normalized}s`);
  }

  (synonymIndex[normalized] || []).forEach((term) => variants.add(term));
  return Array.from(variants);
};

const buildQueryGroups = (query: string): string[][] => {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const tokens = normalized.split(" ").filter((token) => token.length > 1);
  if (tokens.length === 0) return [];
  return tokens.map(tokenVariants).filter((variants) => variants.length > 0);
};

const normalizeDealFields = (deal: any) => ({
  title: normalizeSearchText(deal.title || ""),
  description: normalizeSearchText(deal.description || ""),
  restaurantName: normalizeSearchText(deal.restaurant?.name || ""),
  cuisineType: normalizeSearchText(deal.restaurant?.cuisineType || ""),
});

const matchesQueryGroups = (deal: any, queryGroups: string[][]) => {
  if (queryGroups.length === 0) return true;

  const fields = normalizeDealFields(deal);
  const haystack = `${fields.title} ${fields.description} ${fields.restaurantName} ${fields.cuisineType}`;
  return queryGroups.every((group) =>
    group.some((variant) => haystack.includes(variant)),
  );
};

const relevanceScore = (deal: any, queryGroups: string[][]) => {
  if (queryGroups.length === 0) return 0;
  const fields = normalizeDealFields(deal);
  let score = 0;

  queryGroups.forEach((group) => {
    if (group.some((variant) => fields.title.includes(variant))) score += 6;
    if (group.some((variant) => fields.restaurantName.includes(variant)))
      score += 4;
    if (group.some((variant) => fields.cuisineType.includes(variant)))
      score += 3;
    if (group.some((variant) => fields.description.includes(variant)))
      score += 2;
  });

  return score;
};

const levenshteinDistance = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
};

export default function SearchPage() {
  const isStandalone = useIsStandalone();
  const { getText } = useAdminInlineCopy();
  const [location, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState([0, 50]);
  const [sortBy, setSortBy] = useState("relevance");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Location state management
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    const cached = readDeviceLocation();
    if (cached) {
      setUserLocation({ lat: cached.lat, lng: cached.lng });
      return;
    }
    requestUserLocation();
  }, []);

  // Parse URL query parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get("q");
    if (query) {
      setSearchQuery(decodeURIComponent(query));
    }
  }, [location]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const requestUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not available on this device.");
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(location);
        writeDeviceLocation({
          ...location,
          accuracy: position.coords.accuracy,
        });
        setIsLocating(false);
      },
      () => {
        setLocationError("Unable to get your location.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Fetch nearby deals when location is available, otherwise featured deals
  const { data: nearbyDeals, isLoading: nearbyLoading } = useQuery({
    queryKey: userLocation
      ? ["/api/deals/nearby", userLocation.lat, userLocation.lng]
      : ["/api/deals/featured"],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/deals/nearby/${userLocation.lat}/${userLocation.lng}`,
        );
        if (!response.ok) throw new Error("Failed to fetch nearby deals");
        return response.json();
      }

      const response = await fetch("/api/deals/featured");
      if (!response.ok) throw new Error("Failed to fetch featured deals");
      return response.json();
    },
    enabled: !searchQuery && (!!userLocation || !isLocating),
  });

  const { data: featuredDeals, isLoading: featuredLoading } = useQuery({
    queryKey: ["/api/deals/featured"],
    queryFn: async () => {
      const response = await fetch("/api/deals/featured");
      if (!response.ok) throw new Error("Failed to fetch featured deals");
      return response.json();
    },
    enabled: !searchQuery && !userLocation && !isLocating,
  });

  const { data: unifiedResults, isLoading: unifiedLoading } = useQuery({
    queryKey: [
      "/api/search",
      debouncedSearchQuery,
      userLocation?.lat ?? null,
      userLocation?.lng ?? null,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedSearchQuery });
      if (userLocation) {
        params.set("lat", String(userLocation.lat));
        params.set("lng", String(userLocation.lng));
      }
      const res = await fetch(`/api/search?${params}`);
      if (!res.ok) throw new Error("Failed to search");
      return res.json();
    },
    enabled: debouncedSearchQuery.length >= 2,
    staleTime: 30_000,
  });

  const isLoading =
    nearbyLoading || featuredLoading || unifiedLoading || isLocating;

  // Function to map cuisine types and titles to category IDs
  const mapDealToCategory = (deal: any): string[] => {
    const categories: string[] = [];
    const cuisineType = normalizeSearchText(deal.restaurant?.cuisineType || "");
    const title = normalizeSearchText(deal.title || "");

    // Check each category for matches
    Object.entries(categoryConfig).forEach(([categoryId, config]) => {
      const keywords = config.keywords;
      const matches = keywords.some(
        (keyword) =>
          cuisineType.includes(normalizeSearchText(keyword)) ||
          title.includes(normalizeSearchText(keyword)),
      );
      if (matches) {
        categories.push(categoryId);
      }
    });

    return categories;
  };

  // Generate dynamic categories based on nearby deals
  const generateDynamicCategories = (deals: any[]) => {
    const categoryCounts: Record<string, number> = {};

    // Count deals per category
    deals.forEach((deal) => {
      const dealCategories = mapDealToCategory(deal);
      dealCategories.forEach((categoryId) => {
        categoryCounts[categoryId] = (categoryCounts[categoryId] || 0) + 1;
      });
    });

    // Sort categories by count and take top 5
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([categoryId]) => categoryId);

    // Build category buttons
    const dynamicCategories = [{ id: "all", label: "All", icon: Utensils }];

    sortedCategories.forEach((categoryId) => {
      if (categoryConfig[categoryId as keyof typeof categoryConfig]) {
        const config =
          categoryConfig[categoryId as keyof typeof categoryConfig];
        dynamicCategories.push({
          id: categoryId,
          label: config.title,
          icon: config.icon,
        });
      }
    });

    return dynamicCategories;
  };

  // Static fallback categories
  const staticCategories = [
    { id: "all", label: "All", icon: Utensils },
    { id: "pizza", label: "Pizza", icon: Pizza },
    { id: "burgers", label: "Burgers", icon: Beef },
    { id: "asian", label: "Asian", icon: ChefHat },
    { id: "mexican", label: "Mexican", icon: Crown },
    { id: "healthy", label: "Healthy", icon: Salad },
  ];

  // Use dynamic categories when we have nearby deals, otherwise use static
  const allDeals = Array.isArray(nearbyDeals)
    ? nearbyDeals
    : Array.isArray(featuredDeals)
      ? featuredDeals
      : [];
  const searchedDeals = Array.isArray((unifiedResults as any)?.deals)
    ? (unifiedResults as any).deals
    : [];
  const searchedRestaurants = Array.isArray(
    (unifiedResults as any)?.restaurants,
  )
    ? (unifiedResults as any).restaurants
    : [];
  const mergedRestaurants = useMemo(() => {
    const byId = new Map<string, any>();
    searchedRestaurants.forEach((restaurant: any) => {
      const id = String(restaurant?.id || "").trim();
      if (!id) return;
      byId.set(id, restaurant);
    });
    return Array.from(byId.values()).slice(0, 24);
  }, [searchedRestaurants]);
  const searchedParkingPassHosts = Array.isArray(
    (unifiedResults as any)?.parkingPassHosts,
  )
    ? (unifiedResults as any).parkingPassHosts
    : [];
  const searchedVideos = Array.isArray((unifiedResults as any)?.videos)
    ? (unifiedResults as any).videos
    : [];
  const searchedEvents = Array.isArray((unifiedResults as any)?.events)
    ? (unifiedResults as any).events
    : [];
  const searchedUnclaimed = Array.isArray(
    (unifiedResults as any)?.unclaimedListings,
  )
    ? (unifiedResults as any).unclaimedListings
    : [];
  const visibleUnclaimed =
    mergedRestaurants.length > 0 ? [] : searchedUnclaimed;
  const totalStructuredMatches =
    mergedRestaurants.length +
    searchedParkingPassHosts.length +
    searchedVideos.length +
    searchedEvents.length +
    searchedDeals.length +
    visibleUnclaimed.length;
  const hasNonDealSearchMatches =
    mergedRestaurants.length +
      searchedParkingPassHosts.length +
      searchedVideos.length +
      searchedEvents.length +
      visibleUnclaimed.length >
    0;

  const dealsForPage = searchQuery ? searchedDeals : allDeals;
  const queryGroups = buildQueryGroups(searchQuery);
  const categories =
    !searchQuery && userLocation && nearbyDeals && nearbyDeals.length > 0
      ? generateDynamicCategories(nearbyDeals)
      : staticCategories;

  // allDeals is already defined above
  const filteredDeals = useMemo(
    () =>
      dealsForPage
        .filter((deal: any) => {
          const matchesSearch =
            !searchQuery || matchesQueryGroups(deal, queryGroups);

          const matchesCategory =
            selectedCategory === "all" ||
            (selectedCategory &&
              mapDealToCategory(deal).includes(selectedCategory));

          // Apply price range filter
          const dealPrice = parseFloat(deal.minOrderAmount) || 0;
          const matchesPrice =
            dealPrice >= priceRange[0] && dealPrice <= priceRange[1];

          return matchesSearch && matchesCategory && matchesPrice;
        })
        .sort((a: any, b: any) => {
          // Apply sorting
          switch (sortBy) {
            case "price_low":
              return (
                parseFloat(a.minOrderAmount || "0") -
                parseFloat(b.minOrderAmount || "0")
              );
            case "price_high":
              return (
                parseFloat(b.minOrderAmount || "0") -
                parseFloat(a.minOrderAmount || "0")
              );
            case "discount":
              return (
                parseFloat(b.discountValue || "0") -
                parseFloat(a.discountValue || "0")
              );
            case "newest":
              return (
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
              );
            default:
              if (searchQuery) {
                const bScore = relevanceScore(b, queryGroups);
                const aScore = relevanceScore(a, queryGroups);
                if (bScore !== aScore) return bScore - aScore;
                return (
                  parseFloat(b.discountValue || "0") -
                  parseFloat(a.discountValue || "0")
                );
              }
              return 0;
          }
        }),
    [
      dealsForPage,
      searchQuery,
      queryGroups,
      selectedCategory,
      priceRange,
      sortBy,
    ],
  );

  const suggestionTerms = useMemo(() => {
    const fromCategories = Object.values(categoryConfig).flatMap((category) =>
      category.keywords.map(normalizeSearchText),
    );
    const fromSynonyms = synonymGroups.flat().map(normalizeSearchText);
    const fromRestaurants = mergedRestaurants
      .map((restaurant: any) => normalizeSearchText(restaurant.name || ""))
      .filter((value: string) => value.length >= 3);
    const fromCuisine = mergedRestaurants
      .map((restaurant: any) =>
        normalizeSearchText(restaurant.cuisineType || ""),
      )
      .filter((value: string) => value.length >= 3);
    return Array.from(
      new Set([
        ...fromCategories,
        ...fromSynonyms,
        ...fromRestaurants,
        ...fromCuisine,
      ]),
    ).filter((value) => value.length >= 3);
  }, [mergedRestaurants]);

  const didYouMean = useMemo(() => {
    const query = normalizeSearchText(searchQuery);
    if (!query || query.length < 3) return null;
    let best: { term: string; score: number } | null = null;
    for (const term of suggestionTerms) {
      if (term === query) continue;
      const score = levenshteinDistance(query, term);
      const threshold = query.length <= 5 ? 1 : 2;
      if (score <= threshold && (!best || score < best.score)) {
        best = { term, score };
      }
    }
    return best ? best.term : null;
  }, [searchQuery, suggestionTerms]);

  const searchTitle = searchQuery
    ? `${searchQuery} - Search Results`
    : "Search";
  const searchDescription = searchQuery
    ? `Find restaurants, bars, trucks, deals, videos, and events for "${searchQuery}".`
    : "Search for restaurants, trucks, deals, parking pass spots, videos, and events.";
  const searchKeywordVariants = searchQuery
    ? Array.from(new Set(queryGroups.flat()).values()).slice(0, 8).join(", ")
    : "food search";
  const searchCanonicalUrl = searchQuery
    ? `https://www.mealscout.us/search?q=${encodeURIComponent(searchQuery)}`
    : "https://www.mealscout.us/search";

  const searchSchemaData = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SearchResultsPage",
          name: searchQuery
            ? `MealScout search results for ${searchQuery}`
            : "MealScout Search",
          url: searchCanonicalUrl,
          description: searchDescription,
          about: searchQuery || "local food deals",
          mainEntity: {
            "@type": "ItemList",
            name: searchQuery
              ? `Deals matching ${searchQuery}`
              : "Featured searchable deals",
            numberOfItems: filteredDeals.slice(0, 12).length,
            itemListElement: filteredDeals
              .slice(0, 12)
              .map((deal: any, index: number) => ({
                "@type": "ListItem",
                position: index + 1,
                name: deal.title,
                url: `https://www.mealscout.us/deal/${deal.id}`,
              })),
          },
        },
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
      ],
    }),
    [searchQuery, searchCanonicalUrl, searchDescription, filteredDeals],
  );
  type TrendingSearchRow = {
    query: string;
    count: number;
    context?: string | null;
  };
  const { data: trendingSearches = [] } = useQuery<TrendingSearchRow[]>({
    queryKey: [
      "/api/search/trending",
      "search-discovery",
      userLocation?.lat ?? null,
      userLocation?.lng ?? null,
      selectedCategory,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "8",
        windowDays: "7",
      });
      if (userLocation) {
        params.set("lat", String(userLocation.lat));
        params.set("lng", String(userLocation.lng));
        params.set("radiusKm", "25");
      }
      if (selectedCategory && selectedCategory !== "all") {
        params.set("interest", selectedCategory);
      }
      const res = await fetch(`/api/search/trending?${params}`);
      if (!res.ok) throw new Error("Failed to fetch trending searches");
      return res.json();
    },
    staleTime: 30_000,
  });
  const searchExploreLinks = [
    {
      href: "/map",
      title: "Live Food Truck Map",
      description:
        "Open the interactive map to see trucks, events, and nearby deals.",
    },
    {
      href: "/deals/featured",
      title: "Featured Food Deals",
      description: "Browse hand-picked local restaurant and food truck offers.",
    },
    {
      href: "/how-it-works",
      title: "How MealScout Works",
      description: "Learn how to discover, save, and redeem local food deals.",
    },
    {
      href: "/faq",
      title: "MealScout FAQ",
      description:
        "Get quick answers about accounts, deals, and location-based results.",
    },
  ];
  const trendingLinks = (
    Array.isArray(trendingSearches)
      ? trendingSearches
          .map((row) => ({
            query: row?.query,
            context: row?.context || null,
          }))
          .filter((row) => Boolean(row.query))
      : []
  )
    .slice(0, 8)
    .map((row) => ({
      href: `/search?q=${encodeURIComponent(String(row.query))}`,
      title: String(row.query),
      context: row.context,
    }));

  const searchPlaceholder = getText(
    "search.input.placeholder",
    "Search restaurants, cuisines, deals...",
  );
  const hasActiveSearch = searchQuery.trim().length > 0;

  async function trackSearch(query: string, source: string) {
    try {
      await fetch("/api/search/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, source }),
        keepalive: true,
      });
    } catch {
      // no-op
    }
  }

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title={`${searchTitle} | MealScout`}
        description={searchDescription}
        keywords={`food deals near me, food truck search, restaurant specials, local food finder, nearby food trucks, event food vendors, ${
          searchKeywordVariants
        }, nearby restaurants, meal deals, food truck locations`}
        canonicalUrl={searchCanonicalUrl}
        schemaData={searchSchemaData}
      />
      <BackHeader title="Search" fallbackHref="/" />
      {/* Header */}
      <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">
                <AdminEditableText
                  textKey="search.hero.title"
                  defaultText="Search"
                />
              </h1>
              <AdminEditButton
                textKey="search.hero.title"
                defaultText="Search"
                label="Search page title"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {isLocating && !searchQuery ? (
                <AdminEditableText
                  textKey="search.hero.state.locating"
                  defaultText="Finding your location..."
                />
              ) : userLocation && !searchQuery ? (
                <AdminEditableText
                  textKey="search.hero.state.popularNearby"
                  defaultText="Popular deals near you"
                />
              ) : searchQuery && totalStructuredMatches > 0 ? (
                <AdminEditableText
                  textKey="search.hero.state.resultsFound"
                  defaultText="Showing restaurants, trucks, and deals that match your search"
                />
              ) : searchQuery ? (
                <AdminEditableText
                  textKey="search.hero.state.noMatches"
                  defaultText="No matches yet"
                />
              ) : (
                <AdminEditableText
                  textKey="search.hero.state.default"
                  defaultText="Use location for nearby results or browse featured deals"
                />
              )}
            </p>
            <div className="mt-1">
              <AdminEditButton
                textKey="search.hero.state.default"
                defaultText="Use location for nearby results or browse featured deals"
                label="Search default hero subtitle"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isStandalone && (
              <Link href="/install">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="button-install"
                  onPointerDown={() => {
                    trackUxEvent("search_install_click", {
                      surface: "search_header",
                    });
                  }}
                  aria-label="Install app"
                  title="Install app"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                </Button>
              </Link>
            )}
            {!searchQuery && !userLocation && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestUserLocation}
                disabled={isLocating}
                data-testid="button-request-location"
                aria-label="Use my location"
                onPointerDown={() => {
                  trackUxEvent("search_location_request_primary", {
                    surface: "search_header",
                  });
                }}
              >
                <MapPin className="w-4 h-4 mr-1" />
                {isLocating ? "Locating..." : "Use location"}
              </Button>
            )}
            {!searchQuery && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setShowFilters(!showFilters)}
                data-testid="button-filter"
                aria-label={showFilters ? "Hide filters" : "Show filters"}
                aria-expanded={showFilters}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        {locationError && !searchQuery && (
          <p
            className="mb-4 text-xs text-[color:var(--status-error)]"
            role="alert"
          >
            {locationError}
          </p>
        )}

        {!searchQuery && !userLocation && !isLocating && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={requestUserLocation}
              data-testid="button-search-quick-location"
              aria-label="Use my location"
              onPointerDown={() => {
                trackUxEvent("search_location_request_quick", {
                  surface: "search_quick_actions",
                });
              }}
            >
              <MapPin className="w-4 h-4 mr-1" />
              Use location
            </Button>
            <Link href="/map">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                data-testid="button-search-quick-map"
                onPointerDown={() => {
                  trackUxEvent("search_open_map_quick", {
                    surface: "search_quick_actions",
                  });
                }}
              >
                <MapPin className="w-4 h-4 mr-1" />
                Open map
              </Button>
            </Link>
          </div>
        )}

        {/* Search Bar */}
        <SmartSearch
          value={searchQuery}
          onChange={setSearchQuery}
          onSearch={(query) => {
            setSearchQuery(query);
            void trackSearch(query, "search_submit");
            // Update URL with search query
            const newUrl = `/search?q=${encodeURIComponent(query)}`;
            setLocation(newUrl);
          }}
          placeholder={searchPlaceholder}
          className="mb-6"
        />
        {!searchQuery && (
          <div className="-mt-4 mb-4">
            <AdminEditButton
              textKey="search.input.placeholder"
              defaultText="Search restaurants, cuisines, deals..."
              label="Search input placeholder"
            />
          </div>
        )}

        {/* Category Filters */}
        {!searchQuery && (
          <div className="flex space-x-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-6 lg:gap-3 lg:overflow-visible">
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={
                  selectedCategory === category.id ? "default" : "outline"
                }
                size="sm"
                onClick={() => setSelectedCategory(category.id)}
                className="flex-shrink-0 rounded-full px-4 py-2"
                data-testid={`button-category-${category.id}`}
              >
                <category.icon className="w-4 h-4 mr-2" />
                {category.label}
              </Button>
            ))}
          </div>
        )}

        {/* Advanced Filters Panel */}
        {!searchQuery && showFilters && (
          <Card className="mb-6 bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="p-4 space-y-4">
              {/* Sort By */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Sort by
                </label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">Most Relevant</SelectItem>
                    <SelectItem value="price_low">
                      Price: Low to High
                    </SelectItem>
                    <SelectItem value="price_high">
                      Price: High to Low
                    </SelectItem>
                    <SelectItem value="discount">Best Discount</SelectItem>
                    <SelectItem value="newest">Newest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Price Range */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Price Range: ${priceRange[0]} - ${priceRange[1]}
                </label>
                <Slider
                  value={priceRange}
                  onValueChange={setPriceRange}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>$0</span>
                  <span>$100+</span>
                </div>
              </div>

              {/* Clear Filters */}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted-foreground">
                  {searchQuery
                    ? `${totalStructuredMatches} result${totalStructuredMatches === 1 ? "" : "s"} found`
                    : `${filteredDeals.length} deal${filteredDeals.length === 1 ? "" : "s"} found`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setSortBy("relevance");
                    setPriceRange([0, 50]);
                    setSelectedCategory("all");
                    setSearchQuery("");
                  }}
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear All
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </header>

      {/* Results */}
      <div className="px-4 sm:px-6 py-6">
        {searchQuery && (
          <div className="mb-6 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
            <h2 className="text-base font-semibold text-foreground">
              All Results for "{searchQuery}"
            </h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-muted-foreground">
                Restaurants/Trucks: {mergedRestaurants.length}
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-muted-foreground">
                Deals: {searchedDeals.length}
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-muted-foreground">
                Events: {searchedEvents.length}
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-muted-foreground">
                Videos: {searchedVideos.length}
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-muted-foreground">
                Parking: {searchedParkingPassHosts.length}
              </span>
              {visibleUnclaimed.length > 0 && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800">
                  Unclaimed: {visibleUnclaimed.length}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Restaurants Section (when searching) */}
        {searchQuery && mergedRestaurants.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Restaurants & Food Trucks
              </h2>
              <span className="text-sm text-muted-foreground">
                {mergedRestaurants.length} found
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {mergedRestaurants.map((restaurant: any) => (
                <div
                  key={restaurant.id}
                  onPointerDown={() => {
                    trackUxEvent("search_restaurant_card_clicked", {
                      restaurantId: String(restaurant.id),
                      searchQuery: searchQuery || null,
                      surface: "search_results",
                    });
                  }}
                >
                  <RestaurantCard
                    restaurant={{
                      id: String(restaurant.id),
                      name: String(restaurant.name || "Local Spot"),
                      address: String(restaurant.address || ""),
                      cuisineType: String(restaurant.cuisineType || ""),
                      isActive:
                        typeof restaurant.isActive === "boolean"
                          ? restaurant.isActive
                          : undefined,
                      isVerified: Boolean(restaurant.isVerified),
                      isFoodTruck: Boolean(
                        restaurant.isFoodTruck ||
                        restaurant.businessType === "food_truck" ||
                        restaurant.type === "food_truck",
                      ),
                      rating:
                        typeof restaurant.rating === "number"
                          ? restaurant.rating
                          : null,
                      operatingHours:
                        restaurant.operatingHours ??
                        restaurant.businessHours ??
                        null,
                      mobileOnline: Boolean(restaurant.mobileOnline),
                      currentLatitude:
                        typeof restaurant.currentLatitude === "number"
                          ? restaurant.currentLatitude
                          : undefined,
                      currentLongitude:
                        typeof restaurant.currentLongitude === "number"
                          ? restaurant.currentLongitude
                          : undefined,
                      lastBroadcastAt:
                        typeof restaurant.lastBroadcastAt === "string"
                          ? restaurant.lastBroadcastAt
                          : undefined,
                      distance:
                        typeof restaurant.distance === "number"
                          ? restaurant.distance
                          : undefined,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {searchQuery && searchedParkingPassHosts.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Parking Pass Spots
              </h2>
              <span className="text-sm text-muted-foreground">
                {searchedParkingPassHosts.length} found
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchedParkingPassHosts.map((host: any) => {
                const q =
                  `${host.address || ""}${host.city ? `, ${host.city}` : ""}${host.state ? `, ${host.state}` : ""}`.trim();
                return (
                  <Link
                    key={host.hostId}
                    href={`/parking-pass${q ? `?q=${encodeURIComponent(q)}` : ""}`}
                    data-testid={`card-parking-pass-${host.hostId}`}
                  >
                    <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground truncate">
                              {host.businessName || "Parking Pass spot"}
                            </h3>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate">{q}</span>
                            </p>
                          </div>
                          <div className="text-xs rounded-full bg-primary/10 text-primary px-2 py-1">
                            Bookable
                          </div>
                        </div>
                        {host.spotImageUrl ? (
                          <img
                            src={host.spotImageUrl}
                            alt="Parking spot"
                            className="w-full h-28 object-cover rounded-md border"
                            loading="lazy"
                          />
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {searchQuery && searchedVideos.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-foreground">Videos</h2>
              <span className="text-sm text-muted-foreground">
                {searchedVideos.length} found
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchedVideos.map((story: any) => (
                <Link
                  key={story.id}
                  href={`/video/${story.id}`}
                  data-testid={`card-video-${story.id}`}
                >
                  <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer">
                    <CardContent className="p-4 space-y-1">
                      <div className="font-semibold text-foreground truncate">
                        {story.title || "Video"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {story.restaurantName
                          ? `From ${story.restaurantName}`
                          : "Video story"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {searchQuery && searchedEvents.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-foreground">Events</h2>
              <span className="text-sm text-muted-foreground">
                {searchedEvents.length} found
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchedEvents.map((event: any) => (
                <Link
                  key={event.id}
                  href="/events"
                  data-testid={`card-event-${event.id}`}
                >
                  <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer">
                    <CardContent className="p-4 space-y-1">
                      <div className="font-semibold text-foreground truncate">
                        {event.name || event.hostBusinessName || "Event"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {event.hostBusinessName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {event.hostCity}
                        {event.hostState ? `, ${event.hostState}` : ""}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {searchQuery && visibleUnclaimed.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Not on MealScout yet
              </h2>
              <span className="text-sm text-muted-foreground">
                {visibleUnclaimed.length} unclaimed
              </span>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              We found{" "}
              {visibleUnclaimed.length === 1 ? "this place" : "these places"} on
              the web. Help us list{" "}
              {visibleUnclaimed.length === 1 ? "it" : "them"} by claiming the
              profile.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleUnclaimed.map((listing: any) => {
                const locationLine = [listing.city, listing.state]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <Link
                    key={listing.id}
                    href={`/truck-onboarding?claim=1&q=${encodeURIComponent(listing.name || "")}&listingId=${encodeURIComponent(listing.id)}`}
                    data-testid={`card-unclaimed-${listing.id}`}
                  >
                    <Card className="border-amber-200 bg-amber-50/40 shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground truncate">
                              {listing.name}
                            </h3>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {listing.address}
                                {locationLine ? ` • ${locationLine}` : ""}
                              </span>
                            </p>
                          </div>
                          <div className="text-xs rounded-full bg-amber-200/70 text-amber-900 px-2 py-1 whitespace-nowrap">
                            {listing.autoSeeded ? "New" : "Unclaimed"}
                          </div>
                        </div>
                        <div className="text-xs text-amber-900/80">
                          Tap to claim this profile
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Deals Section */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {hasActiveSearch ? "Active Deals" : "Popular Deals"}
            </h2>
            {hasActiveSearch && hasNonDealSearchMatches ? (
              <p className="text-sm text-muted-foreground">
                Deals are shown separately when this place has a live offer.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {filteredDeals.length} deal{filteredDeals.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

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
        ) : filteredDeals.length > 0 ? (
          <div className="space-y-4 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-6 lg:space-y-0">
            {filteredDeals.map((deal: any) => (
              <DealCard
                key={deal.id}
                deal={deal}
                onOpen={(dealId) => {
                  trackUxEvent("search_deal_card_opened", {
                    dealId,
                    searchQuery: hasActiveSearch ? searchQuery : null,
                    surface: hasActiveSearch ? "search_results" : "search_popular",
                  });
                }}
              />
            ))}
          </div>
        ) : hasActiveSearch && hasNonDealSearchMatches ? null : (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-[var(--bg-surface-muted)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-lg text-foreground mb-2">
              {hasActiveSearch && hasNonDealSearchMatches
                ? "No active deals for this search"
                : hasActiveSearch
                  ? "No matches found"
                  : "No popular deals nearby"}
            </h3>
            <p className="text-muted-foreground">
              {hasActiveSearch && hasNonDealSearchMatches
                ? "Matching restaurants, trucks, parking, videos, or events are listed above."
                : hasActiveSearch
                  ? "Try adjusting your search terms to find restaurants, trucks, or deals."
                  : "Open the map or search for a business, cuisine, or truck."}
            </p>
            {didYouMean && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    trackUxEvent("search_did_you_mean_clicked", {
                      fromQuery: searchQuery,
                      suggestion: didYouMean,
                    });
                    setSearchQuery(didYouMean);
                    setLocation(`/search?q=${encodeURIComponent(didYouMean)}`);
                  }}
                  data-testid="button-did-you-mean"
                >
                  Did you mean "{didYouMean}"?
                </Button>
              </div>
            )}
            {hasActiveSearch && (
              <Button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                }}
                className="mt-4"
                data-testid="button-clear-search"
              >
                Clear Search
              </Button>
            )}
            {!userLocation && !isLocating && (
              <Button
                variant="outline"
                onClick={requestUserLocation}
                className="mt-2 ml-2"
                data-testid="button-empty-use-location"
                onPointerDown={() => {
                  trackUxEvent("search_location_request_empty", {
                    surface: "search_empty_state",
                  });
                }}
              >
                Use location
              </Button>
            )}
            <Link href="/deals/featured">
              <Button
                variant="outline"
                className="mt-2 ml-2"
                data-testid="button-empty-featured"
                onPointerDown={() => {
                  trackUxEvent("search_featured_empty", {
                    surface: "search_empty_state",
                  });
                }}
              >
                View featured deals
              </Button>
            </Link>
            <Link href="/map">
              <Button
                variant="outline"
                className="mt-2 ml-2"
                data-testid="button-empty-map"
                onPointerDown={() => {
                  trackUxEvent("search_open_map_empty", {
                    surface: "search_empty_state",
                  });
                }}
              >
                Open map
              </Button>
            </Link>
          </div>
        )}

        <section className="mt-10 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-base font-semibold text-foreground">
            Explore More Food Deals Nearby
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep browsing popular MealScout pages for restaurants, food trucks,
            and local deals.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {searchExploreLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean transition-shadow hover:shadow-clean-lg">
                  <CardContent className="p-4">
                    <div className="font-medium text-foreground">
                      {link.title}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {link.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {trendingLinks.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Trending Searches
              </h3>
              <div className="mt-3 space-y-2">
                {trendingLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {link.title}
                    </span>
                    {link.context ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {link.context}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {!userLocation && !isLocating && (
        <section className="mt-4 md:hidden">
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean">
            <p className="text-xs text-muted-foreground mb-2">
              Use your location for better nearby matches and faster results.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={requestUserLocation}
                data-testid="button-search-inline-location"
                onPointerDown={() => {
                  trackUxEvent("search_location_request_inline", {
                    surface: "search_inline_cta",
                  });
                }}
              >
                Use location
              </Button>
              <Link href="/map">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  data-testid="button-search-inline-map"
                  onPointerDown={() => {
                    trackUxEvent("search_open_map_inline", {
                      surface: "search_inline_cta",
                    });
                  }}
                >
                  Open map
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      <Navigation />
    </div>
  );
}
