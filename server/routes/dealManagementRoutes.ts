import type { Express } from "express";

import { storage } from "../storage";
import { isAuthenticated, verifyResourceOwnership } from "../unifiedAuth";
import { insertDealSchema, insertDealViewSchema } from "@shared/schema";

type SubscriptionValidationResult = {
  isValid: boolean;
  error?: string;
  currentCount?: number;
  maxDeals?: number;
};

type DealManagementRouteDependencies = {
  logAudit: (
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | undefined,
    ip: string | undefined,
    userAgent: string | undefined,
    details: unknown,
  ) => Promise<void>;
  validateSubscriptionLimits: (
    userId: string,
    excludeDealId?: string,
  ) => Promise<SubscriptionValidationResult>;
  notifyNearbyDealSubscribers: (params: {
    creatorUserId: string;
    dealId: string;
    dealTitle: string;
    restaurantName: string;
    lat: number;
    lng: number;
  }) => Promise<void>;
  toNumeric: (value: unknown) => number | null;
};

export function registerDealManagementRoutes(
  app: Express,
  {
    logAudit,
    validateSubscriptionLimits,
    notifyNearbyDealSubscribers,
    toNumeric,
  }: DealManagementRouteDependencies,
) {
  app.get("/api/deals/claimed", isAuthenticated, async (req: any, res) => {
    try {
      const claimedDeals = await storage.getUserDealClaimsWithDetails(req.user.id);
      res.json(claimedDeals);
    } catch (error) {
      console.error("Error fetching claimed deals:", error);
      res.status(500).json({ message: "Failed to fetch claimed deals" });
    }
  });

  app.patch(
    "/api/deals/:dealId",
    isAuthenticated,
    verifyResourceOwnership("deal"),
    async (req: any, res) => {
      try {
        await logAudit(
          req.user.id,
          "deal_edit",
          "deal",
          req.params.dealId,
          req.ip,
          req.headers["user-agent"],
          req.body,
        );

        const { dealId } = req.params;
        const currentDeal = await storage.getDeal(dealId);
        if (!currentDeal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        if (req.body.isActive === true && !currentDeal.isActive) {
          const subscriptionValidation = await validateSubscriptionLimits(
            req.user.id,
            dealId,
          );
          if (!subscriptionValidation.isValid) {
            return res.status(402).json({
              message: subscriptionValidation.error,
              currentCount: subscriptionValidation.currentCount,
              maxDeals: subscriptionValidation.maxDeals,
            });
          }
        }

        const updatedDeal = await storage.updateDeal(dealId, req.body);
        res.json(updatedDeal);
      } catch (error) {
        console.error("Error updating deal:", error);
        res.status(500).json({ message: "Failed to update deal" });
      }
    },
  );

  app.delete(
    "/api/deals/:dealId",
    isAuthenticated,
    verifyResourceOwnership("deal"),
    async (req: any, res) => {
      try {
        await logAudit(
          req.user.id,
          "deal_delete",
          "deal",
          req.params.dealId,
          req.ip,
          req.headers["user-agent"],
          {},
        );

        await storage.deleteDeal(req.params.dealId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting deal:", error);
        res.status(500).json({ message: "Failed to delete deal" });
      }
    },
  );

  app.post("/api/deals/:dealId/view", async (req: any, res) => {
    try {
      const { dealId } = req.params;
      const userId = req.user?.id;
      const sessionId = req.sessionID;

      const deal = await storage.getDeal(dealId);
      if (!deal) {
        console.warn(
          `[deals:view] deal not found for id ${dealId} - skipping view tracking`,
        );
        return res.json({
          success: true,
          message: "Deal not found; view skipped",
        });
      }

      const hasRecentView = await storage.hasRecentDealView(
        dealId,
        userId,
        sessionId,
        3600000,
      );
      if (hasRecentView) {
        return res.json({
          success: true,
          message: "View already recorded recently",
        });
      }

      const viewData = insertDealViewSchema.parse({
        dealId,
        userId,
        sessionId,
      });

      const view = await storage.recordDealView(viewData);
      res.json({ success: true, view });
    } catch (error) {
      console.error("Error recording deal view:", error);
      res.status(500).json({ message: "Failed to record view" });
    }
  });

  app.post("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      console.log("🟢 POST /api/deals - incoming request", {
        userId: req.user?.id,
        ip: req.ip,
        ua: req.headers["user-agent"],
      });

      await logAudit(
        req.user.id,
        "deal_create",
        "deal",
        undefined,
        req.ip,
        req.headers["user-agent"],
        req.body,
      );

      const userId = req.user.id;
      const raw = req.body || {};
      const normalized = {
        ...raw,
        discountValue:
          typeof raw.discountValue === "number"
            ? raw.discountValue.toString()
            : raw.discountValue,
        minOrderAmount:
          raw.minOrderAmount === "" || raw.minOrderAmount == null
            ? null
            : typeof raw.minOrderAmount === "number"
              ? raw.minOrderAmount.toString()
              : raw.minOrderAmount,
        totalUsesLimit:
          raw.totalUsesLimit === "" || raw.totalUsesLimit == null
            ? null
            : typeof raw.totalUsesLimit === "string"
              ? parseInt(raw.totalUsesLimit)
              : raw.totalUsesLimit,
        perCustomerLimit:
          raw.perCustomerLimit === "" || raw.perCustomerLimit == null
            ? 1
            : typeof raw.perCustomerLimit === "string"
              ? parseInt(raw.perCustomerLimit)
              : raw.perCustomerLimit,
        startDate:
          typeof raw.startDate === "string"
            ? new Date(raw.startDate)
            : raw.startDate,
        endDate:
          raw.isOngoing || raw.endDate === "" || raw.endDate == null
            ? null
            : typeof raw.endDate === "string"
              ? new Date(raw.endDate)
              : raw.endDate,
        startTime: raw.availableDuringBusinessHours ? null : raw.startTime,
        endTime: raw.availableDuringBusinessHours ? null : raw.endTime,
      };

      console.log("🧭 Normalized deal payload", {
        restaurantId: normalized.restaurantId,
        title: normalized.title,
        dealType: normalized.dealType,
        discountValue: normalized.discountValue,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
      });

      const dealData = insertDealSchema.parse(normalized);
      const restaurant = await storage.getRestaurant(dealData.restaurantId);
      if (!restaurant || restaurant.ownerId !== userId) {
        console.warn(
          "🚫 Deal creation rejected - unauthorized restaurant ownership",
          {
            userId,
            restaurantId: dealData.restaurantId,
            ownerId: restaurant?.ownerId,
          },
        );
        return res.status(403).json({ message: "Unauthorized" });
      }

      const subscriptionValidation = await validateSubscriptionLimits(userId);
      console.log("📊 Subscription validation", subscriptionValidation);
      if (!subscriptionValidation.isValid) {
        return res.status(402).json({
          message: subscriptionValidation.error,
          currentCount: subscriptionValidation.currentCount,
          maxDeals: subscriptionValidation.maxDeals,
        });
      }

      const deal = await storage.createDeal(dealData);
      console.log("✅ Deal created", {
        id: deal.id,
        restaurantId: deal.restaurantId,
        title: deal.title,
      });

      const restaurantLat = toNumeric((restaurant as any)?.latitude);
      const restaurantLng = toNumeric((restaurant as any)?.longitude);
      if (restaurantLat != null && restaurantLng != null) {
        void notifyNearbyDealSubscribers({
          creatorUserId: userId,
          dealId: deal.id,
          dealTitle: deal.title,
          restaurantName: restaurant.name,
          lat: restaurantLat,
          lng: restaurantLng,
        }).catch((error) => {
          console.error("Failed to send nearby deal notifications:", error);
        });
      }

      res.json(deal);
    } catch (error: any) {
      console.error("❌ Error creating deal:", error?.message || error);
      if (error?.stack) {
        console.error(error.stack);
      }
      res
        .status(400)
        .json({ message: error?.message || "Failed to create deal" });
    }
  });
}
