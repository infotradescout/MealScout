export const HOME_RANKING_WEIGHTS = {
  manualRecommendation: 6,
  videoRecommendation: 12,
  follows: 4,
  favorites: 18,
  activeDeals: 5,
  location: 4,
  liveTruckBoost: 1.5,
  communityActivity: 2,
} as const;

export const AWARD_RANKING_WEIGHTS = {
  manualRecommendation: 50,
  videoRecommendation: 150,
  favorites: 180,
  follows: 20,
  avgRating: 20,
  totalDealClaims: 10,
  totalDealViews: 1,
  communityActivity: 8,
  // A dish-level pick is a lighter endorsement than recommending the whole
  // restaurant, so it's weighted well below manualRecommendation.
  dishRecommendation: 20,
} as const;

export type HomeRankingInput = {
  recommendationCount: number;
  videoRecommendationCount: number;
  followCount: number;
  favoriteCount: number;
  activeDealCount: number;
  locationBoost: number;
  liveTruckBoost: number;
  communityActivityCount?: number;
};

export function computeHomeRankingScore(input: HomeRankingInput): number {
  return (
    input.recommendationCount * HOME_RANKING_WEIGHTS.manualRecommendation +
    input.videoRecommendationCount * HOME_RANKING_WEIGHTS.videoRecommendation +
    input.followCount * HOME_RANKING_WEIGHTS.follows +
    input.favoriteCount * HOME_RANKING_WEIGHTS.favorites +
    input.activeDealCount * HOME_RANKING_WEIGHTS.activeDeals +
    input.locationBoost * HOME_RANKING_WEIGHTS.location +
    input.liveTruckBoost * HOME_RANKING_WEIGHTS.liveTruckBoost +
    (input.communityActivityCount || 0) * HOME_RANKING_WEIGHTS.communityActivity
  );
}

export function getHomeRankingReasons(args: {
  recommendationCount: number;
  videoRecommendationCount: number;
  followCount: number;
  favoriteCount: number;
  activeDealCount: number;
  hasLocationBoost: boolean;
}): string {
  const reasons: string[] = [];
  if (args.favoriteCount > 0) reasons.push("favorites");
  if (args.videoRecommendationCount > 0) reasons.push("video recommendations");
  if (args.recommendationCount > 0) reasons.push("community recommendations");
  if (args.followCount > 0) reasons.push("follows");
  if (args.activeDealCount > 0) reasons.push("active deals");
  if (args.hasLocationBoost) reasons.push("distance");
  return reasons.length > 0 ? `Ranked by ${reasons.join(", ")}` : "Ranked by local relevance";
}
