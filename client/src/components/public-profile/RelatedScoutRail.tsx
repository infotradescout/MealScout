import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { PersonalizedRelatedRail } from "./PersonalizedRelatedRail";

export function RelatedScoutRail({
  profile,
  citySlug,
  userFavoriteIds,
}: {
  profile: PublicRestaurantProfile;
  citySlug: string | null;
  userFavoriteIds: Set<string>;
}) {
  return (
    <PersonalizedRelatedRail
      profile={profile as any}
      citySlug={citySlug}
      userFavoriteIds={userFavoriteIds}
    />
  );
}
