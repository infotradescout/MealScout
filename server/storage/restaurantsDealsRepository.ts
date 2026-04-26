import {
  users,
  restaurants,
  businessStaffMemberships,
  deals,
  dealClaims,
  dealViews,
  dealFeedback,
  type Restaurant,
  type InsertRestaurant,
  type Deal,
  type InsertDeal,
} from "@shared/schema";
import { db } from "../db";
import {
  eq,
  and,
  isNotNull,
  desc,
  sql,
} from "drizzle-orm";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

type RestaurantsDealsRepositoryDependencies = {
  ensureCityExists: (name: string, state: string | null) => Promise<void>;
};

export function createRestaurantsDealsRepository(
  deps: RestaurantsDealsRepositoryDependencies,
) {
  const { ensureCityExists } = deps;
  const isMissingRelationError = (error: unknown, tableName: string) => {
    const code = String((error as any)?.code || "").toUpperCase();
    const message = String((error as any)?.message || "").toLowerCase();
    return (
      code === "42P01" &&
      (message.includes(`relation \"${tableName}\" does not exist`) ||
        message.includes(`relation '${tableName}' does not exist`) ||
        message.includes(`${tableName} does not exist`))
    );
  };

  const deleteDealWithRelations = async (
    id: string,
    relationTables: Array<"deal_claims" | "deal_views" | "deal_feedback">,
  ) => {
    await db.transaction(async (tx: any) => {
      if (relationTables.includes("deal_claims")) {
        await tx.delete(dealClaims).where(eq(dealClaims.dealId, id));
      }
      if (relationTables.includes("deal_views")) {
        await tx.delete(dealViews).where(eq(dealViews.dealId, id));
      }
      if (relationTables.includes("deal_feedback")) {
        await tx.delete(dealFeedback).where(eq(dealFeedback.dealId, id));
      }
      await tx.delete(deals).where(eq(deals.id, id));
    });
  };

  return {
    async createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant> {
      // NORTH STAR RULE: Apply pricing lock for restaurants (not trucks) created before April 1, 2026
      const now = new Date();
      const priceLockCutoff = new Date("2026-04-01");
      const isRestaurant = !restaurant.isFoodTruck;

      let restaurantData = { ...restaurant };

      if (isRestaurant && now < priceLockCutoff && !restaurant.lockedPriceCents) {
        restaurantData = {
          ...restaurantData,
          lockedPriceCents: 2500,
          priceLockDate: now,
          priceLockReason: "early_rollout",
        };
      }

      const [newRestaurant] = await db
        .insert(restaurants)
        .values(restaurantData)
        .returning();
      try {
        if ((newRestaurant as any).city) {
          await ensureCityExists(
            (newRestaurant as any).city,
            (newRestaurant as any).state || null,
          );
        }
      } catch (e) {
        console.warn("ensureCityExists failed for restaurant", e);
      }
      return newRestaurant;
    },

    async getRestaurant(id: string): Promise<Restaurant | undefined> {
      const [restaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, id));
      return restaurant;
    },

    async getRestaurantsByOwner(ownerId: string): Promise<Restaurant[]> {
      return await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.ownerId, ownerId));
    },

    async updateRestaurant(
      id: string,
      restaurant: Partial<InsertRestaurant>,
    ): Promise<Restaurant> {
      const [updated] = await db
        .update(restaurants)
        .set({
          ...restaurant,
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, id))
        .returning();
      return updated;
    },

    async getAllRestaurants(): Promise<Restaurant[]> {
      return await db.select().from(restaurants);
    },

    async getNearbyRestaurants(
      lat: number,
      lng: number,
      radiusKm: number,
    ): Promise<Restaurant[]> {
      const results = await db
        .select()
        .from(restaurants)
        .where(
          and(
            eq(restaurants.isActive, true),
            sql`
              (6371 * acos(
                cos(radians(${lat})) *
                cos(radians(${restaurants.latitude})) *
                cos(radians(${restaurants.longitude}) - radians(${lng})) +
                sin(radians(${lat})) *
                sin(radians(${restaurants.latitude}))
              )) <= ${radiusKm}
            `,
          ),
        );
      return results.filter((restaurant: any) =>
        isPublicBusinessVisible(restaurant),
      );
    },

    async getSubscribedRestaurants(
      lat: number,
      lng: number,
      radiusKm: number,
    ): Promise<Restaurant[]> {
      const results = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          address: restaurants.address,
          phone: restaurants.phone,
          businessType: restaurants.businessType,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          cuisineType: restaurants.cuisineType,
          promoCode: restaurants.promoCode,
          isActive: restaurants.isActive,
          isVerified: restaurants.isVerified,
          ownerId: restaurants.ownerId,
          createdAt: restaurants.createdAt,
          updatedAt: restaurants.updatedAt,
          isFoodTruck: restaurants.isFoodTruck,
          mobileOnline: restaurants.mobileOnline,
          currentLatitude: restaurants.currentLatitude,
          currentLongitude: restaurants.currentLongitude,
          lastBroadcastAt: restaurants.lastBroadcastAt,
          operatingHours: restaurants.operatingHours,
          subscriptionStatus: users.subscriptionBillingInterval,
        })
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.isActive, true),
            isNotNull(users.subscriptionBillingInterval),
            sql`
              (6371 * acos(
                cos(radians(${lat})) *
                cos(radians(${restaurants.latitude})) *
                cos(radians(${restaurants.longitude}) - radians(${lng})) +
                sin(radians(${lat})) *
                sin(radians(${restaurants.latitude}))
              )) <= ${radiusKm}
            `,
          ),
        );

      return results.map(
        ({ subscriptionStatus, ...restaurant }: any) => restaurant as Restaurant,
      );
    },

    async verifyRestaurantOwnership(
      restaurantId: string,
      userId: string,
      requiredPermission?:
        | "manageDeals"
        | "manageParkingPass"
        | "viewAnalytics"
        | "manageProfile",
    ): Promise<boolean> {
      const [restaurant] = await db
        .select({ ownerId: restaurants.ownerId })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (restaurant?.ownerId === userId) {
        return true;
      }
      if (!requiredPermission) {
        return false;
      }

      // Use a direct membership lookup for this restaurant to avoid pulling the
      // full access context, which can fail if unrelated legacy membership rows
      // contain malformed restaurant IDs.
      const [membership] = await db
        .select({ permissions: businessStaffMemberships.permissions })
        .from(businessStaffMemberships)
        .where(
          and(
            eq(businessStaffMemberships.restaurantId, restaurantId),
            eq(businessStaffMemberships.userId, userId),
            eq(businessStaffMemberships.status, "active"),
          ),
        )
        .limit(1);

      const permissions =
        membership?.permissions && typeof membership.permissions === "object"
          ? (membership.permissions as Record<string, any>)
          : {};
      return permissions[requiredPermission] === true;
    },

    async createDeal(deal: InsertDeal): Promise<Deal> {
      const [newDeal] = await db.insert(deals).values(deal).returning();
      return newDeal;
    },

    async getDeal(id: string): Promise<Deal | undefined> {
      const [deal] = await db.select().from(deals).where(eq(deals.id, id));
      return deal;
    },

    async getDealsByRestaurant(restaurantId: string): Promise<Deal[]> {
      return await db
        .select()
        .from(deals)
        .where(eq(deals.restaurantId, restaurantId))
        .orderBy(desc(deals.createdAt));
    },

    async updateDeal(id: string, updates: Partial<InsertDeal>): Promise<Deal> {
      const [updated] = await db
        .update(deals)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, id))
        .returning();
      return updated;
    },

    async deleteDeal(id: string): Promise<void> {
      const relationTables: Array<"deal_claims" | "deal_views" | "deal_feedback"> = [
        "deal_claims",
        "deal_views",
        "deal_feedback",
      ];
      try {
        await deleteDealWithRelations(id, relationTables);
      } catch (error) {
        // Some environments may lag schema migrations. Retry without missing
        // child tables so deal deletion still works.
        const filteredRelations = relationTables.filter(
          (tableName) => !isMissingRelationError(error, tableName),
        );
        if (filteredRelations.length === relationTables.length) {
          throw error;
        }
        await deleteDealWithRelations(id, filteredRelations);
      }
    },

    async duplicateDeal(id: string): Promise<Deal> {
      const [originalDeal] = await db.select().from(deals).where(eq(deals.id, id));
      if (!originalDeal) {
        throw new Error("Deal not found");
      }

      const {
        id: _,
        createdAt: __,
        updatedAt: ___,
        currentUses: ____,
        ...dealData
      } = originalDeal;

      const [clonedDeal] = await db
        .insert(deals)
        .values({
          ...dealData,
          title: `${dealData.title} (Copy)`,
          currentUses: 0,
          isActive: false,
        })
        .returning();

      return clonedDeal;
    },

    async getAllDeals(): Promise<Deal[]> {
      return await db.select().from(deals);
    },
  };
}
