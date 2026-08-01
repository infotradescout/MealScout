import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

import express from "express";

import {
  actionApiFindDealsResultSchema,
  actionApiFindRestaurantsResultSchema,
  actionApiGetFoodTrucksResultSchema,
  actionApiGetParkingPassSpotsResultSchema,
  actionApiGetRestaurantDetailsResultSchema,
  actionApiParkingPassSpotListResultSchema,
  actionApiParkingPassSpotSchema,
  actionApiPublicDealListResultSchema,
  actionApiPublicDealSchema,
  actionApiPublicFoodTruckListResultSchema,
  actionApiPublicFoodTruckSchema,
  actionApiPublicRestaurantDetailResultSchema,
  actionApiPublicRestaurantListResultSchema,
  actionApiPublicReadFailureSchema,
  actionApiPublicRestaurantSchema,
  isActionApiPublicBusinessEligible,
  toActionApiParkingPassSpot,
  toActionApiParkingPassSpotListResult,
  toActionApiPublicDeal,
  toActionApiPublicDealListResult,
  toActionApiPublicFoodTruck,
  toActionApiPublicFoodTruckListResult,
  toActionApiPublicRestaurant,
  toActionApiPublicRestaurantDetailResult,
  toActionApiPublicRestaurantListResult,
} from "../server/publicProfiles/actionApiPublicReadProjection";
import {
  toPublicRestaurantProfile,
  toPublicTruckProfile,
} from "../server/publicProfiles";
import {
  ACTION_API_PUBLIC_READ_ACTIONS,
  ACTION_API_USER_SCOPED_ACTIONS,
  ACTION_API_WRITE_CONTAINMENT_CODE,
} from "../server/security/actionApiContainment";

const exactKeys = (
  actual: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) => {
  assert.deepEqual(
    Object.keys(actual).sort(),
    [...expected].sort(),
    `${label} must expose exactly its allowlisted keys`,
  );
};

const assertNoSentinel = (value: unknown, label: string) => {
  assert.equal(
    JSON.stringify(value).includes("SECRET_"),
    false,
    `${label} must not retain a source sentinel`,
  );
};

const privateSentinels = {
  claimedFromImportId: "SECRET_claimedFromImportId",
  insuranceVerifiedAt: "SECRET_insuranceVerifiedAt",
  insuranceExpiresAt: "SECRET_insuranceExpiresAt",
  insuranceVerifiedByUserId: "SECRET_insuranceVerifiedByUserId",
  socialAutopostSettings: "SECRET_socialAutopostSettings",
  lockedPriceCents: "SECRET_lockedPriceCents",
  priceLockDate: "SECRET_priceLockDate",
  priceLockReason: "SECRET_priceLockReason",
  createdAt: "SECRET_createdAt",
  updatedAt: "SECRET_updatedAt",
  ownerId: "SECRET_ownerId",
  promoCode: "SECRET_promoCode",
  rawData: "SECRET_rawData",
  sessionId: "SECRET_sessionId",
  isAiGenerated: "SECRET_isAiGenerated",
  currentUses: "SECRET_currentUses",
} as const;

const assertNoPrivateSentinels = (value: unknown, label: string) => {
  const serialized = JSON.stringify(value);
  for (const [key, sentinel] of Object.entries(privateSentinels)) {
    assert.equal(
      serialized.includes(sentinel),
      false,
      `${label} must recursively remove ${key}`,
    );
  }
};

const deal = toActionApiPublicDeal({
  ...privateSentinels,
  id: "deal-1",
  restaurantId: "restaurant-1",
  title: "Lunch special",
  description: "Soup and sandwich",
  dealType: "fixed",
  discountValue: "5.00",
  imageUrl: "https://images.example/deal.jpg",
  startDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: null,
  startTime: "11:00",
  endTime: "14:00",
  availableDuringBusinessHours: false,
  isOngoing: true,
});
const dealKeys = [
  "id",
  "restaurantId",
  "title",
  "description",
  "dealType",
  "discountValue",
  "imageUrl",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "availableDuringBusinessHours",
  "isOngoing",
] as const;
exactKeys(deal, dealKeys, "deal");
assertNoSentinel(deal, "deal");
assertNoPrivateSentinels(deal, "deal");
assert.equal(
  actionApiPublicDealSchema.safeParse({ ...deal, currentUses: 9 }).success,
  false,
  "the strict deal schema must reject an unexpected internal counter",
);

const publicRestaurantProfile = toPublicRestaurantProfile({
  row: {
    ...privateSentinels,
    id: "restaurant-1",
    name: "Riverbend Cafe",
    businessType: "restaurant",
    cuisineType: "Cafe, Breakfast",
    description: "Neighborhood breakfast and lunch",
    city: "Pensacola",
    state: "FL",
    logoUrl: "https://images.example/logo.jpg",
    coverImageUrl: "https://images.example/cover.jpg",
    operatingHours: {
      mon: [{ open: "08:00", close: "15:00" }],
    },
    isActive: true,
    isVerified: true,
    phone: "SECRET_phone",
    address: "SECRET_address",
  },
  baseUrl: "https://www.mealscout.us",
  showAddress: false,
  showContact: false,
});
const restaurant = toActionApiPublicRestaurant(publicRestaurantProfile);
const restaurantKeys = [
  "id",
  "name",
  "businessType",
  "cuisineType",
  "description",
  "city",
  "state",
  "logoUrl",
  "coverImageUrl",
  "isFoodTruck",
  "isVerified",
  "operatingHoursSummary",
] as const;
exactKeys(restaurant, restaurantKeys, "restaurant");
assertNoSentinel(restaurant, "restaurant");
assertNoPrivateSentinels(restaurant, "restaurant");
for (const hiddenKey of ["ownerId", "address", "phone", "rawData"]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(restaurant, hiddenKey),
    false,
    `restaurant must omit ${hiddenKey}`,
  );
}
assert.equal(
  actionApiPublicRestaurantSchema.safeParse({
    ...restaurant,
    rawData: { secret: true },
  }).success,
  false,
  "the strict restaurant schema must reject rawData",
);

const legacyTruckRestaurant = toActionApiPublicRestaurant(
  toPublicRestaurantProfile({
    row: {
      id: "legacy-truck-1",
      name: "Legacy Mobile Kitchen",
      businessType: "restaurant",
      isFoodTruck: true,
      isActive: true,
    },
    baseUrl: "https://www.mealscout.us",
    showAddress: false,
    showContact: false,
  }),
);
assert.equal(
  legacyTruckRestaurant.isFoodTruck,
  true,
  "the explicit public select must preserve legacy isFoodTruck classification",
);

const now = new Date();
const publicTruckProfile = toPublicTruckProfile({
  row: {
    ...privateSentinels,
    id: "truck-1",
    name: "River City Tacos",
    businessType: "food_truck",
    cuisineType: "Tacos",
    description: "Tacos on the move",
    city: "Pensacola",
    state: "FL",
    isFoodTruck: true,
    isActive: true,
    isVerified: true,
    mobileOnline: true,
    currentLatitude: "30.4213",
    currentLongitude: "-87.2169",
    lastBroadcastAt: now,
    liveUntilAt: new Date(now.getTime() + 30 * 60_000),
  },
  baseUrl: "https://www.mealscout.us",
  showAddress: false,
  showContact: false,
});
const truck = toActionApiPublicFoodTruck({
  profile: publicTruckProfile,
  distanceKm: 2.5,
});
const truckKeys = [
  ...restaurantKeys,
  "mobileOnline",
  "currentLatitude",
  "currentLongitude",
  "lastBroadcastAt",
  "liveUntilAt",
  "distance",
  "distanceMiles",
  "lat",
  "lng",
  "liveBroadcasting",
  "locationSource",
] as const;
exactKeys(truck, truckKeys, "food truck");
assertNoSentinel(truck, "food truck");
assertNoPrivateSentinels(truck, "food truck");
for (const hiddenKey of ["ownerId", "promoCode", "sessionId", "rawData"]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(truck, hiddenKey),
    false,
    `food truck must omit ${hiddenKey}`,
  );
}
assert.equal(
  actionApiPublicFoodTruckSchema.safeParse({
    ...truck,
    sessionId: "SECRET_sessionId",
  }).success,
  false,
  "the strict food-truck schema must reject sessionId",
);

const parkingSpot = toActionApiParkingPassSpot({
  ...privateSentinels,
  hostId: "host-1",
  type: "parking_pass",
  name: "Downtown host",
  address: "100 Main St",
  city: "Pensacola",
  state: "FL",
  latitude: 30.42,
  longitude: -87.21,
  pricingCents: {
    breakfast: 2000,
    lunch: 2500,
    dinner: 3000,
    daily: 5000,
    weekly: 20000,
    monthly: 60000,
    stripePriceId: "SECRET_stripePriceId",
  },
  maxTrucks: 4,
  startTime: "08:00",
  endTime: "20:00",
  nextDate: "2026-08-02",
  paymentsEnabled: true,
  distanceKm: 1.25,
  coordinatorUserId: "SECRET_coordinatorUserId",
  stripeProductId: "SECRET_stripeProductId",
});
const parkingKeys = [
  "hostId",
  "type",
  "name",
  "address",
  "city",
  "state",
  "latitude",
  "longitude",
  "pricingCents",
  "maxTrucks",
  "startTime",
  "endTime",
  "nextDate",
  "paymentsEnabled",
  "distanceKm",
] as const;
exactKeys(parkingSpot, parkingKeys, "Parking Pass spot");
exactKeys(
  parkingSpot.pricingCents,
  ["breakfast", "lunch", "dinner", "daily", "weekly", "monthly"],
  "Parking Pass pricing",
);
assertNoSentinel(parkingSpot, "Parking Pass spot");
assertNoPrivateSentinels(parkingSpot, "Parking Pass spot");
assert.equal(
  actionApiParkingPassSpotSchema.safeParse({
    ...parkingSpot,
    stripeProductId: "SECRET_stripeProductId",
  }).success,
  false,
  "the strict Parking Pass schema must reject payment-provider ids",
);

const dealList = toActionApiPublicDealListResult([deal]);
const restaurantList = toActionApiPublicRestaurantListResult([restaurant]);
const truckList = toActionApiPublicFoodTruckListResult([truck]);
const parkingList = toActionApiParkingPassSpotListResult([parkingSpot]);
const detail = toActionApiPublicRestaurantDetailResult({
  restaurant,
  activeDeals: [deal],
});
exactKeys(dealList, ["success", "data", "count"], "deal list envelope");
exactKeys(
  restaurantList,
  ["success", "data", "count"],
  "restaurant list envelope",
);
exactKeys(
  truckList,
  ["success", "data", "count"],
  "food-truck list envelope",
);
exactKeys(
  parkingList,
  ["success", "data", "count"],
  "Parking Pass list envelope",
);
exactKeys(detail, ["success", "data"], "restaurant detail envelope");
exactKeys(
  detail.data,
  ["restaurant", "activeDeals", "dealCount"],
  "restaurant detail data",
);
exactKeys(dealList.data[0], dealKeys, "deal list item");
exactKeys(restaurantList.data[0], restaurantKeys, "restaurant list item");
exactKeys(truckList.data[0], truckKeys, "food-truck list item");
exactKeys(parkingList.data[0], parkingKeys, "Parking Pass list item");
exactKeys(
  parkingList.data[0].pricingCents,
  ["breakfast", "lunch", "dinner", "daily", "weekly", "monthly"],
  "Parking Pass list pricing",
);
assertNoPrivateSentinels(
  { dealList, restaurantList, truckList, parkingList, detail },
  "all success envelopes",
);
assert.equal(
  actionApiPublicDealListResultSchema.safeParse({
    ...dealList,
    debug: "SECRET_debug",
  }).success,
  false,
  "strict list envelope must reject top-level widening",
);
assert.equal(
  actionApiParkingPassSpotListResultSchema.safeParse({
    ...parkingList,
    data: [{ ...parkingSpot, internalNotes: "SECRET_internalNotes" }],
  }).success,
  false,
  "strict list envelope must reject nested widening",
);
assert.equal(
  actionApiPublicRestaurantListResultSchema.safeParse({
    ...restaurantList,
    data: [{ ...restaurant, claimedFromImportId: "SECRET_claimedFromImportId" }],
  }).success,
  false,
  "strict restaurant-list envelope must reject nested widening",
);
assert.equal(
  actionApiPublicFoodTruckListResultSchema.safeParse({
    ...truckList,
    data: [{ ...truck, ownerId: "SECRET_ownerId" }],
  }).success,
  false,
  "strict food-truck-list envelope must reject nested widening",
);
assert.equal(
  actionApiPublicRestaurantDetailResultSchema.safeParse({
    ...detail,
    data: {
      ...detail.data,
      restaurant: { ...restaurant, ownerId: "SECRET_ownerId" },
    },
  }).success,
  false,
  "strict detail envelope must reject nested restaurant widening",
);

const publicReadFailure = {
  success: false as const,
  error: "Unable to complete public read",
};
assert.deepEqual(
  actionApiPublicReadFailureSchema.parse(publicReadFailure),
  publicReadFailure,
);
assert.equal(
  actionApiPublicReadFailureSchema.safeParse({
    ...publicReadFailure,
    message: "SECRET_database_driver_message",
  }).success,
  false,
  "the common public failure must reject leaked exception fields",
);
for (const [label, schema, success] of [
  ["FIND_DEALS", actionApiFindDealsResultSchema, dealList],
  ["FIND_RESTAURANTS", actionApiFindRestaurantsResultSchema, restaurantList],
  ["GET_FOOD_TRUCKS", actionApiGetFoodTrucksResultSchema, truckList],
  [
    "GET_PARKING_PASS_SPOTS",
    actionApiGetParkingPassSpotsResultSchema,
    parkingList,
  ],
  [
    "GET_RESTAURANT_DETAILS",
    actionApiGetRestaurantDetailsResultSchema,
    detail,
  ],
] as const) {
  assert.equal(schema.safeParse(success).success, true, `${label} success`);
  assert.equal(
    schema.safeParse(publicReadFailure).success,
    true,
    `${label} strict failure`,
  );
  assert.equal(
    schema.safeParse({ ...publicReadFailure, debug: "SECRET_debug" }).success,
    false,
    `${label} must reject widened failures`,
  );
}

const eligibleBusiness = {
  id: "restaurant-eligible",
  name: "Riverbend Cafe",
  address: "100 Main St",
  phone: "8505550100",
  websiteUrl: "https://riverbend.example",
  cuisineType: "Cafe",
  description: "Neighborhood cafe",
  city: "Pensacola",
  state: "FL",
  isActive: true,
};
assert.equal(isActionApiPublicBusinessEligible(eligibleBusiness), true);
assert.equal(
  isActionApiPublicBusinessEligible({
    ...eligibleBusiness,
    rawData: {
      evidenceQuarantine: {
        active: true,
        decisions: { contact_phone: { status: "accepted" } },
      },
    },
  }),
  false,
  "a quarantined profile remains nonexistent to Action discovery even when one field was accepted",
);
assert.equal(
  isActionApiPublicBusinessEligible({
    ...eligibleBusiness,
    name: "Test Restaurant 1771607433376",
  }),
  false,
  "Scout/search synthetic visibility remains authoritative",
);
assert.equal(
  isActionApiPublicBusinessEligible({ ...eligibleBusiness, isActive: false }),
  false,
  "inactive profiles remain nonexistent",
);

const visibleDealCandidateIds = [
  { dealId: "deal-public", restaurant: eligibleBusiness },
  {
    dealId: "deal-hidden",
    restaurant: {
      ...eligibleBusiness,
      id: "restaurant-hidden",
      rawData: { evidenceQuarantine: { active: true } },
    },
  },
]
  .filter((row) => isActionApiPublicBusinessEligible(row.restaurant))
  .map((row) => row.dealId);
assert.deepEqual(
  visibleDealCandidateIds,
  ["deal-public"],
  "a deal attached to a hidden business must stay absent",
);

const actionSource = readFileSync("server/routes/actionRoutes.ts", "utf8");
const projectionSource = readFileSync(
  "server/publicProfiles/actionApiPublicReadProjection.ts",
  "utf8",
);
assert.equal(
  (actionSource.match(/rawData: restaurants\.rawData/g) || []).length,
  1,
  "rawData may appear only in the named eligibility preflight select",
);
assert.doesNotMatch(
  projectionSource,
  /row\.rawData|profile\.rawData/,
  "response projectors must not inspect or pass rawData",
);
assert.doesNotMatch(
  projectionSource,
  /\.\.\.(?:row|profile|candidate)/,
  "response projectors must not spread source records",
);
assert.match(actionSource, /\.select\(ACTION_API_PUBLIC_DEAL_SELECT\)/);
assert.match(actionSource, /\.select\(ACTION_API_PUBLIC_RESTAURANT_SELECT\)/);
assert.match(actionSource, /\.select\(ACTION_API_PUBLIC_TRUCK_SELECT\)/);
assert.match(
  actionSource,
  /ACTION_API_PUBLIC_RESTAURANT_SELECT = \{[\s\S]*?isFoodTruck: restaurants\.isFoodTruck/,
  "restaurant projections must select the legacy truck discriminator",
);
assert.match(actionSource, /deriveTruckPresence/);
assert.match(
  actionSource,
  /\.filter\(\(row\) => isActionApiPublicBusinessEligible\(row\.restaurant\)\)/,
  "deal and truck candidates must be filtered through public-business eligibility",
);
assert.doesNotMatch(actionSource, /storage\.getLiveTrucksNearby/);
assert.match(
  actionSource,
  /listParkingPassOccurrences\(\{[\s\S]*?includeDraft: false,[\s\S]*?\}\)/,
  "Action Parking Pass discovery must use the canonical public published-series marker",
);
assert.match(actionSource, /assertPublicResponseSafe\(result\)/);
assert.match(actionSource, /export function createActionApiRouter/);
assert.match(
  actionSource,
  /isolationLevel: "repeatable read"[\s\S]*?accessMode: "read only"/,
);
for (const schemaName of [
  "actionApiFindDealsResultSchema",
  "actionApiFindRestaurantsResultSchema",
  "actionApiGetRestaurantDetailsResultSchema",
  "actionApiGetFoodTrucksResultSchema",
  "actionApiGetParkingPassSpotsResultSchema",
]) {
  assert.match(
    actionSource,
    new RegExp(`${schemaName}\\.parse\\([\\s\\S]*?await`),
    `${schemaName} must parse its handler result in the dispatcher`,
  );
}
assert.doesNotMatch(
  actionSource.slice(actionSource.indexOf("export function createActionApiRouter")),
  /message:\s*err\.message/,
  "the public dispatcher must not return raw exception messages",
);
const detailStart = actionSource.indexOf("async function getRestaurantDetails");
const detailEnd = actionSource.indexOf('router.post("/"', detailStart);
assert.ok(detailStart >= 0 && detailEnd > detailStart);
const detailSource = actionSource.slice(detailStart, detailEnd);
assert.match(detailSource, /isActionApiPublicBusinessEligible/);
assert.match(detailSource, /error: "Restaurant not found"/);
assert.doesNotMatch(detailSource, /storage\.getRestaurant/);
assert.doesNotMatch(detailSource, /\.select\(\)/);

async function verifyRouterPublicReadsAndContainment() {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL ||= "postgresql://contract:contract@127.0.0.1:1/contract";
  const { createActionApiRouter } = await import("../server/routes/actionRoutes");

  class QueuedQueryBuilder {
    constructor(private readonly database: QueuedDatabase) {}
    from() {
      return this;
    }
    innerJoin() {
      return this;
    }
    where() {
      return this;
    }
    orderBy() {
      return this;
    }
    limit(value: number) {
      this.database.limitCalls.push(value);
      return this;
    }
    offset(value: number) {
      this.database.offsetCalls.push(value);
      return this;
    }
    then(resolve: (value: any) => any, reject: (reason: unknown) => any) {
      const queued = this.database.shift();
      return (queued instanceof Error
        ? Promise.reject(queued)
        : Promise.resolve(queued)
      ).then(resolve, reject);
    }
  }

  class QueuedDatabase {
    private readonly queued: unknown[] = [];
    readonly transactionConfigs: unknown[] = [];
    readonly limitCalls: number[] = [];
    readonly offsetCalls: number[] = [];

    enqueue(...results: unknown[]) {
      assert.equal(
        this.queued.length,
        0,
        "the preceding fake query queue must be exhausted",
      );
      this.queued.push(...results);
    }

    shift() {
      assert.ok(this.queued.length > 0, "an unexpected database query ran");
      return this.queued.shift();
    }

    select() {
      return new QueuedQueryBuilder(this);
    }

    async transaction(
      callback: (transaction: QueuedDatabase) => Promise<unknown>,
      config: unknown,
    ) {
      this.transactionConfigs.push(config);
      return callback(this);
    }

    assertDrained(label: string) {
      assert.equal(this.queued.length, 0, `${label} query queue`);
    }
  }

  const fixedNow = new Date("2026-08-01T18:00:00.000Z");
  const database = new QueuedDatabase();
  const withPrivateSentinels = (row: Record<string, unknown>) => ({
    ...privateSentinels,
    ...row,
  });
  const publicEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "restaurant-public",
  });
  const quarantinedEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "restaurant-quarantined",
    name: "Quarantined Cafe",
    rawData: {
      sentinel: privateSentinels.rawData,
      evidenceQuarantine: { active: true },
    },
  });
  const inactiveEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "restaurant-inactive",
    name: "Inactive Cafe",
    isActive: false,
  });
  const syntheticEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "restaurant-synthetic",
    name: "Test Restaurant 1771607433376",
  });
  const publicRestaurantRow = withPrivateSentinels({
    id: "restaurant-public",
    name: "Riverbend Cafe",
    businessType: "restaurant",
    cuisineType: "Cafe, Breakfast",
    description: "Neighborhood breakfast and lunch",
    city: "Pensacola",
    state: "FL",
    logoUrl: "https://images.example/riverbend-logo.jpg",
    coverImageUrl: "https://images.example/riverbend-cover.jpg",
    operatingHours: { mon: [{ open: "08:00", close: "15:00" }] },
    isActive: true,
    isVerified: true,
    isFoodTruck: false,
    address: "SECRET_address",
    phone: "SECRET_phone",
  });
  const quarantinedRestaurantRow = withPrivateSentinels({
    ...publicRestaurantRow,
    id: "restaurant-quarantined",
    name: "Quarantined Cafe",
  });
  const inactiveRestaurantRow = withPrivateSentinels({
    ...publicRestaurantRow,
    id: "restaurant-inactive",
    name: "Inactive Cafe",
    isActive: false,
  });
  const syntheticRestaurantRow = withPrivateSentinels({
    ...publicRestaurantRow,
    id: "restaurant-synthetic",
    name: "Test Restaurant 1771607433376",
  });
  const publicDealRow = withPrivateSentinels({
    id: "deal-public",
    restaurantId: "restaurant-public",
    title: "Public lunch special",
    description: "Soup and sandwich",
    dealType: "fixed",
    discountValue: "5.00",
    imageUrl: "https://images.example/public-deal.jpg",
    startDate: new Date("2026-07-31T00:00:00.000Z"),
    endDate: null,
    startTime: "11:00",
    endTime: "14:00",
    availableDuringBusinessHours: false,
    isOngoing: true,
  });
  const freshTruckEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "truck-fresh",
    name: "Fresh Taco Truck",
  });
  const staleTruckEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "truck-stale",
    name: "Stale Taco Truck",
  });
  const quarantinedTruckEligibility = withPrivateSentinels({
    ...eligibleBusiness,
    id: "truck-quarantined",
    name: "Quarantined Taco Truck",
    rawData: {
      sentinel: privateSentinels.rawData,
      evidenceQuarantine: { active: true },
    },
  });
  const freshTruckRow = withPrivateSentinels({
    id: "truck-fresh",
    name: "Fresh Taco Truck",
    businessType: "food_truck",
    cuisineType: "Tacos",
    description: "Fresh live tacos",
    city: "Pensacola",
    state: "FL",
    isFoodTruck: true,
    isActive: true,
    isVerified: true,
    mobileOnline: true,
    currentLatitude: "30.4313",
    currentLongitude: "-87.2069",
    lastBroadcastAt: new Date(fixedNow.getTime() - 5 * 60_000),
    liveUntilAt: new Date(fixedNow.getTime() + 30 * 60_000),
    address: "SECRET_address",
    phone: "SECRET_phone",
  });
  const staleTruckRow = withPrivateSentinels({
    ...freshTruckRow,
    id: "truck-stale",
    name: "Stale Taco Truck",
    lastBroadcastAt: new Date(fixedNow.getTime() - 5 * 60 * 60_000),
    liveUntilAt: null,
  });
  const quarantinedTruckRow = withPrivateSentinels({
    ...freshTruckRow,
    id: "truck-quarantined",
    name: "Quarantined Taco Truck",
    rawData: {
      sentinel: privateSentinels.rawData,
      evidenceQuarantine: { active: true },
    },
  });

  const parkingOccurrence = withPrivateSentinels({
    id: "parking-occurrence-published",
    status: "published",
    date: new Date("2026-08-02T12:00:00.000Z"),
    startTime: "08:00",
    endTime: "20:00",
    maxTrucks: 4,
    breakfastPriceCents: 2000,
    lunchPriceCents: 2500,
    dinnerPriceCents: 3000,
    dailyPriceCents: 5000,
    weeklyPriceCents: 20000,
    monthlyPriceCents: 60000,
    paymentsEnabled: true,
    host: withPrivateSentinels({
      id: "host-public",
      businessName: "City Market",
      address: "100 Main St",
      city: "Pensacola",
      state: "FL",
      latitude: "30.4250",
      longitude: "-87.2100",
    }),
  });
  const parkingProviderResult = {
    occurrences: [parkingOccurrence],
    start: fixedNow,
    end: new Date("2026-08-31T18:00:00.000Z"),
  };
  const parkingProviderBytes = JSON.stringify(parkingProviderResult);
  let parkingProviderCalls = 0;
  const parkingProvider = async (options?: {
    start?: Date;
    horizonDays?: number;
    hostIds?: string[];
    includeDraft?: boolean;
  }) => {
    parkingProviderCalls += 1;
    assert.equal(options?.includeDraft, false);
    assert.equal(options?.horizonDays, 30);
    assert.equal(options?.start?.toISOString(), fixedNow.toISOString());
    return parkingProviderResult as any;
  };

  const actionRouter = createActionApiRouter({
    database: database as any,
    listParkingPassOccurrences: parkingProvider as any,
    now: () => new Date(fixedNow),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/actions", actionRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/actions`;
    const post = async (body: unknown) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    };

    database.enqueue(
      Array.from({ length: 100 }, (_, index) =>
        withPrivateSentinels({
          dealId: `deal-hidden-${String(index).padStart(3, "0")}`,
          restaurant: quarantinedEligibility,
        }),
      ),
      [
        withPrivateSentinels({
          dealId: "deal-public",
          restaurant: publicEligibility,
        }),
      ],
      [publicDealRow],
    );
    const dealResponse = await post({
      action: "FIND_DEALS",
      params: { limit: 1, offset: 0 },
    });
    assert.equal(dealResponse.status, 200);
    actionApiFindDealsResultSchema.parse(dealResponse.body);
    assert.deepEqual(dealResponse.body, {
      success: true,
      data: [toActionApiPublicDeal(publicDealRow)],
      count: 1,
    });
    assert.equal((dealResponse.body.data as any[])[0].endDate, null);
    assertNoPrivateSentinels(dealResponse.body, "FIND_DEALS HTTP response");
    assert.deepEqual(
      database.limitCalls,
      [100, 100],
      "public limit 1 must still scan hidden deal candidates in bounded batches",
    );
    assert.deepEqual(
      database.offsetCalls,
      [0, 100],
      "deal candidate batches must advance deterministically",
    );
    database.assertDrained("FIND_DEALS");

    database.enqueue(
      [
        quarantinedEligibility,
        inactiveEligibility,
        syntheticEligibility,
        publicEligibility,
      ],
      [
        publicRestaurantRow,
        quarantinedRestaurantRow,
        inactiveRestaurantRow,
        syntheticRestaurantRow,
      ],
    );
    const restaurantResponse = await post({
      action: "FIND_RESTAURANTS",
      params: { limit: 999.8, offset: -9.4 },
    });
    assert.equal(restaurantResponse.status, 200);
    actionApiFindRestaurantsResultSchema.parse(restaurantResponse.body);
    assert.equal(restaurantResponse.body.success, true);
    assert.equal((restaurantResponse.body.data as any[]).length, 1);
    assert.equal(
      (restaurantResponse.body.data as any[])[0].id,
      "restaurant-public",
    );
    exactKeys(
      (restaurantResponse.body.data as any[])[0],
      restaurantKeys,
      "FIND_RESTAURANTS HTTP item",
    );
    assertNoPrivateSentinels(
      restaurantResponse.body,
      "FIND_RESTAURANTS HTTP response",
    );
    assert.equal(
      database.limitCalls[database.limitCalls.length - 1],
      100,
      "public restaurant limit must clamp to the 100-row maximum",
    );
    assert.equal(
      database.offsetCalls[database.offsetCalls.length - 1],
      0,
      "public restaurant offset must normalize to a nonnegative integer",
    );
    database.assertDrained("FIND_RESTAURANTS");

    database.enqueue([]);
    const missingDetailResponse = await post({
      action: "GET_RESTAURANT_DETAILS",
      params: { restaurantId: "restaurant-missing" },
    });
    assert.deepEqual(missingDetailResponse.body, {
      success: false,
      error: "Restaurant not found",
    });
    database.assertDrained("missing restaurant detail");

    database.enqueue([quarantinedEligibility]);
    const quarantinedDetailResponse = await post({
      action: "GET_RESTAURANT_DETAILS",
      params: { restaurantId: "restaurant-quarantined" },
    });
    assert.deepEqual(
      quarantinedDetailResponse.body,
      missingDetailResponse.body,
      "quarantined detail must be indistinguishable from missing detail",
    );
    assertNoPrivateSentinels(
      quarantinedDetailResponse.body,
      "quarantined detail HTTP response",
    );
    database.assertDrained("quarantined restaurant detail");

    database.enqueue(
      [publicEligibility],
      [publicRestaurantRow],
      [publicDealRow],
    );
    const detailResponse = await post({
      action: "GET_RESTAURANT_DETAILS",
      params: { restaurantId: "restaurant-public" },
    });
    assert.equal(detailResponse.status, 200);
    actionApiGetRestaurantDetailsResultSchema.parse(detailResponse.body);
    assert.equal(
      (detailResponse.body.data as any).restaurant.id,
      "restaurant-public",
    );
    assert.equal((detailResponse.body.data as any).dealCount, 1);
    assert.equal(
      (detailResponse.body.data as any).activeDeals[0].id,
      "deal-public",
    );
    exactKeys(
      (detailResponse.body.data as any).restaurant,
      restaurantKeys,
      "GET_RESTAURANT_DETAILS HTTP restaurant",
    );
    exactKeys(
      (detailResponse.body.data as any).activeDeals[0],
      dealKeys,
      "GET_RESTAURANT_DETAILS HTTP deal",
    );
    assertNoPrivateSentinels(
      detailResponse.body,
      "GET_RESTAURANT_DETAILS HTTP response",
    );
    database.assertDrained("visible restaurant detail");

    database.enqueue(
      [
        withPrivateSentinels({
          restaurant: freshTruckEligibility,
          mobileOnline: true,
          currentLatitude: "30.4313",
          currentLongitude: "-87.2069",
          lastBroadcastAt: new Date(fixedNow.getTime() - 5 * 60_000),
          liveUntilAt: new Date(fixedNow.getTime() + 30 * 60_000),
        }),
        withPrivateSentinels({
          restaurant: staleTruckEligibility,
          mobileOnline: true,
          currentLatitude: "30.4320",
          currentLongitude: "-87.2050",
          lastBroadcastAt: new Date(fixedNow.getTime() - 5 * 60 * 60_000),
          liveUntilAt: null,
        }),
        withPrivateSentinels({
          restaurant: quarantinedTruckEligibility,
          mobileOnline: true,
          currentLatitude: "30.4290",
          currentLongitude: "-87.2080",
          lastBroadcastAt: new Date(fixedNow.getTime() - 2 * 60_000),
          liveUntilAt: new Date(fixedNow.getTime() + 30 * 60_000),
        }),
      ],
      [freshTruckRow, staleTruckRow, quarantinedTruckRow],
    );
    const truckResponse = await post({
      action: "GET_FOOD_TRUCKS",
      params: { latitude: 30.4213, longitude: -87.2169, radiusKm: 10 },
    });
    assert.equal(truckResponse.status, 200);
    actionApiGetFoodTrucksResultSchema.parse(truckResponse.body);
    assert.equal((truckResponse.body.data as any[]).length, 1);
    const truckHttp = (truckResponse.body.data as any[])[0];
    assert.equal(truckHttp.id, "truck-fresh");
    assert.equal(truckHttp.currentLatitude, 30.4313);
    assert.equal(truckHttp.currentLongitude, -87.2069);
    assert.ok(Number.isFinite(truckHttp.distance) && truckHttp.distance > 0);
    assert.ok(
      Number.isFinite(truckHttp.distanceMiles) && truckHttp.distanceMiles > 0,
    );
    exactKeys(truckHttp, truckKeys, "GET_FOOD_TRUCKS HTTP item");
    assert.equal(JSON.stringify(truckResponse.body).includes("truck-stale"), false);
    assert.equal(
      JSON.stringify(truckResponse.body).includes("truck-quarantined"),
      false,
    );
    assertNoPrivateSentinels(
      truckResponse.body,
      "GET_FOOD_TRUCKS HTTP response",
    );
    database.assertDrained("GET_FOOD_TRUCKS");

    const parkingResponse = await post({
      action: "GET_PARKING_PASS_SPOTS",
      params: { latitude: 30.4213, longitude: -87.2169 },
    });
    assert.equal(parkingResponse.status, 200);
    actionApiGetParkingPassSpotsResultSchema.parse(parkingResponse.body);
    assert.equal(parkingProviderCalls, 1);
    assert.equal(
      JSON.stringify(parkingProviderResult),
      parkingProviderBytes,
      "the injected occurrence provider result must remain byte-for-byte unchanged",
    );
    assert.equal((parkingResponse.body.data as any[]).length, 1);
    const parkingHttp = (parkingResponse.body.data as any[])[0];
    assert.equal(parkingHttp.hostId, "host-public");
    assert.equal(parkingHttp.nextDate, "2026-08-02");
    exactKeys(parkingHttp, parkingKeys, "GET_PARKING_PASS_SPOTS HTTP item");
    exactKeys(
      parkingHttp.pricingCents,
      ["breakfast", "lunch", "dinner", "daily", "weekly", "monthly"],
      "GET_PARKING_PASS_SPOTS HTTP pricing",
    );
    assertNoPrivateSentinels(
      parkingResponse.body,
      "GET_PARKING_PASS_SPOTS HTTP response",
    );

    database.enqueue(new Error("SECRET_database_driver_message"));
    const internalFailureResponse = await post({
      action: "FIND_DEALS",
      params: {},
    });
    assert.equal(internalFailureResponse.status, 200);
    assert.deepEqual(internalFailureResponse.body, publicReadFailure);
    assertNoSentinel(internalFailureResponse.body, "generic internal failure");
    database.assertDrained("generic internal failure");

    assert.equal(ACTION_API_USER_SCOPED_ACTIONS.length, 22);
    for (const action of ACTION_API_USER_SCOPED_ACTIONS) {
      const response = await post({ action, params: {} });
      assert.equal(response.status, 403, action);
      assert.equal(response.body.code, ACTION_API_WRITE_CONTAINMENT_CODE, action);
      assert.equal(response.body.action, action);
    }

    for (const action of [
      "GET_COUNTY_TRANSPARENCY",
      "GET_COUNTY_LEDGER",
      "GET_COUNTY_VAULT",
    ]) {
      const response = await post({ action, params: {} });
      assert.equal(response.status, 501, action);
      assert.equal(response.body.code, "ACTION_NOT_IMPLEMENTED", action);
    }

    const unknown = await post({ action: "UNKNOWN_ACTION", params: {} });
    assert.equal(unknown.status, 400);
    assert.deepEqual(
      unknown.body.supportedActions,
      [...ACTION_API_PUBLIC_READ_ACTIONS],
    );
    assert.equal((await post({ params: {} })).status, 400);

    assert.ok(database.transactionConfigs.length >= 7);
    for (const config of database.transactionConfigs) {
      assert.deepEqual(config, {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

await verifyRouterPublicReadsAndContainment();

console.log("mealscout-action-api-public-read-projection.contract: PASS");
