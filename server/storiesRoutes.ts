import type { Express } from 'express';
import { db } from './db';
import { isAuthenticated, isRestaurantOwner, isStaffOrAdmin } from './unifiedAuth';
import {
  videoStories,
  storyLikes,
  storyComments,
  storyViews,
  storyAwards,
  userReviewerLevels,
  videoStoryReports,
  insertVideoStorySchema,
  insertStoryLikeSchema,
  insertStoryCommentSchema,
  insertStoryViewSchema,
  insertStoryAwardSchema,
  restaurantSubscriptions,
  feedAds,
  mediaAssets,
  type VideoStory,
  type User,
  restaurants,
  users,
} from '@shared/schema';
import { eq, desc, and, lte, sql, count, gte, like, or, isNull, isNotNull, inArray } from 'drizzle-orm';
import { uploadToCloudinary, deleteFromCloudinary } from './imageUpload';
import { upload } from './imageUpload';
import multer from 'multer';
import { storage } from './storage';
import { LISA_CLAIM_TYPES, LISA_CLAIM_SOURCES } from '@shared/schema';

// Configure multer for video uploads
const videoStorage = multer.memoryStorage();
const videoUpload = multer({
  storage: videoStorage,
  fileFilter: (_req, file, cb) => {
    // Accept video files
    if (file.mimetype.startsWith('video/')) {
      cb(null as any, true);
    } else {
      cb(new Error('Only video files are allowed') as any);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

export const videoStoryUploadBodySchema = insertVideoStorySchema.omit({
  userId: true,
  videoUrl: true,
  thumbnailUrl: true,
});

export type PublicFeedStoryRow = {
  id: string;
  videoUrl?: string | null;
  status?: string | null;
  isApproved?: boolean | null;
  deletedAt?: Date | string | null;
  expiresAt?: Date | string | null;
};

const toOptionalDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const isPublicFeedStoryRenderable = (
  story: PublicFeedStoryRow,
  now = new Date(),
) => {
  if (!story.videoUrl) return false;
  if (story.status !== 'ready') return false;
  if (story.isApproved !== true) return false;
  if (story.deletedAt) return false;

  const expiresAt = toOptionalDate(story.expiresAt);
  if (expiresAt && expiresAt.getTime() < now.getTime()) return false;

  return true;
};

const PUBLIC_FEED_MEDIA_OWNER_TYPES = [
  "restaurant",
  "food_truck",
  "host",
  "event",
] as const;

type PublicFeedMediaOwnerType = (typeof PUBLIC_FEED_MEDIA_OWNER_TYPES)[number];

const publicFeedMediaOwnerTypeSet = new Set<string>(
  PUBLIC_FEED_MEDIA_OWNER_TYPES,
);

export type PublicFeedMediaAssetRow = {
  id: string;
  ownerType?: string | null;
  ownerId?: string | null;
  mediaType?: string | null;
  title?: string | null;
  description?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  status?: string | null;
  visibility?: string | null;
  isFeatured?: boolean | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
};

export const isPublicFeedMediaAssetRenderable = (
  asset: PublicFeedMediaAssetRow,
) => {
  if (!asset.fileUrl) return false;
  if (asset.mediaType !== "video") return false;
  if (asset.status !== "active") return false;
  if (asset.visibility !== "public") return false;
  if (asset.deletedAt) return false;
  if (!asset.ownerId) return false;
  if (!publicFeedMediaOwnerTypeSet.has(String(asset.ownerType || ""))) {
    return false;
  }

  return true;
};

const getPublicFeedMediaTargetUrl = (
  ownerType: PublicFeedMediaOwnerType,
  ownerId: string,
) => {
  if (ownerType === "food_truck") return `/truck/${ownerId}`;
  if (ownerType === "host") return `/location/${ownerId}`;
  if (ownerType === "event") return `/event/${ownerId}`;
  return `/restaurant/${ownerId}`;
};

export const toPublicFeedMediaAssetVideo = (
  asset: PublicFeedMediaAssetRow,
) => {
  const ownerType = String(asset.ownerType || "") as PublicFeedMediaOwnerType;
  const ownerId = String(asset.ownerId || "");

  return {
    __type: "profile_media" as const,
    id: `media:${asset.id}`,
    mediaAssetId: asset.id,
    ownerType,
    ownerId,
    title: asset.title || "Profile video",
    description: asset.description || null,
    mediaUrl: asset.fileUrl || "",
    thumbnailUrl: asset.thumbnailUrl || null,
    durationSeconds: Number(asset.durationSeconds || 0) || null,
    targetUrl: getPublicFeedMediaTargetUrl(ownerType, ownerId),
    isFeatured: asset.isFeatured === true,
    createdAt: asset.createdAt || null,
  };
};

export default function setupStoriesRoutes(app: Express) {
  void (async () => {
    try {
      // Non-breaking rollout: ensure reply chain column exists even before migrations run.
      await db.execute(
        sql`ALTER TABLE video_stories ADD COLUMN IF NOT EXISTS reply_to_story_id varchar`,
      );
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "IDX_video_stories_reply_to_story" ON video_stories (reply_to_story_id, created_at DESC)`,
      );
    } catch (error) {
      console.warn('Could not ensure reply chain schema for video stories:', error);
    }
  })();

  const handleStoryUpload = async (
    req: any,
    res: any,
    options?: {
      targetUserId?: string;
      actingUserId?: string;
      isStaffOverride?: boolean;
    },
  ) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No video file provided' });
      }

      const sessionUserId = req.user?.id;
      const actingUserId = options?.actingUserId || sessionUserId;
      const targetUserId = options?.targetUserId || sessionUserId;
      const isStaffOverride = Boolean(options?.isStaffOverride);

      if (!sessionUserId || !actingUserId || !targetUserId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (isStaffOverride && actingUserId !== targetUserId) {
        const targetUser = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);

        if (targetUser.length === 0) {
          return res.status(404).json({ message: 'Target user not found' });
        }
      }

      // Validate request body
      const bodyData = {
        title: req.body.title,
        description: req.body.description || null,
        duration: parseInt(req.body.duration),
        restaurantId: req.body.restaurantId || null,
        replyToStoryId: req.body.replyToStoryId || null,
        hashtags: req.body.hashtags ? JSON.parse(req.body.hashtags) : [],
        cuisine: req.body.cuisine || null,
      };

      if (bodyData.replyToStoryId) {
        const parentStory = await db
          .select({ id: videoStories.id })
          .from(videoStories)
          .where(
            and(
              eq(videoStories.id, bodyData.replyToStoryId),
              eq(videoStories.status, 'ready'),
              isNull(videoStories.deletedAt),
            ),
          )
          .limit(1);

        if (parentStory.length === 0) {
          return res.status(404).json({ message: 'Reply target story not found' });
        }
      }

      // Enforce 30-second maximum duration
      if (bodyData.duration > 30) {
        return res.status(400).json({ message: 'Video duration must be 30 seconds or less' });
      }

      const hasRestaurant = Boolean(bodyData.restaurantId);
      let existingRestaurantStoryId: string | null = null;

      if (hasRestaurant && bodyData.restaurantId) {
        const existingRestaurantStories = await db
          .select({ id: videoStories.id })
          .from(videoStories)
          .where(
            and(
              eq(videoStories.userId, targetUserId),
              eq(videoStories.restaurantId, bodyData.restaurantId),
              isNull(videoStories.deletedAt),
            ),
          )
          .orderBy(desc(videoStories.createdAt))
          .limit(10);
        existingRestaurantStoryId = existingRestaurantStories[0]?.id || null;

        if (existingRestaurantStories.length > 1) {
          const duplicateIds = existingRestaurantStories
            .slice(1)
            .map((row: any) => row.id)
            .filter(Boolean);

          if (duplicateIds.length > 0) {
            await db
              .update(videoStories)
              .set({
                deletedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(inArray(videoStories.id, duplicateIds));
          }
        }
      }

      // Check if this is a restaurant video and verify subscription (paid or lifetime)
      if (bodyData.restaurantId) {
        const subscription = await db
          .select()
          .from(restaurantSubscriptions)
          .where(eq(restaurantSubscriptions.restaurantId, bodyData.restaurantId))
          .limit(1);

        if (subscription.length === 0) {
          // No subscription - create free tier record but block posting
          await db.insert(restaurantSubscriptions).values({
            restaurantId: bodyData.restaurantId,
            tier: 'free',
            status: 'active',
            priceCents: 0,
            billingInterval: 'monthly',
            canPostVideos: false,
            canPostDeals: false,
            canUseFeaturedSlots: false,
            maxFeaturedSlots: 0,
            hasAnalytics: false,
            hasDealScheduling: false,
          });
          return res.status(403).json({
            message: 'A paid plan is required to post restaurant videos. Current plan: $25/mo.',
          });
        }

        const sub = subscription[0];
        const isPaidTier = ['monthly', 'quarterly', 'yearly'].includes(sub.tier);
        const hasLifetime = sub.isLifetimeFree === true;

        if (!hasLifetime && !isPaidTier) {
          return res.status(403).json({
            message: 'Restaurant subscription does not allow video posts. Upgrade to Monthly ($25).',
          });
        }

        // Ensure posting flag is enabled for paid/lifetime tiers
        if (!sub.canPostVideos) {
          await db
            .update(restaurantSubscriptions)
            .set({
              canPostVideos: true,
              canPostDeals: true,
              canUseFeaturedSlots: true,
              maxFeaturedSlots: 3,
              hasAnalytics: true,
              hasDealScheduling: false,
              updatedAt: new Date(),
            })
            .where(eq(restaurantSubscriptions.id, sub.id));
        }
      }

      // Anti-spam rate limits (allow multi-part uploads but prevent spam)
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [{ count: dayCount }] = await db
        .select({ count: count() })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, targetUserId),
            gte(videoStories.createdAt, oneDayAgo),
          ),
        );

      // Limit: 3 uploads per user per rolling 24 hours
      if ((dayCount || 0) >= 3) {
        return res.status(429).json({ message: 'Upload limit reached: max 3 videos per 24 hours. Please try again later.' });
      }

      // Additional restaurant-level cap (if restaurantId provided)
      if (bodyData.restaurantId && !existingRestaurantStoryId) {
        const [{ count: restaurantDayCount }] = await db
          .select({ count: count() })
          .from(videoStories)
          .where(
            and(
              eq(videoStories.restaurantId, bodyData.restaurantId),
              gte(videoStories.createdAt, oneDayAgo),
            ),
          );

        if ((restaurantDayCount || 0) >= 3) {
          return res.status(429).json({ message: 'Restaurant daily limit reached: max 3 videos per day. Please wait ~6 hours before uploading again.' });
        }
      }

      const validationResult = videoStoryUploadBodySchema.safeParse(bodyData);
      if (!validationResult.success) {
        return res.status(400).json({
          message: 'Invalid input',
          errors: validationResult.error.flatten(),
        });
      }

      // Upload video to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(
        req.file.buffer,
        'video',
        {
          folder: 'mealscout/stories',
          public_id: `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        } as any,
      );

      if (!cloudinaryResult.secureUrl) {
        return res.status(500).json({ message: 'Failed to upload video' });
      }

      let story: any[] = [];

      if (existingRestaurantStoryId) {
        story = await db
          .update(videoStories)
          .set({
            title: bodyData.title,
            description: bodyData.description,
            duration: bodyData.duration,
            videoUrl: cloudinaryResult.secureUrl,
            thumbnailUrl: cloudinaryResult.thumbnailUrl || undefined,
            cuisine: bodyData.cuisine,
            hashtags: bodyData.hashtags,
            replyToStoryId: bodyData.replyToStoryId,
            status: 'ready',
            updatedAt: new Date(),
          })
          .where(eq(videoStories.id, existingRestaurantStoryId))
          .returning();
      } else {
        // Create story record in database
        story = await db
          .insert(videoStories)
          .values({
            userId: targetUserId,
            restaurantId: bodyData.restaurantId,
            title: bodyData.title,
            description: bodyData.description,
            duration: bodyData.duration,
            videoUrl: cloudinaryResult.secureUrl,
            thumbnailUrl: cloudinaryResult.thumbnailUrl || undefined,
            cuisine: bodyData.cuisine,
            hashtags: bodyData.hashtags,
            replyToStoryId: bodyData.replyToStoryId,
            status: 'ready', // For MVP, we skip encoding - use Cloudinary's optimization
          })
          .returning();
      }

      // Initialize reviewer level if user doesn't have one
      const existingLevel = await db
        .select()
        .from(userReviewerLevels)
        .where(eq(userReviewerLevels.userId, targetUserId))
        .limit(1);

      // Recalculate distinct recommended restaurants for durability
      const [{ count: distinctRestaurants }] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${videoStories.restaurantId})`.mapWith(Number) })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, targetUserId),
            isNotNull(videoStories.restaurantId),
          ),
        );

      if (existingLevel.length === 0) {
        await db.insert(userReviewerLevels).values({
          userId: targetUserId,
          level: 1,
          // totalStories = distinct restaurants ever recommended (durable)
          totalStories: distinctRestaurants,
        });
      } else {
        // Keep totalStories in sync with durable distinct restaurant recommendations
        await db
          .update(userReviewerLevels)
          .set({
            totalStories: distinctRestaurants,
          })
          .where(eq(userReviewerLevels.userId, targetUserId));
      }

      // LISA Phase 4A: Emit claim for video recommendation creation
      storage.emitClaim({
        subjectType: 'video',
        subjectId: story[0].id,
        actorType: 'user',
        actorId: actingUserId,
        app: 'mealscout',
        claimType: LISA_CLAIM_TYPES.VIDEO_RECOMMENDATION_CREATED,
        claimValue: {
          restaurantId: bodyData.restaurantId,
          cuisine: bodyData.cuisine,
          hashtags: bodyData.hashtags,
          duration: bodyData.duration,
          postedForUserId: targetUserId,
          postedByStaffOverride: isStaffOverride,
        },
        source: LISA_CLAIM_SOURCES.USER,
      }).catch(err => console.error('Failed to emit LISA claim:', err));

      return res.status(201).json({
        message: existingRestaurantStoryId
          ? 'Video recommendation updated successfully'
          : 'Video story uploaded successfully',
        story: story[0],
        updated: Boolean(existingRestaurantStoryId),
        postedForUserId: targetUserId,
        postedByUserId: actingUserId,
        postedByStaffOverride: isStaffOverride,
      });
    } catch (error) {
      console.error('Error uploading video story:', error);
      return res.status(500).json({ message: 'Failed to upload video story' });
    }
  };

  // POST - Upload video story
  app.post(
    '/api/stories/upload',
    isAuthenticated,
    videoUpload.single('video'),
    async (req, res) => handleStoryUpload(req, res)
  );

  // POST - Staff/admin upload video on behalf of a user
  app.post(
    '/api/stories/upload-for-user',
    isAuthenticated,
    isStaffOrAdmin,
    videoUpload.single('video'),
    async (req, res) => {
      const actingUserId = (req as any).user?.id;
      const targetUserId = String(req.body?.targetUserId || '').trim();

      if (!targetUserId) {
        return res.status(400).json({ message: 'targetUserId is required' });
      }

      return handleStoryUpload(req, res, {
        targetUserId,
        actingUserId,
        isStaffOverride: true,
      });
    }
  );

  // GET - Recommendation status (read-only, durable semantics)
  // Returns whether the user has ever recommended this restaurant via a tagged video.
  app.get('/api/stories/recommendation-status', isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const restaurantId = req.query.restaurantId as string | undefined;

      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!restaurantId) {
        return res.status(400).json({ message: 'restaurantId is required' });
      }

      // Durable rule: a restaurant is "already recommended" if the user has
      // ever uploaded at least one story tagged with this restaurantId.
      const [{ count: existingCount }] = await db
        .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, userId),
            eq(videoStories.restaurantId, restaurantId),
          ),
        );

      const alreadyRecommended = (existingCount || 0) > 0;

      return res.json({ alreadyRecommended });
    } catch (error) {
      console.error('Error checking recommendation status:', error);
      return res.status(500).json({ message: 'Failed to check recommendation status' });
    }
  });

  // GET - Feed (infinite scroll)
  // Feed algorithm: 30% community (recent), 20% featured (sponsored), 20% trending, 20% nearby, 10% discovery
  app.get('/api/stories/feed', async (req, res) => {
    try {
      const userId = (req as any).isAuthenticated?.()
        ? (req as any).user?.id
        : null;
      const page = parseInt(req.query.page as string) || 0;
      const limit = 10;
      const communityStoryLimit = 6;
      const communityStoryOffset = page * communityStoryLimit;
      const profileMediaLimit = 2;
      const profileMediaOffset = page * profileMediaLimit;

      // Get featured videos (sponsored content)
      const featuredStories = ((await db
        .select()
        .from(videoStories)
        .where(
          and(
            eq(videoStories.isFeatured, true),
            eq(videoStories.status, 'ready'),
            eq(videoStories.isApproved, true),
            isNull(videoStories.deletedAt),
            or(
              isNull(videoStories.expiresAt),
              gte(videoStories.expiresAt, sql`NOW()`)
            )
          )
        )
        .orderBy(desc(videoStories.featuredStartedAt))
        .limit(2)) as VideoStory[]).filter((story) =>
          isPublicFeedStoryRenderable(story),
        ); // Show 2 featured videos per page

      // Get active ads (house + affiliate)
      const nowSql = sql`NOW()`;
      const ads = await db
        .select()
        .from(feedAds)
        .where(
          and(
            eq(feedAds.isActive, true),
            or(
              isNull(feedAds.startAt),
              lte(feedAds.startAt, nowSql)
            ),
            or(
              isNull(feedAds.endAt),
              gte(feedAds.endAt, nowSql)
            )
          )
        )
        .limit(5); // fetch a handful of ads to rotate

      const profileMediaVideos = ((await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            inArray(mediaAssets.ownerType, [...PUBLIC_FEED_MEDIA_OWNER_TYPES]),
            eq(mediaAssets.mediaType, "video"),
            eq(mediaAssets.status, "active"),
            eq(mediaAssets.visibility, "public"),
            isNull(mediaAssets.deletedAt),
          ),
        )
        .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt))
        .limit(profileMediaLimit)
        .offset(profileMediaOffset)) as PublicFeedMediaAssetRow[])
        .filter((asset) => isPublicFeedMediaAssetRenderable(asset))
        .map((asset) => toPublicFeedMediaAssetVideo(asset));

      // Get community stories (recent uploads)
      const communityStories = ((await db
        .select()
        .from(videoStories)
        .where(
          and(
            eq(videoStories.status, 'ready'),
            eq(videoStories.isApproved, true),
            isNull(videoStories.deletedAt),
            lte(videoStories.createdAt, sql`NOW()`),
            or(
              isNull(videoStories.expiresAt),
              gte(videoStories.expiresAt, sql`NOW()`)
            )
          )
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(communityStoryLimit)
        .offset(communityStoryOffset)) as VideoStory[]).filter((story) =>
          isPublicFeedStoryRenderable(story),
        );

      // Combine featured + community
      let allStories: any[] = [
        ...featuredStories,
        ...profileMediaVideos,
        ...communityStories,
      ].slice(0, limit);

      // Insert ads every N items based on ad.insertionFrequency (default 5)
      if (ads.length > 0) {
        const withAds: any[] = [];
        let adIndex = 0;
        const total = allStories.length;
        for (let i = 0; i < total; i++) {
          const story = allStories[i];
          withAds.push(story);
          // Determine if we should insert an ad after this item
          const nextAd = ads[adIndex % ads.length];
          const frequency = nextAd.insertionFrequency || 5;
          if ((i + 1) % frequency === 0) {
            withAds.push({
              __type: 'ad',
              id: nextAd.id,
              title: nextAd.title,
              mediaUrl: nextAd.mediaUrl,
              targetUrl: nextAd.targetUrl,
              ctaText: nextAd.ctaText || 'Learn more',
              isHouseAd: nextAd.isHouseAd,
              isAffiliate: nextAd.isAffiliate,
              affiliateName: nextAd.affiliateName,
            });
            adIndex++;
          }
        }
        allStories = withAds;
      }

      // Track impressions for all shown stories (skip ads)
      await Promise.all(
        allStories
          .filter((story: any) => story && !story.__type)
          .map((story: VideoStory) =>
            db
              .update(videoStories)
              .set({
                impressionCount: sql`${videoStories.impressionCount} + 1`,
              })
              .where(eq(videoStories.id, story.id))
          )
      );

      // Enrich stories with engagement data (skip ads)
      const enrichedStories = await Promise.all(
        allStories.map(async (story: any) => {
          if (story.__type === 'ad' || story.__type === 'profile_media') {
            return story;
          }

          const userLiked = userId
            ? await db
                .select({ count: count() })
                .from(storyLikes)
                .where(
                  and(
                    eq(storyLikes.storyId, story.id),
                    eq(storyLikes.userId, userId)
                  )
                )
            : [];

          let replyToStory: { id: string; title: string } | null = null;
          if (story.replyToStoryId) {
            const parentStory = await db
              .select({ id: videoStories.id, title: videoStories.title })
              .from(videoStories)
              .where(eq(videoStories.id, story.replyToStoryId))
              .limit(1);
            replyToStory = parentStory[0] || null;
          }

          return {
            ...story,
            userLiked: (userLiked[0]?.count || 0) > 0,
            replyToStory,
          };
        })
      );

      res.json({
        stories: enrichedStories,
        hasMore:
          communityStories.length === communityStoryLimit ||
          profileMediaVideos.length === profileMediaLimit,
        page,
      });
    } catch (error) {
      console.error('Error fetching stories feed:', error);
      res.status(500).json({ message: 'Failed to fetch feed' });
    }
  });

  // GET - Single story details
  app.get('/api/stories/:storyId', async (req, res) => {
    try {
      const { storyId } = req.params;
      const userId = (req as any).user?.id;

      // Get story
      const story = await db
        .select()
        .from(videoStories)
        .where(eq(videoStories.id, storyId))
        .limit(1);

      if (!story.length) {
        return res.status(404).json({ message: 'Story not found' });
      }

      // Get creator info
      const creator = await db
        .select()
        .from(users)
        .where(eq(users.id, story[0].userId))
        .limit(1);

      // Get restaurant info if exists
      const restaurant = story[0].restaurantId
        ? await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, story[0].restaurantId))
            .limit(1)
        : null;

      // Get creator's reviewer level
      const reviewerLevel = await db
        .select()
        .from(userReviewerLevels)
        .where(eq(userReviewerLevels.userId, story[0].userId))
        .limit(1);

      // Get comments (limit to 5, load more on demand)
      const comments = await db
        .select()
        .from(storyComments)
        .where(
          and(
            eq(storyComments.storyId, storyId),
            eq(storyComments.isApproved, true)
          )
        )
        .orderBy(desc(storyComments.createdAt))
        .limit(5);

      // Get awards
      const awards = await db
        .select()
        .from(storyAwards)
        .where(eq(storyAwards.storyId, storyId));

      // Check if user liked this story
      let userLiked = false;
      if (userId) {
        const likeCheck = await db
          .select()
          .from(storyLikes)
          .where(
            and(
              eq(storyLikes.storyId, storyId),
              eq(storyLikes.userId, userId)
            )
          )
          .limit(1);
        userLiked = likeCheck.length > 0;
      }

      const replyToStory = story[0].replyToStoryId
        ? (
            await db
              .select({ id: videoStories.id, title: videoStories.title })
              .from(videoStories)
              .where(eq(videoStories.id, story[0].replyToStoryId))
              .limit(1)
          )[0] || null
        : null;

      const replies = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          videoUrl: videoStories.videoUrl,
          thumbnailUrl: videoStories.thumbnailUrl,
          createdAt: videoStories.createdAt,
          userId: videoStories.userId,
        })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.replyToStoryId, storyId),
            eq(videoStories.status, 'ready'),
            isNull(videoStories.deletedAt),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(20);

      res.json({
        story: story[0],
        creator: creator[0],
        restaurant: restaurant?.[0] || null,
        reviewerLevel: reviewerLevel[0] || null,
        comments,
        awards,
        userLiked,
        replyToStory,
        replies,
      });
    } catch (error) {
      console.error('Error fetching story details:', error);
      res.status(500).json({ message: 'Failed to fetch story' });
    }
  });

  // GET - Replies for a story (content chain)
  app.get('/api/stories/:storyId/replies', async (req, res) => {
    try {
      const { storyId } = req.params;
      const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '20'), 10) || 20));

      const replies = await db
        .select({
          id: videoStories.id,
          userId: videoStories.userId,
          title: videoStories.title,
          description: videoStories.description,
          videoUrl: videoStories.videoUrl,
          thumbnailUrl: videoStories.thumbnailUrl,
          createdAt: videoStories.createdAt,
          likeCount: videoStories.likeCount,
          commentCount: videoStories.commentCount,
        })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.replyToStoryId, storyId),
            eq(videoStories.status, 'ready'),
            isNull(videoStories.deletedAt),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(limit);

      res.json({ replies });
    } catch (error) {
      console.error('Error fetching story replies:', error);
      res.status(500).json({ message: 'Failed to fetch story replies' });
    }
  });

  // POST - Like story
  app.post('/api/stories/:storyId/like', isAuthenticated, async (req, res) => {
    try {
      const { storyId } = req.params;
      const userId = (req as any).user?.id;

      // Check if story exists
      const story = await db
        .select()
        .from(videoStories)
        .where(eq(videoStories.id, storyId))
        .limit(1);

      if (!story.length) {
        return res.status(404).json({ message: 'Story not found' });
      }

      // Check if already liked
      const existingLike = await db
        .select()
        .from(storyLikes)
        .where(
          and(
            eq(storyLikes.storyId, storyId),
            eq(storyLikes.userId, userId)
          )
        )
        .limit(1);

      if (existingLike.length > 0) {
        // Unlike
        await db
          .delete(storyLikes)
          .where(
            and(
              eq(storyLikes.storyId, storyId),
              eq(storyLikes.userId, userId)
            )
          );

        // Decrement like count
        await db
          .update(videoStories)
          .set({
            likeCount: sql`GREATEST(${videoStories.likeCount} - 1, 0)`,
          })
          .where(eq(videoStories.id, storyId));

        // Decrement user's total favorites
        await db
          .update(userReviewerLevels)
          .set({
            totalFavorites: sql`GREATEST(${userReviewerLevels.totalFavorites} - 1, 0)`,
          })
          .where(eq(userReviewerLevels.userId, story[0].userId));

        return res.json({ liked: false, message: 'Story unliked' });
      }

      // Create like
      await db.insert(storyLikes).values({
        storyId,
        userId,
      });

      // Increment like count
      await db
        .update(videoStories)
        .set({
          likeCount: sql`${videoStories.likeCount} + 1`,
        })
        .where(eq(videoStories.id, storyId));

      // Increment creator's total favorites
      const creatorLevels = await db
        .select()
        .from(userReviewerLevels)
        .where(eq(userReviewerLevels.userId, story[0].userId));

      const currentTotal = creatorLevels[0]?.totalFavorites || 0;
      const newTotal = currentTotal + 1;

      await db
        .update(userReviewerLevels)
        .set({
          totalFavorites: newTotal,
        })
        .where(eq(userReviewerLevels.userId, story[0].userId));

      // Check for milestone awards (500, 1000, 3000, 10000)
      const milestones = [500, 1000, 3000, 10000];
      const awardTypes = [
        'bronze_fork',
        'silver_fork',
        'gold_fork',
        'platinum_fork',
      ];

      for (let i = 0; i < milestones.length; i++) {
        if (newTotal === milestones[i]) {
          // Check if award already exists
          const existingAward = await db
            .select()
            .from(storyAwards)
            .where(
              and(
                eq(storyAwards.storyId, storyId),
                eq(storyAwards.awardType, awardTypes[i])
              )
            )
            .limit(1);

          if (!existingAward.length) {
            await db.insert(storyAwards).values({
              storyId,
              awardType: awardTypes[i],
            });
          }
        }
      }

      // Update reviewer level based on total favorites
      const levels = [
        { threshold: 0, level: 1 },
        { threshold: 100, level: 2 },
        { threshold: 500, level: 3 },
        { threshold: 1000, level: 4 },
        { threshold: 2500, level: 5 },
        { threshold: 5000, level: 6 },
      ];

      let newLevel = 1;
      for (const lvl of levels) {
        if (newTotal >= lvl.threshold) {
          newLevel = lvl.level;
        }
      }

      await db
        .update(userReviewerLevels)
        .set({ level: newLevel })
        .where(eq(userReviewerLevels.userId, story[0].userId));

      res.json({ liked: true, message: 'Story liked' });
    } catch (error) {
      console.error('Error liking story:', error);
      res.status(500).json({ message: 'Failed to like story' });
    }
  });

  // POST - Comment on story
  app.post(
    '/api/stories/:storyId/comments',
    isAuthenticated,
    async (req, res) => {
      try {
        const { storyId } = req.params;
        const userId = (req as any).user?.id;
        const { text, parentCommentId } = req.body;

        // Validate input
        if (!text || text.trim().length === 0) {
          return res.status(400).json({ message: 'Comment text is required' });
        }

        if (text.length > 500) {
          return res
            .status(400)
            .json({ message: 'Comment must be less than 500 characters' });
        }

        // Check if story exists
        const story = await db
          .select()
          .from(videoStories)
          .where(eq(videoStories.id, storyId))
          .limit(1);

        if (!story.length) {
          return res.status(404).json({ message: 'Story not found' });
        }

        // Create comment
        const comment = await db
          .insert(storyComments)
          .values({
            storyId,
            userId,
            text,
            parentCommentId: parentCommentId || null,
          })
          .returning();

        // Increment comment count
        await db
          .update(videoStories)
          .set({
            commentCount: sql`${videoStories.commentCount} + 1`,
          })
          .where(eq(videoStories.id, storyId));

        res.status(201).json({
          message: 'Comment added successfully',
          comment: comment[0],
        });
      } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Failed to add comment' });
      }
    }
  );

  // POST - Record view
  app.post('/api/stories/:storyId/view', async (req, res) => {
    try {
      const { storyId } = req.params;
      const userId = (req as any).user?.id;
      const { watchDuration } = req.body;

      // Record view (only count if watched 3+ seconds)
      if (!watchDuration || watchDuration >= 3) {
        await db.insert(storyViews).values({
          storyId,
          userId: userId || null,
          watchDuration: watchDuration || null,
        });

        // Increment view count
        await db
          .update(videoStories)
          .set({
            viewCount: sql`${videoStories.viewCount} + 1`,
          })
          .where(eq(videoStories.id, storyId));
      }

      res.json({ message: 'View recorded' });
    } catch (error) {
      console.error('Error recording view:', error);
      res.status(500).json({ message: 'Failed to record view' });
    }
  });

  // POST - Record share
  app.post('/api/stories/:storyId/share', async (req, res) => {
    try {
      const { storyId } = req.params;

      await db
        .update(videoStories)
        .set({
          shareCount: sql`${videoStories.shareCount} + 1`,
        })
        .where(eq(videoStories.id, storyId));

      res.json({ success: true });
    } catch (error) {
      console.error('Error recording story share:', error);
      res.status(500).json({ message: 'Failed to record share' });
    }
  });

  // GET - Leaderboards
  app.get('/api/stories/leaderboards/trending', async (req, res) => {
    try {
      const timeframeRaw = String(req.query.timeframe || "week").toLowerCase();
      const timeframe =
        timeframeRaw === "day" ||
        timeframeRaw === "week" ||
        timeframeRaw === "month" ||
        timeframeRaw === "all"
          ? timeframeRaw
          : "week"; // 'day' | 'week' | 'month' | 'all'

      let hoursBack = 7 * 24; // default week
      if (timeframe === 'day') hoursBack = 24;
      if (timeframe === 'month') hoursBack = 30 * 24;
      if (timeframe === 'all') hoursBack = 365 * 24;

      const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const trending = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          creatorName: users.firstName,
          viewCount: videoStories.viewCount,
          likeCount: videoStories.likeCount,
          engagement: sql<number>`(${videoStories.likeCount} + ${videoStories.commentCount} * 2) / NULLIF(${videoStories.viewCount}, 0)`,
        })
        .from(videoStories)
        .innerJoin(users, eq(videoStories.userId, users.id))
        .where(
          and(
            eq(videoStories.status, 'ready'),
            gte(videoStories.createdAt, cutoffDate)
          )
        )
        .orderBy(desc(sql`${videoStories.likeCount} + ${videoStories.commentCount}`))
        .limit(20);

      res.json({ trending, timeframe });
    } catch (error) {
      console.warn("Trending leaderboard unavailable, returning empty list:", error);
      res.json({ trending: [], timeframe: String(req.query.timeframe || "week") });
    }
  });

  // GET - Top reviewers
  app.get('/api/stories/leaderboards/top-reviewers', async (req, res) => {
    try {
      const timeframe = req.query.timeframe || 'month';

      const topReviewers = await db
        .select({
          userId: userReviewerLevels.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          level: userReviewerLevels.level,
          totalFavorites: userReviewerLevels.totalFavorites,
          totalStories: userReviewerLevels.totalStories,
        })
        .from(userReviewerLevels)
        .innerJoin(users, eq(userReviewerLevels.userId, users.id))
        .orderBy(desc(userReviewerLevels.totalFavorites))
        .limit(50);

      res.json({ topReviewers, timeframe });
    } catch (error) {
      console.error('Error fetching top reviewers:', error);
      res
        .status(500)
        .json({ message: 'Failed to fetch top reviewers' });
    }
  });

  // GET - User's stories
  app.get('/api/stories/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const userStories = await db
        .select()
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, userId),
            eq(videoStories.status, 'ready')
          )
        )
        .orderBy(desc(videoStories.createdAt));

      res.json({ stories: userStories });
    } catch (error) {
      console.error('Error fetching user stories:', error);
      res.status(500).json({ message: 'Failed to fetch user stories' });
    }
  });

  // DELETE - Delete story (only by creator)
  app.delete(
    '/api/stories/:storyId',
    isAuthenticated,
    async (req, res) => {
      try {
        const { storyId } = req.params;
        const userId = (req as any).user?.id;

        // Get story
        const story = await db
          .select()
          .from(videoStories)
          .where(eq(videoStories.id, storyId))
          .limit(1);

        if (!story.length) {
          return res.status(404).json({ message: 'Story not found' });
        }

        // Check ownership
        if (story[0].userId !== userId) {
          return res
            .status(403)
            .json({ message: 'Unauthorized - not story creator' });
        }

        // Delete from Cloudinary
        if (story[0].videoUrl) {
          try {
            await deleteFromCloudinary(story[0].videoUrl);
          } catch (err) {
            console.error('Error deleting from Cloudinary:', err);
            // Continue with DB deletion even if Cloudinary fails
          }
        }

        // Soft delete in database
        await db
          .update(videoStories)
          .set({ deletedAt: sql`NOW()`, status: 'expired' })
          .where(eq(videoStories.id, storyId));

        res.json({ message: 'Story deleted successfully' });
      } catch (error) {
        console.error('Error deleting story:', error);
        res.status(500).json({ message: 'Failed to delete story' });
      }
    }
  );

  // GET - User's reviewer level
  app.get('/api/stories/reviewer-level/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const level = await db
        .select()
        .from(userReviewerLevels)
        .where(eq(userReviewerLevels.userId, userId))
        .limit(1);

      if (!level.length) {
        // Return default level 1
        return res.json({
          userId,
          level: 1,
          totalFavorites: 0,
          totalStories: 0,
        });
      }

      res.json(level[0]);
    } catch (error) {
      console.error('Error fetching reviewer level:', error);
      res.status(500).json({ message: 'Failed to fetch reviewer level' });
    }
  });

  // POST - Report a video story
  app.post('/api/stories/:storyId/report', isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { storyId } = req.params;
      const { reason, description } = req.body;

      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!reason || !['inappropriate', 'spam', 'misleading', 'offensive', 'other'].includes(reason)) {
        return res.status(400).json({ message: 'Invalid report reason' });
      }

      // Check if video exists
      const story = await db
        .select()
        .from(videoStories)
        .where(eq(videoStories.id, storyId))
        .limit(1);

      if (!story.length) {
        return res.status(404).json({ message: 'Video not found' });
      }

      // Import videoStoryReports
      const { videoStoryReports } = await import('@shared/schema');

      // Check if user already reported this video
      const existingReport = await db
        .select()
        .from(videoStoryReports)
        .where(
          and(
            eq(videoStoryReports.storyId, storyId),
            eq(videoStoryReports.reportedByUserId, userId)
          )
        )
        .limit(1);

      if (existingReport.length > 0) {
        return res.status(400).json({ message: 'You have already reported this video' });
      }

      // Create report
      await db.insert(videoStoryReports).values({
        storyId,
        reportedByUserId: userId,
        reason,
        description: description || null,
      });

      // Check total reports for this video
      const reportCount = await db
        .select({ count: count() })
        .from(videoStoryReports)
        .where(eq(videoStoryReports.storyId, storyId));

      const totalReports = reportCount[0]?.count || 0;

      // Auto-takedown if 10+ unique users reported
      if (totalReports >= 10) {
        await db
          .update(videoStories)
          .set({
            status: 'expired',
            deletedAt: new Date(),
          })
          .where(eq(videoStories.id, storyId));

        // Update all reports to action_taken
        await db
          .update(videoStoryReports)
          .set({
            status: 'action_taken',
            adminNotes: 'Auto-takedown: 10+ community reports',
          })
          .where(eq(videoStoryReports.storyId, storyId));

        return res.json({ 
          message: 'Video reported and automatically taken down due to multiple reports',
          autoTakedown: true,
        });
      }

      res.json({ 
        message: 'Video reported successfully. Our team will review it shortly.',
        totalReports,
      });
    } catch (error) {
      console.error('Error reporting video:', error);
      res.status(500).json({ message: 'Failed to report video' });
    }
  });

  // GET - Get report count for a video
  app.get('/api/stories/:storyId/report-count', async (req, res) => {
    try {
      const { storyId } = req.params;
      const { videoStoryReports } = await import('@shared/schema');

      const reportCount = await db
        .select({ count: count() })
        .from(videoStoryReports)
        .where(eq(videoStoryReports.storyId, storyId));

      res.json({ reportCount: reportCount[0]?.count || 0 });
    } catch (error) {
      console.error('Error fetching report count:', error);
      res.status(500).json({ message: 'Failed to fetch report count' });
    }
  });
}
