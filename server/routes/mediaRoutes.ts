import type { Express } from "express";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import {
  deleteFromCloudinary,
  isCloudinaryConfigured,
  upload,
  uploadToCloudinary,
} from "../imageUpload";
import { imageUploads, restaurants } from "@shared/schema";
import { hasBusinessPermissionForRestaurant } from "../services/businessTeamAccess";

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const safePersistenceErrorContext = (error: unknown) => {
  const record = asRecord(error);
  return {
    errorName:
      typeof record.name === "string" ? record.name.slice(0, 80) : "Error",
    errorCode:
      typeof record.code === "string" ? record.code.slice(0, 80) : "unknown",
  };
};

export const appendRestaurantGalleryEntry = (
  settingsValue: unknown,
  mediaEntry: Record<string, unknown>,
) => {
  const settings = asRecord(settingsValue);
  const publicGalleryImages = Array.isArray(settings.publicGalleryImages)
    ? [...settings.publicGalleryImages, mediaEntry]
    : [mediaEntry];
  return { ...settings, publicGalleryImages };
};

export const updateRestaurantGalleryEntry = (input: {
  settingsValue: unknown;
  mediaId: string;
  category?: string;
  publicApproved?: boolean;
  canModerate: boolean;
  verifiedAt: string;
}) => {
  const settings = asRecord(input.settingsValue);
  const gallery = Array.isArray(settings.publicGalleryImages)
    ? [...settings.publicGalleryImages]
    : [];
  if (!gallery.length) {
    return { status: "empty" as const, settings };
  }
  let found = false;
  const publicGalleryImages = gallery.map((entry: unknown) => {
    const current = asRecord(entry);
    if (String(current.id || "") !== input.mediaId) return entry;
    found = true;
    const nextEntry = { ...current };
    if (input.category) nextEntry.category = input.category;
    if (input.publicApproved !== undefined && input.canModerate) {
      nextEntry.publicApproved = input.publicApproved;
      nextEntry.lastVerifiedAt = input.publicApproved ? input.verifiedAt : null;
    }
    return nextEntry;
  });
  if (!found) return { status: "not_found" as const, settings };
  return {
    status: "updated" as const,
    settings: { ...settings, publicGalleryImages },
  };
};

export const createLockedRestaurantSettingsMutation = (database: any) =>
  async <T>(
    restaurantId: string,
    mutate: (tx: any, restaurant: Record<string, any>) => Promise<T>,
  ): Promise<T | null> =>
    database.transaction(async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${restaurantId}))`,
      );
      const [restaurant] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1)
        .for("update");
      if (!restaurant) return null;
      return mutate(tx, restaurant as Record<string, any>);
    });

const withLockedRestaurantSettings =
  createLockedRestaurantSettingsMutation(db);

export function registerMediaRoutes(app: Express) {
  const isStaffOrAdminUserType = (userType?: string | null) =>
    userType === "staff" ||
    userType === "admin" ||
    userType === "duper_admin" ||
    userType === "super_admin";

  app.post(
    "/api/upload/restaurant-logo",
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

        const restaurantId = req.body.restaurantId;
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID required" });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        const isStaffOrAdmin = isStaffOrAdminUserType(req.user?.userType);
        const hasManageProfilePermission = isStaffOrAdmin
          ? true
          : await hasBusinessPermissionForRestaurant(
              String(req.user.id),
              String(restaurantId),
              "manageProfile",
            );
        if (!hasManageProfilePermission) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "restaurant-logos",
          `restaurant-${restaurantId}-logo`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "restaurant_logo",
            entityId: restaurantId,
            entityType: "restaurant",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        const mediaEntry = {
          id: imageUpload[0]?.id || randomUUID(),
          url: result.secureUrl,
          source: "logo",
          category: "logo",
          publicApproved: true,
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
        };
        const updated = await withLockedRestaurantSettings(
          String(restaurantId),
          async (tx, lockedRestaurant) => {
            const [nextRestaurant] = await tx
              .update(restaurants)
              .set({
                logoUrl: result.secureUrl,
                socialAutopostSettings: appendRestaurantGalleryEntry(
                  lockedRestaurant.socialAutopostSettings,
                  mediaEntry,
                ),
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, String(restaurantId)))
              .returning();
            return nextRestaurant;
          },
        );
        if (!updated) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error(
          "Restaurant logo persistence failed",
          safePersistenceErrorContext(error),
        );
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.post(
    "/api/upload/restaurant-cover",
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

        const restaurantId = req.body.restaurantId;
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID required" });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        const isStaffOrAdmin = isStaffOrAdminUserType(req.user?.userType);
        const hasManageProfilePermission = isStaffOrAdmin
          ? true
          : await hasBusinessPermissionForRestaurant(
              String(req.user.id),
              String(restaurantId),
              "manageProfile",
            );
        if (!hasManageProfilePermission) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "restaurant-covers",
          `restaurant-${restaurantId}-cover`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "restaurant_cover",
            entityId: restaurantId,
            entityType: "restaurant",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        const mediaEntry = {
          id: imageUpload[0]?.id || randomUUID(),
          url: result.secureUrl,
          source: "cover_image",
          category: "cover",
          publicApproved: true,
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
        };
        const updated = await withLockedRestaurantSettings(
          String(restaurantId),
          async (tx, lockedRestaurant) => {
            const [nextRestaurant] = await tx
              .update(restaurants)
              .set({
                coverImageUrl: result.secureUrl,
                socialAutopostSettings: appendRestaurantGalleryEntry(
                  lockedRestaurant.socialAutopostSettings,
                  mediaEntry,
                ),
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, String(restaurantId)))
              .returning();
            return nextRestaurant;
          },
        );
        if (!updated) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error(
          "Restaurant cover persistence failed",
          safePersistenceErrorContext(error),
        );
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.post(
    "/api/upload/restaurant-gallery",
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

        const restaurantId = String(req.body.restaurantId || "").trim();
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID required" });
        }
        const allowedCategories = new Set([
          "food",
          "menu",
          "storefront",
          "truck",
          "atmosphere",
          "owner_staff",
          "other",
        ]);
        const categoryRaw = String(req.body.category || "other")
          .trim()
          .toLowerCase();
        const category = allowedCategories.has(categoryRaw) ? categoryRaw : "other";

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        const isStaffOrAdmin = isStaffOrAdminUserType(req.user?.userType);
        const hasManageProfilePermission = isStaffOrAdmin
          ? true
          : await hasBusinessPermissionForRestaurant(
              String(req.user.id),
              String(restaurantId),
              "manageProfile",
            );
        if (!hasManageProfilePermission) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "restaurant-gallery",
          `restaurant-${restaurantId}-${category}-${Date.now()}`,
        );

        const imageUploadRows = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: `restaurant_gallery_${category}`,
            entityId: restaurantId,
            entityType: "restaurant",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();
        const imageUpload = imageUploadRows[0];

        // There is no admin-wide queue that surfaces pending gallery
        // uploads across restaurants (only a per-restaurant approve button
        // in this same owner dashboard), so uploads from non-staff owners
        // were effectively stuck "Pending" forever unless a staff member
        // happened to open that specific restaurant. Verified restaurants
        // are already trusted elsewhere in the app (auto-verify, badges),
        // so skip the moderation queue for them too.
        const isTrustedUploader = isStaffOrAdmin || Boolean((restaurant as any)?.isVerified);
        const galleryEntry = {
          id: imageUpload?.id || randomUUID(),
          url: result.secureUrl,
          source: "gallery",
          category,
          publicApproved: isTrustedUploader,
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: isTrustedUploader ? new Date().toISOString() : null,
        };
        const updated = await withLockedRestaurantSettings(
          restaurantId,
          async (tx, lockedRestaurant) => {
            const [nextRestaurant] = await tx
              .update(restaurants)
              .set({
                socialAutopostSettings: appendRestaurantGalleryEntry(
                  lockedRestaurant.socialAutopostSettings,
                  galleryEntry,
                ),
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, restaurantId))
              .returning();
            return nextRestaurant;
          },
        );
        if (!updated) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        res.json({
          imageUpload,
          media: galleryEntry,
          approvalStatus: galleryEntry.publicApproved ? "approved" : "pending",
        });
      } catch (error) {
        console.error(
          "Restaurant gallery persistence failed",
          safePersistenceErrorContext(error),
        );
        res.status(500).json({ message: "Failed to upload gallery image" });
      }
    },
  );

  app.patch(
    "/api/restaurants/:restaurantId/media-gallery/:mediaId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = String(req.params.restaurantId || "").trim();
        const mediaId = String(req.params.mediaId || "").trim();
        if (!restaurantId || !mediaId) {
          return res.status(400).json({ message: "Restaurant and media id are required" });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        const isStaffOrAdmin = isStaffOrAdminUserType(req.user?.userType);
        const hasManageProfilePermission = isStaffOrAdmin
          ? true
          : await hasBusinessPermissionForRestaurant(
              String(req.user.id),
              String(restaurantId),
              "manageProfile",
            );
        if (!hasManageProfilePermission) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const requestedApproval =
          req.body?.publicApproved === undefined
            ? undefined
            : Boolean(req.body.publicApproved);
        const requestedCategory =
          typeof req.body?.category === "string"
            ? String(req.body.category).trim().toLowerCase()
            : undefined;

        const outcome = await withLockedRestaurantSettings(
          restaurantId,
          async (tx, lockedRestaurant) => {
            const galleryUpdate = updateRestaurantGalleryEntry({
              settingsValue: lockedRestaurant.socialAutopostSettings,
              mediaId,
              category: requestedCategory,
              publicApproved: requestedApproval,
              canModerate: isStaffOrAdmin,
              verifiedAt: new Date().toISOString(),
            });
            if (galleryUpdate.status !== "updated") return galleryUpdate.status;
            await tx
              .update(restaurants)
              .set({
                socialAutopostSettings: galleryUpdate.settings,
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, restaurantId));
            return galleryUpdate.status;
          },
        );
        if (outcome === null) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        if (outcome === "empty") {
          return res.status(404).json({ message: "No gallery images found" });
        }
        if (outcome === "not_found") {
          return res.status(404).json({ message: "Gallery image not found" });
        }
        res.json({ success: true, mediaId });
      } catch (error) {
        console.error(
          "Restaurant gallery update failed",
          safePersistenceErrorContext(error),
        );
        res.status(500).json({ message: "Failed to update gallery media" });
      }
    },
  );

  app.post(
    "/api/upload/deal-image",
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

        const dealId = req.body.dealId;
        if (!dealId) {
          return res.status(400).json({ message: "Deal ID required" });
        }

        const deal = await storage.getDeal(dealId);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        const restaurant = await storage.getRestaurant(deal.restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        if (
          restaurant.ownerId !== req.user.id &&
          !isStaffOrAdminUserType(req.user?.userType)
        ) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "deal-images",
          `deal-${dealId}`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "deal",
            entityId: dealId,
            entityType: "deal",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        await storage.updateDeal(dealId, { imageUrl: result.secureUrl });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading deal image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.post(
    "/api/upload/user-profile",
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

        const targetUserId = String(req.body.userId || req.user.id || "").trim();
        if (!targetUserId) {
          return res.status(400).json({ message: "User ID required" });
        }
        if (
          targetUserId !== req.user.id &&
          !isStaffOrAdminUserType(req.user?.userType)
        ) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const targetUser = await storage.getUser(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ message: "User not found" });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "user-profiles",
          `user-${targetUserId}`,
        );

        const imageUpload = await db
          .insert(imageUploads)
          .values({
            uploadedByUserId: req.user.id,
            imageType: "user_profile",
            entityId: targetUserId,
            entityType: "user",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          })
          .returning();

        await storage.upsertUser({
          ...targetUser,
          profileImageUrl: result.secureUrl,
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading user profile image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.delete("/api/upload/:imageId", isAuthenticated, async (req: any, res) => {
    try {
      const imageId = req.params.imageId;
      const images = await db
        .select()
        .from(imageUploads)
        .where(eq(imageUploads.id, imageId))
        .limit(1);
      const image = images[0];

      if (!image) {
        return res.status(404).json({ message: "Image not found" });
      }

      if (
        image.uploadedByUserId !== req.user.id &&
        req.user.userType !== "admin" &&
        req.user.userType !== "duper_admin" &&
        req.user.userType !== "super_admin"
      ) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (image.cloudinaryPublicId) {
        await deleteFromCloudinary(image.cloudinaryPublicId);
      }

      await db.delete(imageUploads).where(eq(imageUploads.id, imageId));

      res.json({ message: "Image deleted successfully" });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ message: "Failed to delete image" });
    }
  });
}
