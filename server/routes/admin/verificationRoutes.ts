import { Express, Router } from "express";
import { eq } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import {
  verificationRequests,
  restaurants,
  users,
  truckImportListings,
  truckClaimRequests,
} from "@shared/schema";
import type { IStorage } from "../../storage";
import { emailService } from "../../emailService";
import { ensurePremiumTrialForUserId } from "../../services/premiumTrial";
import { db } from "../../db";

export type VerificationDeps = {
  storage: IStorage;
};

export function registerVerificationAdminRoutes(
  app: Express,
  deps: VerificationDeps,
) {
  const { storage } = deps;

  // GET /api/admin/verifications - List all verification requests (with optional status filter)
  app.get(
    "/api/admin/verifications",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const { status } = req.query;
        let verifications = await storage.getVerificationRequests();

        // Filter by status if provided
        if (
          status &&
          ["pending", "approved", "rejected"].includes(status as string)
        ) {
          verifications = verifications.filter((v) => v.status === status);
        }

        res.json(verifications);
      } catch (error) {
        console.error("Error fetching verification requests:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch verification requests" });
      }
    },
  );

  // POST /api/admin/verifications/:id/approve - Approve a verification request
  app.post(
    "/api/admin/verifications/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const user = req.user;
        const { id } = req.params;
        await storage.approveVerificationRequest(id, user.id);

        const [claimContext] = await db
          .select({
            restaurantId: restaurants.id,
            claimedFromImportId: restaurants.claimedFromImportId,
            ownerId: restaurants.ownerId,
            ownerEmail: users.email,
          })
          .from(verificationRequests)
          .innerJoin(
            restaurants,
            eq(verificationRequests.restaurantId, restaurants.id),
          )
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(eq(verificationRequests.id, id))
          .limit(1);

        if (claimContext?.ownerId) {
          try {
            await ensurePremiumTrialForUserId(String(claimContext.ownerId));
          } catch (e) {
            console.warn(
              "ensurePremiumTrialForUserId failed after verification approval:",
              e,
            );
          }
        }

        if (claimContext?.claimedFromImportId) {
          await db
            .update(truckImportListings)
            .set({
              status: "claimed",
              updatedAt: new Date(),
            })
            .where(
              eq(truckImportListings.id, claimContext.claimedFromImportId),
            );

          await db
            .update(truckClaimRequests)
            .set({
              status: "approved",
              reviewerId: user.id,
              reviewedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              eq(truckClaimRequests.restaurantId, claimContext.restaurantId),
            );

          await db
            .update(restaurants)
            .set({
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, claimContext.restaurantId));

          const notificationEmail = "notifications@mealscout.us";
          if (claimContext.ownerEmail) {
            await emailService.sendBasicEmail(
              claimContext.ownerEmail,
              "Your food truck claim was approved",
              `
                <p>Your food truck claim has been approved.</p>
                <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              `,
            );
          }
          await emailService.sendBasicEmail(
            notificationEmail,
            "Food Truck Claim Approved",
            `
              <p>A food truck claim was approved.</p>
              <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              <p><strong>Owner ID:</strong> ${claimContext.ownerId}</p>
            `,
          );
        }

        res.json({ success: true, message: "Verification request approved" });
      } catch (error) {
        console.error("Error approving verification request:", error);
        res
          .status(500)
          .json({ message: "Failed to approve verification request" });
      }
    },
  );

  // POST /api/admin/verifications/:id/reject - Reject a verification request
  app.post(
    "/api/admin/verifications/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const user = req.user;
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim().length === 0) {
          return res
            .status(400)
            .json({ message: "Rejection reason is required" });
        }

        await storage.rejectVerificationRequest(id, user.id, reason);

        const [claimContext] = await db
          .select({
            restaurantId: restaurants.id,
            claimedFromImportId: restaurants.claimedFromImportId,
            ownerId: restaurants.ownerId,
            ownerEmail: users.email,
          })
          .from(verificationRequests)
          .innerJoin(
            restaurants,
            eq(verificationRequests.restaurantId, restaurants.id),
          )
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(eq(verificationRequests.id, id))
          .limit(1);

        if (claimContext?.claimedFromImportId) {
          await db
            .update(truckImportListings)
            .set({
              status: "rejected",
              updatedAt: new Date(),
            })
            .where(
              eq(truckImportListings.id, claimContext.claimedFromImportId),
            );

          await db
            .update(truckClaimRequests)
            .set({
              status: "rejected",
              reviewerId: user.id,
              reviewedAt: new Date(),
              rejectionReason: reason,
              updatedAt: new Date(),
            })
            .where(
              eq(truckClaimRequests.restaurantId, claimContext.restaurantId),
            );

          const notificationEmail = "notifications@mealscout.us";
          if (claimContext.ownerEmail) {
            await emailService.sendBasicEmail(
              claimContext.ownerEmail,
              "Your food truck claim was rejected",
              `
                <p>Your food truck claim was rejected.</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              `,
            );
          }
          await emailService.sendBasicEmail(
            notificationEmail,
            "Food Truck Claim Rejected",
            `
              <p>A food truck claim was rejected.</p>
              <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
              <p><strong>Owner ID:</strong> ${claimContext.ownerId}</p>
              <p><strong>Reason:</strong> ${reason}</p>
            `,
          );
        }

        res.json({ success: true, message: "Verification request rejected" });
      } catch (error) {
        console.error("Error rejecting verification request:", error);
        res
          .status(500)
          .json({ message: "Failed to reject verification request" });
      }
    },
  );
}
