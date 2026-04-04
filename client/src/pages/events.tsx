import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, MapPin, Users, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function EventsPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEventCoordinator = isAuthenticated && user?.userType === "event_coordinator";
  const [showCreateForm, setShowCreateForm] = useState(false);
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
  });

  const { data: events = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/events/upcoming"],
  });

  const createEvent = useMutation({
    mutationFn: async () => {
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
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create event");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/events/upcoming"] });
      setShowCreateForm(false);
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
      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
            <Calendar className="w-10 h-10 text-[color:var(--accent-text)]" />
            Find Food Trucks at Events
          </h1>
          <div className="bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-lg p-4">
            <p className="text-base text-[color:var(--text-secondary)] mb-2">
              <strong>What are these events?</strong>
            </p>
            <p className="text-sm text-[color:var(--text-secondary)] mb-1">
              These are high-volume events (festivals, markets, corporate
              gatherings) coordinated by event organizers to help you find food
              trucks.
            </p>
          </div>

          {isEventCoordinator && (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Event Coordinator</CardTitle>
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
                        <Label htmlFor="organizationName">Organization Name</Label>
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
                            setFormData((prev) => ({ ...prev, address: e.target.value }))
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
                            setFormData((prev) => ({ ...prev, city: e.target.value }))
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
                            setFormData((prev) => ({ ...prev, state: e.target.value }))
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
                            setFormData((prev) => ({ ...prev, eventName: e.target.value }))
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
                              maxTrucks: Math.max(1, Number(e.target.value || 1)),
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="date">Date</Label>
                        <Input
                          id="date"
                          type="date"
                          required
                          value={formData.date}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, date: e.target.value }))
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
                            setFormData((prev) => ({ ...prev, startTime: e.target.value }))
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
                            setFormData((prev) => ({ ...prev, endTime: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, description: e.target.value }))
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

        {/* Events Grid */}
        {events.length === 0 ? (
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 text-[color:var(--text-muted)] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-[color:var(--text-secondary)] mb-2">
                No Upcoming Events
              </h3>
              <p className="text-[color:var(--text-muted)] mb-3">
                No high-volume events are currently listed.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((event) => (
              <Card
                key={event.id}
                className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow cursor-pointer"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg line-clamp-2">
                      {event.name || "Food Truck Event"}
                    </CardTitle>
                    {event.status === "published" && (
                      <Badge variant="default">Open</Badge>
                    )}
                    {event.status === "draft" && (
                      <Badge variant="outline">Draft</Badge>
                    )}
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
                        ${(Number(event.hostPriceCents) / 100).toFixed(2)} host fee + $10 platform fee
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}




