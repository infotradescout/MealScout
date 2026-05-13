import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { generateItemListSchema, generatePlaceSchema } from "@/lib/schema-helpers";
import { formatRelativeTime } from "@/lib/relative-time";
import { parseISO } from "date-fns";

type TimeKey = "now" | "tonight";

const MODE_TO_TIME: Record<string, TimeKey> = {
  "food-trucks-now": "now",
  "food-trucks-tonight": "tonight",
};

export default function LocationDiscoveryPage() {
  const params = useParams() as Record<string, string | undefined>;
  const hostSlug = params.slug || "";
  const hostId = extractUuidFromSlug(hostSlug);
  const mode = String(params.mode || "").trim();
  const timeKey = MODE_TO_TIME[mode] || null;

  const endpoint = useMemo(() => {
    if (!hostId || !timeKey) return null;
    return apiUrl(
      `/api/public/discovery/location/${encodeURIComponent(hostId)}/time/${encodeURIComponent(timeKey)}`,
    );
  }, [hostId, timeKey]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["location-discovery", hostId, timeKey],
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

  const locationName = String(data?.location?.name || "Location");
  const city = String(data?.location?.city || "");
  const state = String(data?.location?.state || "");
  const title = timeKey === "tonight" ? `Food trucks tonight at ${locationName}` : `Food trucks now at ${locationName}`;
  const description = `Live food truck schedule for ${locationName}${city ? ` in ${city}` : ""}.`;
  const canonicalUrl = hostId && timeKey ? `https://www.mealscout.us/location/${encodeURIComponent(hostSlug)}/food-trucks-${timeKey}` : undefined;

  const baseLocationPath = `/location/${encodeURIComponent(hostSlug)}`;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={canonicalUrl}
        schemaData={
          data?.location?.id
            ? {
                "@context": "https://schema.org",
                "@graph": [
                  generatePlaceSchema({
                    id: data.location.id,
                    name: locationName,
                    url: `https://www.mealscout.us${baseLocationPath}`,
                    address: data.location.address || undefined,
                    city: city || undefined,
                    state: state || undefined,
                    latitude: data.location.latitude ?? undefined,
                    longitude: data.location.longitude ?? undefined,
                  }),
                  Array.isArray(data?.trucks)
                    ? generateItemListSchema(
                        data.trucks.map((t: any) => ({
                          id: String(t.id || ""),
                          name: String(t.name || "Food truck"),
                          url: t.truckPath ? `https://www.mealscout.us${t.truckPath}` : undefined,
                        })),
                        title,
                      )
                    : {},
                ],
              }
            : undefined
        }
      />

      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground">
            {locationName}
            {city ? ` · ${city}` : ""}
            {state ? `, ${state}` : ""}
            {" · "}
            <Link href={baseLocationPath} className="underline">
              View location page
            </Link>
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" asChild>
              <a href={`${baseLocationPath}/food-trucks-now`}>Now</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`${baseLocationPath}/food-trucks-tonight`}>Tonight</a>
            </Button>
            <Button asChild>
              <a href="/parking-pass">Book a spot</a>
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>
                {isLoading ? "Loading..." : data?.totalTrucks != null ? `${data.totalTrucks} trucks` : "Trucks"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="text-sm text-destructive">
                  {(error as any)?.message || "Failed to load trucks."}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data?.trucks || []).map((truck: any) => (
                  <Card key={truck.id}>
                    <CardContent className="pt-6 flex flex-col gap-2">
                      <div className="font-semibold">
                        <a href={truck.truckPath} className="underline">
                          {truck.name}
                        </a>
                      </div>
                      {truck.cuisineType ? (
                        <div className="text-sm text-muted-foreground">{truck.cuisineType}</div>
                      ) : null}
                      {(truck.schedules || []).slice(0, 2).map((s: any, idx: number) => {
                        const dateText = s.date
                          ? (String(s.date).includes("T")
                              ? new Date(s.date)
                              : parseISO(String(s.date))
                            ).toLocaleDateString()
                          : "";
                        const timeText = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "";
                        const confirmedAgo =
                          typeof s.lastConfirmedAt === "string"
                            ? formatRelativeTime(s.lastConfirmedAt)
                            : null;
                        return (
                          <div key={`${truck.id}:${idx}`} className="text-sm">
                            <div className="text-muted-foreground">
                              {dateText} {timeText ? `· ${timeText}` : ""}
                            </div>
                            {confirmedAgo ? (
                              <div className="text-xs text-muted-foreground">
                                Last confirmed: {confirmedAgo}
                              </div>
                            ) : null}
                            {s.eventPath ? (
                              <div>
                                <a className="underline" href={s.eventPath}>
                                  View event
                                </a>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {!isLoading && Array.isArray(data?.trucks) && data.trucks.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No trucks are listed for this time window yet.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
