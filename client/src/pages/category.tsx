import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import RestaurantCard from "@/components/restaurant-card";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/seo-head";
import {
  ArrowLeft,
  Filter,
  SlidersHorizontal,
  Pizza,
  Sandwich,
  UtensilsCrossed,
  Coffee,
  Salad,
  Fish,
  Cake,
  Croissant,
  Soup,
  Flame,
} from "lucide-react";
import { readDeviceLocation } from "@/lib/device-location";

const categoryConfig = {
  pizza: {
    title: "Pizza & Italian",
    searchTerms: ["pizza", "italian", "pasta"],
    icon: Pizza,
    gradient: "from-orange-500 to-red-500",
    description: "Delicious pizza and authentic Italian cuisine",
  },
  burgers: {
    title: "Burgers & American",
    searchTerms: ["burger", "burgers", "american", "sandwich"],
    icon: Sandwich,
    gradient: "from-red-500 to-yellow-500",
    description: "Juicy burgers and classic American dishes",
  },
  sushi: {
    title: "Sushi & Japanese",
    searchTerms: ["sushi", "japanese", "sashimi"],
    icon: Fish,
    gradient: "from-red-500 to-pink-500",
    description: "Fresh sushi and authentic Japanese cuisine",
  },
  chinese: {
    title: "Chinese Food",
    searchTerms: ["chinese", "noodle", "fried rice"],
    icon: Soup,
    gradient: "from-red-600 to-yellow-500",
    description: "Authentic Chinese dishes and flavors",
  },
  mexican: {
    title: "Mexican Food",
    searchTerms: ["mexican", "taco", "burrito"],
    icon: UtensilsCrossed,
    gradient: "from-green-500 to-red-500",
    description: "Tacos, burritos, and Mexican specialties",
  },
  breakfast: {
    title: "Breakfast & Brunch",
    searchTerms: ["breakfast", "brunch", "pancake"],
    icon: Croissant,
    gradient: "from-yellow-400 to-orange-500",
    description: "Start your day with great breakfast and brunch spots",
  },
  seafood: {
    title: "Seafood",
    searchTerms: ["seafood", "fish", "shrimp"],
    icon: Fish,
    gradient: "from-blue-500 to-teal-500",
    description: "Fresh catch and seafood specialties",
  },
  bbq: {
    title: "BBQ & Grilled",
    searchTerms: ["bbq", "barbecue", "brisket", "ribs"],
    icon: Flame,
    gradient: "from-orange-600 to-red-600",
    description: "Smoky BBQ and grilled meats",
  },
  dessert: {
    title: "Desserts & Sweets",
    searchTerms: ["dessert", "sweets", "ice cream", "cake"],
    icon: Cake,
    gradient: "from-pink-400 to-purple-500",
    description: "Sweet treats and decadent desserts",
  },
  coffee: {
    title: "Coffee & Cafes",
    searchTerms: ["coffee", "cafe", "latte"],
    icon: Coffee,
    gradient: "from-amber-600 to-orange-600",
    description: "Great coffee and cozy cafe atmosphere",
  },
  healthy: {
    title: "Healthy Options",
    searchTerms: ["healthy", "salad", "smoothie", "bowl"],
    icon: Salad,
    gradient: "from-green-400 to-green-600",
    description: "Fresh, nutritious, and delicious healthy meals",
  },
  asian: {
    title: "Asian Cuisine",
    searchTerms: ["asian", "thai", "vietnamese", "pho"],
    icon: Soup,
    gradient: "from-red-600 to-orange-500",
    description: "Authentic Asian flavors and fresh ingredients",
  },
};

const categorySearchTerms = (
  config: (typeof categoryConfig)[keyof typeof categoryConfig],
) =>
  "searchTerms" in config && Array.isArray(config.searchTerms)
    ? config.searchTerms
    : [config.title];

const normalizeRestaurantForCard = (restaurant: any) => {
  const id = String(restaurant.id || "").trim();
  const name = String(restaurant.name || "").trim();

  if (!id || !name) return null;

  return {
    id,
    name,
    address: String(restaurant.address || ""),
    city: restaurant.city || null,
    state: restaurant.state || null,
    cuisineType: String(restaurant.cuisineType || ""),
    businessType: restaurant.businessType || null,
    description: restaurant.description || null,
    logoUrl: restaurant.logoUrl || null,
    coverImageUrl: restaurant.coverImageUrl || null,
    facebookCoverUrl: restaurant.facebookCoverUrl || null,
    facebookPhotos: restaurant.facebookPhotos || null,
    googlePhotos: restaurant.googlePhotos || null,
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
    rating: typeof restaurant.rating === "number" ? restaurant.rating : null,
    operatingHours:
      restaurant.operatingHours ?? restaurant.businessHours ?? null,
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
      typeof restaurant.distance === "number" ? restaurant.distance : undefined,
  };
};

export default function CategoryPage() {
  const params = useParams() as Record<string, string | undefined>;
  const category = params.category || params.type || "";
  const categoryKey = category as keyof typeof categoryConfig;
  const config = category ? categoryConfig[categoryKey] : null;

  const searchTerms = config ? categorySearchTerms(config) : [];
  const deviceLocation = useMemo(() => readDeviceLocation(), []);
  const hasLocalContext = Boolean(deviceLocation);

  const { data: categorySearchResults, isLoading: restaurantsLoading } =
    useQuery({
      queryKey: [
        "/api/search",
        searchTerms,
        "category",
        categoryKey,
        deviceLocation?.lat,
        deviceLocation?.lng,
      ],
      queryFn: async () => {
        if (!deviceLocation) {
          return {
            restaurantMap: new Map<string, any>(),
            dealMap: new Map<string, any>(),
          };
        }

        const responses = await Promise.allSettled(
          searchTerms.map(async (term) => {
            const params = new URLSearchParams({
              q: term,
              lat: String(deviceLocation.lat),
              lng: String(deviceLocation.lng),
              localOnly: "1",
              radiusKm: "80",
            });
            const response = await fetch(`/api/search?${params}`);
            if (!response.ok) throw new Error("Failed to search category");
            return response.json();
          }),
        );

        return responses.reduce(
          (merged, result) => {
            if (result.status !== "fulfilled") return merged;
            const restaurants = Array.isArray(result.value?.restaurants)
              ? result.value.restaurants
              : [];
            const deals = Array.isArray(result.value?.deals)
              ? result.value.deals
              : [];

            restaurants.forEach((restaurant: any) => {
              const id = String(restaurant?.id || "").trim();
              if (id) merged.restaurantMap.set(id, restaurant);
            });
            deals.forEach((deal: any) => {
              const id = String(deal?.id || "").trim();
              if (id) merged.dealMap.set(id, deal);
            });

            return merged;
          },
          {
            restaurantMap: new Map<string, any>(),
            dealMap: new Map<string, any>(),
          },
        );
      },
      enabled: Boolean(config && searchTerms.length > 0 && hasLocalContext),
      retry: false,
      staleTime: 30_000,
    });

  if (!config) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <h2 className="text-xl font-bold mb-4">Category not found</h2>
          <Link href="/">
            <Button>Back to Home</Button>
          </Link>
        </div>
        <Navigation />
      </div>
    );
  }

  const searchedRestaurants =
    hasLocalContext && categorySearchResults?.restaurantMap
      ? Array.from(categorySearchResults.restaurantMap.values())
      : [];
  const searchedDeals =
    hasLocalContext && categorySearchResults?.dealMap
      ? Array.from(categorySearchResults.dealMap.values())
      : [];
  const displayDeals = searchedDeals;
  const displayRestaurants = searchedRestaurants
    .map(normalizeRestaurantForCard)
    .filter(Boolean)
    .slice(0, 24);
  const totalResults = displayRestaurants.length + displayDeals.length;
  const isLoading = hasLocalContext && restaurantsLoading;

  const canonicalUrl = `https://www.mealscout.us/category/${encodeURIComponent(category || "")}`;
  const seoTitle = `${config.title} Restaurants, Food Trucks & Deals Near You | MealScout`;
  const seoDescription = `Browse ${config.title.toLowerCase()} restaurants, food trucks, and deals on MealScout. Find real matching places and active offers near you.`;
  const schemaData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `${config.title} Restaurants, Food Trucks & Deals`,
        description: seoDescription,
        url: canonicalUrl,
      },
      {
        "@type": "ItemList",
        name: `${config.title} result list`,
        numberOfItems: totalResults,
        itemListElement: [
          ...displayRestaurants.map((restaurant: any) => ({
            id: restaurant.id,
            name: restaurant.name,
            url: `https://www.mealscout.us/restaurant/${restaurant.id}`,
          })),
          ...displayDeals.map((deal: any) => ({
            id: deal.id,
            name: deal.title,
            url: `https://www.mealscout.us/deal/${deal.id}`,
          })),
        ]
          .slice(0, 12)
          .map((item: any, index: number) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            url: item.url,
          })),
      },
    ],
  };

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={canonicalUrl}
        schemaData={schemaData}
      />

      <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean">
        <div className="flex items-center mb-6">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="mr-3 -ml-2"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center">
            <div
              className={`w-8 h-8 bg-gradient-to-r ${config.gradient} rounded-lg flex items-center justify-center mr-3 shadow-clean`}
            >
              <config.icon className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1
                className={`text-xl font-bold bg-gradient-to-r ${config.gradient} text-transparent bg-clip-text`}
              >
                {config.title}
              </h1>
              <p className="text-sm text-muted-foreground">
                {config.description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {totalResults} result{totalResults !== 1 ? "s" : ""} found
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" data-testid="button-sort">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Sort
            </Button>
            <Button variant="outline" size="sm" data-testid="button-filter">
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-6">
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
        ) : totalResults > 0 ? (
          <div className="space-y-8">
            {displayRestaurants.length > 0 ? (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    Restaurants & Food Trucks
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {displayRestaurants.length} found
                  </span>
                </div>
                <div className="space-y-4">
                  {displayRestaurants.map((restaurant: any) => (
                    <RestaurantCard
                      key={restaurant.id}
                      restaurant={restaurant}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {displayDeals.length > 0 ? (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    Active Deals
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {displayDeals.length} found
                  </span>
                </div>
                <div className="space-y-4">
                  {displayDeals.map((deal: any) => (
                    <DealCard key={deal.id} deal={deal} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="text-center py-12">
            <div
              className={`w-20 h-20 bg-gradient-to-r ${config.gradient} rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-20`}
            >
              <config.icon className="w-6 h-6 text-white" />
            </div>
            <h3
              className={`font-bold text-lg bg-gradient-to-r ${config.gradient} text-transparent bg-clip-text mb-2`}
            >
              {hasLocalContext
                ? `No local ${config.title} results yet`
                : "Choose a location first"}
            </h3>
            <p className="text-muted-foreground mb-6">
              {hasLocalContext
                ? "No matching restaurants, trucks, or active deals are listed near your saved location yet."
                : "MealScout will not mix unrelated markets on category pages. Open the map or search with a city to see nearby matches."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/search">
                <Button data-testid="button-browse-all">Search all food</Button>
              </Link>
              <Link href="/map">
                <Button variant="outline" data-testid="button-open-map">
                  Open map
                </Button>
              </Link>
            </div>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
          <h2 className="text-base font-semibold text-foreground">
            Explore More MealScout Pages
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/search">
              <Button variant="outline" size="sm">
                Search all food
              </Button>
            </Link>
            <Link href="/deals/featured">
              <Button variant="outline" size="sm">
                Featured food
              </Button>
            </Link>
            <Link href="/map">
              <Button variant="outline" size="sm">
                Open map
              </Button>
            </Link>
            <Link href="/food-trucks/new-york">
              <Button variant="outline" size="sm">
                City pages
              </Button>
            </Link>
          </div>
        </section>
      </div>

      <Navigation />
    </div>
  );
}
