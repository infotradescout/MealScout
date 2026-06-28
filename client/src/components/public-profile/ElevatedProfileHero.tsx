/**
 * ElevatedProfileHero
 *
 * The premium hero for restaurant and bar public profiles.
 * Distinct from TruckHero — this is for brick-and-mortar businesses.
 *
 * Answers immediately:
 *   - What is this place?
 *   - Is it open?
 *   - Where is it?
 *   - What type of food?
 *
 * Design:
 *   - Full-width cover image with gradient overlay
 *   - Logo/avatar anchored bottom-left
 *   - Name, type badge, cuisine tags
 *   - Open/closed status pill
 *   - Address line
 *   - Favorite button (authenticated users)
 *
 * Falls back gracefully when images are missing.
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { ProfileHeroMedia, buildPublicProfileHeroAssets } from "./ProfileHeroMedia";
import { ProfileFavoriteButton } from "./ProfileFavoriteButton";
import { ProfilePill, profileSurfaceClass } from "./ProfileVisualPrimitives";
import { normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { MapPin, Clock3 } from "lucide-react";

type ElevatedProfileHeroProps = {
  profile: PublicRestaurantProfile & {
    entity: string;
    profilePath?: string;
  };
  isAuthenticated?: boolean;
  isFavorited?: boolean;
};

function openStatusStyle(openStatus: string | null): {
  dot: string;
  text: string;
  bg: string;
  border: string;
} {
  if (!openStatus) return { dot: "bg-white/30", text: "text-white/60", bg: "bg-white/5", border: "border-white/10" };
  const lower = openStatus.toLowerCase();
  if (/open/i.test(lower) && !/closed/i.test(lower)) {
    return { dot: "bg-emerald-400", text: "text-emerald-200", bg: "bg-emerald-500/10", border: "border-emerald-400/25" };
  }
  if (/closed/i.test(lower)) {
    return { dot: "bg-white/25", text: "text-white/55", bg: "bg-white/5", border: "border-white/10" };
  }
  return { dot: "bg-amber-400", text: "text-amber-200", bg: "bg-amber-500/10", border: "border-amber-400/25" };
}

export function ElevatedProfileHero({
  profile,
  isAuthenticated = false,
  isFavorited = false,
}: ElevatedProfileHeroProps) {
  const heroAssets = buildPublicProfileHeroAssets({
    entity: profile.entity,
    displayName: profile.displayName,
    coverImageUrl: profile.coverImageUrl,
    logoUrl: profile.logoUrl,
    profileImageUrl: (profile as any).profileImageUrl,
  });

  const typeLabel = normalizeBusinessTypeLabel(profile.profileType);

  const cuisineSummary = [
    ...(profile.cuisineTags ?? []).slice(0, 2),
    profile.serviceType,
  ]
    .filter(Boolean)
    .join(" · ");

  const statusStyle = openStatusStyle(profile.openStatus);

  const locationLine = [profile.addressPublicLabel, profile.city, profile.state]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      aria-label={`${profile.displayName} profile hero`}
      className={profileSurfaceClass}
    >
      {/* Cover + logo */}
      <ProfileHeroMedia
        displayName={profile.displayName}
        coverImageUrl={heroAssets.coverImageUrl}
        logoImageUrl={heroAssets.logoImageUrl}
        theme="default"
        heightClassName="h-52 md:h-[21rem]"
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
        {/* Type badge + open status */}
        <div className="flex flex-wrap items-center gap-2">
          <ProfilePill tone="orange">{typeLabel}</ProfilePill>
          {profile.verifiedProfile ? (
            <ProfilePill>Verified</ProfilePill>
          ) : null}
          {profile.locallyOwned ? (
            <ProfilePill tone="green">Locally owned</ProfilePill>
          ) : null}
          {profile.openStatus ? (
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${statusStyle.bg} ${statusStyle.border}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
              <span className={statusStyle.text}>{profile.openStatus}</span>
            </span>
          ) : null}
        </div>

        {/* Name */}
        <h1 className="text-[2rem] font-black leading-[0.95] tracking-tight text-white sm:text-5xl">
          {profile.displayName}
        </h1>

        {/* Cuisine / service type */}
        {cuisineSummary ? (
          <p className="text-sm font-medium text-orange-100/80">{cuisineSummary}</p>
        ) : null}

        {/* Location + hours inline */}
        <div className="space-y-1.5 text-sm text-white/70">
          {locationLine ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-none text-orange-200/60" />
              <span>{locationLine}</span>
            </p>
          ) : null}
          {profile.hours ? (
            <p className="flex items-start gap-2">
              <Clock3 className="mt-0.5 h-4 w-4 flex-none text-orange-200/60" />
              <span className="line-clamp-2">{profile.hours}</span>
            </p>
          ) : null}
        </div>

        {/* Description */}
        {profile.description ? (
          <p className="line-clamp-3 text-sm leading-6 text-white/65">
            {profile.description}
          </p>
        ) : null}
      </div>
    </section>
  );
}
