/**
 * ThinProfileState
 *
 * A graceful, intentional presentation for profiles that have limited data.
 * The page still works and looks polished — it does not feel broken.
 *
 * Shows:
 * - Name and correct type label
 * - Polished image/logo fallback (initials)
 * - Best available action (directions, website, call)
 * - Compact "menu not posted" state
 * - Compact "schedule/hours not posted" state
 * - Tasteful owner/claim CTA
 *
 * "Not much is here yet, but the page still works."
 */
import type { PublicRestaurantProfile, PublicCta } from "@shared/publicProfiles";
import { normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { MapPin, MenuSquare, CalendarDays, Globe } from "lucide-react";

type ThinProfileStateProps = {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
  logoImageUrl?: string | null;
  initials: string;
};

function isThinProfile(profile: PublicRestaurantProfile): boolean {
  const hasMenu =
    (profile.menuSections?.some((s) => (s.items?.length ?? 0) > 0)) ||
    Boolean(profile.menuUrl || profile.menuImageUrl || profile.menuPdfUrl);
  const hasScheduleOrHours =
    Boolean(profile.hours || profile.openStatus) ||
    (profile.profileType === "truck" && Boolean(profile.truckSchedule?.status));
  const hasDescription = Boolean(String(profile.description || "").trim());
  const hasGallery = (profile.galleryImages?.length ?? 0) > 0;
  return !hasMenu && !hasScheduleOrHours && !hasDescription && !hasGallery;
}

export function ThinProfileState({
  profile,
  safeCtas,
  logoImageUrl,
  initials,
}: ThinProfileStateProps) {
  const typeLabel = normalizeBusinessTypeLabel(
    profile.profileType === "truck"
      ? "food_truck"
      : profile.profileType,
  );

  // Pick the single best CTA
  const priorityTypes = ["map", "order", "menu", "phone", "external"];
  const bestCta = priorityTypes
    .flatMap((type) => safeCtas.filter((c) => c.type === type))
    .find(Boolean);

  const claimHref =
    profile.profileType === "truck" ? "/claim-business" : "/claim-business";

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 text-center">
      {/* Logo / initials */}
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-orange-300/25 bg-[radial-gradient(circle_at_30%_30%,rgba(251,146,60,0.25),transparent_60%),linear-gradient(145deg,#1d100a,#0d0a08)] shadow-[0_12px_32px_rgba(0,0,0,0.4)]">
        {logoImageUrl ? (
          <img
            src={logoImageUrl}
            alt={profile.displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-2xl font-black text-orange-100">{initials}</span>
        )}
      </div>

      {/* Name and type */}
      <div className="space-y-1">
        <span className="inline-block rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-200">
          {typeLabel}
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {profile.displayName}
        </h1>
        {profile.addressPublicLabel ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-white/60">
            <MapPin className="h-3.5 w-3.5 text-orange-200/60" />
            {profile.addressPublicLabel}
          </p>
        ) : null}
      </div>

      {/* Best CTA */}
      {bestCta ? (
        <a
          href={bestCta.href}
          target={bestCta.type === "external" || bestCta.type === "map" ? "_blank" : undefined}
          rel={bestCta.type === "external" || bestCta.type === "map" ? "noopener noreferrer" : undefined}
          data-analytics-action="thin_profile_cta"
          data-analytics-target-type={bestCta.type}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-orange-400"
        >
          {bestCta.type === "map" && <MapPin className="h-4 w-4" />}
          {bestCta.type === "phone" && <MapPin className="h-4 w-4" />}
          {bestCta.type === "menu" && <MenuSquare className="h-4 w-4" />}
          {bestCta.type === "order" && <Globe className="h-4 w-4" />}
          {bestCta.label}
        </a>
      ) : null}

      {/* Compact unavailable states */}
      <div className="w-full max-w-xs space-y-2 text-left">
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/15 px-3 py-2.5">
          <MenuSquare className="h-4 w-4 flex-none text-white/30" />
          <p className="text-xs text-white/50">Menu not posted yet</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/15 px-3 py-2.5">
          <CalendarDays className="h-4 w-4 flex-none text-white/30" />
          <p className="text-xs text-white/50">
            {profile.profileType === "truck"
              ? "Schedule not posted yet"
              : "Hours not posted yet"}
          </p>
        </div>
      </div>

      {/* Owner claim CTA */}
      <div className="rounded-2xl border border-white/10 bg-[#0f0d0b] px-4 py-4 text-center space-y-1 w-full max-w-xs">
        <p className="text-sm font-semibold text-white/80">
          Is this your {typeLabel.toLowerCase()}?
        </p>
        <p className="text-xs text-white/50">
          Add your menu, hours, and photos to make this profile shine.
        </p>
        <a
          href={claimHref}
          className="mt-2 inline-block text-sm font-bold text-orange-300 hover:text-orange-200"
        >
          Claim or update this profile →
        </a>
      </div>
    </div>
  );
}

export { isThinProfile };
