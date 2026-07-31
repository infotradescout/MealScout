import { eq, and, isNull, isNotNull, lt, gte } from "drizzle-orm";
import { db } from "./db";
import { timingSafeEqual } from "crypto";
import { 
  videoStories, 
  featuredVideoSlots, 
  storyLikes,
  storyViews,
} from "../shared/schema";

/**
 * Fair Video Cycling Algorithm
 * 
 * Each eligible profile can use the same fair three-slot rotation.
 * Daily, we rotate which videos occupy those slots based on engagement score:
 * 
 * engagement_score = (likes / impressions) * 100
 * 
 * Process:
 * 1. Find all profiles with an eligible video
 * 2. For each restaurant, get all eligible videos (not expired, not featured yet today)
 * 3. Score each video by engagement
 * 4. Fill empty slots with highest-scoring videos
 * 5. Move expired featured videos out
 * 6. Log cycle history for analytics
 */

interface VideoScore {
  videoId: string;
  userId: string;
  title: string;
  likes: number;
  impressions: number;
  score: number; // (likes / impressions) * 100, or just likes if no impressions
}

async function scoreVideosByEngagement(restaurantId: string): Promise<VideoScore[]> {
  // Get all videos for this restaurant that aren't expired and not already featured today
  const videos = await db
    .select({
      id: videoStories.id,
      userId: videoStories.userId,
      title: videoStories.title,
      likeCount: videoStories.likeCount,
      impressionCount: videoStories.impressionCount,
      isFeatured: videoStories.isFeatured,
      expiresAt: videoStories.expiresAt,
      featuredEndedAt: videoStories.featuredEndedAt,
    })
    .from(videoStories)
    .where(
      and(
        eq(videoStories.restaurantId, restaurantId),
        eq(videoStories.status, "ready"),
        isNull(videoStories.deletedAt),
        // Not expired yet
        gte(videoStories.expiresAt, new Date()),
        // Either never featured or featured ended more than 1 day ago
        // (to allow videos to cycle back in after a break)
      )
    );

  // Score each video
  const scored: VideoScore[] = videos
    .map((v: typeof videos[0]) => {
      // Calculate engagement score
      // If no impressions yet, use like count as primary score
      const score =
        v.impressionCount && v.impressionCount > 0
          ? (v.likeCount / v.impressionCount) * 100
          : v.likeCount;

      return {
        videoId: v.id,
        userId: v.userId,
        title: v.title,
        likes: v.likeCount,
        impressions: v.impressionCount,
        score,
      };
    })
    .sort((a: VideoScore, b: VideoScore) => b.score - a.score); // Highest score first

  return scored;
}

async function cycleFeaturedVideos() {
  console.log("[CRON] Starting featured video cycling...");

  try {
    const eligibleProfiles = await db
      .selectDistinct({ restaurantId: videoStories.restaurantId })
      .from(videoStories)
      .where(
        and(
          isNotNull(videoStories.restaurantId),
          eq(videoStories.status, "ready"),
          isNull(videoStories.deletedAt),
          gte(videoStories.expiresAt, new Date()),
        ),
      );

    console.log(`[CRON] Found ${eligibleProfiles.length} profiles with eligible videos`);

    for (const profile of eligibleProfiles) {
      const restaurantId = String(profile.restaurantId || "").trim();
      if (!restaurantId) continue;
      const maxFeaturedSlots = 3;

      console.log(
        `[CRON] Cycling featured videos for profile ${restaurantId} (${maxFeaturedSlots} slots)`
      );

      // Get all slots for this restaurant
      const slots = await db
        .select()
        .from(featuredVideoSlots)
        .where(eq(featuredVideoSlots.restaurantId, restaurantId))
        .orderBy(featuredVideoSlots.slotNumber);

      // Ensure we have the right number of slots
      if (slots.length < maxFeaturedSlots) {
        // Create missing slots
        for (let i = slots.length + 1; i <= maxFeaturedSlots; i++) {
          await db.insert(featuredVideoSlots).values({
            restaurantId,
            slotNumber: i,
            currentVideoId: null,
            cycleStartDate: new Date(),
            cycleEndDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24hr from now
            previousVideoIds: [],
            engagementScore: 0,
            impressions: 0,
            clicks: 0,
          });
        }
      }

      // Score available videos
      const scoredVideos = await scoreVideosByEngagement(restaurantId);
      console.log(
        `[CRON] Found ${scoredVideos.length} eligible videos for rotation`
      );

      // Fill slots with highest-scoring videos
      let videoIndex = 0;
      for (let i = 0; i < Math.min(slots.length, maxFeaturedSlots); i++) {
        const slot = slots[i];

        // Skip if video is still within its 24hr featured period
        if (slot.cycleEndDate && slot.cycleEndDate > new Date()) {
          console.log(
            `[CRON] Slot ${slot.slotNumber} still active until ${slot.cycleEndDate}`
          );
          continue;
        }

        // Find next video to feature (skip if already featured recently)
        let nextVideo = null;
        while (videoIndex < scoredVideos.length) {
          const candidate = scoredVideos[videoIndex];
          const previousIds = slot.previousVideoIds || [];

          // Don't re-feature videos from the last 3 cycles (3 days)
          if (!previousIds.includes(candidate.videoId)) {
            nextVideo = candidate;
            videoIndex++;
            break;
          }
          videoIndex++;
        }

        if (nextVideo) {
          // Update slot with new video
          const previousIds = slot.previousVideoIds || [];
          previousIds.unshift(nextVideo.videoId); // Add to front
          previousIds.splice(5); // Keep last 5 videos

          const newCycleEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

          await db
            .update(featuredVideoSlots)
            .set({
              currentVideoId: nextVideo.videoId,
              cycleStartDate: new Date(),
              cycleEndDate: newCycleEnd,
              previousVideoIds: previousIds,
              engagementScore: nextVideo.score,
              impressions: nextVideo.impressions,
              updatedAt: new Date(),
            })
            .where(eq(featuredVideoSlots.id, slot.id));

          // Update video record
          await db
            .update(videoStories)
            .set({
              isFeatured: true,
              featuredSlotNumber: slot.slotNumber,
              featuredStartedAt: new Date(),
              featuredEndedAt: newCycleEnd,
            })
            .where(eq(videoStories.id, nextVideo.videoId));

          console.log(
            `[CRON] Slot ${slot.slotNumber}: "${nextVideo.title}" (score: ${nextVideo.score.toFixed(2)})`
          );
        } else {
          // No more videos to feature, clear slot if it was featured
          if (slot.currentVideoId) {
            await db
              .update(videoStories)
              .set({
                isFeatured: false,
                featuredEndedAt: new Date(),
              })
              .where(eq(videoStories.id, slot.currentVideoId));

            await db
              .update(featuredVideoSlots)
              .set({
                currentVideoId: null,
                updatedAt: new Date(),
              })
              .where(eq(featuredVideoSlots.id, slot.id));

            console.log(`[CRON] Slot ${slot.slotNumber}: Empty (no eligible videos)`);
          }
        }
      }
    }

    console.log("[CRON] Featured video cycling completed successfully");
  } catch (error) {
    console.error("[CRON] Error cycling featured videos:", error);
    throw error;
  }
}

/**
 * Clean up old featured video slot records (keep 90 days of history)
 */
async function cleanupOldFeaturedSlots() {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const result = await db
      .delete(featuredVideoSlots)
      .where(
        and(
          isNull(featuredVideoSlots.currentVideoId),
          lt(featuredVideoSlots.cycleEndDate, ninetyDaysAgo)
        )
      );

    console.log("[CRON] Cleaned up old featured video slots");
  } catch (error) {
    console.error("[CRON] Error cleaning up featured slots:", error);
  }
}

export async function registerFeaturedVideoCronJobs(app: any) {
  const configuredSecret = String(process.env.CRON_SECRET || "").trim();

  const readBearerToken = (authorizationHeader?: string | null) => {
    const raw = String(authorizationHeader || "").trim();
    if (!raw.toLowerCase().startsWith("bearer ")) return "";
    return raw.slice(7).trim();
  };

  const constantTimeEquals = (a: string, b: string) => {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  };

  const isLocalDevRequest = (req: any) => {
    if (process.env.NODE_ENV === "production") return false;
    const ip = String(req?.ip || "").toLowerCase();
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip === "localhost"
    );
  };

  // Run cycling daily at midnight UTC
  app.post("/api/cron/cycle-featured-videos", async (req: any, res: any) => {
    if (!configuredSecret) {
      if (!isLocalDevRequest(req)) {
        return res.status(503).json({ error: "Cron secret not configured" });
      }
    } else {
      const presented = [
        String(req.headers?.["x-cron-secret"] || "").trim(),
        readBearerToken(String(req.headers?.authorization || "")),
      ].filter((value) => value.length > 0);

      const isAuthorized = presented.some((token) =>
        constantTimeEquals(token, configuredSecret),
      );
      if (!isAuthorized) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    try {
      await cycleFeaturedVideos();
      await cleanupOldFeaturedSlots();
      res.json({ success: true, message: "Featured videos cycled" });
    } catch (error) {
      console.error("Cron job failed:", error);
      res.status(500).json({ error: "Cron job failed" });
    }
  });
}

export { cycleFeaturedVideos, cleanupOldFeaturedSlots };
