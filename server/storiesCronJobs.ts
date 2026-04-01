import { db } from './db';
import { videoStories, storyLikes, storyComments, storyViews, storyAwards } from '@shared/schema';
import { eq, lte, sql, and, isNull, isNotNull } from 'drizzle-orm';
import { deleteFromCloudinary } from './imageUpload';
import auditLogger from './auditLogger';
import { detectReviewerLevelDrift } from './reviewerLevelDriftDetector';
import { timingSafeEqual } from 'crypto';

/**
 * Cleanup expired video stories
 * Runs daily to:
 * 1. Soft delete stories that have passed expiration
 * 2. Hard delete stories older than 30 days (if enabled)
 * 3. Clean up associated data (likes, comments, views)
 * 4. Delete from Cloudinary
 */
export async function cleanupExpiredStories(): Promise<{
  softDeleted: number;
  hardDeleted: number;
  cloudinaryErrors: number;
}> {
  const stats = {
    softDeleted: 0,
    hardDeleted: 0,
    cloudinaryErrors: 0,
  };

  try {
    console.log('[Cron] Starting story cleanup...');

    // 1. Soft delete - mark non-featured stories as expired (past expiresAt)
    const expiredStories = await db
      .select()
      .from(videoStories)
      .where(
        and(
          lte(videoStories.expiresAt, sql`NOW()`),
          isNull(videoStories.deletedAt),
          eq(videoStories.isFeatured, false)
        )
      );

    if (expiredStories.length > 0) {
      await db
        .update(videoStories)
        .set({
          deletedAt: sql`NOW()`,
          status: 'expired',
        })
        .where(
          and(
            lte(videoStories.expiresAt, sql`NOW()`),
            isNull(videoStories.deletedAt),
            eq(videoStories.isFeatured, false)
          )
        );

      stats.softDeleted = expiredStories.length;
      console.log(`[Cron] Soft deleted ${expiredStories.length} expired stories`);
    }

    // 2. Hard delete - completely remove stories older than 30 days
    // (disabled by default for audit trail, enable if needed)
    const hardDeleteEnabled = process.env.HARD_DELETE_STORIES === 'true';

    if (hardDeleteEnabled) {
      const oldStories = await db
        .select()
        .from(videoStories)
        .where(
          and(
            isNotNull(videoStories.deletedAt),
            lte(
              videoStories.deletedAt,
              sql`NOW() - INTERVAL '30 days'`
            )
          )
        );      for (const story of oldStories) {
        try {
          // Delete from Cloudinary
          if (story.videoUrl) {
            try {
              await deleteFromCloudinary(story.videoUrl);
            } catch (err) {
              console.error(`[Cron] Error deleting ${story.id} from Cloudinary:`, err);
              stats.cloudinaryErrors++;
            }
          }

          // Delete from database (cascade will handle related records)
          await db
            .delete(videoStories)
            .where(eq(videoStories.id, story.id));

          stats.hardDeleted++;
        } catch (err) {
          console.error(`[Cron] Error hard-deleting story ${story.id}:`, err);
        }
      }

      if (stats.hardDeleted > 0) {
        console.log(`[Cron] Hard deleted ${stats.hardDeleted} old stories`);
      }
    }

    // 3. Cleanup orphaned records (soft deleted stories' engagement data)
    // Keep for 7 days after deletion for analytics, then clean up
    // Cleanup is handled by cascade delete on storyLikes foreign key

    console.log('[Cron] Story cleanup completed successfully');
    console.log(`  - Soft deleted: ${stats.softDeleted}`);
    console.log(`  - Hard deleted: ${stats.hardDeleted}`);
    console.log(`  - Cloudinary errors: ${stats.cloudinaryErrors}`);

    return stats;
  } catch (error) {
    console.error('[Cron] Error during story cleanup:', error);
    throw error;
  }
}

/**
 * Recalculate user reviewer levels
 * Runs periodically to update levels based on engagement
 */
export async function recalculateReviewerLevels(): Promise<{
  updated: number;
}> {
  const stats = { updated: 0 };

  try {
    console.log('[Cron] Starting reviewer level recalculation...');

    // Get all users who have ever posted stories (any status)
    const usersWithStories = await db
      .selectDistinct({ userId: videoStories.userId })
      .from(videoStories)
      .where(isNotNull(videoStories.restaurantId));

    for (const { userId } of usersWithStories) {
      // Calculate total favorites
      const likeData = await db
        .select({
          totalFavorites: sql<number>`COUNT(${storyLikes.id})`.mapWith(Number),
        })
        .from(storyLikes)
        .innerJoin(
          videoStories,
          eq(storyLikes.storyId, videoStories.id)
        )
        .where(
          and(
            eq(videoStories.userId, userId),
            eq(videoStories.status, 'ready'),
            isNotNull(videoStories.restaurantId)
          )
        );

      const totalFavorites = likeData[0]?.totalFavorites || 0;

      // Calculate level
      let level = 1;
      if (totalFavorites >= 5000) level = 6;
      else if (totalFavorites >= 2500) level = 5;
      else if (totalFavorites >= 1000) level = 4;
      else if (totalFavorites >= 500) level = 3;
      else if (totalFavorites >= 100) level = 2;

      // Count distinct recommended restaurants (stories with a restaurantId)
      const storyCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${videoStories.restaurantId})`.mapWith(Number) })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, userId),
            isNotNull(videoStories.restaurantId)
          )
        );

      // Find top story
      const topStory = await db
        .select({ likeCount: videoStories.likeCount })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.userId, userId),
            eq(videoStories.status, 'ready'),
            isNotNull(videoStories.restaurantId)
          )
        )
        .orderBy(desc(videoStories.likeCount))
        .limit(1);

      // Update reviewer level
      await db
        .update(userReviewerLevels)
        .set({
          level,
          totalFavorites,
          totalStories: storyCount[0]?.count || 0,
          topStoryFavorites: topStory[0]?.likeCount || 0,
          updatedAt: sql`NOW()`,
        })
        .where(eq(userReviewerLevels.userId, userId));

      stats.updated++;
    }

    console.log(`[Cron] Updated ${stats.updated} reviewer levels`);
    return stats;
  } catch (error) {
    console.error('[Cron] Error during level recalculation:', error);
    throw error;
  }
}

/**
 * Register cron jobs with the server
 */
export function registerStoryCronJobs(app: any) {
  const configuredSecret = String(process.env.CRON_SECRET || '').trim();

  const readBearerToken = (authorizationHeader?: string | null) => {
    const raw = String(authorizationHeader || '').trim();
    if (!raw.toLowerCase().startsWith('bearer ')) return '';
    return raw.slice(7).trim();
  };

  const constantTimeEquals = (a: string, b: string) => {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  };

  const isLocalDevRequest = (req: any) => {
    if (process.env.NODE_ENV === 'production') return false;
    const ip = String(req?.ip || '').toLowerCase();
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip === 'localhost'
    );
  };

  const authorizeCronRequest = (req: any, res: any): boolean => {
    if (!configuredSecret) {
      if (isLocalDevRequest(req)) return true;
      res.status(503).json({ error: 'Cron secret not configured' });
      return false;
    }

    const presented = [
      String(req.headers?.['x-cron-secret'] || '').trim(),
      readBearerToken(String(req.headers?.authorization || '')),
    ].filter((value) => value.length > 0);

    const isAuthorized = presented.some((token) =>
      constantTimeEquals(token, configuredSecret),
    );

    if (!isAuthorized) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  };

  // Run daily at 2 AM UTC
  // For production, use a proper cron service (e.g., node-cron, cron, agenda)
  
  // POST endpoint for external cron service
  app.post('/api/cron/cleanup-stories', async (req: any, res: any) => {
    try {
      if (!authorizeCronRequest(req, res)) return;

      const stats = await cleanupExpiredStories();
      res.json({
        success: true,
        message: 'Story cleanup completed',
        stats,
      });
    } catch (error) {
      console.error('[API] Error in cleanup-stories endpoint:', error);
      res.status(500).json({
        error: 'Cleanup failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // POST endpoint for recalculation
  app.post('/api/cron/recalculate-levels', async (req: any, res: any) => {
    try {
      if (!authorizeCronRequest(req, res)) return;

      const stats = await recalculateReviewerLevels();

      // Run drift detector to ensure reviewer levels stay aligned with durable semantics
      await detectReviewerLevelDrift(
        db,
        auditLogger,
        { videoStories, userReviewerLevels },
        { limit: 200, includeZeroCases: false },
      );
      res.json({
        success: true,
        message: 'Reviewer levels recalculated',
        stats,
      });
    } catch (error) {
      console.error('[API] Error in recalculate-levels endpoint:', error);
      res.status(500).json({
        error: 'Recalculation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  console.log('✅ Story cron jobs registered');
  console.log('   POST /api/cron/cleanup-stories - Clean up expired stories');
  console.log('   POST /api/cron/recalculate-levels - Recalculate reviewer levels');
  console.log('   Include header: x-cron-secret: <CRON_SECRET>');
}

// Import for external calls
import { desc } from 'drizzle-orm';
import { userReviewerLevels } from '@shared/schema';
