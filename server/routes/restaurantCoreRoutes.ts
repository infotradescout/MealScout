import type { Express } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated, isRestaurantOwner } from "../unifiedAuth";
import { sanitizeUser } from "../utils/sanitize";
import { validateDocuments, checkRateLimit } from "../documentValidation";
import { vacEvaluateRestaurantSignup } from "../vacLite";
import { ensurePremiumTrialForUser } from "../services/premiumTrial";
import {
  getPublicBusinessVisibilityChecks,
  isPublicBusinessVisible,
} from "../utils/publicBusinessVisibility";
import { forwardGeocode } from "../utils/geocoding";
import {
  aggregateImportedReviews,
  computeExternalReviewAdjustment,
  normalizeImportedReviews,
} from "../services/externalReviewScoring";
import { queueSocialPost } from "./dealRouteDependencies";
import {
  ensureGoogleRestaurantProfile,
  getGooglePhotoUrl,
  searchPlacesFreeText,
} from "../services/googleProfileService";
import {
  insertRestaurantSchema,
  insertRestaurantFavoriteSchema,
  insertRestaurantFollowSchema,
  insertRestaurantUserRecommendationSchema,
  insertSentimentSignalEventSchema,
  insertVerificationRequestSchema,
  deals,
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  sentimentSignalEvents,
  videoStories,
  users,
  telemetryEvents,
  truckImportListings,
  moderationCases,
  moderationResolutions,
  restaurants,
  restaurantSubscriptions,
  menus,
  menuItems,
} from "@shared/schema";

const ensureTrialForUser = ensurePremiumTrialForUser;

const normalizeRestaurantSearchTerm = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildRestaurantSearchTerms = (query: string) => {
  const terms = new Set<string>();
  const ignoredTokens = new Set([
    "usa",
    "united",
    "states",
    "street",
    "st",
    "avenue",
    "ave",
    "road",
    "rd",
    "boulevard",
    "blvd",
    "drive",
    "dr",
    "lane",
    "ln",
    "highway",
    "hwy",
    "north",
    "south",
    "east",
    "west",
  ]);

  const normalized = normalizeRestaurantSearchTerm(query);
  if (normalized) terms.add(normalized);

  const commaParts = String(query || "")
    .split(",")
    .map(normalizeRestaurantSearchTerm)
    .filter((part) => part.length >= 2)
    .slice(0, 8);

  commaParts.forEach((part) => {
    terms.add(part);
    part
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !ignoredTokens.has(token))
      .forEach((token) => terms.add(token));
  });

  return Array.from(terms)
    .filter((term) => term.length >= 2)
    .slice(0, 20);
};

const matchesRestaurantSearchTerms = (restaurant: any, terms: string[]) => {
  if (terms.length === 0) return false;
  const haystack = [
    restaurant?.name,
    restaurant?.cuisineType,
    restaurant?.businessType,
    restaurant?.address,
    restaurant?.city,
    restaurant?.state,
  ]
    .map(normalizeRestaurantSearchTerm)
    .join(" ");
  return terms.some((term) => haystack.includes(term));
};

type AnalyticsAccessResult = {
  hasAccess: boolean;
  error?: string;
  subscriptionTier?: string;
};

type RestaurantCoreRouteDependencies = {
  validateAnalyticsAccess: (userId: string) => Promise<AnalyticsAccessResult>;
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
  getBusinessDistributionAccessByOwnerIds?: (
    userIds: string[],
  ) => Promise<Map<string, boolean>>;
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

const toFiniteCoordinate = (value: unknown): number | null => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const toSeoSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 90);

const getVerifiedCustomDomainHost = (accountSettings: unknown): string | null => {
  if (!accountSettings || typeof accountSettings !== "object") return null;
  const customDomain = (accountSettings as any).customDomain;
  if (!customDomain || typeof customDomain !== "object") return null;

  const status = String(customDomain.status || "").toLowerCase();
  if (status !== "verified") return null;

  const hostname = String(customDomain.hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) return null;
  return hostname;
};

const isPublicRestaurantVisible = (restaurant: any): boolean => {
  if (!restaurant?.isActive) return false;
  if (!restaurant?.isVerified) return false;
  return isPublicBusinessVisible(restaurant);
};

const isGoogleLocalityOnly = (candidate: { types?: string[] }) => {
  const types = Array.isArray(candidate?.types) ? candidate.types : [];
  return types.some((type) =>
    ["locality", "political", "administrative_area_level_1", "country"].includes(
      type,
    ),
  );
};

export function registerRestaurantCoreRoutes(
  app: Express,
  {
    validateAnalyticsAccess,
    hasBusinessDistributionAccess,
    getBusinessDistributionAccessByOwnerIds,
  }: RestaurantCoreRouteDependencies,
) {
  const AUTOPROMO_SHARE_MILESTONES = new Set([5, 10, 25, 50]);

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

  const queueRestaurantAutopostForTrigger = async (params: {
    restaurant: any;
    trigger: "deal" | "recommendation" | "engagement";
    message: string;
    link: string;
  }) => {
    try {
      const restaurant = params.restaurant;
      const ownerId = String(restaurant?.ownerId || "").trim();
      if (!ownerId) return;

      const hasDistributionAccess = await hasBusinessDistributionAccess(ownerId);
      if (!hasDistributionAccess) return;

      const socialSettings =
        restaurant?.socialAutopostSettings &&
        typeof restaurant.socialAutopostSettings === "object"
          ? (restaurant.socialAutopostSettings as Record<string, any>)
          : {};
      const triggers =
        socialSettings.triggers && typeof socialSettings.triggers === "object"
          ? (socialSettings.triggers as Record<string, any>)
          : {};
      const rawPlatforms =
        socialSettings.platforms && typeof socialSettings.platforms === "object"
          ? (socialSettings.platforms as Record<string, any>)
          : {};

      const triggerEnabled = triggers[params.trigger] !== false;
      const shouldQueue = triggerEnabled && socialSettings.promptBeforePost === false;
      if (!shouldQueue) return;

      const platforms = {
        facebook: rawPlatforms.facebook !== false,
        instagram: rawPlatforms.instagram !== false,
        x: rawPlatforms.x !== false,
      };

      const postJobs: Promise<void>[] = [];
      if (platforms.facebook) {
        postJobs.push(
          queueSocialPost({
            platform: "facebook",
            target: restaurant.facebookPageUrl || "mealscout_page",
            message: params.message,
            link: params.link,
          }),
        );
      }
      if (platforms.instagram) {
        postJobs.push(
          queueSocialPost({
            platform: "instagram",
            target: restaurant.instagramUrl || null,
            message: params.message,
            link: params.link,
          }),
        );
      }
      if (platforms.x) {
        postJobs.push(
          queueSocialPost({
            platform: "x",
            target: restaurant.xUrl || null,
            message: params.message,
            link: params.link,
          }),
        );
      }

      if (postJobs.length > 0) {
        void Promise.allSettled(postJobs).then((results) => {
          results.forEach((result, index) => {
            if (result.status === "rejected") {
              console.error(
                `Failed to queue social autopost [${params.trigger}:${index}]:`,
                result.reason,
              );
            }
          });
        });
      }
    } catch (error) {
      console.error("Failed to queue restaurant social autopost:", error);
    }
  };

  const ensureRestaurantLikesTable = async () => {
    try {
      await db.execute(sql`
        create table if not exists restaurant_likes (
          id varchar primary key default gen_random_uuid(),
          restaurant_id varchar not null references restaurants(id) on delete cascade,
          user_id varchar not null references users(id) on delete cascade,
          liked_at timestamp default now(),
          created_at timestamp default now(),
          unique (restaurant_id, user_id)
        )
      `);
    } catch (error) {
      console.error("Failed to ensure restaurant_likes table", error);
    }
  };

  void ensureRestaurantLikesTable();

  const ensureRestaurantLikeForEngagement = async (
    userId: string,
    restaurantId: string,
    source: "favorite" | "follow" | "recommend",
  ) => {
    const safeUserId = String(userId || "").trim();
    const safeRestaurantId = String(restaurantId || "").trim();
    if (!safeUserId || !safeRestaurantId) return;

    try {
      await db.execute(sql`
        insert into restaurant_likes (restaurant_id, user_id)
        values (${safeRestaurantId}, ${safeUserId})
        on conflict (restaurant_id, user_id) do nothing
      `);
      void trackEngagement(
        "restaurant_like_auto_added",
        safeUserId,
        safeRestaurantId,
        { source },
      );
    } catch (error) {
      console.warn("Failed to auto-like after engagement", {
        userId: safeUserId,
        restaurantId: safeRestaurantId,
        source,
        error,
      });
    }
  };

  const ensureRestaurantFollowForEngagement = async (
    userId: string,
    restaurantId: string,
    source: "favorite" | "recommend" | "like",
  ) => {
    try {
      const followData = insertRestaurantFollowSchema.parse({
        restaurantId,
        userId,
      });
      await storage.createRestaurantFollow(followData);
      void trackEngagement(
        "restaurant_follow_auto_added",
        userId,
        restaurantId,
        { source },
      );
    } catch (error: any) {
      if (error?.code === "23505") {
        // Already following, no-op.
        return;
      }
      console.warn("Failed to auto-follow after engagement", {
        userId,
        restaurantId,
        source,
        error: error?.message || error,
      });
    }
  };

  const upsertRestaurantUserRecommendation = async (
    userId: string,
    restaurantId: string,
    input?: {
      sentimentScore100?: number;
      menuItemName?: string;
    },
  ) => {
    const sentimentScore100 = Math.max(
      1,
      Math.min(100, Number(input?.sentimentScore100 ?? 70) || 70),
    );
    const menuItemName =
      typeof input?.menuItemName === "string"
        ? input.menuItemName.trim().slice(0, 140)
        : "";

    const existing = await db
      .select({
        id: restaurantUserRecommendations.id,
        sentimentScore100: restaurantUserRecommendations.sentimentScore100,
      })
      .from(restaurantUserRecommendations)
      .where(
        and(
          eq(restaurantUserRecommendations.restaurantId, restaurantId),
          eq(restaurantUserRecommendations.userId, userId),
        ),
      )
      .orderBy(desc(restaurantUserRecommendations.recommendedAt))
      .limit(1);

    if (existing[0]?.id) {
      const updated = await db
        .update(restaurantUserRecommendations)
        .set({
          recommendedAt: new Date(),
          updatedAt: new Date(),
          sentimentScore100,
          menuItemName: menuItemName || null,
        })
        .where(eq(restaurantUserRecommendations.id, existing[0].id))
        .returning();
      return {
        recommendation: updated[0],
        updated: true,
        previousScore100: Number(existing[0].sentimentScore100 || 0) || null,
      };
    }

    const recommendationData = insertRestaurantUserRecommendationSchema.parse({
      restaurantId,
      userId,
      sentimentScore100,
      menuItemName: menuItemName || undefined,
    });
    const recommendation = await storage.createRestaurantUserRecommendation(
      recommendationData,
    );
    return {
      recommendation,
      updated: false,
      previousScore100: null as number | null,
    };
  };

  app.get(
    "/api/restaurants/:restaurantId/engagement-state",
    async (req: any, res) => {
      try {
        const restaurantId = String(req.params.restaurantId || "").trim();
        if (!restaurantId) {
          return res.status(400).json({ message: "Invalid restaurant id" });
        }

        const userId = String(req.user?.id || "").trim() || null;

        const [favoriteCountResult, followCountResult, recommendationCountResult] =
          await Promise.all([
            db
              .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(restaurantFavorites)
              .where(eq(restaurantFavorites.restaurantId, restaurantId)),
            db
              .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(restaurantFollows)
              .where(eq(restaurantFollows.restaurantId, restaurantId)),
            db
              .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(restaurantUserRecommendations)
              .where(eq(restaurantUserRecommendations.restaurantId, restaurantId)),
          ]);

        const likeCountSql = await db.execute(sql<{ count: number }>`
          select cast(count(*) as integer) as count
          from restaurant_likes
          where restaurant_id = ${restaurantId}
        `);

        let isFavorited = false;
        let isFollowing = false;
        let isLiked = false;
        let hasRecommended = false;

        if (userId) {
          const [fav, follow, rec] = await Promise.all([
            db
              .select({ id: restaurantFavorites.id })
              .from(restaurantFavorites)
              .where(
                and(
                  eq(restaurantFavorites.restaurantId, restaurantId),
                  eq(restaurantFavorites.userId, userId),
                ),
              )
              .limit(1),
            db
              .select({ id: restaurantFollows.id })
              .from(restaurantFollows)
              .where(
                and(
                  eq(restaurantFollows.restaurantId, restaurantId),
                  eq(restaurantFollows.userId, userId),
                ),
              )
              .limit(1),
            db
              .select({
                id: restaurantUserRecommendations.id,
                sentimentScore100: restaurantUserRecommendations.sentimentScore100,
              })
              .from(restaurantUserRecommendations)
              .where(
                and(
                  eq(restaurantUserRecommendations.restaurantId, restaurantId),
                  eq(restaurantUserRecommendations.userId, userId),
                ),
              )
              .limit(1),
          ]);

          const likeResult = await db.execute(sql<{ id: string }>`
            select id
            from restaurant_likes
            where restaurant_id = ${restaurantId} and user_id = ${userId}
            limit 1
          `);

          isFavorited = fav.length > 0;
          isFollowing = follow.length > 0;
          hasRecommended = rec.length > 0;
          isLiked = (((likeResult as any)?.rows || [])[0]?.id || "") !== "";
        }

        res.json({
          counts: {
            favorites: favoriteCountResult[0]?.count ?? 0,
            follows: followCountResult[0]?.count ?? 0,
            likes: Number(((likeCountSql as any)?.rows || [])[0]?.count || 0),
            recommendations: recommendationCountResult[0]?.count ?? 0,
          },
          viewer: {
            isFavorited,
            isFollowing,
            isLiked,
            hasRecommended,
          },
        });
      } catch (error) {
        console.error("Error fetching restaurant engagement state:", error);
        res.status(500).json({ message: "Failed to fetch engagement state" });
      }
    },
  );

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

  app.post(
    "/api/restaurants/:id/claim-generated",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = String(req.params.id || "").trim();
        const userId = String(req.user?.id || "").trim();
        if (!restaurantId || !userId) {
          return res.status(400).json({ message: "Missing restaurant or user" });
        }
        const parsed = z
          .object({
            documents: z.array(z.string()).min(1).max(5),
          })
          .parse(req.body || {});
        const documentValidation = validateDocuments(parsed.documents);
        if (!documentValidation.valid) {
          return res.status(400).json({
            message: "Document validation failed",
            errors: documentValidation.errors,
          });
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        if (String(restaurant.ownerId || "") === userId) {
          return res.json({
            restaurant,
            alreadyOwner: true,
            verificationPending: await storage.hasPendingVerificationRequest(
              restaurantId,
            ),
          });
        }

        const importSystemEmail = String(
          process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us",
        )
          .trim()
          .toLowerCase();
        const importSystemUser = importSystemEmail
          ? await storage.getUserByEmail(importSystemEmail)
          : null;
        const isSystemOwned =
          importSystemUser &&
          String(restaurant.ownerId || "") === String(importSystemUser.id);
        const isGeneratedProfile =
          String((restaurant as any).profileSource || "") === "google" ||
          String((restaurant as any).profileSource || "") ===
            "search_query_seed" ||
          Boolean((restaurant as any).googlePlaceId);

        if (!isSystemOwned || !isGeneratedProfile) {
          return res.status(409).json({
            message:
              "This listing is already attached to an owner. Ask support to transfer it.",
          });
        }

        const userType = String(req.user?.userType || "");
        if (userType === "customer") {
          const nextType =
            String((restaurant as any).businessType || "") === "food_truck" ||
            Boolean((restaurant as any).isFoodTruck)
              ? "food_truck"
              : "restaurant_owner";
          await storage.updateUserType(userId, nextType);
        }

        const [claimed] = await db
          .update(restaurants)
          .set({
            ownerId: userId,
            isVerified: false,
            profileSource: "mixed",
            updatedAt: new Date(),
          } as any)
          .where(eq(restaurants.id, restaurantId))
          .returning();

        const hasPending = await storage.hasPendingVerificationRequest(
          restaurantId,
        );
        let verificationRequestId: string | null = null;
        if (!hasPending) {
          const request = await storage.createVerificationRequest({
            restaurantId,
            documents: parsed.documents,
          });
          verificationRequestId = request.id;
        }

        res.json({
          restaurant: claimed,
          claimed: true,
          verificationPending: true,
          verificationRequestId,
        });
      } catch (error: any) {
        console.error("Error claiming generated restaurant profile:", error);
        res.status(500).json({
          message: error?.message || "Failed to claim generated profile",
        });
      }
    },
  );

  // GET /api/owner/onboarding
  // Returns the owner's setup checklist + next-step CTA so the dashboard
  // can show progress ("3 of 6 done") and guide them to the next action.
  app.get(
    "/api/owner/onboarding",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const user = req.user;
        const userId = user.id;

        const ownerRestaurants = await storage.getRestaurantsByOwner(userId);
        const restaurantIds = ownerRestaurants.map((r: any) => r.id);

        let menuRows: Array<{ restaurantId: string; menuId: string }> = [];
        let itemCount = 0;
        if (restaurantIds.length > 0) {
          menuRows = await db
            .select({
              restaurantId: menus.restaurantId,
              menuId: menus.id,
            })
            .from(menus)
            .where(inArray(menus.restaurantId, restaurantIds));

          if (menuRows.length > 0) {
            const menuIds = menuRows.map((m) => m.menuId);
            const [{ count }] = await db
              .select({ count: sql<number>`COUNT(*)::int` })
              .from(menuItems)
              .where(inArray(menuItems.menuId, menuIds));
            itemCount = Number(count || 0);
          }
        }

        const hasBusiness = ownerRestaurants.length > 0;
        const hasMenu = menuRows.length > 0;
        const hasItems = itemCount > 0;
        const isVerified = ownerRestaurants.some((r: any) => r.isVerified);
        const primaryRestaurant = ownerRestaurants[0] || null;
        let hasActiveRestaurantSubscription = false;
        if (restaurantIds.length > 0) {
          const [activeSub] = await db
            .select({ id: restaurantSubscriptions.id })
            .from(restaurantSubscriptions)
            .where(
              and(
                inArray(restaurantSubscriptions.restaurantId, restaurantIds),
                eq(restaurantSubscriptions.status, "active"),
              ),
            )
            .limit(1);
          hasActiveRestaurantSubscription = Boolean(activeSub);
        }
        const hasSubscription = Boolean(
          user.stripeSubscriptionId || hasActiveRestaurantSubscription,
        );
        const emailVerified = Boolean(user.emailVerified);
        const menuBuilderHref = primaryRestaurant
          ? `/menu-builder/${primaryRestaurant.id}`
          : "/menu-builder";
        const editProfileHref = primaryRestaurant
          ? `/edit-restaurant/${primaryRestaurant.id}`
          : "/restaurant-signup";

        const primaryProfileChecks = primaryRestaurant
          ? getPublicBusinessVisibilityChecks(primaryRestaurant as any)
          : { blockers: ["no_business"], warnings: [] as string[] };
        const hasPublicProfileBasics =
          hasBusiness &&
          primaryProfileChecks.blockers.length === 0 &&
          !primaryProfileChecks.warnings.includes("missing_description_or_photo");

        const steps = [
          {
            id: "verify-email",
            label: "Verify your email",
            done: emailVerified,
            href: "/restaurant/dashboard",
            cta: "Resend verification",
            why: "Lets us send you booking and review notifications.",
          },
          {
            id: "add-business",
            label: "Add your business",
            done: hasBusiness,
            href: "/restaurant-signup",
            cta: "Add business",
            why: "Name, type, and location so customers can find you.",
          },
          {
            id: "add-menu",
            label: "Add your menu",
            done: hasMenu,
            href: menuBuilderHref,
            cta: "Add menu",
            why: "Paste a link to your existing menu \u2014 we'll import it.",
          },
          {
            id: "add-items",
            label: "Add at least one item",
            done: hasItems,
            href: menuBuilderHref,
            cta: "Add items",
            why: "Without items, customers see an empty menu.",
          },
          {
            id: "complete-public-profile",
            label: "Complete your public profile",
            done: hasPublicProfileBasics,
            href: editProfileHref,
            cta: "Complete profile",
            why: "A clear profile helps customers trust you and choose you faster.",
          },
          {
            id: "get-verified",
            label: "Get verified",
            done: isVerified,
            href: "/restaurant/dashboard",
            cta: "Request verification",
            why: "Verified businesses appear in search and on the map.",
          },
          {
            id: "subscribe",
            label: "Activate subscription",
            done: hasSubscription,
            href: "/subscribe",
            cta: "Choose plan",
            why: "Unlocks deals, analytics, and customer messaging.",
          },
        ];

        const completed = steps.filter((s) => s.done).length;
        const total = steps.length;
        const nextStep = steps.find((s) => !s.done) || null;
        const allDone = completed === total;

        // "Discoverable" = customers can actually find this business now.
        // We require: at least one verified+active restaurant with a menu
        // and at least one item. Stripe subscription is NOT required for
        // discoverability — only for selling deals.
        const firstDiscoverable = ownerRestaurants.find(
          (r: any) => r.isVerified && r.isActive,
        );
        const isDiscoverable = Boolean(
          firstDiscoverable && hasMenu && hasItems,
        );
        const previewRestaurant = firstDiscoverable || ownerRestaurants[0] || null;
        const publicPreviewUrl = previewRestaurant
          ? `/restaurant/${previewRestaurant.id}`
          : null;

        const visibilityBlockers: string[] = [];
        if (!hasBusiness) visibilityBlockers.push("no_business");
        if (!hasMenu) visibilityBlockers.push("no_menu");
        if (!hasItems) visibilityBlockers.push("no_items");
        if (!ownerRestaurants.some((r: any) => Boolean(r.isActive))) {
          visibilityBlockers.push("inactive");
        }
        if (!ownerRestaurants.some((r: any) => Boolean(r.isVerified))) {
          visibilityBlockers.push("unverified");
        }
        if (previewRestaurant) {
          const previewChecks = getPublicBusinessVisibilityChecks(
            previewRestaurant as any,
          );
          visibilityBlockers.push(...previewChecks.blockers);
          visibilityBlockers.push(...previewChecks.warnings);
        }

        res.json({
          completed,
          total,
          percent: Math.round((completed / total) * 100),
          allDone,
          nextStep,
          steps,
          counts: {
            restaurants: ownerRestaurants.length,
            menus: menuRows.length,
            items: itemCount,
          },
          isDiscoverable,
          publicPreviewUrl,
          visibilityBlockers: Array.from(new Set(visibilityBlockers)),
          publicProfileChecks: {
            blockers: primaryProfileChecks.blockers,
            warnings: primaryProfileChecks.warnings,
          },
        });
      } catch (error: any) {
        console.error("[owner/onboarding] failed:", error);
        res.status(500).json({
          message: "Failed to load onboarding status",
          error: String(error?.message || error),
        });
      }
    },
  );

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
      const hasLocationFilter =
        typeof lat === "string" &&
        typeof lng === "string" &&
        Number.isFinite(Number.parseFloat(lat)) &&
        Number.isFinite(Number.parseFloat(lng));

      console.log("🔍 Restaurant search request:", {
        query,
        ...(hasLocationFilter
          ? { lat, lng, radius }
          : { locationFilter: "none", radius }),
      });

      if (!query || typeof query !== "string" || query.length < 2) {
        console.log("⚠️  Empty or short query, returning empty array");
        return res.json([]);
      }

      const searchTerms = buildRestaurantSearchTerms(query);
      const restaurants = (await storage.getAllRestaurants()).filter(
        (restaurant: any) =>
          Boolean(restaurant?.isActive) && isPublicBusinessVisible(restaurant),
      );

      let filteredRestaurants = restaurants.filter(
        (restaurant: any) =>
          restaurant.isActive &&
          matchesRestaurantSearchTerms(restaurant, searchTerms),
      );

      if (hasLocationFilter) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const radiusKm = parseFloat(radius as string);

        filteredRestaurants = filteredRestaurants.filter((restaurant: any) => {
          const targetLat = toFiniteCoordinate(restaurant.latitude);
          const targetLng = toFiniteCoordinate(restaurant.longitude);
          if (targetLat === null || targetLng === null) return false;

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
        (restaurant: any) => isPublicRestaurantVisible(restaurant),
      );
      const activeRestaurants = allRestaurants;

      const ownerIds = Array.from(
        new Set(
          activeRestaurants
            .map((restaurant: any) => String(restaurant?.ownerId || "").trim())
            .filter(Boolean),
        ),
      );
      const ownerHasAccess =
        getBusinessDistributionAccessByOwnerIds
          ? await getBusinessDistributionAccessByOwnerIds(ownerIds)
          : new Map(
              await Promise.all(
                ownerIds.map(
                  async (ownerId) =>
                    [
                      ownerId,
                      await hasBusinessDistributionAccess(ownerId),
                    ] as const,
                ),
              ),
            );

      const homeEligibleRestaurants = activeRestaurants.filter(
        (restaurant: any) => {
          const ownerId = String(restaurant?.ownerId || "").trim();
          if (!ownerId) return false;
          return ownerHasAccess.get(ownerId) === true;
        },
      );

      const restaurantIds = homeEligibleRestaurants
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

      // Opportunistically backfill coordinates for verified restaurants that
      // never set lat/lng but at minimum carry a city/state. Cached + bounded
      // so it doesn't stall the response.
      const MAX_GEOCODE_BACKFILLS = 8;
      const backfillTargets = homeEligibleRestaurants.filter(
        (r: any) =>
          (toFiniteCoordinate(r.latitude) === null ||
            toFiniteCoordinate(r.longitude) === null) &&
          (String(r.city || "").trim() ||
            String(r.address || "").trim()),
      );
      if (backfillTargets.length > 0) {
        await Promise.all(
          backfillTargets.slice(0, MAX_GEOCODE_BACKFILLS).map(async (r: any) => {
            try {
              const parts = [r.address, r.city, r.state]
                .map((v) => String(v || "").trim())
                .filter(Boolean);
              if (parts.length === 0) return;
              const coords = await forwardGeocode(parts.join(", ")).catch(
                () => null,
              );
              if (
                coords &&
                Number.isFinite(coords.lat) &&
                Number.isFinite(coords.lng)
              ) {
                r.latitude = coords.lat;
                r.longitude = coords.lng;
                // Persist back asynchronously so subsequent loads are instant.
                storage
                  .updateRestaurant(String(r.id), {
                    latitude: String(coords.lat),
                    longitude: String(coords.lng),
                  } as any)
                  .catch(() => undefined);
              }
            } catch {
              /* ignore */
            }
          }),
        );
      }

      const withDistance = homeEligibleRestaurants
        .map((restaurant: any) => {
          if (!hasLocation || Number.isNaN(userLat) || Number.isNaN(userLng)) {
            const restaurantId = String(restaurant.id || "");
            return {
              ...restaurant,
              distance: null,
              favoriteCount: favoritesByRestaurant.get(restaurantId) || 0,
              followCount: followsByRestaurant.get(restaurantId) || 0,
              recommendationCount:
                recommendationsByRestaurant.get(restaurantId) || 0,
              videoRecommendationCount:
                videoRecommendationsByRestaurant.get(restaurantId) || 0,
              communityActivityCount:
                Number(reactionByRestaurant.get(restaurantId) || 0) +
                Number(sharesByRestaurant.get(restaurantId) || 0) +
                Number(videoEngagementByRestaurant.get(restaurantId) || 0),
              activeDealCount: activeDealsByRestaurant.get(restaurantId) || 0,
            };
          }

          const targetLat = toFiniteCoordinate(restaurant.latitude);
          const targetLng = toFiniteCoordinate(restaurant.longitude);
          if (targetLat === null || targetLng === null) {
            // No coordinates — include without distance rather than hiding entirely
            const restaurantId = String(restaurant.id || "");
            return {
              ...restaurant,
              distance: null,
              favoriteCount: favoritesByRestaurant.get(restaurantId) || 0,
              followCount: followsByRestaurant.get(restaurantId) || 0,
              recommendationCount:
                recommendationsByRestaurant.get(restaurantId) || 0,
              videoRecommendationCount:
                videoRecommendationsByRestaurant.get(restaurantId) || 0,
              communityActivityCount:
                Number(reactionByRestaurant.get(restaurantId) || 0) +
                Number(sharesByRestaurant.get(restaurantId) || 0) +
                Number(videoEngagementByRestaurant.get(restaurantId) || 0),
              activeDealCount: activeDealsByRestaurant.get(restaurantId) || 0,
            };
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

          const restaurantId = String(restaurant.id || "");
          return {
            ...restaurant,
            distance: distanceKm * 0.621371,
            favoriteCount: favoritesByRestaurant.get(restaurantId) || 0,
            followCount: followsByRestaurant.get(restaurantId) || 0,
            recommendationCount:
              recommendationsByRestaurant.get(restaurantId) || 0,
            videoRecommendationCount:
              videoRecommendationsByRestaurant.get(restaurantId) || 0,
            communityActivityCount:
              Number(reactionByRestaurant.get(restaurantId) || 0) +
              Number(sharesByRestaurant.get(restaurantId) || 0) +
              Number(videoEngagementByRestaurant.get(restaurantId) || 0),
            activeDealCount: activeDealsByRestaurant.get(restaurantId) || 0,
          };
        })
        .filter(Boolean) as Array<any>;

      const sorted = withDistance.sort((a: any, b: any) => {
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
      let restaurant: any = await storage.getRestaurant(req.params.id);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const profileSource = String((restaurant as any).profileSource || "");
      const isGeneratedProfile =
        profileSource === "google" ||
        profileSource === "search_query_seed" ||
        Boolean((restaurant as any).googlePlaceId);

      // Opportunistically enrich generated profiles so detail pages get a real banner photo.
      if (isGeneratedProfile && !restaurant.coverImageUrl) {
        try {
          const placeId = String((restaurant as any).googlePlaceId || "").trim();
          if (placeId) {
            const generated = await ensureGoogleRestaurantProfile(placeId);
            if (generated?.restaurant) {
              restaurant = generated.restaurant as any;
            }
          } else {
            const lookupQuery = [
              restaurant.name,
              restaurant.address,
              restaurant.city,
              restaurant.state,
            ]
              .filter(Boolean)
              .join(", ");
            const candidates = await searchPlacesFreeText(lookupQuery, 5);
            const bestCandidate =
              candidates.find((c) => !isGoogleLocalityOnly(c)) || candidates[0];

            if (bestCandidate) {
              const firstPhotoName = String(bestCandidate.photos?.[0]?.name || "").trim();
              const coverImageUrl = firstPhotoName
                ? getGooglePhotoUrl(firstPhotoName)
                : null;
              const updates: any = {
                googlePlaceId: bestCandidate.placeId,
                profileLastSynced: new Date(),
              };

              if (coverImageUrl) updates.coverImageUrl = coverImageUrl;
              if (Array.isArray(bestCandidate.photos) && bestCandidate.photos.length > 0) {
                updates.googlePhotos = bestCandidate.photos;
              }
              if (
                (restaurant.googleRating == null || Number(restaurant.googleRating) <= 0) &&
                typeof bestCandidate.rating === "number"
              ) {
                updates.googleRating = bestCandidate.rating;
              }
              if (
                (restaurant.googleReviewCount == null ||
                  Number(restaurant.googleReviewCount) <= 0) &&
                typeof bestCandidate.userRatingCount === "number"
              ) {
                updates.googleReviewCount = bestCandidate.userRatingCount;
              }

              const [updated] = await db
                .update(restaurants)
                .set(updates)
                .where(eq(restaurants.id, String(restaurant.id)))
                .returning();
              if (updated) {
                restaurant = updated as any;
              }
            }
          }
        } catch (enrichmentError) {
          console.warn("[restaurant] generated profile banner enrichment failed", {
            restaurantId: restaurant.id,
            error: enrichmentError,
          });
        }
      }

      const owner = restaurant.ownerId
        ? await storage.getUser(String(restaurant.ownerId))
        : null;
      const customDomainHost = getVerifiedCustomDomainHost(owner?.accountSettings);

      res.json({
        ...restaurant,
        customDomainHost,
      });
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  app.get("/api/restaurants/:restaurantId/trust-stats", async (req, res) => {
    try {
      const restaurantId = String(req.params.restaurantId || "").trim();
      if (!restaurantId) {
        return res.status(400).json({ message: "Invalid restaurant id" });
      }

      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const isVerified = Boolean((restaurant as any)?.isVerified);
      const isLive = Boolean((restaurant as any)?.isActive);
      const hasOwnerAttachment = Boolean((restaurant as any)?.ownerId);

      let caseRows: any[] = [];
      try {
        caseRows = await db
          .select({
            caseId: moderationCases.id,
            status: moderationCases.status,
            createdAt: moderationCases.createdAt,
            resolvedAt: moderationCases.resolvedAt,
            outcome: moderationResolutions.outcome,
          })
          .from(moderationCases)
          .leftJoin(
            moderationResolutions,
            eq(moderationResolutions.caseId, moderationCases.id),
          )
          .where(eq(moderationCases.restaurantId, restaurantId))
          .orderBy(desc(moderationCases.createdAt));
      } catch (error) {
        console.warn("Failed to load moderation rows for trust stats", {
          restaurantId,
          error,
        });
      }

      const totalFlags = caseRows.length;
      const flagsUpheld = caseRows.filter((row: any) => row.outcome === "valid").length;
      const flagsDismissed = caseRows.filter((row: any) => row.outcome === "invalid").length;
      const flagsPartial = caseRows.filter((row: any) => row.outcome === "partial").length;
      const resolvedDisputes = caseRows.filter(
        (row: any) => row.status === "resolved" || Boolean(row.outcome),
      ).length;
      const activeDisputes = caseRows.filter(
        (row: any) => !row.outcome && row.status !== "resolved",
      ).length;
      const lastFlagDate = caseRows[0]?.createdAt
        ? new Date(caseRows[0].createdAt).toISOString()
        : null;
      // CVS policy: verified + live starts at a base of 50.
      const verificationBaseline = isVerified && isLive ? 50 : 35;
      const ownershipBonus = hasOwnerAttachment ? 8 : 0;
      const moderationPenalty =
        flagsUpheld * 15 + flagsPartial * 7 + activeDisputes * 5;
      const rawScore = verificationBaseline + ownershipBonus - moderationPenalty;
      const profileAccuracyScore = Math.max(
        0,
        Math.min(
          100,
          rawScore,
        ),
      );
      const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
      const hasRecentFlag =
        lastFlagDate !== null &&
        Date.now() - new Date(lastFlagDate).getTime() <= recentWindowMs;
      const trend =
        activeDisputes > 0 && hasRecentFlag
          ? "watch"
          : profileAccuracyScore < 80
            ? "needs_attention"
            : "stable";

      res.json({
        restaurantId,
        totalFlags,
        flagsUpheld,
        flagsDismissed,
        flagsPartial,
        profileAccuracyScore,
        isVerified,
        hasOwnerAttachment,
        scoreBreakdown: {
          verificationBaseline,
          isLive,
          ownerAttachmentBonus: ownershipBonus,
          moderationPenalty,
          rawScore,
        },
        activeDisputes,
        resolvedDisputes,
        lastFlagDate,
        trend,
      });
    } catch (error) {
      console.error("Error fetching restaurant trust stats:", error);
      res.status(500).json({ message: "Failed to fetch trust stats" });
    }
  });

  app.get(
    "/api/public/canonical/restaurant/:restaurantId",
    async (req, res) => {
      try {
        const restaurantId = String(req.params.restaurantId || "").trim();
        if (!restaurantId) {
          return res.status(400).json({ message: "Invalid restaurant id" });
        }

        const restaurant: any = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const owner = restaurant.ownerId
          ? await storage.getUser(String(restaurant.ownerId))
          : null;
        const customDomainHost = getVerifiedCustomDomainHost(owner?.accountSettings);
        const restaurantSlug = toSeoSlug(restaurant.name) || restaurantId;
        const canonicalPath = `/restaurant/${restaurantId}/${restaurantSlug}`;
        const canonicalUrl = customDomainHost
          ? `https://${customDomainHost}`
          : `https://www.mealscout.us${canonicalPath}`;

        const activeDealsResult = await db.execute(sql<{ count: number }>`
        select cast(count(*) as integer) as count
        from deals
        where restaurant_id = ${restaurantId} and is_active = true
      `);
        const activeDealCount =
          Number((activeDealsResult as any)?.rows?.[0]?.count || 0) || 0;

        const latRaw =
          restaurant.currentLatitude ?? restaurant.latitude ?? null;
        const lngRaw =
          restaurant.currentLongitude ?? restaurant.longitude ?? null;
        const lat =
          typeof latRaw === "number"
            ? latRaw
            : Number.parseFloat(String(latRaw));
        const lng =
          typeof lngRaw === "number"
            ? lngRaw
            : Number.parseFloat(String(lngRaw));
        const hasLiveLocation = Number.isFinite(lat) && Number.isFinite(lng);

        const updatedAt = restaurant.updatedAt || restaurant.createdAt || null;
        const freshnessHours = updatedAt
          ? Math.max(
              0,
              Math.round(
                (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60),
              ),
            )
          : null;

        const freshness =
          freshnessHours == null
            ? "unknown"
            : freshnessHours <= 24
              ? "fresh"
              : freshnessHours <= 72
                ? "recent"
                : "stale";

        const sourceTruthStatements = [
          restaurant.name ? "Business profile includes a public name." : null,
          restaurant.address
            ? "Business profile includes a street address."
            : null,
          restaurant.phone ? "Business profile includes a phone number." : null,
          hasLiveLocation ? "Live map coordinates are available." : null,
        ].filter(Boolean);

        const knowledgeGaps = [
          restaurant.address ? null : "Missing address",
          restaurant.phone ? null : "Missing phone number",
          hasLiveLocation ? null : "Missing map coordinates",
        ].filter(Boolean);

        res.json({
          restaurantId,
          canonicalPath,
          canonicalUrl,
          customDomainHost,
          updatedAt,
          verified: Boolean(restaurant.isVerified),
          machineReadiness:
            hasLiveLocation && restaurant.isActive ? "ready" : "partial",
          freshness,
          freshnessHours,
          sourceTruthStatements,
          knowledgeGaps,
          evidenceSummary: {
            activeDealCount,
            liveLocationActive: hasLiveLocation,
          },
        });
      } catch (error) {
        console.error("Error fetching canonical restaurant data:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch canonical restaurant data" });
      }
    },
  );

  app.get("/api/public/evidence/restaurant/:restaurantId", async (req, res) => {
    try {
      const restaurantId = String(req.params.restaurantId || "").trim();
      if (!restaurantId) {
        return res.status(400).json({ message: "Invalid restaurant id" });
      }

      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const activeDealResult = await db.execute(sql<{ count: number }>`
        select cast(count(*) as integer) as count
        from deals
        where restaurant_id = ${restaurantId} and is_active = true
      `);
      const storyViewsResult = await db.execute(sql<{ total: number }>`
        select cast(coalesce(sum(view_count), 0) as integer) as total
        from video_stories
        where restaurant_id = ${restaurantId} and status = 'ready' and deleted_at is null
      `);

      const activeDealCount =
        Number((activeDealResult as any)?.rows?.[0]?.count || 0) || 0;
      const totalViews =
        Number((storyViewsResult as any)?.rows?.[0]?.total || 0) || 0;

      res.json({
        restaurantId,
        windowHours: 168,
        externalPressure: {
          crawlerHits: 0,
          humanPageHits: totalViews,
          topBots: [] as Array<{ label: string; count: number }>,
        },
        demand: {
          matchingSearchQueries: activeDealCount,
          topQueries: [] as Array<{ query: string; count: number }>,
        },
        distribution: {
          outboundSocialPosts: 0,
          affiliateShares: 0,
        },
        content: {
          totalViews,
        },
      });
    } catch (error) {
      console.error("Error fetching restaurant evidence:", error);
      res.status(500).json({ message: "Failed to fetch restaurant evidence" });
    }
  });

  app.get("/api/restaurants/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = parseFloat(req.query.radius as string) || 5;

      const restaurants = await storage.getNearbyRestaurants(lat, lng, radius);
      res.json(
        restaurants.filter((restaurant: any) =>
          isPublicRestaurantVisible(restaurant),
        ),
      );
    } catch (error) {
      console.error("Error fetching nearby restaurants:", error);
      res.status(500).json({ message: "Failed to fetch nearby restaurants" });
    }
  });

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
        const existingFavorite = await db
          .select({ id: restaurantFavorites.id })
          .from(restaurantFavorites)
          .where(
            and(
              eq(restaurantFavorites.restaurantId, restaurantId),
              eq(restaurantFavorites.userId, userId),
            ),
          )
          .limit(1);

        if (!existingFavorite[0]?.id && favoriteCount >= maxFavorites) {
          return res.status(400).json({
            message: `You can favorite up to ${maxFavorites} restaurants.`,
          });
        }

        const favoriteData = insertRestaurantFavoriteSchema.parse({
          restaurantId,
          userId,
        });

        const favorite = await storage.createRestaurantFavorite(favoriteData);
        await ensureRestaurantFollowForEngagement(
          userId,
          restaurantId,
          "favorite",
        );
        await ensureRestaurantLikeForEngagement(userId, restaurantId, "favorite");
        void trackEngagement("restaurant_favorite_added", userId, restaurantId);
        res.json(favorite);
      } catch (error: any) {
        console.error("Error adding restaurant favorite:", error);
        if (error.code === "23505") {
          await ensureRestaurantFollowForEngagement(
            String(req.user?.id || ""),
            String(req.params?.restaurantId || ""),
            "favorite",
          );
          await ensureRestaurantLikeForEngagement(
            String(req.user?.id || ""),
            String(req.params?.restaurantId || ""),
            "favorite",
          );
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
        await ensureRestaurantLikeForEngagement(userId, restaurantId, "follow");
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
    "/api/restaurants/:restaurantId/like",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:like:add`,
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

        await db.execute(sql`
          insert into restaurant_likes (restaurant_id, user_id)
          values (${restaurantId}, ${userId})
          on conflict (restaurant_id, user_id) do nothing
        `);
        await ensureRestaurantFollowForEngagement(userId, restaurantId, "like");
        void trackEngagement("restaurant_like_added", userId, restaurantId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error adding restaurant like:", error);
        res.status(500).json({ message: "Failed to like restaurant" });
      }
    },
  );

  app.delete(
    "/api/restaurants/:restaurantId/like",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:like:remove`,
        );
        if (!actionGate.allowed) {
          return res.status(429).json({
            message: "Please wait a moment before trying again.",
            retryAfterSeconds: actionGate.retryAfterSeconds,
          });
        }

        await db.execute(sql`
          delete from restaurant_likes
          where restaurant_id = ${restaurantId} and user_id = ${userId}
        `);
        void trackEngagement("restaurant_like_removed", userId, restaurantId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing restaurant like:", error);
        res.status(500).json({ message: "Failed to unlike restaurant" });
      }
    },
  );

  app.post(
    "/api/restaurants/:restaurantId/recommend",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { restaurantId } = req.params;
        const userId = req.user.id;
        const actionGate = consumeEngagementWindow(
          `${userId}:${restaurantId}:recommend:add`,
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

        const recommendPayloadSchema = z.object({
          sentimentScore100: z.number().int().min(1).max(100).optional(),
          menuItemName: z.string().trim().min(1).max(140).optional(),
        });
        const payload = recommendPayloadSchema.parse(req.body || {});

        const { recommendation, updated, previousScore100 } =
          await upsertRestaurantUserRecommendation(userId, restaurantId, payload);

        try {
          const nextScore100 = Math.max(
            1,
            Math.min(100, Number((recommendation as any)?.sentimentScore100) || 70),
          );
          const priorScore100 =
            typeof previousScore100 === "number" ? previousScore100 : null;
          const signalEvent = insertSentimentSignalEventSchema.parse({
            restaurantId,
            userId,
            source: "recommend",
            score100: nextScore100,
            previousScore100: priorScore100,
            deltaScore100:
              typeof priorScore100 === "number"
                ? nextScore100 - priorScore100
                : null,
            menuItemName: payload.menuItemName || null,
            cuisineType: restaurant.cuisineType || null,
            city: restaurant.city || null,
            state: restaurant.state || null,
          });
          await db.insert(sentimentSignalEvents).values(signalEvent);
        } catch (signalError) {
          console.warn("Failed to track recommendation sentiment signal:", signalError);
        }
        await ensureRestaurantFollowForEngagement(
          userId,
          restaurantId,
          "recommend",
        );
        await ensureRestaurantLikeForEngagement(userId, restaurantId, "recommend");
        void trackEngagement(
          updated ? "restaurant_recommend_updated" : "restaurant_recommend_added",
          userId,
          restaurantId,
        );

        if (!updated) {
          const baseUrl = (
            process.env.PUBLIC_BASE_URL || "https://www.mealscout.us"
          ).replace(/\/+$/, "");
          const slug = toSeoSlug(restaurant.name) || restaurantId;
          const profileLink = `${baseUrl}/restaurant/${restaurantId}/${slug}`;
          await queueRestaurantAutopostForTrigger({
            restaurant,
            trigger: "recommendation",
            message: `${restaurant.name} just got a new community recommendation on MealScout.`,
            link: profileLink,
          });
        }

        res.json({ ...recommendation, updated });
      } catch (error: any) {
        console.error("Error adding restaurant recommendation:", error);
        if (error.code === "23505") {
          await ensureRestaurantFollowForEngagement(
            String(req.user?.id || ""),
            String(req.params?.restaurantId || ""),
            "recommend",
          );
          await ensureRestaurantLikeForEngagement(
            String(req.user?.id || ""),
            String(req.params?.restaurantId || ""),
            "recommend",
          );
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
          updated_at: Date | null;
          sentiment_score_100: number | null;
          menu_item_name: string | null;
          first_name: string | null;
          last_name: string | null;
          like_count: number;
          dislike_count: number;
          share_count: number;
          viewer_reaction: string | null;
        }>`
          select
            rur.id,
            rur.user_id,
            rur.created_at,
            rur.updated_at,
            rur.sentiment_score_100,
            rur.menu_item_name,
            u.first_name,
            u.last_name,
            coalesce(sum(case rr.reaction_type when 'like' then 1 else 0 end), 0)::int as like_count,
            coalesce(sum(case rr.reaction_type when 'dislike' then 1 else 0 end), 0)::int as dislike_count,
            coalesce(count(distinct rs.id), 0)::int as share_count,
            max(case when rr.user_id = ${viewerId} then rr.reaction_type else null end) as viewer_reaction
          from restaurant_user_recommendations rur
          inner join users u on u.id = rur.user_id
          left join recommendation_reactions rr on rr.recommendation_id = rur.id
          left join recommendation_shares rs on rs.recommendation_id = rur.id
          where rur.restaurant_id = ${restaurantId}
          group by rur.id, rur.user_id, rur.created_at, rur.updated_at, rur.sentiment_score_100, rur.menu_item_name, u.first_name, u.last_name
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
          updatedAt: row.updated_at,
          sentimentScore100: Math.max(
            1,
            Math.min(100, Number(row.sentiment_score_100) || 70),
          ),
          menuItemName:
            typeof row.menu_item_name === "string" && row.menu_item_name.trim()
              ? row.menu_item_name.trim()
              : null,
          authorName:
            String(
              [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
            ) || "Community Member",
          likeCount: Number(row.like_count) || 0,
          dislikeCount: Number(row.dislike_count) || 0,
          shareCount: Number(row.share_count) || 0,
          viewerReaction:
            row.viewer_reaction === "like" || row.viewer_reaction === "dislike"
              ? row.viewer_reaction
              : null,
        }));

        res.json(payload);
      } catch (error) {
        console.warn(
          "Public recommendations unavailable, returning empty list:",
          error,
        );
        res.json([]);
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
          | { id: string; reaction_type: string }
          | undefined;

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
          dislikeCount: Number(summary.dislike_count) || 0,
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

        if (AUTOPROMO_SHARE_MILESTONES.has(shareCount)) {
          const recommendationMeta = await db.execute(sql<{
            restaurant_id: string;
            restaurant_name: string | null;
            owner_id: string | null;
            social_autopost_settings: unknown;
            facebook_page_url: string | null;
            instagram_url: string | null;
            x_url: string | null;
          }>`
            select
              rur.restaurant_id,
              r.name as restaurant_name,
              r.owner_id,
              r.social_autopost_settings,
              r.facebook_page_url,
              r.instagram_url,
              r.x_url
            from restaurant_user_recommendations rur
            inner join restaurants r on r.id = rur.restaurant_id
            where rur.id = ${recommendationId}
            limit 1
          `);

          const meta = ((recommendationMeta as any)?.rows || [])[0] as
            | {
                restaurant_id: string;
                restaurant_name: string | null;
                owner_id: string | null;
                social_autopost_settings: unknown;
                facebook_page_url: string | null;
                instagram_url: string | null;
                x_url: string | null;
              }
            | undefined;

          if (meta?.restaurant_id && meta?.owner_id) {
            const baseUrl = (
              process.env.PUBLIC_BASE_URL || "https://www.mealscout.us"
            ).replace(/\/+$/, "");
            const slug = toSeoSlug(meta.restaurant_name) || meta.restaurant_id;
            const profileLink = `${baseUrl}/restaurant/${meta.restaurant_id}/${slug}`;
            await queueRestaurantAutopostForTrigger({
              restaurant: {
                ownerId: meta.owner_id,
                name: meta.restaurant_name,
                socialAutopostSettings: meta.social_autopost_settings,
                facebookPageUrl: meta.facebook_page_url,
                instagramUrl: meta.instagram_url,
                xUrl: meta.x_url,
              },
              trigger: "engagement",
              message: `${meta.restaurant_name || "This spot"} just hit ${shareCount} community shares on MealScout recommendations.`,
              link: profileLink,
            });
          }
        }

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
    "/api/restaurants/:id/verification/external-reviews",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = req.params.id;
        const userId = req.user.id;

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant || restaurant.ownerId !== userId) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const parsed = z
          .object({
            reviews: z
              .array(
                z.object({
                  platform: z.string().trim().min(1).max(50),
                  rating: z.number().min(1).max(5),
                  reviewCount: z.number().int().min(0).max(100000).optional(),
                  profileUrl: z
                    .string()
                    .trim()
                    .url()
                    .max(500)
                    .optional()
                    .nullable(),
                }),
              )
              .max(20),
          })
          .parse(req.body || {});

        const normalized = normalizeImportedReviews(parsed.reviews);
        const aggregate = aggregateImportedReviews(normalized);
        const ratingAdjustment =
          aggregate.averageRating != null
            ? computeExternalReviewAdjustment(aggregate.averageRating)
            : 0;

        const user = await storage.getUserById(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const currentSettings =
          user.accountSettings && typeof user.accountSettings === "object"
            ? ({ ...(user.accountSettings as any) } as Record<string, any>)
            : {};
        const existingExternal = currentSettings.externalReviews || {};
        const byRestaurant =
          existingExternal.byRestaurant &&
          typeof existingExternal.byRestaurant === "object"
            ? { ...(existingExternal.byRestaurant as Record<string, any>) }
            : {};

        byRestaurant[restaurantId] = {
          averageRating: aggregate.averageRating,
          sourceCount: aggregate.sourceCount,
          totalReviewCount: aggregate.totalReviewCount,
          ratingAdjustment,
          importedAt: new Date().toISOString(),
        };

        const nextAccountSettings = {
          ...currentSettings,
          externalReviews: {
            ...existingExternal,
            byRestaurant,
          },
        };

        await storage.updateUser(userId, {
          accountSettings: nextAccountSettings as any,
        });

        const vac = await vacEvaluateRestaurantSignup({
          user: { ...user, accountSettings: nextAccountSettings } as any,
          restaurant: {
            ...restaurant,
            externalReviewRating: aggregate.averageRating,
            externalReviewSourceCount: aggregate.sourceCount,
          } as any,
          req,
        });

        if (vac.shouldAutoVerify && !restaurant.isVerified) {
          await storage.setRestaurantVerified(restaurantId, true);
        }

        res.json({
          success: true,
          externalReviewScore: byRestaurant[restaurantId],
          verification: {
            score: vac.score,
            threshold: vac.threshold,
            shouldAutoVerify: vac.shouldAutoVerify,
            externalReviewRating: vac.signals.externalReviewRating,
            externalReviewAdjustment: vac.signals.externalReviewAdjustment,
          },
        });
      } catch (error: any) {
        console.error("Error importing external reviews:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid external review payload",
            errors: error.errors,
          });
        }
        res.status(500).json({
          message: error?.message || "Failed to import external reviews",
        });
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

        const rateLimit = checkRateLimit(restaurantId);
        if (!rateLimit.allowed) {
          return res.status(429).json({
            message:
              "Rate limit exceeded. Only one verification request per restaurant per hour is allowed.",
            nextAllowedTime: rateLimit.nextAllowedTime,
          });
        }

        const hasPendingRequest =
          await storage.hasPendingVerificationRequest(restaurantId);
        if (hasPendingRequest) {
          return res.status(409).json({
            message:
              "A verification request is already pending for this restaurant. Please wait for admin review.",
          });
        }

        const verificationData = insertVerificationRequestSchema.parse({
          ...req.body,
          restaurantId,
        });

        const documentValidation = validateDocuments(
          verificationData.documents,
        );
        if (!documentValidation.valid) {
          return res.status(400).json({
            message: "Document validation failed",
            errors: documentValidation.errors,
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
