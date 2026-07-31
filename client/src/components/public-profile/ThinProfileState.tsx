/**
 * ThinProfileState
 *
 * A graceful, intentional presentation for profiles that have limited data.
 * Renders inside the normal business-specific profile instead of replacing it.
 * This keeps an incomplete listing recognizable as the same product while
 * exposing only confirmed information.
 *
 * "Not much is here yet, but the page still works."
 */
import type {
  PublicRestaurantProfile,
  PublicCta,
} from "@shared/publicProfiles";
import { normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { hasTruckScheduleSignal } from "./truckScheduleTruth";

type ThinProfileStateProps = {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
  logoImageUrl?: string | null;
  initials: string;
  isAuthenticated?: boolean;
};

function isThinProfile(profile: PublicRestaurantProfile): boolean {
  const hasMenu =
    profile.menuSections?.some((s) => (s.items?.length ?? 0) > 0) ||
    Boolean(profile.menuUrl || profile.menuImageUrl || profile.menuPdfUrl);
  // truckSchedule.status defaults to the placeholder string "unknown" when a
  // truck has no real schedule data, so it can't be used as a signal on its
  // own — hasTruckScheduleSignal checks for actual stops with real content,
  // same as ElevatedTruckHero/TruckSchedulePanel use.
  const hasScheduleOrHours =
    Boolean(profile.operatingHoursSummary || profile.openStatus) ||
    (profile.profileType === "truck" && hasTruckScheduleSignal(profile.truckSchedule));
  const hasDescription = Boolean(String(profile.description || "").trim());
  const hasGallery = (profile.galleryImages?.length ?? 0) > 0;
  return !hasMenu && !hasScheduleOrHours && !hasDescription && !hasGallery;
}

export function ThinProfileState({
  profile,
}: ThinProfileStateProps) {
  const typeLabel = normalizeBusinessTypeLabel(
    profile.profileType === "truck" ? "food_truck" : profile.profileType,
  );

  const claimHref = "/claim-business";
  const missingDetailsLabel =
    profile.profileType === "caterer" || profile.profileType === "private_chef"
      ? "Add services, availability, and photos to complete this profile."
      : profile.profileType === "truck"
        ? "Add your menu, schedule, and photos to complete this profile."
        : "Add your menu, hours, and photos to complete this profile.";

  return (
    <div className="flex flex-col items-center px-4 py-3 text-center">
      <div className="profile-surface w-full max-w-sm space-y-1 rounded-2xl px-5 py-5 text-center">
        <p className="text-sm font-semibold text-[color:var(--profile-ink)]">
          Is this your {typeLabel.toLowerCase()}?
        </p>
        <p className="text-xs text-[color:var(--profile-muted)]">
          {missingDetailsLabel}
        </p>
        <a
          href={claimHref}
          className="mt-2 inline-block text-sm font-bold text-[#b93619] hover:text-[#8f2a14]"
        >
          Claim or update this profile →
        </a>
      </div>
    </div>
  );
}

export { isThinProfile };
