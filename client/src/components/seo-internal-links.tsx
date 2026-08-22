import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { apiUrl } from "@/lib/api";
import { buildFoodTrucksCityPath, titleCaseSeoTerm } from "@/lib/seo-city";

type CityIndexItem = {
  id: string;
  name: string;
  slug: string;
  state?: string | null;
  hasFoodTrucks: boolean;
  cuisines: Array<{ slug: string; count: number }>;
  foodCuisines: Array<{ slug: string; count: number }>;
};

type SEOInternalLinksProps = {
  title?: string;
  description?: string;
  maxCities?: number;
  maxCuisineLinksPerCity?: number;
  excludeCitySlug?: string;
};

export function SEOInternalLinks({
  title = "Explore Popular City Pages",
  description = "Discover local landing pages by city and cuisine.",
  maxCities = 8,
  maxCuisineLinksPerCity = 2,
  excludeCitySlug,
}: SEOInternalLinksProps) {
  const { data } = useQuery<CityIndexItem[]>({
    queryKey: ["/api/cities", "seo-internal-links", excludeCitySlug || "all"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/cities"));
      if (!res.ok) throw new Error("Failed to load city index");
      return res.json();
    },
    staleTime: 60_000,
  });

  const cityRows = useMemo(
    () =>
      (Array.isArray(data) ? data : [])
        .filter((city) => city.slug !== excludeCitySlug)
        .slice(0, maxCities),
    [data, excludeCitySlug, maxCities],
  );

  if (cityRows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {cityRows.map((city) => (
          <Card
            key={city.id}
            className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean"
          >
            <CardContent className="p-4 space-y-3">
              <Link href={`/city/${encodeURIComponent(city.slug)}/food`}>
                <div className="font-medium text-foreground hover:text-[color:var(--accent-text)]">
                  Local food in {city.name}
                  {city.state ? `, ${city.state}` : ""}
                </div>
              </Link>
              {city.hasFoodTrucks && (
                <div className="flex flex-wrap gap-2">
                  {(city.cuisines || [])
                    .slice(0, maxCuisineLinksPerCity)
                    .map((cuisine) => (
                      <Link
                        key={`${city.slug}-${cuisine.slug}`}
                        href={buildFoodTrucksCityPath(
                          city.slug,
                          cuisine.slug,
                        )}
                      >
                        <span className="inline-flex rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                          {titleCaseSeoTerm(cuisine.slug)}
                        </span>
                      </Link>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

