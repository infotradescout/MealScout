import type { PublicRestaurantProfile } from "@shared/publicProfiles";

type PublicClaimPromptProfile = Pick<
  PublicRestaurantProfile,
  "profileType" | "verifiedProfile"
>;

/**
 * Verified public profiles are already attached to their business owner.
 * Ownership and claim prompts belong only on unclaimed public profiles.
 */
export const shouldShowPublicClaimPrompt = (
  profile: Pick<PublicClaimPromptProfile, "verifiedProfile">,
) => profile.verifiedProfile !== true;

export const isClaimedTruckProfile = (
  profile: PublicClaimPromptProfile | null | undefined,
) =>
  Boolean(
    profile?.profileType === "truck" &&
      !shouldShowPublicClaimPrompt(profile),
  );
