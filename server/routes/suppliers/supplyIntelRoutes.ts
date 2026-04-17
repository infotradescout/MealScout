import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import {
  restaurants,
  supplyOrderPreferences,
  supplyPriceAlerts,
  supplyPriceDailySnapshots,
  supplyPriceWatches,
} from "@shared/schema";
import type { SupplierSupplyIntelRouteDeps } from "./shared";

export function registerSupplierSupplyIntelRoutes(
  app: Express,
  deps: SupplierSupplyIntelRouteDeps,
) {
  const {
    ensureSupplyOrderPreferences,
    resolveBuyerRestaurantOrThrow,
    normalizeSupplyKey,
    toDayKey,
    getLocalizedPriceOffers,
    getWatchSnapshotTrend,
  } = deps;

  app.get("/api/supply/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await ensureSupplyOrderPreferences(String(req.user.id));
      res.json(prefs);
    } catch (error: any) {
      console.error("Error loading supply preferences:", error);
      res.status(500).json({ message: error.message || "Failed to load preferences" });
    }
  });

  app.post("/api/supply/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        maxStops: z.coerce.number().int().min(1).max(5).optional(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
        // Legacy
        costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
        // Preferred
        stopMinutes: z.coerce.number().int().min(0).max(240).optional(),
        costPerMinuteCents: z.coerce.number().int().min(0).max(5_000).optional(),
        pingSuppliers: z.coerce.boolean().optional(),
        allowSubstitutions: z.coerce.boolean().optional(),
      });
      const parsed = schema.parse(req.body || {});
      const existing = await ensureSupplyOrderPreferences(String(req.user.id));
      const now = new Date();
      const [updated] = await db
        .update(supplyOrderPreferences)
        .set({ ...parsed, updatedAt: now } as any)
        .where(eq(supplyOrderPreferences.id, existing.id))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supply preferences:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid preferences", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update preferences" });
    }
  });

  app.get("/api/supply/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const watches = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.userId, String(req.user.id)), eq(supplyPriceWatches.isActive, true)))
        .orderBy(desc(supplyPriceWatches.updatedAt))
        .limit(200);

      const buyerIds = Array.from(
        new Set(
          (watches as any[])
            .map((watch: any) => String(watch.buyerRestaurantId || "").trim())
            .filter(Boolean),
        ),
      );
      const buyerRestaurants =
        buyerIds.length > 0
          ? await db
              .select()
              .from(restaurants)
              .where(inArray(restaurants.id, buyerIds))
          : [];
      const buyerById = new Map(
        (buyerRestaurants as any[]).map((restaurant: any) => [String(restaurant.id), restaurant]),
      );

      const now = new Date();
      const minTriggerGapMs = 12 * 60 * 60 * 1000;
      const trendCache = new Map<string, any>();
      const rows = await Promise.all(
        (watches as any[]).map(async (watch: any) => {
          const buyerRestaurant = watch.buyerRestaurantId
            ? buyerById.get(String(watch.buyerRestaurantId)) || null
            : null;
          const offers = await getLocalizedPriceOffers({
            itemKey: String(watch.itemKey || ""),
            itemName: String(watch.itemName || ""),
            buyerRestaurant,
            maxRadiusMiles: Number(watch.maxRadiusMiles || 25),
          });
          const best = offers[0] || null;
          const targetPriceCents =
            watch.targetPriceCents === null || watch.targetPriceCents === undefined
              ? null
              : Number(watch.targetPriceCents);
          const targetMet =
            targetPriceCents !== null && best ? Number(best.unitPriceCents) <= targetPriceCents : false;

          if (targetMet) {
            const lastTriggeredAt = watch.lastTriggeredAt ? new Date(watch.lastTriggeredAt) : null;
            const stale = !lastTriggeredAt || now.getTime() - lastTriggeredAt.getTime() > minTriggerGapMs;
            if (stale) {
              const alertMessage = `${watch.itemName} hit your target at $${(
                Number(best.unitPriceCents || 0) / 100
              ).toFixed(2)} (${best.storeName}).`;
              await db.insert(supplyPriceAlerts).values({
                watchId: String(watch.id),
                userId: String(req.user.id),
                buyerRestaurantId: watch.buyerRestaurantId ? String(watch.buyerRestaurantId) : null,
                itemKey: String(watch.itemKey || ""),
                itemName: String(watch.itemName || ""),
                alertType: "price_target_hit",
                message: alertMessage,
                observedPriceCents: Number(best.unitPriceCents || 0),
                baselinePriceCents: targetPriceCents,
                observedAt: best.observedAt ? new Date(best.observedAt) : now,
                storeId: best.storeId,
                storeLocationId: best.storeLocationId,
                storeName: best.storeName,
                storeCity: best.storeCity,
                storeState: best.storeState,
                createdAt: now,
              } as any);

              await db
                .update(supplyPriceWatches)
                .set({ lastTriggeredAt: now, updatedAt: now } as any)
                .where(eq(supplyPriceWatches.id, String(watch.id)));
            }
          }

          const areaKey = buyerRestaurant?.state
            ? `state:${String(buyerRestaurant.state).trim()}`
            : "global";
          const offerPrices = offers
            .map((offer: any) => Number(offer.unitPriceCents || 0))
            .filter((value: number) => Number.isFinite(value) && value >= 0)
            .sort((a: number, b: number) => a - b);
          if (offerPrices.length > 0) {
            const minPrice = offerPrices[0];
            const maxPrice = offerPrices[offerPrices.length - 1];
            const medianPrice =
              offerPrices.length % 2 === 0
                ? Math.round((offerPrices[offerPrices.length / 2 - 1] + offerPrices[offerPrices.length / 2]) / 2)
                : offerPrices[Math.floor(offerPrices.length / 2)];
            const snapshotDay = toDayKey(now);
            await db
              .insert(supplyPriceDailySnapshots)
              .values({
                itemKey: String(watch.itemKey || ""),
                itemName: String(watch.itemName || ""),
                areaKey,
                snapshotDay,
                minPriceCents: minPrice,
                medianPriceCents: medianPrice,
                maxPriceCents: maxPrice,
                sampleCount: offerPrices.length,
                createdAt: now,
                updatedAt: now,
              } as any)
              .onConflictDoUpdate({
                target: [
                  supplyPriceDailySnapshots.itemKey,
                  supplyPriceDailySnapshots.areaKey,
                  supplyPriceDailySnapshots.snapshotDay,
                ],
                set: {
                  itemName: String(watch.itemName || ""),
                  minPriceCents: minPrice,
                  medianPriceCents: medianPrice,
                  maxPriceCents: maxPrice,
                  sampleCount: offerPrices.length,
                  updatedAt: now,
                } as any,
              });
          }

          const trendKey = `${String(watch.itemKey || "")}:${areaKey}`;
          let trend = trendCache.get(trendKey);
          if (!trend) {
            trend = await getWatchSnapshotTrend({
              itemKey: String(watch.itemKey || ""),
              areaKey,
              limitDays: 30,
            });
            trendCache.set(trendKey, trend);
          }

          return {
            ...watch,
            currentBest: best
              ? {
                  unitPriceCents: Number(best.unitPriceCents || 0),
                  observedAt: best.observedAt,
                  storeName: best.storeName,
                  storeCity: best.storeCity,
                  storeState: best.storeState,
                  distanceMiles: best.distanceMiles,
                }
              : null,
            trend,
            targetMet,
          };
        }),
      );

      res.json(rows);
    } catch (error: any) {
      console.error("Error loading price watches:", error);
      res.status(500).json({ message: error.message || "Failed to load price watches" });
    }
  });

  app.post("/api/supply/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        itemName: z.string().trim().min(1).max(160),
        itemKey: z.string().trim().max(160).optional().nullable(),
        targetPriceCents: z.coerce.number().int().min(1).max(10_000_000).optional().nullable(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
      });
      const parsed = schema.parse(req.body || {});

      let buyerRestaurantId: string | null = null;
      if (parsed.buyerRestaurantId) {
        const buyerRestaurant = await resolveBuyerRestaurantOrThrow(req, String(parsed.buyerRestaurantId));
        buyerRestaurantId = String((buyerRestaurant as any).id);
      }

      const itemKey = normalizeSupplyKey(String(parsed.itemKey || parsed.itemName || ""));
      const now = new Date();
      const [created] = await db
        .insert(supplyPriceWatches)
        .values({
          userId: String(req.user.id),
          buyerRestaurantId,
          itemKey,
          itemName: String(parsed.itemName).trim(),
          targetPriceCents:
            parsed.targetPriceCents === null || parsed.targetPriceCents === undefined
              ? null
              : Number(parsed.targetPriceCents),
          maxRadiusMiles: Number(parsed.maxRadiusMiles || 25),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();

      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating price watch:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid watch", errors: error.errors });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to create price watch" });
    }
  });

  app.delete("/api/supply/price-watches/:watchId", isAuthenticated, async (req: any, res) => {
    try {
      const watchId = String(req.params.watchId || "").trim();
      const [watch] = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.id, watchId), eq(supplyPriceWatches.userId, String(req.user.id))))
        .limit(1);
      if (!watch) return res.status(404).json({ message: "Watch not found" });

      await db
        .update(supplyPriceWatches)
        .set({ isActive: false, updatedAt: new Date() } as any)
        .where(eq(supplyPriceWatches.id, String((watch as any).id)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting price watch:", error);
      res.status(500).json({ message: error.message || "Failed to delete price watch" });
    }
  });

  app.get("/api/supply/price-watches/alerts", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supplyPriceAlerts)
        .where(eq(supplyPriceAlerts.userId, String(req.user.id)))
        .orderBy(desc(supplyPriceAlerts.createdAt))
        .limit(120);
      res.json(rows);
    } catch (error: any) {
      console.error("Error loading price watch alerts:", error);
      res.status(500).json({ message: error.message || "Failed to load price alerts" });
    }
  });

  app.get("/api/supply/price-watches/:watchId/history", isAuthenticated, async (req: any, res) => {
    try {
      const watchId = String(req.params.watchId || "").trim();
      const [watch] = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.id, watchId), eq(supplyPriceWatches.userId, String(req.user.id))))
        .limit(1);
      if (!watch) return res.status(404).json({ message: "Watch not found" });

      const dayLimit = Math.min(Number(req.query?.days || 30) || 30, 90);
      const snapshots = await db
        .select()
        .from(supplyPriceDailySnapshots)
        .where(eq(supplyPriceDailySnapshots.itemKey, String((watch as any).itemKey || "")))
        .orderBy(desc(supplyPriceDailySnapshots.snapshotDay))
        .limit(dayLimit);

      res.json({
        watch,
        snapshots: (snapshots as any[]).reverse(),
      });
    } catch (error: any) {
      console.error("Error loading watch history:", error);
      res.status(500).json({ message: error.message || "Failed to load watch history" });
    }
  });
}
