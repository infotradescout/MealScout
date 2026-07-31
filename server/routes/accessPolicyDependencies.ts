import type Stripe from "stripe";
import { storage } from "../storage";
import { db } from "../db";
import { restaurants } from "@shared/schema";
import { PROFILE_ACCESS_POLICY } from "@shared/profileAccessPolicy";
import { inArray } from "drizzle-orm";
import {
  ensurePremiumTrialForUser,
} from "../services/premiumTrial";

export type RouteAccessPolicyDependencies = {
  ensureTrialForUser: typeof ensurePremiumTrialForUser;
  validateProfileAnalyticsAccess: (userId: string) => Promise<{
    hasAccess: boolean;
    error?: string;
    subscriptionTier?: string;
  }>;
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
  filterDealsByBusinessAccess: <T extends { restaurantId?: string | null }>(
    dealRows: T[],
  ) => Promise<T[]>;
};

export function createRouteAccessPolicyDependencies(
  _stripe: Stripe | null,
): RouteAccessPolicyDependencies {
  const ensureTrialForUser = ensurePremiumTrialForUser;

  const BUSINESS_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
  const businessAccessCache = new Map<
    string,
    { hasAccess: boolean; expiresAt: number }
  >();

  async function validateProfileAnalyticsAccess(userId: string): Promise<{
    hasAccess: boolean;
    error?: string;
    subscriptionTier?: string;
  }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return { hasAccess: false, error: "User not found" };
      }

      return { hasAccess: true, subscriptionTier: "profile_free_trial" };
    } catch (error) {
      console.error("Analytics access validation error:", error);
      return {
        hasAccess: false,
        error: "Unable to verify profile access. Please try again.",
        subscriptionTier: "error",
      };
    }
  }

  async function hasCompleteProfileAccess(
    userId: string,
  ): Promise<boolean> {
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
      hasAccess = Boolean(
        user && PROFILE_ACCESS_POLICY.status === "active",
      );
    } catch (error) {
      console.warn("[profile-access] Failed to verify active owner", {
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
        ownerAccess.set(ownerId, await hasCompleteProfileAccess(ownerId));
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
    validateProfileAnalyticsAccess,
    hasCompleteProfileAccess,
    filterDealsByBusinessAccess,
  };
}
