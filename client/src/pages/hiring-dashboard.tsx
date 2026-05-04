import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle,
  Loader2,
  Mail,
  Phone,
  Plus,
  Users,
} from "lucide-react";
import { Link, useLocation } from "wouter";

import { HelpWantedQuickAction } from "@/components/HelpWantedQuickAction";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Restaurant } from "@shared/schema";

type OwnerJob = {
  id: string;
  title: string;
  roleType?: string | null;
  employmentType?: string | null;
  description?: string | null;
  requirements?: string | null;
  scheduleDescription?: string | null;
  compensationLabel?: string | null;
  locationLabel?: string | null;
  status: string;
  applicationCount?: number;
  createdAt?: string | null;
};

type JobApplication = {
  id: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string | null;
  resumeUrl?: string | null;
  coverNote?: string | null;
  availability?: string | null;
  experienceSummary?: string | null;
  status: string;
  createdAt?: string | null;
};

type HiringBusiness = Pick<
  Restaurant,
  "id" | "name" | "businessType" | "ownerId"
> & {
  entityType?: "restaurant" | "host";
  targetKey?: string;
  cuisineType?: string | null;
  city?: string | null;
  state?: string | null;
  isFoodTruck?: boolean | null;
  isActive?: boolean | null;
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

const applicationStatuses = [
  ["new", "New"],
  ["reviewed", "Reviewed"],
  ["contacted", "Contacted"],
  ["interviewing", "Interviewing"],
  ["hired", "Hired"],
  ["declined", "Declined"],
] as const;

const emptyForm = {
  title: "",
  roleType: "other",
  employmentType: "part_time",
  compensationLabel: "",
  scheduleDescription: "",
  locationLabel: "",
  description: "",
  requirements: "",
  positionsAvailable: "1",
};

const labelize = (value?: string | null) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const businessOptionLabel = (business: HiringBusiness) => {
  const location = [business.city, business.state].filter(Boolean).join(", ");
  return [business.name, location].filter(Boolean).join(" - ");
};

export default function HiringDashboardPage() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const params = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
  const initialRestaurantId = params.get("restaurantId") || "";
  const initialHostId = params.get("hostId") || "";
  const initialBusinessKey = initialHostId
    ? `host:${initialHostId}`
    : initialRestaurantId
      ? `restaurant:${initialRestaurantId}`
      : "";
  const isStaffOrAdmin = ["staff", "admin", "super_admin"].includes(
    String(user?.userType || "").toLowerCase(),
  );
  const [selectedBusinessKey, setSelectedBusinessKey] =
    useState(initialBusinessKey);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [businessSearch, setBusinessSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

  const { data: businessData, isLoading: loadingRestaurants } = useQuery<{
    restaurants: HiringBusiness[];
    hosts?: HiringBusiness[];
    businesses?: HiringBusiness[];
    scope: "all" | "managed";
  }>({
    queryKey: [
      "/api/owner/jobs/businesses",
      isStaffOrAdmin ? "all" : "managed",
      businessSearch,
      initialRestaurantId,
      initialHostId,
    ],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const query = new URLSearchParams({
        limit: isStaffOrAdmin ? "100" : "150",
      });
      if (isStaffOrAdmin && businessSearch.trim()) {
        query.set("q", businessSearch.trim());
      }
      if (initialRestaurantId) {
        query.set("includeRestaurantId", initialRestaurantId);
      }
      if (initialHostId) {
        query.set("includeHostId", initialHostId);
      }
      const res = await fetch(`/api/owner/jobs/businesses?${query}`, {
        credentials: "include",
      });
      if (!res.ok) {
        return { restaurants: [], hosts: [], businesses: [], scope: "managed" as const };
      }
      return res.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const businesses =
    businessData?.businesses ||
    (businessData?.restaurants || []).map((row) => ({
      ...row,
      entityType: "restaurant" as const,
      targetKey: `restaurant:${row.id}`,
    }));

  useEffect(() => {
    if (selectedBusinessKey || businesses.length === 0) return;
    setSelectedBusinessKey(
      businesses[0]?.targetKey ||
        `${businesses[0]?.entityType || "restaurant"}:${businesses[0]?.id || ""}`,
    );
  }, [businesses, selectedBusinessKey]);

  const currentBusiness = businesses.find((business) => {
    const key =
      business.targetKey || `${business.entityType || "restaurant"}:${business.id}`;
    return key === selectedBusinessKey;
  });
  const selectedTargetType = currentBusiness?.entityType || "restaurant";
  const selectedRestaurant =
    selectedTargetType === "restaurant" ? currentBusiness?.id || "" : "";
  const selectedHost =
    selectedTargetType === "host" ? currentBusiness?.id || "" : "";
  const selectedBusinessName = currentBusiness?.name || "Selected business";
  const selectedTargetQuery = selectedHost
    ? `hostId=${encodeURIComponent(selectedHost)}`
    : `restaurantId=${encodeURIComponent(selectedRestaurant)}`;
  const selectedTargetBody = selectedHost
    ? { hostId: selectedHost }
    : { restaurantId: selectedRestaurant };

  const { data: jobsData, isLoading: loadingJobs } = useQuery<{
    jobs: OwnerJob[];
    openJobs: OwnerJob[];
    activeJob: OwnerJob | null;
  }>({
    queryKey: ["/api/owner/jobs", selectedBusinessKey],
    enabled: Boolean(currentBusiness?.id),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/owner/jobs?${selectedTargetQuery}`,
        { credentials: "include" },
      );
      if (!res.ok) return { jobs: [], openJobs: [], activeJob: null };
      return res.json();
    },
  });

  const jobs = jobsData?.jobs || [];
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0] || null,
    [jobs, selectedJobId],
  );

  useEffect(() => {
    if (!selectedJob && selectedJobId) setSelectedJobId("");
  }, [selectedJob, selectedJobId]);

  const { data: applicationsData, isLoading: loadingApplications } = useQuery<{
    applications: JobApplication[];
  }>({
    queryKey: ["/api/owner/jobs/applications", selectedJob?.id],
    enabled: Boolean(selectedJob?.id),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/owner/jobs/${encodeURIComponent(String(selectedJob?.id || ""))}/applications`,
        { credentials: "include" },
      );
      if (!res.ok) return { applications: [] };
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!currentBusiness?.id) throw new Error("Choose a business first.");
      if (!form.title.trim()) throw new Error("Add a job title.");
      const response = await apiRequest("POST", "/api/owner/jobs", {
        ...selectedTargetBody,
        title: form.title.trim(),
        roleType: form.roleType,
        employmentType: form.employmentType,
        compensationLabel: form.compensationLabel.trim() || undefined,
        scheduleDescription: form.scheduleDescription.trim() || undefined,
        locationLabel: form.locationLabel.trim() || undefined,
        description: form.description.trim() || undefined,
        requirements: form.requirements.trim() || undefined,
        positionsAvailable: Number(form.positionsAvailable || 1),
        status: "open",
      });
      return response.json();
    },
    onSuccess: async (payload: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/owner/jobs", selectedBusinessKey],
      });
      setSelectedJobId(payload?.job?.id || "");
      setForm(emptyForm);
      toast({
        title: "Job posted",
        description: "The public job page is live and linked from your profile.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not post job",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ job, status }: { job: OwnerJob; status: string }) => {
      const response = await apiRequest("PATCH", `/api/owner/jobs/${job.id}`, {
        ...job,
        ...selectedTargetBody,
        status,
      });
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["/api/owner/jobs", selectedBusinessKey],
        }),
        queryClient.invalidateQueries({
          queryKey: [`/api/jobs/${selectedTargetType}`, currentBusiness?.id, "open"],
        }),
      ]);
    },
    onError: (error: any) => {
      toast({
        title: "Could not update job",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateApplicationMutation = useMutation({
    mutationFn: async ({
      application,
      status,
    }: {
      application: JobApplication;
      status: string;
    }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/owner/job-applications/${application.id}`,
        { status },
      );
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/owner/jobs/applications", selectedJob?.id],
      });
    },
  });

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] pb-24 text-[color:var(--text-primary)]">
      <SEOHead
        title="Hiring Dashboard | MealScout"
        description="Post jobs, manage help wanted banners, and review applicants for your MealScout business."
        canonicalUrl="https://www.mealscout.us/hiring"
        noIndex
      />
      <Navigation />

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[24rem_1fr] lg:py-8">
        <aside className="space-y-5">
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
            <CardHeader>
              <Badge className="w-fit bg-amber-500 text-black hover:bg-amber-500">
                Hiring
              </Badge>
              <CardTitle className="text-3xl font-black leading-none">
                Build your team
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Business</Label>
                {isStaffOrAdmin ? (
                  <Input
                    value={businessSearch}
                    placeholder="Search any business by name, city, or cuisine"
                    onChange={(event) => setBusinessSearch(event.target.value)}
                  />
                ) : null}
                <Select
                  value={selectedBusinessKey}
                  onValueChange={(value) => {
                    setSelectedBusinessKey(value);
                    setSelectedJobId("");
                  }}
                  disabled={loadingRestaurants || businesses.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose business" />
                  </SelectTrigger>
                  <SelectContent>
                    {businesses.map((business) => {
                      const key =
                        business.targetKey ||
                        `${business.entityType || "restaurant"}:${business.id}`;
                      return (
                        <SelectItem key={key} value={key}>
                          {businessOptionLabel(business)}
                          {business.entityType === "host" ? " · Host" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {isStaffOrAdmin ? (
                  <p className="text-xs font-semibold text-[color:var(--text-secondary)]">
                    Staff can post openings for any active MealScout business.
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <div className="text-2xl font-black">{jobs.length}</div>
                  <div className="text-xs font-semibold text-[color:var(--text-secondary)]">
                    posts
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <div className="text-2xl font-black">
                    {jobsData?.openJobs?.length || 0}
                  </div>
                  <div className="text-xs font-semibold text-[color:var(--text-secondary)]">
                    open
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <div className="text-2xl font-black">
                    {jobs.reduce((sum, job) => sum + (job.applicationCount || 0), 0)}
                  </div>
                  <div className="text-xs font-semibold text-[color:var(--text-secondary)]">
                    applicants
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <HelpWantedQuickAction
            restaurantId={selectedRestaurant}
            hostId={selectedHost}
            businessName={selectedBusinessName}
          />
        </aside>

        <section className="space-y-5">
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-amber-500" />
                Post a role
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="job-title">Job title</Label>
                  <Input
                    id="job-title"
                    value={form.title}
                    placeholder="Line cook, cashier, delivery driver..."
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-pay">Pay or perk</Label>
                  <Input
                    id="job-pay"
                    value={form.compensationLabel}
                    placeholder="$16/hr + tips"
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        compensationLabel: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
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
                <div className="grid gap-2">
                  <Label htmlFor="job-positions">Openings</Label>
                  <Input
                    id="job-positions"
                    type="number"
                    min="1"
                    max="50"
                    value={form.positionsAvailable}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        positionsAvailable: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="job-schedule">Schedule</Label>
                  <Input
                    id="job-schedule"
                    value={form.scheduleDescription}
                    placeholder="Lunch shifts, weekends, event nights..."
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        scheduleDescription: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-location">Location</Label>
                  <Input
                    id="job-location"
                    value={form.locationLabel}
                    placeholder="Pensacola, mobile route, events..."
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        locationLabel: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="job-description">Description</Label>
                <Textarea
                  id="job-description"
                  value={form.description}
                  placeholder="What the role is, who will enjoy it, and how the team works."
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="job-requirements">Helpful experience</Label>
                <Textarea
                  id="job-requirements"
                  value={form.requirements}
                  placeholder="ServSafe, POS, prep, event work, clean driving record..."
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      requirements: event.target.value,
                    }))
                  }
                />
              </div>
              <Button
                className="w-full sm:w-fit"
                disabled={createMutation.isPending || !currentBusiness?.id}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BriefcaseBusiness className="mr-2 h-4 w-4" />
                )}
                Post Job
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
              <CardHeader>
                <CardTitle>Job posts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingJobs ? (
                  <div className="text-sm text-[color:var(--text-secondary)]">
                    Loading posts...
                  </div>
                ) : jobs.length ? (
                  jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        selectedJob?.id === job.id
                          ? "border-amber-500 bg-amber-50/70"
                          : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:border-amber-500/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black">{job.title}</div>
                          <div className="mt-1 text-sm font-semibold text-[color:var(--text-secondary)]">
                            {labelize(job.roleType)} ·{" "}
                            {labelize(job.employmentType)}
                          </div>
                        </div>
                        <Badge
                          variant={job.status === "open" ? "default" : "secondary"}
                        >
                          {job.status}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm font-bold text-[color:var(--text-secondary)]">
                        <span>{job.applicationCount || 0} applicants</span>
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] p-6 text-center text-[color:var(--text-secondary)]">
                    No jobs yet. Post one above or use the quick banner.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-amber-500" />
                    Applicants
                  </CardTitle>
                  {selectedJob ? (
                    <div className="flex gap-2">
                      <Link href={`/jobs/${encodeURIComponent(selectedJob.id)}` as any}>
                        <Button size="sm" variant="outline">
                          Public page
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant={
                          selectedJob.status === "open" ? "destructive" : "default"
                        }
                        onClick={() =>
                          updateJobStatusMutation.mutate({
                            job: selectedJob,
                            status:
                              selectedJob.status === "open" ? "closed" : "open",
                          })
                        }
                      >
                        {selectedJob.status === "open" ? "Close" : "Reopen"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedJob ? (
                  <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] p-6 text-center text-[color:var(--text-secondary)]">
                    Select a job to review applicants.
                  </div>
                ) : loadingApplications ? (
                  <div className="text-sm text-[color:var(--text-secondary)]">
                    Loading applicants...
                  </div>
                ) : applicationsData?.applications?.length ? (
                  applicationsData.applications.map((application) => (
                    <div
                      key={application.id}
                      className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-black">
                              {application.applicantName}
                            </div>
                            {application.status === "hired" ? (
                              <CheckCircle className="h-4 w-4 text-emerald-500" />
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold text-[color:var(--text-secondary)]">
                            <a
                              href={`mailto:${application.applicantEmail}`}
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              <Mail className="h-4 w-4" />
                              {application.applicantEmail}
                            </a>
                            {application.applicantPhone ? (
                              <a
                                href={`tel:${application.applicantPhone}`}
                                className="inline-flex items-center gap-1 hover:underline"
                              >
                                <Phone className="h-4 w-4" />
                                {application.applicantPhone}
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <Select
                          value={application.status}
                          onValueChange={(status) =>
                            updateApplicationMutation.mutate({
                              application,
                              status,
                            })
                          }
                        >
                          <SelectTrigger className="w-full sm:w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {applicationStatuses.map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {application.availability ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-[color:var(--text-secondary)]">
                          <strong>Availability:</strong> {application.availability}
                        </p>
                      ) : null}
                      {application.experienceSummary ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-[color:var(--text-secondary)]">
                          <strong>Experience:</strong>{" "}
                          {application.experienceSummary}
                        </p>
                      ) : null}
                      {application.coverNote ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-[color:var(--text-secondary)]">
                          <strong>Note:</strong> {application.coverNote}
                        </p>
                      ) : null}
                      {application.resumeUrl ? (
                        <a
                          href={application.resumeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-sm font-black text-amber-600 hover:underline"
                        >
                          Open resume
                        </a>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] p-6 text-center text-[color:var(--text-secondary)]">
                    No applicants for this post yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
