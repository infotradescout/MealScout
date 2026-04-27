import type { Express } from "express";
import { and, desc, eq, like, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { isAdmin, isAuthenticated } from "../unifiedAuth";
import {
  awardGoldenFork,
  awardGoldenPlatesForArea,
  calculateRestaurantRankingScore,
  calculateUserInfluenceScore,
  checkGoldenForkEligibility,
  getAreaLeaderboard,
  getUserRecommendationCount,
  getUserWeightedRecommendationScore,
} from "../awardCalculations";
import {
  awardHistory,
  restaurants,
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  users,
  videoStories,
} from "@shared/schema";

const SCOUT_SCORE_ACTION_POINTS = {
  recommendRestaurant: 40,
  postVideoRecommendation: 100,
  addFavorite: 10,
  followRestaurant: 15,
  writeReview: 20,
  addRecommendationContext: 5,
} as const;

const WEEKLY_RECOMMENDATION_QUEST = {
  id: "weekly_recommendation_sprint",
  title: "Weekly Recommendation Sprint",
  description: "Recommend 3 spots this week to unlock a bonus.",
  target: 3,
  rewardPoints: 60,
} as const;

const SCOUT_LEVELS = [
  { level: 1, label: "Scout", minScore: 0 },
  { level: 2, label: "Neighborhood Regular", minScore: 120 },
  { level: 3, label: "Flavor Hunter", minScore: 280 },
  { level: 4, label: "Scene Curator", minScore: 520 },
  { level: 5, label: "City Tastemaker", minScore: 900 },
  { level: 6, label: "MealScout Legend", minScore: 1450 },
] as const;

const getIsoWeekKey = (value: Date) => {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${week}`;
};

const getConsecutiveWeeklyStreak = (dates: Date[]) => {
  if (!dates.length) return 0;

  const uniqueWeeks = new Set(dates.map((entry) => getIsoWeekKey(entry)));
  let cursor = new Date();
  let streak = 0;

  for (let guard = 0; guard < 104; guard += 1) {
    const key = getIsoWeekKey(cursor);
    if (!uniqueWeeks.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  return streak;
};

const getCurrentWeekRecommendationCount = (dates: Date[]) => {
  if (!dates.length) return 0;
  const currentWeek = getIsoWeekKey(new Date());
  return dates.reduce(
    (count, value) => (getIsoWeekKey(value) === currentWeek ? count + 1 : count),
    0,
  );
};

const getScoutLevel = (score: number) => {
  const current =
    [...SCOUT_LEVELS].reverse().find((entry) => score >= entry.minScore) ||
    SCOUT_LEVELS[0];
  const next = SCOUT_LEVELS.find((entry) => entry.minScore > current.minScore);

  return {
    current,
    next,
    progressToNext: next
      ? Math.max(
          0,
          Math.min(
            1,
            (score - current.minScore) / Math.max(1, next.minScore - current.minScore),
          ),
        )
      : 1,
  };
};

export function registerAwardsRoutes(app: Express) {
  app.get("/api/awards/journey/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = String(req.user?.id || "").trim();
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const [
        influenceScore,
        recommendationCount,
        weightedRecommendationScore,
        manualRecommendationRows,
        videoRecommendationRows,
        favoriteRows,
        followRows,
      ] = await Promise.all([
        calculateUserInfluenceScore(userId),
        getUserRecommendationCount(userId),
        getUserWeightedRecommendationScore(userId),
        db
          .select({ recommendedAt: restaurantUserRecommendations.recommendedAt })
          .from(restaurantUserRecommendations)
          .where(eq(restaurantUserRecommendations.userId, userId)),
        db
          .select({ createdAt: videoStories.createdAt })
          .from(videoStories)
          .where(
            and(eq(videoStories.userId, userId), isNotNull(videoStories.restaurantId)),
          ),
        db
          .select({ id: restaurantFavorites.id })
          .from(restaurantFavorites)
          .where(eq(restaurantFavorites.userId, userId)),
        db
          .select({ id: restaurantFollows.id })
          .from(restaurantFollows)
          .where(eq(restaurantFollows.userId, userId)),
      ]);

      const reviewCount = Number(user.reviewCount || 0);
      const favoritesCount = favoriteRows.length;
      const followsCount = followRows.length;
      const manualRecommendationsCount = manualRecommendationRows.length;
      const videoRecommendationsCount = videoRecommendationRows.length;

      const scoreBreakdown = {
        recommendations:
          manualRecommendationsCount * SCOUT_SCORE_ACTION_POINTS.recommendRestaurant,
        videoRecommendations:
          videoRecommendationsCount * SCOUT_SCORE_ACTION_POINTS.postVideoRecommendation,
        favorites: favoritesCount * SCOUT_SCORE_ACTION_POINTS.addFavorite,
        follows: followsCount * SCOUT_SCORE_ACTION_POINTS.followRestaurant,
        reviews: reviewCount * SCOUT_SCORE_ACTION_POINTS.writeReview,
      };

      const scoutScore = Object.values(scoreBreakdown).reduce(
        (total, value) => total + Number(value || 0),
        0,
      );

      const recommendationDates = [
        ...manualRecommendationRows
          .map((row: { recommendedAt: Date | null }) =>
            row.recommendedAt ? new Date(row.recommendedAt) : null,
          )
          .filter((row: Date | null): row is Date => Boolean(row)),
        ...videoRecommendationRows
          .map((row: { createdAt: Date | null }) =>
            row.createdAt ? new Date(row.createdAt) : null,
          )
          .filter((row: Date | null): row is Date => Boolean(row)),
      ];
      const weeklyRecommendationStreak = getConsecutiveWeeklyStreak(recommendationDates);
      const currentWeekRecommendations = getCurrentWeekRecommendationCount(
        recommendationDates,
      );

      const weeklyQuestCompleted =
        currentWeekRecommendations >= WEEKLY_RECOMMENDATION_QUEST.target;
      const weeklyQuestRemaining = Math.max(
        0,
        WEEKLY_RECOMMENDATION_QUEST.target - currentWeekRecommendations,
      );
      const weeklyQuestProgress = Math.max(
        0,
        Math.min(1, currentWeekRecommendations / WEEKLY_RECOMMENDATION_QUEST.target),
      );

      const level = getScoutLevel(scoutScore);

      const targetRecommendationMilestone = 3;
      const targetVideoMilestone = 1;
      const targetReviewMilestone = 2;

      const milestoneProgress = {
        recommendations: {
          current: manualRecommendationsCount,
          target: targetRecommendationMilestone,
          completed: manualRecommendationsCount >= targetRecommendationMilestone,
        },
        videoRecommendations: {
          current: videoRecommendationsCount,
          target: targetVideoMilestone,
          completed: videoRecommendationsCount >= targetVideoMilestone,
        },
        reviews: {
          current: reviewCount,
          target: targetReviewMilestone,
          completed: reviewCount >= targetReviewMilestone,
        },
      };

      res.json({
        userId,
        influenceScore,
        recommendationCount,
        weightedRecommendationScore,
        hasGoldenFork: Boolean(user.hasGoldenFork),
        scoutScore,
        scoreBreakdown,
        level: {
          current: level.current,
          next: level.next || null,
          progressToNext: level.progressToNext,
          pointsToNext: level.next ? Math.max(0, level.next.minScore - scoutScore) : 0,
        },
        weeklyRecommendationStreak,
        milestoneProgress,
        activeQuest: {
          ...WEEKLY_RECOMMENDATION_QUEST,
          current: currentWeekRecommendations,
          remaining: weeklyQuestRemaining,
          completed: weeklyQuestCompleted,
          progress: weeklyQuestProgress,
          rewardCreditPreviewDollars: Number(
            (
              WEEKLY_RECOMMENDATION_QUEST.rewardPoints /
              100
            ).toFixed(2),
          ),
        },
        futureCreditPreview: {
          // Backward-compatible placeholder mapping for future rewards conversion.
          pointsPerDollar: 100,
          estimatedCreditDollars: Number((scoutScore / 100).toFixed(2)),
          note: "Preview only - MealScout credit redemption rules can be attached later.",
        },
        actionPoints: SCOUT_SCORE_ACTION_POINTS,
      });
    } catch (error) {
      console.error("Error fetching user journey stats:", error);
      res.status(500).json({ message: "Failed to fetch user journey stats" });
    }
  });

  app.get(
    "/api/awards/golden-fork/eligibility",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const eligibility = await checkGoldenForkEligibility(req.user.id);
        res.json(eligibility);
      } catch (error) {
        console.error("Error checking Golden Fork eligibility:", error);
        res.status(500).json({ message: "Failed to check eligibility" });
      }
    },
  );

  app.post(
    "/api/awards/golden-fork/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const awarded = await awardGoldenFork(req.user.id);
        if (!awarded) {
          return res
            .status(400)
            .json({ message: "Not eligible for Golden Fork", awarded: false });
        }

        res.json({ message: "Golden Fork awarded!", awarded: true });
      } catch (error) {
        console.error("Error claiming Golden Fork:", error);
        res.status(500).json({ message: "Failed to claim award" });
      }
    },
  );

  app.get("/api/awards/golden-fork/holders", async (_req, res) => {
    try {
      const holders = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          influenceScore: users.influenceScore,
          reviewCount: users.reviewCount,
          goldenForkEarnedAt: users.goldenForkEarnedAt,
        })
        .from(users)
        .where(eq(users.hasGoldenFork, true));

      const holdersWithRecommendations = await Promise.all(
        holders.map(async (holder: (typeof holders)[number]) => ({
          ...holder,
          recommendationCount: await getUserRecommendationCount(holder.id),
          weightedRecommendationScore: await getUserWeightedRecommendationScore(
            holder.id,
          ),
        })),
      );

      res.json(holdersWithRecommendations);
    } catch (error) {
      console.error("Error fetching Golden Fork holders:", error);
      res.status(500).json({ message: "Failed to fetch holders" });
    }
  });

  app.get("/api/user/:userId/influence-stats", async (req, res) => {
    try {
      const userId = req.params.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const influenceScore = await calculateUserInfluenceScore(userId);
      const recommendationCount = await getUserRecommendationCount(userId);
      const weightedRecommendationScore =
        await getUserWeightedRecommendationScore(userId);

      res.json({
        userId: user.id,
        hasGoldenFork: user.hasGoldenFork,
        goldenForkEarnedAt: user.goldenForkEarnedAt,
        reviewCount: user.reviewCount || 0,
        recommendationCount,
        weightedRecommendationScore,
        influenceScore,
      });
    } catch (error) {
      console.error("Error fetching influence stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/awards/golden-plate/winners", async (_req, res) => {
    try {
      const winners = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.hasGoldenPlate, true));
      res.json(winners);
    } catch (error) {
      console.error("Error fetching Golden Plate winners:", error);
      res.status(500).json({ message: "Failed to fetch winners" });
    }
  });

  app.get("/api/awards/golden-plate/winners/:area", async (req, res) => {
    try {
      const winners = await db
        .select()
        .from(restaurants)
        .where(
          and(
            eq(restaurants.hasGoldenPlate, true),
            like(restaurants.address, `%${req.params.area}%`),
          ),
        );
      res.json(winners);
    } catch (error) {
      console.error("Error fetching area Golden Plate winners:", error);
      res.status(500).json({ message: "Failed to fetch winners" });
    }
  });

  app.get("/api/awards/golden-plate/leaderboard/:area", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const leaderboard = await getAreaLeaderboard(req.params.area, limit);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get("/api/restaurants/:restaurantId/ranking-stats", async (req, res) => {
    try {
      const restaurant = await storage.getRestaurant(req.params.restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const rankingScore = await calculateRestaurantRankingScore(
        req.params.restaurantId,
      );
      res.json({
        restaurantId: restaurant.id,
        hasGoldenPlate: restaurant.hasGoldenPlate,
        goldenPlateCount: restaurant.goldenPlateCount || 0,
        goldenPlateEarnedAt: restaurant.goldenPlateEarnedAt,
        rankingScore,
      });
    } catch (error) {
      console.error("Error fetching ranking stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.post(
    "/api/admin/awards/golden-plate/:area",
    isAdmin,
    async (req: any, res) => {
      try {
        const awardedCount = await awardGoldenPlatesForArea(req.params.area);
        res.json({
          message: `Awarded Golden Plates to ${awardedCount} restaurants in ${req.params.area}`,
          awardedCount,
        });
      } catch (error) {
        console.error("Error awarding Golden Plates:", error);
        res.status(500).json({ message: "Failed to award Golden Plates" });
      }
    },
  );

  app.get("/api/awards/history", async (req, res) => {
    try {
      const query = await db
        .select()
        .from(awardHistory)
        .orderBy(desc(awardHistory.awardedAt))
        .limit(100);

      res.json(query);
    } catch (error) {
      console.error("Error fetching award history:", error);
      res.status(500).json({ message: "Failed to fetch award history" });
    }
  });
}
