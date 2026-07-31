import type { Express } from "express";
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import {
  cities,
  deals,
  insertReviewSchema,
  restaurants,
  users,
} from "@shared/schema";
import { toPublicRestaurantReviewArray } from "../publicProfiles/toPublicRestaurantReview";
import {
  isBarBusinessType,
  isTruckBusinessType,
} from "@shared/businessTypes";
import { buildPublicProfilePath } from "../publicProfiles/publicProfileUtils";

type DealDiscoveryRouteDependencies = {
  filterDealsByBusinessAccess: <T extends { restaurantId?: string | null }>(
    dealRows: T[],
  ) => Promise<T[]>;
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const resolvePublicBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVICE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

export function registerDealDiscoveryRoutes(
  app: Express,
  {
    filterDealsByBusinessAccess,
    hasCompleteProfileAccess,
  }: DealDiscoveryRouteDependencies,
) {
  app.get("/api/deals/active", async (_req, res) => {
    try {
      const activeDeals = await storage.getActiveDeals();
      const filteredDeals = await filterDealsByBusinessAccess(
        activeDeals as any[],
      );
      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching active deals:", error);
      res.status(500).json({ message: "Failed to fetch deals" });
    }
  });

  app.get("/api/deals/my-active", isAuthenticated, async (req: any, res) => {
    try {
      const restaurantsByOwner = await storage.getRestaurantsByOwner(req.user.id);
      const allDeals = await Promise.all(
        restaurantsByOwner.map(async (restaurant) => {
          const restaurantDeals = await storage.getDealsByRestaurant(
            restaurant.id,
          );
          return restaurantDeals.filter((deal) => deal.isActive);
        }),
      );

      res.json(allDeals.flat());
    } catch (error) {
      console.error("Error fetching my active deals:", error);
      res.status(500).json({ message: "Failed to fetch active deals" });
    }
  });

  app.get("/api/deals/featured", async (req, res) => {
    try {
      const filter = req.query.filter as string;
      const showLimitedTimeOnly = filter === "limited-time";

      const featuredDeals = await storage.getFilteredDeals(showLimitedTimeOnly);
      const filteredDeals = await filterDealsByBusinessAccess(
        featuredDeals as any[],
      );
      const payloadDeals =
        filteredDeals.length > 0 || featuredDeals.length === 0
          ? filteredDeals
          : featuredDeals;
      if (filteredDeals.length === 0 && featuredDeals.length > 0) {
        res.setHeader("X-MealScout-Fallback", "unfiltered-featured-deals");
      }

      res.set({
        "Cache-Control": "public, max-age=300",
        ETag: `"deals-${filter || "all"}-${Date.now()}"`,
      });

      res.json(payloadDeals);
    } catch (error) {
      console.error("Error fetching featured deals:", error);
      res.status(500).json({ message: "Failed to fetch featured deals" });
    }
  });

  app.get("/api/public/deals/city/:citySlug", async (req, res) => {
    try {
      const citySlug = String(req.params.citySlug || "").trim().toLowerCase();
      if (!citySlug) {
        return res.status(400).json({ message: "City slug required" });
      }

      const [city] = await db
        .select()
        .from(cities)
        .where(eq(cities.slug, citySlug))
        .limit(1);
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }

      const now = new Date();
      const cityLike = `%${String(city.name || "").trim()}%`;

      const rows = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          imageUrl: deals.imageUrl,
          startDate: deals.startDate,
          endDate: deals.endDate,
          discountValue: deals.discountValue,
          dealType: deals.dealType,
          restaurantId: restaurants.id,
          restaurantName: restaurants.name,
          cuisineType: restaurants.cuisineType,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          businessType: restaurants.businessType,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(
          and(
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
            or(
              ilike(restaurants.city, cityLike),
              ilike(restaurants.address, cityLike),
            ),
          ),
        )
        .orderBy(desc(deals.updatedAt))
        .limit(500);

      const baseUrl = resolvePublicBaseUrl();
      const payload = rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
        startDate: row.startDate ? new Date(row.startDate).toISOString() : null,
        endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
        dealType: row.dealType,
        discountValue: row.discountValue,
        dealPath: `/deal/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
        restaurant: {
          id: row.restaurantId,
          name: row.restaurantName,
          cuisineType: row.cuisineType || null,
          city: row.restaurantCity || null,
          state: row.restaurantState || null,
          entityPath: buildPublicProfilePath({
            entityType: isBarBusinessType(row.businessType)
              ? "bar"
              : isTruckBusinessType(row.businessType)
                ? "truck"
                : "restaurant",
            id: row.restaurantId,
            name: row.restaurantName,
          }),
        },
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      }));

      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({
        city: { name: city.name, slug: city.slug, state: city.state || null },
        generatedAt: new Date().toISOString(),
        totalDeals: payload.length,
        canonicalUrl: `${baseUrl}/deals/${encodeURIComponent(city.slug)}`,
        deals: payload,
      });
    } catch (error) {
      console.error("[deals-city] error:", error);
      res.status(500).json({ message: "Unable to load city deals" });
    }
  });

  app.get("/api/deals/restaurant/:restaurantId", async (req, res) => {
    try {
      const restaurantId = z
        .string()
        .uuid("Invalid restaurant ID format")
        .parse(req.params.restaurantId);

      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const isOwnerViewing =
        Boolean(req.isAuthenticated?.()) &&
        String((req as any)?.user?.id || "") ===
          String((restaurant as any).ownerId || "");
      const ownerHasAccess = await hasCompleteProfileAccess(
        String((restaurant as any).ownerId || ""),
      );
      if (!ownerHasAccess && !isOwnerViewing) {
        return res.json([]);
      }

      const activeDeals = (await storage.getDealsByRestaurant(restaurantId))
        .filter((deal) => deal.isActive)
        .map((deal) => ({
          ...deal,
          restaurant: {
            name: restaurant.name,
            cuisineType: restaurant.cuisineType,
            phone: restaurant.phone,
          },
        }));

      res.set({
        "Cache-Control": "public, max-age=180",
        ETag: `"restaurant-deals-${restaurantId}-${Date.now()}"`,
      });

      res.json(activeDeals);
    } catch (error: any) {
      console.error("Error fetching restaurant deals:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid restaurant ID format" });
      }
      res.status(500).json({ message: "Failed to fetch restaurant deals" });
    }
  });

  app.get("/api/deals/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = parseFloat(req.query.radius as string) || 5;

      const nearbyDeals = await storage.getNearbyDeals(lat, lng, radius);
      const filteredDeals = await filterDealsByBusinessAccess(
        nearbyDeals as any[],
      );
      const payloadDeals =
        filteredDeals.length > 0 || nearbyDeals.length === 0
          ? filteredDeals
          : nearbyDeals;
      if (filteredDeals.length === 0 && nearbyDeals.length > 0) {
        res.setHeader("X-MealScout-Fallback", "unfiltered-nearby-deals");
      }
      res.json(payloadDeals);
    } catch (error) {
      console.error("Error fetching nearby deals:", error);
      res.status(500).json({ message: "Failed to fetch nearby deals" });
    }
  });

  app.get("/api/deals/search", async (req, res) => {
    try {
      const {
        q: query,
        cuisine,
        minPrice,
        maxPrice,
        radius = 10,
        lat,
        lng,
        sortBy = "relevance",
      } = req.query;

      const dealRows = await storage.searchDeals({
        query: query as string,
        cuisineType: cuisine as string,
        minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
        latitude: lat ? parseFloat(lat as string) : undefined,
        longitude: lng ? parseFloat(lng as string) : undefined,
        radius: parseFloat(radius as string),
        sortBy: sortBy as string,
      });

      const filteredDeals = await filterDealsByBusinessAccess(dealRows as any[]);
      res.json(filteredDeals);
    } catch (error) {
      console.error("Error searching deals:", error);
      res.status(500).json({ message: "Failed to search deals" });
    }
  });

  app.get("/api/deals/recommended", async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID || "anonymous";

      const recommendedDeals = await storage.getActiveDeals();
      const filteredDeals = await filterDealsByBusinessAccess(
        recommendedDeals as any[],
      );

      if (filteredDeals.length > 0) {
        Promise.all(
          filteredDeals.slice(0, 10).map(async (deal: any) => {
            try {
              await storage.trackRestaurantRecommendation({
                restaurantId: deal.restaurantId,
                userId,
                sessionId,
                recommendationType: "personalized",
                recommendationContext: "deals_recommended_endpoint",
              });
            } catch (error) {
              console.error("Error tracking recommendation:", error);
            }
          }),
        ).catch((error) =>
          console.error("Error tracking recommendations batch:", error),
        );
      }

      res.json(filteredDeals);
    } catch (error) {
      console.error("Error fetching recommended deals:", error);
      res.status(500).json({ message: "Failed to fetch recommended deals" });
    }
  });

  app.get("/api/deals/:id", async (req, res) => {
    try {
      const deal = await storage.getDeal(req.params.id);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }

      const restaurant = await storage.getRestaurant(String(deal.restaurantId));
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const isOwnerViewing =
        Boolean(req.isAuthenticated?.()) &&
        String((req as any)?.user?.id || "") ===
          String((restaurant as any).ownerId || "");
      const ownerHasAccess = await hasCompleteProfileAccess(
        String((restaurant as any).ownerId || ""),
      );
      if (!ownerHasAccess && !isOwnerViewing) {
        return res.status(404).json({ message: "Deal not found" });
      }

      res.json(deal);
    } catch (error) {
      console.error("Error fetching deal:", error);
      res.status(500).json({ message: "Failed to fetch deal" });
    }
  });

  app.post("/api/reviews", isAuthenticated, async (req: any, res) => {
    try {
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        rating: 0,
        userId: req.user.id,
      });

      const review = await storage.createReview(reviewData);

      // This detail step adds weight on top of a bare recommend
      // (see /api/restaurants/:restaurantId/recommend).
      await db
        .update(users)
        .set({
          reviewCount: sql`${users.reviewCount} + 1`,
          influenceScore: sql`${users.influenceScore} + 2`,
          updatedAt: new Date(),
        } as any)
        .where(eq(users.id, req.user.id));

      res.json(review);
    } catch (error: any) {
      console.error("Error creating review:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/reviews/restaurant/:restaurantId", async (req, res) => {
    try {
      const reviews = await storage.getRestaurantReviews(
        req.params.restaurantId,
      );
      res.json(toPublicRestaurantReviewArray(reviews));
    } catch (error) {
      console.error("Error fetching reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

}
