import type { Express } from "express";

import { storage } from "../storage";
import { isAuthenticated, verifyResourceOwnership } from "../unifiedAuth";
import { insertDealSchema, insertDealViewSchema } from "@shared/schema";
import {
  hasBusinessPermissionForRestaurant,
} from "../services/businessTeamAccess";

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
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
  queueSocialPost: (payload: {
    platform: string;
    target?: string | null;
    message: string;
    link?: string | null;
  }) => Promise<void>;
};

export function registerDealManagementRoutes(
  app: Express,
  {
    logAudit,
    validateSubscriptionLimits,
    notifyNearbyDealSubscribers,
    toNumeric,
    hasBusinessDistributionAccess,
    queueSocialPost,
  }: DealManagementRouteDependencies,
) {
  const buildDealAutopostMessage = (params: {
    dealTitle: string;
    dealDescription?: string;
    category?: string | null;
    dealType?: string | null;
    discountValue?: string | number | null;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    startTime?: string | null;
    endTime?: string | null;
    isOngoing?: boolean | null;
    availableDuringBusinessHours?: boolean | null;
  }) => {
    const isSpecial = String(params.category || "deal") === "special";
    const intro = isSpecial
      ? "We are excited to announce a new special!"
      : "We are excited to announce a new deal!";
    const headline = params.dealTitle ? ` ${params.dealTitle}.` : "";

    const parsedValue = Number.parseFloat(String(params.discountValue ?? ""));
    let valuePart = "";
    if (Number.isFinite(parsedValue)) {
      if (isSpecial) {
        valuePart = `$${parsedValue.toFixed(2)}`;
      } else if (String(params.dealType || "") === "percentage") {
        valuePart = `${parsedValue}% off`;
      } else {
        valuePart = `save $${parsedValue.toFixed(2)}`;
      }
    }

    const startDate = params.startDate
      ? new Date(params.startDate).toISOString().split("T")[0]
      : "";
    const endDate = params.endDate
      ? new Date(params.endDate).toISOString().split("T")[0]
      : "";
    const availabilityDatePart = params.isOngoing
      ? "ongoing"
      : startDate && endDate
      ? `${startDate} to ${endDate}`
      : startDate
      ? `starts ${startDate}`
      : "";
    const availabilityTimePart = params.availableDuringBusinessHours
      ? "during business hours"
      : params.startTime && params.endTime
      ? `${params.startTime}-${params.endTime}`
      : "";
    const summaryParts = [valuePart, availabilityDatePart, availabilityTimePart].filter(
      Boolean,
    );
    const summary = summaryParts.length
      ? ` ${summaryParts.join(", ")}${summaryParts[0] === valuePart ? "." : ""}`
      : "";

    const detailsRaw = String(params.dealDescription || "")
      .replace(/\s+/g, " ")
      .trim();
    const details = detailsRaw
      ? /[.!?]$/.test(detailsRaw)
        ? ` ${detailsRaw}`
        : ` ${detailsRaw}.`
      : "";
    return `${intro}${headline}${summary}${details} Tap to see full details and the photo on MealScout.`;
  };

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
      const category = raw.category === "special" ? "special" : "deal";
      const normalized = {
        ...raw,
        category,
        dealType:
          category === "special" && !raw.dealType ? null : raw.dealType,
        discountValue:
          category === "special" && (raw.discountValue === "" || raw.discountValue == null)
            ? null
            : typeof raw.discountValue === "number"
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
        category: normalized.category,
        dealType: normalized.dealType,
        discountValue: normalized.discountValue,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
      });

      const dealData = insertDealSchema.parse(normalized);
      const restaurant = await storage.getRestaurant(dealData.restaurantId);
      const canManageDeals = restaurant
        ? await hasBusinessPermissionForRestaurant(
            userId,
            dealData.restaurantId,
            "manageDeals",
          )
        : false;
      if (!restaurant || !canManageDeals) {
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

      const billingCandidates = Array.from(
        new Set(
          [
            String(restaurant.ownerId || "").trim(),
            String(userId || "").trim(),
          ].filter(Boolean),
        ),
      );

      let subscriptionValidation: Awaited<
        ReturnType<typeof validateSubscriptionLimits>
      > = {
        isValid: false,
        error: "Active subscription required to create deals. Please upgrade your plan.",
        currentCount: 0,
        maxDeals: 0,
      };

      for (const candidateUserId of billingCandidates) {
        const candidateValidation = await validateSubscriptionLimits(
          candidateUserId,
        );
        console.log("📊 Subscription validation", {
          candidateUserId,
          ...candidateValidation,
        });
        if (candidateValidation.isValid) {
          subscriptionValidation = candidateValidation;
          break;
        }
        subscriptionValidation = candidateValidation;
      }

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

      // Hands-off auto-sharing: queue social posts when deal trigger is enabled
      // and the owner has disabled prompt-before-post in social settings.
      try {
        const hasDistributionAccess = await hasBusinessDistributionAccess(userId);
        const socialSettings =
          restaurant?.socialAutopostSettings &&
          typeof restaurant.socialAutopostSettings === "object"
            ? (restaurant.socialAutopostSettings as Record<string, any>)
            : {};
        const triggers =
          socialSettings.triggers && typeof socialSettings.triggers === "object"
            ? (socialSettings.triggers as Record<string, any>)
            : {};
        const rawPlatforms =
          socialSettings.platforms &&
          typeof socialSettings.platforms === "object"
            ? (socialSettings.platforms as Record<string, any>)
            : {};
        const platforms = {
          facebook: rawPlatforms.facebook !== false,
          instagram: rawPlatforms.instagram !== false,
          x: rawPlatforms.x !== false,
        };
        const dealTriggerEnabled = triggers.deal !== false;
        const shouldQueueAutopost =
          hasDistributionAccess &&
          dealTriggerEnabled &&
          socialSettings.promptBeforePost === false;

        if (shouldQueueAutopost) {
          const baseUrl = (
            process.env.PUBLIC_BASE_URL || "https://www.mealscout.us"
          ).replace(/\/+$/, "");
          const link = `${baseUrl}/deal/${deal.id}`;
          const message = buildDealAutopostMessage({
            dealTitle: String(deal.title || "New deal"),
            dealDescription: String((deal as any)?.description || ""),
            category: String((deal as any)?.category || "deal"),
            dealType: String((deal as any)?.dealType || ""),
            discountValue: (deal as any)?.discountValue ?? null,
            startDate: (deal as any)?.startDate ?? null,
            endDate: (deal as any)?.endDate ?? null,
            startTime: String((deal as any)?.startTime || ""),
            endTime: String((deal as any)?.endTime || ""),
            isOngoing: Boolean((deal as any)?.isOngoing),
            availableDuringBusinessHours: Boolean(
              (deal as any)?.availableDuringBusinessHours,
            ),
          });

          const postJobs: Promise<void>[] = [];
          if (platforms.facebook) {
            postJobs.push(
              queueSocialPost({
                platform: "facebook",
                target: restaurant.facebookPageUrl || "mealscout_page",
                message,
                link,
              }),
            );
          }
          if (platforms.instagram) {
            postJobs.push(
              queueSocialPost({
                platform: "instagram",
                target: restaurant.instagramUrl || null,
                message,
                link,
              }),
            );
          }
          if (platforms.x) {
            postJobs.push(
              queueSocialPost({
                platform: "x",
                target: restaurant.xUrl || null,
                message,
                link,
              }),
            );
          }
          if (postJobs.length > 0) {
            void Promise.allSettled(postJobs).then((results) => {
              results.forEach((result, index) => {
                if (result.status === "rejected") {
                  console.error(
                    `Failed to queue social deal post [${index}]:`,
                    result.reason,
                  );
                }
              });
            });
          }
        }
      } catch (error) {
        console.error("Failed to process deal auto-share queue:", error);
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
