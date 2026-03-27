/**
 * Event Coordinator Dashboard
 *
 * - Create events with optional strict capacity cap
 * - View upcoming / past events with interest summary + fill-rate bar
 * - Expand any event to see interested trucks and accept / decline each
 */

import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { format, isPast, isToday } from "date-fns";
import {
  Calendar,
  Clock,
  MapPin,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Truck,
  Phone,
  Mail,
  Users,
  AlertCircle,
  Megaphone,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InterestSummary {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
  fillRate: number;
  isFull: boolean;
}

interface EventItem {
  id: string;
  name: string | null;
  description?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  maxTrucks: number;
  hardCapEnabled?: boolean;
  status: string;
  host: { businessName: string; address: string };
  interestSummary?: InterestSummary;
}

interface TruckInterest {
  id: string;
  eventId: string;
  truckId: string;
  message?: string | null;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  truck: {
    id: string;
    name: string;
    city?: string | null;
    state?: string | null;
    cuisineType?: string | null;
    phone?: string | null;
    email?: string | null;
    profileImageUrl?: string | null;
  } | null;
}

interface InterestsPayload {
  interests: TruckInterest[];
  summary: InterestSummary & { maxTrucks: number };
}

// ---------------------------------------------------------------------------
// FillRateBar
// ---------------------------------------------------------------------------

function FillRateBar({
  accepted,
  maxTrucks,
  isFull,
}: {
  accepted: number;
  maxTrucks: number;
  isFull: boolean;
}) {
  const pct = maxTrucks > 0 ? Math.min(100, Math.round((accepted / maxTrucks) * 100)) : 0;
  const color = isFull
    ? "bg-[color:var(--status-success)]"
    : pct >= 60
    ? "bg-[color:var(--status-warning)]"
    : "bg-[color:var(--accent-text)]";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-[color:var(--text-muted)]">
        <span>
          {accepted} / {maxTrucks} truck{maxTrucks !== 1 ? "s" : ""} confirmed
        </span>
        <span className={isFull ? "text-[color:var(--status-success)] font-semibold" : ""}>
          {pct}%{isFull ? " — Full" : ""}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[var(--bg-surface-muted)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InterestsPanel — lazy-loaded per event
// ---------------------------------------------------------------------------

function InterestsPanel({
  eventId,
  onSummaryChange,
}: {
  eventId: string;
  onSummaryChange: (eventId: string, newSummary: InterestSummary) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<InterestsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/event-coordinator/events/${eventId}/interests`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: InterestsPayload) => setData(d))
      .catch(() =>
        toast({
          title: "Error",
          description: "Could not load interests.",
          variant: "destructive",
        })
      )
      .finally(() => setLoading(false));
  }, [eventId, toast]);

  const handleAction = useCallback(
    async (interestId: string, status: "accepted" | "declined") => {
      setActionId(interestId);
      try {
        const res = await fetch(`/api/event-coordinator/interests/${interestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409) {
            toast({
              title: "Event Full",
              description: body.message || "This event has reached its truck capacity.",
              variant: "destructive",
            });
          } else {
            throw new Error(body.message || "Action failed");
          }
          return;
        }
        setData((prev) => {
          if (!prev) return prev;
          const updated = prev.interests.map((i) =>
            i.id === interestId ? { ...i, status } : i
          );
          const acceptedCount = updated.filter((i) => i.status === "accepted").length;
          const maxTrucks = prev.summary.maxTrucks;
          const newSummary: InterestsPayload["summary"] = {
            ...prev.summary,
            accepted: acceptedCount,
            pending: updated.filter((i) => i.status === "pending").length,
            declined: updated.filter((i) => i.status === "declined").length,
            fillRate: maxTrucks > 0 ? Math.round((acceptedCount / maxTrucks) * 100) : 0,
            isFull: maxTrucks > 0 && acceptedCount >= maxTrucks,
          };
          onSummaryChange(eventId, newSummary);
          return { interests: updated, summary: newSummary };
        });
        toast({
          title: status === "accepted" ? "Truck Accepted" : "Truck Declined",
          description:
            status === "accepted"
              ? "The truck has been confirmed for this event."
              : "The truck has been declined.",
        });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setActionId(null);
      }
    },
    [eventId, onSummaryChange, toast]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-[color:var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading interested trucks...
      </div>
    );
  }

  if (!data || data.interests.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[color:var(--text-muted)]">
        <Truck className="mx-auto h-8 w-8 mb-2 opacity-40" />
        No trucks have expressed interest yet.
      </div>
    );
  }

  const pending = data.interests.filter((i) => i.status === "pending");
  const accepted = data.interests.filter((i) => i.status === "accepted");
  const declined = data.interests.filter((i) => i.status === "declined");

  const renderGroup = (label: string, items: TruckInterest[], showActions: boolean) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)] px-1">
          {label} ({items.length})
        </h4>
        {items.map((interest) => (
          <div
            key={interest.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-[var(--bg-surface-muted)] border border-[color:var(--border-subtle)]"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {interest.truck?.profileImageUrl ? (
                <img
                  src={interest.truck.profileImageUrl}
                  alt={interest.truck.name}
                  className="h-10 w-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-[color:var(--accent-text)]/10 flex items-center justify-center shrink-0">
                  <Truck className="h-5 w-5 text-[color:var(--accent-text)]" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium text-[color:var(--text-primary)] truncate">
                  {interest.truck?.name ?? "Unknown Truck"}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[color:var(--text-muted)]">
                  {interest.truck?.cuisineType && <span>{interest.truck.cuisineType}</span>}
                  {(interest.truck?.city || interest.truck?.state) && (
                    <span>
                      {[interest.truck.city, interest.truck.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                  {interest.truck?.phone && (
                    <a
                      href={`tel:${interest.truck.phone}`}
                      className="flex items-center gap-1 text-[color:var(--accent-text)] hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {interest.truck.phone}
                    </a>
                  )}
                  {interest.truck?.email && (
                    <a
                      href={`mailto:${interest.truck.email}`}
                      className="flex items-center gap-1 text-[color:var(--accent-text)] hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {interest.truck.email}
                    </a>
                  )}
                </div>
                {interest.message && (
                  <p className="text-xs text-[color:var(--text-secondary)] mt-0.5 italic">
                    "{interest.message}"
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {showActions ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[color:var(--status-success)]/40 text-[color:var(--status-success)] hover:bg-[color:var(--status-success)]/10"
                    disabled={actionId === interest.id}
                    onClick={() => handleAction(interest.id, "accepted")}
                  >
                    {actionId === interest.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        Accept
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[color:var(--status-error)]/40 text-[color:var(--status-error)] hover:bg-[color:var(--status-error)]/10"
                    disabled={actionId === interest.id}
                    onClick={() => handleAction(interest.id, "declined")}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Decline
                  </Button>
                </>
              ) : (
                <Badge
                  variant="outline"
                  className={
                    interest.status === "accepted"
                      ? "border-[color:var(--status-success)]/40 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]"
                      : "border-[color:var(--status-error)]/40 bg-[color:var(--status-error)]/10 text-[color:var(--status-error)]"
                  }
                >
                  {interest.status === "accepted" ? (
                    <CheckCircle className="h-3 w-3 mr-1" />
                  ) : (
                    <XCircle className="h-3 w-3 mr-1" />
                  )}
                  {interest.status}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4 pt-2">
      <FillRateBar
        accepted={data.summary.accepted}
        maxTrucks={data.summary.maxTrucks}
        isFull={data.summary.isFull}
      />
      {data.summary.isFull && (
        <div className="flex items-center gap-2 text-xs text-[color:var(--status-success)] bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/20 rounded-lg px-3 py-2">
          <CheckCircle className="h-4 w-4 shrink-0" />
          This event is full — no more trucks can be accepted.
        </div>
      )}
      {renderGroup("Pending", pending, true)}
      {renderGroup("Accepted", accepted, false)}
      {renderGroup("Declined", declined, false)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventCard — with expandable interests panel
// ---------------------------------------------------------------------------

function EventCard({
  event,
  onSummaryChange,
}: {
  event: EventItem;
  onSummaryChange: (eventId: string, newSummary: InterestSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = event.interestSummary;
  const past = isPast(new Date(event.date)) && !isToday(new Date(event.date));

  return (
    <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-semibold text-[color:var(--text-primary)]">
                {event.name || "Food Truck Event"}
              </h3>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-md capitalize ${
                  past
                    ? "bg-[var(--bg-surface-muted)] text-[color:var(--text-muted)]"
                    : "bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]"
                }`}
              >
                {past ? "Past" : event.status}
              </span>
              {event.hardCapEnabled && (
                <Badge
                  variant="outline"
                  className="text-xs border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]"
                >
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Strict Cap
                </Badge>
              )}
            </div>
            <div className="text-sm text-[color:var(--text-secondary)] space-y-1 mt-1">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[color:var(--accent-text)]" />
                {format(new Date(event.date), "EEEE, MMMM d, yyyy")}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[color:var(--accent-text)]" />
                {event.startTime} – {event.endTime}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[color:var(--accent-text)]" />
                {event.host.businessName} · {event.host.address}
              </div>
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-[color:var(--accent-text)]" />
                Up to {event.maxTrucks} truck{event.maxTrucks !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>

        {summary && (
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[var(--bg-surface-muted)] text-[color:var(--text-secondary)]">
              <Users className="h-3.5 w-3.5" />
              {summary.total} interested
            </span>
            {summary.pending > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]">
                <Clock className="h-3.5 w-3.5" />
                {summary.pending} pending
              </span>
            )}
            {summary.accepted > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]">
                <CheckCircle className="h-3.5 w-3.5" />
                {summary.accepted} confirmed
              </span>
            )}
            {summary.isFull && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[color:var(--status-success)]/10 text-[color:var(--status-success)] font-semibold">
                <BarChart3 className="h-3.5 w-3.5" />
                Full
              </span>
            )}
          </div>
        )}

        {summary && summary.total > 0 && (
          <div className="mb-3">
            <FillRateBar
              accepted={summary.accepted}
              maxTrucks={event.maxTrucks}
              isFull={summary.isFull}
            />
          </div>
        )}

        <button
          className="w-full flex items-center justify-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors pt-2 border-t border-[color:var(--border-subtle)]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Hide interested trucks
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              {summary && summary.total > 0
                ? `Manage ${summary.total} interested truck${summary.total !== 1 ? "s" : ""}`
                : "View interested trucks"}
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)]">
          <InterestsPanel eventId={event.id} onSummaryChange={onSummaryChange} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EventCoordinatorDashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  const inputClassName = "event-form-field";

  const [formData, setFormData] = useState({
    organizationName: "",
    address: "",
    city: "",
    state: "",
    contactPhone: "",
    eventName: "",
    description: "",
    date: "",
    startTime: "",
    endTime: "",
    maxTrucks: 1,
    hardCapEnabled: false,
  });

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation("/login?redirect=/event-coordinator/dashboard");
      return;
    }
    if (user?.userType !== "event_coordinator") {
      setLocation("/");
      return;
    }
    const loadEvents = async () => {
      setIsLoadingPage(true);
      try {
        const res = await fetch("/api/event-coordinator/events", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load events");
        const data = await res.json();
        setEvents(Array.isArray(data) ? data : []);
      } catch {
        toast({
          title: "Error",
          description: "Could not load your events.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingPage(false);
      }
    };
    loadEvents();
  }, [isLoading, isAuthenticated, user, setLocation, toast]);

  const handleSummaryChange = useCallback(
    (eventId: string, newSummary: InterestSummary) => {
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, interestSummary: newSummary } : e))
      );
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/event-coordinator/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          businessName: formData.organizationName,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          contactPhone: formData.contactPhone,
          name: formData.eventName,
          description: formData.description,
          date: formData.date,
          startTime: formData.startTime,
          endTime: formData.endTime,
          maxTrucks: Number(formData.maxTrucks),
          hardCapEnabled: formData.hardCapEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to create event");
      setEvents((prev) => [data, ...prev]);
      setIsCreating(false);
      setFormData({
        organizationName: "",
        address: "",
        city: "",
        state: "",
        contactPhone: "",
        eventName: "",
        description: "",
        date: "",
        startTime: "",
        endTime: "",
        maxTrucks: 1,
        hardCapEnabled: false,
      });
      toast({ title: "Event Published!", description: "Trucks can now express interest." });
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const upcoming = events.filter((e) => new Date(e.date) >= today);
  const past = events.filter((e) => new Date(e.date) < today);

  if (isLoading || isLoadingPage) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[color:var(--accent-text)]" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12 min-h-screen bg-[var(--bg-layered)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)] mb-2">
            <Megaphone className="h-3.5 w-3.5" />
            Event Coordinator
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-[color:var(--text-primary)]">
            Your Events
          </h1>
          <p className="text-[color:var(--text-secondary)] mt-1">
            Post open calls and manage truck interest.
          </p>
        </div>
        <Button onClick={() => setIsCreating(!isCreating)} className="w-full sm:w-auto shrink-0">
          {isCreating ? "Cancel" : <><Plus className="mr-2 h-4 w-4" />New Event</>}
        </Button>
      </div>

      {/* Create form */}
      {isCreating && (
        <div className="bg-[var(--bg-card)] p-6 rounded-xl border border-[color:var(--border-subtle)] shadow-clean mb-8 event-form">
          <h2 className="text-lg font-semibold mb-4">Create Event</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {createError && (
              <div className="p-3 bg-[color:var(--status-error)]/10 text-[color:var(--status-error)] rounded-md text-sm">
                {createError}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName">Organization Name</Label>
                <Input id="organizationName" value={formData.organizationName} onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">Contact Phone</Label>
                <Input id="contactPhone" value={formData.contactPhone} onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })} className={inputClassName} required />
              </div>
            </div>
            <div className="grid md:grid-cols-4 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} className={inputClassName} required />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eventName">Event Name</Label>
                <Input id="eventName" value={formData.eventName} onChange={(e) => setFormData({ ...formData, eventName: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxTrucks">Trucks Needed</Label>
                <Input id="maxTrucks" type="number" min="1" max="100" value={formData.maxTrucks} onChange={(e) => setFormData({ ...formData, maxTrucks: Number(e.target.value) })} className={inputClassName} required />
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="startTime">Start Time</Label>
                <Input id="startTime" type="time" value={formData.startTime} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} className={inputClassName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time</Label>
                <Input id="endTime" type="time" value={formData.endTime} onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} className={inputClassName} required />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="hardCapEnabled"
                type="checkbox"
                checked={formData.hardCapEnabled}
                onChange={(e) => setFormData({ ...formData, hardCapEnabled: e.target.checked })}
                className="h-4 w-4 accent-[color:var(--accent-text)]"
              />
              <Label htmlFor="hardCapEnabled" className="cursor-pointer">
                Enforce strict capacity cap (block acceptances once full)
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Event details, expectations, vendor notes..." className={inputClassName} rows={4} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Publish Event
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Events tabs */}
      <Tabs defaultValue="upcoming" className="w-full">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Your Events</h2>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="upcoming">
              Upcoming
              {upcoming.length > 0 && (
                <span className="ml-1.5 text-xs bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)] px-1.5 py-0.5 rounded-full">
                  {upcoming.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="upcoming" className="space-y-4">
          {upcoming.length === 0 ? (
            <Card className="p-8 text-center text-[color:var(--text-secondary)] bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <Calendar className="mx-auto h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No upcoming events yet.</p>
              <p className="text-sm mt-1">
                Click{" "}
                <button className="text-[color:var(--accent-text)] hover:underline" onClick={() => setIsCreating(true)}>
                  New Event
                </button>{" "}
                to post your first open call.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {upcoming.map((event) => (
                <EventCard key={event.id} event={event} onSummaryChange={handleSummaryChange} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {past.length === 0 ? (
            <Card className="p-8 text-center text-[color:var(--text-secondary)] bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              No past events yet.
            </Card>
          ) : (
            <div className="grid gap-4 opacity-80">
              {past.map((event) => (
                <EventCard key={event.id} event={event} onSummaryChange={handleSummaryChange} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
