import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  MapPin,
  Users,
  Clock,
  ShieldCheck,
  Truck,
  ChevronRight,
  ClipboardList,
  Send,
} from "lucide-react";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EventIntakeRequest = {
  id: string;
  claimType: string;
  status: string;
  createdAt: string;
  eventVisibility: "public" | "private" | "unknown";
  discoverableByAllUsers: boolean | null;
  requestedTruckCount: number | null;
  requester: {
    email: string | null;
    name: string | null;
  };
  summary: {
    title: string;
    city: string | null;
    date: string | null;
    expectedCrowd: string | null;
    guestCount: string | null;
  };
  claimData?: Record<string, any>;
  metadata?: Record<string, any>;
};

type EventIntakeResponse = {
  ok: boolean;
  total: number;
  items: EventIntakeRequest[];
};

export default function EventsPage() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEventCoordinator = Boolean(
    isAuthenticated &&
    ["event_coordinator", "admin", "super_admin", "staff"].includes(
      String(user?.userType || ""),
    ),
  );
  const isStaffOrAdmin = Boolean(
    isAuthenticated &&
    ["admin", "super_admin", "staff"].includes(String(user?.userType || "")),
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeView, setActiveView] = useState<"discover" | "manage">(
    "discover",
  );
  const [intakeVisibilityFilter, setIntakeVisibilityFilter] = useState<
    "all" | "public" | "private" | "unknown"
  >("all");
  const [intakeTypeFilter, setIntakeTypeFilter] = useState<
    "all" | "event" | "food_truck"
  >("all");
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [intakeEdit, setIntakeEdit] = useState({
    eventName: "",
    date: "",
    startTime: "",
    endTime: "",
    eventVisibility: "public" as "public" | "private",
    requestedVendorType: "",
    requestedTruckCount: "1",
    hostBusinessName: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    organizerName: "",
    organizerEmail: "",
    organizerPhone: "",
    requestSummary: "",
    missingFields: "",
  });
  const [formData, setFormData] = useState({
    organizationName: "",
    address: "",
    city: "",
    state: "",
    contactPhone: "",
    eventName: "",
    description: "",
    eventVisibility: "public" as "public" | "private",
    date: "",
    startTime: "",
    endTime: "",
    maxTrucks: 1,
    eventCadence: "one_time" as "one_time" | "recurring",
    recurringDaysOfWeek: [] as number[],
    recurrenceEndDate: "",
    requiresPayment: false,
    amenities: [] as string[],
    hostPriceDollars: "",
    breakfastPriceDollars: "",
    lunchPriceDollars: "",
    dinnerPriceDollars: "",
    dailyPriceDollars: "",
    weeklyPriceDollars: "",
    monthlyPriceDollars: "",
  });
  const isPrivateEvent = formData.eventVisibility === "private";
  const isRecurringEvent =
    !isPrivateEvent && formData.eventCadence === "recurring";
  const showPricingFields = !isPrivateEvent && formData.requiresPayment;

  const parseDollarsToCents = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return Math.round(parsed * 100);
  };

  const { data: events = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/events/upcoming"],
  });
  const { data: businesses = [] } = useQuery<any[]>({
    queryKey: ["/api/restaurants/public", "events-directory"],
    queryFn: async () => {
      const res = await fetch("/api/restaurants/public?limit=120");
      if (!res.ok) {
        return [];
      }
      return await res.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: intakeData } = useQuery<EventIntakeResponse>({
    queryKey: [
      "/api/admin/event-intake-requests",
      intakeVisibilityFilter,
      intakeTypeFilter,
    ],
    enabled: isStaffOrAdmin,
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "120",
        visibility: intakeVisibilityFilter,
        claimType: intakeTypeFilter,
      });
      const res = await fetch(
        `/api/admin/event-intake-requests?${params.toString()}`,
        {
          credentials: "include",
        },
      );
      if (!res.ok) {
        throw new Error("Failed to load intake requests");
      }
      return await res.json();
    },
    refetchOnWindowFocus: false,
  });
  const truckDirectory = (Array.isArray(businesses) ? businesses : []).filter(
    (business) => Boolean(business?.isFoodTruck),
  );
  const discoverEvents = (Array.isArray(events) ? events : []).filter(
    (event: any) => String(event?.status || "") === "published",
  );
  const eventCountLabel =
    discoverEvents.length === 1
      ? "1 upcoming event"
      : `${discoverEvents.length} upcoming events`;
  const intakeItems = Array.isArray(intakeData?.items) ? intakeData.items : [];
  const selectedIntake = selectedIntakeId
    ? intakeItems.find((item) => item.id === selectedIntakeId) || null
    : null;
  const hasOperationsTools = isStaffOrAdmin || isEventCoordinator;
  const isManageView = activeView === "manage";
  const pageTitle = isManageView
    ? isStaffOrAdmin
      ? "Admin Queue"
      : "Organizer Events"
    : "Book Trucks";
  const pageDeck = isManageView
    ? isStaffOrAdmin
      ? "Inbound event, catering, and truck opportunity requests."
      : "Post and manage event opportunities."
    : "Choose the fastest path for a private booking, open call, or truck profile.";
  const activeViewBadge = isManageView
    ? isStaffOrAdmin
      ? "Admin view"
      : "Organizer view"
    : "Public view";
  const discoverTabLabel = isStaffOrAdmin ? "Public" : "Browse";
  const manageTabLabel = isStaffOrAdmin ? "Admin queue" : "Organizer";
  const modeTitle = isManageView
    ? isStaffOrAdmin
      ? "Viewing admin queue"
      : "Viewing organizer tools"
    : "Viewing public events";
  const modeDescription = isManageView
    ? isStaffOrAdmin
      ? `${intakeItems.length} request${intakeItems.length === 1 ? "" : "s"} in this queue`
      : "Create and update event opportunities"
    : eventCountLabel;
  const HeaderIcon = isManageView ? ShieldCheck : Truck;
  const scrollToTruckDirectory = () => {
    document.getElementById("food-truck-directory")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const bookingActions = [
    {
      title: "Book one specific truck",
      description:
        "Send a direct request for parties, offices, job sites, and neighborhoods.",
      badge: "Private request",
      icon: Truck,
      onSelect: () => setLocation("/request-truck"),
    },
    {
      title: "Find trucks for an event",
      description:
        "Post the event details or review open calls looking for vendors.",
      badge: hasOperationsTools ? "Organizer tools" : "Open calls",
      icon: Send,
      onSelect: () =>
        hasOperationsTools
          ? setActiveView("manage")
          : setLocation("/truck-discovery"),
    },
    {
      title: "Browse truck profiles",
      description:
        "Compare local trucks, cuisine, and profile details before sending a request.",
      badge: "Directory",
      icon: Users,
      onSelect: scrollToTruckDirectory,
    },
  ];

  const toEventSlug = (event: any) => {
    const id = String(event?.id || "").trim();
    const name = String(event?.name || "event")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 80);
    return `${id}-${name || "event"}`;
  };

  const openIntakeEditor = (item: EventIntakeRequest) => {
    const claimData = item.claimData || {};
    const organizer =
      claimData.organizer && typeof claimData.organizer === "object"
        ? claimData.organizer
        : {};
    setSelectedIntakeId(item.id);
    setIntakeEdit({
      eventName: String(
        claimData.eventName || claimData.occasion || item.summary.title || "",
      ),
      date: String(claimData.date || item.summary.date || ""),
      startTime: String(claimData.startTime || ""),
      endTime: String(claimData.endTime || ""),
      eventVisibility:
        item.eventVisibility === "private" ? "private" : "public",
      requestedVendorType: String(claimData.requestedVendorType || ""),
      requestedTruckCount: String(
        claimData.requestedTruckCount || claimData.maxTrucks || 1,
      ),
      hostBusinessName: String(
        claimData.hostBusinessName || claimData.businessName || "",
      ),
      address: String(claimData.address || ""),
      city: String(claimData.city || item.summary.city || ""),
      state: String(claimData.state || ""),
      zip: String(claimData.zip || ""),
      organizerName: String(organizer.name || item.requester.name || ""),
      organizerEmail: String(organizer.email || item.requester.email || ""),
      organizerPhone: String(organizer.phone || ""),
      requestSummary: String(claimData.requestSummary || ""),
      missingFields: Array.isArray(claimData.missingFields)
        ? claimData.missingFields.join(", ")
        : "",
    });
  };

  const updateIntake = useMutation({
    mutationFn: async () => {
      if (!selectedIntakeId) throw new Error("Select a request first");
      const payload = {
        eventName: intakeEdit.eventName,
        date: intakeEdit.date,
        startTime: intakeEdit.startTime,
        endTime: intakeEdit.endTime,
        eventVisibility: intakeEdit.eventVisibility,
        requestedVendorType: intakeEdit.requestedVendorType,
        requestedTruckCount: Number(intakeEdit.requestedTruckCount || 1),
        hostBusinessName: intakeEdit.hostBusinessName,
        address: intakeEdit.address,
        city: intakeEdit.city,
        state: intakeEdit.state,
        zip: intakeEdit.zip,
        requestSummary: intakeEdit.requestSummary,
        missingFields: intakeEdit.missingFields
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        organizer: {
          name: intakeEdit.organizerName,
          email: intakeEdit.organizerEmail,
          phone: intakeEdit.organizerPhone,
        },
      };
      const res = await fetch(`/api/admin/event-intake-requests/${selectedIntakeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to update request");
      }
      return await res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [
          "/api/admin/event-intake-requests",
          intakeVisibilityFilter,
          intakeTypeFilter,
        ],
      });
      toast({
        title: "Request updated",
        description: "The admin queue item now has the corrected details.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const createEvent = useMutation({
    mutationFn: async () => {
      const payload = {
        businessName: formData.organizationName,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        contactPhone: formData.contactPhone,
        name: formData.eventName,
        description: formData.description,
        eventVisibility: formData.eventVisibility,
        date: formData.date,
        startTime: formData.startTime,
        endTime: formData.endTime,
        maxTrucks: Number(formData.maxTrucks),
        eventCadence: isPrivateEvent ? "one_time" : formData.eventCadence,
        recurringDaysOfWeek: isRecurringEvent
          ? formData.recurringDaysOfWeek
          : [],
        recurrenceEndDate: isRecurringEvent
          ? formData.recurrenceEndDate
          : undefined,
        requiresPayment: showPricingFields,
        amenities: formData.amenities,
        ...(showPricingFields
          ? {
              hostPriceCents: parseDollarsToCents(formData.hostPriceDollars),
              breakfastPriceCents: parseDollarsToCents(
                formData.breakfastPriceDollars,
              ),
              lunchPriceCents: parseDollarsToCents(formData.lunchPriceDollars),
              dinnerPriceCents: parseDollarsToCents(
                formData.dinnerPriceDollars,
              ),
              dailyPriceCents: parseDollarsToCents(formData.dailyPriceDollars),
              weeklyPriceCents: parseDollarsToCents(
                formData.weeklyPriceDollars,
              ),
              monthlyPriceCents: parseDollarsToCents(
                formData.monthlyPriceDollars,
              ),
            }
          : {}),
      };

      const res = await fetch("/api/event-coordinator/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create event");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/events/upcoming"],
      });
      setShowCreateForm(false);
      setFormData({
        organizationName: "",
        address: "",
        city: "",
        state: "",
        contactPhone: "",
        eventName: "",
        description: "",
        eventVisibility: "public",
        date: "",
        startTime: "",
        endTime: "",
        maxTrucks: 1,
        eventCadence: "one_time",
        recurringDaysOfWeek: [],
        recurrenceEndDate: "",
        requiresPayment: false,
        amenities: [],
        hostPriceDollars: "",
        breakfastPriceDollars: "",
        lunchPriceDollars: "",
        dinnerPriceDollars: "",
        dailyPriceDollars: "",
        weeklyPriceDollars: "",
        monthlyPriceDollars: "",
      });
      toast({
        title: "Event posted",
        description: "Your event is now available on the Events page.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to post event",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const hasAnyPricing = [
      formData.hostPriceDollars,
      formData.breakfastPriceDollars,
      formData.lunchPriceDollars,
      formData.dinnerPriceDollars,
      formData.dailyPriceDollars,
      formData.weeklyPriceDollars,
      formData.monthlyPriceDollars,
    ].some((value) => Number(String(value || "").trim() || 0) > 0);
    if (
      isPrivateEvent &&
      (formData.eventCadence === "recurring" ||
        formData.requiresPayment ||
        hasAnyPricing)
    ) {
      toast({
        title: "Private event rules",
        description:
          "Private events cannot be recurring or paid. Switch to Public to use Parking Pass settings.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.organizationName.trim() || !formData.eventName.trim()) {
      toast({
        title: "Missing basic info",
        description: "Add organization name and event name.",
        variant: "destructive",
      });
      return;
    }

    if (
      !formData.address.trim() ||
      !formData.city.trim() ||
      !formData.state.trim() ||
      !formData.contactPhone.trim()
    ) {
      toast({
        title: "Missing location or contact",
        description: "Add address, city, state, and contact phone.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.date || !formData.startTime || !formData.endTime) {
      toast({
        title: "Missing schedule",
        description: "Set date, start time, and end time.",
        variant: "destructive",
      });
      return;
    }

    if (formData.startTime >= formData.endTime) {
      toast({
        title: "Invalid time range",
        description: "End time must be later than start time.",
        variant: "destructive",
      });
      return;
    }

    if (isRecurringEvent && formData.recurringDaysOfWeek.length === 0) {
      toast({
        title: "Recurring days required",
        description: "Pick at least one day for recurring events.",
        variant: "destructive",
      });
      return;
    }

    if (isRecurringEvent && !formData.recurrenceEndDate) {
      toast({
        title: "Recurring end date required",
        description: "Set when the recurring schedule should stop.",
        variant: "destructive",
      });
      return;
    }

    if (
      showPricingFields &&
      ![
        formData.hostPriceDollars,
        formData.breakfastPriceDollars,
        formData.lunchPriceDollars,
        formData.dinnerPriceDollars,
        formData.dailyPriceDollars,
        formData.weeklyPriceDollars,
        formData.monthlyPriceDollars,
      ].some((value) => Number(String(value || "").trim() || 0) > 0)
    ) {
      toast({
        title: "Pricing required",
        description: "Add at least one pricing value for paid events.",
        variant: "destructive",
      });
      return;
    }

    if (!createEvent.isPending) {
      createEvent.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)] p-4">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-6 w-96" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Food Truck Events & Open Calls | MealScout"
        description="Browse upcoming food truck events and open calls near you. Find events looking for food trucks, or discover local food festivals and pop-ups on MealScout."
        ogType="website"
      />
      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-3 text-3xl font-bold text-[color:var(--text-primary)] sm:text-4xl">
                <HeaderIcon className="h-8 w-8 text-[color:var(--accent-text)] sm:h-9 sm:w-9" />
                {pageTitle}
              </h1>
              {hasOperationsTools && (
                <Badge variant={isManageView ? "default" : "secondary"}>
                  {activeViewBadge}
                </Badge>
              )}
            </div>
            <p className="text-sm text-[color:var(--text-secondary)]">
              {pageDeck}
            </p>
          </div>
          {hasOperationsTools && (
            <div className="inline-flex rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-1">
              <Button
                variant={activeView === "discover" ? "default" : "ghost"}
                className="rounded-full"
                onClick={() => setActiveView("discover")}
                data-testid="button-events-discover-view"
              >
                {discoverTabLabel}
              </Button>
              <Button
                variant={activeView === "manage" ? "default" : "ghost"}
                className="rounded-full"
                onClick={() => setActiveView("manage")}
                data-testid="button-events-manage-view"
              >
                {manageTabLabel}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                {modeTitle}
              </p>
              <p className="truncate text-xs text-[color:var(--text-muted)]">
                {modeDescription}
              </p>
            </div>
            {hasOperationsTools ? (
              <Badge variant={isManageView ? "default" : "secondary"}>
                {activeViewBadge}
              </Badge>
            ) : null}
          </div>

          {activeView === "manage" && isStaffOrAdmin && (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                      <ClipboardList className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="text-lg">
                        Pending requests
                      </CardTitle>
                      <p className="text-sm text-[color:var(--text-secondary)]">
                        {intakeItems.length} request
                        {intakeItems.length === 1 ? "" : "s"} need review.
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Admin queue</Badge>
                </div>
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <Label htmlFor="intakeVisibility">Visibility</Label>
                    <select
                      id="intakeVisibility"
                      className="mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                      value={intakeVisibilityFilter}
                      onChange={(e) =>
                        setIntakeVisibilityFilter(
                          e.target.value as
                            | "all"
                            | "public"
                            | "private"
                            | "unknown",
                        )
                      }
                    >
                      <option value="all">All visibility</option>
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="intakeType">Request type</Label>
                    <select
                      id="intakeType"
                      className="mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                      value={intakeTypeFilter}
                      onChange={(e) =>
                        setIntakeTypeFilter(
                          e.target.value as "all" | "event" | "food_truck",
                        )
                      }
                    >
                      <option value="all">All opportunity types</option>
                      <option value="event">Organizer/event intake</option>
                      <option value="food_truck">Truck/catering intake</option>
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {intakeItems.length === 0 ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    No matching intake requests.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {intakeItems.slice(0, 12).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openIntakeEditor(item)}
                        className={`flex w-full gap-3 rounded-lg border p-3 text-left transition-colors ${
                          selectedIntakeId === item.id
                            ? "border-[color:var(--accent-text)] bg-[color:var(--accent-text)]/10"
                            : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[color:var(--accent-text)]/60"
                        }`}
                        data-testid={`button-edit-intake-${item.id}`}
                      >
                        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                          {item.claimType === "event" ? (
                            <Calendar className="h-4 w-4" />
                          ) : (
                            <Truck className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="outline">
                              {item.claimType === "event"
                                ? "Organizer"
                                : "Truck/catering"}
                            </Badge>
                            <Badge
                              variant={
                                item.eventVisibility === "public"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {item.eventVisibility === "public"
                                ? "Public"
                                : item.eventVisibility === "private"
                                  ? "Private"
                                  : "Unknown"}
                            </Badge>
                            {item.requestedTruckCount ? (
                              <Badge variant="outline">
                                {item.requestedTruckCount} truck
                                {item.requestedTruckCount === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)] line-clamp-1">
                            {item.summary.title}
                          </p>
                          <p className="text-xs text-[color:var(--text-muted)] mt-1">
                            {[item.summary.city, item.summary.date]
                              .filter(Boolean)
                              .join(" • ") || "No location/date provided"}
                          </p>
                          <p className="text-xs text-[color:var(--text-muted)] mt-1 line-clamp-1">
                            {item.requester.name || "Unknown requester"}
                            {item.requester.email
                              ? ` · ${item.requester.email}`
                              : ""}
                          </p>
                        </div>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
                      </button>
                    ))}
                  </div>
                )}

                {selectedIntake && (
                  <div className="mt-4 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                          Edit queue request
                        </p>
                        <p className="text-xs text-[color:var(--text-muted)]">
                          Update visibility and event details before outreach.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedIntakeId(null)}
                      >
                        Close
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="intakeEventName">Event name</Label>
                        <Input
                          id="intakeEventName"
                          value={intakeEdit.eventName}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              eventName: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeVisibilityEdit">Visibility</Label>
                        <select
                          id="intakeVisibilityEdit"
                          className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                          value={intakeEdit.eventVisibility}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              eventVisibility: e.target.value as
                                | "public"
                                | "private",
                            }))
                          }
                        >
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeTruckCount">Trucks needed</Label>
                        <Input
                          id="intakeTruckCount"
                          type="number"
                          min={1}
                          max={50}
                          value={intakeEdit.requestedTruckCount}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              requestedTruckCount: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeDate">Date</Label>
                        <Input
                          id="intakeDate"
                          type="date"
                          value={intakeEdit.date}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              date: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="intakeStartTime">Start</Label>
                          <Input
                            id="intakeStartTime"
                            type="time"
                            value={intakeEdit.startTime}
                            onChange={(e) =>
                              setIntakeEdit((prev) => ({
                                ...prev,
                                startTime: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="intakeEndTime">End</Label>
                          <Input
                            id="intakeEndTime"
                            type="time"
                            value={intakeEdit.endTime}
                            onChange={(e) =>
                              setIntakeEdit((prev) => ({
                                ...prev,
                                endTime: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeVendorType">Vendor type</Label>
                        <Input
                          id="intakeVendorType"
                          value={intakeEdit.requestedVendorType}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              requestedVendorType: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeHostName">Host name</Label>
                        <Input
                          id="intakeHostName"
                          value={intakeEdit.hostBusinessName}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              hostBusinessName: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="intakeAddress">Address</Label>
                        <Input
                          id="intakeAddress"
                          value={intakeEdit.address}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              address: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeCity">City</Label>
                        <Input
                          id="intakeCity"
                          value={intakeEdit.city}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              city: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="intakeState">State</Label>
                          <Input
                            id="intakeState"
                            value={intakeEdit.state}
                            onChange={(e) =>
                              setIntakeEdit((prev) => ({
                                ...prev,
                                state: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="intakeZip">ZIP</Label>
                          <Input
                            id="intakeZip"
                            value={intakeEdit.zip}
                            onChange={(e) =>
                              setIntakeEdit((prev) => ({
                                ...prev,
                                zip: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeOrganizerName">Contact name</Label>
                        <Input
                          id="intakeOrganizerName"
                          value={intakeEdit.organizerName}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              organizerName: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="intakeOrganizerEmail">Contact email</Label>
                        <Input
                          id="intakeOrganizerEmail"
                          type="email"
                          value={intakeEdit.organizerEmail}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              organizerEmail: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="intakeSummary">Notes</Label>
                        <Textarea
                          id="intakeSummary"
                          value={intakeEdit.requestSummary}
                          onChange={(e) =>
                            setIntakeEdit((prev) => ({
                              ...prev,
                              requestSummary: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSelectedIntakeId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={() => updateIntake.mutate()}
                        disabled={updateIntake.isPending}
                      >
                        {updateIntake.isPending ? "Saving..." : "Save changes"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeView === "manage" && isEventCoordinator && (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Event Organizer</CardTitle>
                  <Button
                    variant={showCreateForm ? "outline" : "default"}
                    onClick={() => setShowCreateForm((value) => !value)}
                    data-testid="button-toggle-create-event"
                  >
                    {showCreateForm ? "Cancel" : "Post Event"}
                  </Button>
                </div>
              </CardHeader>
              {showCreateForm && (
                <CardContent>
                  <form onSubmit={handleCreateEvent} className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="organizationName">
                          Organization Name
                        </Label>
                        <Input
                          id="organizationName"
                          required
                          value={formData.organizationName}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              organizationName: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="contactPhone">Contact Phone</Label>
                        <Input
                          id="contactPhone"
                          required
                          value={formData.contactPhone}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              contactPhone: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-4 gap-4">
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <Input
                          id="address"
                          required
                          value={formData.address}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              address: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          required
                          value={formData.city}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              city: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State</Label>
                        <Input
                          id="state"
                          required
                          value={formData.state}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              state: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="eventName">Event Name</Label>
                        <Input
                          id="eventName"
                          required
                          value={formData.eventName}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              eventName: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxTrucks">Trucks Needed</Label>
                        <Input
                          id="maxTrucks"
                          type="number"
                          min={1}
                          max={50}
                          required
                          value={formData.maxTrucks}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              maxTrucks: Math.max(
                                1,
                                Number(e.target.value || 1),
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="eventVisibility">Event Visibility</Label>
                      <select
                        id="eventVisibility"
                        className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                        value={formData.eventVisibility}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            eventVisibility: e.target.value as
                              | "public"
                              | "private",
                            ...(e.target.value === "private"
                              ? {
                                  eventCadence: "one_time" as const,
                                  recurringDaysOfWeek: [],
                                  recurrenceEndDate: "",
                                  requiresPayment: false,
                                  hostPriceDollars: "",
                                  breakfastPriceDollars: "",
                                  lunchPriceDollars: "",
                                  dinnerPriceDollars: "",
                                  dailyPriceDollars: "",
                                  weeklyPriceDollars: "",
                                  monthlyPriceDollars: "",
                                }
                              : {}),
                          }))
                        }
                        required
                      >
                        <option value="public">
                          Public (discoverable by all users)
                        </option>
                        <option value="private">
                          Private (not discoverable in public feeds)
                        </option>
                      </select>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="eventCadence">Event Type</Label>
                        <select
                          id="eventCadence"
                          required
                          className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                          value={formData.eventCadence}
                          disabled={formData.eventVisibility === "private"}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              eventCadence: e.target.value as
                                | "one_time"
                                | "recurring",
                              recurringDaysOfWeek:
                                e.target.value === "recurring"
                                  ? prev.recurringDaysOfWeek
                                  : [],
                              recurrenceEndDate:
                                e.target.value === "recurring"
                                  ? prev.recurrenceEndDate
                                  : "",
                            }))
                          }
                        >
                          <option value="one_time">One-time</option>
                          <option value="recurring">Recurring</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="date">Date</Label>
                        <Input
                          id="date"
                          type="date"
                          required
                          value={formData.date}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              date: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="startTime">Start Time</Label>
                        <Input
                          id="startTime"
                          type="time"
                          required
                          value={formData.startTime}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              startTime: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="endTime">End Time</Label>
                        <Input
                          id="endTime"
                          type="time"
                          required
                          value={formData.endTime}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              endTime: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    {formData.eventCadence === "recurring" && (
                      <div className="space-y-3 rounded-lg border border-[color:var(--border-subtle)] p-3">
                        <div className="space-y-2">
                          <Label>Recurring Days</Label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { day: 0, label: "Sun" },
                              { day: 1, label: "Mon" },
                              { day: 2, label: "Tue" },
                              { day: 3, label: "Wed" },
                              { day: 4, label: "Thu" },
                              { day: 5, label: "Fri" },
                              { day: 6, label: "Sat" },
                            ].map((item) => (
                              <label
                                key={item.day}
                                className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={formData.recurringDaysOfWeek.includes(
                                    item.day,
                                  )}
                                  onChange={(e) =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      recurringDaysOfWeek: e.target.checked
                                        ? [
                                            ...prev.recurringDaysOfWeek,
                                            item.day,
                                          ]
                                        : prev.recurringDaysOfWeek.filter(
                                            (day) => day !== item.day,
                                          ),
                                    }))
                                  }
                                />
                                {item.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="recurrenceEndDate">
                            Recurring End Date
                          </Label>
                          <Input
                            id="recurrenceEndDate"
                            type="date"
                            required={formData.eventCadence === "recurring"}
                            value={formData.recurrenceEndDate}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                recurrenceEndDate: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-[color:var(--border-subtle)] p-3">
                      <label className="inline-flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={formData.requiresPayment}
                          disabled={isPrivateEvent}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              requiresPayment: e.target.checked,
                            }))
                          }
                        />
                        Paid Event / Parking Pass
                      </label>
                      <p className="text-xs text-[color:var(--text-muted)]">
                        {formData.eventVisibility === "private"
                          ? "Private events are always one-time and unpaid."
                          : "Recurring or paid events are posted through the parking pass flow."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Amenities</Label>
                      <div className="flex flex-wrap gap-2">
                        {["power", "water", "restrooms", "wifi", "seating"].map(
                          (amenity) => (
                            <label
                              key={amenity}
                              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-sm capitalize"
                            >
                              <input
                                type="checkbox"
                                checked={formData.amenities.includes(amenity)}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    amenities: e.target.checked
                                      ? [...prev.amenities, amenity]
                                      : prev.amenities.filter(
                                          (item) => item !== amenity,
                                        ),
                                  }))
                                }
                              />
                              {amenity}
                            </label>
                          ),
                        )}
                      </div>
                    </div>

                    {showPricingFields && (
                      <div className="space-y-2 rounded-lg border border-[color:var(--border-subtle)] p-3">
                        <Label>Pricing (USD)</Label>
                        <p className="text-xs text-[color:var(--text-muted)]">
                          Add one or more fees for paid public events.
                        </p>
                        <div className="grid md:grid-cols-3 gap-3">
                          {[
                            ["hostPriceDollars", "Host Fee"],
                            ["breakfastPriceDollars", "Breakfast"],
                            ["lunchPriceDollars", "Lunch"],
                            ["dinnerPriceDollars", "Dinner"],
                            ["dailyPriceDollars", "Daily"],
                            ["weeklyPriceDollars", "Weekly"],
                            ["monthlyPriceDollars", "Monthly"],
                          ].map(([field, label]) => (
                            <div key={field} className="space-y-1">
                              <Label htmlFor={field}>{label}</Label>
                              <Input
                                id={field}
                                type="number"
                                min={0}
                                step="0.01"
                                value={(formData as any)[field] || ""}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    [field]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={createEvent.isPending}
                      data-testid="button-submit-create-event"
                    >
                      {createEvent.isPending ? "Posting..." : "Post Event"}
                    </Button>
                  </form>
                </CardContent>
              )}
            </Card>
          )}
        </div>

        {activeView === "discover" && (
          <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
                  Choose a booking path
                </h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Start with the action that matches the job.
                </p>
              </div>
              <Badge variant="secondary">Booking</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {bookingActions.map((action) => {
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.title}
                    type="button"
                    onClick={action.onSelect}
                    className="group flex min-h-32 items-center gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[color:var(--accent-text)] hover:shadow-clean"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                      <ActionIcon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-2 inline-flex rounded-full bg-[color:var(--accent-text)]/10 px-2 py-1 text-xs font-semibold text-[color:var(--accent-text)]">
                        {action.badge}
                      </span>
                      <span className="block text-base font-semibold text-[color:var(--text-primary)]">
                        {action.title}
                      </span>
                      <span className="mt-1 block text-sm text-[color:var(--text-secondary)]">
                        {action.description}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[color:var(--text-muted)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--accent-text)]" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Events Grid */}
        {activeView === "discover" && discoverEvents.length === 0 ? (
          <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                  <Calendar className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[color:var(--text-primary)]">
                    No public events yet
                  </h3>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Send a private request, review open calls, or browse truck profiles.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/truck-discovery")}
              >
                Review open calls
              </Button>
            </div>
          </section>
        ) : activeView === "discover" ? (
          <>
            <p className="text-sm text-[color:var(--text-muted)]">
              {eventCountLabel}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {discoverEvents.map((event: any) => (
                <Card
                  key={event.id}
                  className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/event/${toEventSlug(event)}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocation(`/event/${toEventSlug(event)}`);
                    }
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg line-clamp-2">
                        {event.name || "Food Truck Event"}
                      </CardTitle>
                      <Badge variant="default">Open</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Date & Time */}
                    {event.date && (
                      <div className="flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
                        <Clock className="w-4 h-4" />
                        <span>
                          {new Date(event.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    )}

                    {/* Location */}
                    {event.host?.businessName && (
                      <div className="flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
                        <MapPin className="w-4 h-4" />
                        <span className="line-clamp-1">
                          {event.host.businessName}
                        </span>
                      </div>
                    )}

                    {/* Capacity */}
                    {event.maxTrucks && (
                      <div className="flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
                        <Users className="w-4 h-4" />
                        <span>Up to {event.maxTrucks} trucks</span>
                      </div>
                    )}

                    {event.requiresPayment && event.hostPriceCents ? (
                      <div className="flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--accent-text)]/10 text-[10px] font-bold text-[color:var(--accent-text)]">
                          $
                        </span>
                        <span>
                          ${(Number(event.hostPriceCents) / 100).toFixed(2)}{" "}
                          host fee + $10 platform fee
                        </span>
                      </div>
                    ) : null}

                    {/* Description */}
                    {event.description && (
                      <p className="text-sm text-[color:var(--text-muted)] line-clamp-3">
                        {event.description}
                      </p>
                    )}

                    {/* Series Info */}
                    {event.series && (
                      <Badge variant="secondary" className="text-xs">
                        {event.series.name}
                      </Badge>
                    )}

                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/event/${toEventSlug(event)}`);
                        }}
                      >
                        View details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}

        {activeView === "discover" ? (
          <Card id="food-truck-directory" className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean scroll-mt-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                    <Truck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">Food trucks</CardTitle>
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      Browse bookable truck profiles.
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">{truckDirectory.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {truckDirectory.length === 0 ? (
                <p className="text-sm text-[color:var(--text-muted)]">
                  No truck profiles available yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {truckDirectory.slice(0, 18).map((truck) => (
                    <a
                      key={truck.id}
                      href={`/restaurant/${truck.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition hover:border-[color:var(--accent-text)] hover:shadow-clean"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                          <Truck className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-[color:var(--text-primary)] line-clamp-1">
                            {truck.name}
                          </p>
                          <p className="text-xs text-[color:var(--text-secondary)] mt-1 line-clamp-1">
                            {truck.cuisineType || "Food Truck"}
                          </p>
                          <p className="text-xs text-[color:var(--text-muted)] mt-1 line-clamp-1">
                            {[truck.city, truck.state]
                              .filter(Boolean)
                              .join(", ") || "Location on profile"}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
