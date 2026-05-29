import type { Express } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { storage } from "../storage";
import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import { sanitizeUser } from "../utils/sanitize";
import {
  isPasswordStrong,
  PASSWORD_REQUIREMENTS,
} from "../utils/passwordPolicy";
import {
  upload,
  uploadToCloudinary,
  isCloudinaryConfigured,
} from "../imageUpload";
import {
  insertUserAddressSchema,
  restaurantSubscriptions,
  suppliers,
} from "@shared/schema";
import { resolveEffectiveLocationContext } from "../services/sessionLocationContext";

const FIRST_PARTNER_MESSAGE =
  "As an appreciation of being our first MealScout Partner, 3D Eats now has lifetime free access to all paid features. Keep killin it.";

function isLikely3DEatsPartner(
  user: any,
  ownedRestaurants: Array<{ name?: string | null }>,
) {
  const firstName = String(user?.firstName || "")
    .trim()
    .toLowerCase();
  if (firstName !== "sean") return false;

  const hasExact3dEatsRestaurant = ownedRestaurants.some(
    (row) => String(row?.name || "").trim().toLowerCase() === "3d eats",
  );
  if (hasExact3dEatsRestaurant) return true;

  const allowlistedEmails = String(
    process.env.MEALSCOUT_FIRST_PARTNER_EMAILS || "",
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const email = String(user?.email || "")
    .trim()
    .toLowerCase();
  return email.length > 0 && allowlistedEmails.includes(email);
}

async function ensureFirstPartnerLifetimeAccess(user: any) {
  if (!user?.id) return user;
  if (!["restaurant_owner", "food_truck"].includes(String(user.userType || ""))) {
    return user;
  }

  const ownedRestaurants = await storage.getRestaurantsByOwner(String(user.id));
  if (!isLikely3DEatsPartner(user, ownedRestaurants as any[])) {
    return user;
  }

  const now = new Date();
  for (const restaurant of ownedRestaurants as any[]) {
    const restaurantId = String(restaurant?.id || "").trim();
    if (!restaurantId) continue;

    const [existing] = await db
      .select({
        id: restaurantSubscriptions.id,
        tier: restaurantSubscriptions.tier,
        status: restaurantSubscriptions.status,
        isLifetimeFree: restaurantSubscriptions.isLifetimeFree,
        lifetimeGrantedBy: restaurantSubscriptions.lifetimeGrantedBy,
        lifetimeReason: restaurantSubscriptions.lifetimeReason,
        canPostVideos: restaurantSubscriptions.canPostVideos,
        canPostDeals: restaurantSubscriptions.canPostDeals,
        canUseFeaturedSlots: restaurantSubscriptions.canUseFeaturedSlots,
        maxFeaturedSlots: restaurantSubscriptions.maxFeaturedSlots,
        hasAnalytics: restaurantSubscriptions.hasAnalytics,
        hasDealScheduling: restaurantSubscriptions.hasDealScheduling,
        canceledAt: restaurantSubscriptions.canceledAt,
      })
      .from(restaurantSubscriptions)
      .where(eq(restaurantSubscriptions.restaurantId, restaurantId))
      .limit(1);

    if (existing) {
      const alreadyGranted =
        existing.tier === "premium" &&
        existing.status === "active" &&
        existing.isLifetimeFree === true &&
        existing.lifetimeGrantedBy === "system:first-partner" &&
        existing.lifetimeReason === "First MealScout Partner - 3D Eats" &&
        existing.canPostVideos === true &&
        existing.canPostDeals === true &&
        existing.canUseFeaturedSlots === true &&
        existing.maxFeaturedSlots === 3 &&
        existing.hasAnalytics === true &&
        existing.hasDealScheduling === true &&
        existing.canceledAt == null;

      if (!alreadyGranted) {
        await db
          .update(restaurantSubscriptions)
          .set({
            tier: "premium",
            status: "active",
            isLifetimeFree: true,
            lifetimeGrantedBy: "system:first-partner",
            lifetimeGrantedAt: now,
            lifetimeReason: "First MealScout Partner - 3D Eats",
            canPostVideos: true,
            canPostDeals: true,
            canUseFeaturedSlots: true,
            maxFeaturedSlots: 3,
            hasAnalytics: true,
            hasDealScheduling: true,
            canceledAt: null,
            updatedAt: now,
          })
          .where(eq(restaurantSubscriptions.id, existing.id));
      }
    } else {
      await db.insert(restaurantSubscriptions).values({
        restaurantId,
        tier: "premium",
        status: "active",
        isLifetimeFree: true,
        lifetimeGrantedBy: "system:first-partner",
        lifetimeGrantedAt: now,
        lifetimeReason: "First MealScout Partner - 3D Eats",
        canPostVideos: true,
        canPostDeals: true,
        canUseFeaturedSlots: true,
        maxFeaturedSlots: 3,
        hasAnalytics: true,
        hasDealScheduling: true,
      });
    }
  }

  const currentSettings =
    user?.accountSettings && typeof user.accountSettings === "object"
      ? { ...(user.accountSettings as any) }
      : {};
  const existingPartnerProgram = currentSettings.partnerProgram || {};
  const existingAnnouncement = existingPartnerProgram.loginAnnouncement || null;
  const shouldQueueAnnouncement =
    !existingAnnouncement?.pending && !existingAnnouncement?.shownAt;
  const partnerProgram = {
    ...existingPartnerProgram,
    partnerKey: "3d-eats",
    lifetimeFreeAccess: true,
    lifetimeGrantedAt: existingPartnerProgram.lifetimeGrantedAt || now.toISOString(),
    loginAnnouncement: shouldQueueAnnouncement
      ? {
          message: FIRST_PARTNER_MESSAGE,
          pending: true,
          queuedAt: now.toISOString(),
        }
      : existingAnnouncement,
  };

  if (
    JSON.stringify(partnerProgram) ===
    JSON.stringify(currentSettings.partnerProgram || {})
  ) {
    return user;
  }

  const updated = await storage.updateUser(String(user.id), {
    accountSettings: {
      ...currentSettings,
      partnerProgram,
    } as any,
  });

  return updated || user;
}

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const publicProfileSettingsSchema = z.object({
  templatePreset: z.enum(["classic", "story", "bold", "minimal"]).optional(),
  theme: z.enum(["sunset", "slate", "forest", "amber"]).optional(),
  accentColor: z.string().max(32).optional(),
  fontFamily: z.enum(["system", "serif", "display", "mono"]).optional(),
  heroLayout: z.enum(["center", "left", "split"]).optional(),
  heroTitle: z.string().max(120).optional(),
  heroSubtitle: z.string().max(220).optional(),
  ctaLabel: z.string().max(50).optional(),
  ctaUrl: z.string().max(300).optional(),
  about: z.string().max(2000).optional(),
  highlights: z.array(z.string().max(120)).max(8).optional(),
  featuredLinks: z
    .array(
      z.object({
        label: z.string().max(40),
        url: z.string().max(300),
      }),
    )
    .max(8)
    .optional(),
  galleryUrls: z.array(z.string().max(500)).max(12).optional(),
  sectionOrder: z
    .array(
      z.enum([
        "about",
        "highlights",
        "links",
        "gallery",
        "contact",
        "location",
        "metrics",
      ]),
    )
    .max(12)
    .optional(),
  showAddress: z.boolean().optional(),
  showContact: z.boolean().optional(),
  showHours: z.boolean().optional(),
  hideProfileBadge: z.boolean().optional(),
});

const accountSettingsSchema = z.object({
  language: z.string().max(24).optional(),
  currency: z.string().max(12).optional(),
  locationServices: z.boolean().optional(),
  analytics: z.boolean().optional(),
  marketing: z.boolean().optional(),
  notifications: z
    .object({
      channels: z
        .object({
          push: z.boolean().optional(),
          email: z.boolean().optional(),
          sms: z.boolean().optional(),
        })
        .optional(),
      topics: z
        .object({
          dealAlerts: z.boolean().optional(),
          orderUpdates: z.boolean().optional(),
          newRestaurants: z.boolean().optional(),
          weeklyDigest: z.boolean().optional(),
          nearbyEvents: z.boolean().optional(),
          followedActivity: z.boolean().optional(),
          businessMessages: z.boolean().optional(),
          recommendations: z.boolean().optional(),
          account: z.boolean().optional(),
        })
        .optional(),
      location: z
        .object({
          enabled: z.boolean().optional(),
          radiusKm: z.number().min(0.5).max(50).optional(),
          maxPerDay: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
    })
    .optional(),
  privacy: z
    .object({
      profileVisibility: z.enum(["public", "private", "connections"]).optional(),
      showEmail: z.boolean().optional(),
      showPhone: z.boolean().optional(),
    })
    .optional(),
  customDomain: z
    .object({
      hostname: z.string().max(255).optional(),
      status: z.enum(["unverified", "verified", "mismatch", "error"]).optional(),
      lastCheckedAt: z.string().optional(),
      expectedTarget: z.string().optional(),
      diagnostics: z.string().optional(),
    })
    .optional(),
});

export function registerAuthAccountRoutes(app: Express) {
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      console.log(
        "📋 /api/auth/user called, isAuthenticated:",
        req.isAuthenticated(),
      );
      console.log("📋 Session ID:", req.sessionID);
      console.log("📋 Session data:", req.session);

      if (!req.isAuthenticated()) {
        console.log("❌ User not authenticated");
        return res.status(401).json({ error: "Not authenticated" });
      }

      let user = req.user;

      if (String(user?.userType || "") === "customer") {
        const ownedRestaurants = await storage.getRestaurantsByOwner(user.id);
        const hasFoodTruckProfile = ownedRestaurants.some(
          (row: any) =>
            Boolean(row?.isFoodTruck) ||
            String(row?.businessType || "").toLowerCase() === "food_truck",
        );

        if (hasFoodTruckProfile) {
          try {
            await storage.updateUserType(user.id, "food_truck");
            user = { ...user, userType: "food_truck" };
            req.user = user;
          } catch (roleFixError) {
            console.warn(
              "Unable to auto-correct userType to food_truck:",
              roleFixError,
            );
          }
        }
      }

      user = await ensureFirstPartnerLifetimeAccess(user);

      console.log("✅ Returning user:", user.id, user.email, user.userType);

      const safeUser: any = sanitizeUser(user) || {};
      const partnerProgram =
        user?.accountSettings && typeof user.accountSettings === "object"
          ? (user.accountSettings as any).partnerProgram
          : null;
      const pendingAnnouncement = partnerProgram?.loginAnnouncement;

      if (
        pendingAnnouncement &&
        pendingAnnouncement.pending === true &&
        String(pendingAnnouncement.message || "").trim()
      ) {
        safeUser.loginAnnouncement = String(pendingAnnouncement.message);

        try {
          const nextAccountSettings = {
            ...(user.accountSettings || {}),
            partnerProgram: {
              ...(partnerProgram || {}),
              loginAnnouncement: {
                ...pendingAnnouncement,
                pending: false,
                shownAt: new Date().toISOString(),
              },
            },
          };
          const updated = await storage.updateUser(user.id, {
            accountSettings: nextAccountSettings as any,
          });
          if (updated) {
            req.user = updated;
          }
        } catch (announcementError) {
          console.warn(
            "Unable to mark partner login announcement as shown:",
            announcementError,
          );
        }
      }

      if (user.mustResetPassword) {
        return res.json({
          ...safeUser,
          requiresPasswordReset: true,
          effectiveLocationContext: resolveEffectiveLocationContext(req, user),
        });
      }

      res.json({
        ...safeUser,
        effectiveLocationContext: resolveEffectiveLocationContext(req, user),
      });
    } catch (error) {
      console.error("❌ Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/location/context", isAuthenticated, async (req: any, res) => {
    try {
      res.json({
        effectiveLocationContext: resolveEffectiveLocationContext(req, req.user),
        adminMarketSelection: req.session?.adminMarketSelection || null,
        deviceLocationContext: req.session?.deviceLocationContext || null,
      });
    } catch (error) {
      console.error("Error fetching session location context:", error);
      res.status(500).json({ message: "Failed to fetch location context" });
    }
  });

  app.patch("/api/location/context", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        mode: z.enum(["device", "admin_override", "clear_admin_override"]),
        location: z
          .object({
            marketKey: z.string().min(2).max(64),
            city: z.string().max(120).optional(),
            state: z.string().max(64).optional(),
            latitude: z.number().finite().optional(),
            longitude: z.number().finite().optional(),
          })
          .optional(),
      });
      const parsed = schema.parse(req.body || {});
      const updatedAt = new Date().toISOString();

      if (parsed.mode === "clear_admin_override") {
        req.session.adminMarketSelection = undefined;
      } else {
        const payload = {
          marketKey: parsed.location?.marketKey || "",
          city: parsed.location?.city || null,
          state: parsed.location?.state || null,
          latitude:
            typeof parsed.location?.latitude === "number"
              ? parsed.location.latitude
              : null,
          longitude:
            typeof parsed.location?.longitude === "number"
              ? parsed.location.longitude
              : null,
          updatedAt,
        };
        if (parsed.mode === "admin_override") {
          req.session.adminMarketSelection = payload;
        } else {
          req.session.deviceLocationContext = payload;
        }
      }

      req.session.save((err: unknown) => {
        if (err) {
          console.error("Failed to persist location context session:", err);
          return res
            .status(500)
            .json({ message: "Failed to save location context" });
        }
        return res.json({
          effectiveLocationContext: resolveEffectiveLocationContext(req, req.user),
          adminMarketSelection: req.session?.adminMarketSelection || null,
          deviceLocationContext: req.session?.deviceLocationContext || null,
        });
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid location context payload", errors: error.errors });
      }
      console.error("Error updating session location context:", error);
      return res.status(500).json({ message: "Failed to update location context" });
    }
  });

  app.get("/api/settings/me", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const [ownedRestaurants, ownedHosts, ownedSuppliers] = await Promise.all([
        storage.getRestaurantsByOwner(user.id),
        storage.getHostsByUserId(user.id),
        db
          .select({
            id: suppliers.id,
            businessName: suppliers.businessName,
            isActive: suppliers.isActive,
          })
          .from(suppliers)
          .where(eq(suppliers.userId, user.id)),
      ]);

      const profileLinks = [
        ...ownedRestaurants
          .filter((row: any) => row?.isActive)
          .map((row: any) => ({
            entity: "restaurant",
            id: row.id,
            title: row.name,
            path: `/p/restaurant/${row.id}/${toSlug(row.name) || row.id}`,
          })),
        ...ownedHosts.map((row: any) => ({
          entity: "host",
          id: row.id,
          title: row.businessName,
          path: `/p/host/${row.id}/${toSlug(row.businessName) || row.id}`,
        })),
        ...ownedSuppliers
          .filter((row: any) => row?.isActive)
          .map((row: any) => ({
            entity: "supplier",
            id: row.id,
            title: row.businessName,
            path: `/p/supplier/${row.id}/${toSlug(row.businessName) || row.id}`,
          })),
      ];

      res.json({
        accountSettings: user.accountSettings || {},
        publicProfileSettings: user.publicProfileSettings || {},
        profileLinks,
        media: {
          provider: isCloudinaryConfigured() ? "cloudinary" : "none",
          configured: isCloudinaryConfigured(),
        },
      });
    } catch (error) {
      console.error("Error fetching user settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings/me", isAuthenticated, async (req: any, res) => {
    try {
      const payloadSchema = z.object({
        accountSettings: accountSettingsSchema.optional(),
        publicProfileSettings: publicProfileSettingsSchema.optional(),
      });
      const parsed = payloadSchema.parse(req.body || {});
      const current = await storage.getUser(req.user.id);
      if (!current) {
        return res.status(404).json({ message: "User not found" });
      }

      const nextAccountSettings = {
        ...(current.accountSettings || {}),
        ...(parsed.accountSettings || {}),
      };
      const nextPublicProfileSettings = {
        ...(current.publicProfileSettings || {}),
        ...(parsed.publicProfileSettings || {}),
      };

      const updated = await storage.updateUser(req.user.id, {
        accountSettings: nextAccountSettings as any,
        publicProfileSettings: nextPublicProfileSettings as any,
      });

      res.json({
        accountSettings: updated.accountSettings || {},
        publicProfileSettings: updated.publicProfileSettings || {},
      });
    } catch (error: any) {
      console.error("Error updating user settings:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid settings payload",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post(
    "/api/settings/public-profile/gallery",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Image upload service not configured" });
        }
        if (!req.file) {
          return res.status(400).json({ message: "No image file provided" });
        }
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "public-profiles",
          `profile-${user.id}-${Date.now()}`,
        );

        const current = (user.publicProfileSettings || {}) as any;
        const galleryUrls = Array.isArray(current.galleryUrls)
          ? current.galleryUrls
          : [];
        const nextGalleryUrls = [result.secureUrl, ...galleryUrls].slice(0, 12);

        await storage.updateUser(user.id, {
          publicProfileSettings: {
            ...current,
            galleryUrls: nextGalleryUrls,
          } as any,
        });

        res.json({
          url: result.secureUrl,
          thumbnailUrl: result.thumbnailUrl,
          galleryUrls: nextGalleryUrls,
        });
      } catch (error) {
        console.error("Error uploading public profile image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.post(
    "/api/settings/custom-domain/verify",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const payloadSchema = z.object({
          hostname: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Invalid hostname"),
        });
        const { hostname } = payloadSchema.parse(req.body || {});
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const dns = await import("dns/promises");
        const expectedTarget = String(
          process.env.PROFILE_DOMAIN_CNAME_TARGET ||
            process.env.RENDER_EXTERNAL_HOSTNAME ||
            (process.env.PUBLIC_BASE_URL || "mealscout.us")
              .replace(/^https?:\/\//, "")
              .replace(/\/+$/, ""),
        )
          .toLowerCase()
          .trim();
        let status: "unverified" | "verified" | "mismatch" | "error" =
          "unverified";
        let diagnostics = "";

        try {
          const cnames = await dns.resolveCname(hostname);
          const normalized = cnames.map((c) =>
            String(c || "")
              .toLowerCase()
              .replace(/\.$/, ""),
          );
          const expected = expectedTarget.replace(/\.$/, "");
          if (normalized.includes(expected)) {
            status = "verified";
          } else {
            status = "mismatch";
            diagnostics = `CNAME points to ${normalized.join(", ") || "none"}, expected ${expected}`;
          }
        } catch (e: any) {
          status = "error";
          diagnostics = e?.message || "DNS lookup failed";
        }

        const accountSettings = {
          ...(user.accountSettings || {}),
          customDomain: {
            hostname,
            status,
            lastCheckedAt: new Date().toISOString(),
            expectedTarget,
            diagnostics,
          },
        };
        await storage.updateUser(user.id, {
          accountSettings: accountSettings as any,
        });

        res.json(accountSettings.customDomain);
      } catch (error: any) {
        console.error("Error verifying custom domain:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid domain payload",
            errors: error.errors,
          });
        }
        res.status(500).json({ message: "Failed to verify custom domain" });
      }
    },
  );

  app.post(
    "/api/auth/change-temp-password",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const schema = z.object({
          currentPassword: z.string().min(1, "Current password is required"),
          newPassword: z
            .string()
            .min(1, PASSWORD_REQUIREMENTS)
            .refine(isPasswordStrong, PASSWORD_REQUIREMENTS),
        });

        const { currentPassword, newPassword } = schema.parse(req.body);
        const user = req.user;

        if (!user.passwordHash) {
          return res.status(400).json({
            success: false,
            error: "Account uses OAuth authentication",
          });
        }

        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) {
          return res.status(400).json({
            success: false,
            error: "Current password is incorrect",
          });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await storage.upsertUser({
          id: user.id,
          userType: user.userType,
          email: user.email!,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          passwordHash: hashedPassword,
          emailVerified: user.emailVerified,
          facebookId: user.facebookId,
          facebookAccessToken: user.facebookAccessToken,
          googleId: user.googleId,
          googleAccessToken: user.googleAccessToken,
          stripeCustomerId: user.stripeCustomerId,
          stripeSubscriptionId: user.stripeSubscriptionId,
          subscriptionBillingInterval: user.subscriptionBillingInterval,
          birthYear: user.birthYear,
          gender: user.gender,
          postalCode: user.postalCode,
          mustResetPassword: false,
        });

        res.json({
          success: true,
          message: "Password has been successfully changed",
        });
      } catch (error) {
        console.error("Password change error:", error);
        if (error instanceof z.ZodError) {
          res.status(400).json({
            success: false,
            error: "Invalid request",
            details: error.errors,
          });
        } else {
          res.status(500).json({
            success: false,
            error: "Unable to change password",
          });
        }
      }
    },
  );

  app.get("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const addresses = await storage.getUserAddresses(userId);
      res.json(addresses);
    } catch (error) {
      console.error("Error fetching user addresses:", error);
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  app.post("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const addressData = insertUserAddressSchema.parse({
        ...req.body,
        userId,
      });

      const address = await storage.createUserAddress(addressData);
      await storage.syncHostFromUserAddress(userId, address);
      res.status(201).json(address);
    } catch (error) {
      console.error("Error creating address:", error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Invalid address data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create address" });
      }
    }
  });

  app.put(
    "/api/user/addresses/:addressId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        const updates = insertUserAddressSchema.partial().parse(req.body);
        const updatedAddress = await storage.updateUserAddress(
          addressId,
          updates,
        );
        await storage.syncHostFromUserAddress(
          userId,
          updatedAddress,
          existingAddress,
        );
        res.json(updatedAddress);
      } catch (error) {
        console.error("Error updating address:", error);
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ message: "Invalid address data", errors: error.errors });
        } else {
          res.status(500).json({ message: "Failed to update address" });
        }
      }
    },
  );

  app.delete(
    "/api/user/addresses/:addressId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        await storage.deleteUserAddress(addressId);
        await storage.deleteHostForUserAddress(userId, existingAddress);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting address:", error);
        res.status(500).json({ message: "Failed to delete address" });
      }
    },
  );

  app.post(
    "/api/user/addresses/:addressId/set-default",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { addressId } = req.params;
        const userId = req.user.id;

        const existingAddress = await storage.getUserAddress(addressId);
        if (!existingAddress || existingAddress.userId !== userId) {
          return res.status(404).json({ message: "Address not found" });
        }

        await storage.setDefaultAddress(userId, addressId);
        res.status(200).json({ message: "Default address updated" });
      } catch (error) {
        console.error("Error setting default address:", error);
        res.status(500).json({ message: "Failed to set default address" });
      }
    },
  );
}
