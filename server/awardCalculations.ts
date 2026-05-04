import { storage } from './storage';
import { db } from './db';
import {
  users,
  restaurants,
  awardHistory,
  videoStories,
  restaurantUserRecommendations,
  sentimentSignalEvents,
} from '@shared/schema';
import { eq, and, or, like, sql, isNotNull, isNull, gte } from 'drizzle-orm';
import { AWARD_RANKING_WEIGHTS } from '@shared/rankingPolicy';
import { evaluateTrustBonuses } from '@shared/trustBonuses';

// Golden Fork Award Criteria
const GOLDEN_FORK_CRITERIA = {
  minReviews: 10,
  minRecommendations: 5,
  minInfluenceScore: 100,
};

// Golden Plate Award Criteria
const GOLDEN_PLATE_CRITERIA = {
  minRankingScore: 500,
  topPercentage: 0.1, // Top 10% per area
};

const GOLDEN_FORK_ACTION_MULTIPLIER = 1.15;

const applyGoldenForkBoost = (
  count: number,
  goldenForkCount: number,
): number => {
  const base = Number(count || 0);
  const golden = Math.max(0, Math.min(base, Number(goldenForkCount || 0)));
  return base + golden * (GOLDEN_FORK_ACTION_MULTIPLIER - 1);
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Get authoritative recommendation count for a user based on video stories.
 * A recommendation credit is earned per distinct restaurantId the user has
 * ever tagged in a story (restaurantId IS NOT NULL), regardless of story status.
 */
export async function getUserRecommendationCount(userId: string): Promise<number> {
  const storyRecommendations = await db
    .select({ restaurantId: videoStories.restaurantId })
    .from(videoStories)
    .where(
      and(
        eq(videoStories.userId, userId),
        isNotNull(videoStories.restaurantId),
      ),
    )
    .groupBy(videoStories.restaurantId);

  const manualRecommendations = await db
    .select({ restaurantId: restaurantUserRecommendations.restaurantId })
    .from(restaurantUserRecommendations)
    .where(eq(restaurantUserRecommendations.userId, userId))
    .groupBy(restaurantUserRecommendations.restaurantId);

  const uniqueRestaurantIds = new Set<string>();
  for (const rec of storyRecommendations) {
    if (rec.restaurantId) uniqueRestaurantIds.add(rec.restaurantId);
  }
  for (const rec of manualRecommendations) {
    if (rec.restaurantId) uniqueRestaurantIds.add(rec.restaurantId);
  }

  return uniqueRestaurantIds.size;
}

/**
 * Weighted recommendation score for a user.
 * Video recommendations (restaurant-tagged stories) count higher than
 * button/text recommendations.
 */
export async function getUserWeightedRecommendationScore(
  userId: string,
): Promise<number> {
  const storyRecommendations = await db
    .select({ restaurantId: videoStories.restaurantId })
    .from(videoStories)
    .where(
      and(
        eq(videoStories.userId, userId),
        isNotNull(videoStories.restaurantId),
      ),
    )
    .groupBy(videoStories.restaurantId);

  const manualRecommendations = await db
    .select({ restaurantId: restaurantUserRecommendations.restaurantId })
    .from(restaurantUserRecommendations)
    .where(eq(restaurantUserRecommendations.userId, userId))
    .groupBy(restaurantUserRecommendations.restaurantId);

  const videoSet = new Set<string>();
  const manualSet = new Set<string>();

  for (const rec of storyRecommendations) {
    if (rec.restaurantId) videoSet.add(rec.restaurantId);
  }
  for (const rec of manualRecommendations) {
    if (rec.restaurantId) manualSet.add(rec.restaurantId);
  }

  let weighted = 0;
  for (const restaurantId of manualSet) {
    weighted += videoSet.has(restaurantId) ? 0 : 1;
  }
  weighted += videoSet.size * 3;

  return weighted;
}

/**
 * Calculate influence score for a user
 * Formula: (reviewCount * 10) + (weightedRecommendationScore * 15) + (favoritesCount * 5)
 */
export async function calculateUserInfluenceScore(userId: string): Promise<number> {
  const user = await storage.getUser(userId);
  if (!user) return 0;

  // Get favorites count
  const favorites = await storage.getUserRestaurantFavorites(userId);
  const favoritesCount = favorites.length;

  const weightedRecommendationScore = await getUserWeightedRecommendationScore(
    userId,
  );

  const influenceScore =
    (user.reviewCount || 0) * 10 +
    weightedRecommendationScore * 15 +
    favoritesCount * 5;

  return influenceScore;
}

/**
 * Check if a user is eligible for Golden Fork award
 */
export async function checkGoldenForkEligibility(userId: string): Promise<{
  eligible: boolean;
  reason?: string;
  stats: {
    reviewCount: number;
    recommendationCount: number;
    weightedRecommendationScore: number;
    influenceScore: number;
  };
}> {
  const user = await storage.getUser(userId);
  if (!user) {
    return {
      eligible: false,
      reason: 'User not found',
      stats: {
        reviewCount: 0,
        recommendationCount: 0,
        weightedRecommendationScore: 0,
        influenceScore: 0,
      },
    };
  }

  const influenceScore = await calculateUserInfluenceScore(userId);
  const reviewCount = user.reviewCount || 0;
  const recommendationCount = await getUserRecommendationCount(userId);
  const weightedRecommendationScore =
    await getUserWeightedRecommendationScore(userId);

  const stats = {
    reviewCount,
    recommendationCount,
    weightedRecommendationScore,
    influenceScore,
  };

  if (reviewCount < GOLDEN_FORK_CRITERIA.minReviews) {
    return {
      eligible: false,
      reason: `Need ${GOLDEN_FORK_CRITERIA.minReviews - reviewCount} more reviews`,
      stats,
    };
  }

  if (recommendationCount < GOLDEN_FORK_CRITERIA.minRecommendations) {
    return {
      eligible: false,
      reason: `Need ${GOLDEN_FORK_CRITERIA.minRecommendations - recommendationCount} more recommendations`,
      stats,
    };
  }

  if (influenceScore < GOLDEN_FORK_CRITERIA.minInfluenceScore) {
    return {
      eligible: false,
      reason: `Need ${GOLDEN_FORK_CRITERIA.minInfluenceScore - influenceScore} more influence points`,
      stats,
    };
  }

  return { eligible: true, stats };
}

/**
 * Award Golden Fork to eligible user
 */
export async function awardGoldenFork(userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user || user.hasGoldenFork) return false;

  const eligibility = await checkGoldenForkEligibility(userId);
  if (!eligibility.eligible) return false;

  // Award the Golden Fork
  await db
    .update(users)
    .set({
      hasGoldenFork: true,
      goldenForkEarnedAt: new Date(),
      influenceScore: eligibility.stats.influenceScore,
    })
    .where(eq(users.id, userId));

  // Record in award history
  await db.insert(awardHistory).values({
    awardType: 'golden_fork',
    recipientId: userId,
    recipientType: 'user',
    awardPeriodStart: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // Last year
    awardPeriodEnd: new Date(),
    rankingScore: eligibility.stats.influenceScore,
    metadata: { stats: eligibility.stats },
  });

  return true;
}

/**
 * Calculate ranking score for a restaurant
 * Action hierarchy:
 * - Lowest: clicks/views, then claims
 * - Mid: likes, comments, shares, follows, recommendations
 * - Highest: favorites
 * Golden Fork actions receive a modest weighting boost.
 */
export async function calculateRestaurantRankingScore(restaurantId: string): Promise<number> {
  // Get restaurant data
  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) return 0;

  const [
    recommendationRows,
    videoRecommendationRows,
    favoriteRows,
    followRows,
    directLikeRows,
    reactionRows,
    shareRows,
    recommendationCommentRows,
    videoCommentRows,
  ] = await Promise.all([
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        count(*)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from restaurant_user_recommendations rur
      join users u on u.id = rur.user_id
      where rur.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        count(*)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from video_stories vs
      join users u on u.id = vs.user_id
      where vs.restaurant_id = ${restaurantId}
        and vs.status = 'ready'
        and vs.deleted_at is null
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        count(*)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from restaurant_favorites rf
      join users u on u.id = rf.user_id
      where rf.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        count(*)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from restaurant_follows rf
      join users u on u.id = rf.user_id
      where rf.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        count(*)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from restaurant_likes rl
      join users u on u.id = rl.user_id
      where rl.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{
      like_count: number;
      dislike_count: number;
      golden_like_count: number;
      golden_dislike_count: number;
    }>`
      select
        coalesce(sum(case when rr.reaction_type = 'like' then 1 else 0 end), 0)::int as like_count,
        coalesce(sum(case when rr.reaction_type = 'dislike' then 1 else 0 end), 0)::int as dislike_count,
        coalesce(sum(case when rr.reaction_type = 'like' and u.has_golden_fork then 1 else 0 end), 0)::int as golden_like_count,
        coalesce(sum(case when rr.reaction_type = 'dislike' and u.has_golden_fork then 1 else 0 end), 0)::int as golden_dislike_count
      from recommendation_reactions rr
      join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
      join users u on u.id = rr.user_id
      where rur.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        coalesce(count(*), 0)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from recommendation_shares rs
      join restaurant_user_recommendations rur on rur.id = rs.recommendation_id
      join users u on u.id = rs.user_id
      where rur.restaurant_id = ${restaurantId}
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        coalesce(count(*), 0)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from recommendation_comments rc
      join restaurant_user_recommendations rur on rur.id = rc.recommendation_id
      join users u on u.id = rc.user_id
      where rur.restaurant_id = ${restaurantId}
        and rc.is_approved = true
    `),
    db.execute(sql<{ count: number; golden_count: number }>`
      select
        coalesce(count(*), 0)::int as count,
        coalesce(sum(case when u.has_golden_fork then 1 else 0 end), 0)::int as golden_count
      from story_comments sc
      join video_stories vs on vs.id = sc.story_id
      join users u on u.id = sc.user_id
      where vs.restaurant_id = ${restaurantId}
        and vs.status = 'ready'
        and vs.deleted_at is null
        and sc.is_approved = true
    `),
  ]);

  const recommendationRow = Array.isArray((recommendationRows as any).rows)
    ? (recommendationRows as any).rows[0]
    : null;
  const videoRecommendationRow = Array.isArray((videoRecommendationRows as any).rows)
    ? (videoRecommendationRows as any).rows[0]
    : null;
  const favoriteRow = Array.isArray((favoriteRows as any).rows)
    ? (favoriteRows as any).rows[0]
    : null;
  const followRow = Array.isArray((followRows as any).rows)
    ? (followRows as any).rows[0]
    : null;
  const directLikeRow = Array.isArray((directLikeRows as any).rows)
    ? (directLikeRows as any).rows[0]
    : null;
  const reactionRow = Array.isArray((reactionRows as any).rows)
    ? (reactionRows as any).rows[0]
    : null;
  const shareRow = Array.isArray((shareRows as any).rows)
    ? (shareRows as any).rows[0]
    : null;
  const recommendationCommentRow = Array.isArray((recommendationCommentRows as any).rows)
    ? (recommendationCommentRows as any).rows[0]
    : null;
  const videoCommentRow = Array.isArray((videoCommentRows as any).rows)
    ? (videoCommentRows as any).rows[0]
    : null;

  const manualRecommendationCount = Number(recommendationRow?.count || 0);
  const manualRecommendationGoldenCount = Number(
    recommendationRow?.golden_count || 0,
  );
  const videoRecommendationCount = Number(videoRecommendationRow?.count || 0);
  const videoRecommendationGoldenCount = Number(
    videoRecommendationRow?.golden_count || 0,
  );

  const recommendationsCount = manualRecommendationCount + videoRecommendationCount;
  const recommendationsGoldenCount =
    manualRecommendationGoldenCount + videoRecommendationGoldenCount;

  const favoritesCount = Number(favoriteRow?.count || 0);
  const favoritesGoldenCount = Number(favoriteRow?.golden_count || 0);
  const followCount = Number(followRow?.count || 0);
  const followGoldenCount = Number(followRow?.golden_count || 0);

  const directLikeCount = Number(directLikeRow?.count || 0);
  const directLikeGoldenCount = Number(directLikeRow?.golden_count || 0);
  const reactionLikeCount = Math.max(
    0,
    Number(reactionRow?.like_count || 0) - Number(reactionRow?.dislike_count || 0),
  );
  const reactionLikeGoldenCount = Math.max(
    0,
    Number(reactionRow?.golden_like_count || 0) -
      Number(reactionRow?.golden_dislike_count || 0),
  );
  const likesCount = directLikeCount + reactionLikeCount;
  const likesGoldenCount = directLikeGoldenCount + reactionLikeGoldenCount;

  const shareCount = Number(shareRow?.count || 0);
  const shareGoldenCount = Number(shareRow?.golden_count || 0);
  const commentCount =
    Number(recommendationCommentRow?.count || 0) +
    Number(videoCommentRow?.count || 0);
  const commentGoldenCount =
    Number(recommendationCommentRow?.golden_count || 0) +
    Number(videoCommentRow?.golden_count || 0);

  // Get average rating
  const reviews = await db.query.reviews.findMany({
    where: (rev: any) => eq(rev.restaurantId, restaurantId),
  });
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length
    : 0;

  // Get deal claims count
  const deals = await storage.getDealsByRestaurant(restaurantId);
  let totalDealClaims = 0;
  let totalDealViews = 0;

  for (const deal of deals) {
    const claims = await db.query.dealClaims.findMany({
      where: (claim: any) => eq(claim.dealId, deal.id),
    });
    totalDealClaims += claims.length;

    const views = await db.query.dealViews.findMany({
      where: (view: any) => eq(view.dealId, deal.id),
    });
    totalDealViews += views.length;
  }

  const boostedLikes = applyGoldenForkBoost(likesCount, likesGoldenCount);
  const boostedShares = applyGoldenForkBoost(shareCount, shareGoldenCount);
  const boostedComments = applyGoldenForkBoost(commentCount, commentGoldenCount);
  const boostedFollows = applyGoldenForkBoost(followCount, followGoldenCount);
  const boostedRecommendations = applyGoldenForkBoost(
    recommendationsCount,
    recommendationsGoldenCount,
  );
  const boostedFavorites = applyGoldenForkBoost(
    favoritesCount,
    favoritesGoldenCount,
  );

  const trustBonus = evaluateTrustBonuses({
    communityBuilderEnabled: Number(restaurant.communityBuilderBonusPoints || 0) > 0,
    actions: {
      likes: likesCount,
      shares: shareCount,
      follows: followCount,
      recommendations: recommendationsCount,
      favorites: favoritesCount,
      reviews: reviews.length,
    },
  });

  const sentimentSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [sentimentAggregate] = await db
    .select({
      sampleCount: sql<number>`count(*)`.mapWith(Number),
      avgDelta100: sql<number>`coalesce(avg(${sentimentSignalEvents.deltaScore100}), 0)`.mapWith(Number),
      avgAbsDelta100: sql<number>`coalesce(avg(abs(coalesce(${sentimentSignalEvents.deltaScore100}, 0))), 0)`.mapWith(Number),
      positiveShare: sql<number>`coalesce(avg(case when ${sentimentSignalEvents.score100} >= 70 then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(sentimentSignalEvents)
    .where(
      and(
        eq(sentimentSignalEvents.restaurantId, restaurantId),
        gte(sentimentSignalEvents.createdAt, sentimentSince),
      ),
    );

  let sentimentStabilityScore = 0;
  const sentimentSamples = Number(sentimentAggregate?.sampleCount || 0);
  if (sentimentSamples >= 5) {
    const avgDelta100 = Number(sentimentAggregate?.avgDelta100 || 0);
    const avgAbsDelta100 = Number(sentimentAggregate?.avgAbsDelta100 || 0);
    const positiveShare = Number(sentimentAggregate?.positiveShare || 0);
    const trend = clamp(avgDelta100, -5, 5);
    const volatilityPenalty = clamp(avgAbsDelta100, 0, 10) * 0.35;
    const positivityLift = clamp((positiveShare - 0.5) * 8, -2, 2);
    sentimentStabilityScore = clamp(trend - volatilityPenalty + positivityLift, -5, 5);
  }

  const rankingScore =
    totalDealViews * AWARD_RANKING_WEIGHTS.totalDealViews +
    totalDealClaims * AWARD_RANKING_WEIGHTS.totalDealClaims +
    boostedLikes * AWARD_RANKING_WEIGHTS.likes +
    boostedComments * AWARD_RANKING_WEIGHTS.comments +
    boostedShares * AWARD_RANKING_WEIGHTS.shares +
    boostedFollows * AWARD_RANKING_WEIGHTS.follows +
    boostedRecommendations * AWARD_RANKING_WEIGHTS.recommendations +
    boostedFavorites * AWARD_RANKING_WEIGHTS.favorites +
    trustBonus.totalPoints * AWARD_RANKING_WEIGHTS.trustBonus +
    sentimentStabilityScore * AWARD_RANKING_WEIGHTS.sentimentStability +
    Math.round(avgRating * AWARD_RANKING_WEIGHTS.avgRating) +
    // Keep minor signal from recommendation content volume via existing fields.
    videoRecommendationCount * AWARD_RANKING_WEIGHTS.videoRecommendation;

  return rankingScore;
}

/**
 * Award Golden Plates for a specific geographic area
 */
export async function awardGoldenPlatesForArea(area: string): Promise<number> {
  // Get all active restaurants in the area
  const areaRestaurants = await db.query.restaurants.findMany({
    where: (rest: any) =>
      and(
        eq(rest.isActive, true),
        or(like(rest.address, `%${area}%`), eq(sql`lower(${rest.address})`, area.toLowerCase()))
      ),
  });

  if (areaRestaurants.length === 0) return 0;

  // Calculate ranking scores for all restaurants
  const scoresMap = new Map<string, number>();
  for (const restaurant of areaRestaurants) {
    const score = await calculateRestaurantRankingScore(restaurant.id);
    scoresMap.set(restaurant.id, score);
  }

  // Sort by score descending
  const sortedRestaurants = areaRestaurants
    .map((r: any) => ({ restaurant: r, score: scoresMap.get(r.id) || 0 }))
    .filter((item: any) => item.score >= GOLDEN_PLATE_CRITERIA.minRankingScore)
    .sort((a: any, b: any) => b.score - a.score);

  // Award to top percentage or at least top 1
  const awardCount = Math.max(
    1,
    Math.ceil(sortedRestaurants.length * GOLDEN_PLATE_CRITERIA.topPercentage)
  );
  const winners = sortedRestaurants.slice(0, awardCount);

  const periodStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
  const periodEnd = new Date();

  let awardedCount = 0;

  for (let i = 0; i < winners.length; i++) {
    const { restaurant, score } = winners[i];

    // Update restaurant with Golden Plate
    await db
      .update(restaurants)
      .set({
        hasGoldenPlate: true,
        goldenPlateEarnedAt: new Date(),
        goldenPlateCount: (restaurant.goldenPlateCount || 0) + 1,
        rankingScore: score,
      })
      .where(eq(restaurants.id, restaurant.id));

    // Record in award history
    await db.insert(awardHistory).values({
      awardType: 'golden_plate',
      recipientId: restaurant.id,
      recipientType: 'restaurant',
      awardPeriodStart: periodStart,
      awardPeriodEnd: periodEnd,
      rankingScore: score,
      rankPosition: i + 1,
      geographicArea: area,
      metadata: { restaurantName: restaurant.name },
    });

    awardedCount++;
  }

  return awardedCount;
}

/**
 * Get leaderboard for a geographic area
 */
export async function getAreaLeaderboard(area: string, limit: number = 50) {
  const areaRestaurants = await db.query.restaurants.findMany({
    where: (rest: any) =>
      and(
        eq(rest.isActive, true),
        or(like(rest.address, `%${area}%`), eq(sql`lower(${rest.address})`, area.toLowerCase()))
      ),
  });

  const leaderboard = [];

  for (const restaurant of areaRestaurants) {
    const score = await calculateRestaurantRankingScore(restaurant.id);
    leaderboard.push({
      restaurant,
      rankingScore: score,
    });
  }

  return leaderboard.sort((a: any, b: any) => b.rankingScore - a.rankingScore).slice(0, limit);
}
