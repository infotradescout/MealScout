import type { Express } from "express";
import crypto from "crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { notifyUser } from "../productNotifications";
import { isAuthenticated, isRestaurantOwner } from "../unifiedAuth";
import { sanitizeUser } from "../utils/sanitize";
import { validateDocuments, checkRateLimit } from "../documentValidation";
import { vacEvaluateRestaurantSignup } from "../vacLite";
import { ensurePremiumTrialForUser } from "../services/premiumTrial";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  insertRestaurantSchema,
  insertRestaurantFavoriteSchema,
  insertRestaurantFollowSchema,
  insertRestaurantUserRecommendationSchema,
  insertVerificationRequestSchema,
  verificationRequests,
  deals,
  imageUploads,
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  videoStories,
  users,
  telemetryEvents,
  truckImportListings,
  menuItems,
  restaurants,
} from "@shared/schema";
import {
  isCloudinaryConfigured,
  upload as imageUpload,
  uploadToCloudinary,
} from "../imageUpload";
import {
  computeHomeRankingScore,
  getHomeRankingReasons,
} from "@shared/rankingPolicy";

const ensureTrialForUser = ensurePremiumTrialForUser;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const messageBodyToHtml = (value: string) =>
  value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");

type AnalyticsAccessResult = {
  hasAccess: boolean;
  error?: string;
  subscriptionTier?: string;
};

type RestaurantCoreRouteDependencies = {
  validateAnalyticsAccess: (userId: string) => Promise<AnalyticsAccessResult>;
};

const ENGAGEMENT_ACTION_COOLDOWN_MS = 3000;
const engagementActionLastSeen = new Map<string, number>();

const consumeEngagementWindow = (key: string) => {
  const now = Date.now();
  const lastSeen = engagementActionLastSeen.get(key) || 0;
  const elapsed = now - lastSeen;
  if (elapsed < ENGAGEMENT_ACTION_COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((ENGAGEMENT_ACTION_COOLDOWN_MS - elapsed) / 1000),
      ),
    };
  }

  engagementActionLastSeen.set(key, now);
  return { allowed: true, retryAfterSeconds: 0 };
};

export function registerRestaurantCoreRoutes(
  app: Express,
  { validateAnalyticsAccess }: RestaurantCoreRouteDependencies,
) {
  const trackEngagement = async (
    eventName: string,
    userId: string | null | undefined,
    restaurantId: string | null | undefined,
    properties?: Record<string, any>,
  ) => {
    const safeUserId = String(userId || "").trim();
    const safeRestaurantId = String(restaurantId || "").trim();
    if (!safeUserId || !safeRestaurantId) return;

    try {
      await db.insert(telemetryEvents).values({
        eventName,
        userId: safeUserId,
        properties: {
          restaurantId: safeRestaurantId,
          ...(properties || {}),
        },
      });
    } catch (error) {
      console.warn(`[telemetry] Failed to record ${eventName}:`, error);
    }
  };

  const trackBusinessConversationEvent = async (
    eventName: string,
    properties: Record<string, any>,
    userId?: string | null,
  ) => {
    try {
      await db.insert(telemetryEvents).values({
        eventName,
        userId: userId || null,
        properties,
      });
    } catch (error) {
      console.warn(`[telemetry] Failed to record ${eventName}:`, error);
    }
  };

  app.post("/api/restaurants", isRestaurantOwner, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const restaurantData = insertRestaurantSchema.parse({
        ...req.body,
        ownerId: userId,
      });

      const restaurant = await storage.createRestaurant(restaurantData);

      try {
        const enabled =
          String(
            process.env.VAC_AUTO_VERIFY_ENABLED || "true",
          ).toLowerCase() !== "false";
        if (enabled) {
          const vac = await vacEvaluateRestaurantSignup({
            user: req.user,
            restaurant,
            req,
          });
          console.log("🔍 VAC-lite evaluation:", {
            restaurantId: restaurant.id,
            restaurantName: (restaurant as any).name,
            score: vac.score,
            threshold: vac.threshold,
            shouldAutoVerify: vac.shouldAutoVerify,
            signals: vac.signals,
          });

          if (vac.shouldAutoVerify) {
            console.log("✅ Auto-verifying restaurant:", restaurant.id);
            await storage.setRestaurantVerified(restaurant.id, true);
            (restaurant as any).isVerified = true;
            try {
              await ensureTrialForUser(req.user);
            } catch (error) {
              console.warn(
                "ensureTrialForUser failed after /api/restaurants auto-verify:",
                error,
              );
            }
          } else {
            console.log(
              "⚠️  Creating manual verification request for:",
              restaurant.id,
            );
            const hasPending = await storage.hasPendingVerificationRequest(
              restaurant.id,
            );
            if (!hasPending) {
              await storage.createVerificationRequest({
                restaurantId: restaurant.id,
                documents: [],
              });
            } else {
              console.log("ℹ️  Pending verification request already exists");
            }
          }
        }
      } catch (error) {
        console.warn("VAC-lite failed", error);
      }

      res.json(restaurant);
    } catch (error: any) {
      console.error("Error creating restaurant:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/restaurants/my", isRestaurantOwner, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const restaurants = await storage.getRestaurantsByOwner(userId);
      res.json(restaurants);
    } catch (error) {
      console.error("Error fetching restaurants:", error);
      res.status(500).json({ message: "Failed to fetch restaurants" });
    }
  });

  app.get(
    "/api/auth/restaurant/user",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        res.json(sanitizeUser(req.user));
      } catch (error) {
        console.error("Error fetching restaurant owner:", error);
        res.status(500).json({ message: "Failed to fetch user" });
      }
    },
  );

  app.get("/api/restaurants/search", async (req, res) => {
    try {
      const { q: query, lat, lng, radius = 10 } = req.query;

      console.log("🔍 Restaurant search request:", { query, lat, lng, radius });

      if (!query || typeof query !== "string" || query.length < 2) {
        console.log("⚠️  Empty or short query, returning empty array");
        return res.json([]);
      }

      const searchTerm = query.toLowerCase();
      const restaurants = (await storage.getAllRestaurants()).filter(
        (restaurant: any) => isPublicBusinessVisible(restaurant),
      );

      let filteredRestaurants = restaurants.filter(
        (restaurant: any) =>
          restaurant.isActive &&
          (restaurant.name.toLowerCase().includes(searchTerm) ||
            restaurant.cuisineType?.toLowerCase().includes(searchTerm) ||
            restaurant.address?.toLowerCase().includes(searchTerm)),
      );

      if (lat && lng && typeof lat === "string" && typeof lng === "string") {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const radiusKm = parseFloat(radius as string);

        filteredRestaurants = filteredRestaurants.filter((restaurant: any) => {
          if (!restaurant.latitude || !restaurant.longitude) return false;

          const earthRadiusKm = 6371;
          const dLat = ((restaurant.latitude - userLat) * Math.PI) / 180;
          const dLng = ((restaurant.longitude - userLng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((userLat * Math.PI) / 180) *
              Math.cos((restaurant.latitude * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = earthRadiusKm * c;

          return distance <= radiusKm;
        });
      }

      res.json(filteredRestaurants);
    } catch (error) {
      console.error("Error searching restaurants:", error);
      res.status(500).json({ message: "Failed to search restaurants" });
    }
  });

  app.get("/api/restaurants/public", async (req, res) => {
    try {
      const {
        lat,
        lng,
        radius = 12,
        limit = 80,
      } = req.query as Record<string, string | undefined>;
      const parsedLimit = Math.max(
        1,
        Math.min(200, Number.parseInt(String(limit || "80"), 10) || 80),
      );
      const hasLocation = typeof lat === "string" && typeof lng === "string";
      const userLat = hasLocation ? Number.parseFloat(lat!) : Number.NaN;
      const userLng = hasLocation ? Number.parseFloat(lng!) : Number.NaN;
      const radiusKm = Math.max(
        1,
        Math.min(50, Number.parseFloat(String(radius || "12")) || 12),
      );

      const allRestaurants = (await storage.getAllRestaurants()).filter(
        (restaurant: any) => isPublicBusinessVisible(restaurant),
      );
      const activeRestaurants = allRestaurants.filter(
        (restaurant: any) => restaurant?.isActive,
      );
      const restaurantIds = activeRestaurants
        .map((restaurant: any) => String(restaurant?.id || "").trim())
        .filter(Boolean);

      const safeQuery = async <T>(
        label: string,
        run: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          console.warn(`[restaurants/public] ${label} query failed`, error);
          return fallback;
        }
      };

      const [
        favoriteRows,
        followRows,
        recommendationRows,
        activeDealRows,
        videoRecommendationRows,
        recommendationReactionRows,
        recommendationShareRows,
        videoEngagementRows,
      ] =
        restaurantIds.length > 0
          ? await Promise.all([
              safeQuery(
                "favorites",
                () =>
                  db
                    .select({
                      restaurantId: restaurantFavorites.restaurantId,
                      count: sql<number>`cast(count(*) as integer)`,
                    })
                    .from(restaurantFavorites)
                    .where(
                      inArray(restaurantFavorites.restaurantId, restaurantIds),
                    )
                    .groupBy(restaurantFavorites.restaurantId),
                [],
              ),
              safeQuery(
                "follows",
                () =>
                  db
                    .select({
                      restaurantId: restaurantFollows.restaurantId,
                      count: sql<number>`cast(count(*) as integer)`,
                    })
                    .from(restaurantFollows)
                    .where(
                      inArray(restaurantFollows.restaurantId, restaurantIds),
                    )
                    .groupBy(restaurantFollows.restaurantId),
                [],
              ),
              safeQuery(
                "recommendations",
                () =>
                  db
                    .select({
                      restaurantId: restaurantUserRecommendations.restaurantId,
                      count: sql<number>`cast(count(*) as integer)`,
                    })
                    .from(restaurantUserRecommendations)
                    .where(
                      inArray(
                        restaurantUserRecommendations.restaurantId,
                        restaurantIds,
                      ),
                    )
                    .groupBy(restaurantUserRecommendations.restaurantId),
                [],
              ),
              safeQuery(
                "active-deals",
                () =>
                  db
                    .select({
                      restaurantId: deals.restaurantId,
                      count: sql<number>`cast(count(*) as integer)`,
                    })
                    .from(deals)
                    .where(
                      and(
                        eq(deals.isActive, true),
                        inArray(deals.restaurantId, restaurantIds),
                      ),
                    )
                    .groupBy(deals.restaurantId),
                [],
              ),
              safeQuery(
                "video-recommendations",
                () =>
                  db
                    .select({
                      restaurantId: videoStories.restaurantId,
                      count: sql<number>`cast(count(*) as integer)`,
                    })
                    .from(videoStories)
                    .where(
                      and(
                        inArray(videoStories.restaurantId, restaurantIds),
                        eq(videoStories.status, "ready"),
                        isNull(videoStories.deletedAt),
                      ),
                    )
                    .groupBy(videoStories.restaurantId),
                [],
              ),
              safeQuery(
                "recommendation-reactions",
                () =>
                  db.execute(sql<{
                    restaurant_id: string;
                    score: number;
                  }>`
                    select
                      rur.restaurant_id,
                      cast(sum(case rr.reaction_type when 'like' then 1 when 'dislike' then -1 else 0 end) as integer) as score
                    from recommendation_reactions rr
                    inner join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
                    where rur.restaurant_id = any(${restaurantIds}::text[])
                    group by rur.restaurant_id
                  `),
                { rows: [] } as any,
              ),
              safeQuery(
                "recommendation-shares",
                () =>
                  db.execute(sql<{
                    restaurant_id: string;
                    count: number;
                  }>`
                    select
                      rur.restaurant_id,
                      cast(count(*) as integer) as count
                    from recommendation_shares rs
                    inner join restaurant_user_recommendations rur on rur.id = rs.recommendation_id
                    where rur.restaurant_id = any(${restaurantIds}::text[])
                    group by rur.restaurant_id
                  `),
                { rows: [] } as any,
              ),
              safeQuery(
                "video-engagement",
                () =>
                  db.execute(sql<{
                    restaurant_id: string;
                    score: number;
                  }>`
                    select
                      vs.restaurant_id,
                      cast(sum(coalesce(vs.like_count, 0) + coalesce(vs.comment_count, 0) + coalesce(vs.share_count, 0)) as integer) as score
                    from video_stories vs
                    where
                      vs.restaurant_id = any(${restaurantIds}::text[])
                      and vs.status = 'ready'
                      and vs.deleted_at is null
                    group by vs.restaurant_id
                  `),
                { rows: [] } as any,
              ),
            ])
          : [[], [], [], [], [], { rows: [] }, { rows: [] }, { rows: [] }];

      const favoritesByRestaurant = new Map(
        favoriteRows.map((row: any) => [
          String(row.restaurantId),
          Number(row.count) || 0,
        ]),
      );
      const followsByRestaurant = new Map(
        followRows.map((row: any) => [
          String(row.restaurantId),
          Number(row.count) || 0,
        ]),
      );
      const recommendationsByRestaurant = new Map(
        recommendationRows.map((row: any) => [
          String(row.restaurantId),
          Number(row.count) || 0,
        ]),
      );
      const activeDealsByRestaurant = new Map(
        activeDealRows.map((row: any) => [
          String(row.restaurantId),
          Number(row.count) || 0,
        ]),
      );
      const videoRecommendationsByRestaurant = new Map(
        videoRecommendationRows.map((row: any) => [
          String(row.restaurantId),
          Number(row.count) || 0,
        ]),
      );
      const reactionByRestaurant = new Map(
        ((recommendationReactionRows as any)?.rows || []).map((row: any) => [
          String(row.restaurant_id || ""),
          Number(row.score) || 0,
        ]),
      );
      const sharesByRestaurant = new Map(
        ((recommendationShareRows as any)?.rows || []).map((row: any) => [
          String(row.restaurant_id || ""),
          Number(row.count) || 0,
        ]),
      );
      const videoEngagementByRestaurant = new Map(
        ((videoEngagementRows as any)?.rows || []).map((row: any) => [
          String(row.restaurant_id || ""),
          Number(row.score) || 0,
        ]),
      );

      const attachTrustSignals = (restaurant: any, distance: number | null) => {
        const restaurantId = String(restaurant.id || "");
        const favoriteCount = favoritesByRestaurant.get(restaurantId) || 0;
        const followCount = followsByRestaurant.get(restaurantId) || 0;
        const recommendationCount =
          recommendationsByRestaurant.get(restaurantId) || 0;
        const videoRecommendationCount =
          videoRecommendationsByRestaurant.get(restaurantId) || 0;
        const activeDealCount = activeDealsByRestaurant.get(restaurantId) || 0;
        const communityActivityCount =
          Number(reactionByRestaurant.get(restaurantId) || 0) +
          Number(sharesByRestaurant.get(restaurantId) || 0) +
          Number(videoEngagementByRestaurant.get(restaurantId) || 0);
        const hasDistance =
          typeof distance === "number" && Number.isFinite(distance);
        const locationBoost = hasDistance
          ? Math.max(0, 1 - Math.min(distance, radiusKm) / radiusKm)
          : 0;
        const homeRankingScore = computeHomeRankingScore({
          recommendationCount,
          videoRecommendationCount,
          followCount,
          favoriteCount,
          activeDealCount,
          locationBoost,
          liveTruckBoost: 0,
          communityActivityCount,
        });

        return {
          ...restaurant,
          distance,
          favoriteCount,
          followCount,
          recommendationCount,
          videoRecommendationCount,
          communityActivityCount,
          activeDealCount,
          homeRankingScore,
          homeRankingReason: getHomeRankingReasons({
            recommendationCount,
            videoRecommendationCount,
            followCount,
            favoriteCount,
            activeDealCount,
            hasLocationBoost: locationBoost > 0,
          }),
        };
      };

      const withDistance = activeRestaurants
        .map((restaurant: any) => {
          if (!hasLocation || Number.isNaN(userLat) || Number.isNaN(userLng)) {
            return attachTrustSignals(restaurant, null);
          }

          const latRaw =
            restaurant.currentLatitude ?? restaurant.latitude ?? null;
          const lngRaw =
            restaurant.currentLongitude ?? restaurant.longitude ?? null;
          const targetLat =
            typeof latRaw === "number"
              ? latRaw
              : Number.parseFloat(String(latRaw));
          const targetLng =
            typeof lngRaw === "number"
              ? lngRaw
              : Number.parseFloat(String(lngRaw));
          if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            return null;
          }

          const earthRadiusKm = 6371;
          const dLat = ((targetLat - userLat) * Math.PI) / 180;
          const dLng = ((targetLng - userLng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((userLat * Math.PI) / 180) *
              Math.cos((targetLat * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distanceKm = earthRadiusKm * c;
          if (!Number.isFinite(distanceKm) || distanceKm > radiusKm)
            return null;

          return attachTrustSignals(restaurant, distanceKm * 0.621371);
        })
        .filter(Boolean) as Array<any>;

      const sorted = withDistance.sort((a: any, b: any) => {
        const aScore =
          typeof a.homeRankingScore === "number" &&
          Number.isFinite(a.homeRankingScore)
            ? a.homeRankingScore
            : 0;
        const bScore =
          typeof b.homeRankingScore === "number" &&
          Number.isFinite(b.homeRankingScore)
            ? b.homeRankingScore
            : 0;
        if (aScore !== bScore) return bScore - aScore;

        const aDistance =
          typeof a.distance === "number" && Number.isFinite(a.distance)
            ? a.distance
            : Number.POSITIVE_INFINITY;
        const bDistance =
          typeof b.distance === "number" && Number.isFinite(b.distance)
            ? b.distance
            : Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;

        const aUpdated = new Date(a.updatedAt || 0).getTime();
        const bUpdated = new Date(b.updatedAt || 0).getTime();
        return bUpdated - aUpdated;
      });

      res.json(sorted.slice(0, parsedLimit));
    } catch (error) {
      console.error("Error fetching public restaurants:", error);
      res.status(500).json({ message: "Failed to fetch public restaurants" });
    }
  });

  app.get("/api/restaurants/:id", async (req, res) => {
    try {
      const restaurant = await storage.getRestaurant(req.params.id);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      res.json(restaurant);
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  app.post("/api/restaurants/:restaurantId/message", async (req: any, res) => {
    try {
      const { restaurantId } = req.params;
      const userId = req.user?.id || null;
      const rawGuestEmail = String(req.body?.email || "").trim();
      const rawGuestName = String(req.body?.name || "").trim();
      const senderKey = userId || rawGuestEmail || req.ip || "anonymous";
      const actionGate = consumeEngagementWindow(
        `${senderKey}:${restaurantId}:business-message`,
      );
      if (!actionGate.allowed) {
        return res.status(429).json({
          message: "Please wait a moment before sending another message.",
          retryAfterSeconds: actionGate.retryAfterSeconds,
        });
      }

      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant || !isPublicBusinessVisible(restaurant)) {
        return res.status(404).json({ message: "Business not found" });
      }

      const owner = await storage.getUser(restaurant.ownerId);
      if (!owner?.email) {
        return res
          .status(400)
          .json({ message: "This business is not accepting messages yet" });
      }

      const sender = userId ? await storage.getUser(userId) : null;
      const senderEmail = String(sender?.email || req.user?.email || "").trim();
      const replyEmail = senderEmail || rawGuestEmail;
      const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail);
      if (!replyEmail || !emailLooksValid) {
        return res.status(400).json({
          message: "Enter a valid reply email before messaging this business",
        });
      }
      if (!sender && rawGuestName.length < 2) {
        return res.status(400).json({
          message: "Enter your name before messaging this business",
        });
      }

      const topic = String(req.body?.topic || "Question")
        .trim()
        .slice(0, 60);
      const preferredReply =
        String(req.body?.preferredReply || "email") === "phone"
          ? "phone"
          : "email";
      const phone = String(req.body?.phone || "")
        .trim()
        .slice(0, 40);
      if (preferredReply === "phone" && phone.length < 7) {
        return res.status(400).json({
          message: "Enter a callback number or choose email reply",
        });
      }
      const message = String(req.body?.message || "").trim();
      if (message.length < 10 || message.length > 2000) {
        return res.status(400).json({
          message: "Message must be between 10 and 2000 characters",
        });
      }

      const senderName =
        [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") ||
        req.user?.name ||
        rawGuestName ||
        "A MealScout user";
      const businessName = restaurant.name || "your business";
      const conversationId = crypto.randomUUID();
      const baseUrl = String(
        process.env.PUBLIC_BASE_URL || "http://localhost:5000",
      ).replace(/\/+$/, "");
      const dashboardUrl = `${baseUrl}/restaurant-owner-dashboard`;
      const trackedDashboardUrl = `${baseUrl}/api/restaurants/messages/${conversationId}/open?restaurantId=${encodeURIComponent(restaurantId)}`;
      const safeBusinessName = escapeHtml(businessName);
      const safeSenderName = escapeHtml(senderName);
      const safeSenderEmail = escapeHtml(replyEmail);
      const safePhone = escapeHtml(phone);
      const safeTopic = escapeHtml(topic || "General question");
      const replyLine =
        preferredReply === "phone" && phone
          ? `<p><strong>Preferred reply:</strong> Call/text ${safePhone}</p><p><strong>Backup email:</strong> ${safeSenderEmail}</p>`
          : `<p><strong>Reply directly to:</strong> ${safeSenderEmail}</p>`;
      const textReplyLine =
        preferredReply === "phone" && phone
          ? `Preferred reply: Call/text ${phone}\nBackup email: ${replyEmail}`
          : `Reply directly to: ${replyEmail}`;
      const subjectTopic = topic || "Question";
      const html = `
          <p><strong>${safeSenderName}</strong> contacted <strong>${safeBusinessName}</strong> from MealScout.</p>
          <p><strong>Topic:</strong> ${safeTopic}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
          ${messageBodyToHtml(message)}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
          ${replyLine}
          <p style="color:#6b7280;font-size:13px;">MealScout shared this email address because the user chose to contact your business. No live location data, payment details, or private preference data was included.</p>
          <p><a href="${trackedDashboardUrl}">Open your MealScout dashboard</a></p>
        `;
      const text = `${senderName} contacted ${businessName} from MealScout.\n\nTopic: ${subjectTopic}\n\n${message}\n\n${textReplyLine}\n\nMealScout shared this reply info because the user chose to contact your business. No live location data, payment details, or private preference data was included.\n\nDashboard: ${trackedDashboardUrl}`;

      const notificationResult = await notifyUser({
        user: owner,
        topic: "businessMessages",
        title: `MealScout ${subjectTopic}: ${businessName}`,
        body: `${senderName} sent ${businessName} a MealScout message.`,
        actionUrl: `/api/restaurants/messages/${conversationId}/open?restaurantId=${encodeURIComponent(restaurantId)}`,
        priority: "high",
        sourceType: "business_message",
        sourceId: conversationId,
        actorUserId: userId,
        channels: ["in_app", "email", "sms"],
        emailHtml: html,
        emailText: text,
        smsText: `MealScout: ${senderName} sent ${businessName} a message. Open your dashboard to respond.`,
        metadata: {
          conversationId,
          restaurantId,
          restaurantOwnerId: restaurant.ownerId,
          topic,
          preferredReply,
          senderKind: userId ? "registered_user" : "guest",
          hasReplyEmail: Boolean(replyEmail),
          hasPhone: Boolean(phone),
          messageLength: message.length,
          source: "restaurant_profile",
        },
      });
      const notificationChannels = notificationResult.channels || {};
      const ok =
        notificationChannels.email === "sent" ||
        notificationChannels.in_app === "created" ||
        notificationChannels.sms === "sent";

      await trackBusinessConversationEvent(
        "business_contact_intent_sent",
        {
          conversationId,
          restaurantId,
          restaurantOwnerId: restaurant.ownerId,
          topic,
          preferredReply,
          senderKind: userId ? "registered_user" : "guest",
          hasReplyEmail: Boolean(replyEmail),
          hasPhone: Boolean(phone),
          messageLength: message.length,
          delivered: ok,
          notificationId: notificationResult.notificationId,
          notificationChannels,
          source: "restaurant_profile",
        },
        userId,
      );

      if (userId) {
        await trackEngagement(
          "restaurant_user_message_sent",
          userId,
          restaurantId,
          {
            conversationId,
            topic,
            preferredReply,
            delivered: ok,
          },
        );
      }

      res.json({ success: ok, conversationId });
    } catch (error: any) {
      console.error("Error sending business message:", error);
      res.status(500).json({
        message: error?.message || "Failed to send message",
      });
    }
  });

  app.get(
    "/api/restaurants/messages/:conversationId/open",
    async (req: any, res) => {
      const conversationId = String(req.params.conversationId || "").trim();
      const restaurantId = String(req.query.restaurantId || "").trim();
      const baseUrl = String(
        process.env.PUBLIC_BASE_URL || "http://localhost:5000",
      ).replace(/\/+$/, "");

      if (conversationId) {
        const restaurant = restaurantId
          ? await storage.getRestaurant(restaurantId).catch(() => null)
          : null;
        await trackBusinessConversationEvent(
          "business_contact_owner_return_opened",
          {
            conversationId,
            restaurantId: restaurantId || null,
            restaurantOwnerId: restaurant?.ownerId || null,
            source: "business_contact_email",
            userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
          },
          req.user?.id || null,
        );
      }

      res.redirect(`${baseUrl}/restaurant-owner-dashboard`);
    },
  );

  app.get("/api/restaurants/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = parseFloat(req.query.radius as string) || 5;

      const restaurants = await storage.getNearbyRestaurants(lat, lng, radius);
      res.json(restaurants);
    } catch (error) {
      console.error("Error fetching nearby restaurants:", error);
      res.status(500).json({ message: "Failed to fetch nearby restaurants" });
    }
  });

  // Follow is no longer a separate manual action on restaurant cards -
  // favoriting or recommending a restaurant implies wanting updates from it.
  // Best-effort: a follow failure should never block the favorite/recommend
  // response, and an existing follow (23505) is not an error here.
  async function autoFollowRestaurant(userId: string, restaurantId: string) {
    try {
      const followData = insertRestaurantFollowSchema.parse({
        restaurantId,
        userId,
      });
      await storage.createRestaurantFollow(followData);
      void trackEngagement("restaurant_follow_added", userId, restaurantId);
    } catch (error: any) {
      if (error?.code !== "23505") {
        console.error("Error auto-following restaurant:", error);
      }
    }
  }

  app.post(
    "/api/restaurants/:restaurantId/favorite",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const maxFavorites = 3;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:favorite:add`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const favoriteCount =
          await storage.getUserRestaurantFavoritesCount(userId);
        if (favoriteCount >= maxFavorites) {
          return res.status(400).json({
            message: `You can favorite up to ${maxFavorites} restaurants.`,
          });
        }

        const favoriteData = insertRestaurantFavoriteSchema.parse({
          restaurantId,
          userId,
        });

        const favorite = await storage.createRestaurantFavorite(favoriteData);
        void trackEngagement("restaurant_favorite_added", userId, restaurantId);
        await autoFollowRestaurant(userId, restaurantId);
        res.json(favorite);
      } catch (error: any) {
        console.error("Error adding restaurant favorite:", error);
        if (error.code === "23505") {
          void trackEngagement(
            "restaurant_favorite_duplicate",
            req.user?.id,
            req.params?.restaurantId,
          );
          return res.status(200).json({
            success: true,
            alreadyExists: true,
            message: "Restaurant already favorited",
          });
        }
        res
          .status(400)
          .json({ message: error.message || "Failed to add favorite" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/favorite",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:favorite:remove`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }

        await storage.removeRestaurantFavorite(restaurantId, userId);
        void trackEngagement(
          "restaurant_favorite_removed",
          userId,
          restaurantId,
        );
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing restaurant favorite:", error);
        res.status(500).json({ message: "Failed to remove favorite" });
      }
    },
  );

  app.get(
    "/api/favorites/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const favorites = await storage.getUserRestaurantFavorites(userId);
        res.json(favorites);
      } catch (error) {
        console.error("Error fetching user restaurant favorites:", error);
        res.status(500).json({ message: "Failed to fetch favorites" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/follow",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:follow:add`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const followData = insertRestaurantFollowSchema.parse({
          restaurantId,
          userId,
        });

        const follow = await storage.createRestaurantFollow(followData);
        void trackEngagement("restaurant_follow_added", userId, restaurantId);
        res.json(follow);
      } catch (error: any) {
        console.error("Error adding restaurant follow:", error);
        if (error.code === "23505") {
          void trackEngagement(
            "restaurant_follow_duplicate",
            req.user?.id,
            req.params?.restaurantId,
          );
          return res.status(200).json({
            success: true,
            alreadyExists: true,
            message: "Restaurant already followed",
          });
        }
        res
          .status(400)
          .json({ message: error.message || "Failed to follow restaurant" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/follow",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:follow:remove`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }

        await storage.removeRestaurantFollow(restaurantId, userId);
        void trackEngagement("restaurant_follow_removed", userId, restaurantId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing restaurant follow:", error);
        res.status(500).json({ message: "Failed to unfollow restaurant" });
      }
    },
  );

  app.get(
    "/api/following/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const follows = await storage.getUserRestaurantFollows(userId);
        res.json(follows);
      } catch (error) {
        console.error("Error fetching user restaurant follows:", error);
        res.status(500).json({ message: "Failed to fetch follows" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/recommend",
    isAuthenticated,
    imageUpload.single("image"),
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const body = req.body || {};
        const comment = String(body.comment || "").trim() || null;
        const scoresRaw =
          typeof body.scores === "string"
            ? JSON.parse(body.scores || "{}")
            : body.scores || {};
        const scores = {
          food: Number(scoresRaw.food ?? body.foodScore ?? 0) || null,
          value: Number(scoresRaw.value ?? body.valueScore ?? 0) || null,
          speed: Number(scoresRaw.speed ?? body.speedScore ?? 0) || null,
          vibe: Number(scoresRaw.vibe ?? body.vibeScore ?? 0) || null,
        };
        const scoreValues = Object.values(scores).filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value) && value > 0,
        );
        const hasContext = Boolean(
          comment || scoreValues.length > 0 || req.file,
        );
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:recommend:${hasContext ? "context" : "tap"}`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }
        const averageScore =
          scoreValues.length > 0
            ? Math.round(
                scoreValues.reduce((sum, value) => sum + value, 0) /
                  scoreValues.length,
              )
            : null;
        const rating = averageScore
          ? Math.max(1, Math.min(5, Math.round(averageScore / 20)))
          : null;

        const recommendationData =
          insertRestaurantUserRecommendationSchema.parse({
            restaurantId,
            userId,
          });

        let recommendation: any = null;
        let createdRecommendation = false;
        try {
          recommendation =
            await storage.createRestaurantUserRecommendation(
              recommendationData,
            );
          createdRecommendation = true;
        } catch (error: any) {
          if (error.code !== "23505") throw error;
          const [existing] = await db
            .select()
            .from(restaurantUserRecommendations)
            .where(
              and(
                eq(restaurantUserRecommendations.restaurantId, restaurantId),
                eq(restaurantUserRecommendations.userId, userId),
              ),
            )
            .limit(1);
          recommendation = existing;
        }
        await autoFollowRestaurant(userId, restaurantId);

        let proofPhoto: any = null;
        if (req.file) {
          if (!isCloudinaryConfigured()) {
            return res.status(503).json({
              message: "Image upload service not configured",
            });
          }
          const uploadResult = await uploadToCloudinary(
            req.file.buffer,
            "restaurant-recommendation-photos",
            `restaurant-recommendation-${restaurantId}-${userId}-${Date.now()}`,
          );
          const [createdUpload] = await db
            .insert(imageUploads)
            .values({
              uploadedByUserId: userId,
              imageType: "restaurant_recommendation_photo",
              entityId: recommendation?.id || restaurantId,
              entityType: "restaurant_recommendation",
              cloudinaryPublicId: uploadResult.publicId,
              cloudinaryUrl: uploadResult.secureUrl,
              thumbnailUrl: uploadResult.thumbnailUrl,
              width: uploadResult.width,
              height: uploadResult.height,
              fileSize: uploadResult.bytes,
              mimeType: req.file.mimetype,
            } as any)
            .returning();
          proofPhoto = createdUpload;
        }

        if (hasContext) {
          const scoreLines =
            scoreValues.length > 0
              ? [
                  scores.food ? `Food: ${scores.food}/100` : null,
                  scores.value ? `Value: ${scores.value}/100` : null,
                  scores.speed ? `Speed: ${scores.speed}/100` : null,
                  scores.vibe ? `Vibe: ${scores.vibe}/100` : null,
                ]
                  .filter(Boolean)
                  .join("\n")
              : "";
          const photoLine = proofPhoto?.cloudinaryUrl
            ? `Photo proof: ${proofPhoto.cloudinaryUrl}`
            : "";
          const reviewComment =
            [comment, scoreLines, photoLine].filter(Boolean).join("\n\n") ||
            "Recommended on MealScout.";
          await storage.createReview({
            restaurantId,
            userId,
            rating: rating || 5,
            comment: reviewComment,
          } as any);
        }

        const influenceBump = createdRecommendation
          ? hasContext
            ? 3
            : 1
          : hasContext
            ? 2
            : 0;
        if (createdRecommendation || hasContext) {
          await db
            .update(users)
            .set({
              recommendationCount: createdRecommendation
                ? sql`${users.recommendationCount} + 1`
                : users.recommendationCount,
              reviewCount: hasContext
                ? sql`${users.reviewCount} + 1`
                : users.reviewCount,
              influenceScore:
                influenceBump > 0
                  ? sql`${users.influenceScore} + ${influenceBump}`
                  : users.influenceScore,
              updatedAt: new Date(),
            } as any)
            .where(eq(users.id, userId));
        }

        void trackEngagement(
          hasContext
            ? "restaurant_recommend_context_added"
            : "restaurant_recommend_added",
          userId,
          restaurantId,
        );
        res.json({
          ...recommendation,
          success: true,
          alreadyExists: !createdRecommendation,
          contextSaved: hasContext,
          proofPhoto,
        });
      } catch (error: any) {
        console.error("Error adding restaurant recommendation:", error);
        if (error.code === "23505") {
          void trackEngagement(
            "restaurant_recommend_duplicate",
            req.user?.id,
            req.params?.restaurantId,
          );
          return res.status(200).json({
            success: true,
            alreadyExists: true,
            message: "Restaurant already recommended",
          });
        }
        res.status(400).json({
          message: error.message || "Failed to recommend restaurant",
        });
      }
    },
  );

  /**
   * PATCH /api/restaurants/:restaurantId/featured-item
   * Owner's manual pick for the one dish spotlighted on discovery cards.
   * Body: { menuItemId: string | null } - null clears the pick, falling
   * back to the automatic top-recommended-dish ranking.
   */
  app.patch(
    "/api/restaurants/:restaurantId/featured-item",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          userId,
          "manageProfile",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: you can only set this for restaurants you own",
          });
        }

        const menuItemId =
          req.body?.menuItemId === null || req.body?.menuItemId === undefined
            ? null
            : String(req.body.menuItemId).trim() || null;

        if (menuItemId) {
          const [item] = await db
            .select({ id: menuItems.id, restaurantId: menuItems.restaurantId })
            .from(menuItems)
            .where(eq(menuItems.id, menuItemId))
            .limit(1);
          if (!item || item.restaurantId !== restaurantId) {
            return res.status(400).json({
              message: "That item doesn't belong to this restaurant.",
            });
          }
        }

        await db
          .update(restaurants)
          .set({ featuredMenuItemId: menuItemId, updatedAt: new Date() } as any)
          .where(eq(restaurants.id, restaurantId));

        res.json({ success: true, featuredMenuItemId: menuItemId });
      } catch (error: any) {
        console.error("Error setting featured item:", error);
        res.status(400).json({
          message: error.message || "Failed to set the featured item",
        });
      }
    },
  );

  app.get(
    "/api/recommendations/restaurants",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const recommendations =
          await storage.getUserRestaurantRecommendations(userId);
        res.json(recommendations);
      } catch (error) {
        console.error("Error fetching user restaurant recommendations:", error);
        res.status(500).json({ message: "Failed to fetch recommendations" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/recommendations/public",
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const viewerId = req.user?.id || null;
        const limit = Math.max(
          1,
          Math.min(
            50,
            Number.parseInt(String(req.query.limit || "12"), 10) || 12,
          ),
        );

        const rowsResult = await db.execute(sql<{
          id: string;
          user_id: string;
          created_at: Date;
          first_name: string | null;
          last_name: string | null;
          like_count: number;
          share_count: number;
          viewer_reaction: string | null;
          recommendation_comment: string | null;
          recommendation_photo_url: string | null;
          has_video_recommendation: boolean;
        }>`
          select
            rur.id,
            rur.user_id,
            rur.created_at,
            u.first_name,
            u.last_name,
            coalesce(sum(case rr.reaction_type when 'like' then 1 else 0 end), 0)::int as like_count,
            coalesce(count(distinct rs.id), 0)::int as share_count,
            max(case when rr.user_id = ${viewerId} then rr.reaction_type else null end) as viewer_reaction,
            (
              select rv.comment
              from reviews rv
              where rv.restaurant_id = rur.restaurant_id
                and rv.user_id = rur.user_id
                and rv.comment is not null
                and length(trim(rv.comment)) > 0
              order by rv.created_at desc
              limit 1
            ) as recommendation_comment,
            (
              select substring(rv.comment from '(https?://\\S+)')
              from reviews rv
              where rv.restaurant_id = rur.restaurant_id
                and rv.user_id = rur.user_id
                and rv.comment is not null
                and rv.comment ~* '(https?://\\S+)'
              order by rv.created_at desc
              limit 1
            ) as recommendation_photo_url,
            exists(
              select 1
              from video_stories vs
              where vs.restaurant_id = rur.restaurant_id
                and vs.user_id = rur.user_id
                and vs.status = 'ready'
                and vs.deleted_at is null
                and (vs.is_approved is null or vs.is_approved = true)
            ) as has_video_recommendation
          from restaurant_user_recommendations rur
          inner join users u on u.id = rur.user_id
          left join recommendation_reactions rr on rr.recommendation_id = rur.id
          left join recommendation_shares rs on rs.recommendation_id = rur.id
          where rur.restaurant_id = ${restaurantId}
          group by rur.id, rur.user_id, rur.created_at, u.first_name, u.last_name
          order by rur.created_at desc
          limit ${limit}
        `);

        const rows = Array.isArray((rowsResult as any).rows)
          ? (rowsResult as any).rows
          : [];
        const payload = rows.map((row: any) => ({
          id: String(row.id || ""),
          userId: String(row.user_id || ""),
          createdAt: row.created_at,
          authorName:
            String(
              [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
            ) || "Community Member",
          likeCount: Number(row.like_count) || 0,
          shareCount: Number(row.share_count) || 0,
          comment: String(row.recommendation_comment || "").trim() || null,
          photoUrl: String(row.recommendation_photo_url || "").trim() || null,
          hasVideoRecommendation: Boolean(row.has_video_recommendation),
          viewerReaction:
            row.viewer_reaction === "like" || row.viewer_reaction === "dislike"
              ? row.viewer_reaction
              : null,
        }));

        res.json(payload);
      } catch (error) {
        console.error("Error fetching public recommendations:", error);
        res.status(500).json({ message: "Failed to fetch recommendations" });
      }
    },
  );

  app.post(
    "/api/recommendations/:recommendationId/reaction",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const recommendationId = String(
          req.params.recommendationId || "",
        ).trim();
        const userId = String(req.user.id || "").trim();
        const reaction = String(req.body?.reaction || "")
          .trim()
          .toLowerCase();

        if (!recommendationId) {
          return res.status(400).json({ message: "Invalid recommendation id" });
        }
        if (!["like", "dislike", "clear"].includes(reaction)) {
          return res
            .status(400)
            .json({ message: "Reaction must be like, dislike, or clear" });
        }

        const existing = await db.execute(sql<{
          id: string;
          reaction_type: string;
        }>`
          select id, reaction_type
          from recommendation_reactions
          where recommendation_id = ${recommendationId} and user_id = ${userId}
          limit 1
        `);
        const existingRow = ((existing as any)?.rows || [])[0] as
          { id: string; reaction_type: string } | undefined;

        if (reaction === "clear") {
          await db.execute(sql`
            delete from recommendation_reactions
            where recommendation_id = ${recommendationId} and user_id = ${userId}
          `);
        } else if (!existingRow) {
          await db.execute(sql`
            insert into recommendation_reactions (recommendation_id, user_id, reaction_type)
            values (${recommendationId}, ${userId}, ${reaction})
          `);
        } else if (existingRow.reaction_type !== reaction) {
          await db.execute(sql`
            update recommendation_reactions
            set reaction_type = ${reaction}, updated_at = now()
            where recommendation_id = ${recommendationId} and user_id = ${userId}
          `);
        }

        const summaryResult = await db.execute(sql<{
          like_count: number;
          dislike_count: number;
        }>`
          select
            coalesce(sum(case reaction_type when 'like' then 1 else 0 end), 0)::int as like_count,
            coalesce(sum(case reaction_type when 'dislike' then 1 else 0 end), 0)::int as dislike_count
          from recommendation_reactions
          where recommendation_id = ${recommendationId}
        `);
        const summary = ((summaryResult as any)?.rows || [])[0] || {
          like_count: 0,
          dislike_count: 0,
        };

        res.json({
          success: true,
          reaction: reaction === "clear" ? null : reaction,
          likeCount: Number(summary.like_count) || 0,
        });
      } catch (error) {
        console.error("Error reacting to recommendation:", error);
        res.status(500).json({ message: "Failed to save reaction" });
      }
    },
  );

  app.post(
    "/api/recommendations/:recommendationId/share",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const recommendationId = String(
          req.params.recommendationId || "",
        ).trim();
        const userId = String(req.user.id || "").trim();
        if (!recommendationId) {
          return res.status(400).json({ message: "Invalid recommendation id" });
        }

        await db.execute(sql`
          insert into recommendation_shares (recommendation_id, user_id)
          values (${recommendationId}, ${userId})
        `);

        const shareCountResult = await db.execute(sql<{ share_count: number }>`
          select coalesce(count(*), 0)::int as share_count
          from recommendation_shares
          where recommendation_id = ${recommendationId}
        `);
        const shareCount = Number(
          ((shareCountResult as any)?.rows || [])[0]?.share_count || 0,
        );

        res.json({ success: true, shareCount });
      } catch (error) {
        console.error("Error sharing recommendation:", error);
        res.status(500).json({ message: "Failed to save share" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/favorites",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          userId,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        const analyticsAccess = await validateAnalyticsAccess(userId);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        const { startDate, endDate } = req.query;
        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const favoritesAnalytics =
          await storage.getRestaurantFavoritesAnalytics(
            restaurantId,
            dateRange,
          );
        res.json(favoritesAnalytics);
      } catch (error) {
        console.error("Error fetching favorites analytics:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch favorites analytics" });
      }
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/analytics/recommendations",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;

        const isAuthorized = await storage.verifyRestaurantOwnership(
          restaurantId,
          userId,
          "viewAnalytics",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only access analytics for restaurants you own",
          });
        }

        const analyticsAccess = await validateAnalyticsAccess(userId);
        if (!analyticsAccess.hasAccess) {
          return res.status(402).json({
            message: analyticsAccess.error,
            subscriptionTier: analyticsAccess.subscriptionTier,
          });
        }

        const { startDate, endDate } = req.query;
        let dateRange: { start: Date; end: Date } | undefined;
        if (startDate && endDate) {
          dateRange = {
            start: new Date(startDate as string),
            end: new Date(endDate as string),
          };
        }

        const recommendationsAnalytics =
          await storage.getRestaurantRecommendationsAnalytics(
            restaurantId,
            dateRange,
          );
        res.json(recommendationsAnalytics);
      } catch (error) {
        console.error("Error fetching recommendations analytics:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch recommendations analytics" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/recommendation/click",
    async (req: any, res) => {
      try {
        const { recommendationId } = req.body;

        if (recommendationId) {
          await storage.markRecommendationClicked(recommendationId);
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Error tracking recommendation click:", error);
        res
          .status(500)
          .json({ message: "Failed to track recommendation click" });
      }
    },
  );

  app.post(
    "/api/restaurants/:id/verification/request",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = req.params.id;
        const userId = req.user.id;

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant || restaurant.ownerId !== userId) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        if (restaurant.claimedFromImportId) {
          const [listing] = await db
            .select({
              externalId: truckImportListings.externalId,
            })
            .from(truckImportListings)
            .where(eq(truckImportListings.id, restaurant.claimedFromImportId))
            .limit(1);
          const expected = String(listing?.externalId || "").trim();
          if (expected) {
            const provided = String(req.body?.licenseNumber || "").trim();
            if (!provided) {
              return res.status(400).json({
                message: "License number is required for imported food trucks.",
              });
            }
            if (provided.toLowerCase() !== expected.toLowerCase()) {
              return res.status(400).json({
                message:
                  "License number does not match the registry record for this truck.",
              });
            }
          }
        }

        const verificationData = insertVerificationRequestSchema.parse({
          ...req.body,
          restaurantId,
        });
        const normalizedDocuments = Array.isArray(verificationData.documents)
          ? verificationData.documents
              .map((doc) => (typeof doc === "string" ? doc.trim() : ""))
              .filter((doc) => doc.length > 0)
          : [];
        if (normalizedDocuments.length === 0) {
          return res.status(400).json({
            message:
              "Please upload at least one verification document before submitting.",
          });
        }
        verificationData.documents = normalizedDocuments;

        const documentValidation = validateDocuments(
          verificationData.documents,
        );
        if (!documentValidation.valid) {
          return res.status(400).json({
            message: "Document validation failed",
            errors: documentValidation.errors,
          });
        }

        const [pendingRequest] = await db
          .select({
            id: verificationRequests.id,
            documents: verificationRequests.documents,
          })
          .from(verificationRequests)
          .where(
            and(
              eq(verificationRequests.restaurantId, restaurantId),
              eq(verificationRequests.status, "pending"),
            ),
          )
          .limit(1);

        if (pendingRequest) {
          const mergedDocuments = Array.from(
            new Set(
              [
                ...(Array.isArray(pendingRequest.documents)
                  ? pendingRequest.documents
                  : []),
                ...verificationData.documents,
              ]
                .map((doc) => String(doc || "").trim())
                .filter(Boolean),
            ),
          );

          const [updatedRequest] = await db
            .update(verificationRequests)
            .set({
              documents: mergedDocuments,
              licenseNumber:
                String(req.body?.licenseNumber || "").trim() || null,
              submittedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(verificationRequests.id, pendingRequest.id))
            .returning();

          return res.json(updatedRequest);
        }

        const rateLimit = checkRateLimit(restaurantId);
        if (!rateLimit.allowed) {
          return res.status(429).json({
            message:
              "Rate limit exceeded. Only one verification request per restaurant per hour is allowed.",
            nextAllowedTime: rateLimit.nextAllowedTime,
          });
        }

        const verificationRequest =
          await storage.createVerificationRequest(verificationData);
        res.json(verificationRequest);
      } catch (error: any) {
        console.error("Error creating verification request:", error);
        res.status(400).json({
          message: error.message || "Failed to create verification request",
        });
      }
    },
  );

  app.get(
    "/api/restaurants/my/verifications",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const verifications =
          await storage.getVerificationRequestsByOwner(userId);
        res.json(verifications);
      } catch (error) {
        console.error("Error fetching verification requests:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch verification requests" });
      }
    },
  );
}
