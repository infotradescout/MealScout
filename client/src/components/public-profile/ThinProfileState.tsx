/**
 * ThinProfileState
 *
 * A graceful, intentional presentation for profiles that have limited data.
 * Renders below the hero (which already shows name/logo/address/photo/a
 * recommend button), so this only adds what the hero doesn't: the single
 * best action and a claim CTA. It shows only what's actually available — it
 * does not announce what's missing (no "menu not posted" placeholders) and
 * does not repeat the hero's name/logo/recommend button.
 *
 * "Not much is here yet, but the page still works."
 */
import type {
  PublicRestaurantProfile,
  PublicCta,
} from "@shared/publicProfiles";
import { normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { MapPin, MenuSquare, Phone, ShoppingBag, ExternalLink } from "lucide-react";
import { hasTruckScheduleSignal } from "./truckScheduleTruth";
import { primaryPublicCta } from "./profileActionPolicy";

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
  safeCtas,
}: ThinProfileStateProps) {
  const typeLabel = normalizeBusinessTypeLabel(
    profile.profileType === "truck" ? "food_truck" : profile.profileType,
  );

  // Use the same entity-aware action policy as the mobile dock and hero actions.
  const bestCta = primaryPublicCta(safeCtas, profile.profileType);

  const claimHref =
    profile.profileType === "truck" ? "/claim-business" : "/claim-business";

  return (
    <div className="flex flex-col items-center gap-6 py-6 px-4 text-center">
      {/* Best CTA */}
      {bestCta ? (
        <a
          href={bestCta.href}
          target={
            bestCta.type === "external" || bestCta.type === "map"
              ? "_blank"
              : undefined
          }
          rel={
            bestCta.type === "external" || bestCta.type === "map"
              ? "noopener noreferrer"
              : undefined
          }
          data-analytics-action="thin_profile_cta"
          data-analytics-target-type={bestCta.type}
          className="profile-action-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold"
        >
          {bestCta.type === "map" && <MapPin className="h-4 w-4" />}
          {bestCta.type === "phone" && <Phone className="h-4 w-4" />}
          {bestCta.type === "menu" && <MenuSquare className="h-4 w-4" />}
          {bestCta.type === "order" && <ShoppingBag className="h-4 w-4" />}
          {!["map", "phone", "menu", "order"].includes(bestCta.type) && (
            <ExternalLink className="h-4 w-4" />
          )}
          {bestCta.label}
        </a>
      ) : null}

      {/* Owner claim CTA */}
      <div className="profile-surface w-full max-w-sm space-y-1 rounded-2xl px-5 py-5 text-center">
        <p className="text-sm font-semibold text-[color:var(--profile-ink)]">
          Is this your {typeLabel.toLowerCase()}?
        </p>
        <p className="text-xs text-[color:var(--profile-muted)]">
          Add your menu, hours, and photos to make this profile shine.
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
