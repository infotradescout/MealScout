import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
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

type CategoryMenuItem = {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  cuisineType?: string | null;
  discoveryReasons?: string[] | null;
  discoveryScore?: number | null;
};

const categoryConfig = {
  pizza: {
    title: "Pizza & Italian",
    icon: Pizza,
    gradient: "from-orange-500 to-red-500",
    description: "Delicious pizza and authentic Italian cuisine",
  },
  burgers: {
    title: "Burgers & American",
    icon: Sandwich,
    gradient: "from-red-500 to-yellow-500",
    description: "Juicy burgers and classic American dishes",
  },
  sushi: {
    title: "Sushi & Japanese",
    icon: Fish,
    gradient: "from-red-500 to-pink-500",
    description: "Fresh sushi and authentic Japanese cuisine",
  },
  chinese: {
    title: "Chinese Food",
    icon: Soup,
    gradient: "from-red-600 to-yellow-500",
    description: "Authentic Chinese dishes and flavors",
  },
  mexican: {
    title: "Mexican Food",
    icon: UtensilsCrossed,
    gradient: "from-green-500 to-red-500",
    description: "Tacos, burritos, and Mexican specialties",
  },
  breakfast: {
    title: "Breakfast & Brunch",
    icon: Croissant,
    gradient: "from-yellow-400 to-orange-500",
    description: "Start your day with great breakfast deals",
  },
  seafood: {
    title: "Seafood",
    icon: Fish,
    gradient: "from-blue-500 to-teal-500",
    description: "Fresh catch and seafood specialties",
  },
  bbq: {
    title: "BBQ & Grilled",
    icon: Flame,
    gradient: "from-orange-600 to-red-600",
    description: "Smoky BBQ and grilled meats",
  },
  dessert: {
    title: "Desserts & Sweets",
    icon: Cake,
    gradient: "from-pink-400 to-purple-500",
    description: "Sweet treats and decadent desserts",
  },
  coffee: {
    title: "Coffee & Cafes",
    icon: Coffee,
    gradient: "from-amber-600 to-orange-600",
    description: "Great coffee and cozy cafe atmosphere",
  },
  healthy: {
    title: "Healthy Options",
    icon: Salad,
    gradient: "from-green-400 to-green-600",
    description: "Fresh, nutritious, and delicious healthy meals",
  },
  asian: {
    title: "Asian Cuisine",
    icon: Soup,
    gradient: "from-red-600 to-orange-500",
    description: "Authentic Asian flavors and fresh ingredients",
  },
};

const lower = (value?: string) => String(value || "").toLowerCase();

export default function CategoryPage() {
  const params = useParams() as Record<string, string | undefined>;
  const category = params.category || params.type || "";
  const categoryKey = category as keyof typeof categoryConfig;
  const config = category ? categoryConfig[categoryKey] : null;

  const { data: featuredDeals, isLoading } = useQuery({
    queryKey: ["/api/deals/featured"],
    enabled: true,
  });

  const { data: categoryMenuItemsData = [], isLoading: menuItemsLoading } =
    useQuery<CategoryMenuItem[]>({
      queryKey: ["/api/menus/local-items", category],
      enabled: !!category,
      queryFn: async () => {
        const params = new URLSearchParams({
          category,
          limit: "60",
        });
        const res = await fetch(`/api/menus/local-items?${params.toString()}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.items) ? data.items : [];
      },
      staleTime: 120_000,
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

  const allDeals = Array.isArray(featuredDeals) ? featuredDeals : [];
  const categoryMenuItems = Array.isArray(categoryMenuItemsData)
    ? categoryMenuItemsData
    : [];
  const categoryDeals = allDeals.filter((deal: any) => {
    const cuisineType = lower(deal.restaurant?.cuisineType);
    const title = lower(deal.title);

    switch (categoryKey) {
      case "pizza":
        return (
          cuisineType.includes("pizza") ||
          cuisineType.includes("italian") ||
          title.includes("pizza") ||
          title.includes("pasta")
        );
      case "burgers":
        return (
          cuisineType.includes("american") ||
          cuisineType.includes("burger") ||
          title.includes("burger") ||
          title.includes("sandwich")
        );
      case "sushi":
        return (
          cuisineType.includes("japanese") ||
          cuisineType.includes("sushi") ||
          title.includes("sushi") ||
          title.includes("sashimi")
        );
      case "chinese":
        return (
          cuisineType.includes("chinese") ||
          title.includes("chinese") ||
          title.includes("noodle") ||
          title.includes("fried rice")
        );
      case "asian":
        return (
          cuisineType.includes("asian") ||
          cuisineType.includes("thai") ||
          cuisineType.includes("vietnamese") ||
          title.includes("pho")
        );
      case "mexican":
        return (
          cuisineType.includes("mexican") ||
          title.includes("taco") ||
          title.includes("burrito") ||
          title.includes("enchilada")
        );
      case "breakfast":
        return (
          title.includes("breakfast") ||
          title.includes("brunch") ||
          title.includes("pancake") ||
          title.includes("waffle") ||
          title.includes("eggs")
        );
      case "seafood":
        return (
          cuisineType.includes("seafood") ||
          title.includes("fish") ||
          title.includes("shrimp") ||
          title.includes("lobster") ||
          title.includes("crab")
        );
      case "bbq":
        return (
          cuisineType.includes("bbq") ||
          cuisineType.includes("barbecue") ||
          title.includes("bbq") ||
          title.includes("ribs") ||
          title.includes("brisket")
        );
      case "dessert":
        return (
          title.includes("dessert") ||
          title.includes("ice cream") ||
          title.includes("cake") ||
          title.includes("cookie")
        );
      case "coffee":
        return (
          cuisineType.includes("cafe") ||
          cuisineType.includes("coffee") ||
          title.includes("coffee") ||
          title.includes("latte") ||
          title.includes("espresso")
        );
      case "healthy":
        return (
          title.includes("salad") ||
          title.includes("smoothie") ||
          cuisineType.includes("healthy") ||
          title.includes("bowl")
        );
      default:
        return false;
    }
  });

  const canonicalUrl = `https://www.mealscout.us/category/${encodeURIComponent(category || "")}`;
  const seoTitle = `${config.title} Deals Near You | MealScout`;
  const seoDescription = `Browse ${config.title.toLowerCase()} deals from local restaurants and food trucks on MealScout. Find fresh offers near you today.`;
  const schemaData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `${config.title} Deals`,
        description: seoDescription,
        url: canonicalUrl,
      },
      {
        "@type": "ItemList",
        name: `${config.title} deal list`,
        numberOfItems: categoryDeals.slice(0, 12).length,
        itemListElement: categoryDeals
          .slice(0, 12)
          .map((deal: any, index: number) => ({
            "@type": "ListItem",
            position: index + 1,
            name: deal.title,
            url: `https://www.mealscout.us/deal/${deal.id}`,
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
            {categoryMenuItems.length} menu item
            {categoryMenuItems.length !== 1 ? "s" : ""} found
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
        {isLoading || menuItemsLoading ? (
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
        ) : categoryMenuItems.length > 0 ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
              <h2 className="font-semibold text-foreground">
                Compare {config.title.toLowerCase()} menu items
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These are the actual menu items matching this craving across
                local businesses.
              </p>
            </div>
            {categoryMenuItems.map((item) => {
              const price =
                typeof item.priceCents === "number"
                  ? `$${(item.priceCents / 100).toFixed(item.priceCents % 100 === 0 ? 0 : 2)}`
                  : null;
              return (
                <Link key={item.id} href={`/restaurant/${item.restaurantId}`}>
                  <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean overflow-hidden">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-44 w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {item.name}
                          </h3>
                          <p className="mt-1 text-sm text-primary font-medium">
                            {item.restaurantName || "Local spot"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[item.cuisineType, item.restaurantCity]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {price && (
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                            {price}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {Array.isArray(item.discoveryReasons) &&
                        item.discoveryReasons.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.discoveryReasons.slice(0, 3).map((reason) => (
                              <span
                                key={reason}
                                className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : categoryDeals.length > 0 ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
              <h2 className="font-semibold text-foreground">
                Deals matching {config.title.toLowerCase()}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No matching menu items yet, so we are showing relevant deals.
              </p>
            </div>
            {categoryDeals.map((deal: any) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
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
              No {config.title} deals yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Check back soon for {config.title.toLowerCase()} menu items and deals.
            </p>
            <Link href="/search">
              <Button data-testid="button-browse-all">Browse All Deals</Button>
            </Link>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
          <h2 className="text-base font-semibold text-foreground">
            Explore More MealScout Pages
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/search">
              <Button variant="outline" size="sm">
                Search all deals
              </Button>
            </Link>
            <Link href="/deals/featured">
              <Button variant="outline" size="sm">
                Featured deals
              </Button>
            </Link>
            <Link href="/scout">
              <Button variant="outline" size="sm">
                Open Scout
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
