import {
  reviews,
  dealFeedback,
  users,
  type Review,
  type InsertReview,
  type DealFeedback,
  type InsertDealFeedback,
} from "@shared/schema";
import { db } from "../db";
import { desc, eq, sql } from "drizzle-orm";
import { isCriticAccount } from "../utils/criticSettings";

export function createDealFeedbackRepository() {
  return {
    // Review operations
    async createReview(review: InsertReview): Promise<Review> {
      const [newReview] = await db.insert(reviews).values(review).returning();
      return newReview;
    },

    async getRestaurantReviews(restaurantId: string): Promise<any[]> {
      return await db
        .select({
          id: reviews.id,
          restaurantId: reviews.restaurantId,
          userId: reviews.userId,
          rating: reviews.rating,
          ratingScore100: reviews.ratingScore100,
          menuItemName: reviews.menuItemName,
          reviewText: reviews.comment,
          createdAt: reviews.createdAt,
          updatedAt: reviews.updatedAt,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            profileImageUrl: users.profileImageUrl,
            accountSettings: users.accountSettings,
            hasGoldenFork: users.hasGoldenFork,
            influenceScore: users.influenceScore,
          },
        })
        .from(reviews)
        .leftJoin(users, eq(reviews.userId, users.id))
        .where(eq(reviews.restaurantId, restaurantId))
        .orderBy(desc(reviews.createdAt));
    },

    async getRestaurantAverageRating(restaurantId: string): Promise<number> {
      const [result] = await db
        .select({ avg: sql<number>`avg(${reviews.rating})` })
        .from(reviews)
        .where(eq(reviews.restaurantId, restaurantId));

      return result.avg || 0;
    },

    // Deal feedback operations
    async createDealFeedback(
      feedback: InsertDealFeedback,
    ): Promise<DealFeedback> {
      const [createdFeedback] = await db
        .insert(dealFeedback)
        .values(feedback)
        .returning();
      return createdFeedback;
    },

    async getDealFeedback(dealId: string): Promise<DealFeedback[]> {
      return await db
        .select()
        .from(dealFeedback)
        .where(eq(dealFeedback.dealId, dealId))
        .orderBy(desc(dealFeedback.createdAt));
    },

    async getUserDealFeedback(userId: string): Promise<DealFeedback[]> {
      return await db
        .select()
        .from(dealFeedback)
        .where(eq(dealFeedback.userId, userId))
        .orderBy(desc(dealFeedback.createdAt));
    },

    async getDealAverageRating(dealId: string): Promise<number> {
      const result = await db
        .select({
          avgRating: sql<number>`AVG(${dealFeedback.rating})`,
        })
        .from(dealFeedback)
        .where(eq(dealFeedback.dealId, dealId));

      return result[0]?.avgRating || 0;
    },

    async getDealFeedbackStats(dealId: string): Promise<{
      averageRating: number;
      totalFeedback: number;
      ratingDistribution: { [key: number]: number };
      criticWeightedAverageRating: number;
      criticFeedbackCount: number;
      criticWeightApplied: boolean;
    }> {
      const feedback = await db
        .select({
          id: dealFeedback.id,
          rating: dealFeedback.rating,
          user: {
            accountSettings: users.accountSettings,
          },
        })
        .from(dealFeedback)
        .leftJoin(users, eq(dealFeedback.userId, users.id))
        .where(eq(dealFeedback.dealId, dealId));

      const totalFeedback = feedback.length;
      const averageRating =
        totalFeedback > 0
          ? feedback.reduce((sum: number, f: any) => sum + f.rating, 0) /
            totalFeedback
          : 0;

      const ratingDistribution: { [key: number]: number } = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      };

      feedback.forEach((f: any) => {
        if (f.rating >= 1 && f.rating <= 5) {
          ratingDistribution[f.rating] =
            (ratingDistribution[f.rating] || 0) + 1;
        }
      });

      const weighted = feedback.reduce(
        (
          acc: {
            ratingSum: number;
            weightSum: number;
            criticFeedbackCount: number;
          },
          f: any,
        ) => {
          const isCritic = isCriticAccount(f.user);
          const weight = isCritic ? 2 : 1;
          if (isCritic) {
            acc.criticFeedbackCount += 1;
          }
          acc.ratingSum += f.rating * weight;
          acc.weightSum += weight;
          return acc;
        },
        { ratingSum: 0, weightSum: 0, criticFeedbackCount: 0 },
      );
      const criticWeightedAverageRating =
        weighted.weightSum > 0 ? weighted.ratingSum / weighted.weightSum : 0;

      return {
        averageRating: Math.round(averageRating * 10) / 10,
        totalFeedback,
        ratingDistribution,
        criticWeightedAverageRating:
          Math.round(criticWeightedAverageRating * 10) / 10,
        criticFeedbackCount: weighted.criticFeedbackCount,
        criticWeightApplied: weighted.criticFeedbackCount > 0,
      };
    },
  };
}
