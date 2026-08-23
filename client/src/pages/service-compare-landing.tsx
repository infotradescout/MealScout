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
    name: `${cuisineName} discovery options in ${cityName}`,
    description: `Understand MealScout's early local discovery experience alongside ${serviceName} for ${cuisineName} in ${cityName}.`,
    url: `https://www.mealscout.us${canonicalPath}`,
  };

  return (
    <div className="max-w-4xl mx-auto min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title={`${cuisineName} In ${cityName}: MealScout vs ${serviceName}`}
        description={`MealScout is an early local discovery product. It does not match ${serviceName}'s delivery marketplace; limited eligible listings may offer pickup.`}
        canonicalUrl={`https://www.mealscout.us${canonicalPath}`}
        schemaData={schemaData}
        noIndex
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
          MealScout is an early local discovery product, not a delivery
          marketplace replacement. Coverage varies by city, and only a limited
          set of separately approved businesses may offer native card pickup.
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
                Browse available {cuisineName} profiles and community activity;
                results depend on the data currently published in MealScout.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Scale className="w-4 h-4 mb-2 text-[color:var(--accent-text)]" />
              <p className="text-sm font-semibold">Placement context</p>
              <p className="text-xs text-muted-foreground">
                MealScout does not promise placement neutrality. Review each
                profile, source label, and promotion context before deciding.
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
