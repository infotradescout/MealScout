import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "../db";
import {
  dealClaims,
  deals,
  marketCounties,
  marketEntities,
  marketMetrics,
  pickupOrders,
  privateChefLeads,
  requestLogs,
  restaurantSubmissions,
  restaurants,
  reviews,
  searchQueryEvents,
  suppliers,
  supplyStoreLocations,
  truckImportListings,
  userAddresses,
} from "@shared/schema";

const TIMEFRAME_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

const STATE_BY_FIPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

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

const stateFromFips = (countyFips: string) => STATE_BY_FIPS[countyFips.slice(0, 2)];

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
      stateCode: normalizeState(input.state) || stateFromFips(rawFips) || "US",
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

async function ensureCounties(rows: Bucket[]) {
  if (!rows.length) return;
  await db
    .insert(marketCounties)
    .values(
      rows.map((row) => ({
        countyFips: row.countyFips,
        countyName: row.countyName || "Unknown market",
        stateCode: row.stateCode || "US",
        metadata: { source: row.isFallback ? "city_state_fallback" : "fips" },
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: marketCounties.countyFips,
      set: {
        countyName: sql`excluded.county_name`,
        stateCode: sql`excluded.state_code`,
        metadata: sql`excluded.metadata`,
        updatedAt: new Date(),
      },
    });
}

async function insertMetrics(rows: {
  countyFips: string;
  metricKey: string;
  metricValue: number;
  timeframe: MarketHeatmapTimeframe;
}[]) {
  if (!rows.length) return;
  const deduped = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    deduped.set(`${row.countyFips}:${row.metricKey}:${row.timeframe}`, row);
  }
  const uniqueRows = Array.from(deduped.values());
  const chunkSize = 500;
  for (let index = 0; index < uniqueRows.length; index += chunkSize) {
    const chunk = uniqueRows.slice(index, index + chunkSize);
    await db
      .insert(marketMetrics)
      .values(
        chunk.map((row) => ({
          countyFips: row.countyFips,
          metricKey: row.metricKey,
          metricValue: Math.max(0, Math.round(row.metricValue || 0)),
          timeframe: row.timeframe,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [
          marketMetrics.countyFips,
          marketMetrics.metricKey,
          marketMetrics.timeframe,
        ],
        set: {
          metricValue: sql`excluded.metric_value`,
          updatedAt: new Date(),
        },
      });
  }
}

type Bucket = {
  countyFips: string;
  countyName: string;
  stateCode: string;
  isFallback: boolean;
  metrics: Record<string, number>;
  unique: Record<string, Set<string>>;
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
      unique: {},
    } satisfies Bucket);
  existing.metrics[metricKey] = (existing.metrics[metricKey] || 0) + delta;
  buckets.set(market.countyFips, existing);
};

const addUniqueMetric = (
  buckets: Map<string, Bucket>,
  location: Parameters<typeof marketKeyFromLocation>[0],
  metricKey: string,
  uniqueValue: unknown,
) => {
  const value = String(uniqueValue || "").trim();
  if (!value) return addMetric(buckets, location, metricKey);
  const market = marketKeyFromLocation(location);
  const existing =
    buckets.get(market.countyFips) ||
    ({
      ...market,
      metrics: {},
      unique: {},
    } satisfies Bucket);
  existing.unique[metricKey] ||= new Set<string>();
  existing.unique[metricKey].add(value);
  existing.metrics[metricKey] = existing.unique[metricKey].size;
  buckets.set(market.countyFips, existing);
};

const metricLocation = (
  countyMap: Map<string, { countyName: string; stateCode: string }>,
  countyFips: string,
) => {
  const county = countyMap.get(countyFips);
  return {
    countyFips,
    countyName: county?.countyName || countyFips,
    state: county?.stateCode || "US",
  };
};

const comparisonTimeframeFor = (
  timeframe: MarketHeatmapTimeframe,
): MarketHeatmapTimeframe | null =>
  timeframe === "7d" ? "30d" : timeframe === "30d" ? "90d" : null;

const baseMetricForWindow = (metricKey: string, timeframe: MarketHeatmapTimeframe) => {
  const suffix = `_${TIMEFRAME_DAYS[timeframe]}d`;
  return metricKey.endsWith(suffix) ? metricKey.slice(0, -suffix.length) : null;
};

export async function refreshMarketMetrics(
  timeframe: MarketHeatmapTimeframe = "30d",
) {
  const days = TIMEFRAME_DAYS[timeframe] || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const buckets = new Map<string, Bucket>();
  const countyRows = await db.select().from(marketCounties);
  const countyMap = new Map<string, { countyName: string; stateCode: string }>(
    countyRows.map((county: any) => [
      county.countyFips,
      { countyName: county.countyName, stateCode: county.stateCode },
    ]),
  );

  const restaurantRows = await db.select().from(restaurants);
  for (const restaurant of restaurantRows) {
    const location = {
      countyFips: restaurant.countyFips,
      countyName: restaurant.countyName,
      city: restaurant.city,
      state: restaurant.state,
    };
    addMetric(buckets, location, "restaurants_total");
    addMetric(buckets, location, "platform_businesses_total");
    addMetric(buckets, location, "businesses_total");
    if (restaurant.isActive) addMetric(buckets, location, "active_businesses_total");
    if (restaurant.isVerified) addMetric(buckets, location, "restaurants_verified");
    if (restaurant.claimedFromImportId || restaurant.isVerified) {
      addMetric(buckets, location, "restaurants_claimed");
    }
    const businessType = String(restaurant.businessType || "").toLowerCase();
    if (businessType === "food_truck" || restaurant.isFoodTruck) {
      addMetric(buckets, location, "food_trucks_total");
    }
    if (businessType === "bar") addMetric(buckets, location, "bars_total");
    if (businessType === "caterer") addMetric(buckets, location, "caterers_total");
    if (businessType === "private_chef") {
      addMetric(buckets, location, "private_chefs_total");
    }
  }

  const supplierRows = await db.select().from(suppliers);
  for (const supplier of supplierRows) {
    addMetric(
      buckets,
      {
        countyFips: supplier.countyFips,
        countyName: supplier.countyName,
        city: supplier.city,
        state: supplier.state,
      },
      "vendors_total",
    );
    addMetric(
      buckets,
      {
        countyFips: supplier.countyFips,
        countyName: supplier.countyName,
        city: supplier.city,
        state: supplier.state,
      },
      "businesses_total",
    );
    if (supplier.isActive) {
      addMetric(
        buckets,
        {
          countyFips: supplier.countyFips,
          countyName: supplier.countyName,
          city: supplier.city,
          state: supplier.state,
        },
        "active_businesses_total",
      );
    }
  }

  const supplyLocationRows = await db.select().from(supplyStoreLocations);
  for (const location of supplyLocationRows) {
    const rowLocation = {
      countyFips: location.countyFips,
      countyName: location.countyName,
      city: location.city,
      state: location.state,
    };
    addMetric(buckets, rowLocation, "supply_locations_total");
    addMetric(buckets, rowLocation, "vendors_total");
    addMetric(buckets, rowLocation, "businesses_total");
    if (location.isActive) addMetric(buckets, rowLocation, "active_businesses_total");
  }

  const importRows = await db.select().from(truckImportListings);
  for (const listing of importRows) {
    const location = {
      countyFips: listing.countyFips,
      countyName: listing.countyName,
      city: listing.city,
      state: listing.state,
    };
    addMetric(buckets, location, "imported_trucks_total");
    if (String(listing.status || "") !== "claimed") {
      addMetric(buckets, location, "unclaimed_imported_trucks_total");
    }
  }

  const allAddressRows = await db
    .select({
      city: userAddresses.city,
      state: userAddresses.state,
      countyFips: userAddresses.countyFips,
      countyName: userAddresses.countyName,
      userId: userAddresses.userId,
      createdAt: userAddresses.createdAt,
    })
    .from(userAddresses);
  const userLocationById = new Map<string, (typeof allAddressRows)[number]>();
  for (const address of allAddressRows) {
    if (address.userId && !userLocationById.has(address.userId)) {
      userLocationById.set(address.userId, address);
    }
    addUniqueMetric(buckets, address, "users_total", address.userId);
    addUniqueMetric(buckets, address, "diners_total", address.userId);
    if (address.createdAt && address.createdAt >= since) {
      addUniqueMetric(
        buckets,
        address,
        metricKeyForWindow("new_users", timeframe),
        address.userId,
      );
    }
  }

  const orderRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
      countyFips: restaurants.countyFips,
      countyName: restaurants.countyName,
      totalCents: pickupOrders.totalCents,
    })
    .from(pickupOrders)
    .innerJoin(restaurants, eq(pickupOrders.restaurantId, restaurants.id))
    .where(gte(pickupOrders.createdAt, since));
  for (const row of orderRows) {
    addMetric(buckets, row, metricKeyForWindow("orders", timeframe));
    addMetric(
      buckets,
      row,
      metricKeyForWindow("order_revenue_cents", timeframe),
      Number(row.totalCents || 0),
    );
  }

  const reviewRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
      countyFips: restaurants.countyFips,
      countyName: restaurants.countyName,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(gte(reviews.createdAt, since));
  for (const row of reviewRows) {
    addMetric(buckets, row, metricKeyForWindow("reviews", timeframe));
  }

  const claimRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
      countyFips: restaurants.countyFips,
      countyName: restaurants.countyName,
    })
    .from(dealClaims)
    .innerJoin(deals, eq(dealClaims.dealId, deals.id))
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .where(gte(dealClaims.claimedAt, since));
  for (const row of claimRows) {
    addMetric(buckets, row, metricKeyForWindow("claims", timeframe));
  }

  const privateChefLeadRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
      countyFips: restaurants.countyFips,
      countyName: restaurants.countyName,
    })
    .from(privateChefLeads)
    .innerJoin(restaurants, eq(privateChefLeads.chefRestaurantId, restaurants.id))
    .where(gte(privateChefLeads.createdAt, since));
  for (const row of privateChefLeadRows) {
    addMetric(buckets, row, metricKeyForWindow("private_chef_leads", timeframe));
  }

  const submissionRows = await db
    .select()
    .from(restaurantSubmissions)
    .where(gte(restaurantSubmissions.createdAt, since));
  for (const row of submissionRows) {
    addMetric(
      buckets,
      {
        countyFips: row.countyFips,
        countyName: row.countyName || row.county,
        city: row.county,
        state: row.state,
      },
      "unmet_demand_score",
    );
  }

  const searchRows = await db
    .select()
    .from(searchQueryEvents)
    .where(gte(searchQueryEvents.createdAt, since));
  for (const search of searchRows) {
    const userLocation = search.userId ? userLocationById.get(search.userId) : null;
    addMetric(
      buckets,
      userLocation || { city: "Unknown", state: "US" },
      metricKeyForWindow("searches", timeframe),
    );
  }

  const menuViewRows = await db
    .select({
      city: restaurants.city,
      state: restaurants.state,
      countyFips: restaurants.countyFips,
      countyName: restaurants.countyName,
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
    const location = metricLocation(countyMap, entity.countyFips);
    addMetric(buckets, location, "market_entities_total");
    addMetric(buckets, location, `${entity.entityType}_total`);
    if (["active", "warm", "prospect"].includes(String(entity.status || ""))) {
      addMetric(buckets, location, "relationship_pipeline_total");
    }
    if (entity.entityType === "delivery_partner") {
      addMetric(buckets, location, "delivery_coverage_score");
    }
    if (entity.entityType === "market_manager" || entity.entityType === "local_operator") {
      addMetric(buckets, location, "operator_coverage_score");
    }
  }

  for (const bucket of buckets.values()) {
    const restaurantsTotal = bucket.metrics.restaurants_total || 0;
    const verified = bucket.metrics.restaurants_verified || 0;
    const vendorsTotal = bucket.metrics.vendors_total || 0;
    const orders = bucket.metrics[metricKeyForWindow("orders", timeframe)] || 0;
    const searches = bucket.metrics[metricKeyForWindow("searches", timeframe)] || 0;
    const menuViews = bucket.metrics[metricKeyForWindow("menu_views", timeframe)] || 0;
    const reviews = bucket.metrics[metricKeyForWindow("reviews", timeframe)] || 0;
    const claims = bucket.metrics[metricKeyForWindow("claims", timeframe)] || 0;
    const demand = bucket.metrics.unmet_demand_score || 0;
    const delivery = bucket.metrics.delivery_coverage_score || 0;
    const operatorCoverage = bucket.metrics.operator_coverage_score || 0;
    const relationshipPipeline = bucket.metrics.relationship_pipeline_total || 0;
    const importedTrucks = bucket.metrics.imported_trucks_total || 0;
    bucket.metrics[metricKeyForWindow("engagement", timeframe)] =
      searches + menuViews + reviews + claims + orders;
    bucket.metrics.unmet_demand_score = demand + Math.ceil(searches / 10);
    const coverageScore =
      restaurantsTotal >= 15 &&
      verified >= 5 &&
      (orders > 0 || delivery > 0 || operatorCoverage > 0)
        ? 2
        : restaurantsTotal > 0 ||
            bucket.metrics.unmet_demand_score > 0 ||
            vendorsTotal > 0 ||
            relationshipPipeline > 0 ||
            importedTrucks > 0
          ? 1
          : 0;

    bucket.metrics.market_coverage_status = coverageScore;
    bucket.metrics.delivery_coverage_score = delivery;
  }

  await db.delete(marketMetrics).where(eq(marketMetrics.timeframe, timeframe));

  const bucketRows = Array.from(buckets.values());
  await ensureCounties(bucketRows);
  await insertMetrics(
    bucketRows.flatMap((bucket) =>
      Object.entries(bucket.metrics).map(([metricKey, metricValue]) => ({
        countyFips: bucket.countyFips,
        metricKey,
        metricValue,
        timeframe,
      })),
    ),
  );

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
  const comparisonTimeframe = comparisonTimeframeFor(timeframe);
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
        trends: {},
      } as any);
    existing.metrics[row.metric.metricKey] = row.metric.metricValue;
    existing.updatedAt = row.metric.updatedAt;
    byCounty.set(row.county.countyFips, existing);
  }

  if (comparisonTimeframe) {
    const comparisonRows = await db
      .select()
      .from(marketMetrics)
      .where(eq(marketMetrics.timeframe, comparisonTimeframe));
    const comparisonByCounty = new Map<string, Record<string, number>>();
    for (const row of comparisonRows) {
      const existing = comparisonByCounty.get(row.countyFips) || {};
      existing[row.metricKey] = row.metricValue;
      comparisonByCounty.set(row.countyFips, existing);
    }
    const currentDays = TIMEFRAME_DAYS[timeframe];
    const comparisonDays = TIMEFRAME_DAYS[comparisonTimeframe];
    for (const county of byCounty.values()) {
      for (const [metricKey, currentValue] of Object.entries(
        county.metrics as Record<string, number>,
      )) {
        const baseMetric = baseMetricForWindow(metricKey, timeframe);
        if (!baseMetric) continue;
        const comparisonKey = metricKeyForWindow(baseMetric, comparisonTimeframe);
        const comparisonValue =
          comparisonByCounty.get(county.countyFips)?.[comparisonKey] || 0;
        const baseline = (comparisonValue * currentDays) / comparisonDays;
        const delta = Number(currentValue || 0) - baseline;
        county.trends[metricKey] = {
          current: Number(currentValue || 0),
          baseline: Math.round(baseline),
          delta: Math.round(delta),
          percent: baseline > 0 ? Math.round((delta / baseline) * 100) : null,
          comparisonTimeframe,
        };
      }
    }
  }

  return Array.from(byCounty.values()).sort(
    (a, b) =>
      Number(b.metrics.users_total || 0) +
      Number(b.metrics.restaurants_total || 0) -
      (Number(a.metrics.users_total || 0) +
        Number(a.metrics.restaurants_total || 0)),
  );
}
