import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { apiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { generateEventSchema } from "@/lib/schema-helpers";
import { useAuth } from "@/hooks/useAuth";
import { EventBookingModal } from "@/components/event-booking-modal";

type PublicEvent = {
  id: string;
  title: string;
  description?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  status?: string | null;
  requiresPayment?: boolean;
  hostPriceCents?: number | null;
  host: {
    id: string;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    path?: string | null;
  };
  truck?: {
    id: string;
    name?: string | null;
    cuisineType?: string | null;
    path?: string | null;
  } | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  ended?: boolean;
  lastConfirmedAtUtc?: string | null;
};

export default function EventDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const eventParam = params.slug || params.id || "";
  const eventId = extractUuidFromSlug(eventParam) || eventParam;
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [truckId, setTruckId] = useState<string | null>(null);

  // Load the truck for the logged-in food truck user
  useEffect(() => {
    if (!isAuthenticated) {
      setTruckId(null);
      return;
    }
    if (
      user?.userType !== "food_truck" &&
      user?.userType !== "restaurant_owner"
    ) {
      return;
    }
    fetch("/api/restaurants/my-restaurants")
      .then((r) => (r.ok ? r.json() : null))
      .then((trucks) => {
        if (Array.isArray(trucks) && trucks.length > 0) {
          const ft = trucks.find((t: any) => t.isFoodTruck) || trucks[0];
          setTruckId(ft.id);
        }
      })
      .catch(() => {});
  }, [isAuthenticated, user?.userType]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-event", eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/events/${encodeURIComponent(String(eventId))}`),
        {
          credentials: "include",
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message || `Failed to load event (status=${res.status})`,
        );
      }
      return (await res.json()) as PublicEvent;
    },
    staleTime: 30_000,
  });

  const { data: canonical } = useQuery({
    queryKey: ["public-canonical-event", eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/public/canonical/event/${encodeURIComponent(String(eventId))}`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message ||
            `Failed to load canonical event data (status=${res.status})`,
        );
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: evidence } = useQuery({
    queryKey: ["public-event-evidence", eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/public/evidence/event/${encodeURIComponent(String(eventId))}`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message ||
            `Failed to load event evidence (status=${res.status})`,
        );
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const dateText = data?.date ? new Date(data.date).toLocaleDateString() : null;
  const timeText =
    data?.startTime && data?.endTime
      ? `${data.startTime}–${data.endTime}`
      : null;

  const canBook =
    isAuthenticated &&
    Boolean(truckId) &&
    data?.requiresPayment === true &&
    data?.status === "open" &&
    !data?.ended;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={data?.title || "Event"}
        description={
          data?.description || "Food truck event details on MealScout."
        }
        canonicalUrl={data?.canonicalUrl || undefined}
        noIndex={Boolean(data?.noIndex)}
        schemaData={
          data?.id && data?.date
            ? [
                generateEventSchema({
                  id: data.id,
                  name: data.title,
                  description: data.description || null,
                  startDate: data.date,
                  url: data.canonicalUrl || undefined,
                  location: data.host
                    ? {
                        id: data.host.id,
                        name: data.host.name || "Location",
                        address: data.host.address || undefined,
                        city: data.host.city || undefined,
                        state: data.host.state || undefined,
                        url: data.host.path
                          ? `https://www.mealscout.us${data.host.path}`
                          : undefined,
                      }
                    : undefined,
                }),
                {
                  "@context": "https://schema.org",
                  "@type": "WebPage",
                  name: `${data.title || "Event"} source of truth`,
                  url: data.canonicalUrl || undefined,
                  dateModified:
                    canonical?.updatedAt ||
                    data?.lastConfirmedAtUtc ||
                    undefined,
                  about: {
                    "@type": "Event",
                    name: data.title,
                    identifier: data.id,
                  },
                  isPartOf: {
                    "@type": "WebSite",
                    name: "MealScout",
                    url: "https://www.mealscout.us",
                  },
                },
              ]
            : undefined
        }
      />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold">
          {isLoading ? "Loading..." : data?.title || "Event"}
        </h1>
        {error ? (
          <div className="text-sm text-destructive mt-3">
            {(error as any)?.message || "Failed to load event."}
          </div>
        ) : null}

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {canonical ? (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                        Source of Truth
                      </p>
                      <h2 className="text-sm font-semibold">
                        Canonical MealScout event record
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Badge variant="outline">
                        {canonical.machineReadiness}
                      </Badge>
                      <Badge variant="secondary">{canonical.freshness}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
                    <div>
                      Last updated{" "}
                      <span className="font-medium text-foreground">
                        {canonical.updatedAt
                          ? new Date(canonical.updatedAt).toLocaleString()
                          : "Unknown"}
                      </span>
                    </div>
                    <div>
                      Freshness window{" "}
                      <span className="font-medium text-foreground">
                        {canonical.freshnessHours != null
                          ? `${canonical.freshnessHours}h ago`
                          : "Unknown"}
                      </span>
                    </div>
                    <div>
                      Host linked{" "}
                      <span className="font-medium text-foreground">
                        {canonical.evidenceSummary?.hasHost ? "Yes" : "No"}
                      </span>
                    </div>
                    <div>
                      Truck booked{" "}
                      <span className="font-medium text-foreground">
                        {canonical.evidenceSummary?.hasBookedTruck
                          ? "Yes"
                          : "No"}
                      </span>
                    </div>
                  </div>

                  {Array.isArray(canonical.sourceTruthStatements) &&
                  canonical.sourceTruthStatements.length > 0 ? (
                    <div className="space-y-1">
                      {canonical.sourceTruthStatements
                        .slice(0, 4)
                        .map((item: string) => (
                          <p key={item} className="text-sm text-foreground">
                            {item}
                          </p>
                        ))}
                    </div>
                  ) : null}

                  {Array.isArray(canonical.knowledgeGaps) &&
                  canonical.knowledgeGaps.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {canonical.knowledgeGaps
                        .slice(0, 4)
                        .map((gap: string) => (
                          <Badge
                            key={gap}
                            variant="outline"
                            className="text-[11px]"
                          >
                            gap: {gap.replace(/_/g, " ")}
                          </Badge>
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {evidence ? (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                        External Evidence
                      </p>
                      <h2 className="text-sm font-semibold">
                        Discovery and distribution signals
                      </h2>
                    </div>
                    <Badge variant="outline">
                      {evidence.windowHours
                        ? `${Math.round(evidence.windowHours / 24)}d window`
                        : "window"}
                    </Badge>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
                    <div>
                      Crawler hits{" "}
                      <span className="font-medium text-foreground">
                        {evidence.externalPressure?.crawlerHits ?? 0}
                      </span>
                    </div>
                    <div>
                      Human page hits{" "}
                      <span className="font-medium text-foreground">
                        {evidence.externalPressure?.humanPageHits ?? 0}
                      </span>
                    </div>
                    <div>
                      Search demand{" "}
                      <span className="font-medium text-foreground">
                        {evidence.demand?.matchingSearchQueries ?? 0}
                      </span>
                    </div>
                    <div>
                      Outbound posts{" "}
                      <span className="font-medium text-foreground">
                        {evidence.distribution?.outboundSocialPosts ?? 0}
                      </span>
                    </div>
                  </div>

                  {Array.isArray(evidence.externalPressure?.topBots) &&
                  evidence.externalPressure.topBots.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {evidence.externalPressure.topBots.map((bot: any) => (
                        <Badge
                          key={bot.label}
                          variant="secondary"
                          className="text-[11px]"
                        >
                          {bot.label}: {bot.count}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {Array.isArray(evidence.demand?.topQueries) &&
                  evidence.demand.topQueries.length > 0 ? (
                    <div className="space-y-1">
                      {evidence.demand.topQueries
                        .slice(0, 3)
                        .map((query: any) => (
                          <p
                            key={query.query}
                            className="text-sm text-foreground"
                          >
                            demand: {query.query} ({query.count})
                          </p>
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {dateText ? (
                <div className="text-sm text-muted-foreground">
                  {dateText}
                  {timeText ? ` · ${timeText}` : ""}
                </div>
              ) : null}
              {data?.lastConfirmedAtUtc ? (
                <div className="text-xs text-muted-foreground">
                  Last confirmed:{" "}
                  {new Date(data.lastConfirmedAtUtc).toLocaleString()}
                </div>
              ) : null}
              {data?.ended ? (
                <div className="text-xs text-muted-foreground">
                  This event has ended.
                </div>
              ) : null}

              {data?.host ? (
                <div className="text-sm">
                  <div className="font-semibold">Location</div>
                  <div className="text-muted-foreground">
                    {data.host.path ? (
                      <a className="underline" href={data.host.path}>
                        {data.host.name || "Host"}
                      </a>
                    ) : (
                      <span>{data.host.name || "Host"}</span>
                    )}
                    {data.host.city ? ` · ${data.host.city}` : ""}
                    {data.host.state ? `, ${data.host.state}` : ""}
                  </div>
                </div>
              ) : null}

              {data?.truck ? (
                <div className="text-sm">
                  <div className="font-semibold">Booked truck</div>
                  <div className="text-muted-foreground">
                    {data.truck.path ? (
                      <a className="underline" href={data.truck.path}>
                        {data.truck.name || "Food truck"}
                      </a>
                    ) : (
                      <span>{data.truck.name || "Food truck"}</span>
                    )}
                    {data.truck.cuisineType
                      ? ` · ${data.truck.cuisineType}`
                      : ""}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No truck booked yet.
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {canBook && truckId ? (
                  <Button onClick={() => setBookingOpen(true)}>
                    Book This Spot — $
                    {(((data?.hostPriceCents ?? 0) + 1000) / 100).toFixed(2)}
                  </Button>
                ) : null}
                <Button asChild variant={canBook ? "outline" : "default"}>
                  <a href="/events">Browse events</a>
                </Button>
                {data?.host?.path ? (
                  <Button variant="outline" asChild>
                    <a href={data.host.path}>View location</a>
                  </Button>
                ) : null}
                {data?.truck?.path ? (
                  <Button variant="outline" asChild>
                    <a href={data.truck.path}>View truck</a>
                  </Button>
                ) : null}
              </div>

              {data && truckId && bookingOpen ? (
                <EventBookingModal
                  open={bookingOpen}
                  onOpenChange={setBookingOpen}
                  eventId={data.id}
                  truckId={truckId}
                  eventDetails={{
                    name: data.title,
                    date: dateText || "",
                    startTime: data.startTime || "",
                    endTime: data.endTime || "",
                    hostName: data.host?.name || "Host location",
                    hostPriceCents: data.hostPriceCents ?? 0,
                  }}
                  onSuccess={() => {
                    void queryClient.invalidateQueries({
                      queryKey: ["public-event", eventId],
                    });
                  }}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
