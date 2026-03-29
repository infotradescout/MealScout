import type { Express } from "express";
import { and, desc, eq, like } from "drizzle-orm";

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
} from "../awardCalculations";
import { awardHistory, restaurants, users } from "@shared/schema";

export function registerAwardsRoutes(app: Express) {
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

      res.json({
        userId: user.id,
        hasGoldenFork: user.hasGoldenFork,
        goldenForkEarnedAt: user.goldenForkEarnedAt,
        reviewCount: user.reviewCount || 0,
        recommendationCount,
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
