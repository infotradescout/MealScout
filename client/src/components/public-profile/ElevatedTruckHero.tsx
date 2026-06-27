/**
 * ElevatedTruckHero
 *
 * The premium hero for food truck public profiles.
 * Distinct from ElevatedProfileHero — trucks are mobile, their hero must
 * answer "where is this truck right now?" as the first question.
 *
 * Answers immediately:
 *   - What truck is this?
 *   - Is it live now, serving today, or scheduled?
 *   - Where is it?
 *   - What should I order?
 *   - What is the next best action?
 *
 * Design:
 *   - Full-width cover with warm orange gradient fallback
 *   - Logo/avatar anchored bottom-left
 *   - "Food truck" type label — never "Restaurant"
 *   - Live / Today / Next stop status card
 *   - Cuisine tags
 *   - Favorite button
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { ProfileHeroMedia, buildPublicProfileHeroAssets } from "./ProfileHeroMedia";
import { ProfileFavoriteButton } from "./ProfileFavoriteButton";
import {
  getTruckSchedulePrimaryStop,
  hasTruckScheduleSignal,
} from "./truckScheduleTruth";
import { MapPin, Clock3, Flame } from "lucide-react";

type ElevatedTruckHeroProps = {
  profile: PublicRestaurantProfile & {
    entity: string;
    profilePath?: string;
  };
  isAuthenticated?: boolean;
  isFavorited?: boolean;
};

function LiveStatusPill({ kind }: { kind: "current" | "today" | "next" | "upcoming" | "empty" }) {
  if (kind === "current") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/40 bg-orange-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-orange-200">
        <Flame className="h-3 w-3" />
        Live now
      </span>
    );
  }
  if (kind === "today") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-200">
        Serving today
      </span>
    );
  }
  if (kind === "next" || kind === "upcoming") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold text-white/60">
        Scheduled
      </span>
    );
  }
  return null;
}

export function ElevatedTruckHero({
  profile,
  isAuthenticated = false,
  isFavorited = false,
}: ElevatedTruckHeroProps) {
  const heroAssets = buildPublicProfileHeroAssets({
    entity: "truck",
    displayName: profile.displayName,
    coverImageUrl: profile.coverImageUrl,
    logoUrl: profile.logoUrl,
    profileImageUrl: (profile as any).profileImageUrl,
    truckPhotoLogo: (profile as any).truckPhotoLogo,
  });

  const hasSchedule = hasTruckScheduleSignal(profile.truckSchedule);
  const primaryStop = getTruckSchedulePrimaryStop(profile.truckSchedule);

  const cuisineSummary = [
    ...(profile.cuisineTags ?? []).slice(0, 2),
    profile.serviceType,
  ]
    .filter(Boolean)
    .join(" · ");

  const locationSummary = [profile.city, profile.state].filter(Boolean).join(", ");

  return (
    <section
      aria-label={`${profile.displayName} food truck profile`}
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f0d0b]"
    >
      {/* Cover + logo */}
      <ProfileHeroMedia
        displayName={profile.displayName}
        coverImageUrl={heroAssets.coverImageUrl}
        logoImageUrl={heroAssets.logoImageUrl}
        theme="truck"
        heightClassName="h-40 md:h-56"
        badge={
          <ProfileFavoriteButton
            restaurantId={profile.id}
            isAuthenticated={isAuthenticated}
            initialIsFavorited={isFavorited}
            profilePath={profile.profilePath}
          />
        }
      />

      {/* Info block */}
      <div className="space-y-3 p-4 sm:p-5">
        {/* Type badge + live status */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-200">
            Food truck
          </span>
          {profile.verifiedProfile ? (
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/55">
              Verified
            </span>
          ) : null}
          {profile.locallyOwned ? (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-semibold text-emerald-200/80">
              Locally owned
            </span>
          ) : null}
          <LiveStatusPill kind={primaryStop.kind} />
        </div>

        {/* Name */}
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {profile.displayName}
        </h1>

        {/* Cuisine */}
        {cuisineSummary ? (
          <p className="text-sm font-medium text-orange-100/80">{cuisineSummary}</p>
        ) : null}

        {/* Description */}
        {profile.description ? (
          <p className="line-clamp-3 text-sm leading-6 text-white/65">
            {profile.description}
          </p>
        ) : null}

        {/* Primary stop card — the "where is it?" answer */}
        {hasSchedule && primaryStop.stop ? (
          <div
            className={`rounded-2xl border p-3.5 space-y-1.5 ${
              primaryStop.kind === "current"
                ? "border-orange-400/30 bg-orange-500/10"
                : "border-white/10 bg-black/20"
            }`}
          >
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                primaryStop.kind === "current" ? "text-orange-200/70" : "text-white/40"
              }`}
            >
              {primaryStop.label}
            </p>
            <p className="text-base font-bold text-white">
              {primaryStop.stop.locationName ||
                primaryStop.stop.addressPublicLabel ||
                primaryStop.label}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
              {primaryStop.stop.timeWindowLabel ? (
                <span className="flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5 text-orange-200/60" />
                  {primaryStop.stop.timeWindowLabel}
                </span>
              ) : null}
              {primaryStop.stop.addressPublicLabel &&
              primaryStop.stop.addressPublicLabel !== primaryStop.stop.locationName ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-orange-200/60" />
                  {primaryStop.stop.addressPublicLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : !hasSchedule && locationSummary ? (
          /* No schedule — show base location */
          <div className="rounded-2xl border border-white/8 bg-black/15 px-3.5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
              Based in
            </p>
            <p className="mt-1 text-sm font-semibold text-white/80">{locationSummary}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
