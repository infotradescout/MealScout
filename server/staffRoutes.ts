import type { Express } from "express";
import { storage } from "./storage";
import { isAuthenticated, isAdmin, isStaffOrAdmin } from "./unifiedAuth";
import { logAudit } from "./auditLogger";
import { sendAccountSetupInvite } from "./utils/accountSetup";
import { ensurePremiumTrialForUserId } from "./services/premiumTrial";
import bcrypt from "bcryptjs";

/**
 * Staff Management & User Creation Routes
 *
 * Admin-only routes:
 * - List staff members
 * - Promote user to staff
 * - Demote/disable staff
 *
 * Staff-or-Admin routes:
 * - Create user accounts with email invite links
 */

export function registerStaffRoutes(app: Express) {
  // ============================================
  // ADMIN-ONLY: Staff Management
  // ============================================

  /**
   * GET /api/admin/staff
   * List all staff members
   */
  app.get(
    "/api/admin/staff",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const staffMembers = await storage.getUsersByRole("staff");
        res.json(staffMembers);
      } catch (error) {
        console.error("Error fetching staff:", error);
        res.status(500).json({ error: "Failed to fetch staff members" });
      }
    },
  );

  /**
   * POST /api/admin/staff/:userId/promote
   * Promote a user to staff role
   */
  app.post(
    "/api/admin/staff/:userId/promote",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const adminUser = req.user;

        // Prevent self-promotion edge cases
        if (userId === adminUser.id) {
          return res.status(400).json({ error: "Cannot modify your own role" });
        }

        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        // Protect super admin email
        const SUPER_ADMIN_EMAIL =
          process.env.ADMIN_EMAIL || "info.mealscout@gmail.com";
        if (user.email === SUPER_ADMIN_EMAIL) {
          return res
            .status(403)
            .json({ error: "Cannot modify super admin account" });
        }

        // Cannot promote admin/staff to staff (no-op or error)
        if (user.userType === "admin" || user.userType === "staff") {
          return res
            .status(400)
            .json({ error: "User is already staff or admin" });
        }

        await storage.updateUserType(userId, "staff");

        // Audit log
        await logAudit(
          adminUser.id,
          "staff_promoted",
          "user",
          userId,
          req.ip || "unknown",
          req.get("User-Agent") || "unknown",
          { previousRole: user.userType, newRole: "staff" },
        );

        res.json({ success: true, message: "User promoted to staff" });
      } catch (error) {
        console.error("Error promoting staff:", error);
        res.status(500).json({ error: "Failed to promote user to staff" });
      }
    },
  );

  /**
   * POST /api/admin/staff/:userId/demote
   * Demote staff to customer (or disable)
   */
  app.post(
    "/api/admin/staff/:userId/demote",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const { disable = false } = req.body; // optionally disable instead of demote
        const adminUser = req.user;

        if (userId === adminUser.id) {
          return res.status(400).json({ error: "Cannot modify your own role" });
        }

        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        // Protect super admin email
        const SUPER_ADMIN_EMAIL =
          process.env.ADMIN_EMAIL || "info.mealscout@gmail.com";
        if (user.email === SUPER_ADMIN_EMAIL) {
          return res
            .status(403)
            .json({ error: "Cannot modify super admin account" });
        }

        if (user.userType !== "staff") {
          return res.status(400).json({ error: "User is not staff" });
        }

        if (disable) {
          await storage.disableUser(userId);
          await logAudit(
            adminUser.id,
            "staff_disabled",
            "user",
            userId,
            req.ip || "unknown",
            req.get("User-Agent") || "unknown",
            { reason: "admin_action" },
          );
          res.json({ success: true, message: "Staff account disabled" });
        } else {
          await storage.updateUserType(userId, "customer");
          await logAudit(
            adminUser.id,
            "staff_demoted",
            "user",
            userId,
            req.ip || "unknown",
            req.get("User-Agent") || "unknown",
            { previousRole: "staff", newRole: "customer" },
          );
          res.json({ success: true, message: "Staff demoted to customer" });
        }
      } catch (error) {
        console.error("Error demoting staff:", error);
        res.status(500).json({ error: "Failed to demote staff" });
      }
    },
  );

  // ============================================
  // STAFF-OR-ADMIN: User Creation
  // ============================================

  /**
   * POST /api/staff/users
   * Create a user account (staff or admin)
   * Accepts optional userType parameter (customer, restaurant_owner, staff, admin)
   * Sends email with account setup link
   */
  app.post(
    "/api/staff/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const {
          email,
          firstName,
          lastName,
          phone,
          userType,
          businessName,
          address,
          cuisineType,
          latitude,
          longitude,
          locationType,
          footTraffic,
          amenities,
        } = req.body;
        const staffUser = req.user;

        if (!email || typeof email !== "string") {
          return res.status(400).json({ error: "Valid email is required" });
        }

        // Validate userType if provided
        const validUserTypes = [
          "customer",
          "restaurant_owner",
          "caterer",
          "private_chef",
          "food_truck",
          "host",
          "event_coordinator",
          "staff",
          "admin",
        ];
        const targetUserType =
          userType && validUserTypes.includes(userType) ? userType : "customer";

        // Only admins can create staff or admin accounts
        if (
          (targetUserType === "staff" || targetUserType === "admin") &&
          staffUser.userType !== "admin" &&
          staffUser.userType !== "super_admin"
        ) {
          return res
            .status(403)
            .json({ error: "Only admins can create staff or admin accounts" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await storage.getUserByEmail(normalizedEmail);
        if (existingUser) {
          return res
            .status(400)
            .json({ error: "User with this email already exists" });
        }

        // Create user without password - they'll set it via email link
        const user = await storage.createUserInvite({
          email: normalizedEmail,
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
          phone: phone?.trim() || null,
          userType: targetUserType,
        });

        // Internal team accounts should be able to log in immediately.
        if (targetUserType === "staff" || targetUserType === "admin") {
          await storage.updateUser(user.id, { emailVerified: true });
        }

        // Optionally create restaurant or host profiles
        if (
          (targetUserType === "restaurant_owner" ||
            targetUserType === "caterer" ||
            targetUserType === "private_chef" ||
            targetUserType === "food_truck") &&
          businessName &&
          address
        ) {
          await storage.createRestaurantForUser({
            userId: user.id,
            name: businessName,
            address,
            businessType:
              targetUserType === "food_truck"
                ? "food_truck"
                : targetUserType === "caterer"
                  ? "caterer"
                  : targetUserType === "private_chef"
                    ? "private_chef"
                    : "restaurant",
            isFoodTruck: targetUserType === "food_truck",
            offersCatering:
              targetUserType === "caterer" ||
              targetUserType === "private_chef",
            cuisineType: cuisineType || "Various",
          });
        }

        if (
          (targetUserType === "host" ||
            targetUserType === "event_coordinator") &&
          businessName &&
          address
        ) {
          const footTrafficMap: Record<string, number> = {
            low: 50,
            medium: 150,
            high: 300,
          };

          const amenitiesObj: Record<string, boolean> = {};
          if (Array.isArray(amenities)) {
            amenities.forEach((amenity: string) => {
              amenitiesObj[amenity] = true;
            });
          }

          const resolvedLocationType =
            targetUserType === "event_coordinator"
              ? "event_coordinator"
              : locationType || "other";

          const hostData: any = {
            userId: user.id,
            businessName,
            address,
            locationType: resolvedLocationType,
            expectedFootTraffic: footTrafficMap[footTraffic] || 100,
            amenities:
              Object.keys(amenitiesObj).length > 0 ? amenitiesObj : null,
            isVerified: true,
            adminCreated: true,
          };

          if (latitude && longitude) {
            hostData.latitude = latitude.toString();
            hostData.longitude = longitude.toString();
          }

          await storage.createHost(hostData);
        }

        const emailSent = await sendAccountSetupInvite({
          user,
          createdBy: staffUser,
          req,
        });

        // Audit log
        await logAudit(
          staffUser.id,
          "user_created_by_staff",
          "user",
          user.id,
          req.ip || "unknown",
          req.get("User-Agent") || "unknown",
          {
            createdUserType: targetUserType,
            createdByRole: staffUser.userType,
          },
        );

        res.json({
          success: true,
          userId: user.id,
          email: normalizedEmail,
          setupEmailSent: emailSent,
          message: `${targetUserType.replace(
            "_",
            " ",
          )} account created. Setup instructions sent to ${normalizedEmail}.`,
        });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ error: "Failed to create user account" });
      }
    },
  );

  /**
   * POST /api/staff/restaurant-owners
   * Create restaurant owner + optional restaurant shell (staff or admin)
   * Returns temp password that must be reset on first login
   */
  app.post(
    "/api/staff/restaurant-owners",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const {
          email,
          firstName,
          lastName,
          phone,
          restaurantName,
          restaurantAddress,
          restaurantPhone,
        } = req.body;
        const staffUser = req.user;

        if (!email || typeof email !== "string") {
          return res.status(400).json({ error: "Valid email is required" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await storage.getUserByEmail(normalizedEmail);
        if (existingUser) {
          return res
            .status(400)
            .json({ error: "User with this email already exists" });
        }

        const user = await storage.createUserInvite({
          email: normalizedEmail,
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
          phone: phone?.trim() || null,
          userType: "restaurant_owner",
        });

        let restaurantId: string | null = null;

        // If restaurant details provided, create shell
        if (restaurantName && restaurantName.trim()) {
          const restaurant = await storage.createRestaurant({
            ownerId: user.id,
            name: restaurantName.trim(),
            address: restaurantAddress?.trim() || "Address pending",
            city: "Pending",
            state: "Pending",
            phone: restaurantPhone?.trim() || null,
            businessType: "restaurant",
            cuisineType: "Cuisine pending",
            isActive: false, // Inactive until owner completes setup
          });
          restaurantId = restaurant.id;
          try {
            await ensurePremiumTrialForUserId(user.id);
          } catch (e) {
            console.warn("ensurePremiumTrialForUserId failed after staff create:", e);
          }
        }

        // Audit log
        const emailSent = await sendAccountSetupInvite({
          user,
          createdBy: staffUser,
          req,
        });

        await logAudit(
          staffUser.id,
          "restaurant_owner_created_by_staff",
          "user",
          user.id,
          req.ip || "unknown",
          req.get("User-Agent") || "unknown",
          {
            createdUserType: "restaurant_owner",
            createdByRole: staffUser.userType,
            restaurantCreated: !!restaurantId,
            restaurantId,
          },
        );

        res.json({
          success: true,
          userId: user.id,
          email: normalizedEmail,
          setupEmailSent: emailSent,
          restaurantId,
          message: restaurantId
            ? "Restaurant owner and restaurant shell created. Setup instructions sent by email."
            : "Restaurant owner created. Setup instructions sent by email.",
        });
      } catch (error) {
        console.error("Error creating restaurant owner:", error);
        res
          .status(500)
          .json({ error: "Failed to create restaurant owner account" });
      }
    },
  );

  /**
   * POST /api/account/force-password-reset
   * User forced to set new password after first login with temp password
   */
  app.post(
    "/api/account/force-password-reset",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const user = req.user;
        const { newPassword } = req.body;

        if (!user.mustResetPassword) {
          return res.status(400).json({ error: "Password reset not required" });
        }

        if (!newPassword || typeof newPassword !== "string") {
          return res
            .status(400)
            .json({ error: "Password is required" });
        }
        const { isPasswordStrong, PASSWORD_REQUIREMENTS } = await import(
          "./utils/passwordPolicy"
        );
        if (!isPasswordStrong(newPassword)) {
          return res.status(400).json({ error: PASSWORD_REQUIREMENTS });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await storage.updateUserPassword(user.id, passwordHash, false); // clear mustResetPassword flag

        // Audit log
        await logAudit(
          user.id,
          "password_reset_completed",
          "user",
          user.id,
          req.ip || "unknown",
          req.get("User-Agent") || "unknown",
          { forced: true },
        );

        res.json({ success: true, message: "Password updated successfully" });
      } catch (error) {
        console.error("Error resetting password:", error);
        res.status(500).json({ error: "Failed to reset password" });
      }
    },
  );
}
