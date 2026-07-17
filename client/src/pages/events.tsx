import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
} from "lucide-react";
import { Link } from "wouter";
import {
  CollectionLoadingState,
  CollectionState,
  ConsumerCollectionShell,
} from "@/components/consumer-collection-shell";
import { SEOHead } from "@/components/seo-head";

type PublicEvent = {
  id: string;
  name?: string | null;
  description?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  eventType?: string | null;
  host?: {
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    spotImageUrl?: string | null;
  } | null;
  series?: {
    name?: string | null;
  } | null;
};

const formatEventDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const formatEventTime = (value?: string | null) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minutes || "00"} ${suffix}`;
};

const getLocationLabel = (event: PublicEvent) => {
  const cityState = [event.host?.city, event.host?.state]
    .filter(Boolean)
    .join(", ");
  return event.host?.businessName || cityState || event.host?.address || null;
};

export default function EventsPage() {
  const {
    data: events = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<PublicEvent[]>({
    queryKey: ["/api/events/upcoming"],
  });

  return (
    <ConsumerCollectionShell
      section="events"
      title="Events"
      description="Markets, festivals, and pop-ups where local food is part of the plan."
      icon={CalendarDays}
      countLabel={
        isLoading
          ? null
          : `${events.length} upcoming ${events.length === 1 ? "event" : "events"}`
      }
    >
      <SEOHead
        title="Local Food Events | MealScout"
        description="Browse upcoming markets, festivals, pop-ups, and local food events on MealScout."
        ogType="website"
      />

      {isLoading ? (
        <CollectionLoadingState label="Loading events" />
      ) : isError ? (
        <CollectionState
          icon={CalendarDays}
          title="Events are unavailable"
          description="We could not load the current event list. Try again in a moment."
          onRetry={() => void refetch()}
        />
      ) : events.length === 0 ? (
        <CollectionState
          icon={CalendarDays}
          title="No upcoming events listed"
          description="Scout local menus, schedules, and food businesses while the next events are being added."
          actionHref="/scout"
          actionLabel="Scout"
        />
      ) : (
        <section aria-labelledby="upcoming-events-heading">
          <h2 id="upcoming-events-heading" className="sr-only">
            Upcoming food events
          </h2>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => {
              const dateLabel = formatEventDate(event.date);
              const startTime = formatEventTime(event.startTime);
              const endTime = formatEventTime(event.endTime);
              const locationLabel = getLocationLabel(event);
              const eventImage =
                event.host?.spotImageUrl || "/backgrounds/food-truck-day.jpg";
              return (
                <Link
                  key={event.id}
                  href={`/event/${encodeURIComponent(String(event.id))}`}
                  className="group overflow-hidden rounded-[1.75rem] border border-[#683a1f]/15 bg-white/[0.92] shadow-[0_18px_45px_rgba(102,50,21,0.07)] transition hover:-translate-y-0.5 hover:border-[#f4512c]/35 hover:shadow-[0_22px_50px_rgba(102,50,21,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f4512c] focus-visible:ring-offset-2"
                >
                  <div className="relative h-44 overflow-hidden bg-[#f2dfd2]">
                    <img
                      src={eventImage}
                      alt=""
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      onError={(imageEvent) => {
                        imageEvent.currentTarget.src =
                          "/backgrounds/food-truck-day.jpg";
                      }}
                    />
                    {dateLabel ? (
                      <span className="absolute left-3 top-3 rounded-full bg-white/[0.94] px-3 py-1.5 text-xs font-black text-[#2b160d] shadow-sm">
                        {dateLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-5">
                    {event.series?.name || event.eventType ? (
                      <p className="text-[0.68rem] font-black uppercase tracking-[0.15em] text-[#9a4c31]">
                        {event.series?.name || event.eventType}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <h3 className="text-lg font-black leading-tight text-[#2b160d]">
                        {event.name || "Local food event"}
                      </h3>
                      <ArrowRight
                        className="mt-0.5 h-5 w-5 shrink-0 text-[#b79a89] transition group-hover:translate-x-0.5 group-hover:text-[#f4512c]"
                        aria-hidden="true"
                      />
                    </div>
                    {startTime ? (
                      <p className="mt-3 flex items-center gap-2 text-sm font-bold text-[#5f4435]">
                        <Clock className="h-4 w-4 text-[#f4512c]" aria-hidden="true" />
                        {startTime}
                        {endTime ? ` – ${endTime}` : ""}
                      </p>
                    ) : null}
                    {locationLabel ? (
                      <p className="mt-2 flex items-start gap-2 text-sm leading-5 text-[#6b5041]">
                        <MapPin
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#f4512c]"
                          aria-hidden="true"
                        />
                        <span className="line-clamp-2">{locationLabel}</span>
                      </p>
                    ) : null}
                    {event.description ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#806657]">
                        {event.description}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </ConsumerCollectionShell>
  );
}
