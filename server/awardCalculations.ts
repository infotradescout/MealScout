import { storage } from './storage';
import { db } from './db';
import {
  users,
  restaurants,
  awardHistory,
  videoStories,
  restaurantUserRecommendations,
  menuItemRecommendations,
} from '@shared/schema';
import { eq, and, or, like, sql, isNotNull, isNull } from 'drizzle-orm';
import { AWARD_RANKING_WEIGHTS } from '@shared/rankingPolicy';

// A dish recommendation is a lighter endorsement than recommending the
// whole restaurant, so it counts for less in the weighted score below.
// (Whether that specific pick carries added detail is already captured
// separately by reviewCount in the influence-score formula.)
const DISH_RECOMMENDATION_WEIGHT = 0.5;

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

  const dishRecommendations = await db
    .select({ restaurantId: menuItemRecommendations.restaurantId })
    .from(menuItemRecommendations)
    .where(eq(menuItemRecommendations.userId, userId))
    .groupBy(menuItemRecommendations.restaurantId);
  weighted += dishRecommendations.length * DISH_RECOMMENDATION_WEIGHT;

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
 * Formula: (manualRecommendations * 50) + (videoRecommendations * 150)
 *   + (favoritesCount * 35) + (followCount * 20)
 *   + (avgRating * 20) + (totalDealClaims * 10) + (totalDealViews * 1)
 */
export async function calculateRestaurantRankingScore(restaurantId: string): Promise<number> {
  // Get restaurant data
  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) return 0;

  // Manual/button recommendations
  const manualRecommendations = await db.query.restaurantUserRecommendations.findMany({
    where: (rec: any) => eq(rec.restaurantId, restaurantId),
  });
  const manualRecommendationCount = manualRecommendations.length;

  // Video recommendations: stories tagged to the restaurant
  const videoRecommendations = await db.query.videoStories.findMany({
    where: (story: any) =>
      and(
        eq(story.restaurantId, restaurantId),
        eq(story.status, 'ready'),
        isNull(story.deletedAt),
      ),
  });
  const videoRecommendationCount = videoRecommendations.length;

  // Get favorites count
  const favorites = await db.query.restaurantFavorites.findMany({
    where: (fav: any) => eq(fav.restaurantId, restaurantId),
  });
  const favoritesCount = favorites.length;

  const follows = await db.query.restaurantFollows.findMany({
    where: (follow: any) => eq(follow.restaurantId, restaurantId),
  });
  const followCount = follows.length;

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

  // Community activity across recommendation interactions + video engagement.
  const activityRows = await db.execute(sql<{
    reaction_score: number | null;
    share_count: number | null;
    video_engagement: number | null;
  }>`
    select
      coalesce(sum(case rr.reaction_type when 'like' then 1 when 'dislike' then -1 else 0 end), 0)::int as reaction_score,
      coalesce((select count(*)::int from recommendation_shares rs
        join restaurant_user_recommendations rur2 on rur2.id = rs.recommendation_id
        where rur2.restaurant_id = ${restaurantId}), 0)::int as share_count,
      coalesce((select sum(coalesce(vs.like_count,0) + coalesce(vs.comment_count,0) + coalesce(vs.share_count,0))::int
        from video_stories vs
        where vs.restaurant_id = ${restaurantId}
          and vs.status = 'ready'
          and vs.deleted_at is null), 0)::int as video_engagement
    from recommendation_reactions rr
    join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
    where rur.restaurant_id = ${restaurantId}
  `);
  const activityRow = Array.isArray((activityRows as any).rows)
    ? (activityRows as any).rows[0]
    : null;
  const communityActivityScore =
    Number(activityRow?.reaction_score || 0) +
    Number(activityRow?.share_count || 0) +
    Number(activityRow?.video_engagement || 0);

  // Dish-level picks at this restaurant - distinct signal from a full
  // restaurant recommendation, weighted lower (see AWARD_RANKING_WEIGHTS).
  const dishRecommendations = await db.query.menuItemRecommendations.findMany({
    where: (rec: any) => eq(rec.restaurantId, restaurantId),
  });
  const dishRecommendationCount = dishRecommendations.length;

  const rankingScore =
    manualRecommendationCount * AWARD_RANKING_WEIGHTS.manualRecommendation +
    videoRecommendationCount * AWARD_RANKING_WEIGHTS.videoRecommendation +
    dishRecommendationCount * AWARD_RANKING_WEIGHTS.dishRecommendation +
    favoritesCount * AWARD_RANKING_WEIGHTS.favorites +
    followCount * AWARD_RANKING_WEIGHTS.follows +
    Math.round(avgRating * AWARD_RANKING_WEIGHTS.avgRating) +
    totalDealClaims * AWARD_RANKING_WEIGHTS.totalDealClaims +
    totalDealViews * AWARD_RANKING_WEIGHTS.totalDealViews +
    communityActivityScore * AWARD_RANKING_WEIGHTS.communityActivity;

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
