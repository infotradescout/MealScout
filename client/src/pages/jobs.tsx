import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  BriefcaseBusiness,
  ChefHat,
  MapPin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";

import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  businessEntity?: string | null;
  businessName?: string | null;
  businessProfileUrl?: string | null;
  hostId?: string | null;
  title: string;
  roleType?: string | null;
  employmentType?: string | null;
  compensationLabel?: string | null;
  scheduleDescription?: string | null;
  locationLabel?: string | null;
  city?: string | null;
  state?: string | null;
  restaurantName: string;
  restaurantBusinessType?: string | null;
  restaurantLogoUrl?: string | null;
  restaurantCoverImageUrl?: string | null;
  publicUrl: string;
  restaurantProfileUrl: string;
  createdAt?: string | null;
};

const roleFilters = [
  ["all", "All"],
  ["cook", "Cooks"],
  ["cashier", "Cashiers"],
  ["delivery_driver", "Drivers"],
  ["event_staff", "Events"],
  ["manager", "Managers"],
  ["other", "Other"],
] as const;

const labelize = (value?: string | null) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function JobsPage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");

  const { data, isLoading } = useQuery<{ jobs: Job[] }>({
    queryKey: ["/api/jobs", { limit: 100 }],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch("/api/jobs?limit=100");
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
  });

  const jobs = data?.jobs || [];
  const filteredJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesRole = role === "all" || job.roleType === role;
      if (!matchesRole) return false;
      if (!needle) return true;
      return [
        job.title,
        job.businessName,
        job.restaurantName,
        job.city,
        job.state,
        job.compensationLabel,
        labelize(job.roleType),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [jobs, query, role]);

  const collectionSchema = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "MealScout Jobs",
      description:
        "Local food and hospitality jobs from trucks, restaurants, bars, events, and host operators.",
      url: "https://www.mealscout.us/jobs",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: filteredJobs.slice(0, 50).map((job, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `https://www.mealscout.us${job.publicUrl}`,
          name: `${job.title} at ${job.businessName || job.restaurantName}`,
        })),
      },
    }),
    [filteredJobs],
  );

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] pb-24 text-[color:var(--text-primary)]">
      <SEOHead
        title="Food Truck, Restaurant and Hospitality Jobs | MealScout"
        description="Find local food truck, restaurant, bar, event staff, cook, cashier, manager, and delivery driver jobs posted by MealScout businesses."
        canonicalUrl="https://www.mealscout.us/jobs"
        schemaData={collectionSchema}
      />
      <Navigation />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:py-8">
        <section className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <Badge className="mb-4 w-fit bg-amber-500 text-black hover:bg-amber-500">
                MealScout Jobs
              </Badge>
              <h1 className="max-w-3xl text-4xl font-black leading-none tracking-normal sm:text-6xl">
                Get on a team that feeds the city.
              </h1>
              <p className="mt-4 max-w-2xl text-base font-semibold text-[color:var(--text-secondary)] sm:text-lg">
                Browse open roles from local trucks, restaurants, bars, and
                event crews, and host locations. Apply once you find a fit.
              </p>
            </div>
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500 text-black">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-black">{jobs.length}</div>
                  <div className="text-sm font-semibold text-[color:var(--text-secondary)]">
                    open roles
                  </div>
                </div>
              </div>
              <Link href="/hiring">
                <Button variant="outline" className="mt-4 w-full justify-between">
                  Hiring for your business?
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search role, business, city, or pay..."
                className="h-11 pl-9"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              {roleFilters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={cn(
                    "h-10 shrink-0 rounded-full border px-4 text-sm font-black transition",
                    role === value
                      ? "border-amber-500 bg-amber-500 text-black"
                      : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--text-secondary)] hover:border-amber-500/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-56 animate-pulse rounded-xl bg-[var(--bg-card)]"
              />
            ))}
          </div>
        ) : filteredJobs.length ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredJobs.map((job) => {
              const imageUrl =
                job.restaurantCoverImageUrl || job.restaurantLogoUrl || "";
              const businessTypeLabel =
                labelize(job.restaurantBusinessType || job.businessEntity) ||
                "Local business";
              const businessName = job.businessName || job.restaurantName;
              return (
                <Link key={job.id} href={job.publicUrl as any}>
                  <Card className="group h-full cursor-pointer overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition hover:-translate-y-0.5 hover:border-amber-500/60 hover:shadow-clean-lg">
                    <CardContent className="flex h-full flex-col gap-4 p-0">
                      <div className="relative h-36 overflow-hidden bg-[var(--bg-surface)]">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={`${businessName} hiring`}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(245,158,11,0.28),transparent_35%),linear-gradient(135deg,rgba(245,158,11,0.18),rgba(15,23,42,0.18))]">
                            {job.roleType === "cook" ||
                            job.roleType === "prep" ? (
                              <ChefHat className="h-12 w-12 text-amber-500" />
                            ) : job.roleType === "manager" ? (
                              <Users className="h-12 w-12 text-amber-500" />
                            ) : (
                              <BriefcaseBusiness className="h-12 w-12 text-amber-500" />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-white">
                              {businessName}
                            </div>
                            <div className="truncate text-xs font-semibold text-white/80">
                              {businessTypeLabel}
                            </div>
                          </div>
                          <Badge className="shrink-0 bg-amber-500 text-black hover:bg-amber-500">
                            Hiring
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-4 p-5 pt-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-black">
                            {job.roleType === "cook" ||
                            job.roleType === "prep" ? (
                              <ChefHat className="h-6 w-6" />
                            ) : job.roleType === "manager" ? (
                              <Users className="h-6 w-6" />
                            ) : (
                              <BriefcaseBusiness className="h-6 w-6" />
                            )}
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {labelize(job.employmentType) || "Role"}
                          </Badge>
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-xl font-black leading-tight">
                            {job.title}
                          </h2>
                          <p className="mt-1 line-clamp-2 font-semibold text-[color:var(--text-secondary)]">
                            {businessName}
                          </p>
                        </div>
                        <div className="mt-auto space-y-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-amber-500" />
                            {[job.city, job.state].filter(Boolean).join(", ") ||
                              job.locationLabel ||
                              "Local role"}
                          </div>
                          {job.compensationLabel ? (
                            <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-[color:var(--text-primary)]">
                              {job.compensationLabel}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] pt-3 text-sm font-black text-amber-600">
                          Apply now
                          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </section>
        ) : (
          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
            <CardContent className="p-8 text-center">
              <BriefcaseBusiness className="mx-auto h-12 w-12 text-amber-500" />
              <h2 className="mt-4 text-2xl font-black">No matches yet</h2>
              <p className="mt-2 text-[color:var(--text-secondary)]">
                Try another role or search term. New local postings can show up
                any time.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
