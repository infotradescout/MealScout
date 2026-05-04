import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, Loader2, Megaphone, XCircle } from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type OwnerJob = {
  id: string;
  title: string;
  roleType?: string | null;
  employmentType?: string | null;
  compensationLabel?: string | null;
  scheduleDescription?: string | null;
  description?: string | null;
  status: string;
  applicationCount?: number;
};

const roleOptions = [
  ["cook", "Cook"],
  ["prep", "Prep"],
  ["cashier", "Cashier"],
  ["server", "Server"],
  ["manager", "Manager"],
  ["delivery_driver", "Delivery Driver"],
  ["event_staff", "Event Staff"],
  ["dishwasher", "Dishwasher"],
  ["barista", "Barista"],
  ["bartender", "Bartender"],
  ["crew", "Crew"],
  ["other", "Other"],
] as const;

const employmentOptions = [
  ["part_time", "Part time"],
  ["full_time", "Full time"],
  ["seasonal", "Seasonal"],
  ["gig", "Gig"],
  ["contract", "Contract"],
] as const;

const defaultForm = {
  title: "",
  roleType: "other",
  employmentType: "part_time",
  compensationLabel: "",
  scheduleDescription: "",
  description: "",
};

export function HelpWantedQuickAction({
  restaurantId,
  restaurantName,
  compact = false,
}: {
  restaurantId?: string | null;
  restaurantName?: string | null;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);

  const { data, isLoading } = useQuery<{
    activeJob: OwnerJob | null;
    openJobs: OwnerJob[];
    jobs: OwnerJob[];
  }>({
    queryKey: ["/api/owner/jobs", restaurantId],
    enabled: Boolean(restaurantId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/owner/jobs?restaurantId=${encodeURIComponent(String(restaurantId || ""))}`,
        { credentials: "include" },
      );
      if (!res.ok) return { activeJob: null, openJobs: [], jobs: [] };
      return res.json();
    },
  });

  const activeJob = data?.activeJob || null;

  useEffect(() => {
    if (!open || !activeJob) return;
    setForm({
      title: activeJob.title || "",
      roleType: activeJob.roleType || "other",
      employmentType: activeJob.employmentType || "part_time",
      compensationLabel: activeJob.compensationLabel || "",
      scheduleDescription: activeJob.scheduleDescription || "",
      description: activeJob.description || "",
    });
  }, [activeJob, open]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/owner/jobs", restaurantId] }),
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs/restaurant", restaurantId, "open"],
      }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Choose a business first.");
      const title = form.title.trim();
      if (!title) throw new Error("Add the role you are hiring for.");
      const response = await apiRequest("POST", "/api/owner/jobs/help-wanted", {
        restaurantId,
        title,
        roleType: form.roleType,
        employmentType: form.employmentType,
        compensationLabel: form.compensationLabel.trim() || undefined,
        scheduleDescription: form.scheduleDescription.trim() || undefined,
        description: form.description.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: async () => {
      await invalidate();
      setOpen(false);
      setForm(defaultForm);
      toast({
        title: "Help wanted is live",
        description: "Your public profile now links straight to the job post.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update hiring banner",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Choose a business first.");
      const response = await apiRequest(
        "POST",
        "/api/owner/jobs/help-wanted/close",
        { restaurantId },
      );
      return response.json();
    },
    onSuccess: async () => {
      await invalidate();
      toast({
        title: "Help wanted removed",
        description: "The hiring banner is off your public profile.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not remove banner",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!restaurantId) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean",
        compact ? "mb-6" : "",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-black">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-black text-[color:var(--text-primary)]">
                Help wanted banner
              </h3>
              {activeJob ? (
                <Badge className="bg-[color:var(--status-success)] text-white">
                  Live
                </Badge>
              ) : (
                <Badge variant="secondary">Off</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
              {activeJob
                ? `${restaurantName || "Your profile"} is showing "${activeJob.title}".`
                : "Turn on a profile banner that sends applicants to a real job page."}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {activeJob ? (
            <>
              <Link
                href={`/jobs/${encodeURIComponent(activeJob.id)}` as any}
              >
                <Button variant="outline" className="w-full sm:w-auto">
                  <BriefcaseBusiness className="mr-2 h-4 w-4" />
                  View
                </Button>
              </Link>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setOpen(true)}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                disabled={closeMutation.isPending}
                onClick={() => closeMutation.mutate()}
              >
                {closeMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Remove
              </Button>
            </>
          ) : (
            <Button
              className="w-full sm:w-auto"
              disabled={isLoading}
              onClick={() => setOpen(true)}
            >
              <BriefcaseBusiness className="mr-2 h-4 w-4" />
              Add Help Wanted
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {activeJob ? "Update help wanted" : "Add help wanted"}
            </DialogTitle>
            <DialogDescription>
              Applicants get a dedicated page for this role, and your profile
              shows that you are hiring while it is open.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="quick-job-title">Job title</Label>
              <Input
                id="quick-job-title"
                value={form.title}
                placeholder="Line cook, cashier, event staff..."
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select
                  value={form.roleType}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, roleType: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, employmentType: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {employmentOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quick-job-pay">Pay or perk</Label>
              <Input
                id="quick-job-pay"
                value={form.compensationLabel}
                placeholder="$15-$20/hr, tips, paid training..."
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    compensationLabel: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quick-job-schedule">Schedule</Label>
              <Input
                id="quick-job-schedule"
                value={form.scheduleDescription}
                placeholder="Weekends, lunch rush, evenings..."
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    scheduleDescription: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quick-job-description">Notes</Label>
              <Textarea
                id="quick-job-description"
                value={form.description}
                placeholder="What should applicants know before they apply?"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {activeJob ? "Save" : "Turn On"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
