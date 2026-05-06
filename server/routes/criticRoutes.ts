import type { Express } from "express";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { restaurants } from "@shared/schema";
import {
  addCriticVideoAssignment,
  clampCriticRadiusMiles,
  markCriticRestaurantReviewed,
  mergeCriticSettings,
  normalizeCriticSettings,
} from "../utils/criticSettings";

const radiusSchema = z.object({
  radiusMiles: z.coerce.number().min(1).max(250),
});

const listSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  radiusMiles: z.coerce.number().min(1).max(250).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const milesBetween = (
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = radians(second.lat - first.lat);
  const dLng = radians(second.lng - first.lng);
  const lat1 = radians(first.lat);
  const lat2 = radians(second.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const requireCriticUser = async (req: any, res: any) => {
  const user = await storage.getUser(req.user.id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return null;
  }

  const critic = normalizeCriticSettings(user.accountSettings);
  if (!critic.enabled) {
    res.status(403).json({ message: "Critic access required" });
    return null;
  }

  return { user, critic };
};

export function registerCriticRoutes(app: Express) {
  app.get("/api/critic/me", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        critic: normalizeCriticSettings(user.accountSettings),
      });
    } catch (error) {
      console.error("Error loading critic profile:", error);
      res.status(500).json({ message: "Failed to load critic profile" });
    }
  });

  app.patch("/api/critic/me", isAuthenticated, async (req: any, res) => {
    try {
      const context = await requireCriticUser(req, res);
      if (!context) return;

      const parsed = radiusSchema.parse(req.body || {});
      const updated = await storage.updateUser(context.user.id, {
        accountSettings: mergeCriticSettings(context.user.accountSettings, {
          radiusMiles: clampCriticRadiusMiles(parsed.radiusMiles),
        }) as any,
      });

      res.json({
        critic: normalizeCriticSettings(updated.accountSettings),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Radius must be between 1 and 250 miles.",
          errors: error.errors,
        });
      }
      console.error("Error updating critic profile:", error);
      res.status(500).json({ message: "Failed to update critic profile" });
    }
  });

  app.get("/api/critic/new-trucks", isAuthenticated, async (req: any, res) => {
    try {
      const context = await requireCriticUser(req, res);
      if (!context) return;

      const parsed = listSchema.parse(req.query || {});
      const radiusMiles = clampCriticRadiusMiles(
        parsed.radiusMiles ?? context.critic.radiusMiles,
      );
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parsed.days);

      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          address: restaurants.address,
          city: restaurants.city,
          state: restaurants.state,
          cuisineType: restaurants.cuisineType,
          businessType: restaurants.businessType,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          currentLatitude: restaurants.currentLatitude,
          currentLongitude: restaurants.currentLongitude,
          createdAt: restaurants.createdAt,
          isVerified: restaurants.isVerified,
        })
        .from(restaurants)
        .where(
          and(
            gte(restaurants.createdAt, cutoff),
            or(
              eq(restaurants.isFoodTruck, true),
              eq(restaurants.businessType, "food_truck"),
            ),
            or(eq(restaurants.isActive, true), isNull(restaurants.isActive)),
          ),
        )
        .orderBy(desc(restaurants.createdAt))
        .limit(200);

      const hasLocation =
        typeof parsed.lat === "number" && typeof parsed.lng === "number";
      const origin = hasLocation
        ? { lat: parsed.lat as number, lng: parsed.lng as number }
        : null;

      const trucks = rows
        .map((row: any) => {
          const lat =
            toNumberOrNull(row.currentLatitude) ?? toNumberOrNull(row.latitude);
          const lng =
            toNumberOrNull(row.currentLongitude) ??
            toNumberOrNull(row.longitude);
          const distanceMiles =
            origin && lat !== null && lng !== null
              ? milesBetween(origin, { lat, lng })
              : null;
          const reviewed =
            context.critic.reviewedRestaurants[String(row.id)] || null;

          return {
            ...row,
            imageUrl: row.logoUrl || row.coverImageUrl || null,
            distanceMiles:
              distanceMiles === null
                ? null
                : Math.round(distanceMiles * 10) / 10,
            reviewedAt: reviewed?.reviewedAt || null,
          };
        })
        .filter(
          (row: any) =>
            row.distanceMiles === null || row.distanceMiles <= radiusMiles,
        )
        .sort((a: any, b: any) => {
          if (!a.reviewedAt && b.reviewedAt) return -1;
          if (a.reviewedAt && !b.reviewedAt) return 1;
          if (a.distanceMiles !== null && b.distanceMiles !== null) {
            return a.distanceMiles - b.distanceMiles;
          }
          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          );
        });

      res.json({
        days: parsed.days,
        radiusMiles,
        hasLocation,
        trucks,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid critic feed filters.",
          errors: error.errors,
        });
      }
      console.error("Error loading critic new trucks feed:", error);
      res.status(500).json({ message: "Failed to load critic feed" });
    }
  });

  app.post(
    "/api/critic/restaurants/:restaurantId/reviewed",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const context = await requireCriticUser(req, res);
        if (!context) return;

        const restaurantId = String(req.params.restaurantId || "").trim();
        const [restaurant] = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const updated = await storage.updateUser(context.user.id, {
          accountSettings: markCriticRestaurantReviewed(
            context.user.accountSettings,
            restaurantId,
          ) as any,
        });

        res.json({
          critic: normalizeCriticSettings(updated.accountSettings),
        });
      } catch (error) {
        console.error("Error marking critic restaurant reviewed:", error);
        res.status(500).json({ message: "Failed to mark truck reviewed" });
      }
    },
  );

  app.post(
    "/api/critic/restaurants/:restaurantId/video-pitch",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const context = await requireCriticUser(req, res);
        if (!context) return;

        const restaurantId = String(req.params.restaurantId || "").trim();
        const [restaurant] = await db
          .select({ id: restaurants.id, name: restaurants.name })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const updated = await storage.updateUser(context.user.id, {
          accountSettings: addCriticVideoAssignment(
            context.user.accountSettings,
            restaurant,
          ) as any,
        });

        res.json({
          critic: normalizeCriticSettings(updated.accountSettings),
        });
      } catch (error) {
        console.error("Error pitching critic video:", error);
        res.status(500).json({ message: "Failed to pitch video" });
      }
    },
  );
}
