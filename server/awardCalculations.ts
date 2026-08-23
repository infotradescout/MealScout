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
import { eq, and, or, like, sql, isNotNull } from 'drizzle-orm';
import { AWARD_RANKING_WEIGHTS } from '@shared/rankingPolicy';
import {
  isPublicStoryAssociationEligible,
  publicStoryPublicationWhere,
} from './services/publicStoryProjection';
import { isPublicBusinessVisible } from './utils/publicBusinessVisibility';
import { deriveProfileEvidenceQuarantineVisibility } from './services/profileEvidenceQuarantine';

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

export async function getUserPublishedVideoRecommendations(userId: string) {
  const rows = await db
    .select({
      restaurantId: videoStories.restaurantId,
      createdAt: videoStories.createdAt,
      creatorDisabled: users.isDisabled,
      restaurantActive: restaurants.isActive,
      restaurantName: restaurants.name,
      restaurantAddress: restaurants.address,
      restaurantCity: restaurants.city,
      restaurantState: restaurants.state,
      restaurantCuisineType: restaurants.cuisineType,
      restaurantDescription: restaurants.description,
      restaurantPhone: restaurants.phone,
      restaurantWebsiteUrl: restaurants.websiteUrl,
      restaurantOwnerDisabled: sql<boolean | null>`(
        select linked_owner.is_disabled from users linked_owner
        where linked_owner.id = ${restaurants.ownerId} limit 1
      )`,
      restaurantEmail: sql<string | null>`(
        select linked_owner.email from users linked_owner
        where linked_owner.id = ${restaurants.ownerId} limit 1
      )`,
      restaurantRawData: restaurants.rawData,
    })
    .from(videoStories)
    .innerJoin(users, eq(videoStories.userId, users.id))
    .innerJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
    .where(
      and(
        eq(videoStories.userId, userId),
        isNotNull(videoStories.restaurantId),
        publicStoryPublicationWhere(sql`NOW()`),
        eq(users.isDisabled, false),
        eq(restaurants.isActive, true),
      ),
    );

  return rows.filter((row: any) => isPublicStoryAssociationEligible(row));
}

/**
 * Get authoritative recommendation count for a user based on video stories.
 * A recommendation credit is earned per distinct currently published,
 * public-authority restaurantId tagged by the user.
 */
export async function getUserRecommendationCount(userId: string): Promise<number> {
  const storyRecommendations = await getUserPublishedVideoRecommendations(userId);

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
  const storyRecommendations = await getUserPublishedVideoRecommendations(userId);

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
 *   + (favoritesCount * 180) + (followCount * 20)
 *   + (totalDealClaims * 10) + (totalDealViews * 1)
 */
export async function calculateRestaurantRankingScore(restaurantId: string): Promise<number> {
  // Get restaurant data
  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) return 0;
  const restaurantOwner = await storage.getUser(restaurant.ownerId);
  if (
    restaurant.isActive !== true ||
    restaurantOwner?.isDisabled !== false ||
    !isPublicBusinessVisible(restaurant) ||
    deriveProfileEvidenceQuarantineVisibility({
      ...restaurant,
      email: restaurantOwner.email,
    }).isQuarantined
  ) {
    return 0;
  }

  // Manual/button recommendations
  const manualRecommendations = await db.query.restaurantUserRecommendations.findMany({
    where: (rec: any) => eq(rec.restaurantId, restaurantId),
  });
  const manualRecommendationCount = manualRecommendations.length;

  // Video recommendations: stories tagged to the restaurant
  const videoRecommendations = await db
    .select({ id: videoStories.id })
    .from(videoStories)
    .innerJoin(users, eq(videoStories.userId, users.id))
    .where(
      and(
        eq(videoStories.restaurantId, restaurantId),
        publicStoryPublicationWhere(sql`NOW()`),
        eq(users.isDisabled, false),
      ),
    );
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

  // Get deal claims count
  const deals = await storage.getDealsByRestaurant(restaurantId);
  let totalDealClaims = 0;
  let totalDealViews = 0;

  const nowMs = Date.now();
  const currentPublicDeals = deals.filter((deal: any) => {
    if (deal?.isActive !== true) return false;
    const startsAt = deal.startDate ? new Date(deal.startDate).getTime() : null;
    const endsAt = deal.endDate ? new Date(deal.endDate).getTime() : null;
    return !(
      (startsAt !== null && (!Number.isFinite(startsAt) || startsAt > nowMs)) ||
      (endsAt !== null && (!Number.isFinite(endsAt) || endsAt < nowMs))
    );
  });

  for (const deal of currentPublicDeals) {
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
        join users story_creator on story_creator.id = vs.user_id
        where vs.restaurant_id = ${restaurantId}
          and vs.status = 'ready'
          and vs.is_approved = true
          and vs.deleted_at is null
          and vs.expires_at >= now()
          and story_creator.is_disabled = false), 0)::int as video_engagement
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
    totalDealClaims * AWARD_RANKING_WEIGHTS.totalDealClaims +
    totalDealViews * AWARD_RANKING_WEIGHTS.totalDealViews +
    communityActivityScore * AWARD_RANKING_WEIGHTS.communityActivity;

  return rankingScore;
}

/**
 * Calculate the same public award score for a bounded candidate set in one
 * database statement. Public leaderboard routes must not fan out into one
 * query bundle per restaurant.
 */
export async function calculateRestaurantRankingScores(
  restaurantIds: string[],
  database: Pick<typeof db, 'execute'> = db,
): Promise<Map<string, number>> {
  const normalizedIds = Array.from(
    new Set(restaurantIds.map((id) => String(id || '').trim()).filter(Boolean)),
  );
  if (normalizedIds.length === 0) return new Map();

  const candidateValues = sql.join(
    normalizedIds.map((id) => sql`(${id})`),
    sql`, `,
  );
  const result = await database.execute(sql<{
    restaurant_id: string;
    ranking_score: number | string | null;
  }>`
    with candidate_ids(restaurant_id) as (
      values ${candidateValues}
    ),
    manual_recommendations as (
      select rur.restaurant_id, count(*)::bigint as count
      from restaurant_user_recommendations rur
      join candidate_ids candidate on candidate.restaurant_id = rur.restaurant_id
      group by rur.restaurant_id
    ),
    published_videos as (
      select
        story.restaurant_id,
        count(*)::bigint as recommendation_count,
        coalesce(sum(
          coalesce(story.like_count, 0) +
          coalesce(story.comment_count, 0) +
          coalesce(story.share_count, 0)
        ), 0)::bigint as engagement_count
      from video_stories story
      join users creator on creator.id = story.user_id
      join candidate_ids candidate on candidate.restaurant_id = story.restaurant_id
      where story.status = 'ready'
        and story.is_approved = true
        and story.deleted_at is null
        and story.expires_at >= now()
        and creator.is_disabled = false
      group by story.restaurant_id
    ),
    favorite_counts as (
      select favorite.restaurant_id, count(*)::bigint as count
      from restaurant_favorites favorite
      join candidate_ids candidate on candidate.restaurant_id = favorite.restaurant_id
      group by favorite.restaurant_id
    ),
    follow_counts as (
      select follow_row.restaurant_id, count(*)::bigint as count
      from restaurant_follows follow_row
      join candidate_ids candidate on candidate.restaurant_id = follow_row.restaurant_id
      group by follow_row.restaurant_id
    ),
    dish_recommendations as (
      select recommendation.restaurant_id, count(*)::bigint as count
      from menu_item_recommendations recommendation
      join candidate_ids candidate on candidate.restaurant_id = recommendation.restaurant_id
      group by recommendation.restaurant_id
    ),
    current_deals as (
      select deal.id, deal.restaurant_id
      from deals deal
      join candidate_ids candidate on candidate.restaurant_id = deal.restaurant_id
      where deal.is_active = true
        and deal.start_date <= now()
        and (deal.end_date is null or deal.end_date >= now())
    ),
    deal_claim_counts as (
      select deal.restaurant_id, count(claim.id)::bigint as count
      from current_deals deal
      left join deal_claims claim on claim.deal_id = deal.id
      group by deal.restaurant_id
    ),
    deal_view_counts as (
      select deal.restaurant_id, count(view_row.id)::bigint as count
      from current_deals deal
      left join deal_views view_row on view_row.deal_id = deal.id
      group by deal.restaurant_id
    ),
    reaction_scores as (
      select
        recommendation.restaurant_id,
        coalesce(sum(
          case reaction.reaction_type
            when 'like' then 1
            when 'dislike' then -1
            else 0
          end
        ), 0)::bigint as score
      from recommendation_reactions reaction
      join restaurant_user_recommendations recommendation
        on recommendation.id = reaction.recommendation_id
      join candidate_ids candidate
        on candidate.restaurant_id = recommendation.restaurant_id
      group by recommendation.restaurant_id
    ),
    share_counts as (
      select recommendation.restaurant_id, count(*)::bigint as count
      from recommendation_shares share_row
      join restaurant_user_recommendations recommendation
        on recommendation.id = share_row.recommendation_id
      join candidate_ids candidate
        on candidate.restaurant_id = recommendation.restaurant_id
      group by recommendation.restaurant_id
    )
    select
      candidate.restaurant_id,
      (
        coalesce(manual.count, 0) * ${AWARD_RANKING_WEIGHTS.manualRecommendation} +
        coalesce(video.recommendation_count, 0) * ${AWARD_RANKING_WEIGHTS.videoRecommendation} +
        coalesce(dish.count, 0) * ${AWARD_RANKING_WEIGHTS.dishRecommendation} +
        coalesce(favorite.count, 0) * ${AWARD_RANKING_WEIGHTS.favorites} +
        coalesce(follow_row.count, 0) * ${AWARD_RANKING_WEIGHTS.follows} +
        coalesce(claim.count, 0) * ${AWARD_RANKING_WEIGHTS.totalDealClaims} +
        coalesce(view_row.count, 0) * ${AWARD_RANKING_WEIGHTS.totalDealViews} +
        (
          coalesce(reaction.score, 0) +
          coalesce(share_row.count, 0) +
          coalesce(video.engagement_count, 0)
        ) * ${AWARD_RANKING_WEIGHTS.communityActivity}
      )::double precision as ranking_score
    from candidate_ids candidate
    left join manual_recommendations manual using (restaurant_id)
    left join published_videos video using (restaurant_id)
    left join dish_recommendations dish using (restaurant_id)
    left join favorite_counts favorite using (restaurant_id)
    left join follow_counts follow_row using (restaurant_id)
    left join deal_claim_counts claim using (restaurant_id)
    left join deal_view_counts view_row using (restaurant_id)
    left join reaction_scores reaction using (restaurant_id)
    left join share_counts share_row using (restaurant_id)
  `);
  const rows = Array.isArray((result as any)?.rows)
    ? ((result as any).rows as Array<{
        restaurant_id: string;
        ranking_score: number | string | null;
      }>)
    : [];
  const scores = new Map<string, number>(
    normalizedIds.map((id) => [id, 0] as const),
  );
  for (const row of rows) {
    scores.set(String(row.restaurant_id), Number(row.ranking_score || 0));
  }
  return scores;
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
