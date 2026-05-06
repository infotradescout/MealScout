/**
 * Admin deals management routes
 * Extracted from userAdminRoutes during Phase 5: Oversized Route Splits
 * Lane: phase-5-oversized-route-splits
 */

import type { Express } from "express";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";

export function registerDealAdminRoutes(app: Express) {
  app.get(
    "/api/admin/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const deals = await storage.getAllDealsWithRestaurants();
        res.json(deals);
      } catch (error) {
        console.error("Error fetching deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.get(
    "/api/admin/deals/:dealId/stats",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const dealId = req.params.dealId;
        const [viewsCount, claimsCount, feedbackStats] = await Promise.all([
          storage.getDealViewsCount(dealId),
          storage.getDealClaimsCount(dealId),
          storage.getDealFeedbackStats(dealId),
        ]);

        res.json({
          views: viewsCount,
          claims: claimsCount,
          averageRating: feedbackStats.averageRating,
          totalFeedback: feedbackStats.totalFeedback,
          ratingDistribution: feedbackStats.ratingDistribution,
          criticWeightedAverageRating:
            feedbackStats.criticWeightedAverageRating,
          criticFeedbackCount: feedbackStats.criticFeedbackCount,
          criticWeightApplied: feedbackStats.criticWeightApplied,
        });
      } catch (error) {
        console.error("Error fetching deal stats:", error);
        res.status(500).json({ message: "Failed to fetch deal statistics" });
      }
    },
  );

  app.delete(
    "/api/admin/deals/:dealId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.deleteDeal(req.params.dealId);
        res.json({ message: "Deal deleted successfully" });
      } catch (error) {
        console.error("Error deleting deal:", error);
        res.status(500).json({ message: "Failed to delete deal" });
      }
    },
  );

  app.post(
    "/api/admin/deals/:dealId/clone",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const clonedDeal = await storage.duplicateDeal(req.params.dealId);
        res.json(clonedDeal);
      } catch (error: any) {
        if (
          error?.code === "DEAL_DUPLICATE_OVERLAP" ||
          String(error?.message || "").includes("same time window")
        ) {
          return res.status(409).json({
            message:
              "A matching deal/special already exists for the same time window. You can run it again in a future window.",
          });
        }
        console.error("Error cloning deal:", error);
        res.status(500).json({ message: "Failed to clone deal" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:dealId/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { isActive } = req.body;
        await storage.updateDeal(req.params.dealId, { isActive });
        res.json({ message: "Deal status updated successfully" });
      } catch (error: any) {
        if (
          error?.code === "DEAL_DUPLICATE_OVERLAP" ||
          String(error?.message || "").includes("same time window")
        ) {
          return res.status(409).json({
            message:
              "A matching deal/special already exists for the same time window. You can run it again in a future window.",
          });
        }
        console.error("Error updating deal status:", error);
        res.status(500).json({ message: "Failed to update deal status" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:dealId/extend",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { days } = req.body;
        if (!days || days < 1) {
          return res.status(400).json({ message: "Invalid number of days" });
        }

        const deal = await storage.getDeal(req.params.dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        if (!deal.endDate) {
          return res
            .status(400)
            .json({ message: "Cannot extend ongoing deals (no end date)" });
        }

        const newEndDate = new Date(deal.endDate);
        newEndDate.setDate(newEndDate.getDate() + days);

        await storage.updateDeal(req.params.dealId, { endDate: newEndDate });
        res.json({ message: `Deal extended by ${days} days`, newEndDate });
      } catch (error) {
        console.error("Error extending deal:", error);
        res.status(500).json({ message: "Failed to extend deal" });
      }
    },
  );
}
