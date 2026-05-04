import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  MapPin,
  Truck,
  Users,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PublicVideoGallery from "@/components/PublicVideoGallery";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { generateEventSchema } from "@/lib/schema-helpers";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { EventBookingModal } from "@/components/event-booking-modal";
import {
  getLocationLine,
  resolveListingImageUrl,
} from "@/lib/listing-card-display";

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
  maxTrucks?: number | null;
  host: {
    id: string;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    spotImageUrl?: string | null;
    googlePhotos?: unknown;
    facebookCoverUrl?: string | null;
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

const EVENT_FALLBACK_IMAGE = "/backgrounds/food-truck-day.jpg";
const text = (value: unknown) => String(value || "").trim();
const dateToken = (value: unknown) => {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};
const eventDateText = (value: unknown) => {
  const token = dateToken(value);
  if (token) {
    const [year, month, day] = token.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(year, month - 1, day));
  }

  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
};
const fallbackEventImage = (event?: PublicEvent | null) => {
  const haystack = [
    event?.title,
    event?.description,
    event?.host?.name,
    event?.host?.city,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");

  if (
    haystack.includes("night") ||
    haystack.includes("evening") ||
    haystack.includes("market") ||
    haystack.includes("festival")
  ) {
    return "/backgrounds/food-truck-night.jpg";
  }
  return EVENT_FALLBACK_IMAGE;
};
const eventImageUrl = (event?: PublicEvent | null) => {
  const hasHostMedia = Boolean(
    text(event?.host?.spotImageUrl || event?.host?.facebookCoverUrl) ||
      event?.host?.googlePhotos,
  );
  if (!hasHostMedia) return fallbackEventImage(event);

  return (
    resolveListingImageUrl({
      title: event?.title,
      name: event?.title,
      description: event?.description,
      businessType: "event",
      hostBusinessName: event?.host?.name,
      imageUrl: event?.host?.spotImageUrl,
      spotImageUrl: event?.host?.spotImageUrl,
      hostSpotImageUrl: event?.host?.spotImageUrl,
      facebookCoverUrl: event?.host?.facebookCoverUrl,
      googlePhotos: event?.host?.googlePhotos,
    }) || fallbackEventImage(event)
  );
};
const eventLocationLine = (event?: PublicEvent | null) =>
  getLocationLine({
    address: event?.host?.address,
    city: event?.host?.city,
    state: event?.host?.state,
  });
const isOpenStatus = (status: unknown) => {
  const value = text(status).toLowerCase();
  return !value || value === "open" || value === "published";
};

export default function EventDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const eventParam = params.slug || params.id || "";
  const eventId = extractUuidFromSlug(eventParam) || eventParam;
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [interestSubmitting, setInterestSubmitting] = useState(false);
  const [interestSent, setInterestSent] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setTruckId(null);
      return;
    }
    if (
      user?.userType !== "food_truck" &&
      user?.userType !== "restaurant_owner" &&
      user?.userType !== "caterer" &&
      user?.userType !== "private_chef"
    ) {
      return;
    }
    fetch("/api/restaurants/my-restaurants", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((trucks) => {
        if (Array.isArray(trucks) && trucks.length > 0) {
          const foodTruck = trucks.find((truck: any) => truck.isFoodTruck);
          setTruckId((foodTruck || trucks[0]).id);
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

  const calendarDateText = data?.date ? eventDateText(data.date) : null;
  const modalDateText = data?.date ? dateToken(data.date) || data.date : "";
  const timeText =
    data?.startTime && data?.endTime
      ? `${data.startTime} - ${data.endTime}`
      : null;
  const openForAction = Boolean(data && isOpenStatus(data.status) && !data.ended);
  const canBook =
    isAuthenticated &&
    Boolean(truckId) &&
    data?.requiresPayment === true &&
    openForAction;
  const canSendInterest =
    isAuthenticated &&
    Boolean(truckId) &&
    data?.requiresPayment !== true &&
    openForAction &&
    !interestSent;
  const maxTrucks = Math.max(1, Number(data?.maxTrucks || 1));
  const imageUrl = eventImageUrl(data);
  const locationLine = eventLocationLine(data);
  const hostName = text(data?.host?.name) || "Host location";

  const handleInterest = async () => {
    if (!data?.id || !truckId || interestSubmitting) return;
    setInterestSubmitting(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(data.id)}/interests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            restaurantId: truckId,
            message: "I'm interested in this event.",
          }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message || "Failed to send interest");
      }
      setInterestSent(true);
      toast({
        title: "Interest sent",
        description: "The event organizer can now contact your truck.",
      });
    } catch (err: any) {
      toast({
        title: "Could not send interest",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setInterestSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] text-[var(--text-primary)]">
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
                  name: `${data.title || "Event"} details`,
                  url: data.canonicalUrl || undefined,
                  dateModified: data.lastConfirmedAtUtc || undefined,
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

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        {error ? (
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardContent className="p-8">
              <h1 className="text-2xl font-black">Event unavailable</h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {(error as any)?.message || "Failed to load event."}
              </p>
              <Button asChild className="mt-5 rounded-full">
                <a href="/events">Browse open events</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardContent className="grid p-0 lg:grid-cols-[1fr_1.05fr]">
              <div className="relative h-64 overflow-hidden bg-muted sm:h-80 lg:h-auto lg:min-h-[520px]">
                <img
                  src={imageUrl}
                  alt={`${data?.title || "Food truck event"} photo`}
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(imageEvent) => {
                    const target = imageEvent.currentTarget;
                    if (!target.dataset.localFallback) {
                      target.dataset.localFallback = "true";
                      target.src = fallbackEventImage(data);
                    }
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-[color:var(--accent-text)] text-black hover:bg-[color:var(--accent-text)]">
                      {data?.ended
                        ? "Ended"
                        : text(data?.status) || (isLoading ? "Loading" : "Open")}
                    </Badge>
                    <Badge className="rounded-full border-white/30 bg-black/35 text-white backdrop-blur">
                      Food truck opportunity
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-text)]/10 px-3 py-1 text-sm font-black text-[color:var(--accent-text)]">
                  <Truck className="h-4 w-4" />
                  Open event
                </div>
                <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                  {isLoading
                    ? "Loading event..."
                    : data?.title || "Food truck event"}
                </h1>

                <div className="mt-6 grid gap-3 text-sm font-semibold text-[var(--text-secondary)] sm:grid-cols-2">
                  {calendarDateText ? (
                    <span className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                      {calendarDateText}
                    </span>
                  ) : null}
                  {timeText ? (
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                      {timeText}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2 sm:col-span-2">
                    <MapPin className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                    <span className="line-clamp-2">
                      {hostName} - {locationLine}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                    Up to {maxTrucks} truck{maxTrucks === 1 ? "" : "s"}
                  </span>
                </div>

                {data?.description ? (
                  <p className="mt-6 text-base leading-relaxed text-[var(--text-secondary)]">
                    {data.description}
                  </p>
                ) : null}

                {data?.ended ? (
                  <div className="mt-5 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                    This event has ended.
                  </div>
                ) : null}

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  {canBook && truckId ? (
                    <Button
                      onClick={() => setBookingOpen(true)}
                      className="h-12 rounded-full font-bold"
                    >
                      Book this spot - $
                      {(((data?.hostPriceCents ?? 0) + 1000) / 100).toFixed(2)}
                    </Button>
                  ) : canSendInterest ? (
                    <Button
                      onClick={handleInterest}
                      disabled={interestSubmitting}
                      className="h-12 rounded-full font-bold"
                    >
                      {interestSubmitting ? "Sending..." : "I'm Interested"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : interestSent ? (
                    <Button disabled className="h-12 rounded-full font-bold">
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Interest Sent
                    </Button>
                  ) : openForAction ? (
                    <Button asChild className="h-12 rounded-full font-bold">
                      <a href="/truck-onboarding?source=event-detail">
                        Claim your truck to apply
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    asChild
                    variant="outline"
                    className="h-12 rounded-full font-bold"
                  >
                    <a href="/events">Browse events</a>
                  </Button>
                </div>

                <div className="mt-7 grid gap-3 border-t border-[color:var(--border-subtle)] pt-5 text-sm">
                  {data?.host?.path ? (
                    <a
                      className="font-semibold text-[color:var(--accent-text)] hover:underline"
                      href={data.host.path}
                    >
                      View host location
                    </a>
                  ) : null}
                  {data?.truck?.path ? (
                    <a
                      className="font-semibold text-[color:var(--accent-text)] hover:underline"
                      href={data.truck.path}
                    >
                      View booked truck
                    </a>
                  ) : null}
                  {data?.lastConfirmedAtUtc ? (
                    <span className="text-xs text-[var(--text-muted)]">
                      Last confirmed:{" "}
                      {new Date(data.lastConfirmedAtUtc).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {data?.truck ? (
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
            <CardHeader>
              <CardTitle>Booked truck</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-[var(--text-secondary)]">
              {data.truck.path ? (
                <a
                  className="font-semibold text-[color:var(--accent-text)] hover:underline"
                  href={data.truck.path}
                >
                  {data.truck.name || "Food truck"}
                </a>
              ) : (
                <span>{data.truck.name || "Food truck"}</span>
              )}
              {data.truck.cuisineType ? ` - ${data.truck.cuisineType}` : ""}
            </CardContent>
          </Card>
        ) : null}

        {data && truckId && bookingOpen ? (
          <EventBookingModal
            open={bookingOpen}
            onOpenChange={setBookingOpen}
            eventId={data.id}
            truckId={truckId}
            eventDetails={{
              name: data.title,
              date: modalDateText,
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

        {data?.id ? (
          <PublicVideoGallery
            ownerType="event"
            ownerId={data.id}
            title="Event Videos"
            description={`Watch featured videos from ${data.title}.`}
          />
        ) : null}
      </main>
    </div>
  );
}
