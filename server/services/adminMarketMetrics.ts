import { and, eq, gte } from "drizzle-orm";

import { db } from "../db";
import {
  dealClaims,
  deals,
  marketCounties,
  marketEntities,
  marketMetrics,
  pickupOrders,
  requestLogs,
  restaurantSubmissions,
  restaurants,
  reviews,
  searchQueryEvents,
  suppliers,
  userAddresses,
  users,
} from "@shared/schema";

const TIMEFRAME_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

export type MarketHeatmapTimeframe = keyof typeof TIMEFRAME_DAYS;

const normalizeState = (value: unknown) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);

const titleCase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const slug = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const marketKeyFromLocation = (input: {
  countyFips?: unknown;
  countyName?: unknown;
  city?: unknown;
  state?: unknown;
}) => {
  const rawFips = String(input.countyFips || "").trim();
  if (/^\d{5}$/.test(rawFips)) {
    return {
      countyFips: rawFips,
      countyName: titleCase(String(input.countyName || "Unknown County")),
      stateCode: normalizeState(input.state),
      isFallback: false,
    };
  }

  const stateCode = normalizeState(input.state);
  const countyName = titleCase(
    String(input.countyName || input.city || "Unknown Market"),
  );
  const fallbackKey = `${stateCode || "US"}-${slug(countyName) || "unknown"}`;

  return {
    countyFips: `MS-${fallbackKey}`,
    countyName: input.countyName
      ? countyName
      : `${countyName || "Unknown"} market`,
    stateCode,
    isFallback: true,
  };
};

const metricKeyForWindow = (base: string, timeframe: MarketHeatmapTimeframe) =>
  `${base}_${TIMEFRAME_DAYS[timeframe]}d`;

async function ensureCounty(row: {
  countyFips: string;
  countyName: string;
  stateCode: string;
  isFallback?: boolean;
}) {
  await db
    .insert(marketCounties)
    .values({
      countyFips: row.countyFips,
      countyName: row.countyName || "Unknown market",
      stateCode: row.stateCode || "US",
      metadata: { source: row.isFallback ? "city_state_fallback" : "fips" },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: marketCounties.countyFips,
      set: {
        countyName: row.countyName || "Unknown market",
        stateCode: row.stateCode || "US",
        updatedAt: new Date(),
      },
    });
}

async function upsertMetric(
  countyFips: string,
  metricKey: string,
  metricValue: number,
  timeframe: MarketHeatmapTimeframe,
) {
  await db
    .insert(marketMetrics)
    .values({
      countyFips,
      metricKey,
      metricValue: Math.max(0, Math.round(metricValue || 0)),
      timeframe,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        marketMetrics.countyFips,
        marketMetrics.metricKey,
        marketMetrics.timeframe,
      ],
      set: {
        metricValue: Math.max(0, Math.round(metricValue || 0)),
        updatedAt: new Date(),
      },
    });
}

type Bucket = {
  countyFips: string;
  countyName: string;
  stateCode: string;
  isFallback: boolean;
  metrics: Record<string, number>;
};

const addMetric = (
  buckets: Map<string, Bucket>,
  location: Parameters<typeof marketKeyFromLocation>[0],
  metricKey: string,
  delta = 1,
) => {
  const market = marketKeyFromLocation(location);
  const existing =
    buckets.get(market.countyFips) ||
    ({
      ...market,
      metrics: {},
    } satisfies Bucket);
  existing.metrics[metricKey] = (existing.metrics[metricKey] || 0) + delta;
  buckets.set(market.countyFips, existing);
};

export async function refreshMarketMetrics(
  timeframe: MarketHeatmapTimeframe = "30d",
) {
  const days = TIMEFRAME_DAYS[timeframe] || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const buckets = new Map<string, Bucket>();

  const restaurantRows = await db.select().from(restaurants);
  for (const restaurant of restaurantRows) {
    const location = { city: restaurant.city, state: restaurant.state };
    addMetric(buckets, location, "restaurants_total");
    if (restaurant.isVerified) addMetric(buckets, location, "restaurants_verified");
    if (restaurant.claimedFromImportId || restaurant.isVerified) {
      addMetric(buckets, location, "restaurants_claimed");
    }
  }

  const supplierRows = await db.select().from(suppliers);
  for (const supplier of supplierRows) {
    addMetric(
      buckets,
      { city: supplier.city, state: supplier.state },
      "vendors_total",
    );
  }

  const addressRows = await db
    .select({
      city: userAddresses.city,
      state: userAddresses.state,
      userId: userAddresses.userId,
    })
    .from(userAddresses)
    .where(gte(userAddresses.createdAt, since));
  for (const address of addressRows) {
    addMetric(buckets, address, "users_total");
    addMetric(buckets, address, "diners_total");
  }

  const orderRows = await db
    .select({ city: restaurants.city, state: restaurants.state })
    .from(pickupOrders)
    .innerJoin(restaurants, eq(pickupOrders.restaurantId, restaurants.id))
    .where(gte(pickupOrders.createdAt, since));
  for (const row of orderRows) {
    addMetric(buckets, row, metricKeyForWindow("orders", timeframe));
  }

  const reviewRows = await db
    .select({ city: restaurants.city, state: restaurants.state })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(gte(reviews.createdAt, since));
  for (const row of reviewRows) {
    addMetric(buckets, row, metricKeyForWindow("reviews", timeframe));
  }

  const claimRows = await db
    .select({ city: restaurants.city, state: restaurants.state })
    .from(dealClaims)
    .innerJoin(deals, eq(dealClaims.dealId, deals.id))
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .where(gte(dealClaims.claimedAt, since));
  for (const row of claimRows) {
    addMetric(buckets, row, metricKeyForWindow("claims", timeframe));
  }

  const submissionRows = await db
    .select()
    .from(restaurantSubmissions)
    .where(gte(restaurantSubmissions.createdAt, since));
  for (const row of submissionRows) {
    addMetric(
      buckets,
      { countyName: row.county, city: row.county, state: row.state },
      "unmet_demand_score",
    );
  }

  const searchRows = await db
    .select()
    .from(searchQueryEvents)
    .where(gte(searchQueryEvents.createdAt, since));
  if (searchRows.length) {
    addMetric(
      buckets,
      { city: "Unknown", state: "US" },
      metricKeyForWindow("searches", timeframe),
      searchRows.length,
    );
  }

  const menuViewRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
    })
    .from(requestLogs)
    .innerJoin(restaurants, eq(requestLogs.entityId, restaurants.id))
    .where(
      and(
        gte(requestLogs.createdAt, since),
        eq(requestLogs.entityType, "restaurant"),
        eq(requestLogs.surface, "online_menu"),
      ),
    );
  for (const row of menuViewRows) {
    addMetric(buckets, row, metricKeyForWindow("menu_views", timeframe));
  }

  const entityRows = await db.select().from(marketEntities);
  for (const entity of entityRows) {
    addMetric(
      buckets,
      { countyFips: entity.countyFips, countyName: entity.countyFips },
      "market_entities_total",
    );
    if (entity.entityType === "delivery_partner") {
      addMetric(
        buckets,
        { countyFips: entity.countyFips, countyName: entity.countyFips },
        "delivery_coverage_score",
      );
    }
  }

  for (const bucket of buckets.values()) {
    const restaurantsTotal = bucket.metrics.restaurants_total || 0;
    const verified = bucket.metrics.restaurants_verified || 0;
    const vendorsTotal = bucket.metrics.vendors_total || 0;
    const orders = bucket.metrics[metricKeyForWindow("orders", timeframe)] || 0;
    const demand = bucket.metrics.unmet_demand_score || 0;
    const delivery = bucket.metrics.delivery_coverage_score || 0;
    const coverageScore =
      restaurantsTotal >= 15 && verified >= 5 && (orders > 0 || delivery > 0)
        ? 2
        : restaurantsTotal > 0 || demand > 0 || vendorsTotal > 0
          ? 1
          : 0;

    bucket.metrics.market_coverage_status = coverageScore;
    bucket.metrics.delivery_coverage_score = delivery;
  }

  for (const bucket of buckets.values()) {
    await ensureCounty(bucket);
    for (const [metricKey, metricValue] of Object.entries(bucket.metrics)) {
      await upsertMetric(bucket.countyFips, metricKey, metricValue, timeframe);
    }
  }

  return {
    timeframe,
    countiesTouched: buckets.size,
    metricsWritten: Array.from(buckets.values()).reduce(
      (sum, bucket) => sum + Object.keys(bucket.metrics).length,
      0,
    ),
  };
}

export async function getStoredMarketMetrics(
  timeframe: MarketHeatmapTimeframe = "30d",
) {
  const rows = await db
    .select({
      county: marketCounties,
      metric: marketMetrics,
    })
    .from(marketMetrics)
    .innerJoin(
      marketCounties,
      eq(marketMetrics.countyFips, marketCounties.countyFips),
    )
    .where(eq(marketMetrics.timeframe, timeframe));

  const byCounty = new Map<string, any>();
  for (const row of rows) {
    const existing =
      byCounty.get(row.county.countyFips) ||
      ({
        ...row.county,
        metrics: {},
      } as any);
    existing.metrics[row.metric.metricKey] = row.metric.metricValue;
    existing.updatedAt = row.metric.updatedAt;
    byCounty.set(row.county.countyFips, existing);
  }

  return Array.from(byCounty.values()).sort(
    (a, b) =>
      Number(b.metrics.users_total || 0) +
      Number(b.metrics.restaurants_total || 0) -
      (Number(a.metrics.users_total || 0) +
        Number(a.metrics.restaurants_total || 0)),
  );
}
