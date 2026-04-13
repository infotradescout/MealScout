import type { Express } from "express";
import { z } from "zod";

import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";

type ClaimRouteDependencies = {
  sendDealClaimedNotification: (
    dealId: string,
    userId: string,
  ) => Promise<void>;
};

export function registerClaimRoutes(
  app: Express,
  { sendDealClaimedNotification }: ClaimRouteDependencies,
) {
  app.patch(
    "/api/deal-claims/:claimId/use",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { claimId } = req.params;
        const { orderAmount } = z
          .object({
            orderAmount: z.number().positive().min(0.01).max(10000).optional(),
          })
          .parse(req.body ?? {});

        const isAuthorized = await storage.verifyRestaurantOwnershipByClaim(
          claimId,
          req.user.id,
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only mark claims as used for your own restaurants",
          });
        }

        const updatedClaim = await storage.markClaimAsUsed(
          claimId,
          orderAmount ?? null,
        );
        if (!updatedClaim) {
          return res
            .status(400)
            .json({ message: "Claim not found or already used" });
        }

        res.json({ success: true, claim: updatedClaim });
      } catch (error) {
        console.error("Error marking claim as used:", error);
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to mark claim as used",
        });
      }
    },
  );

  app.post(
    "/api/deals/:dealId/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const dealId = req.params.dealId;
        const userId = req.user.id;

        const deal = await storage.getDeal(dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        const restaurant = await storage.getRestaurant(deal.restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const existingClaims = await storage.getDealClaimsCount(dealId, userId);
        if (existingClaims >= (deal.perCustomerLimit || 1)) {
          return res
            .status(400)
            .json({ message: "Deal already claimed by user" });
        }

        if (
          deal.totalUsesLimit &&
          (deal.currentUses || 0) >= deal.totalUsesLimit
        ) {
          return res
            .status(400)
            .json({ message: "Deal is no longer available" });
        }

        const claim = await storage.claimDeal({ dealId, userId });
        await storage.incrementDealUses(dealId);

        try {
          await sendDealClaimedNotification(dealId, userId);
        } catch (emailError) {
          console.error(
            "Failed to send deal claimed notification:",
            emailError,
          );
        }

        const facebookMessage = `🍽️ Just claimed an amazing deal at ${
          restaurant.name
        }!\n\n${deal.title}\n${deal.discountValue}% OFF (Min order: $${
          deal.minOrderAmount || "15"
        })\n\nFound this through MealScout - check it out! #MealScout #FoodDeals`;

        res.json({
          success: true,
          claimId: claim.id,
          dealTitle: deal.title,
          restaurantName: restaurant.name,
          restaurantAddress: restaurant.address,
          facebookPostData: {
            message: facebookMessage,
            place: (restaurant as any).facebookPlaceId || undefined,
          },
        });
      } catch (error: any) {
        console.error("Error claiming deal:", error);
        res.status(500).json({ message: "Failed to claim deal" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/claims",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const { status } = req.query;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageDeals",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        const claims = await storage.getRestaurantDealClaims(
          restaurantId,
          status as string,
        );
        res.json(claims);
      } catch (error) {
        console.error("Error fetching restaurant claims:", error);
        res.status(500).json({ message: "Failed to fetch restaurant claims" });
      }
    },
  );
}
