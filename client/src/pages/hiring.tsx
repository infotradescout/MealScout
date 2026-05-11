import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useLocation } from "wouter";
import {
  BriefcaseBusiness,
  ChefHat,
  CheckCircle,
  DollarSign,
  FileText,
  Send,
  Users,
  XCircle,
} from "lucide-react";

import { BackHeader } from "@/components/back-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Restaurant = {
  id: string;
  name: string;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
};

type JobRow = {
  job: {
    id: string;
    title: string;
    role: string;
    jobType?: string | null;
    city?: string | null;
    state?: string | null;
    description?: string | null;
    scheduleDescription?: string | null;
    status?: string | null;
    rateMinCents?: number | null;
    rateMaxCents?: number | null;
    positionsAvailable?: number | null;
  };
  restaurant: Restaurant;
};

type ResumeRow = {
  profile: {
    id: string;
    displayName: string;
    headline?: string | null;
    bio?: string | null;
    roles?: string[] | null;
    serviceCities?: string[] | null;
    desiredRateCents?: number | null;
    email?: string | null;
    phone?: string | null;
    portfolioUrl?: string | null;
  };
};

type Chef = {
  id: string;
  name: string;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  isVerified?: boolean | null;
};

type BusinessApplicationRow = {
  application: {
    id: string;
    status: string;
    coverNote?: string | null;
    proposedRateCents?: number | null;
    createdAt?: string | null;
  };
  job: {
    id: string;
    title: string;
    role: string;
  };
  profile: ResumeRow["profile"];
  restaurant: Restaurant;
};

type ChefLeadRow = {
  lead: {
    id: string;
    status: string;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    eventDate?: string | null;
    city?: string | null;
    state?: string | null;
    guestCount?: number | null;
    budgetCents?: number | null;
    occasion?: string | null;
    dietaryNeeds?: string | null;
    notes?: string | null;
  };
  chef: {
    id: string;
    name: string;
  };
};

type SubscriptionStatus = {
  status: string;
  hasAccess?: boolean;
  trialAccess?: boolean;
};

const formatMoney = (cents?: number | null) => {
  if (!cents) return "Open";
  return `$${(cents / 100).toFixed(0)}`;
};

const rateRange = (min?: number | null, max?: number | null) => {
  if (min && max) return `${formatMoney(min)}-${formatMoney(max)}/hr`;
  if (min) return `${formatMoney(min)}+/hr`;
  if (max) return `Up to ${formatMoney(max)}/hr`;
  return "Rate open";
};

const toMoney = (value: FormDataEntryValue | null) => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : undefined;
};

const csv = (value: FormDataEntryValue | null) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export default function HiringPage() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const tabParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tab")
      : null;
  const initialTab =
    tabParam === "owner"
      ? "owner"
      : location.startsWith("/private-chefs")
        ? "chefs"
        : location.startsWith("/jobs")
          ? "jobs"
          : "jobs";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [cityFilter, setCityFilter] = useState("");
  const [selectedChefId, setSelectedChefId] = useState("");

  const querySuffix = cityFilter.trim()
    ? `?city=${encodeURIComponent(cityFilter.trim())}`
    : "";

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobRow[]>({
    queryKey: [`/api/hiring/jobs${querySuffix}`],
  });

  const { data: resumes = [] } = useQuery<ResumeRow[]>({
    queryKey: [`/api/hiring/resumes${querySuffix}`],
  });

  const { data: chefs = [] } = useQuery<Chef[]>({
    queryKey: [`/api/private-chefs${querySuffix}`],
  });

  const { data: restaurants = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: isAuthenticated,
  });

  const { data: subscriptionStatus } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: isAuthenticated,
    retry: false,
  });

  const { data: businessJobs = [] } = useQuery<JobRow[]>({
    queryKey: ["/api/hiring/business/jobs"],
    enabled: isAuthenticated,
  });

  const { data: businessApplications = [] } = useQuery<BusinessApplicationRow[]>({
    queryKey: ["/api/hiring/business/applications"],
    enabled: isAuthenticated,
  });

  const { data: chefLeads = [] } = useQuery<ChefLeadRow[]>({
    queryKey: ["/api/private-chefs/leads/mine"],
    enabled: isAuthenticated,
  });

  const ownedBusinesses = useMemo(
    () =>
      restaurants.filter((restaurant) =>
        ["restaurant", "bar", "food_truck", "caterer", "private_chef"].includes(
          String(restaurant.businessType || "restaurant"),
        ),
      ),
    [restaurants],
  );
  const ownsPrivateChef = ownedBusinesses.some(
    (restaurant) => restaurant.businessType === "private_chef",
  );
  const hasMarketplaceAccess = Boolean(subscriptionStatus?.hasAccess);

  const saveResume = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const body = {
        displayName: String(data.get("displayName") || "").trim(),
        headline: String(data.get("headline") || "").trim(),
        bio: String(data.get("bio") || "").trim(),
        roles: csv(data.get("roles")),
        serviceCities: csv(data.get("serviceCities")),
        desiredRateCents: toMoney(data.get("desiredRate")),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        portfolioUrl: String(data.get("portfolioUrl") || "").trim(),
        isOpenToWork: true,
        isPublic: true,
      };
      return apiRequest("POST", "/api/hiring/me/worker-profile", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/resumes"] });
      toast({ title: "Open resume posted" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not save resume", description: error.message }),
  });

  const postJob = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const body = {
        restaurantId: String(data.get("restaurantId") || ""),
        title: String(data.get("title") || "").trim(),
        role: String(data.get("role") || "").trim(),
        jobType: String(data.get("jobType") || "part_time"),
        city: String(data.get("city") || "").trim(),
        state: String(data.get("state") || "").trim(),
        scheduleDescription: String(data.get("scheduleDescription") || "").trim(),
        description: String(data.get("description") || "").trim(),
        rateMinCents: toMoney(data.get("rateMin")),
        rateMaxCents: toMoney(data.get("rateMax")),
        positionsAvailable: Number(data.get("positionsAvailable") || 1),
      };
      return apiRequest("POST", "/api/hiring/jobs", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
      toast({ title: "Job posted" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not post job", description: error.message }),
  });

  const applyToJob = useMutation({
    mutationFn: async (jobId: string) =>
      apiRequest("POST", `/api/hiring/jobs/${jobId}/apply`, {
        coverNote: "Interested. My open resume is posted.",
      }),
    onSuccess: () => toast({ title: "Application sent" }),
    onError: (error: Error) =>
      toast({ title: "Could not apply", description: error.message }),
  });

  const requestChef = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const chefId = String(data.get("chefId") || selectedChefId);
      const body = {
        customerName: String(data.get("customerName") || "").trim(),
        customerEmail: String(data.get("customerEmail") || "").trim(),
        customerPhone: String(data.get("customerPhone") || "").trim(),
        eventDate: String(data.get("eventDate") || ""),
        city: String(data.get("city") || "").trim(),
        state: String(data.get("state") || "").trim(),
        guestCount: Number(data.get("guestCount") || 0) || undefined,
        budgetCents: toMoney(data.get("budget")),
        occasion: String(data.get("occasion") || "").trim(),
        dietaryNeeds: String(data.get("dietaryNeeds") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
      };
      return apiRequest("POST", `/api/private-chefs/${chefId}/leads`, body);
    },
    onSuccess: () => toast({ title: "Chef request sent" }),
    onError: (error: Error) =>
      toast({ title: "Could not send request", description: error.message }),
  });

  const updateApplication = useMutation({
    mutationFn: async ({
      applicationId,
      status,
    }: {
      applicationId: string;
      status: string;
    }) =>
      apiRequest("PATCH", `/api/hiring/applications/${applicationId}`, {
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/hiring/business/applications"],
      });
      toast({ title: "Application updated" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update application", description: error.message }),
  });

  const updateLead = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: string }) =>
      apiRequest("PATCH", `/api/private-chefs/leads/${leadId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/private-chefs/leads/mine"] });
      toast({ title: "Lead updated" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update lead", description: error.message }),
  });

  const updateJob = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) =>
      apiRequest("PATCH", `/api/hiring/jobs/${jobId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/business/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
      toast({ title: "Job updated" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update job", description: error.message }),
  });

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] pb-24">
      <BackHeader
        title="Hiring"
        subtitle="Jobs, open resumes, and private chef requests"
        fallbackHref="/scout"
        icon={BriefcaseBusiness}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Food work marketplace
            </h1>
            <p className="text-sm text-muted-foreground">
              A-B flow: post work, post an open resume, or request a private chef.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <Label htmlFor="cityFilter">Local area</Label>
            <Input
              id="cityFilter"
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              placeholder="Pensacola"
            />
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList>
            <TabsTrigger value="jobs">
              <BriefcaseBusiness className="h-4 w-4" />
              Jobs
            </TabsTrigger>
            <TabsTrigger value="resumes">
              <FileText className="h-4 w-4" />
              Open resumes
            </TabsTrigger>
            <TabsTrigger value="chefs">
              <ChefHat className="h-4 w-4" />
              Private chefs
            </TabsTrigger>
            <TabsTrigger value="owner">
              <Users className="h-4 w-4" />
              Owner
            </TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              {jobsLoading ? (
                <Card>
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    Loading jobs...
                  </CardContent>
                </Card>
              ) : jobs.length ? (
                jobs.map(({ job, restaurant }) => (
                  <Card key={job.id}>
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <CardTitle className="text-lg">{job.title}</CardTitle>
                          <CardDescription>
                            {restaurant.name}
                            {job.city ? ` · ${job.city}, ${job.state || ""}` : ""}
                          </CardDescription>
                        </div>
                        <Badge variant="secondary">{rateRange(job.rateMinCents, job.rateMaxCents)}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">{job.role}</Badge>
                        <Badge variant="outline">{job.jobType || "part_time"}</Badge>
                        <Badge variant="outline">
                          {job.positionsAvailable || 1} open
                        </Badge>
                      </div>
                      {job.scheduleDescription && (
                        <p className="text-sm text-muted-foreground">
                          {job.scheduleDescription}
                        </p>
                      )}
                      {job.description && (
                        <p className="text-sm text-foreground">{job.description}</p>
                      )}
                      <Button
                        size="sm"
                        disabled={!isAuthenticated || applyToJob.isPending}
                        onClick={() => applyToJob.mutate(job.id)}
                      >
                        <Send className="h-4 w-4" />
                        Apply
                      </Button>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    No jobs here right now. Workers can still post open resumes.
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Post a job</CardTitle>
                <CardDescription>For trucks, restaurants, bars, caterers, and chefs.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(event) => postJob.mutate(event)}>
                  <select
                    name="restaurantId"
                    className="h-11 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
                    required
                    disabled={!ownedBusinesses.length}
                  >
                    <option value="">Business</option>
                    {ownedBusinesses.map((restaurant) => (
                      <option key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </option>
                    ))}
                  </select>
                  <Input name="title" placeholder="Line cook for Friday nights" required />
                  <Input name="role" placeholder="cook, cashier, server, prep" required />
                  <Input name="jobType" placeholder="part_time, event, seasonal" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="city" placeholder="City" />
                    <Input name="state" placeholder="State" />
                  </div>
                  <Input name="scheduleDescription" placeholder="Fri-Sat 4pm-10pm" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="rateMin" placeholder="Min $/hr" inputMode="decimal" />
                    <Input name="rateMax" placeholder="Max $/hr" inputMode="decimal" />
                  </div>
                  <Input
                    name="positionsAvailable"
                    type="number"
                    min="1"
                    defaultValue="1"
                    placeholder="Open spots"
                  />
                  <Textarea name="description" placeholder="What they will actually do." />
                  <Button className="w-full" disabled={!isAuthenticated || postJob.isPending}>
                    <BriefcaseBusiness className="h-4 w-4" />
                    Post
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="resumes" className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Open resume</CardTitle>
                <CardDescription>Use this when no matching job is posted yet.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(event) => saveResume.mutate(event)}>
                  <Input name="displayName" placeholder="Name" required />
                  <Input name="headline" placeholder="Prep cook, truck help, cashier" />
                  <Input name="roles" placeholder="cook, prep, server" />
                  <Input name="serviceCities" placeholder="Pensacola, Gulf Breeze" />
                  <Input name="desiredRate" placeholder="Desired $/hr" inputMode="decimal" />
                  <Input name="email" placeholder="Email" type="email" />
                  <Input name="phone" placeholder="Phone" />
                  <Input name="portfolioUrl" placeholder="Resume or portfolio link" />
                  <Textarea name="bio" placeholder="Short work history and availability." />
                  <Button className="w-full" disabled={!isAuthenticated || saveResume.isPending}>
                    <FileText className="h-4 w-4" />
                    Post open resume
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              {resumes.length ? (
                resumes.map(({ profile }) => (
                  <Card key={profile.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{profile.displayName}</CardTitle>
                      <CardDescription>{profile.headline || "Open to work"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {(profile.roles || []).slice(0, 4).map((role) => (
                          <Badge key={role} variant="outline">
                            {role}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {(profile.serviceCities || []).join(", ") || "Local area open"}
                      </p>
                      {profile.bio && <p className="text-sm">{profile.bio}</p>}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <DollarSign className="h-4 w-4" />
                        {profile.desiredRateCents
                          ? `${formatMoney(profile.desiredRateCents)}/hr`
                          : "Rate open"}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    No open resumes yet.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="chefs" className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="grid gap-3 md:grid-cols-2">
              {chefs.length ? (
                chefs.map((chef) => (
                  <Card key={chef.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{chef.name}</CardTitle>
                          <CardDescription>
                            {chef.city}
                            {chef.state ? `, ${chef.state}` : ""}
                          </CardDescription>
                        </div>
                        {chef.isVerified && <Badge>Verified</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {chef.description && (
                        <p className="line-clamp-4 text-sm text-muted-foreground">
                          {chef.description}
                        </p>
                      )}
                      <Button size="sm" onClick={() => setSelectedChefId(chef.id)}>
                        <ChefHat className="h-4 w-4" />
                        Request
                      </Button>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    No private chefs listed here yet.
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Private chef request</CardTitle>
                <CardDescription>
                  Chefs pay MealScout $25/month. No giant commission.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(event) => requestChef.mutate(event)}>
                  <select
                    name="chefId"
                    value={selectedChefId}
                    onChange={(event) => setSelectedChefId(event.target.value)}
                    className="h-11 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
                    required
                  >
                    <option value="">Chef</option>
                    {chefs.map((chef) => (
                      <option key={chef.id} value={chef.id}>
                        {chef.name}
                      </option>
                    ))}
                  </select>
                  <Input name="customerName" placeholder="Your name" required />
                  <Input name="customerEmail" placeholder="Email" type="email" />
                  <Input name="customerPhone" placeholder="Phone" />
                  <p className="text-xs text-muted-foreground">
                    Email or phone is required.
                  </p>
                  <Input name="eventDate" type="datetime-local" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="city" placeholder="City" />
                    <Input name="state" placeholder="State" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="guestCount" type="number" min="1" placeholder="Guests" />
                    <Input name="budget" inputMode="decimal" placeholder="Budget $" />
                  </div>
                  <Input name="occasion" placeholder="Dinner, birthday, Airbnb stay" />
                  <Textarea name="dietaryNeeds" placeholder="Dietary needs" />
                  <Textarea name="notes" placeholder="What you want cooked." />
                  <Button className="w-full" disabled={requestChef.isPending}>
                    <Users className="h-4 w-4" />
                    Send request
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="owner" className="space-y-5">
            {ownsPrivateChef && !hasMarketplaceAccess ? (
              <Card className="border-amber-300 bg-amber-50">
                <CardHeader>
                  <CardTitle className="text-lg text-amber-950">
                    Private chef marketplace is $25/month
                  </CardTitle>
                  <CardDescription className="text-amber-900">
                    Subscribe to appear in private chef search and receive new
                    MealScout chef requests.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <Link href="/subscribe?next=/hiring&reason=private_chef_marketplace">
                      <DollarSign className="h-4 w-4" />
                      Activate marketplace
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Jobs posted</CardDescription>
                  <CardTitle className="text-3xl">{businessJobs.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Applicants</CardDescription>
                  <CardTitle className="text-3xl">
                    {businessApplications.length}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Chef leads</CardDescription>
                  <CardTitle className="text-3xl">{chefLeads.length}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your jobs</CardTitle>
                  <CardDescription>Close jobs when the spot is filled.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {businessJobs.length ? (
                    businessJobs.map(({ job, restaurant }) => (
                      <div key={job.id} className="rounded-md border border-border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{job.title}</h3>
                              <Badge variant="outline">{job.status}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {restaurant.name} · {job.role} ·{" "}
                              {rateRange(job.rateMinCents, job.rateMaxCents)}
                            </p>
                          </div>
                          <select
                            value={job.status || "open"}
                            disabled={updateJob.isPending}
                            onChange={(event) =>
                              updateJob.mutate({
                                jobId: job.id,
                                status: event.target.value,
                              })
                            }
                            className="h-10 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
                          >
                            <option value="open">Open</option>
                            <option value="paused">Paused</option>
                            <option value="filled">Filled</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                        {job.scheduleDescription && (
                          <p className="mt-3 text-sm text-muted-foreground">
                            {job.scheduleDescription}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No jobs posted yet.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Applicants</CardTitle>
                  <CardDescription>Fast yes/no. Keep it moving.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {businessApplications.length ? (
                    businessApplications.map((row) => (
                      <div
                        key={row.application.id}
                        className="rounded-md border border-border p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">
                                {row.profile.displayName}
                              </h3>
                              <Badge variant="outline">
                                {row.application.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {row.job.title} · {row.restaurant.name}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateApplication.isPending}
                              onClick={() =>
                                updateApplication.mutate({
                                  applicationId: row.application.id,
                                  status: "accepted",
                                })
                              }
                            >
                              <CheckCircle className="h-4 w-4" />
                              Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={updateApplication.isPending}
                              onClick={() =>
                                updateApplication.mutate({
                                  applicationId: row.application.id,
                                  status: "rejected",
                                })
                              }
                            >
                              <XCircle className="h-4 w-4" />
                              No
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(row.profile.roles || []).slice(0, 4).map((role) => (
                            <Badge key={role} variant="secondary">
                              {role}
                            </Badge>
                          ))}
                        </div>
                        {row.profile.bio && (
                          <p className="mt-3 text-sm">{row.profile.bio}</p>
                        )}
                        <div className="mt-3 text-sm text-muted-foreground">
                          {row.profile.email || "No email"} ·{" "}
                          {row.profile.phone || "No phone"} ·{" "}
                          {row.profile.desiredRateCents
                            ? `${formatMoney(row.profile.desiredRateCents)}/hr`
                            : "Rate open"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No applications yet.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Private chef leads</CardTitle>
                  <CardDescription>
                    $25/month business model, leads stay direct.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {chefLeads.length ? (
                    chefLeads.map(({ lead, chef }) => (
                      <div key={lead.id} className="rounded-md border border-border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{lead.customerName}</h3>
                              <Badge variant="outline">{lead.status}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {chef.name}
                              {lead.city ? ` · ${lead.city}, ${lead.state || ""}` : ""}
                            </p>
                          </div>
                          <select
                            value={lead.status}
                            disabled={updateLead.isPending}
                            onChange={(event) =>
                              updateLead.mutate({
                                leadId: lead.id,
                                status: event.target.value,
                              })
                            }
                            className="h-10 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
                          >
                            <option value="new">New</option>
                            <option value="contacted">Contacted</option>
                            <option value="booked">Booked</option>
                            <option value="declined">Declined</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                        <div className="mt-3 text-sm text-muted-foreground">
                          {lead.customerEmail || "No email"} ·{" "}
                          {lead.customerPhone || "No phone"} ·{" "}
                          {lead.guestCount ? `${lead.guestCount} guests` : "Guests open"} ·{" "}
                          {lead.budgetCents ? formatMoney(lead.budgetCents) : "Budget open"}
                        </div>
                        {lead.occasion && (
                          <p className="mt-3 text-sm font-medium">{lead.occasion}</p>
                        )}
                        {lead.notes && <p className="mt-2 text-sm">{lead.notes}</p>}
                        {lead.dietaryNeeds && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Dietary: {lead.dietaryNeeds}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No private chef leads yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
