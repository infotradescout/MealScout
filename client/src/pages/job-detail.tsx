import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  MapPin,
  Send,
  Store,
} from "lucide-react";

import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";

type Job = {
  id: string;
  restaurantId?: string | null;
  hostId?: string | null;
  businessEntity?: string | null;
  businessName?: string | null;
  businessProfileUrl?: string | null;
  title: string;
  roleType?: string | null;
  employmentType?: string | null;
  description?: string | null;
  requirements?: string | null;
  scheduleDescription?: string | null;
  compensationLabel?: string | null;
  payMinCents?: number | null;
  payMaxCents?: number | null;
  locationLabel?: string | null;
  city?: string | null;
  state?: string | null;
  positionsAvailable?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
  restaurantName: string;
  restaurantBusinessType?: string | null;
  restaurantLogoUrl?: string | null;
  restaurantCoverImageUrl?: string | null;
  restaurantAddress?: string | null;
  restaurantProfileUrl: string;
  restaurantWebsiteUrl?: string | null;
  publicUrl: string;
};

const labelize = (value?: string | null) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const employmentTypeForSchema = (value?: string | null) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "full_time") return "FULL_TIME";
  if (normalized === "part_time") return "PART_TIME";
  if (normalized === "contract" || normalized === "gig") return "CONTRACTOR";
  if (normalized === "seasonal") return "TEMPORARY";
  return "OTHER";
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const paragraph = (value?: string | null) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<p>${escapeHtml(text).replace(/\n+/g, "<br>")}</p>`;
};

const absoluteUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.mealscout.us${raw.startsWith("/") ? "" : "/"}${raw}`;
};

const externalUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
};

const moneyFromCents = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value) / 100
    : undefined;

const payRangeLabel = (job?: Job | null) => {
  const min = moneyFromCents(job?.payMinCents);
  const max = moneyFromCents(job?.payMaxCents);
  if (min && max && min !== max) return `$${min}-$${max}/hr`;
  if (min) return `$${min}/hr`;
  if (max) return `Up to $${max}/hr`;
  return "";
};

const isoOrUndefined = (value?: string | null) => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : undefined;
};

const buildJobDescriptionHtml = (job: Job, fallback: string) =>
  [
    paragraph(job.description || fallback),
    paragraph(job.requirements ? `Helpful experience: ${job.requirements}` : ""),
    paragraph(
      job.scheduleDescription
        ? `Schedule: ${job.scheduleDescription}`
        : "",
    ),
    paragraph(
      job.compensationLabel || payRangeLabel(job)
        ? `Pay: ${job.compensationLabel || payRangeLabel(job)}`
        : "",
    ),
    paragraph(
      job.positionsAvailable && job.positionsAvailable > 1
        ? `Openings: ${job.positionsAvailable}`
        : "",
    ),
    "<p>Apply directly on this MealScout job page.</p>",
  ]
    .filter(Boolean)
    .join("");

const buildBaseSalary = (job: Job) => {
  const minValue = moneyFromCents(job.payMinCents);
  const maxValue = moneyFromCents(job.payMaxCents);
  if (!minValue && !maxValue) return undefined;
  return {
    "@type": "MonetaryAmount",
    currency: "USD",
    value: {
      "@type": "QuantitativeValue",
      ...(minValue ? { minValue } : {}),
      ...(maxValue ? { maxValue } : {}),
      ...(!maxValue && minValue ? { value: minValue } : {}),
      unitText: "HOUR",
    },
  };
};

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { toast } = useToast();
  const [form, setForm] = useState({
    applicantName: "",
    applicantEmail: "",
    applicantPhone: "",
    resumeUrl: "",
    availability: "",
    experienceSummary: "",
    coverNote: "",
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery<{ job: Job }>({
    queryKey: ["/api/jobs", jobId],
    enabled: Boolean(jobId),
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${encodeURIComponent(String(jobId || ""))}`);
      if (!res.ok) {
        throw new Error("Job post not found");
      }
      return res.json();
    },
  });

  const job = data?.job;
  const displayBusinessName =
    job?.businessName || job?.restaurantName || "MealScout business";
  const displayBusinessProfileUrl =
    job?.businessProfileUrl || job?.restaurantProfileUrl || "/jobs";
  const title = job
    ? `${job.title} at ${displayBusinessName} | MealScout Jobs`
    : "MealScout Jobs";
  const description = job
    ? `Apply for ${job.title} at ${displayBusinessName}${job.city ? ` in ${job.city}${job.state ? `, ${job.state}` : ""}` : ""}. ${job.compensationLabel || payRangeLabel(job) || "Local food and hospitality role."}`
    : "Apply for local food truck, restaurant, bar, and event jobs on MealScout.";

  const structuredData = useMemo(() => {
    if (!job) return undefined;
    const canonicalUrl = `https://www.mealscout.us${job.publicUrl}`;
    const city = job.city || undefined;
    const state = job.state || undefined;
    return {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: job.title,
      description: buildJobDescriptionHtml(job, description),
      identifier: {
        "@type": "PropertyValue",
        name: "MealScout",
        value: job.id,
      },
      datePosted: isoOrUndefined(job.createdAt || job.updatedAt),
      validThrough: isoOrUndefined(job.expiresAt),
      directApply: true,
      hiringOrganization: {
        "@type": "Organization",
        name: displayBusinessName,
        sameAs:
          externalUrl(job.restaurantWebsiteUrl) ||
          `https://www.mealscout.us${displayBusinessProfileUrl}`,
        logo: absoluteUrl(job.restaurantLogoUrl),
      },
      employmentType: employmentTypeForSchema(job.employmentType),
      occupationalCategory: labelize(job.roleType) || "Food service",
      industry: "Food service",
      jobLocation: {
        "@type": "Place",
        name: job.locationLabel || displayBusinessName,
        address: {
          "@type": "PostalAddress",
          streetAddress: job.restaurantAddress || undefined,
          addressLocality: city,
          addressRegion: state,
          addressCountry: "US",
        },
      },
      baseSalary: buildBaseSalary(job),
      url: canonicalUrl,
    };
  }, [description, displayBusinessName, displayBusinessProfileUrl, job]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job");
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (value.trim()) body.append(key, value.trim());
      });
      if (resumeFile) body.append("resume", resumeFile);
      const res = await fetch(
        apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/apply`),
        {
          method: "POST",
          body,
          credentials: "include",
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message || "Application failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "Application sent",
        description: "The business has your information and can follow up.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not send application",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    applyMutation.mutate();
  };

  const visiblePay = job?.compensationLabel || payRangeLabel(job) || "";
  const postedLabel = job?.createdAt
    ? new Date(job.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <Navigation />
        <div className="mx-auto max-w-4xl px-4 py-10">Loading job...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <Navigation />
        <div className="mx-auto max-w-4xl px-4 py-10">
          <Card>
            <CardContent className="p-8 text-center">
              <BriefcaseBusiness className="mx-auto h-12 w-12 text-amber-500" />
              <h1 className="mt-4 text-2xl font-black">Job not found</h1>
              <Link href="/jobs">
                <Button className="mt-4">Browse Jobs</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] pb-24 text-[color:var(--text-primary)]">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={`https://www.mealscout.us${job.publicUrl}`}
        schemaData={structuredData}
      />
      <Navigation />

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_26rem] lg:py-8">
        <section className="space-y-5">
          <Link href="/jobs">
            <Button variant="ghost" className="pl-0">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Jobs
            </Button>
          </Link>

          <Card className="overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardContent className="p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-amber-500 text-black hover:bg-amber-500">
                  Now hiring
                </Badge>
                <Badge variant="secondary">
                  {labelize(job.employmentType) || "Role"}
                </Badge>
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-none tracking-normal sm:text-6xl">
                {job.title}
              </h1>
              <Link href={displayBusinessProfileUrl as any}>
                <a className="mt-4 inline-flex items-center gap-2 text-lg font-black text-amber-600 hover:underline">
                  <Store className="h-5 w-5" />
                  {displayBusinessName}
                </a>
              </Link>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <MapPin className="h-5 w-5 text-amber-500" />
                  <div className="mt-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                    Location
                  </div>
                  <div className="font-black">
                    {[job.city, job.state].filter(Boolean).join(", ") ||
                      job.locationLabel ||
                      "Local role"}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <DollarSign className="h-5 w-5 text-amber-500" />
                  <div className="mt-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                    Pay
                  </div>
                  <div className="font-black">
                    {visiblePay || "Shared by business"}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <div className="mt-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                    Schedule
                  </div>
                  <div className="font-black">
                    {job.scheduleDescription || labelize(job.employmentType) || "Open"}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <BriefcaseBusiness className="h-5 w-5 text-amber-500" />
                  <div className="mt-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                    Posted
                  </div>
                  <div className="font-black">
                    {postedLabel || "Recently"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
            <CardHeader>
              <CardTitle>About the role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-[color:var(--text-secondary)]">
              <p className="whitespace-pre-wrap text-base leading-relaxed">
                {job.description ||
                  "This local business is hiring through MealScout. Apply with your availability and experience so they can follow up quickly."}
              </p>
              {job.requirements ? (
                <div>
                  <h2 className="text-lg font-black text-[color:var(--text-primary)]">
                    What helps
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                    {job.requirements}
                  </p>
                </div>
              ) : null}
              {job.positionsAvailable && job.positionsAvailable > 1 ? (
                <p className="font-semibold">
                  {job.positionsAvailable} openings are available for this role.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-amber-500" />
                Apply
              </CardTitle>
            </CardHeader>
            <CardContent>
              {submitted ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
                  <CheckCircle className="h-8 w-8" />
                  <h2 className="mt-3 text-xl font-black">Sent</h2>
                  <p className="mt-1 text-sm font-semibold">
                    Your application was sent to {displayBusinessName}.
                  </p>
                  <Link href="/jobs">
                    <Button className="mt-4 w-full">Browse More Jobs</Button>
                  </Link>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={onSubmit}>
                  <div className="grid gap-2">
                    <Label htmlFor="applicantName">Name</Label>
                    <Input
                      id="applicantName"
                      value={form.applicantName}
                      required
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          applicantName: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="applicantEmail">Email</Label>
                    <Input
                      id="applicantEmail"
                      type="email"
                      value={form.applicantEmail}
                      required
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          applicantEmail: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="applicantPhone">Phone</Label>
                    <Input
                      id="applicantPhone"
                      value={form.applicantPhone}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          applicantPhone: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="availability">Availability</Label>
                    <Textarea
                      id="availability"
                      value={form.availability}
                      placeholder="Days, times, start date..."
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          availability: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="experienceSummary">Experience</Label>
                    <Textarea
                      id="experienceSummary"
                      value={form.experienceSummary}
                      placeholder="Food service, customer service, driving, events..."
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          experienceSummary: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="resume">Resume</Label>
                    <Input
                      id="resume"
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.rtf"
                      onChange={(event) =>
                        setResumeFile(event.target.files?.[0] || null)
                      }
                    />
                    <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)]">
                      <FileText className="h-3.5 w-3.5" />
                      PDF, DOC, DOCX, TXT, or RTF up to 10 MB
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="resumeUrl">Resume link</Label>
                    <Input
                      id="resumeUrl"
                      value={form.resumeUrl}
                      placeholder="Optional if you uploaded a file"
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          resumeUrl: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="coverNote">Note</Label>
                    <Textarea
                      id="coverNote"
                      value={form.coverNote}
                      placeholder="A quick hello goes a long way."
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          coverNote: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={applyMutation.isPending}
                  >
                    {applyMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send Application
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
