/**
 * User API Routes
 *
 * Handles user-related endpoints including credit balance
 */

import { Router, Request, Response } from "express";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { dealClaims, deals, users } from "@shared/schema";
import { getUserCreditBalance } from "./creditService";
import { isAuthenticated } from "./unifiedAuth";
import { storage } from "./storage";
import { canManageBusinessFinancials } from "./businessFinancialAccess";

const router = Router();

/**
 * GET /api/users/:userId/balance
 *
 * Get user's current credit balance (for form validation)
 */
router.get("/:userId/balance", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const restaurantId = String(req.query.restaurantId || "").trim();
    if (!restaurantId) {
      return res.status(400).json({ error: "Business ID required" });
    }
    const authorized = await canManageBusinessFinancials({
      restaurantId,
      userId: String(req.user?.id || ""),
      userType: (req.user as any)?.userType,
    });
    if (!authorized) {
      return res.status(403).json({ error: "Financial access required" });
    }

    const balance = await getUserCreditBalance(userId);

    res.set("Cache-Control", "no-store");
    res.json({
      userId,
      balance,
    });
  } catch (error) {
    console.error("[userRoutes] Error getting user balance:", error);
    res.status(500).json({
      error: "Failed to fetch user balance",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/users/stats
 *
 * Lightweight stats for the user dashboard.
 */
router.get("/stats", isAuthenticated, async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [totalDealsUsedRow] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(dealClaims)
      .where(eq(dealClaims.userId, userId));

    const [dealsThisMonthRow] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(dealClaims)
      .where(and(eq(dealClaims.userId, userId), gte(dealClaims.claimedAt, monthStart)));

    const favoritesCount = await storage.getUserRestaurantFavoritesCount(userId);

    const claims: Array<{
      dealType: string | null;
      discountValue: unknown;
      orderAmount: unknown;
    }> = await db
      .select({
        dealType: deals.dealType,
        discountValue: deals.discountValue,
        orderAmount: dealClaims.orderAmount,
      })
      .from(dealClaims)
      .innerJoin(deals, eq(dealClaims.dealId, deals.id))
      .where(eq(dealClaims.userId, userId));

    const totalSavings = claims.reduce((sum: number, claim) => {
      const discountValue = Number(claim.discountValue ?? 0) || 0;
      const orderAmount = claim.orderAmount ? Number(claim.orderAmount) : null;
      if (claim.dealType === "percentage") {
        if (orderAmount && discountValue > 0) {
          return sum + (discountValue / 100) * orderAmount;
        }
        return sum;
      }
      return sum + discountValue;
    }, 0);

    res.json({
      totalDealsUsed: totalDealsUsedRow?.count ?? 0,
      totalSavings: Math.round(totalSavings * 100) / 100,
      favoriteRestaurants: favoritesCount,
      dealsThisMonth: dealsThisMonthRow?.count ?? 0,
    });
  } catch (error) {
    console.error("[userRoutes] Error fetching user stats:", error);
    res.status(500).json({
      error: "Failed to fetch user stats",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/users/claimed-deals
 *
 * Returns claimed deals with nested deal + restaurant for dashboard.
 */
  router.get("/claimed-deals", isAuthenticated, async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const claims = await db.query.dealClaims.findMany({
      where: eq(dealClaims.userId, userId),
      orderBy: desc(dealClaims.claimedAt),
      with: {
        deal: {
          with: {
            restaurant: true,
          },
        },
      },
    });

    const mapped = claims.map((claim: (typeof claims)[number]) => ({
      ...claim,
      deal: claim.deal,
      restaurant: claim.deal?.restaurant,
    }));

    res.json(mapped);
  } catch (error) {
    console.error("[userRoutes] Error fetching claimed deals:", error);
    res.status(500).json({ message: "Failed to fetch claimed deals" });
  }
});

/**
 * GET /api/users/favorites
 *
 * Returns favorite restaurants for dashboard.
 */
router.get("/favorites", isAuthenticated, async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const favorites = await storage.getUserRestaurantFavorites(userId);
    res.json(favorites.map((favorite) => favorite.restaurant));
  } catch (error) {
    console.error("[userRoutes] Error fetching favorites:", error);
    res.status(500).json({ message: "Failed to fetch favorites" });
  }
});

/**
 * GET /api/users/search
 *
 * Search for users by email (for restaurant credit redemption form)
 */
router.get("/search", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { q, limit = 5, restaurantId: rawRestaurantId } = req.query;
    const restaurantId = String(rawRestaurantId || "").trim();
    if (!restaurantId) {
      return res.status(400).json({ error: "Business ID required" });
    }
    const authorized = await canManageBusinessFinancials({
      restaurantId,
      userId: String(req.user?.id || ""),
      userType: (req.user as any)?.userType,
    });
    if (!authorized) {
      return res.status(403).json({ error: "Financial access required" });
    }

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Search query required" });
    }
    const normalizedQuery = q.trim();
    if (normalizedQuery.length < 2) {
      return res.status(400).json({
        error: "Enter at least 2 characters to search",
      });
    }

    const parsedLimit = Math.min(Number(limit) || 5, 10);

    const results = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(
        and(
          ilike(users.email, `%${normalizedQuery}%`),
          or(eq(users.isDisabled, false), isNull(users.isDisabled))
        )
      )
      .limit(parsedLimit);

    const mapped = results.map(
      (u: {
        id: string;
        email: string | null;
        firstName: string | null;
        lastName: string | null;
      }) => {
        const nameParts = [u.firstName, u.lastName].filter(Boolean);
        return {
          id: u.id,
          email: u.email ?? "",
          name: nameParts.length > 0 ? nameParts.join(" ") : u.email ?? "",
        };
      }
    );

    res.set("Cache-Control", "no-store");
    res.json({ users: mapped });
  } catch (error) {
    console.error("[userRoutes] Error searching users:", error);
    res.status(500).json({
      error: "Failed to search users",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
