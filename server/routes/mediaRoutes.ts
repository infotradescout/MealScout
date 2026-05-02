import type { Express } from "express";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import {
  deleteFromCloudinary,
  isCloudinaryConfigured,
  upload,
  uploadToCloudinary,
  uploadVideo,
  uploadVideoToCloudinary,
} from "../imageUpload";
import {
  imageUploads,
  mediaAssets,
  mediaOwnerTypes,
  mediaStatuses,
  mediaVisibilities,
  users,
  videoStories,
  type MediaOwnerType,
  type MediaStatus,
  type MediaVisibility,
} from "@shared/schema";

const mediaOwnerTypeSet = new Set<string>(mediaOwnerTypes);
const mediaStatusSet = new Set<string>(mediaStatuses);
const mediaVisibilitySet = new Set<string>(mediaVisibilities);
const PUBLIC_USER_RECOMMENDATION_VIDEO_LIMIT = 8;

export type PublicUserVideoRecommendationRow = {
  id: string;
  title: string | null;
  description: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  status: string | null;
  isApproved: boolean | null;
  deletedAt: Date | string | null;
  expiresAt: Date | string | null;
  createdAt: Date | string | null;
  userId: string | null;
  authorName: string | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  viewCount: number | null;
};

const toOptionalDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export type PublicMediaAssetVideoRow = {
  id: string;
  title: string | null;
  description: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  mediaType: string | null;
  status: string | null;
  visibility: string | null;
  isFeatured: boolean | null;
  createdAt: Date | string | null;
};

export const isPublicMediaAssetVideoRenderable = (
  row: PublicMediaAssetVideoRow,
) => {
  if (!row.fileUrl) return false;
  if (row.mediaType !== "video") return false;
  if (row.status !== "active") return false;
  if (row.visibility !== "public") return false;

  return true;
};

const dateSortValue = (value: Date | string | null | undefined) =>
  toOptionalDate(value)?.getTime() ?? 0;

export const comparePublicMediaAssetVideos = (
  left: PublicMediaAssetVideoRow,
  right: PublicMediaAssetVideoRow,
) => {
  const featuredDelta = Number(Boolean(right.isFeatured)) - Number(Boolean(left.isFeatured));
  if (featuredDelta !== 0) return featuredDelta;

  return dateSortValue(right.createdAt) - dateSortValue(left.createdAt);
};

export const toPublicMediaAssetVideo = (row: PublicMediaAssetVideoRow) => ({
  id: row.id,
  title: String(row.title || "").trim() || "Profile video",
  description: row.description || null,
  fileUrl: row.fileUrl || "",
  thumbnailUrl: row.thumbnailUrl || null,
  durationSeconds: Number(row.durationSeconds || 0) || null,
  isFeatured: Boolean(row.isFeatured),
});

export const isPublicUserVideoRecommendationRenderable = (
  row: PublicUserVideoRecommendationRow,
  now = new Date(),
) => {
  if (!row.fileUrl) return false;
  if (row.status !== "ready") return false;
  if (row.isApproved === false) return false;
  if (row.deletedAt) return false;

  const expiresAt = toOptionalDate(row.expiresAt);
  if (expiresAt && expiresAt.getTime() < now.getTime()) return false;

  return true;
};

export const toPublicUserVideoRecommendation = (
  row: PublicUserVideoRecommendationRow,
) => ({
  id: row.id,
  title: row.title || "Food recommendation",
  description: row.description || null,
  fileUrl: row.fileUrl || "",
  thumbnailUrl: row.thumbnailUrl || null,
  durationSeconds: Number(row.durationSeconds || 0) || null,
  createdAt: row.createdAt || null,
  userId: row.userId || null,
  authorName: String(row.authorName || "").trim() || "MealScout diner",
  likeCount: Number(row.likeCount || 0),
  commentCount: Number(row.commentCount || 0),
  shareCount: Number(row.shareCount || 0),
  viewCount: Number(row.viewCount || 0),
  storyUrl: `/video/${row.id}`,
  source: "user_recommendation" as const,
});

export function registerMediaRoutes(app: Express) {
  const isAdminUser = (user: any) =>
    user?.userType === "admin" || user?.userType === "super_admin";

  const canManageRestaurant = (user: any, restaurant: any) =>
    Boolean(restaurant) &&
    (isAdminUser(user) ||
      String(restaurant.ownerId) === String(user?.id || ""));

  const normalizeOwnerType = (value: unknown): MediaOwnerType | null => {
    const ownerType = String(value || "").trim();
    return mediaOwnerTypeSet.has(ownerType) ? (ownerType as MediaOwnerType) : null;
  };

  const normalizeVisibility = (value: unknown): MediaVisibility => {
    const visibility = String(value || "public").trim();
    return mediaVisibilitySet.has(visibility)
      ? (visibility as MediaVisibility)
      : "public";
  };

  const normalizeStatus = (value: unknown): MediaStatus | null => {
    const status = String(value || "").trim();
    return mediaStatusSet.has(status) ? (status as MediaStatus) : null;
  };

  const boolFromBody = (value: unknown) =>
    value === true || String(value || "").toLowerCase() === "true";

  const canManageOwner = async (
    user: any,
    ownerType: MediaOwnerType,
    ownerId: string,
  ) => {
    if (isAdminUser(user)) return true;

    if (ownerType === "user") {
      return String(user?.id || "") === String(ownerId);
    }

    if (ownerType === "restaurant" || ownerType === "food_truck") {
      const restaurant = await storage.getRestaurant(ownerId);
      if (!restaurant) return false;
      if (ownerType === "food_truck") {
        const isTruck =
          restaurant.isFoodTruck === true ||
          String(restaurant.businessType || "") === "food_truck";
        if (!isTruck) return false;
      }
      return canManageRestaurant(user, restaurant);
    }

    // Host and event ownership is more contextual in MealScout. Until those
    // ownership joins are centralized, only admins can mutate host/event videos.
    return false;
  };

  const assertAdmin = (req: any, res: any) => {
    if (!isAdminUser(req.user)) {
      res.status(403).json({ message: "Admin access required" });
      return false;
    }
    return true;
  };

  const unsetFeaturedVideosForOwner = async (
    ownerType: MediaOwnerType,
    ownerId: string,
  ) => {
    await db
      .update(mediaAssets)
      .set({ isFeatured: false, updatedAt: new Date() })
      .where(
        and(
          eq(mediaAssets.ownerType, ownerType),
          eq(mediaAssets.ownerId, ownerId),
          eq(mediaAssets.mediaType, "video"),
          eq(mediaAssets.isFeatured, true),
        ),
      );
  };

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

  app.get("/api/media/:ownerType/:ownerId/videos", async (req, res) => {
    try {
      const ownerType = normalizeOwnerType(req.params.ownerType);
      const ownerId = String(req.params.ownerId || "").trim();

      if (!ownerType || !ownerId) {
        return res.status(400).json({ message: "Valid owner type and owner ID required" });
      }

      const videoRows = (await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.ownerType, ownerType),
            eq(mediaAssets.ownerId, ownerId),
            eq(mediaAssets.mediaType, "video"),
            eq(mediaAssets.status, "active"),
            eq(mediaAssets.visibility, "public"),
          ),
        )
        .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt))) as PublicMediaAssetVideoRow[];

      const videos = videoRows
        .filter((row) => isPublicMediaAssetVideoRenderable(row))
        .sort(comparePublicMediaAssetVideos)
        .map((row) => toPublicMediaAssetVideo(row));

      let recommendationVideos: ReturnType<typeof toPublicUserVideoRecommendation>[] = [];

      if (ownerType === "restaurant" || ownerType === "food_truck") {
        const recommendationRows = (await db
          .select({
            id: videoStories.id,
            title: videoStories.title,
            description: videoStories.description,
            fileUrl: videoStories.videoUrl,
            thumbnailUrl: videoStories.thumbnailUrl,
            durationSeconds: videoStories.duration,
            status: videoStories.status,
            isApproved: videoStories.isApproved,
            deletedAt: videoStories.deletedAt,
            expiresAt: videoStories.expiresAt,
            createdAt: videoStories.createdAt,
            userId: videoStories.userId,
            authorName: sql<string>`trim(concat_ws(' ', ${users.firstName}, ${users.lastName}))`,
            likeCount: videoStories.likeCount,
            commentCount: videoStories.commentCount,
            shareCount: videoStories.shareCount,
            viewCount: videoStories.viewCount,
          })
          .from(videoStories)
          .leftJoin(users, eq(videoStories.userId, users.id))
          .where(
            and(
              eq(videoStories.restaurantId, ownerId),
              eq(videoStories.status, "ready"),
              eq(videoStories.isApproved, true),
              isNull(videoStories.deletedAt),
              gte(videoStories.expiresAt, sql`NOW()`),
            ),
          )
          .orderBy(desc(videoStories.isFeatured), desc(videoStories.createdAt))
          .limit(PUBLIC_USER_RECOMMENDATION_VIDEO_LIMIT)) as PublicUserVideoRecommendationRow[];

        recommendationVideos = recommendationRows
          .filter((row) => isPublicUserVideoRecommendationRenderable(row))
          .map((row) => toPublicUserVideoRecommendation(row));
      }

      res.json({ videos, recommendationVideos });
    } catch (error) {
      console.error("Error loading public videos:", error);
      res.status(500).json({ message: "Failed to load videos" });
    }
  });

  app.get(
    "/api/media/manage/:ownerType/:ownerId/videos",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const ownerType = normalizeOwnerType(req.params.ownerType);
        const ownerId = String(req.params.ownerId || "").trim();

        if (!ownerType || !ownerId) {
          return res.status(400).json({ message: "Valid owner type and owner ID required" });
        }

        if (!(await canManageOwner(req.user, ownerType, ownerId))) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const videos = await db
          .select()
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.ownerType, ownerType),
              eq(mediaAssets.ownerId, ownerId),
              eq(mediaAssets.mediaType, "video"),
            ),
          )
          .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt));

        res.json({ videos });
      } catch (error) {
        console.error("Error loading managed videos:", error);
        res.status(500).json({ message: "Failed to load videos" });
      }
    },
  );

  app.post(
    "/api/media/videos",
    isAuthenticated,
    uploadVideo.single("video"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Video upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No video file provided" });
        }

        const ownerType = normalizeOwnerType(req.body.ownerType);
        const ownerId = String(req.body.ownerId || "").trim();
        if (!ownerType || !ownerId) {
          return res.status(400).json({ message: "Valid owner type and owner ID required" });
        }

        if (!(await canManageOwner(req.user, ownerType, ownerId))) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const isFeatured = boolFromBody(req.body.isFeatured);
        const requestedStatus = normalizeStatus(req.body.status);
        const status = isAdminUser(req.user) && requestedStatus
          ? requestedStatus
          : "processing";
        const visibility = normalizeVisibility(req.body.visibility);
        const safeOwnerSegment = `${ownerType}-${ownerId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        const result = await uploadVideoToCloudinary(
          req.file.buffer,
          `videos/${ownerType}`,
          `${safeOwnerSegment}-${Date.now()}`,
        );

        if (isFeatured) {
          await unsetFeaturedVideosForOwner(ownerType, ownerId);
        }

        const rows = await db
          .insert(mediaAssets)
          .values({
            ownerType,
            ownerId,
            mediaType: "video",
            title: String(req.body.title || "").trim() || null,
            description: String(req.body.description || "").trim() || null,
            fileUrl: result.secureUrl,
            thumbnailUrl: String(req.body.thumbnailUrl || "").trim() || result.thumbnailUrl,
            durationSeconds: result.durationSeconds || null,
            status,
            visibility,
            uploadedByUserId: req.user.id,
            cloudinaryPublicId: result.publicId,
            fileSize: result.bytes || req.file.size,
            mimeType: req.file.mimetype,
            isFeatured,
          })
          .returning();

        res.status(201).json({ video: rows[0] });
      } catch (error: any) {
        console.error("Error uploading video:", error);
        res.status(500).json({
          message: error?.message || "Failed to upload video",
        });
      }
    },
  );

  app.post(
    "/api/media/:mediaId/replace",
    isAuthenticated,
    uploadVideo.single("video"),
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Video upload service not configured" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No replacement video file provided" });
        }

        const existingRows = await db
          .select()
          .from(mediaAssets)
          .where(eq(mediaAssets.id, req.params.mediaId))
          .limit(1);
        const existing = existingRows[0];

        if (!existing || existing.status === "deleted") {
          return res.status(404).json({ message: "Video not found" });
        }

        if (!(await canManageOwner(req.user, existing.ownerType as MediaOwnerType, existing.ownerId))) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const safeOwnerSegment = `${existing.ownerType}-${existing.ownerId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        const result = await uploadVideoToCloudinary(
          req.file.buffer,
          `videos/${existing.ownerType}`,
          `${safeOwnerSegment}-${Date.now()}`,
        );

        if (existing.cloudinaryPublicId) {
          await deleteFromCloudinary(existing.cloudinaryPublicId, "video").catch((error) => {
            console.warn("Failed to delete replaced Cloudinary video", error);
          });
        }

        const nextStatus = isAdminUser(req.user) ? existing.status : "processing";
        const rows = await db
          .update(mediaAssets)
          .set({
            fileUrl: result.secureUrl,
            thumbnailUrl: String(req.body.thumbnailUrl || "").trim() || result.thumbnailUrl,
            durationSeconds: result.durationSeconds || null,
            status: nextStatus,
            cloudinaryPublicId: result.publicId,
            fileSize: result.bytes || req.file.size,
            mimeType: req.file.mimetype,
            updatedAt: new Date(),
          })
          .where(eq(mediaAssets.id, existing.id))
          .returning();

        res.json({ video: rows[0] });
      } catch (error: any) {
        console.error("Error replacing video:", error);
        res.status(500).json({
          message: error?.message || "Failed to replace video",
        });
      }
    },
  );

  app.patch("/api/media/:mediaId", isAuthenticated, async (req: any, res) => {
    try {
      const existingRows = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, req.params.mediaId))
        .limit(1);
      const existing = existingRows[0];

      if (!existing || existing.status === "deleted") {
        return res.status(404).json({ message: "Video not found" });
      }

      if (!(await canManageOwner(req.user, existing.ownerType as MediaOwnerType, existing.ownerId))) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const patch: Record<string, any> = { updatedAt: new Date() };

      if (typeof req.body.title !== "undefined") {
        patch.title = String(req.body.title || "").trim() || null;
      }

      if (typeof req.body.description !== "undefined") {
        patch.description = String(req.body.description || "").trim() || null;
      }

      if (typeof req.body.visibility !== "undefined") {
        patch.visibility = normalizeVisibility(req.body.visibility);
      }

      if (typeof req.body.thumbnailUrl !== "undefined") {
        patch.thumbnailUrl = String(req.body.thumbnailUrl || "").trim() || null;
      }

      if (typeof req.body.isFeatured !== "undefined") {
        patch.isFeatured = boolFromBody(req.body.isFeatured);
        if (patch.isFeatured) {
          await unsetFeaturedVideosForOwner(existing.ownerType as MediaOwnerType, existing.ownerId);
        }
      }

      if (typeof req.body.status !== "undefined") {
        if (!assertAdmin(req, res)) return;
        const status = normalizeStatus(req.body.status);
        if (!status) {
          return res.status(400).json({ message: "Invalid video status" });
        }
        patch.status = status;
        patch.rejectionReason = status === "rejected"
          ? String(req.body.rejectionReason || "").trim() || null
          : null;
        if (status === "deleted") {
          patch.deletedAt = new Date();
        }
      }

      const rows = await db
        .update(mediaAssets)
        .set(patch)
        .where(eq(mediaAssets.id, existing.id))
        .returning();

      res.json({ video: rows[0] });
    } catch (error) {
      console.error("Error updating video:", error);
      res.status(500).json({ message: "Failed to update video" });
    }
  });

  app.delete("/api/media/:mediaId", isAuthenticated, async (req: any, res) => {
    try {
      const existingRows = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, req.params.mediaId))
        .limit(1);
      const existing = existingRows[0];

      if (!existing || existing.status === "deleted") {
        return res.status(404).json({ message: "Video not found" });
      }

      if (!(await canManageOwner(req.user, existing.ownerType as MediaOwnerType, existing.ownerId))) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const rows = await db
        .update(mediaAssets)
        .set({
          status: "deleted",
          isFeatured: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mediaAssets.id, existing.id))
        .returning();

      res.json({ video: rows[0], message: "Video deleted successfully" });
    } catch (error) {
      console.error("Error deleting video:", error);
      res.status(500).json({ message: "Failed to delete video" });
    }
  });

  app.get("/api/admin/media/pending", isAuthenticated, async (req: any, res) => {
    try {
      if (!assertAdmin(req, res)) return;

      const videos = await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.mediaType, "video"),
            eq(mediaAssets.status, "processing"),
          ),
        )
        .orderBy(desc(mediaAssets.createdAt));

      res.json({ videos });
    } catch (error) {
      console.error("Error loading pending videos:", error);
      res.status(500).json({ message: "Failed to load pending videos" });
    }
  });

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
