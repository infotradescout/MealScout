export const HOME_RANKING_WEIGHTS = {
  manualRecommendation: 4,
  videoRecommendation: 12,
  follows: 4,
  favorites: 3,
  activeDeals: 5,
  location: 4,
  liveTruckBoost: 1.5,
  communityActivity: 2,
} as const;

export const AWARD_RANKING_WEIGHTS = {
  // Action hierarchy: clicks/views < claims < likes < comments < shares < follows < recommendations < favorites
  totalDealViews: 1,
  totalDealClaims: 2,
  likes: 4,
  comments: 5,
  shares: 6,
  follows: 8,
  recommendations: 10,
  favorites: 12,
  trustBonus: 1,
  sentimentStability: 4,

  // Legacy/detail weights retained for compatibility in other score surfaces.
  manualRecommendation: 10,
  videoRecommendation: 3,
  avgRating: 20,
  communityActivity: 8,
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
  if (args.videoRecommendationCount > 0) reasons.push("video recommendations");
  if (args.favoriteCount > 0) reasons.push("favorites");
  if (args.followCount > 0) reasons.push("follows");
  if (args.activeDealCount > 0) reasons.push("active deals");
  if (args.recommendationCount > 0) reasons.push("community recommendations");
  if (args.hasLocationBoost) reasons.push("distance");
  return reasons.length > 0 ? `Ranked by ${reasons.join(", ")}` : "Ranked by local relevance";
}
