import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/navigation";
import { Calendar, ArrowLeft, Megaphone, ShieldCheck, Sparkles } from "lucide-react";

export default function EventSignup() {
  const { user, isAuthenticated, isLoading, refetch } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEventCoordinator = user?.userType === "event_coordinator";

  const [formData, setFormData] = useState({
    eventName: "",
    date: "",
    city: "",
    expectedCrowd: "",
    contactEmail: user?.email || "",
    contactPhone: "",
    notes: "",
  });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("mealscout:event-signup-draft");
      if (!stored) return;
      const parsed = JSON.parse(stored) as Partial<typeof formData>;
      setFormData((prev) => ({
        ...prev,
        eventName: parsed.eventName || prev.eventName,
        city: parsed.city || prev.city,
        contactEmail: parsed.contactEmail || prev.contactEmail,
        contactPhone: parsed.contactPhone || prev.contactPhone,
      }));
    } catch {
      // Draft restore is best effort only.
    }
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/events/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...formData,
          userId: user?.id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit event request");
      }

      const data = await response.json();
      const isCoordinator = data?.userType === "event_coordinator";
      if (isCoordinator) {
        await refetch();
        toast({
          title: "Request submitted",
          description: "You can now post events from your dashboard.",
        });
        setLocation("/event-coordinator/dashboard");
        return;
      }

      toast({
        title: "Request submitted",
        description: "We will follow up soon.",
      });

      setLocation("/");
    } catch (error) {
      console.error("Event signup error:", error);
      toast({
        title: "Submission failed",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-9rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[color:var(--action-primary)]/15 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-[-7rem] h-[25rem] w-[25rem] rounded-full bg-[color:var(--accent)]/20 blur-3xl" />
      </div>

      <Navigation />

      <div className="relative z-10 container max-w-5xl mx-auto px-4 py-8">
        <a
          href="/events"
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to events
        </a>

        {isLoading ? (
          <div className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/90 p-8 text-center text-[color:var(--text-secondary)]">
            Loading event access...
          </div>
        ) : !isAuthenticated ? (
          <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur p-8 shadow-clean-lg text-center max-w-2xl mx-auto">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/15">
              <Calendar className="h-7 w-7 text-[color:var(--action-primary)]" />
            </span>
            <h1 className="text-3xl font-black tracking-tight text-[color:var(--text-primary)] mb-3">
              Log In to Request Event Access
            </h1>
            <p className="text-[color:var(--text-secondary)] mb-6">
              Submit a request to become an event coordinator and start posting events.
            </p>
            <Button
              className="w-full h-11 rounded-xl action-primary hover:bg-[color:var(--action-hover)]"
              onClick={() => setLocation("/login?redirect=/event-signup")}
            >
              Log in to continue
            </Button>
          </section>
        ) : isEventCoordinator ? (
          <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur p-8 shadow-clean-lg text-center max-w-2xl mx-auto">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/15">
              <ShieldCheck className="h-7 w-7 text-[color:var(--accent-text)]" />
            </span>
            <h1 className="text-3xl font-black tracking-tight text-[color:var(--text-primary)] mb-3">
              You Already Have Coordinator Access
            </h1>
            <p className="text-[color:var(--text-secondary)] mb-6">
              Open your dashboard to create and manage events.
            </p>
            <Button
              className="w-full h-11 rounded-xl action-primary hover:bg-[color:var(--action-hover)]"
              onClick={() => setLocation("/event-coordinator/dashboard")}
            >
              Open dashboard
            </Button>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/90 backdrop-blur p-6 shadow-clean-lg h-fit">
              <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/15">
                <Megaphone className="h-6 w-6 text-[color:var(--action-primary)]" />
              </span>
              <h1 className="text-3xl font-black tracking-tight text-[color:var(--text-primary)] mb-3">
                Request Event Coordinator Access
              </h1>
              <p className="text-sm leading-relaxed text-[color:var(--text-secondary)] mb-5">
                Share your event details and operations context so we can enable posting access on your account.
              </p>
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
                <p className="text-xs font-medium text-[color:var(--text-secondary)]">
                  Organizers stay free. Fees only apply to truck bookings.
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur p-6 shadow-clean-lg">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid gap-2">
                  <Label htmlFor="eventName" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Event Name *</Label>
                  <Input
                    id="eventName"
                    name="eventName"
                    value={formData.eventName}
                    onChange={handleChange}
                    required
                    placeholder="Summer Block Party"
                    className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="date" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Event Date *</Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      value={formData.date}
                      onChange={handleChange}
                      required
                      className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="city" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">City *</Label>
                    <Input
                      id="city"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      required
                      placeholder="San Francisco"
                      className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="expectedCrowd" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Expected Crowd *</Label>
                    <Input
                      id="expectedCrowd"
                      name="expectedCrowd"
                      type="number"
                      value={formData.expectedCrowd}
                      onChange={handleChange}
                      required
                      placeholder="200"
                      className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="contactPhone" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Contact Phone</Label>
                    <Input
                      id="contactPhone"
                      name="contactPhone"
                      type="tel"
                      value={formData.contactPhone}
                      onChange={handleChange}
                      placeholder="(555) 123-4567"
                      className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="contactEmail" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Contact Email *</Label>
                  <Input
                    id="contactEmail"
                    name="contactEmail"
                    type="email"
                    value={formData.contactEmail}
                    onChange={handleChange}
                    required
                    placeholder="you@example.com"
                    className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">Additional Details</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    rows={4}
                    placeholder="Space available, power outlets, vendor constraints, or setup notes..."
                    className="rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                  />
                </div>

                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    - Event organizers are always free
                    <br />
                    - No hidden fees, now or later
                    <br />
                    - Booking fees apply only to trucks
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl action-primary hover:bg-[color:var(--action-hover)] font-semibold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="h-4 w-4 animate-pulse" />
                      Submitting...
                    </span>
                  ) : (
                    "Request Coordinator Access"
                  )}
                </Button>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}



