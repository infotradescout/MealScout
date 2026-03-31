import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  restaurants,
  supplyItemAliases,
  supplyItems,
  supplyPriceAlerts,
  supplyPriceDailySnapshots,
  supplyPrices,
  supplyPriceWatches,
  supplyStoreLocations,
  supplyStores,
} from "@shared/schema";

const normalizeSupplyKey = (raw: string) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const haversineMiles = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthMiles = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(h)));
};

const toDayKey = (value: Date) => {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

async function resolveSupplyItemIds(itemKey: string, itemName: string) {
  const key = normalizeSupplyKey(itemKey || itemName);
  const itemRows = await db
    .select({ id: supplyItems.id })
    .from(supplyItems)
    .where(
      or(
        eq(supplyItems.itemKey, key),
        ilike(supplyItems.canonicalName, `%${itemName || itemKey}%`),
      ),
    )
    .limit(40);

  const aliasRows = await db
    .select({ itemId: supplyItemAliases.itemId })
    .from(supplyItemAliases)
    .where(
      or(
        eq(supplyItemAliases.aliasKey, key),
        ilike(supplyItemAliases.alias, `%${itemName || itemKey}%`),
      ),
    )
    .limit(60);

  return Array.from(
    new Set(
      [
        ...itemRows.map((row: any) => String(row.id || "")).filter(Boolean),
        ...aliasRows.map((row: any) => String(row.itemId || "")).filter(Boolean),
      ].filter(Boolean),
    ),
  );
}

async function getLocalizedOffers(params: {
  itemKey: string;
  itemName: string;
  buyerRestaurant: any | null;
  maxRadiusMiles: number;
}) {
  const itemIds = await resolveSupplyItemIds(params.itemKey, params.itemName);
  if (itemIds.length === 0) return [] as any[];

  const priceRows = await db
    .select()
    .from(supplyPrices)
    .where(and(inArray(supplyPrices.itemId, itemIds), eq(supplyPrices.currency, "usd")))
    .orderBy(desc(supplyPrices.observedAt))
    .limit(2500);

  if (priceRows.length === 0) return [] as any[];

  const storeIds = Array.from(
    new Set((priceRows as any[]).map((row) => String(row.storeId || "")).filter(Boolean)),
  );
  const locationIds = Array.from(
    new Set((priceRows as any[]).map((row) => String(row.storeLocationId || "")).filter(Boolean)),
  );

  const [stores, locations] = await Promise.all([
    storeIds.length > 0
      ? db
          .select()
          .from(supplyStores)
          .where(and(inArray(supplyStores.id, storeIds), eq(supplyStores.isActive, true)))
      : Promise.resolve([] as any[]),
    locationIds.length > 0
      ? db
          .select()
          .from(supplyStoreLocations)
          .where(and(inArray(supplyStoreLocations.id, locationIds), eq(supplyStoreLocations.isActive, true)))
      : Promise.resolve([] as any[]),
  ]);

  const storeById = new Map((stores as any[]).map((row: any) => [String(row.id), row]));
  const locationById = new Map((locations as any[]).map((row: any) => [String(row.id), row]));

  const buyerLat = Number(params.buyerRestaurant?.latitude);
  const buyerLon = Number(params.buyerRestaurant?.longitude);
  const buyerState = String(params.buyerRestaurant?.state || "").trim();
  const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);
  const maxRadius = Math.max(1, Number(params.maxRadiusMiles || 25) || 25);

  return (priceRows as any[])
    .map((price: any) => {
      const store = storeById.get(String(price.storeId || ""));
      if (!store) return null;
      const location = price.storeLocationId
        ? locationById.get(String(price.storeLocationId || "")) || null
        : null;

      if (buyerState) {
        const locationState = String(location?.state || "").trim();
        if (locationState && locationState !== buyerState) {
          return null;
        }
      }

      const lat = Number(location?.latitude);
      const lon = Number(location?.longitude);
      const distanceMiles =
        hasBuyerCoords && Number.isFinite(lat) && Number.isFinite(lon)
          ? haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon })
          : null;

      if (distanceMiles !== null && distanceMiles > maxRadius) return null;

      return {
        unitPriceCents: Number(price.unitPriceCents || 0),
        observedAt: price.observedAt,
        storeId: String(store.id),
        storeName: String(store.name || "Unknown store"),
        storeLocationId: location ? String(location.id) : null,
        storeCity: location?.city ? String(location.city) : null,
        storeState: location?.state ? String(location.state) : null,
        distanceMiles,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (a.unitPriceCents !== b.unitPriceCents) return a.unitPriceCents - b.unitPriceCents;
      return new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime();
    });
}

export async function runSupplyMarketIntelCron() {
  const now = new Date();
  const minTriggerGapMs = 12 * 60 * 60 * 1000;

  const activeWatches = await db
    .select()
    .from(supplyPriceWatches)
    .where(eq(supplyPriceWatches.isActive, true))
    .orderBy(desc(supplyPriceWatches.updatedAt))
    .limit(600);

  if (activeWatches.length === 0) {
    return { ok: true, watches: 0, alertsCreated: 0, snapshotsUpserted: 0 };
  }

  const buyerIds = Array.from(
    new Set(
      (activeWatches as any[])
        .map((watch) => String(watch.buyerRestaurantId || "").trim())
        .filter(Boolean),
    ),
  );
  const buyerRestaurants =
    buyerIds.length > 0
      ? await db.select().from(restaurants).where(inArray(restaurants.id, buyerIds))
      : [];
  const buyerById = new Map((buyerRestaurants as any[]).map((row: any) => [String(row.id), row]));

  let alertsCreated = 0;
  let snapshotsUpserted = 0;

  for (const watch of activeWatches as any[]) {
    const buyerRestaurant = watch.buyerRestaurantId
      ? buyerById.get(String(watch.buyerRestaurantId)) || null
      : null;
    const offers = await getLocalizedOffers({
      itemKey: String(watch.itemKey || ""),
      itemName: String(watch.itemName || ""),
      buyerRestaurant,
      maxRadiusMiles: Number(watch.maxRadiusMiles || 25),
    });
    if (offers.length === 0) continue;

    const prices = offers
      .map((offer: any) => Number(offer.unitPriceCents || 0))
      .filter((value: number) => Number.isFinite(value) && value >= 0)
      .sort((a: number, b: number) => a - b);
    if (prices.length === 0) continue;

    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];
    const medianPrice =
      prices.length % 2 === 0
        ? Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
        : prices[Math.floor(prices.length / 2)];

    const areaKey = buyerRestaurant?.state
      ? `state:${String(buyerRestaurant.state).trim()}`
      : "global";

    await db
      .insert(supplyPriceDailySnapshots)
      .values({
        itemKey: String(watch.itemKey || ""),
        itemName: String(watch.itemName || ""),
        areaKey,
        snapshotDay: toDayKey(now),
        minPriceCents: minPrice,
        medianPriceCents: medianPrice,
        maxPriceCents: maxPrice,
        sampleCount: prices.length,
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
          sampleCount: prices.length,
          updatedAt: now,
        } as any,
      });
    snapshotsUpserted += 1;

    const targetPriceCents =
      watch.targetPriceCents === null || watch.targetPriceCents === undefined
        ? null
        : Number(watch.targetPriceCents);
    const best = offers[0] || null;
    const targetMet =
      targetPriceCents !== null && best
        ? Number(best.unitPriceCents) <= targetPriceCents
        : false;

    if (!targetMet) continue;

    const lastTriggeredAt = watch.lastTriggeredAt ? new Date(watch.lastTriggeredAt) : null;
    const stale = !lastTriggeredAt || now.getTime() - lastTriggeredAt.getTime() > minTriggerGapMs;
    if (!stale) continue;

    const alertMessage = `${watch.itemName} hit your target at $${(
      Number(best.unitPriceCents || 0) / 100
    ).toFixed(2)} (${best.storeName}).`;

    await db.insert(supplyPriceAlerts).values({
      watchId: String(watch.id),
      userId: String(watch.userId),
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

    alertsCreated += 1;
  }

  // LISA-compatible summary claim for lane consumers.
  await storage.emitClaim({
    app: "mealscout",
    source: "scheduler",
    claimType: "supply_market_lane_update",
    subjectType: "supply_market",
    subjectId: "global",
    actorType: "system",
    actorId: "supply_market_intel_cron",
    claimValue: {
      watches: activeWatches.length,
      alertsCreated,
      snapshotsUpserted,
      generatedAt: now.toISOString(),
      lanes: {
        alerts: "mealscout:supply_market:price_alert:item",
        snapshots: "mealscout:supply_market:price_snapshot:item",
        watches: "mealscout:supply_market:price_watch:item",
      },
    },
    confidence: 1,
  });

  return {
    ok: true,
    watches: activeWatches.length,
    alertsCreated,
    snapshotsUpserted,
    generatedAt: now.toISOString(),
  };
}

export async function getSupplyMarketDataLanes(params?: { sinceHours?: number; limit?: number }) {
  const sinceHours = Math.max(1, Number(params?.sinceHours || 24) || 24);
  const limit = Math.max(10, Math.min(1000, Number(params?.limit || 300) || 300));
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const [alerts, snapshots, watches] = await Promise.all([
    db
      .select()
      .from(supplyPriceAlerts)
      .where(gte(supplyPriceAlerts.createdAt, since))
      .orderBy(desc(supplyPriceAlerts.createdAt))
      .limit(limit),
    db
      .select()
      .from(supplyPriceDailySnapshots)
      .where(gte(supplyPriceDailySnapshots.updatedAt, since))
      .orderBy(desc(supplyPriceDailySnapshots.updatedAt))
      .limit(limit),
    db
      .select()
      .from(supplyPriceWatches)
      .where(and(eq(supplyPriceWatches.isActive, true), gte(supplyPriceWatches.updatedAt, since)))
      .orderBy(desc(supplyPriceWatches.updatedAt))
      .limit(limit),
  ]);

  const laneRecords = [
    ...(alerts as any[]).map((row: any) => ({
      id: `supply-alert:${row.id}`,
      lane: "mealscout:supply_market:price_alert:item",
      laneFamily: "supply_market",
      signalType: "price_alert",
      itemKey: row.itemKey,
      itemName: row.itemName,
      areaKey: row.storeState ? `state:${String(row.storeState).trim()}` : "global",
      valuePrimary: Number(row.observedPriceCents || 0),
      valueSecondary: row.baselinePriceCents === null ? null : Number(row.baselinePriceCents),
      source: row.storeName || "market",
      createdAt: row.createdAt,
      payload: {
        message: row.message,
        storeName: row.storeName,
        storeCity: row.storeCity,
        storeState: row.storeState,
      },
    })),
    ...(snapshots as any[]).map((row: any) => ({
      id: `supply-snapshot:${row.id}`,
      lane: "mealscout:supply_market:price_snapshot:item",
      laneFamily: "supply_market",
      signalType: "price_snapshot",
      itemKey: row.itemKey,
      itemName: row.itemName,
      areaKey: row.areaKey,
      valuePrimary: row.medianPriceCents === null ? null : Number(row.medianPriceCents),
      valueSecondary: row.minPriceCents === null ? null : Number(row.minPriceCents),
      source: "snapshot",
      createdAt: row.updatedAt,
      payload: {
        snapshotDay: row.snapshotDay,
        minPriceCents: row.minPriceCents,
        medianPriceCents: row.medianPriceCents,
        maxPriceCents: row.maxPriceCents,
        sampleCount: row.sampleCount,
      },
    })),
    ...(watches as any[]).map((row: any) => ({
      id: `supply-watch:${row.id}`,
      lane: "mealscout:supply_market:price_watch:item",
      laneFamily: "supply_market",
      signalType: "price_watch",
      itemKey: row.itemKey,
      itemName: row.itemName,
      areaKey: row.buyerRestaurantId ? `restaurant:${row.buyerRestaurantId}` : "global",
      valuePrimary: row.targetPriceCents === null ? null : Number(row.targetPriceCents),
      valueSecondary: Number(row.maxRadiusMiles || 25),
      source: "watch",
      createdAt: row.updatedAt,
      payload: {
        buyerRestaurantId: row.buyerRestaurantId,
        maxRadiusMiles: row.maxRadiusMiles,
        lastTriggeredAt: row.lastTriggeredAt,
      },
    })),
  ]
    .filter((row) => row.createdAt)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const laneCounts = laneRecords.reduce((acc, row: any) => {
    acc[row.lane] = (acc[row.lane] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    generatedAt: new Date().toISOString(),
    sinceHours,
    total: laneRecords.length,
    laneCounts,
    lanes: laneRecords,
  };
}
