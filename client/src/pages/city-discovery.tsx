import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { apiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generateItemListSchema } from "@/lib/schema-helpers";
import { formatRelativeTime } from "@/lib/relative-time";
import { eventNumericDateLabel } from "@/lib/event-date-labels";

type TimeKey = "now" | "breakfast" | "lunch" | "dinner" | "tonight" | "this-weekend";

const TIME_MODES: Record<string, TimeKey> = {
  "food-trucks-now": "now",
  "food-trucks-breakfast": "breakfast",
  "food-trucks-lunch": "lunch",
  "food-trucks-dinner": "dinner",
  "food-trucks-tonight": "tonight",
  "food-trucks-this-weekend": "this-weekend",
};

function humanizeTimeKey(key: TimeKey) {
  switch (key) {
    case "now":
      return "Food trucks now";
    case "breakfast":
      return "Breakfast food trucks";
    case "lunch":
      return "Lunch food trucks";
    case "dinner":
      return "Dinner food trucks";
    case "tonight":
      return "Food trucks tonight";
    case "this-weekend":
      return "Food trucks this weekend";
    default:
      return "Food trucks";
  }
}

export default function CityDiscoveryPage() {
  const params = useParams() as Record<string, string | undefined>;
  const citySlug = String(params.city || "").trim();
  const mode = String(params.mode || "").trim();

  const timeKey = TIME_MODES[mode] || null;
  const cuisineSlug = !timeKey && mode.endsWith("-trucks") ? mode.replace(/-trucks$/, "") : null;

  const endpoint = useMemo(() => {
    if (!citySlug) return null;
    if (timeKey) {
      return apiUrl(
        `/api/public/discovery/city/${encodeURIComponent(citySlug)}/time/${encodeURIComponent(timeKey)}`,
      );
    }
    if (cuisineSlug) {
      return apiUrl(
        `/api/public/discovery/city/${encodeURIComponent(citySlug)}/cuisine/${encodeURIComponent(cuisineSlug)}`,
      );
    }
    return null;
  }, [citySlug, timeKey, cuisineSlug]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["city-discovery", citySlug, mode],
    enabled: Boolean(endpoint),
    queryFn: async () => {
      const res = await fetch(String(endpoint), { credentials: "include" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || `Request failed (status=${res.status})`);
      }
      return res.json() as any;
    },
    staleTime: 30_000,
  });

  const title = useMemo(() => {
    if (timeKey && data?.city?.name) return `${humanizeTimeKey(timeKey)} in ${data.city.name}`;
    if (cuisineSlug && data?.city?.name) return `${cuisineSlug.replace(/-/g, " ")} trucks in ${data.city.name}`;
    if (timeKey) return humanizeTimeKey(timeKey);
    if (cuisineSlug) return `${cuisineSlug.replace(/-/g, " ")} trucks`;
    return "City discovery";
  }, [timeKey, cuisineSlug, data?.city?.name]);

  const canonicalUrl = useMemo(() => {
    if (!citySlug || !mode) return null;
    return `https://www.mealscout.us/city/${encodeURIComponent(citySlug)}/${encodeURIComponent(mode)}`;
  }, [citySlug, mode]);

  const intro = useMemo(() => {
    if (timeKey && data?.city?.name) {
      return `Live schedule-based discovery for ${data.city.name}.`;
    }
    if (cuisineSlug && data?.city?.name) {
      return `Find ${cuisineSlug.replace(/-/g, " ")} food trucks in ${data.city.name}.`;
    }
    return "Find food trucks by city, time, and cuisine.";
  }, [timeKey, cuisineSlug, data?.city?.name]);

  const cityName = String(data?.city?.name || citySlug);
  const cityState = String(data?.city?.state || "");

  const timeLinks = useMemo(() => {
    const base = `/city/${encodeURIComponent(citySlug)}`;
    return [
      { href: `${base}/food-trucks-now`, label: "Now" },
      { href: `${base}/food-trucks-breakfast`, label: "Breakfast" },
      { href: `${base}/food-trucks-lunch`, label: "Lunch" },
      { href: `${base}/food-trucks-dinner`, label: "Dinner" },
      { href: `${base}/food-trucks-tonight`, label: "Tonight" },
      { href: `${base}/food-trucks-this-weekend`, label: "This weekend" },
    ];
  }, [citySlug]);

  const isValidMode = Boolean(endpoint);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={title}
        description={intro}
        canonicalUrl={canonicalUrl || undefined}
        schemaData={
          Array.isArray(data?.trucks)
            ? generateItemListSchema(
                data.trucks.map((t: any) => ({
                  id: String(t.id || ""),
                  name: String(t.name || "Food truck"),
                  url: t.truckPath ? `https://www.mealscout.us${t.truckPath}` : undefined,
                })),
                `${title} in ${cityName}${cityState ? `, ${cityState}` : ""}`,
              )
            : undefined
        }
      />

      <div className="max-w-5xl mx-auto px-4 py-10">
        {!isValidMode ? (
          <div className="text-sm text-muted-foreground">
            Unknown discovery page.
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground">
            {intro}{" "}
            <Link href={`/city/${encodeURIComponent(citySlug)}`} className="underline">
              Browse all in {cityName}
              {cityState ? `, ${cityState}` : ""}
            </Link>
            .
          </p>

          <div className="flex gap-2 flex-wrap items-center">
            {timeLinks.map((item) => (
              <Button key={item.href} variant="outline" asChild>
                <a href={item.href}>{item.label}</a>
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>
                {isLoading
                  ? "Loading..."
                  : data?.totalTrucks != null
                    ? `${data.totalTrucks} results`
                    : "Results"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="text-sm text-destructive">
                  {(error as any)?.message || "Failed to load discovery results."}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data?.trucks || []).map((truck: any) => (
                  <Card key={truck.id} className="overflow-hidden">
                    <CardContent className="pt-6">
                      <div className="flex flex-col gap-2">
                        <div className="font-semibold">
                          <a href={truck.truckPath} className="underline">
                            {truck.name}
                          </a>
                        </div>
                        {truck.cuisineType ? (
                          <div className="text-sm text-muted-foreground">
                            {truck.cuisineType}
                          </div>
                        ) : null}

                        <div className="mt-2 flex flex-col gap-2">
                          {(truck.schedules || []).slice(0, 3).map((s: any, idx: number) => {
                            const dateText = eventNumericDateLabel(s.date);
                            const place = s.locationName || "Location";
                            const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "";
                            const confirmedAgo =
                              typeof s.lastConfirmedAt === "string"
                                ? formatRelativeTime(s.lastConfirmedAt)
                                : null;
                            return (
                              <div key={`${truck.id}:${idx}`} className="text-sm">
                                <span className="text-muted-foreground">
                                  {dateText} {time ? `· ${time}` : ""}
                                </span>
                                <div>
                                  {s.locationPath ? (
                                    <a href={s.locationPath} className="underline">
                                      {place}
                                    </a>
                                  ) : (
                                    <span>{place}</span>
                                  )}
                                </div>
                                {confirmedAgo ? (
                                  <div className="text-xs text-muted-foreground">
                                    Last confirmed: {confirmedAgo}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex gap-2 flex-wrap">
                          <Button asChild>
                            <a href={truck.truckPath}>View truck</a>
                          </Button>
                          <Button variant="outline" asChild>
                            <a href={`/search?city=${encodeURIComponent(citySlug)}`}>Search</a>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
