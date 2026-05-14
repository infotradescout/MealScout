/**
 * Truck Discovery — Public Event Browser
 *
 * Anyone (logged in or not) can browse open call events and see organizer info.
 * Truck owners get an "I'm Interested" button on each event.
 * Non-truck visitors see a "Join as a Truck" prompt instead.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { SEOHead } from "@/components/seo-head";
import {
  Calendar,
  Clock,
  MapPin,
  Truck,
  Phone,
  Building2,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  Megaphone,
  Search,
  X,
  Loader2,
  ArrowRight,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PENSACOLA_RADIATE_MARKETS } from "@/lib/launchMarkets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Host {
  id: string;
  businessName: string;
  address: string;
  city?: string | null;
  state?: string | null;
  locationType: string;
  contactPhone?: string | null;
  spotImageUrl?: string | null;
}

interface EventSeries {
  id: string;
  name: string;
  recurrenceRule?: string | null;
  timezone?: string | null;
  status: string;
}

interface EventItem {
  id: string;
  name?: string | null;
  description?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  maxTrucks: number;
  hardCapEnabled?: boolean;
  status: string;
  seriesId?: string | null;
  host: Host;
  series?: EventSeries | null;
}

interface SeriesGroup {
  seriesId: string;
  seriesName: string;
  host: Host;
  occurrences: EventItem[];
  earliestDate: string;
  latestDate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeEvents = (items: any[]): EventItem[] => {
  const fallback: Host = {
    id: "unknown",
    businessName: "Event Organizer",
    address: "Location details coming soon",
    locationType: "event",
  };
  return (Array.isArray(items) ? items : []).map((ev) => ({
    ...ev,
    host: { ...fallback, ...(ev?.host || {}) },
  }));
};

const locationLabel = (host: Host) =>
  [host.city, host.state].filter(Boolean).join(", ") || host.address;

// ---------------------------------------------------------------------------
// EventCard — standalone event
// ---------------------------------------------------------------------------

function EventCard({
  event,
  isTruckOwner,
  hasInterest,
  isSubmitting,
  onInterest,
  onJoin,
}: {
  event: EventItem;
  isTruckOwner: boolean;
  hasInterest: boolean;
  isSubmitting: boolean;
  onInterest: (id: string) => void;
  onJoin: () => void;
}) {
  const eventDate = new Date(event.date);
  const past = isPast(eventDate) && !isToday(eventDate);

  return (
    <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean overflow-hidden flex flex-col">
      {event.host.spotImageUrl && (
        <div className="h-28 overflow-hidden shrink-0">
          <img
            src={event.host.spotImageUrl}
            alt={event.host.businessName}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <CardContent className="p-5 space-y-4 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Building2 className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              <span className="font-semibold text-[color:var(--text-primary)] truncate">
                {event.host.businessName}
              </span>
              {event.series && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)] border-[color:var(--accent-text)]/20"
                >
                  Recurring
                </Badge>
              )}
            </div>
            {event.name && (
              <p className="text-sm font-medium text-[color:var(--text-secondary)] mt-0.5">
                {event.name}
              </p>
            )}
          </div>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-md capitalize shrink-0 ${
              past
                ? "bg-[var(--bg-surface-muted)] text-[color:var(--text-muted)]"
                : "bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]"
            }`}
          >
            {past ? "Past" : "Open"}
          </span>
        </div>

        {/* Details */}
        <div className="space-y-2 text-sm text-[color:var(--text-secondary)] flex-1">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
            <span className="font-medium text-[color:var(--text-primary)]">
              {format(eventDate, "EEEE, MMMM d, yyyy")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
            <span>
              {event.startTime} – {event.endTime}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
            <span>{locationLabel(event.host)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
            <span>
              Up to{" "}
              <span className="font-medium text-[color:var(--text-primary)]">
                {event.maxTrucks}
              </span>{" "}
              truck{event.maxTrucks !== 1 ? "s" : ""}
            </span>
            {event.hardCapEnabled && (
              <Badge
                variant="outline"
                className="text-xs border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)] ml-1"
              >
                <AlertCircle className="h-3 w-3 mr-1" />
                Strict Cap
              </Badge>
            )}
          </div>
          {event.host.contactPhone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              <a
                href={`tel:${event.host.contactPhone}`}
                className="text-[color:var(--accent-text)] hover:underline"
              >
                {event.host.contactPhone}
              </a>
            </div>
          )}
          {event.description && (
            <p className="text-[color:var(--text-muted)] line-clamp-2 border-t border-[color:var(--border-subtle)] pt-2 mt-2">
              {event.description}
            </p>
          )}
        </div>

        {/* Action */}
        {!past && (
          <div className="pt-1">
            {isTruckOwner ? (
              <Button
                className="w-full"
                variant={hasInterest ? "outline" : "default"}
                disabled={hasInterest || isSubmitting}
                onClick={() => onInterest(event.id)}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : hasInterest ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2 text-[color:var(--status-success)]" />
                    Interest Sent
                  </>
                ) : (
                  <>
                    <Megaphone className="h-4 w-4 mr-2" />
                    I'm Interested
                  </>
                )}
              </Button>
            ) : (
              <Button className="w-full" variant="outline" onClick={onJoin}>
                <Truck className="h-4 w-4 mr-2" />
                Join as a Truck to Apply
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SeriesGroupCard — recurring open call
// ---------------------------------------------------------------------------

function SeriesGroupCard({
  group,
  isTruckOwner,
  interestedEvents,
  submittingId,
  onInterest,
  onJoin,
}: {
  group: SeriesGroup;
  isTruckOwner: boolean;
  interestedEvents: Set<string>;
  submittingId: string | null;
  onInterest: (id: string) => void;
  onJoin: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[color:var(--border-subtle)] shadow-clean overflow-hidden">
      <button
        className="w-full text-left p-5 bg-[linear-gradient(110deg,rgba(255,77,46,0.07),rgba(245,158,11,0.07))] border-b border-[color:var(--border-subtle)] hover:bg-[linear-gradient(110deg,rgba(255,77,46,0.11),rgba(245,158,11,0.11))] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Megaphone className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
              <span className="font-bold text-[color:var(--text-primary)]">
                {group.seriesName}
              </span>
              <Badge
                variant="secondary"
                className="text-xs bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)] border-[color:var(--accent-text)]/20"
              >
                Recurring Open Call
              </Badge>
            </div>
            <div className="space-y-1 text-sm text-[color:var(--text-secondary)]">
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium text-[color:var(--text-primary)]">
                  {group.host.businessName}
                </span>
                {group.host.city && (
                  <span className="text-[color:var(--text-muted)]">
                    · {locationLabel(group.host)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {group.occurrences.length} date
                  {group.occurrences.length !== 1 ? "s" : ""} ·{" "}
                  {format(new Date(group.earliestDate), "MMM d")} –{" "}
                  {format(new Date(group.latestDate), "MMM d, yyyy")}
                </span>
              </div>
              {group.host.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`tel:${group.host.contactPhone}`}
                    className="text-[color:var(--accent-text)] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {group.host.contactPhone}
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[color:var(--text-muted)]">
              {expanded ? "Hide" : "Show"} dates
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[color:var(--text-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[color:var(--text-muted)]" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {group.occurrences.map((event) => {
            const past =
              isPast(new Date(event.date)) && !isToday(new Date(event.date));
            return (
              <div
                key={event.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-[var(--bg-surface-muted)] transition-colors"
              >
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 font-medium text-[color:var(--text-primary)]">
                    <Calendar className="h-4 w-4 text-[color:var(--accent-text)]" />
                    {format(new Date(event.date), "EEEE, MMMM d, yyyy")}
                  </div>
                  <div className="flex items-center gap-2 text-[color:var(--text-secondary)]">
                    <Clock className="h-4 w-4 text-[color:var(--accent-text)]" />
                    {event.startTime} – {event.endTime}
                  </div>
                  <div className="flex items-center gap-2 text-[color:var(--text-secondary)]">
                    <Truck className="h-4 w-4 text-[color:var(--accent-text)]" />
                    Up to {event.maxTrucks} truck
                    {event.maxTrucks !== 1 ? "s" : ""}
                    {event.hardCapEnabled && (
                      <Badge
                        variant="outline"
                        className="text-xs border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)] ml-1"
                      >
                        Strict Cap
                      </Badge>
                    )}
                  </div>
                </div>
                {!past && (
                  <div className="shrink-0">
                    {isTruckOwner ? (
                      <Button
                        size="sm"
                        variant={
                          interestedEvents.has(event.id) ? "outline" : "default"
                        }
                        disabled={
                          interestedEvents.has(event.id) ||
                          submittingId === event.id
                        }
                        onClick={() => onInterest(event.id)}
                        className="min-w-[140px]"
                      >
                        {submittingId === event.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : interestedEvents.has(event.id) ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-2 text-[color:var(--status-success)]" />
                            Sent
                          </>
                        ) : (
                          <>
                            <Megaphone className="h-4 w-4 mr-2" />
                            I'm Interested
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onJoin}
                        className="min-w-[140px]"
                      >
                        <Truck className="h-4 w-4 mr-2" />
                        Join to Apply
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function TruckDiscovery() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    const cityPreset = params.get("city") || params.get("market");
    return params.get("q") || params.get("search") || cityPreset || "";
  });
  const [interestedEvents, setInterestedEvents] = useState<Set<string>>(
    new Set(),
  );
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [myRestaurantId, setMyRestaurantId] = useState<string | null>(null);

  // Role detection
  const isTruckOwner = useMemo(() => {
    if (!user) return false;
    const roles = new Set<string>();
    if (user.userType) roles.add(user.userType);
    if (Array.isArray((user as any).roles)) {
      (user as any).roles.forEach((r: string | null) => r && roles.add(r));
    }
    return roles.has("food_truck") || roles.has("restaurant_owner");
  }, [user]);

  const { data: subscription } = useQuery<{
    status: string;
    hasAccess: boolean;
  }>({
    queryKey: ["/api/subscription/status"],
    enabled: isAuthenticated && isTruckOwner,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Fetch truck owner's restaurant id (only when logged in as truck)
  useEffect(() => {
    if (!isTruckOwner) return;
    fetch("/api/restaurants/my", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMyRestaurantId(data[0].id);
        }
      })
      .catch(() => {});
  }, [isTruckOwner]);

  // Fetch events — public endpoint, no auth required
  const {
    data: rawEvents = [],
    isLoading,
    error,
  } = useQuery<any[]>({
    queryKey: ["/api/events/upcoming"],
    staleTime: 60_000,
  });

  const events = useMemo(() => normalizeEvents(rawEvents), [rawEvents]);

  // Fetch open event coordinator requests (visible to authenticated users)
  const { data: openRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/events/open-requests"],
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  // Search filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (ev) =>
        ev.host.businessName.toLowerCase().includes(q) ||
        (ev.host.city ?? "").toLowerCase().includes(q) ||
        (ev.host.state ?? "").toLowerCase().includes(q) ||
        (ev.host.address ?? "").toLowerCase().includes(q) ||
        (ev.name ?? "").toLowerCase().includes(q) ||
        (ev.description ?? "").toLowerCase().includes(q),
    );
  }, [events, search]);
  const pensacolaEventCount = useMemo(
    () =>
      events.filter((ev) => {
        const haystack = `${ev.host.businessName || ""} ${ev.host.address || ""} ${ev.host.city || ""} ${ev.host.state || ""}`.toLowerCase();
        return haystack.includes("pensacola");
      }).length,
    [events],
  );
  const showingPensacolaOnly = search.trim().toLowerCase().includes("pensacola");

  // Group by series
  const { seriesGroups, standalone } = useMemo(() => {
    const seriesMap = new Map<string, SeriesGroup>();
    const standalone: EventItem[] = [];
    for (const ev of filtered) {
      if (ev.seriesId && ev.series) {
        const existing = seriesMap.get(ev.seriesId);
        if (existing) {
          existing.occurrences.push(ev);
          if (new Date(ev.date) > new Date(existing.latestDate)) {
            existing.latestDate = ev.date;
          }
        } else {
          seriesMap.set(ev.seriesId, {
            seriesId: ev.seriesId,
            seriesName: ev.series.name,
            host: ev.host,
            occurrences: [ev],
            earliestDate: ev.date,
            latestDate: ev.date,
          });
        }
      } else {
        standalone.push(ev);
      }
    }
    const seriesGroups = Array.from(seriesMap.values()).sort(
      (a, b) =>
        new Date(a.earliestDate).getTime() - new Date(b.earliestDate).getTime(),
    );
    return { seriesGroups, standalone };
  }, [filtered]);

  const totalEvents =
    seriesGroups.reduce((s, g) => s + g.occurrences.length, 0) +
    standalone.length;

  // Express interest
  const handleInterest = useCallback(
    async (eventId: string) => {
      if (!subscription?.hasAccess) {
        toast({
          title: "Premium required",
          description: "Upgrade to express interest in events.",
          variant: "destructive",
        });
        setLocation("/subscribe");
        return;
      }

      if (!myRestaurantId) {
        toast({
          title: "Truck Profile Required",
          description: "Complete your truck profile to express interest.",
          variant: "destructive",
        });
        setLocation("/customer-signup?role=business&businessType=food_truck&claim=1");
        return;
      }
      setSubmittingId(eventId);
      try {
        const res = await fetch(`/api/events/${eventId}/interests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            restaurantId: myRestaurantId,
            message: "I'm interested in this event!",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(data.message || "Failed to submit interest");
        setInterestedEvents((prev) => new Set(prev).add(eventId));
        toast({
          title: "Interest Sent!",
          description: "The event organizer can now contact you directly.",
        });
      } catch (err: any) {
        toast({
          title: "Error",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setSubmittingId(null);
      }
    },
    [myRestaurantId, setLocation, subscription?.hasAccess, toast],
  );

  const handleJoin = useCallback(
    () => setLocation("/customer-signup?role=business&businessType=food_truck&claim=1"),
    [setLocation],
  );
  const applyMarketFilter = useCallback((value: string) => {
    setSearch(value);
  }, []);
  const launchMarketFilters = PENSACOLA_RADIATE_MARKETS.slice(0, 6).map(
    (row) => `${row.city}, ${row.state}`,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12 min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Open Call Events for Food Trucks | MealScout"
        description="Browse open call events posted by organizers looking for food trucks. Find local festivals, markets, and pop-ups near you and express interest on MealScout."
        ogType="website"
      />
      {/* Hero */}
      <div className="mb-8 rounded-2xl border border-[color:var(--border-subtle)] bg-[linear-gradient(145deg,rgba(255,77,46,0.10),rgba(245,158,11,0.07),rgba(0,0,0,0.06))] p-6 md:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)] mb-3">
          <Megaphone className="h-3.5 w-3.5" />
          Open Call Events
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-[color:var(--text-primary)] mb-2">
          Find Events for Your Truck
        </h1>
        <p className="text-[color:var(--text-secondary)] max-w-xl">
          Browse open call events posted by organizers. See who's hosting, when,
          and how many trucks they need — then hit{" "}
          <strong className="text-[color:var(--text-primary)]">
            "I'm Interested"
          </strong>{" "}
          to let them know you want in.
        </p>

        {isAuthenticated && !isTruckOwner && (
          <div className="mt-4 flex items-start gap-2 text-sm text-[color:var(--text-secondary)] bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] rounded-lg px-4 py-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--accent-text)]" />
            <span>
              You're viewing as a guest.{" "}
              <button
                className="text-[color:var(--accent-text)] hover:underline font-medium"
                onClick={handleJoin}
              >
                Register your truck
              </button>{" "}
              to express interest in events.
            </span>
          </div>
        )}
        {isTruckOwner && !subscription?.hasAccess && (
          <div className="mt-4 flex items-start gap-2 text-sm text-[color:var(--text-secondary)] bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] rounded-lg px-4 py-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--accent-text)]" />
            <span>
              Event participation is a premium feature.{" "}
              <button
                className="text-[color:var(--accent-text)] hover:underline font-medium"
                onClick={() => setLocation("/subscribe")}
              >
                Upgrade your plan
              </button>{" "}
              to send interest to organizers.
            </span>
          </div>
        )}
        {!isAuthenticated && (
          <div className="mt-4 flex items-start gap-2 text-sm text-[color:var(--text-secondary)] bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] rounded-lg px-4 py-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--accent-text)]" />
            <span>
              <button
                className="text-[color:var(--accent-text)] hover:underline font-medium"
                onClick={handleJoin}
              >
                Sign up as a food truck
              </button>{" "}
              to express interest in events.
            </span>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--text-muted)]" />
        <Input
          className="pl-9 pr-9 bg-[var(--bg-surface)] border-[color:var(--border-subtle)]"
          placeholder="Search by organizer, city, or event name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            onClick={() => setSearch("")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
          Market quick filters
        </span>
        <Button
          size="sm"
          variant={showingPensacolaOnly ? "default" : "outline"}
          onClick={() => applyMarketFilter("Pensacola, FL")}
        >
          Pensacola
        </Button>
        {launchMarketFilters
          .filter((row) => row !== "Pensacola, FL")
          .map((label) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              onClick={() => applyMarketFilter(label)}
            >
              {label.replace(", FL", "")}
            </Button>
          ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => applyMarketFilter("")}
        >
          All Markets
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setLocation(
              "/customer-signup?role=business&businessType=food_truck&claim=1&redirect=%2Ftruck-discovery%3Fcity%3DPensacola%252C%2520FL",
            )
          }
        >
          Claim truck (Pensacola)
        </Button>
      </div>
      {pensacolaEventCount > 0 && (
        <div className="mb-6 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[color:var(--text-secondary)]">
          <span className="font-semibold text-[color:var(--text-primary)]">
            {pensacolaEventCount}
          </span>{" "}
          open call event{pensacolaEventCount === 1 ? "" : "s"} currently tied to Pensacola host locations.
        </div>
      )}

      {/* Stats bar */}
      {!isLoading && totalEvents > 0 && (
        <div className="flex items-center justify-between mb-4 text-sm text-[color:var(--text-muted)]">
          <span>
            <span className="font-semibold text-[color:var(--text-primary)]">
              {totalEvents}
            </span>{" "}
            event{totalEvents !== 1 ? "s" : ""} available
            {search && (
              <span>
                {" "}
                matching{" "}
                <span className="text-[color:var(--text-primary)]">
                  "{search}"
                </span>
              </span>
            )}
          </span>
          {isTruckOwner && interestedEvents.size > 0 && (
            <span className="text-[color:var(--status-success)] font-medium">
              <CheckCircle className="h-4 w-4 inline mr-1" />
              {interestedEvents.size} interest
              {interestedEvents.size !== 1 ? "s" : ""} sent
            </span>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="text-center py-12 text-[color:var(--text-muted)]">
          <AlertCircle className="mx-auto h-10 w-10 mb-3 text-[color:var(--status-error)]" />
          <p>Could not load events. Please try again shortly.</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && totalEvents === 0 && (
        <div className="text-center py-16 bg-[var(--bg-surface-muted)] rounded-xl border border-dashed border-[color:var(--border-subtle)]">
          <Calendar className="mx-auto h-12 w-12 text-[color:var(--text-muted)] mb-3" />
          <h3 className="text-lg font-semibold text-[color:var(--text-primary)] mb-1">
            {search
              ? "No events match your search"
              : "No open events right now"}
          </h3>
          <p className="text-sm text-[color:var(--text-secondary)] mb-4">
            {search
              ? "Try a different city, organizer name, or clear the search."
              : "New events appear here as organizers publish them."}
          </p>
          {search && (
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          )}
        </div>
      )}

      {/* Listings */}
      {!isLoading && !error && totalEvents > 0 && (
        <div className="space-y-6">
          {/* Recurring series */}
          {seriesGroups.map((group) => (
            <SeriesGroupCard
              key={group.seriesId}
              group={group}
              isTruckOwner={isTruckOwner}
              interestedEvents={interestedEvents}
              submittingId={submittingId}
              onInterest={handleInterest}
              onJoin={handleJoin}
            />
          ))}

          {/* Standalone events */}
          {standalone.length > 0 && (
            <>
              {seriesGroups.length > 0 && (
                <h2 className="text-base font-semibold text-[color:var(--text-secondary)] pt-2">
                  One-time Events
                </h2>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {standalone.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isTruckOwner={isTruckOwner}
                    hasInterest={interestedEvents.has(event.id)}
                    isSubmitting={submittingId === event.id}
                    onInterest={handleInterest}
                    onJoin={handleJoin}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Open Event Coordinator Requests */}
      {openRequests.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)] mb-4">
            <Megaphone className="h-3.5 w-3.5" />
            Open Requests — Looking for Trucks
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {openRequests.map((req: any) => {
              const data = req.claimData || {};
              return (
                <div
                  key={req.id}
                  className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-[color:var(--text-primary)] leading-tight">
                      {data.eventName || "Event Request"}
                    </h3>
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Open Call
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 text-sm text-[color:var(--text-secondary)]">
                    {data.date && (
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" />
                        {data.date}
                      </span>
                    )}
                    {data.city && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" />
                        {data.city}
                      </span>
                    )}
                    {data.expectedCrowd && (
                      <span className="flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" />
                        {data.expectedCrowd} expected
                      </span>
                    )}
                  </div>
                  {data.notes && (
                    <p className="text-xs text-[color:var(--text-muted)] line-clamp-3 border-t border-[color:var(--border-subtle)] pt-2">
                      {data.notes}
                    </p>
                  )}
                  {data.contactEmail && (
                    <a
                      href={`mailto:${data.contactEmail}`}
                      className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 transition-colors"
                    >
                      Contact Coordinator
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coordinator CTA */}
      <div className="mt-12 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="font-semibold text-[color:var(--text-primary)] mb-1">
            Hosting an event?
          </h3>
          <p className="text-sm text-[color:var(--text-secondary)]">
            Post your open call and let trucks come to you.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/event-coordinator/dashboard")}
          className="shrink-0"
        >
          Post an Event
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

export default TruckDiscovery;
