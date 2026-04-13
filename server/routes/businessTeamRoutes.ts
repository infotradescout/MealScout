import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import {
  businessStaffInvites,
  businessStaffMemberships,
  restaurants,
  users,
} from "@shared/schema";
import {
  getBusinessAccessContext,
  getRestaurantOwnerUser,
  hasBusinessPermissionForRestaurant,
  normalizeBusinessPermissions,
} from "../services/businessTeamAccess";

const inviteCreateSchema = z.object({
  restaurantId: z.string().min(1),
  email: z.string().email().optional().nullable(),
  permissions: z.object({
    manageDeals: z.boolean().default(false),
    manageParkingPass: z.boolean().default(false),
    viewAnalytics: z.boolean().default(false),
    manageProfile: z.boolean().default(false),
  }),
  expiresInDays: z.number().int().min(1).max(90).optional().default(14),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(12),
});

const membershipUpdateSchema = z.object({
  permissions: z.object({
    manageDeals: z.boolean().default(false),
    manageParkingPass: z.boolean().default(false),
    viewAnalytics: z.boolean().default(false),
    manageProfile: z.boolean().default(false),
  }),
});

const isElevated = (user: any) =>
  user?.userType === "admin" ||
  user?.userType === "super_admin" ||
  user?.userType === "staff";

export function registerBusinessTeamRoutes(app: Express) {
  app.get("/api/business-access/me", isAuthenticated, async (req: any, res) => {
    try {
      const context = await getBusinessAccessContext(req.user.id);
      res.json(context);
    } catch (error) {
      console.error("Error loading business access context:", error);
      res.status(500).json({ message: "Failed to load business access context" });
    }
  });

  app.get("/api/business/team", isAuthenticated, async (req: any, res) => {
    try {
      const context = await getBusinessAccessContext(req.user.id);
      const accessibleRestaurantIds = context.restaurants
        .filter((r) => r.isOwner || isElevated(req.user))
        .map((r) => r.id);

      if (!accessibleRestaurantIds.length) {
        return res.json({ members: [], invites: [], restaurants: context.restaurants });
      }

      const members = await db
        .select({
          id: businessStaffMemberships.id,
          restaurantId: businessStaffMemberships.restaurantId,
          permissions: businessStaffMemberships.permissions,
          status: businessStaffMemberships.status,
          createdAt: businessStaffMemberships.createdAt,
          userId: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(businessStaffMemberships)
        .innerJoin(users, eq(users.id, businessStaffMemberships.userId))
        .where(eq(businessStaffMemberships.status, "active"))
        .orderBy(desc(businessStaffMemberships.createdAt));

      const scopedMembers = members.filter((m: { restaurantId: string }) =>
        accessibleRestaurantIds.includes(m.restaurantId),
      );

      const invites = await db
        .select({
          id: businessStaffInvites.id,
          restaurantId: businessStaffInvites.restaurantId,
          email: businessStaffInvites.email,
          permissions: businessStaffInvites.permissions,
          status: businessStaffInvites.status,
          expiresAt: businessStaffInvites.expiresAt,
          createdAt: businessStaffInvites.createdAt,
          acceptedAt: businessStaffInvites.acceptedAt,
        })
        .from(businessStaffInvites)
        .orderBy(desc(businessStaffInvites.createdAt));

      const scopedInvites = invites.filter((invite: { restaurantId: string }) =>
        accessibleRestaurantIds.includes(invite.restaurantId),
      );

      res.json({
        members: scopedMembers,
        invites: scopedInvites,
        restaurants: context.restaurants,
      });
    } catch (error) {
      console.error("Error loading business team:", error);
      res.status(500).json({ message: "Failed to load business team" });
    }
  });

  app.post("/api/business/team/invites", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = inviteCreateSchema.parse(req.body || {});
      const owner = await getRestaurantOwnerUser(parsed.restaurantId);
      if (!owner) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const canInvite =
        isElevated(req.user) || owner.ownerId === req.user.id;
      if (!canInvite) {
        return res.status(403).json({ message: "Only business owners can invite staff." });
      }

      const token = randomBytes(24).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(
        Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000,
      );

      const [invite] = await db
        .insert(businessStaffInvites)
        .values({
          restaurantId: parsed.restaurantId,
          createdByUserId: req.user.id,
          email: parsed.email || null,
          tokenHash,
          permissions: parsed.permissions,
          expiresAt,
          status: "pending",
          updatedAt: new Date(),
        })
        .returning();

      const baseUrl = (process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(
        /\/+$/,
        "",
      );
      const inviteUrl = `${baseUrl}/business-team/accept?token=${encodeURIComponent(token)}`;

      res.json({ invite, inviteUrl });
    } catch (error: any) {
      console.error("Error creating business staff invite:", error);
      res.status(400).json({ message: error?.message || "Failed to create invite" });
    }
  });

  app.post("/api/business/team/invites/accept", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = inviteAcceptSchema.parse(req.body || {});
      const tokenHash = createHash("sha256").update(parsed.token).digest("hex");

      const [invite] = await db
        .select()
        .from(businessStaffInvites)
        .where(eq(businessStaffInvites.tokenHash, tokenHash))
        .limit(1);

      if (!invite) {
        return res.status(404).json({ message: "Invite not found" });
      }
      if (invite.status !== "pending") {
        return res.status(400).json({ message: "Invite is no longer active" });
      }
      if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
        await db
          .update(businessStaffInvites)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(businessStaffInvites.id, invite.id));
        return res.status(400).json({ message: "Invite has expired" });
      }

      const inviteEmail = String(invite.email || "")
        .trim()
        .toLowerCase();
      const userEmail = String(req.user?.email || "")
        .trim()
        .toLowerCase();
      if (inviteEmail && (!userEmail || userEmail !== inviteEmail)) {
        return res.status(403).json({
          message: "This invite is assigned to a different email address.",
        });
      }

      const owner = await getRestaurantOwnerUser(invite.restaurantId);
      if (!owner) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const existing = await db
        .select({ id: businessStaffMemberships.id })
        .from(businessStaffMemberships)
        .where(
          and(
            eq(businessStaffMemberships.restaurantId, invite.restaurantId),
            eq(businessStaffMemberships.userId, req.user.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(businessStaffMemberships)
          .set({
            permissions: invite.permissions,
            status: "active",
            revokedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(businessStaffMemberships.id, existing[0].id));
      } else {
        await db.insert(businessStaffMemberships).values({
          restaurantId: invite.restaurantId,
          userId: req.user.id,
          invitedByUserId: invite.createdByUserId,
          permissions: invite.permissions,
          status: "active",
          updatedAt: new Date(),
        });
      }

      await db
        .update(businessStaffInvites)
        .set({
          status: "accepted",
          acceptedByUserId: req.user.id,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(businessStaffInvites.id, invite.id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error accepting business staff invite:", error);
      res.status(400).json({ message: error?.message || "Failed to accept invite" });
    }
  });

  app.patch(
    "/api/business/team/members/:membershipId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const parsed = membershipUpdateSchema.parse(req.body || {});
        const { membershipId } = req.params;
        const [membership] = await db
          .select()
          .from(businessStaffMemberships)
          .where(eq(businessStaffMemberships.id, membershipId))
          .limit(1);

        if (!membership) {
          return res.status(404).json({ message: "Membership not found" });
        }

        const owner = await getRestaurantOwnerUser(membership.restaurantId);
        if (!owner) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        if (!isElevated(req.user) && owner.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Only business owners can edit access." });
        }

        const [updated] = await db
          .update(businessStaffMemberships)
          .set({
            permissions: parsed.permissions,
            updatedAt: new Date(),
          })
          .where(eq(businessStaffMemberships.id, membershipId))
          .returning();
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating business team member:", error);
        res.status(400).json({ message: error?.message || "Failed to update member" });
      }
    },
  );

  app.delete(
    "/api/business/team/members/:membershipId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { membershipId } = req.params;
        const [membership] = await db
          .select()
          .from(businessStaffMemberships)
          .where(eq(businessStaffMemberships.id, membershipId))
          .limit(1);

        if (!membership) {
          return res.status(404).json({ message: "Membership not found" });
        }
        const owner = await getRestaurantOwnerUser(membership.restaurantId);
        if (!owner) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        if (!isElevated(req.user) && owner.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Only business owners can remove members." });
        }

        await db
          .update(businessStaffMemberships)
          .set({
            status: "revoked",
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(businessStaffMemberships.id, membershipId));
        res.json({ success: true });
      } catch (error: any) {
        console.error("Error removing business team member:", error);
        res.status(400).json({ message: error?.message || "Failed to remove member" });
      }
    },
  );

  app.post(
    "/api/business/team/invites/:inviteId/revoke",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { inviteId } = req.params;
        const [invite] = await db
          .select()
          .from(businessStaffInvites)
          .where(eq(businessStaffInvites.id, inviteId))
          .limit(1);
        if (!invite) {
          return res.status(404).json({ message: "Invite not found" });
        }

        const owner = await getRestaurantOwnerUser(invite.restaurantId);
        if (!owner) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        if (!isElevated(req.user) && owner.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Only business owners can revoke invites." });
        }

        await db
          .update(businessStaffInvites)
          .set({
            status: "revoked",
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(businessStaffInvites.id, inviteId));
        res.json({ success: true });
      } catch (error: any) {
        console.error("Error revoking invite:", error);
        res.status(400).json({ message: error?.message || "Failed to revoke invite" });
      }
    },
  );

  app.get(
    "/api/business/team/permissions/:restaurantId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const permissions = {
          manageDeals: await hasBusinessPermissionForRestaurant(
            req.user.id,
            restaurantId,
            "manageDeals",
          ),
          manageParkingPass: await hasBusinessPermissionForRestaurant(
            req.user.id,
            restaurantId,
            "manageParkingPass",
          ),
          viewAnalytics: await hasBusinessPermissionForRestaurant(
            req.user.id,
            restaurantId,
            "viewAnalytics",
          ),
          manageProfile: await hasBusinessPermissionForRestaurant(
            req.user.id,
            restaurantId,
            "manageProfile",
          ),
        };
        res.json({ permissions: normalizeBusinessPermissions(permissions) });
      } catch (error) {
        console.error("Error loading business team permissions:", error);
        res.status(500).json({ message: "Failed to load permissions" });
      }
    },
  );
}
