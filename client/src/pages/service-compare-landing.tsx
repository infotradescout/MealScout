import { Link, useParams } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Scale, MapPin, UtensilsCrossed } from "lucide-react";

const titleCase = (value: string) =>
  String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const servicePathMap: Record<string, string> = {
  doordash: "/compare/doordash",
  "uber-eats": "/compare/uber-eats",
  grubhub: "/compare/grubhub",
};

export default function ServiceCompareLandingPage() {
  const params = useParams() as Record<string, string | undefined>;
  const serviceSlug = String(params.service || "doordash").toLowerCase();
  const citySlug = String(params.city || "your-city").toLowerCase();
  const cuisineSlug = String(params.cuisine || "food").toLowerCase();

  const serviceName = titleCase(serviceSlug);
  const cityName = titleCase(citySlug);
  const cuisineName = titleCase(cuisineSlug);
  const serviceComparePath = servicePathMap[serviceSlug] || "/compare";
  const canonicalPath = `/compare/${serviceSlug}/local/${citySlug}/${cuisineSlug}`;

  const schemaData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${cuisineName} delivery alternatives in ${cityName}`,
    description: `Compare MealScout vs ${serviceName} for ${cuisineName} in ${cityName}.`,
    url: `https://www.mealscout.us${canonicalPath}`,
  };

  return (
    <div className="max-w-4xl mx-auto min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title={`${cuisineName} In ${cityName}: MealScout vs ${serviceName}`}
        description={`Compare MealScout with ${serviceName} for ${cuisineName} in ${cityName}. Local ranking based on community favorites, follows, recommendations, deals, and location.`}
        canonicalUrl={`https://www.mealscout.us${canonicalPath}`}
        schemaData={schemaData}
      />
      <BackHeader
        title="Local Comparison"
        fallbackHref="/compare"
        icon={Scale}
      />

      <div className="px-4 py-8 space-y-5">
        <h1 className="text-3xl font-bold text-foreground">
          {cuisineName} in {cityName}: MealScout vs {serviceName}
        </h1>
        <p className="text-[color:var(--text-secondary)]">
          MealScout prioritizes community trust signals first: favorites,
          recommendations, follows, active deals, and proximity.
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <MapPin className="w-4 h-4 mb-2 text-[color:var(--accent-text)]" />
              <p className="text-sm font-semibold">City relevance</p>
              <p className="text-xs text-muted-foreground">
                Built for {cityName} discovery and local visibility.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <UtensilsCrossed className="w-4 h-4 mb-2 text-[color:var(--accent-text)]" />
              <p className="text-sm font-semibold">Cuisine focus</p>
              <p className="text-xs text-muted-foreground">
                Better discovery for {cuisineName} with video recommendations.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Scale className="w-4 h-4 mb-2 text-[color:var(--accent-text)]" />
              <p className="text-sm font-semibold">Transparent ranking</p>
              <p className="text-xs text-muted-foreground">
                No pay-to-top placement for small businesses.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={serviceComparePath}>
            <Button variant="outline">Compare Against {serviceName}</Button>
          </Link>
          <Link href={`/food-trucks/${citySlug}/${cuisineSlug}`}>
            <Button variant="outline">Explore {cuisineName} In {cityName}</Button>
          </Link>
          <Link href="/delivery-app-alternatives">
            <Button>See All Alternatives</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
