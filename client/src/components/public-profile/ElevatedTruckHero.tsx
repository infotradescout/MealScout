/**
 * ElevatedTruckHero
 *
 * The premium hero for food truck public profiles.
 * Distinct from ElevatedProfileHero — trucks are mobile, their hero must
 * answer "where is this truck right now?" as the first question.
 *
 * Answers immediately:
 *   - What truck is this?
 *   - Is it scheduled here now, serving today, or upcoming?
 *   - Where is it?
 *   - What should I order?
 *   - What is the next best action?
 *
 * Design:
 *   - Full-width cover with warm orange gradient fallback
 *   - Logo/avatar anchored bottom-left
 *   - "Food truck" type label — never "Restaurant"
 *   - Scheduled here / Today / Next stop status card
 *   - Cuisine tags
 *   - Favorite button
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import {
  ProfileHeroMedia,
  buildPublicProfileHeroAssets,
} from "./ProfileHeroMedia";
import { getDishCategoryPhoto } from "@/lib/dishCategoryPhoto";
import { ProfileFavoriteButton } from "./ProfileFavoriteButton";
import { ProfileRecommendButton } from "./ProfileRecommendButton";
import { getTruckSchedulePrimaryStop } from "./truckScheduleTruth";
import { CalendarDays, Clock3, MapPin, Navigation } from "lucide-react";

type ElevatedTruckHeroProps = {
  profile: PublicRestaurantProfile & {
    entity: string;
    profilePath?: string;
  };
  isAuthenticated?: boolean;
  isFavorited?: boolean;
};

function ScheduleStatusPill({
  kind,
}: {
  kind: "current" | "today" | "next" | "upcoming" | "empty";
}) {
  if (kind === "current") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/40 bg-orange-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-orange-200">
        <MapPin className="h-3 w-3" />
        Scheduled here now
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

const GENERIC_TRUCK_TEXT = new Set([
  "food_truck",
  "food truck",
  "truck",
  "restaurant",
]);

const cleanCuisineTags = (tags: string[] | null | undefined) =>
  (tags ?? [])
    .map((tag) => String(tag || "").trim())
    .filter((tag) => tag && !GENERIC_TRUCK_TEXT.has(tag.toLowerCase()))
    .slice(0, 2);

const isGenericTruckDescription = (
  description: string | null | undefined,
  profile: PublicRestaurantProfile,
) => {
  const normalized = String(description || "")
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return (
    GENERIC_TRUCK_TEXT.has(normalized) ||
    normalized === String(profile.profileType || "").toLowerCase() ||
    normalized === String(profile.serviceType || "").toLowerCase()
  );
};

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

  const categoryPhoto = heroAssets.coverImageUrl
    ? null
    : getDishCategoryPhoto(profile.displayName, ...(profile.cuisineTags ?? []));

  const primaryStop = getTruckSchedulePrimaryStop(profile.truckSchedule);
  const stop = primaryStop.stop;
  const stopName = String(
    stop?.locationName || stop?.addressPublicLabel || "",
  ).trim();
  const stopTiming = [stop?.date, stop?.timeWindowLabel]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
  const directionsHref = String(stop?.directionsUrl || "").trim();
  const hasActionableStop = primaryStop.kind !== "empty" && Boolean(stop);

  const cuisineSummary = cleanCuisineTags(profile.cuisineTags).join(" · ");
  const description = isGenericTruckDescription(profile.description, profile)
    ? null
    : profile.description;

  return (
    <section
      aria-label={`${profile.displayName} food truck profile`}
      className="profile-surface overflow-hidden rounded-[1.75rem]"
      data-public-profile-hero="truck"
    >
      {/* Cover + logo */}
      <ProfileHeroMedia
        displayName={profile.displayName}
        coverImageUrl={heroAssets.coverImageUrl}
        logoImageUrl={heroAssets.logoImageUrl}
        categoryPhoto={categoryPhoto}
        theme="truck"
        heightClassName="h-44 md:h-64"
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
      <div className="space-y-2.5 p-4 sm:p-5">
        {/* Type badge + live status */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-800">
            Food truck
          </span>
          {profile.verifiedProfile ? (
            <span className="rounded-full border border-[color:var(--profile-border)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[color:var(--profile-muted)]">
              Verified
            </span>
          ) : null}
          {profile.locallyOwned ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
              Locally owned
            </span>
          ) : null}
          <ScheduleStatusPill kind={primaryStop.kind} />
        </div>

        {/* Name */}
        <h1 className="text-3xl font-black tracking-tight text-[color:var(--profile-ink)] sm:text-4xl">
          {profile.displayName}
        </h1>

        {/* Cuisine */}
        {cuisineSummary ? (
          <p className="text-sm font-bold text-[#ad3a20]">
            {cuisineSummary}
          </p>
        ) : null}

        {/* Description */}
        {description ? (
          <p className="line-clamp-3 text-sm leading-6 text-[color:var(--profile-muted)]">
            {description}
          </p>
        ) : null}

        {hasActionableStop ? (
          <div
            className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4"
            data-testid="truck-hero-primary-stop"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-800">
              {primaryStop.label}
            </p>
            <p className="mt-1.5 text-lg font-black text-stone-950">
              {stopName || "Location details posted"}
            </p>
            {stopTiming ? (
              <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-stone-700">
                <Clock3 className="h-4 w-4 shrink-0 text-orange-700" />
                {stopTiming}
              </p>
            ) : null}
            {stop?.addressPublicLabel &&
            stop.addressPublicLabel !== stopName ? (
              <p className="mt-1.5 flex items-start gap-2 text-sm text-stone-600">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" />
                {stop.addressPublicLabel}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {directionsHref ? (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-700"
                  data-analytics-action="directions_click"
                  data-analytics-target-type="truck_stop"
                >
                  <Navigation className="h-4 w-4" />
                  Get directions
                </a>
              ) : null}
              <a
                href="#truck-schedule"
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-orange-300 bg-white px-4 py-2 text-sm font-black text-orange-900 hover:bg-orange-50"
              >
                <CalendarDays className="h-4 w-4" />
                Full schedule
              </a>
            </div>
          </div>
        ) : (
          <a
            href="#truck-schedule"
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-dashed border-orange-300 bg-orange-50/70 px-4 py-3 text-sm font-bold text-orange-950 hover:bg-orange-50"
          >
            <span>Schedule not posted yet</span>
            <span className="inline-flex items-center gap-1 text-orange-700">
              Follow updates <CalendarDays className="h-4 w-4" />
            </span>
          </a>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <ProfileRecommendButton
            restaurantId={profile.id}
            isAuthenticated={isAuthenticated}
            profilePath={profile.profilePath}
          />
          <a
            href="#menu"
            className="text-sm font-black text-orange-700 hover:text-orange-900"
          >
            See what they serve
          </a>
        </div>
      </div>
    </section>
  );
}
