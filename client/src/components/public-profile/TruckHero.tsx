import type { PublicCta, PublicRestaurantProfile, PublicTruckScheduleStop } from "@shared/publicProfiles";
import { assessPublicMenuCompleteness, normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, Clock3, MapPin, Route, Truck } from "lucide-react";

type TruckHeroProps = {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
};

const stopLabel = (stop: PublicTruckScheduleStop | null | undefined) =>
  String(stop?.locationName || stop?.addressPublicLabel || "").trim();

const stopTimeLabel = (stop: PublicTruckScheduleStop | null | undefined) =>
  [stop?.date, stop?.timeWindowLabel].filter(Boolean).join(" · ");

const firstAvailableStop = (profile: PublicRestaurantProfile) => {
  const schedule = profile.truckSchedule;
  if (!schedule) return { label: "No upcoming stops listed", stop: null, kind: "empty" as const };
  if (schedule.currentStop) return { label: "Here now", stop: schedule.currentStop, kind: "current" as const };
  if (schedule.todayStop) return { label: "Today", stop: schedule.todayStop, kind: "today" as const };
  if (schedule.nextStop) return { label: "Next stop", stop: schedule.nextStop, kind: "next" as const };
  if (Array.isArray(schedule.upcomingStops) && schedule.upcomingStops[0]) {
    return { label: "Upcoming schedule", stop: schedule.upcomingStops[0], kind: "upcoming" as const };
  }
  if (String(schedule.statusLabel || "").trim() || String(schedule.nextWindowLabel || "").trim()) {
    return { label: "Schedule posted", stop: null, kind: "summary" as const };
  }
  return { label: "No upcoming stops listed", stop: null, kind: "empty" as const };
};

const truckHeroImage = (profile: PublicRestaurantProfile) =>
  profile.coverImageUrl ||
  profile.logoUrl ||
  (profile as any).profileImageUrl ||
  (profile as any).truckPhotoLogo ||
  (profile as any).imageUrl ||
  null;

const initialsFor = (name: string) =>
  String(name || "MS")
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

const menuTrustLabel = (profile: PublicRestaurantProfile) => {
  const menuCompleteness = assessPublicMenuCompleteness({
    menuSections: profile.menuSections,
    featuredMenuItems: profile.featuredMenuItems,
    menuUrl: profile.menuUrl,
    menuImageUrl: profile.menuImageUrl,
    menuPdfUrl: profile.menuPdfUrl,
  });
  if (menuCompleteness.state === "complete") return "Menu available";
  if (menuCompleteness.state === "partial") return "Menu partial";
  return null;
};

export function TruckHero({ profile, safeCtas }: TruckHeroProps) {
  const schedule = profile.truckSchedule;
  const heroImage = truckHeroImage(profile);
  const primaryStop = firstAvailableStop(profile);
  const primaryStopName = stopLabel(primaryStop.stop);
  const primaryStopTime =
    stopTimeLabel(primaryStop.stop) ||
    String(schedule?.nextWindowLabel || "").trim() ||
    String(schedule?.statusLabel || "").trim();
  const directionsHref = primaryStop.stop?.directionsUrl || null;
  const menuLabel = menuTrustLabel(profile);
  const serviceLabel = normalizeBusinessTypeLabel(profile.serviceType || "") || "Food Truck";
  const foodSummary = [...(profile.cuisineTags || []).slice(0, 2), serviceLabel]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
  const hasSchedule =
    primaryStop.kind !== "empty" ||
    Boolean(String(schedule?.statusLabel || "").trim()) ||
    Boolean(String(schedule?.nextWindowLabel || "").trim()) ||
    Number(schedule?.upcomingCount || 0) > 0;
  const scheduleLabel = hasSchedule ? "Schedule available" : "No upcoming stops listed";
  const websiteCta = safeCtas.find((cta) => cta.type === "external" || cta.type === "social");

  return (
    <section
      data-testid="truck-profile-hero"
      className="overflow-hidden rounded-2xl border border-orange-300/20 bg-[#0f0d0b] shadow-[0_20px_80px_rgba(0,0,0,0.28)]"
    >
      <div className="grid gap-0 md:grid-cols-[0.92fr_1.08fr]">
        <div className="relative min-h-[15rem] overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(251,146,60,0.36),transparent_34%),linear-gradient(145deg,#24130b_0%,#110d0a_52%,#060504_100%)]">
          {heroImage ? (
            <div
              data-testid="truck-profile-hero-image"
              className="absolute inset-0 bg-cover bg-center opacity-80"
              style={{
                backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.68)),url('${heroImage}')`,
              }}
            />
          ) : (
            <div
              data-testid="truck-profile-hero-fallback"
              className="absolute inset-0 flex items-center justify-center p-6"
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-orange-200/40 bg-black/25 text-3xl font-black text-orange-100">
                {initialsFor(profile.displayName)}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-100 backdrop-blur">
              <Truck className="h-3.5 w-3.5" />
              Food Truck
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{scheduleLabel}</Badge>
              {menuLabel ? (
                <Badge variant="outline" className="border-white/20 text-white/75">
                  {menuLabel}
                </Badge>
              ) : null}
              <Badge variant="outline" className="border-white/20 text-white/65">
                Community/evidence-based profile
              </Badge>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
                {profile.displayName}
              </h1>
              {foodSummary ? (
                <p className="mt-2 text-sm font-medium text-orange-100/85">{foodSummary}</p>
              ) : null}
            </div>
          </div>

          <div
            data-testid="truck-profile-next-stop"
            className="rounded-2xl border border-orange-300/25 bg-orange-500/10 p-4"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-100/80">
              {primaryStop.label}
            </p>
            <p className="mt-2 text-xl font-bold text-white">
              {primaryStopName || primaryStop.label}
            </p>
            {primaryStopTime ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-white/78">
                <Clock3 className="h-4 w-4 text-orange-200" />
                {primaryStopTime}
              </p>
            ) : null}
            {primaryStop.stop?.addressPublicLabel ? (
              <p className="mt-1 flex items-start gap-2 text-sm text-white/68">
                <MapPin className="mt-0.5 h-4 w-4 flex-none text-orange-200" />
                <span>{primaryStop.stop.addressPublicLabel}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {directionsHref ? (
              <Button asChild className="bg-orange-500 font-bold text-black hover:bg-orange-400">
                <a
                  href={directionsHref}
                  data-analytics-action="directions_click"
                  data-analytics-target-type="map"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Route className="mr-2 h-4 w-4" />
                  Get directions
                </a>
              </Button>
            ) : (
              <Button asChild className="bg-orange-500 font-bold text-black hover:bg-orange-400">
                <a href="#truck-schedule">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  View schedule
                </a>
              </Button>
            )}
            {websiteCta ? (
              <Button asChild variant="outline" className="border-white/20 text-white hover:bg-white/10">
                <a
                  href={websiteCta.href}
                  data-analytics-action={
                    websiteCta.type === "social" ? "social_click" : "website_click"
                  }
                  data-analytics-target-type={websiteCta.type || "unknown"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {websiteCta.label}
                </a>
              </Button>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65">
            Own or know this truck?{" "}
            <a href="/claim-truck" className="font-semibold text-orange-200 hover:text-orange-100">
              Claim or update this profile
            </a>
            .
          </div>
        </div>
      </div>
    </section>
  );
}
