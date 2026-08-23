import type { Express } from 'express';
import { db } from './db';
import { isAuthenticated, isRestaurantOwner } from './unifiedAuth';
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
  feedAds,
  type VideoStory,
  type User,
  restaurants,
  users,
} from '@shared/schema';
import { eq, desc, and, lte, sql, count, gte, like, or, isNull, isNotNull, getTableColumns } from 'drizzle-orm';
import { uploadToCloudinary, deleteFromCloudinary } from './imageUpload';
import { upload } from './imageUpload';
import multer from 'multer';
import { storage } from './storage';
import { LISA_CLAIM_TYPES, LISA_CLAIM_SOURCES } from '@shared/schema';
import { isStaffOrAdminUserType } from '@shared/profileAccessPolicy';
import { toPublicRestaurantListingWithVisibility } from './publicProfiles/toPublicRestaurantListingWithVisibility';
import { isPublicBusinessVisible } from './utils/publicBusinessVisibility';
import {
  isPublicStoryAssociationEligible,
  projectPublicStoryRow,
  publicStoryPublicationWhere,
} from './services/publicStoryProjection';
import { normalizePublicUrl } from './publicProfiles/publicProfileUtils';
import { deriveProfileEvidenceQuarantineVisibility } from './services/profileEvidenceQuarantine';
import { distributedRateLimit } from './middleware/distributedRateLimit';

const storyViewLimiter = distributedRateLimit({
  scope: 'public-story-view',
  limit: 1,
  windowMs: 5 * 60 * 1000,
  key: (req) =>
    `${String(req.params.storyId || '')}:${String(
      (req as any).user?.id || (req as any).sessionID || req.ip || 'anonymous',
    )}`,
});

const storyShareLimiter = distributedRateLimit({
  scope: 'public-story-share',
  limit: 1,
  windowMs: 5 * 60 * 1000,
  key: (req) =>
    `${String(req.params.storyId || '')}:${String(
      (req as any).user?.id || (req as any).sessionID || req.ip || 'anonymous',
    )}`,
});

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

export default function setupStoriesRoutes(app: Express) {
  const loadPublicEngageableStory = async (storyId: string) => {
    const [story] = await db
      .select({
        ...getTableColumns(videoStories),
        creatorDisabled: users.isDisabled,
        restaurantActive: restaurants.isActive,
        restaurantName: restaurants.name,
        restaurantAddress: restaurants.address,
        restaurantCity: restaurants.city,
        restaurantState: restaurants.state,
        restaurantCuisineType: restaurants.cuisineType,
        restaurantDescription: restaurants.description,
        restaurantPhone: restaurants.phone,
        restaurantWebsiteUrl: restaurants.websiteUrl,
        restaurantOwnerDisabled: sql<boolean | null>`(
          select linked_owner.is_disabled from users linked_owner
          where linked_owner.id = ${restaurants.ownerId} limit 1
        )`,
        restaurantEmail: sql<string | null>`(
          select linked_owner.email from users linked_owner
          where linked_owner.id = ${restaurants.ownerId} limit 1
        )`,
        restaurantRawData: restaurants.rawData,
      })
      .from(videoStories)
      .innerJoin(users, eq(videoStories.userId, users.id))
      .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
      .where(
        and(
          eq(videoStories.id, storyId),
          publicStoryPublicationWhere(sql`NOW()`),
          eq(users.isDisabled, false),
          or(
            isNull(videoStories.restaurantId),
            eq(restaurants.isActive, true),
          ),
        ),
      )
      .limit(1);

    return story && isPublicStoryAssociationEligible(story) ? story : null;
  };

  // POST - Upload video story
  app.post(
    '/api/stories/upload',
    isAuthenticated,
    videoUpload.single('video'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: 'No video file provided' });
        }

        const userId = (req as any).user?.id;
        if (!userId) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        // Validate request body
        const bodyData = {
          title: req.body.title,
          description: req.body.description || null,
          duration: parseInt(req.body.duration),
          restaurantId: req.body.restaurantId || null,
          hashtags: req.body.hashtags ? JSON.parse(req.body.hashtags) : [],
          cuisine: req.body.cuisine || null,
        };

        // Enforce 30-second maximum duration
        if (bodyData.duration > 30) {
          return res.status(400).json({ message: 'Video duration must be 30 seconds or less' });
        }

        const hasRestaurant = Boolean(bodyData.restaurantId);

        // Complete profiles include video posting. Ownership and anti-spam
        // limits still apply; subscription state never does.
        if (bodyData.restaurantId) {
          const userType = String((req as any).user?.userType || '');
          if (
            !isStaffOrAdminUserType(userType) &&
            !(await storage.verifyRestaurantOwnership(
              bodyData.restaurantId,
              userId,
              'manageProfile',
            ))
          ) {
            return res.status(403).json({
              message: 'You can only post videos for a profile you manage.',
            });
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
              eq(videoStories.userId, userId),
              gte(videoStories.createdAt, oneDayAgo)
            ),
          );

        // Limit: 3 uploads per user per rolling 24 hours
        if ((dayCount || 0) >= 3) {
          return res.status(429).json({ message: 'Upload limit reached: max 3 videos per 24 hours. Please try again later.' });
        }

        // Additional restaurant-level cap (if restaurantId provided)
        if (bodyData.restaurantId) {
          const [{ count: restaurantDayCount }] = await db
            .select({ count: count() })
            .from(videoStories)
            .where(
              and(
                eq(videoStories.restaurantId, bodyData.restaurantId),
                gte(videoStories.createdAt, oneDayAgo)
              )
            );

          if ((restaurantDayCount || 0) >= 3) {
            return res.status(429).json({ message: 'Restaurant daily limit reached: max 3 videos per day. Please wait ~6 hours before uploading again.' });
          }
        }

        const validationResult = insertVideoStorySchema.safeParse(bodyData);
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
          } as any
        );

        if (!cloudinaryResult.secureUrl) {
          return res.status(500).json({ message: 'Failed to upload video' });
        }

        // Create story record in database
        const story = await db
          .insert(videoStories)
          .values({
            userId,
            restaurantId: bodyData.restaurantId,
            title: bodyData.title,
            description: bodyData.description,
            duration: bodyData.duration,
            videoUrl: cloudinaryResult.secureUrl,
            thumbnailUrl: cloudinaryResult.thumbnailUrl || undefined,
            cuisine: bodyData.cuisine,
            hashtags: bodyData.hashtags,
            status: 'ready', // For MVP, we skip encoding - use Cloudinary's optimization
          })
          .returning();

        // Initialize reviewer level if user doesn't have one
        const existingLevel = await db
          .select()
          .from(userReviewerLevels)
          .where(eq(userReviewerLevels.userId, userId))
          .limit(1);

        // Recalculate distinct recommended restaurants for durability
        const [{ count: distinctRestaurants }] = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${videoStories.restaurantId})`.mapWith(Number) })
          .from(videoStories)
          .where(
            and(
              eq(videoStories.userId, userId),
              isNotNull(videoStories.restaurantId),
            ),
          );

        if (existingLevel.length === 0) {
          await db.insert(userReviewerLevels).values({
            userId,
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
            .where(eq(userReviewerLevels.userId, userId));
        }

        // LISA Phase 4A: Emit claim for video recommendation creation
        storage.emitClaim({
          subjectType: 'video',
          subjectId: story[0].id,
          actorType: 'user',
          actorId: userId,
          app: 'mealscout',
          claimType: LISA_CLAIM_TYPES.VIDEO_RECOMMENDATION_CREATED,
          claimValue: {
            restaurantId: bodyData.restaurantId,
            cuisine: bodyData.cuisine,
            hashtags: bodyData.hashtags,
            duration: bodyData.duration,
          },
          source: LISA_CLAIM_SOURCES.USER,
        }).catch(err => console.error('Failed to emit LISA claim:', err));

        res.status(201).json({
          message: 'Video story uploaded successfully',
          story: story[0],
        });
      } catch (error) {
        console.error('Error uploading video story:', error);
        res.status(500).json({ message: 'Failed to upload video story' });
      }
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
      const userId = (req as any).user?.id;
      const page = parseInt(req.query.page as string) || 0;
      const limit = 10;
      const offset = page * limit;

      // Get featured videos (sponsored content)
      const featuredStoryCandidates = await db
        .select({
          ...getTableColumns(videoStories),
          creatorDisabled: users.isDisabled,
          restaurantActive: restaurants.isActive,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantDescription: restaurants.description,
          restaurantOwnerDisabled: sql<boolean | null>`(
            select linked_owner.is_disabled from users linked_owner
            where linked_owner.id = ${restaurants.ownerId} limit 1
          )`,
          restaurantRawData: restaurants.rawData,
        })
        .from(videoStories)
        .innerJoin(users, eq(videoStories.userId, users.id))
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            eq(videoStories.isFeatured, true),
            publicStoryPublicationWhere(sql`NOW()`),
            eq(users.isDisabled, false),
            or(
              isNull(videoStories.restaurantId),
              eq(restaurants.isActive, true),
            ),
          )
        )
        .orderBy(desc(videoStories.featuredStartedAt))
        .limit(8);
      const featuredStories = featuredStoryCandidates
        .filter((row: any) => isPublicStoryAssociationEligible(row))
        .slice(0, 2); // Show 2 featured videos per page

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

      // Get community stories (recent uploads)
      const communityStoryCandidates = await db
        .select({
          ...getTableColumns(videoStories),
          creatorDisabled: users.isDisabled,
          restaurantActive: restaurants.isActive,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantDescription: restaurants.description,
          restaurantOwnerDisabled: sql<boolean | null>`(
            select linked_owner.is_disabled from users linked_owner
            where linked_owner.id = ${restaurants.ownerId} limit 1
          )`,
          restaurantRawData: restaurants.rawData,
        })
        .from(videoStories)
        .innerJoin(users, eq(videoStories.userId, users.id))
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            publicStoryPublicationWhere(sql`NOW()`),
            eq(users.isDisabled, false),
            or(
              isNull(videoStories.restaurantId),
              eq(restaurants.isActive, true),
            ),
            lte(videoStories.createdAt, sql`NOW()`),
          )
        )
        .orderBy(desc(videoStories.createdAt))
        .limit((limit - featuredStories.length) * 4)
        .offset(offset);
      const communityStories = communityStoryCandidates
        .filter((row: any) => isPublicStoryAssociationEligible(row))
        .slice(0, limit - featuredStories.length);

      // Combine featured + community
      let allStories: any[] = [...featuredStories, ...communityStories];

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
            const publicTargetUrl = normalizePublicUrl(nextAd.targetUrl, {
              allowInternalPath: true,
            });
            if (publicTargetUrl) {
              withAds.push({
                __type: 'ad',
                id: nextAd.id,
                title: nextAd.title,
                mediaUrl: normalizePublicUrl(nextAd.mediaUrl, {
                  allowInternalPath: true,
                }),
                targetUrl: publicTargetUrl,
                ctaText: nextAd.ctaText || 'Learn more',
                isHouseAd: nextAd.isHouseAd,
                isAffiliate: nextAd.isAffiliate,
                affiliateName: nextAd.affiliateName,
              });
            }
            adIndex++;
          }
        }
        allStories = withAds;
      }

      // Track impressions for all shown stories (skip ads)
      await Promise.all(
        allStories
          .filter((story: any) => story && story.__type !== 'ad')
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
          if (story.__type === 'ad') {
            return story;
          }

          const publicStory = projectPublicStoryRow(story);
          if (!publicStory) return null;

          if (!userId) {
            return { ...publicStory, userLiked: false };
          }

          const userLiked = await db
            .select({ count: count() })
            .from(storyLikes)
            .where(
              and(
                eq(storyLikes.storyId, story.id),
                eq(storyLikes.userId, userId)
              )
            );

          return {
            ...publicStory,
            userLiked: (userLiked[0]?.count || 0) > 0,
          };
        })
      );

      res.json({
        stories: enrichedStories.filter(Boolean),
        hasMore: communityStories.length === limit - featuredStories.length,
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
      const publicStoryNow = new Date();

      // Anonymous detail is fail-closed and explicitly allowlisted. Never
      // return a raw users, restaurants, or moderation row from this route.
      const story = await db
        .select({
          id: videoStories.id,
          creatorUserId: videoStories.userId,
          restaurantId: videoStories.restaurantId,
          title: videoStories.title,
          description: videoStories.description,
          duration: videoStories.duration,
          videoUrl: videoStories.videoUrl,
          thumbnailUrl: videoStories.thumbnailUrl,
          status: videoStories.status,
          viewCount: videoStories.viewCount,
          likeCount: videoStories.likeCount,
          commentCount: videoStories.commentCount,
          shareCount: videoStories.shareCount,
          hashtags: videoStories.hashtags,
          cuisine: videoStories.cuisine,
          transcript: videoStories.transcript,
          transcriptLanguage: videoStories.transcriptLanguage,
          transcriptSource: videoStories.transcriptSource,
          createdAt: videoStories.createdAt,
          expiresAt: videoStories.expiresAt,
          isFeatured: videoStories.isFeatured,
          featuredSlotNumber: videoStories.featuredSlotNumber,
          isApproved: videoStories.isApproved,
        })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.id, storyId),
            publicStoryPublicationWhere(publicStoryNow),
          ),
        )
        .limit(1);

      if (!story.length) {
        return res.status(404).json({ message: 'Story not found' });
      }

      // Get creator info
      const creator = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          hasGoldenFork: users.hasGoldenFork,
          reviewCount: users.reviewCount,
          recommendationCount: users.recommendationCount,
        })
        .from(users)
        .where(
          and(
            eq(users.id, story[0].creatorUserId),
            eq(users.isDisabled, false),
          ),
        )
        .limit(1);

      if (!creator.length) {
        return res.status(404).json({ message: 'Story not found' });
      }

      // Get restaurant info if exists
      const restaurant = story[0].restaurantId
        ? await db
            .select()
            .from(restaurants)
            .where(
              and(
                eq(restaurants.id, story[0].restaurantId),
                eq(restaurants.isActive, true),
              ),
            )
            .limit(1)
        : null;

      if (
        story[0].restaurantId &&
        (!restaurant?.[0] || !isPublicBusinessVisible(restaurant[0]))
      ) {
        return res.status(404).json({ message: 'Story not found' });
      }
      const publicRestaurant = restaurant?.[0]
        ? await toPublicRestaurantListingWithVisibility(restaurant[0], db)
        : null;
      if (
        story[0].restaurantId &&
        (!publicRestaurant?.id ||
          deriveProfileEvidenceQuarantineVisibility(restaurant?.[0])
            .isQuarantined)
      ) {
        return res.status(404).json({ message: 'Story not found' });
      }

      // Get creator's reviewer level
      const reviewerLevel = await db
        .select({
          level: userReviewerLevels.level,
          totalFavorites: userReviewerLevels.totalFavorites,
          totalStories: userReviewerLevels.totalStories,
          topStoryFavorites: userReviewerLevels.topStoryFavorites,
        })
        .from(userReviewerLevels)
        .where(eq(userReviewerLevels.userId, story[0].creatorUserId))
        .limit(1);

      // Get comments (limit to 5, load more on demand)
      const comments = await db
        .select({
          id: storyComments.id,
          parentCommentId: storyComments.parentCommentId,
          text: storyComments.text,
          createdAt: storyComments.createdAt,
          updatedAt: storyComments.updatedAt,
        })
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
        .select({
          id: storyAwards.id,
          awardType: storyAwards.awardType,
          awardedAt: storyAwards.awardedAt,
        })
        .from(storyAwards)
        .where(eq(storyAwards.storyId, storyId));

      // Check if user liked this story
      let userLiked = false;
      if (userId) {
        const likeCheck = await db
          .select({ id: storyLikes.id })
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

      const creatorName = [creator[0].firstName, creator[0].lastName]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
      const publicStory = projectPublicStoryRow(story[0], {
        creatorName: creatorName || 'MealScout Creator',
      });
      if (!publicStory) {
        return res.status(404).json({ message: 'Story not found' });
      }

      res.json({
        story: publicStory,
        creator: creator[0],
        restaurant: publicRestaurant,
        reviewerLevel: reviewerLevel[0] || null,
        comments,
        awards,
        userLiked,
      });
    } catch (error) {
      console.error('Error fetching story details:', error);
      res.status(500).json({ message: 'Failed to fetch story' });
    }
  });

  // POST - Like story
  app.post('/api/stories/:storyId/like', isAuthenticated, async (req, res) => {
    try {
      const { storyId } = req.params;
      const userId = (req as any).user?.id;

      const story = await loadPublicEngageableStory(storyId);
      if (!story) {
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
          .where(eq(userReviewerLevels.userId, story.userId));

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
        .where(eq(userReviewerLevels.userId, story.userId));

      const currentTotal = creatorLevels[0]?.totalFavorites || 0;
      const newTotal = currentTotal + 1;

      await db
        .update(userReviewerLevels)
        .set({
          totalFavorites: newTotal,
        })
        .where(eq(userReviewerLevels.userId, story.userId));

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
        .where(eq(userReviewerLevels.userId, story.userId));

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

        const story = await loadPublicEngageableStory(storyId);
        if (!story) {
          return res.status(404).json({ message: 'Story not found' });
        }

        if (parentCommentId) {
          const [parent] = await db
            .select({ id: storyComments.id })
            .from(storyComments)
            .where(
              and(
                eq(storyComments.id, String(parentCommentId)),
                eq(storyComments.storyId, storyId),
                eq(storyComments.isApproved, true),
              ),
            )
            .limit(1);
          if (!parent) {
            return res.status(400).json({ message: 'Invalid parent comment' });
          }
        }

        // Create comment
        const comment = await db
          .insert(storyComments)
          .values({
            storyId,
            userId,
            text: String(text).trim(),
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
          comment: {
            id: comment[0].id,
            parentCommentId: comment[0].parentCommentId,
            text: comment[0].text,
            createdAt: comment[0].createdAt,
          },
        });
      } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Failed to add comment' });
      }
    }
  );

  // POST - Record view
  app.post('/api/stories/:storyId/view', storyViewLimiter, async (req, res) => {
    try {
      const { storyId } = req.params;
      const userId = (req as any).user?.id;
      const watchDuration = Number(req.body?.watchDuration);
      const story = await loadPublicEngageableStory(storyId);
      if (!story) {
        return res.status(404).json({ message: 'Story not found' });
      }

      if (!Number.isFinite(watchDuration) || watchDuration < 3) {
        return res.json({ success: true, counted: false });
      }

      const boundedWatchDuration = Math.max(
        3,
        Math.min(Math.floor(watchDuration), Math.max(3, Number(story.duration) || 30)),
      );
      await db.insert(storyViews).values({
        storyId,
        userId: userId || null,
        watchDuration: boundedWatchDuration,
      });

      await db
        .update(videoStories)
        .set({
          viewCount: sql`${videoStories.viewCount} + 1`,
        })
        .where(eq(videoStories.id, storyId));

      res.json({ success: true, counted: true });
    } catch (error) {
      console.error('Error recording view:', error);
      res.status(500).json({ message: 'Failed to record view' });
    }
  });

  // POST - Record share
  app.post('/api/stories/:storyId/share', storyShareLimiter, async (req, res) => {
    try {
      const { storyId } = req.params;
      const story = await loadPublicEngageableStory(storyId);
      if (!story) {
        return res.status(404).json({ message: 'Story not found' });
      }

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
      const timeframe = req.query.timeframe || 'week'; // 'day' | 'week' | 'month' | 'all'

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
          restaurantId: videoStories.restaurantId,
          creatorDisabled: users.isDisabled,
          restaurantActive: restaurants.isActive,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantDescription: restaurants.description,
          restaurantOwnerDisabled: sql<boolean | null>`(
            select linked_owner.is_disabled from users linked_owner
            where linked_owner.id = ${restaurants.ownerId} limit 1
          )`,
          restaurantRawData: restaurants.rawData,
          viewCount: videoStories.viewCount,
          likeCount: videoStories.likeCount,
          engagement: sql<number>`(${videoStories.likeCount} + ${videoStories.commentCount} * 2) / NULLIF(${videoStories.viewCount}, 0)`,
        })
        .from(videoStories)
        .innerJoin(users, eq(videoStories.userId, users.id))
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            publicStoryPublicationWhere(sql`NOW()`),
            eq(users.isDisabled, false),
            or(
              isNull(videoStories.restaurantId),
              eq(restaurants.isActive, true),
            ),
            gte(videoStories.createdAt, cutoffDate)
          )
        )
        .orderBy(desc(sql`${videoStories.likeCount} + ${videoStories.commentCount}`))
        .limit(20);

      const publicTrending = trending
        .filter((story: any) => isPublicStoryAssociationEligible(story))
        .map((story: any) => ({
          id: story.id,
          title: story.title,
          creatorName: story.creatorName,
          viewCount: Number(story.viewCount || 0),
          likeCount: Number(story.likeCount || 0),
          engagement: Number(story.engagement || 0),
        }));

      res.json({ trending: publicTrending, timeframe });
    } catch (error) {
      console.error('Error fetching trending stories:', error);
      res.status(500).json({ message: 'Failed to fetch trending stories' });
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
        .where(eq(users.isDisabled, false))
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
        .select({
          ...getTableColumns(videoStories),
          creatorDisabled: users.isDisabled,
          restaurantActive: restaurants.isActive,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantCuisineType: restaurants.cuisineType,
          restaurantDescription: restaurants.description,
          restaurantOwnerDisabled: sql<boolean | null>`(
            select linked_owner.is_disabled from users linked_owner
            where linked_owner.id = ${restaurants.ownerId} limit 1
          )`,
          restaurantRawData: restaurants.rawData,
        })
        .from(videoStories)
        .innerJoin(users, eq(videoStories.userId, users.id))
        .leftJoin(restaurants, eq(videoStories.restaurantId, restaurants.id))
        .where(
          and(
            eq(videoStories.userId, userId),
            publicStoryPublicationWhere(sql`NOW()`),
            eq(users.isDisabled, false),
            or(
              isNull(videoStories.restaurantId),
              eq(restaurants.isActive, true),
            ),
          )
        )
        .orderBy(desc(videoStories.createdAt));

      res.json({
        stories: userStories
          .filter((row: any) => isPublicStoryAssociationEligible(row))
          .map((row: any) => projectPublicStoryRow(row))
          .filter(Boolean),
      });
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
