// Allowlisted projection for unauthenticated restaurant list/detail responses
// (/api/restaurants/public, /search, /nearby, /subscribed, /:id). Keeps the
// existing flat field names consumers already read (name, address, latitude,
// currentLatitude, etc.) so callers don't need to change, while dropping
// columns that were never meant to leave the server: owner identity, raw
// import payloads, insurance/verification audit trail, and internal
// pricing/ranking controls.
export function toPublicRestaurantListing(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object") return row;

  const {
    id,
    name,
    address,
    phone,
    businessType,
    cuisineType,
    latitude,
    longitude,
    city,
    state,
    isFoodTruck,
    mobileOnline,
    currentLatitude,
    currentLongitude,
    lastBroadcastAt,
    liveUntilAt,
    operatingHours,
    isActive,
    isVerified,
    insuranceVerified,
    logoUrl,
    coverImageUrl,
    description,
    websiteUrl,
    instagramUrl,
    facebookPageUrl,
    xUrl,
    amenities,
    hasGoldenPlate,
    goldenPlateEarnedAt,
    goldenPlateCount,
    featuredMenuItemId,
    createdAt,
    updatedAt,
    // Computed fields attached at query time (not raw DB columns) — safe to
    // pass through as-is when present.
    distance,
    favoriteCount,
    followCount,
    recommendationCount,
    videoRecommendationCount,
    communityActivityCount,
    activeDealCount,
    homeRankingScore,
    homeRankingReason,
  } = row;

  return {
    id,
    name,
    address,
    phone,
    businessType,
    cuisineType,
    latitude,
    longitude,
    city,
    state,
    isFoodTruck,
    mobileOnline,
    currentLatitude,
    currentLongitude,
    lastBroadcastAt,
    liveUntilAt,
    operatingHours,
    isActive,
    isVerified,
    insuranceVerified,
    logoUrl,
    coverImageUrl,
    description,
    websiteUrl,
    instagramUrl,
    facebookPageUrl,
    xUrl,
    amenities,
    hasGoldenPlate,
    goldenPlateEarnedAt,
    goldenPlateCount,
    featuredMenuItemId,
    createdAt,
    updatedAt,
    ...(distance !== undefined ? { distance } : {}),
    ...(favoriteCount !== undefined ? { favoriteCount } : {}),
    ...(followCount !== undefined ? { followCount } : {}),
    ...(recommendationCount !== undefined ? { recommendationCount } : {}),
    ...(videoRecommendationCount !== undefined
      ? { videoRecommendationCount }
      : {}),
    ...(communityActivityCount !== undefined
      ? { communityActivityCount }
      : {}),
    ...(activeDealCount !== undefined ? { activeDealCount } : {}),
    ...(homeRankingScore !== undefined ? { homeRankingScore } : {}),
    ...(homeRankingReason !== undefined ? { homeRankingReason } : {}),
  };
}

export function toPublicRestaurantListingArray(
  rows: any[] | null | undefined,
): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows.map(toPublicRestaurantListing) : [];
}
