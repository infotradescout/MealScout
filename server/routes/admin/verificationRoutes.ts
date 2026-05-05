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
  const isAdminUser = (req: any) =>
    req.user?.userType === "admin" || req.user?.userType === "super_admin";

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
        if (!isAdminUser(req)) {
          return res.status(403).json({
            message: "Admin access required to approve verification requests",
          });
        }

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

        // Always send an approval email to the truck owner, regardless of whether
        // the truck was a claimed import or a fresh self-signup. Without this,
        // fresh-signup trucks that require manual review have no idea they've been
        // approved and can now book parking passes.
        if (claimContext?.ownerEmail) {
          const isClaim = !!claimContext.claimedFromImportId;
          const subject = isClaim
            ? "Your food truck claim was approved — welcome to MealScout!"
            : "Your MealScout account has been verified — you're ready to book!";
          const body = isClaim
            ? `
              <p>Great news — your food truck claim has been approved on MealScout!</p>
              <p>You can now log in and start booking parking pass slots at local host locations.</p>
              <p>Head to <a href="https://mealscout.us/parking-pass">mealscout.us/parking-pass</a> to find available spots near you.</p>
            `
            : `
              <p>Great news — your MealScout account has been verified!</p>
              <p>You can now book parking pass slots at host locations in your area.</p>
              <p>Head to <a href="https://mealscout.us/parking-pass">mealscout.us/parking-pass</a> to find available spots near you.</p>
            `;
          try {
            await emailService.sendBasicEmail(claimContext.ownerEmail, subject, body);
          } catch (emailError) {
            console.warn("Failed to send owner approval notification email:", emailError);
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
        }

        // Internal notification for all approvals.
        try {
          await emailService.sendBasicEmail(
            "notifications@mealscout.us",
            "Verification Approved",
            `
              <p>A verification request was approved.</p>
              <p><strong>Restaurant ID:</strong> ${claimContext?.restaurantId ?? id}</p>
              <p><strong>Owner ID:</strong> ${claimContext?.ownerId ?? "unknown"}</p>
              <p><strong>Type:</strong> ${claimContext?.claimedFromImportId ? "Claim" : "Fresh signup"}</p>
            `,
          );
        } catch (emailError) {
          console.warn("Failed to send internal approval notification email:", emailError);
        }

        res.json({ success: true, message: "Verification request approved" });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Verification request not found"
        ) {
          return res.status(404).json({ message: error.message });
        }
        if (
          error instanceof Error &&
          error.message.includes("business proof is required")
        ) {
          return res.status(400).json({ message: error.message });
        }
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
        if (!isAdminUser(req)) {
          return res.status(403).json({
            message: "Admin access required to reject verification requests",
          });
        }

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
            try {
              await emailService.sendBasicEmail(
                claimContext.ownerEmail,
                "Your food truck claim was rejected",
                `
                  <p>Your food truck claim was rejected.</p>
                  <p><strong>Reason:</strong> ${reason}</p>
                  <p><strong>Restaurant ID:</strong> ${claimContext.restaurantId}</p>
                `,
              );
            } catch (emailError) {
              console.warn(
                "Failed to send owner rejection notification email:",
                emailError,
              );
            }
          }
          try {
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
          } catch (emailError) {
            console.warn(
              "Failed to send internal rejection notification email:",
              emailError,
            );
          }
        }

        res.json({ success: true, message: "Verification request rejected" });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Verification request not found"
        ) {
          return res.status(404).json({ message: error.message });
        }
        console.error("Error rejecting verification request:", error);
        res
          .status(500)
          .json({ message: "Failed to reject verification request" });
      }
    },
  );
}
