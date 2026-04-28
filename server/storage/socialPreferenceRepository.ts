import {
  restaurants,
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  type Restaurant,
  type RestaurantFavorite,
  type RestaurantFollow,
  type RestaurantUserRecommendation,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";

export function createSocialPreferenceRepository() {
  return {
    async createRestaurantFavorite(favorite: {
      restaurantId: string;
      userId: string;
    }): Promise<RestaurantFavorite> {
      const [result] = await db
        .insert(restaurantFavorites)
        .values(favorite)
        .returning();
      return result;
    },

    async removeRestaurantFavorite(
      restaurantId: string,
      userId: string,
    ): Promise<void> {
      await db
        .delete(restaurantFavorites)
        .where(
          and(
            eq(restaurantFavorites.restaurantId, restaurantId),
            eq(restaurantFavorites.userId, userId),
          ),
        );
    },

    async getUserRestaurantFavorites(
      userId: string,
    ): Promise<(RestaurantFavorite & { restaurant: Restaurant })[]> {
      const result = await db
        .select({
          id: restaurantFavorites.id,
          restaurantId: restaurantFavorites.restaurantId,
          userId: restaurantFavorites.userId,
          favoritedAt: restaurantFavorites.favoritedAt,
          createdAt: restaurantFavorites.createdAt,
          restaurant: restaurants,
        })
        .from(restaurantFavorites)
        .innerJoin(
          restaurants,
          eq(restaurantFavorites.restaurantId, restaurants.id),
        )
        .where(eq(restaurantFavorites.userId, userId))
        .orderBy(desc(restaurantFavorites.favoritedAt));

      return result;
    },

    async getUserRestaurantFavoritesCount(userId: string): Promise<number> {
      const result = await db
        .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(restaurantFavorites)
        .where(eq(restaurantFavorites.userId, userId));
      return result[0]?.count ?? 0;
    },

    async createRestaurantFollow(follow: {
      restaurantId: string;
      userId: string;
    }): Promise<RestaurantFollow> {
      const [result] = await db
        .insert(restaurantFollows)
        .values(follow)
        .returning();
      return result;
    },

    async removeRestaurantFollow(
      restaurantId: string,
      userId: string,
    ): Promise<void> {
      await db
        .delete(restaurantFollows)
        .where(
          and(
            eq(restaurantFollows.restaurantId, restaurantId),
            eq(restaurantFollows.userId, userId),
          ),
        );
    },

    async getUserRestaurantFollows(
      userId: string,
    ): Promise<(RestaurantFollow & { restaurant: Restaurant })[]> {
      const result = await db
        .select({
          id: restaurantFollows.id,
          restaurantId: restaurantFollows.restaurantId,
          userId: restaurantFollows.userId,
          followedAt: restaurantFollows.followedAt,
          createdAt: restaurantFollows.createdAt,
          restaurant: restaurants,
        })
        .from(restaurantFollows)
        .innerJoin(
          restaurants,
          eq(restaurantFollows.restaurantId, restaurants.id),
        )
        .where(eq(restaurantFollows.userId, userId))
        .orderBy(desc(restaurantFollows.followedAt));

      return result;
    },

    async createRestaurantUserRecommendation(recommendation: {
      restaurantId: string;
      userId: string;
      sentimentScore100?: number;
      menuItemName?: string;
    }): Promise<RestaurantUserRecommendation> {
      const [result] = await db
        .insert(restaurantUserRecommendations)
        .values(recommendation)
        .returning();
      return result;
    },

    async getUserRestaurantRecommendations(
      userId: string,
    ): Promise<(RestaurantUserRecommendation & { restaurant: Restaurant })[]> {
      const result = await db
        .select({
          id: restaurantUserRecommendations.id,
          restaurantId: restaurantUserRecommendations.restaurantId,
          userId: restaurantUserRecommendations.userId,
          sentimentScore100: restaurantUserRecommendations.sentimentScore100,
          menuItemName: restaurantUserRecommendations.menuItemName,
          recommendedAt: restaurantUserRecommendations.recommendedAt,
          createdAt: restaurantUserRecommendations.createdAt,
          updatedAt: restaurantUserRecommendations.updatedAt,
          restaurant: restaurants,
        })
        .from(restaurantUserRecommendations)
        .innerJoin(
          restaurants,
          eq(restaurantUserRecommendations.restaurantId, restaurants.id),
        )
        .where(eq(restaurantUserRecommendations.userId, userId))
        .orderBy(desc(restaurantUserRecommendations.recommendedAt));

      return result;
    },
  };
}
