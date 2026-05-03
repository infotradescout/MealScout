import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Calendar,
  Clock,
  MapPin,
  Truck,
  Users,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  getLocationLine,
  resolveListingImageUrl,
} from "@/lib/listing-card-display";

const ACTIVE_STATUSES = new Set([
  "",
  "open",
  "published",
  "confirmed",
  "booked",
]);
const EVENT_FALLBACK_IMAGE = "/backgrounds/food-truck-day.jpg";
const text = (value: unknown) => String(value || "").trim();
const dateToken = (value: unknown) => {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};
const isActivePublic = (event: any) => {
  const status = text(event?.status).toLowerCase();
  const eventType = text(event?.eventType).toLowerCase();
  return (
    eventType !== "private_event" &&
    status !== "cancelled" &&
    status !== "closed" &&
    ACTIVE_STATUSES.has(status)
  );
};
const eventSlug = (event: any) =>
  `${text(event?.id)}-${
    text(event?.name || "event")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 80) || "event"
  }`;
const eventDate = (value: unknown) => {
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
  if (Number.isNaN(date.getTime())) return text(value) || "Date pending";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
};
const eventTime = (event: any) =>
  [event?.startTime, event?.endTime].map(text).filter(Boolean).join(" - ") ||
  "Time pending";
const hostName = (event: any) =>
  text(
    event?.host?.businessName ||
      event?.hostBusinessName ||
      event?.businessName ||
      "Host location",
  );
const eventLocationLine = (event: any) => {
  const location = getLocationLine({
    address: event?.host?.address || event?.hostAddress || event?.address,
    city: event?.host?.city || event?.hostCity || event?.city,
    state: event?.host?.state || event?.hostState || event?.state,
  });
  const host = hostName(event);
  return location === "Location pending" ? host : `${host} - ${location}`;
};
const eventImageInput = (event: any) => ({
  name: event?.name,
  title: event?.name,
  hostBusinessName: hostName(event),
  description: event?.description,
  businessType: "event",
  imageUrl:
    event?.imageUrl ||
    event?.coverImageUrl ||
    event?.mediaUrl ||
    event?.hostSpotImageUrl ||
    event?.host?.spotImageUrl,
  spotImageUrl: event?.spotImageUrl || event?.host?.spotImageUrl,
  hostSpotImageUrl: event?.hostSpotImageUrl || event?.host?.spotImageUrl,
  coverImageUrl: event?.coverImageUrl || event?.host?.coverImageUrl,
  facebookCoverUrl: event?.facebookCoverUrl || event?.host?.facebookCoverUrl,
  googlePhotos: event?.googlePhotos || event?.host?.googlePhotos,
});
const fallbackEventImage = (event: any) => {
  const haystack = [
    event?.name,
    event?.description,
    hostName(event),
    event?.host?.description,
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
const hasExplicitImage = (event: any) =>
  Boolean(
    text(
      event?.imageUrl ||
        event?.coverImageUrl ||
        event?.mediaUrl ||
        event?.hostSpotImageUrl ||
        event?.spotImageUrl ||
        event?.host?.spotImageUrl ||
        event?.host?.coverImageUrl,
    ),
  );
const eventImageUrl = (event: any) =>
  hasExplicitImage(event)
    ? resolveListingImageUrl(eventImageInput(event)) || fallbackEventImage(event)
    : fallbackEventImage(event);
const eventDateKey = (value: unknown) => {
  const token = dateToken(value);
  if (token) return token;
  const date = new Date(value as any);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return text(value).toLowerCase();
};
const eventDedupeKey = (event: any) => {
  const composite = [
    text(event?.name).toLowerCase(),
    eventDateKey(event?.date),
    text(event?.startTime).toLowerCase(),
    text(event?.endTime).toLowerCase(),
    text(event?.host?.id || event?.hostId || hostName(event)).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
  return composite || `id:${text(event?.id)}`;
};
const eventCompletenessScore = (event: any) =>
  (hasExplicitImage(event) ? 4 : 0) +
  (text(event?.description) ? 2 : 0) +
  (text(event?.host?.address || event?.hostAddress || event?.address) ? 1 : 0) +
  (text(event?.id) ? 1 : 0);
const dedupePublicEvents = (items: any[]) => {
  const byKey = new Map<string, any>();
  items.forEach((event) => {
    const key = eventDedupeKey(event);
    const existing = byKey.get(key);
    if (
      !existing ||
      eventCompletenessScore(event) > eventCompletenessScore(existing)
    ) {
      byKey.set(key, event);
    }
  });
  return Array.from(byKey.values());
};

function OpenEventCard({
  event,
  featured = false,
}: {
  event: any;
  featured?: boolean;
}) {
  const title = text(event?.name) || "Food truck event";
  const status = text(event?.status) || "open";
  const maxTrucks = Number(event?.maxTrucks || 1);
  const trucks = Number.isFinite(maxTrucks) ? Math.max(1, maxTrucks) : 1;
  const imageUrl = eventImageUrl(event);
  const locationLine = eventLocationLine(event);
  return (
    <Card
      className={`overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg ${featured ? "ring-1 ring-[color:var(--accent-text)]/40" : ""}`}
    >
      <CardContent
        className={`grid p-0 ${featured ? "lg:grid-cols-[1fr_1.08fr]" : ""}`}
      >
        <div
          className={`relative overflow-hidden bg-muted ${featured ? "h-64 sm:h-80 lg:h-auto lg:min-h-[360px]" : "h-48"}`}
        >
          <img
            src={imageUrl}
            alt={`${title} event photo`}
            className="h-full w-full object-cover"
            loading={featured ? "eager" : "lazy"}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(imageEvent) => {
              const target = imageEvent.currentTarget;
              if (!target.dataset.localFallback) {
                target.dataset.localFallback = "true";
                target.src = fallbackEventImage(event);
              }
            }}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-[color:var(--accent-text)] text-black hover:bg-[color:var(--accent-text)]">
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
              <Badge className="rounded-full border-white/30 bg-black/35 text-white backdrop-blur">
                Open call
              </Badge>
            </div>
          </div>
        </div>
        <div className={featured ? "p-6 sm:p-8" : "p-5 sm:p-6"}>
          <h2
            className={`${featured ? "text-3xl sm:text-5xl" : "text-2xl"} font-black leading-tight tracking-tight text-[var(--text-primary)]`}
          >
            {title}
          </h2>
          <div className="mt-5 grid gap-3 text-sm font-semibold text-[var(--text-secondary)] sm:grid-cols-2">
            <span className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              {eventDate(event?.date)}
            </span>
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              {eventTime(event)}
            </span>
            <span className="flex items-center gap-2 sm:col-span-2">
              <MapPin className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              <span className="line-clamp-2">{locationLine}</span>
            </span>
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              Up to {trucks} truck{trucks === 1 ? "" : "s"}
            </span>
          </div>
          {event?.description ? (
            <p className="mt-5 line-clamp-3 text-base leading-relaxed text-[var(--text-secondary)]">
              {text(event.description)}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href={`/event/${eventSlug(event)}`}>
              <Button className="h-12 w-full rounded-full font-bold sm:w-auto">
                View details <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/truck-onboarding?source=events">
              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold sm:w-auto"
              >
                Claim your truck
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EventsPublicHub() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const canManage = Boolean(
    isAuthenticated &&
    ["event_coordinator", "admin", "super_admin", "staff"].includes(
      text(user?.userType),
    ),
  );
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/events/upcoming", "event-first"],
    queryFn: async () => {
      const res = await fetch("/api/events/upcoming", {
        credentials: "include",
      });
      return res.ok ? await res.json() : [];
    },
    refetchOnWindowFocus: false,
  });
  const events = useMemo(
    () =>
      dedupePublicEvents(
        (Array.isArray(data) ? data : []).filter(isActivePublic),
      ),
    [data],
  );
  const first = events[0];
  const rest = events.slice(1);
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Open Food Truck Events",
    description:
      "Browse public food truck events and open calls looking for vendors on MealScout.",
    url: "https://www.mealscout.us/events",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: events.slice(0, 10).map((event: any, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `https://www.mealscout.us/event/${eventSlug(event)}`,
        name: text(event?.name) || "Food truck event",
      })),
    },
  };
  return (
    <div className="min-h-screen bg-[var(--bg-layered)] pb-10 text-[var(--text-primary)]">
      <SEOHead
        title="Open Food Truck Events | MealScout"
        description="Browse public food truck events and open calls looking for vendors on MealScout."
        canonicalUrl="https://www.mealscout.us/events"
        ogType="website"
        schemaData={schemaData}
      />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        <section className="rounded-[2rem] border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean-lg sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-text)]/10 px-3 py-1 text-sm font-black text-[color:var(--accent-text)]">
                <Truck className="h-4 w-4" />
                Open events
              </div>
              <h1 className="text-4xl font-black leading-none tracking-tight sm:text-6xl">
                Events looking for food trucks
              </h1>
              <p className="mt-4 text-base font-medium leading-relaxed text-[var(--text-secondary)] sm:text-lg">
                Food truck owners can scan real open calls, check the date,
                host, location, and capacity, then move straight into the
                opportunity.
              </p>
            </div>
            {canManage ? (
              <Button
                variant="outline"
                className="h-11 rounded-full font-bold"
                onClick={() => setLocation("/events?mode=manage")}
              >
                Manage events
              </Button>
            ) : null}
          </div>
        </section>
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-black">
              {events.length === 1
                ? "1 upcoming event"
                : `${events.length} upcoming events`}
            </h2>
            <Badge variant="secondary" className="rounded-full px-4 py-2">
              Public view
            </Badge>
          </div>
          {isLoading ? (
            <>
              <Skeleton className="h-56 rounded-3xl" />
              <Skeleton className="h-40 rounded-3xl" />
            </>
          ) : null}
          {!isLoading && !first ? (
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
              <CardContent className="p-8 text-center">
                <Calendar className="mx-auto h-10 w-10 text-[color:var(--accent-text)]" />
                <h2 className="mt-4 text-2xl font-black">
                  No public events yet
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
                  Public events will appear here once they are active and not
                  private, cancelled, or closed.
                </p>
              </CardContent>
            </Card>
          ) : null}
          {first ? <OpenEventCard event={first} featured /> : null}
          {rest.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {rest.map((event: any) => (
                <OpenEventCard key={event.id} event={event} />
              ))}
            </div>
          ) : null}
        </section>
        <section className="rounded-[2rem] border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean sm:p-6">
          <h2 className="text-xl font-black">Need a different path?</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Hosts can request trucks, and truck owners can make sure their
            profile is ready before applying.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Link href="/request-truck">
              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold"
              >
                Book one truck
              </Button>
            </Link>
            <Link href="/truck-discovery">
              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold"
              >
                Find event trucks
              </Button>
            </Link>
            <Link href="/map">
              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold"
              >
                Open map
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
