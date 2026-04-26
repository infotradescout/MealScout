import type { Express } from "express";
import { eq } from "drizzle-orm";

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

export function registerMediaRoutes(app: Express) {
  const isAdminUser = (user: any) =>
    user?.userType === "admin" || user?.userType === "super_admin";

  const canManageRestaurant = (user: any, restaurant: any) =>
    Boolean(restaurant) &&
    (isAdminUser(user) ||
      String(restaurant.ownerId) === String(user?.id || ""));

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
        if (!canManageRestaurant(req.user, restaurant)) {
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

        await storage.updateRestaurant(restaurantId, {
          logoUrl: result.secureUrl,
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
        if (!canManageRestaurant(req.user, restaurant)) {
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

        await storage.updateRestaurant(restaurantId, {
          coverImageUrl: result.secureUrl,
        });

        res.json({ imageUpload: imageUpload[0], url: result.secureUrl });
      } catch (error) {
        console.error("Error uploading restaurant cover:", error);
        res.status(500).json({ message: "Failed to upload image" });
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
        if (!canManageRestaurant(req.user, restaurant)) {
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

        const requestedTargetUserId = String(req.body?.targetUserId || "").trim();
        const hasTargetOverride = requestedTargetUserId.length > 0;
        const targetUserId = hasTargetOverride
          ? requestedTargetUserId
          : String(req.user.id);

        if (hasTargetOverride && !isAdminUser(req.user)) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const targetUser = await storage.getUser(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ message: "Target user not found" });
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
        } as any);

        res.json({
          imageUpload: imageUpload[0],
          url: result.secureUrl,
          userId: targetUserId,
        });
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
