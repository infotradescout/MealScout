/**
 * growthRoutes.ts
 *
 * Admin-only growth telemetry endpoints.
 *
 * GET  /api/admin/growth/city-health
 *   Returns a per-city content health score (0–10) that summarises
 *   how well MealScout is populated for each city page.
 *
 * POST /api/admin/growth/diner-digest/run
 *   Manually triggers the diner deals digest (for testing / on-demand).
 *
 * Scoring rubric (max 10 points):
 *   trucks      0–3  (0 = none, 1 = 1–2, 2 = 3–9, 3 = 10+)
 *   restaurants 0–3  (0 = none, 1 = 1–2, 2 = 3–9, 3 = 10+)
 *   deals       0–2  (0 = none, 1 = 1–2, 2 = 3+)
 *   events      0–2  (0 = none, 1 = 1–2, 2 = 3+)
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  cities,
  restaurants,
  events,
  deals,
  telemetryEvents,
} from "@shared/schema";
import {
  and,
  eq,
  gte,
  isNull,
  lte,
  or,
  ilike,
  sql,
  desc,
} from "drizzle-orm";
import { DinerDigestService } from "../dinerDigestService";
import { OnboardingDripService } from "../onboardingDripService";
import { RestaurantActivationService } from "../restaurantActivationService";

function bucketScore(count: number, t1: number, t2: number, t3: number): number {
  if (count >= t3) return 3;
  if (count >= t2) return 2;
  if (count >= t1) return 1;
  return 0;
}

function bucketScore2(count: number, t1: number, t2: number): number {
  if (count >= t2) return 2;
  if (count >= t1) return 1;
  return 0;
}

function isAdmin(req: Request): boolean {
  const user = (req as any).user;
  return user && (user.userType === "admin" || user.userType === "super_admin");
}

export function registerGrowthRoutes(app: Express): void {
  // City health scores
  app.get("/api/admin/growth/city-health", async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      const now = new Date();
      const allCities = await db.select().from(cities).orderBy(cities.name);

      const scored = await Promise.all(
        allCities.map(async (city: typeof allCities[number]) => {
          const cityLike = `%${city.name}%`;

          // Count trucks (businessType = 'food_truck' | 'truck')
          const [truckCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(restaurants)
            .where(
              and(
                or(
                  ilike(restaurants.city, cityLike),
                  ilike(restaurants.address, cityLike),
                ),
                or(
                  eq(restaurants.businessType, "food_truck"),
                  eq(restaurants.businessType, "truck"),
                ),
              ),
            );

          // Count restaurants (all non-truck types)
          const [restCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(restaurants)
            .where(
              and(
                or(
                  ilike(restaurants.city, cityLike),
                  ilike(restaurants.address, cityLike),
                ),
              ),
            );

          // Count active deals
          const [dealCount] = await db
            .select({ count: sql<number>`count(*)` })
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
            );

          // Count upcoming events
          const [eventCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(events)
            .where(gte(events.date, now));

          const trucks = Number(truckCount?.count || 0);
          const rests = Number(restCount?.count || 0);
          const dealsN = Number(dealCount?.count || 0);
          const eventsN = Number(eventCount?.count || 0);

          const truckScore = bucketScore(trucks, 1, 3, 10);
          const restScore = bucketScore(rests, 1, 3, 10);
          const dealScore = bucketScore2(dealsN, 1, 3);
          const eventScore = bucketScore2(eventsN, 1, 3);
          const total = truckScore + restScore + dealScore + eventScore;

          return {
            city: { id: city.id, name: city.name, slug: city.slug, state: city.state },
            score: total,
            maxScore: 10,
            breakdown: {
              trucks: { count: trucks, score: truckScore },
              restaurants: { count: rests, score: restScore },
              deals: { count: dealsN, score: dealScore },
              events: { count: eventsN, score: eventScore },
            },
            cityPageUrl: `https://www.mealscout.us/food-trucks/${city.slug}`,
          };
        }),
      );

      const sorted = scored.sort((a, b) => b.score - a.score);
      const summary = {
        generatedAt: now.toISOString(),
        totalCities: sorted.length,
        avgScore: sorted.length
          ? Math.round((sorted.reduce((s, c) => s + c.score, 0) / sorted.length) * 10) / 10
          : 0,
        cities: sorted,
      };

      res.setHeader("Cache-Control", "no-cache");
      res.json(summary);
    } catch (err) {
      console.error("[growth/city-health] error:", err);
      res.status(500).json({ message: "Failed to compute city health" });
    }
  });

  // Diner digest telemetry summary
  app.get("/api/admin/growth/diner-digest-stats", async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      const recent = await db
        .select({
          week: sql<string>`properties->>'week'`,
          city: sql<string>`properties->>'city'`,
          dealCount: sql<string>`properties->>'dealCount'`,
          userId: telemetryEvents.userId,
          createdAt: telemetryEvents.createdAt,
        })
        .from(telemetryEvents)
        .where(eq(telemetryEvents.eventName, "diner_digest_sent"))
        .orderBy(desc(telemetryEvents.createdAt))
        .limit(200);

      // Group by week
      const byWeek: Record<string, { week: string; sends: number; cities: Set<string> }> = {};
      for (const row of recent) {
        const w = row.week || "unknown";
        if (!byWeek[w]) byWeek[w] = { week: w, sends: 0, cities: new Set() };
        byWeek[w].sends++;
        if (row.city) byWeek[w].cities.add(row.city);
      }

      res.json({
        generatedAt: new Date().toISOString(),
        totalSends: recent.length,
        byWeek: Object.values(byWeek)
          .sort((a, b) => b.week.localeCompare(a.week))
          .map((w) => ({ week: w.week, sends: w.sends, uniqueCities: w.cities.size })),
      });
    } catch (err) {
      console.error("[growth/diner-digest-stats] error:", err);
      res.status(500).json({ message: "Failed to fetch diner digest stats" });
    }
  });

  // Manual trigger for diner digest (admins / testing)
  app.post("/api/admin/growth/diner-digest/run", async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      const stats = await DinerDigestService.getInstance().sendDinerDigests();
      res.json({ ok: true, stats });
    } catch (err) {
      console.error("[growth/diner-digest/run] error:", err);
      res.status(500).json({ message: "Digest run failed" });
    }
  });

  // Manual trigger for onboarding drip
  app.post("/api/admin/growth/onboarding-drip/run", async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const stats = await OnboardingDripService.getInstance().run();
      res.json({ ok: true, stats });
    } catch (err) {
      console.error("[growth/onboarding-drip/run] error:", err);
      res.status(500).json({ message: "Onboarding drip run failed" });
    }
  });

  // Manual trigger for restaurant activation nudge
  app.post("/api/admin/growth/restaurant-activation/run", async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const stats = await RestaurantActivationService.getInstance().run();
      res.json({ ok: true, stats });
    } catch (err) {
      console.error("[growth/restaurant-activation/run] error:", err);
      res.status(500).json({ message: "Restaurant activation run failed" });
    }
  });
}
