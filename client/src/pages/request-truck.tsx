import { useState } from "react";
import { useLocation } from "wouter";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Truck } from "lucide-react";

export default function RequestTruckPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    requesterName: "",
    contactEmail: "",
    contactPhone: "",
    city: "",
    date: "",
    occasion: "",
    guestCount: "",
    details: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/events/private-truck-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Failed to submit request");
      }
      toast({
        title: "Request submitted",
        description: "We received your truck request and will follow up.",
      });
      setLocation("/events");
    } catch (error: any) {
      toast({
        title: "Submission failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">
      <Navigation />
      <div className="container max-w-3xl mx-auto px-4 py-8">
        <a
          href="/events"
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to events
        </a>

        <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 p-6 shadow-clean-lg">
          <div className="mb-6">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/15">
              <Truck className="h-6 w-6 text-[color:var(--action-primary)]" />
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-[color:var(--text-primary)]">
              Request a Food Truck
            </h1>
            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
              Birthdays, private parties, school events, and neighborhood
              gatherings. Public open calls belong in the Events portal.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="requesterName">Your Name *</Label>
                <Input
                  id="requesterName"
                  name="requesterName"
                  value={formData.requesterName}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactEmail">Email *</Label>
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input
                  id="contactPhone"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="city">City *</Label>
                <Input
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="date">Event Date *</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  value={formData.date}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="occasion">Occasion *</Label>
                <Input
                  id="occasion"
                  name="occasion"
                  value={formData.occasion}
                  onChange={handleChange}
                  placeholder="Birthday party"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guestCount">Guest Count *</Label>
                <Input
                  id="guestCount"
                  name="guestCount"
                  value={formData.guestCount}
                  onChange={handleChange}
                  placeholder="60"
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="details">Additional Details</Label>
              <Textarea
                id="details"
                name="details"
                value={formData.details}
                onChange={handleChange}
                rows={4}
                placeholder="Cuisine preferences, budget, timing, and setup notes."
              />
            </div>

            <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Request"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
