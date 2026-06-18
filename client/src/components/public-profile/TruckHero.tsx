import type { PublicCta, PublicRestaurantProfile, PublicTruckScheduleStop } from "@shared/publicProfiles";
import { assessPublicMenuCompleteness, normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileHeroMedia, buildPublicProfileHeroAssets } from "@/components/public-profile/ProfileHeroMedia";
import {
  getTruckScheduleAvailabilityLabel,
  getTruckSchedulePrimaryStop,
  hasTruckScheduleCta,
} from "@/components/public-profile/truckScheduleTruth";
import { CalendarDays, Clock3, MapPin, Route, Truck } from "lucide-react";

type TruckHeroProps = {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
};

const stopLabel = (stop: PublicTruckScheduleStop | null | undefined) =>
  String(stop?.locationName || stop?.addressPublicLabel || "").trim();

const stopTimeLabel = (stop: PublicTruckScheduleStop | null | undefined) =>
  [stop?.date, stop?.timeWindowLabel].filter(Boolean).join(" · ");

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
  const heroAssets = buildPublicProfileHeroAssets({
    entity: profile.profileType,
    displayName: profile.displayName,
    coverImageUrl: profile.coverImageUrl,
    logoUrl: profile.logoUrl,
    profileImageUrl: (profile as any).profileImageUrl,
    truckPhotoLogo: (profile as any).truckPhotoLogo,
    imageUrl: (profile as any).imageUrl,
  });
  const primaryStop = getTruckSchedulePrimaryStop(schedule);
  const primaryStopName = stopLabel(primaryStop.stop);
  const primaryStopTime = stopTimeLabel(primaryStop.stop);
  const directionsHref = primaryStop.stop?.directionsUrl || null;
  const menuLabel = menuTrustLabel(profile);
  const serviceLabel = normalizeBusinessTypeLabel(profile.serviceType || "") || "Food Truck";
  const foodSummary = [...(profile.cuisineTags || []).slice(0, 2), serviceLabel]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
  const hasSchedule = hasTruckScheduleCta(schedule);
  const scheduleLabel = getTruckScheduleAvailabilityLabel(schedule);
  const websiteCta = safeCtas.find((cta) => cta.type === "external" || cta.type === "social");

  return (
    <section
      data-testid="truck-profile-hero"
      className="overflow-hidden rounded-2xl border border-orange-300/20 bg-[#0f0d0b] shadow-[0_20px_80px_rgba(0,0,0,0.28)]"
    >
      <div className="grid gap-0 md:grid-cols-[0.92fr_1.08fr]">
        <div className="relative">
          <ProfileHeroMedia
            displayName={profile.displayName}
            coverImageUrl={heroAssets.coverImageUrl}
            logoImageUrl={heroAssets.logoImageUrl}
            theme="truck"
            heightClassName="min-h-[15rem]"
            badge={
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-100 backdrop-blur">
                <Truck className="h-3.5 w-3.5" />
                Food Truck
              </div>
            }
          />
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
            ) : hasSchedule ? (
              <Button asChild className="bg-orange-500 font-bold text-black hover:bg-orange-400">
                <a href="#truck-schedule">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  View schedule
                </a>
              </Button>
            ) : null}
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
