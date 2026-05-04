import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, BriefcaseBusiness, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PublicJob = {
  id: string;
  title: string;
  roleType?: string | null;
  employmentType?: string | null;
  compensationLabel?: string | null;
  locationLabel?: string | null;
  publicUrl: string;
};

const roleLabel = (value?: string | null) =>
  String(value || "role")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function PublicHelpWantedBanner({
  restaurantId,
  className,
  variant = "light",
}: {
  restaurantId?: string | null;
  className?: string;
  variant?: "light" | "dark";
}) {
  const { data } = useQuery<{
    activeJob: PublicJob | null;
    openCount: number;
  }>({
    queryKey: ["/api/jobs/restaurant", restaurantId, "open"],
    enabled: Boolean(restaurantId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/jobs/restaurant/${encodeURIComponent(String(restaurantId || ""))}/open`,
      );
      if (!res.ok) return { activeJob: null, openCount: 0 };
      return res.json();
    },
  });

  const job = data?.activeJob;
  if (!job) return null;

  const isDark = variant === "dark";

  return (
    <Link href={job.publicUrl as any}>
      <a
        className={cn(
          "group block rounded-2xl border p-4 shadow-clean transition hover:-translate-y-0.5 hover:shadow-clean-lg",
          isDark
            ? "border-amber-300/35 bg-amber-500/12 text-white"
            : "border-amber-300 bg-amber-50 text-amber-950",
          className,
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                isDark ? "bg-amber-400 text-black" : "bg-amber-500 text-black",
              )}
            >
              <BriefcaseBusiness className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn(
                    "w-fit",
                    isDark
                      ? "bg-white/10 text-amber-100 hover:bg-white/10"
                      : "bg-white text-amber-950 hover:bg-white",
                  )}
                >
                  Help wanted
                </Badge>
                {data?.openCount && data.openCount > 1 ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-bold",
                      isDark ? "text-amber-100/80" : "text-amber-900/70",
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {data.openCount} open roles
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-lg font-black leading-tight">
                Now hiring: {job.title}
              </div>
              <div
                className={cn(
                  "mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold",
                  isDark ? "text-white/75" : "text-amber-950/75",
                )}
              >
                <span>{roleLabel(job.roleType)}</span>
                {job.compensationLabel ? (
                  <span>{job.compensationLabel}</span>
                ) : null}
                {job.locationLabel ? <span>{job.locationLabel}</span> : null}
              </div>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-2 text-sm font-black",
              isDark ? "text-amber-200" : "text-amber-900",
            )}
          >
            Apply
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </span>
        </div>
      </a>
    </Link>
  );
}
