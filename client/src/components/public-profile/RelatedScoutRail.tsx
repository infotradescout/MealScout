import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { apiUrl } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { PersonalizedRelatedRail } from "./PersonalizedRelatedRail";

export function RelatedScoutRail({
  profile,
  citySlug,
  userFavoriteIds,
  onCrossPromotionClick,
}: {
  profile: PublicRestaurantProfile;
  citySlug: string | null;
  userFavoriteIds: Set<string>;
  onCrossPromotionClick?: (href: string) => void;
}) {
  const profileType =
    profile.profileType === "truck" || profile.profileType === "bar"
      ? profile.profileType
      : "restaurant";
  const { data } = useQuery<{
    businesses?: Array<{
      id: string;
      name: string;
      profileType?: string | null;
      cuisineType?: string | null;
      logoUrl?: string | null;
      coverImageUrl?: string | null;
      attributedProfilePath?: string | null;
      city?: string | null;
    }>;
  }>({
    queryKey: ["/api/public/profiles", profileType, profile.id, "related"],
    enabled: Boolean(profile.id),
    queryFn: async () => {
      const response = await fetch(
        apiUrl(
          `/api/public/profiles/${encodeURIComponent(profileType)}/${encodeURIComponent(profile.id)}/related`,
        ),
      );
      if (!response.ok) return { businesses: [] };
      return response.json();
    },
    staleTime: 5 * 60_000,
  });
  const relatedBusinesses = (data?.businesses || []).map((business) => ({
    ...business,
    profilePath: business.attributedProfilePath || null,
  }));

  return (
    <PersonalizedRelatedRail
      profile={profile as any}
      relatedBusinesses={relatedBusinesses}
      citySlug={citySlug}
      userFavoriteIds={userFavoriteIds}
      onCrossPromotionClick={onCrossPromotionClick}
    />
  );
}
