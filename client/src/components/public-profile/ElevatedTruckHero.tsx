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
import {
  ProfileHeroMedia,
  buildPublicProfileHeroAssets,
} from "./ProfileHeroMedia";
import { getDishCategoryPhoto } from "@/lib/dishCategoryPhoto";
import { ProfileRecommendButton } from "./ProfileRecommendButton";
import { getTruckSchedulePrimaryStop } from "./truckScheduleTruth";
import { Flame } from "lucide-react";

type ElevatedTruckHeroProps = {
  profile: PublicRestaurantProfile & {
    entity: string;
    profilePath?: string;
  };
  isAuthenticated?: boolean;
  isFavorited?: boolean;
};

function LiveStatusPill({
  kind,
}: {
  kind: "current" | "today" | "next" | "upcoming" | "empty";
}) {
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

  const cuisineSummary = cleanCuisineTags(profile.cuisineTags).join(" · ");
  const description = isGenericTruckDescription(profile.description, profile)
    ? null
    : profile.description;

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
        categoryPhoto={categoryPhoto}
        theme="truck"
        heightClassName="h-28 md:h-40"
      />

      {/* Info block */}
      <div className="space-y-2.5 p-4 sm:p-5">
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
          <p className="text-sm font-medium text-orange-100/80">
            {cuisineSummary}
          </p>
        ) : null}

        {/* Description */}
        {description ? (
          <p className="line-clamp-3 text-sm leading-6 text-white/65">
            {description}
          </p>
        ) : null}

        <ProfileRecommendButton
          restaurantId={profile.id}
          isAuthenticated={isAuthenticated}
          profilePath={profile.profilePath}
        />
      </div>
    </section>
  );
}
