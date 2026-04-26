import type Stripe from "stripe";
import { storage } from "../storage";
import { db } from "../db";
import type { User } from "@shared/schema";
import { restaurants, restaurantSubscriptions, users } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  ensurePremiumTrialForUser,
  isPremiumTrialActive,
} from "../services/premiumTrial";

export type RouteAccessPolicyDependencies = {
  ensureTrialForUser: typeof ensurePremiumTrialForUser;
  isTrialActive: typeof isPremiumTrialActive;
  getLockedPriceForUser: (userId: string) => Promise<{
    locked: boolean;
    priceId: string;
    label: string;
  }>;
  validateAnalyticsAccess: (userId: string) => Promise<{
    hasAccess: boolean;
    error?: string;
    subscriptionTier?: string;
  }>;
  validateSubscriptionLimits: (
    userId: string,
    excludeDealId?: string,
  ) => Promise<{
    isValid: boolean;
    error?: string;
    currentCount?: number;
    maxDeals?: number;
  }>;
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
  getBusinessDistributionAccessByOwnerIds: (
    userIds: string[],
  ) => Promise<Map<string, boolean>>;
  filterDealsByBusinessAccess: <T extends { restaurantId?: string | null }>(
    dealRows: T[],
  ) => Promise<T[]>;
};

export function createRouteAccessPolicyDependencies(
  stripe: Stripe | null,
): RouteAccessPolicyDependencies {
  const isTrialActive = isPremiumTrialActive;
  const ensureTrialForUser = ensurePremiumTrialForUser;

  const BUSINESS_FEATURE_TRIAL_DAYS = 30;
  const BUSINESS_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
  const businessAccessCache = new Map<
    string,
    { hasAccess: boolean; expiresAt: number }
  >();

  const hasStaffOrAdminBypass = (user: User | null | undefined) =>
    ["staff", "admin", "super_admin"].includes(
      String(user?.userType || "").toLowerCase(),
    );

  async function getLockedPriceForUser(_userId: string): Promise<{
    locked: boolean;
    priceId: string;
    label: string;
  }> {
    const price25 = process.env.PRICE_MONTHLY_25;
    if (!price25) {
      throw new Error("Stripe Price IDs not configured (PRICE_MONTHLY_25)");
    }

    const locked = true;
    const priceId = price25;
    const label = "$25 (was $50)";
    return { locked, priceId, label };
  }

  async function hasLifetimeRestaurantAccess(userId: string): Promise<boolean> {
    const ownerId = String(userId || "").trim();
    if (!ownerId) return false;
    try {
      const rows = await db
        .select({ id: restaurantSubscriptions.id })
        .from(restaurantSubscriptions)
        .innerJoin(
          restaurants,
          eq(restaurantSubscriptions.restaurantId, restaurants.id),
        )
        .where(
          and(
            eq(restaurants.ownerId, ownerId),
            eq(restaurantSubscriptions.isLifetimeFree, true),
            eq(restaurantSubscriptions.canPostDeals, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    } catch (error) {
      console.warn("[subscription] Failed lifetime access lookup", {
        userId: ownerId,
        error: (error as any)?.message || error,
      });
      return false;
    }
  }

  async function hasDealPostingEntitlement(userId: string): Promise<boolean> {
    const ownerId = String(userId || "").trim();
    if (!ownerId) return false;
    try {
      const rows = await db
        .select({ id: restaurantSubscriptions.id })
        .from(restaurantSubscriptions)
        .innerJoin(
          restaurants,
          eq(restaurantSubscriptions.restaurantId, restaurants.id),
        )
        .where(
          and(
            eq(restaurants.ownerId, ownerId),
            eq(restaurantSubscriptions.canPostDeals, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    } catch (error) {
      console.warn("[subscription] Failed deal posting entitlement lookup", {
        userId: ownerId,
        error: (error as any)?.message || error,
      });
      return false;
    }
  }

  function hasAccountAgeTrialAccess(user: User | null): boolean {
    if (!user?.createdAt) return false;
    const createdAtMs = new Date(user.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) return false;
    const trialEndsAtMs =
      createdAtMs + BUSINESS_FEATURE_TRIAL_DAYS * 24 * 60 * 60 * 1000;
    return trialEndsAtMs > Date.now();
  }

  async function validateAnalyticsAccess(userId: string): Promise<{
    hasAccess: boolean;
    error?: string;
    subscriptionTier?: string;
  }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return { hasAccess: false, error: "User not found" };
      }

      const hydratedUser = await ensureTrialForUser(user);

      if (hasStaffOrAdminBypass(hydratedUser)) {
        return { hasAccess: true, subscriptionTier: "staff-admin-bypass" };
      }

      if (isTrialActive(hydratedUser)) {
        return { hasAccess: true, subscriptionTier: "trial" };
      }

      if (await hasLifetimeRestaurantAccess(userId)) {
        return { hasAccess: true, subscriptionTier: "lifetime" };
      }

      if (!stripe || !hydratedUser.stripeSubscriptionId) {
        return {
          hasAccess: false,
          error:
            "Premium subscription required to access analytics. Please upgrade your plan.",
          subscriptionTier: "free",
        };
      }

      const subscription = await stripe.subscriptions.retrieve(
        hydratedUser.stripeSubscriptionId,
      );
      if (!subscription || subscription.status !== "active") {
        return {
          hasAccess: false,
          error:
            "Your subscription is not active. Please check your payment method and try again.",
          subscriptionTier: "inactive",
        };
      }

      return {
        hasAccess: true,
        subscriptionTier: "monthly",
      };
    } catch (error) {
      console.error("Analytics access validation error:", error);
      return {
        hasAccess: false,
        error: "Unable to verify subscription status. Please try again.",
        subscriptionTier: "error",
      };
    }
  }

  async function validateSubscriptionLimits(
    userId: string,
    excludeDealId?: string,
  ): Promise<{
    isValid: boolean;
    error?: string;
    currentCount?: number;
    maxDeals?: number;
  }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return { isValid: false, error: "User not found" };
      }

      const hydratedUser = await ensureTrialForUser(user);

      console.log("🔍 validateSubscriptionLimits - User ID:", userId);

      if (hasStaffOrAdminBypass(hydratedUser)) {
        return { isValid: true, currentCount: 0, maxDeals: 999 };
      }

      if (isTrialActive(hydratedUser)) {
        return { isValid: true, currentCount: 0, maxDeals: 999 };
      }

      if (await hasLifetimeRestaurantAccess(userId)) {
        return { isValid: true, currentCount: 0, maxDeals: 999 };
      }

      if (hasAccountAgeTrialAccess(hydratedUser)) {
        return { isValid: true, currentCount: 0, maxDeals: 999 };
      }

      if (await hasDealPostingEntitlement(userId)) {
        return { isValid: true, currentCount: 0, maxDeals: 999 };
      }

      if (!stripe) {
        return {
          isValid: false,
          error:
            "Active subscription required to create deals. Please upgrade your plan.",
          currentCount: 0,
          maxDeals: 0,
        };
      }

      const subscriptionId =
        hydratedUser.stripeSubscriptionId || hydratedUser.stripeCustomerId;

      if (!subscriptionId) {
        return {
          isValid: false,
          error:
            "Active subscription required to create deals. Please upgrade your plan.",
          currentCount: 0,
          maxDeals: 0,
        };
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!subscription || subscription.status !== "active") {
        return {
          isValid: false,
          error:
            "Your subscription is not active. Please check your payment method and try again.",
          currentCount: 0,
          maxDeals: 0,
        };
      }

      const ownedRestaurants = await storage.getRestaurantsByOwner(userId);
      let activeDealsCount = 0;

      for (const restaurant of ownedRestaurants) {
        const deals = await storage.getDealsByRestaurant(restaurant.id);
        const activeDeals = deals.filter(
          (d) => d.isActive && (!excludeDealId || d.id !== excludeDealId),
        );
        activeDealsCount += activeDeals.length;
      }

      const maxDeals = 999;

      return {
        isValid: true,
        currentCount: activeDealsCount,
        maxDeals,
      };
    } catch (error) {
      console.error("Subscription validation error:", error);
      return {
        isValid: false,
        error: "Unable to verify subscription status. Please try again.",
        currentCount: 0,
        maxDeals: 0,
      };
    }
  }

  async function hasBusinessDistributionAccess(userId: string): Promise<boolean> {
    const key = String(userId || "");
    if (!key) return false;

    const now = Date.now();
    const cached = businessAccessCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.hasAccess;
    }

    let hasAccess = false;
    try {
      const user = await storage.getUser(key);
      if (user) {
        if (hasStaffOrAdminBypass(user)) {
          hasAccess = true;
        } else if (hasAccountAgeTrialAccess(user)) {
          hasAccess = true;
        } else if (await hasLifetimeRestaurantAccess(key)) {
          hasAccess = true;
        } else if (stripe && user.stripeSubscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(
              user.stripeSubscriptionId,
            );
            hasAccess = ["active", "trialing"].includes(
              String(subscription?.status || ""),
            );
          } catch (subscriptionError) {
            console.warn(
              "[subscription] Unable to verify subscription for visibility",
              {
                userId: key,
                error: (subscriptionError as any)?.message || subscriptionError,
              },
            );
            hasAccess = false;
          }
        }
      }
    } catch (error) {
      console.warn("[subscription] Failed to compute business access", {
        userId: key,
        error: (error as any)?.message || error,
      });
      hasAccess = false;
    }

    businessAccessCache.set(key, {
      hasAccess,
      expiresAt: now + BUSINESS_ACCESS_CACHE_TTL_MS,
    });
    return hasAccess;
  }

  async function getBusinessDistributionAccessByOwnerIds(
    userIds: string[],
  ): Promise<Map<string, boolean>> {
    const uniqueIds = Array.from(
      new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)),
    );
    const result = new Map<string, boolean>();
    if (uniqueIds.length === 0) return result;

    const now = Date.now();
    const missingIds: string[] = [];
    for (const userId of uniqueIds) {
      const cached = businessAccessCache.get(userId);
      if (cached && cached.expiresAt > now) {
        result.set(userId, cached.hasAccess);
      } else {
        missingIds.push(userId);
      }
    }
    if (missingIds.length === 0) return result;

    try {
      const [userRows, lifetimeRows] = await Promise.all([
        db
          .select({
            id: users.id,
            userType: users.userType,
            createdAt: users.createdAt,
            stripeSubscriptionId: users.stripeSubscriptionId,
          })
          .from(users)
          .where(inArray(users.id, missingIds)),
        db
          .select({ ownerId: restaurants.ownerId })
          .from(restaurantSubscriptions)
          .innerJoin(
            restaurants,
            eq(restaurantSubscriptions.restaurantId, restaurants.id),
          )
          .where(
            and(
              inArray(restaurants.ownerId, missingIds),
              eq(restaurantSubscriptions.isLifetimeFree, true),
              eq(restaurantSubscriptions.status, "active"),
            ),
          ),
      ]);

      const lifetimeOwnerIds = new Set(
        lifetimeRows
          .map((row: any) => String(row.ownerId || "").trim())
          .filter(Boolean),
      );
      const usersById = new Map<string, User>();
      for (const row of userRows as User[]) {
        if (row?.id) usersById.set(String(row.id), row);
      }

      await Promise.all(
        missingIds.map(async (userId) => {
          const user = usersById.get(userId) || null;
          let hasAccess = false;
          if (user) {
            if (hasStaffOrAdminBypass(user)) {
              hasAccess = true;
            } else if (hasAccountAgeTrialAccess(user)) {
              hasAccess = true;
            } else if (lifetimeOwnerIds.has(userId)) {
              hasAccess = true;
            } else if (stripe && user.stripeSubscriptionId) {
              try {
                const subscription = await stripe.subscriptions.retrieve(
                  user.stripeSubscriptionId,
                );
                hasAccess = ["active", "trialing"].includes(
                  String(subscription?.status || ""),
                );
              } catch (subscriptionError) {
                console.warn(
                  "[subscription] Unable to verify subscription for visibility",
                  {
                    userId,
                    error:
                      (subscriptionError as any)?.message || subscriptionError,
                  },
                );
              }
            }
          }

          businessAccessCache.set(userId, {
            hasAccess,
            expiresAt: now + BUSINESS_ACCESS_CACHE_TTL_MS,
          });
          result.set(userId, hasAccess);
        }),
      );
    } catch (error) {
      console.warn("[subscription] Failed bulk business access lookup", {
        count: missingIds.length,
        error: (error as any)?.message || error,
      });
      await Promise.all(
        missingIds.map(async (userId) => {
          result.set(userId, await hasBusinessDistributionAccess(userId));
        }),
      );
    }

    return result;
  }

  async function filterDealsByBusinessAccess<
    T extends { restaurantId?: string | null },
  >(dealRows: T[]): Promise<T[]> {
    if (!Array.isArray(dealRows) || dealRows.length === 0) return [];

    const restaurantIds = Array.from(
      new Set(
        dealRows
          .map((row) => String(row?.restaurantId || "").trim())
          .filter(Boolean),
      ),
    );
    if (restaurantIds.length === 0) return dealRows;

    const restaurantRows = await db
      .select({
        id: restaurants.id,
        ownerId: restaurants.ownerId,
      })
      .from(restaurants)
      .where(inArray(restaurants.id, restaurantIds));

    const ownerByRestaurant = new Map<string, string>();
    for (const row of restaurantRows) {
      const restaurantId = String(row.id || "").trim();
      const ownerId = String(row.ownerId || "").trim();
      if (!restaurantId || !ownerId) continue;
      ownerByRestaurant.set(restaurantId, ownerId);
    }

    const ownerIds = Array.from(new Set(ownerByRestaurant.values()));
    const ownerAccess = new Map<string, boolean>();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        ownerAccess.set(ownerId, await hasBusinessDistributionAccess(ownerId));
      }),
    );

    return dealRows.filter((deal) => {
      const restaurantId = String(deal?.restaurantId || "").trim();
      if (!restaurantId) return false;
      const ownerId = ownerByRestaurant.get(restaurantId);
      if (!ownerId) return false;
      return ownerAccess.get(ownerId) === true;
    });
  }

  return {
    ensureTrialForUser,
    isTrialActive,
    getLockedPriceForUser,
    validateAnalyticsAccess,
    validateSubscriptionLimits,
    hasBusinessDistributionAccess,
    getBusinessDistributionAccessByOwnerIds,
    filterDealsByBusinessAccess,
  };
}
