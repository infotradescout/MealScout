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

const ACTIVE_STATUSES = new Set([
  "",
  "open",
  "published",
  "confirmed",
  "booked",
]);
const text = (value: unknown) => String(value || "").trim();
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

function OpenEventCard({
  event,
  featured = false,
}: {
  event: any;
  featured?: boolean;
}) {
  const title = text(event?.name) || "Food truck event";
  const status = text(event?.status) || "open";
  const trucks = Number(event?.maxTrucks || 1);
  return (
    <Card
      className={`overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg ${featured ? "ring-1 ring-[color:var(--accent-text)]/40" : ""}`}
    >
      <CardContent className={featured ? "p-6 sm:p-8" : "p-5 sm:p-6"}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge className="rounded-full bg-[color:var(--accent-text)] text-black hover:bg-[color:var(--accent-text)]">
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            Open call
          </Badge>
        </div>
        <h2
          className={`${featured ? "text-3xl sm:text-5xl" : "text-2xl"} font-black leading-tight tracking-tight text-[var(--text-primary)]`}
        >
          {title}
        </h2>
        <div className="mt-5 grid gap-3 text-sm font-semibold text-[var(--text-secondary)] sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[color:var(--accent-text)]" />
            {eventDate(event?.date)}
          </span>
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[color:var(--accent-text)]" />
            {eventTime(event)}
          </span>
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[color:var(--accent-text)]" />
            {hostName(event)}
          </span>
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[color:var(--accent-text)]" />
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
          <Link href="/truck-discovery">
            <Button
              variant="outline"
              className="h-12 w-full rounded-full font-bold sm:w-auto"
            >
              Find trucks
            </Button>
          </Link>
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
    () => (Array.isArray(data) ? data : []).filter(isActivePublic),
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
    <div className="min-h-screen bg-[var(--bg-layered)] pb-28 text-[var(--text-primary)] lg:pb-10">
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
                Open event opportunities now come first. Booking tools stay
                available, but public events are the main action.
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
          <h2 className="text-xl font-black">Other booking paths</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Secondary actions are available below the open-event feed.
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
