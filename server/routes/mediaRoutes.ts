import type { Express } from "express";
import { eq } from "drizzle-orm";
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
import { imageUploads } from "@shared/schema";
import { hasBusinessPermissionForRestaurant } from "../services/businessTeamAccess";

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

        const appendPublicMediaEntry = async (mediaEntry: Record<string, unknown>) => {
          const refreshedRestaurant = await storage.getRestaurant(restaurantId);
          const existingSettings =
            refreshedRestaurant &&
            typeof (refreshedRestaurant as any).socialAutopostSettings === "object"
              ? { ...((refreshedRestaurant as any).socialAutopostSettings || {}) }
              : {};
          const existingGallery = Array.isArray((existingSettings as any).publicGalleryImages)
            ? [...((existingSettings as any).publicGalleryImages as any[])]
            : [];
          existingGallery.push(mediaEntry);
          await storage.updateRestaurant(restaurantId, {
            socialAutopostSettings: {
              ...existingSettings,
              publicGalleryImages: existingGallery,
            },
          });
        };

        await storage.updateRestaurant(restaurantId, {
          logoUrl: result.secureUrl,
        });
        await appendPublicMediaEntry({
          id: imageUpload[0]?.id || randomUUID(),
          url: result.secureUrl,
          source: "logo",
          category: "logo",
          publicApproved: true,
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading restaurant logo:", error);
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

        const appendPublicMediaEntry = async (mediaEntry: Record<string, unknown>) => {
          const refreshedRestaurant = await storage.getRestaurant(restaurantId);
          const existingSettings =
            refreshedRestaurant &&
            typeof (refreshedRestaurant as any).socialAutopostSettings === "object"
              ? { ...((refreshedRestaurant as any).socialAutopostSettings || {}) }
              : {};
          const existingGallery = Array.isArray((existingSettings as any).publicGalleryImages)
            ? [...((existingSettings as any).publicGalleryImages as any[])]
            : [];
          existingGallery.push(mediaEntry);
          await storage.updateRestaurant(restaurantId, {
            socialAutopostSettings: {
              ...existingSettings,
              publicGalleryImages: existingGallery,
            },
          });
        };

        await storage.updateRestaurant(restaurantId, {
          coverImageUrl: result.secureUrl,
        });
        await appendPublicMediaEntry({
          id: imageUpload[0]?.id || randomUUID(),
          url: result.secureUrl,
          source: "cover_image",
          category: "cover",
          publicApproved: true,
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading restaurant cover:", error);
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

        const existingSettings =
          restaurant &&
          typeof (restaurant as any).socialAutopostSettings === "object"
            ? { ...((restaurant as any).socialAutopostSettings || {}) }
            : {};
        const existingGallery = Array.isArray((existingSettings as any).publicGalleryImages)
          ? [...((existingSettings as any).publicGalleryImages as any[])]
          : [];
        const galleryEntry = {
          id: imageUpload?.id || randomUUID(),
          url: result.secureUrl,
          source: "gallery",
          category,
          publicApproved: Boolean(isStaffOrAdmin),
          uploadedAt: new Date().toISOString(),
          lastVerifiedAt: isStaffOrAdmin ? new Date().toISOString() : null,
        };
        existingGallery.push(galleryEntry);

        await storage.updateRestaurant(restaurantId, {
          socialAutopostSettings: {
            ...existingSettings,
            publicGalleryImages: existingGallery,
          },
        });

        res.json({
          imageUpload,
          media: galleryEntry,
          approvalStatus: galleryEntry.publicApproved ? "approved" : "pending",
        });
      } catch (error) {
        console.error("Error uploading restaurant gallery image:", error);
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

        const existingSettings =
          restaurant &&
          typeof (restaurant as any).socialAutopostSettings === "object"
            ? { ...((restaurant as any).socialAutopostSettings || {}) }
            : {};
        const existingGallery = Array.isArray((existingSettings as any).publicGalleryImages)
          ? [...((existingSettings as any).publicGalleryImages as any[])]
          : [];
        if (!existingGallery.length) {
          return res.status(404).json({ message: "No gallery images found" });
        }

        const requestedApproval =
          req.body?.publicApproved === undefined
            ? undefined
            : Boolean(req.body.publicApproved);
        const requestedCategory =
          typeof req.body?.category === "string"
            ? String(req.body.category).trim().toLowerCase()
            : undefined;

        let found = false;
        const updatedGallery = existingGallery.map((entry: any) => {
          if (String(entry?.id || "") !== mediaId) return entry;
          found = true;
          const nextEntry = { ...(entry || {}) } as any;
          if (requestedCategory) {
            nextEntry.category = requestedCategory;
          }
          if (requestedApproval !== undefined && isStaffOrAdmin) {
            nextEntry.publicApproved = requestedApproval;
            nextEntry.lastVerifiedAt = requestedApproval
              ? new Date().toISOString()
              : null;
          }
          return nextEntry;
        });
        if (!found) {
          return res.status(404).json({ message: "Gallery image not found" });
        }

        await storage.updateRestaurant(restaurantId, {
          socialAutopostSettings: {
            ...existingSettings,
            publicGalleryImages: updatedGallery,
          },
        });
        res.json({ success: true, mediaId });
      } catch (error) {
        console.error("Error updating restaurant gallery media:", error);
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
