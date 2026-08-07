import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { toPublicRestaurantListingArray } from "../server/publicProfiles/toPublicRestaurantListing";
import {
  AGGREGATE_SEARCH_DEAL_LIMIT,
  AGGREGATE_SEARCH_EVENT_LIMIT,
  AGGREGATE_SEARCH_HOST_LIMIT,
  AGGREGATE_SEARCH_RESTAURANT_LIMIT,
  AGGREGATE_SEARCH_VIDEO_LIMIT,
  LIVE_TRUCKS_DEFAULT_LIMIT,
  LIVE_TRUCKS_MAX_LIMIT,
  MAX_LIVE_TRUCKS_RESPONSE_BYTES,
  MAX_SEARCH_ASSEMBLE_MS,
  MAX_SEARCH_RESPONSE_BYTES,
  RESTAURANT_SEARCH_RESULT_LIMIT,
  clampLiveTrucksLimit,
  jsonUtf8ByteLength,
} from "../shared/searchResponseBounds";

const pad = (label: string, size: number) =>
  `${label}:${"x".repeat(Math.max(0, size - label.length - 1))}`;

function buildAggregateSearchFixture() {
  const restaurants = Array.from(
    { length: AGGREGATE_SEARCH_RESTAURANT_LIMIT },
    (_, index) => ({
      id: `rest-${index}`,
      name: `Fixture Restaurant ${index}`,
      cuisineType: "Mexican",
      address: `${100 + index} Main St`,
      city: "Pensacola",
      state: "FL",
      slug: `fixture-restaurant-${index}`,
      description: pad(`restaurant-description-${index}`, 2048),
      logoUrl: `https://cdn.example/logo-${index}.jpg`,
      coverImageUrl: `https://cdn.example/cover-${index}.jpg`,
      imageUrl: `https://cdn.example/cover-${index}.jpg`,
      businessType: "restaurant",
      isFoodTruck: false,
      isVerified: true,
      activeDealCount: 1,
      favoriteCount: 10,
      followCount: 5,
      recommendationCount: 3,
      communityActivityCount: 8,
      homeRankingScore: 100 - index,
    }),
  );

  const deals = Array.from({ length: AGGREGATE_SEARCH_DEAL_LIMIT }, (_, index) => ({
    id: `deal-${index}`,
    restaurantId: `rest-${index}`,
    title: `Fixture Deal ${index}`,
    description: pad(`deal-description-${index}`, 2048),
    dealType: "percentage",
    discountValue: "20.00",
    imageUrl: `https://cdn.example/deal-${index}.jpg`,
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2026-08-31T00:00:00.000Z",
    isActive: true,
    restaurantData: {
      id: `rest-${index}`,
      name: `Fixture Restaurant ${index}`,
      address: `${100 + index} Main St`,
      latitude: "30.42",
      longitude: "-87.21",
      cuisineType: "Mexican",
      isVerified: true,
    },
  }));

  const parkingPassHosts = Array.from(
    { length: AGGREGATE_SEARCH_HOST_LIMIT },
    (_, index) => ({
      hostId: `host-${index}`,
      businessName: `Fixture Host ${index}`,
      address: `${200 + index} Host Ave`,
      city: "Pensacola",
      state: "FL",
      latitude: "30.42",
      longitude: "-87.21",
      spotImageUrl: `https://cdn.example/host-${index}.jpg`,
      qualityFlags: [],
    }),
  );

  const videos = Array.from(
    { length: AGGREGATE_SEARCH_VIDEO_LIMIT },
    (_, index) => ({
      id: `video-${index}`,
      title: `Fixture Video ${index}`,
      description: pad(`video-description-${index}`, 512),
      restaurantId: `rest-${index}`,
      restaurantName: `Fixture Restaurant ${index}`,
      createdAt: "2026-08-01T00:00:00.000Z",
    }),
  );

  const events = Array.from(
    { length: AGGREGATE_SEARCH_EVENT_LIMIT },
    (_, index) => ({
      id: `event-${index}`,
      name: `Fixture Event ${index}`,
      description: pad(`event-description-${index}`, 1024),
      date: "2026-08-15",
      startTime: "11:00",
      endTime: "14:00",
      hostId: `host-${index}`,
      hostBusinessName: `Fixture Host ${index}`,
      hostAddress: `${200 + index} Host Ave`,
      hostCity: "Pensacola",
      hostState: "FL",
    }),
  );

  return {
    query: "taco",
    restaurants,
    deals,
    parkingPassHosts,
    videos,
    events,
  };
}

function buildRestaurantSearchFixture(count: number) {
  return toPublicRestaurantListingArray(
    Array.from({ length: count }, (_, index) => ({
      id: `rest-${index}`,
      name: `Fixture Restaurant ${index}`,
      address: `${100 + index} Main St`,
      phone: "8505550100",
      businessType: "restaurant",
      cuisineType: "Mexican",
      latitude: 30.42,
      longitude: -87.21,
      city: "Pensacola",
      state: "FL",
      isFoodTruck: false,
      mobileOnline: false,
      currentLatitude: null,
      currentLongitude: null,
      lastBroadcastAt: null,
      liveUntilAt: null,
      operatingHours: {
        monday: { open: "11:00", close: "21:00" },
        tuesday: { open: "11:00", close: "21:00" },
        wednesday: { open: "11:00", close: "21:00" },
        thursday: { open: "11:00", close: "21:00" },
        friday: { open: "11:00", close: "22:00" },
        saturday: { open: "11:00", close: "22:00" },
        sunday: { open: "12:00", close: "20:00" },
      },
      isActive: true,
      isVerified: true,
      insuranceVerified: false,
      logoUrl: `https://cdn.example/logo-${index}.jpg`,
      coverImageUrl: `https://cdn.example/cover-${index}.jpg`,
      description: pad(`restaurant-listing-description-${index}`, 2048),
      websiteUrl: `https://example.com/${index}`,
      instagramUrl: null,
      facebookPageUrl: null,
      xUrl: null,
      amenities: ["outdoor_seating", "wifi"],
      hasGoldenPlate: false,
      goldenPlateEarnedAt: null,
      goldenPlateCount: 0,
      featuredMenuItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    })),
  );
}

function buildLiveTrucksFixture(count: number) {
  return {
    trucks: Array.from({ length: count }, (_, index) => ({
      id: `truck-${index}`,
      ownerId: `owner-${index}`,
      name: `Fixture Truck ${index}`,
      address: `${300 + index} Truck Rd`,
      phone: "8505550200",
      businessType: "food_truck",
      cuisineType: "Tacos",
      promoCode: null,
      latitude: 30.42,
      longitude: -87.21,
      isFoodTruck: true,
      mobileOnline: true,
      currentLatitude: 30.42 + index * 0.001,
      currentLongitude: -87.21,
      lastBroadcastAt: "2026-08-07T12:00:00.000Z",
      liveUntilAt: "2026-08-07T16:00:00.000Z",
      operatingHours: { friday: { open: "11:00", close: "20:00" } },
      isActive: true,
      isVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      logoUrl: `https://cdn.example/truck-logo-${index}.jpg`,
      coverImageUrl: `https://cdn.example/truck-cover-${index}.jpg`,
      city: "Pensacola",
      state: "FL",
      description: pad(`live-truck-description-${index}`, 1024),
      distance: index * 0.2,
      distanceMiles: index * 0.12,
      lat: 30.42 + index * 0.001,
      lng: -87.21,
      liveBroadcasting: true,
      locationSource: "live",
      menuItemCount: 8,
      menuAvailable: true,
    })),
  };
}

// --- Clamp helper unit checks ---
assert.equal(clampLiveTrucksLimit(undefined), LIVE_TRUCKS_DEFAULT_LIMIT);
assert.equal(clampLiveTrucksLimit("50"), 50);
assert.equal(clampLiveTrucksLimit("9999"), LIVE_TRUCKS_MAX_LIMIT);
assert.equal(clampLiveTrucksLimit("0"), 1);
assert.equal(clampLiveTrucksLimit("nope"), LIVE_TRUCKS_DEFAULT_LIMIT);

// --- Handler wiring contracts (source) ---
const aggregateSource = readFileSync("server/routes/publicSearchRoutes.ts", "utf8");
const restaurantSearchSource = readFileSync(
  "server/routes/restaurantCoreRoutes.ts",
  "utf8",
);
const liveTrucksSource = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
);

assert.match(
  aggregateSource,
  /AGGREGATE_SEARCH_RESTAURANT_LIMIT/,
  "aggregate /api/search must use shared restaurant result limit",
);
assert.match(
  aggregateSource,
  /AGGREGATE_SEARCH_DEAL_LIMIT/,
  "aggregate /api/search must use shared deal result limit",
);
assert.match(
  restaurantSearchSource,
  /RESTAURANT_SEARCH_RESULT_LIMIT/,
  "restaurant search must apply the shared hard result cap",
);
assert.match(
  restaurantSearchSource,
  /filteredRestaurants\.slice\(0,\s*RESTAURANT_SEARCH_RESULT_LIMIT\)/,
  "restaurant search must slice before serialization",
);
assert.match(
  liveTrucksSource,
  /clampLiveTrucksLimit/,
  "live trucks must clamp the client limit query param",
);
assert.match(
  liveTrucksSource,
  /\.slice\(0,\s*maxTrucks\)/,
  "live trucks must slice the distance-sorted set before access fan-out",
);

// --- Size + assemble-time proofs against fixtures (no production credentials) ---
{
  const started = performance.now();
  const payload = buildAggregateSearchFixture();
  const bytes = jsonUtf8ByteLength(payload);
  const elapsedMs = performance.now() - started;

  assert.equal(payload.restaurants.length, AGGREGATE_SEARCH_RESTAURANT_LIMIT);
  assert.equal(payload.deals.length, AGGREGATE_SEARCH_DEAL_LIMIT);
  assert.equal(payload.parkingPassHosts.length, AGGREGATE_SEARCH_HOST_LIMIT);
  assert.equal(payload.videos.length, AGGREGATE_SEARCH_VIDEO_LIMIT);
  assert.equal(payload.events.length, AGGREGATE_SEARCH_EVENT_LIMIT);
  assert.ok(
    bytes <= MAX_SEARCH_RESPONSE_BYTES,
    `aggregate search fixture ${bytes} bytes exceeds ${MAX_SEARCH_RESPONSE_BYTES}`,
  );
  assert.ok(
    elapsedMs <= MAX_SEARCH_ASSEMBLE_MS,
    `aggregate search fixture assemble took ${elapsedMs.toFixed(1)}ms (> ${MAX_SEARCH_ASSEMBLE_MS})`,
  );
  console.log(
    `aggregate-search fixture: ${bytes} bytes / ${elapsedMs.toFixed(1)}ms (cap ${MAX_SEARCH_RESPONSE_BYTES})`,
  );
}

{
  const started = performance.now();
  const payload = buildRestaurantSearchFixture(RESTAURANT_SEARCH_RESULT_LIMIT);
  const bytes = jsonUtf8ByteLength(payload);
  const elapsedMs = performance.now() - started;

  assert.equal(payload.length, RESTAURANT_SEARCH_RESULT_LIMIT);
  assert.ok(
    bytes <= MAX_SEARCH_RESPONSE_BYTES,
    `restaurant search fixture ${bytes} bytes exceeds ${MAX_SEARCH_RESPONSE_BYTES}`,
  );
  assert.ok(
    elapsedMs <= MAX_SEARCH_ASSEMBLE_MS,
    `restaurant search fixture assemble took ${elapsedMs.toFixed(1)}ms (> ${MAX_SEARCH_ASSEMBLE_MS})`,
  );
  console.log(
    `restaurant-search fixture: ${bytes} bytes / ${elapsedMs.toFixed(1)}ms (cap ${MAX_SEARCH_RESPONSE_BYTES})`,
  );

  // Unbounded regression signal: 10x the cap must breach the byte budget.
  const unbounded = buildRestaurantSearchFixture(RESTAURANT_SEARCH_RESULT_LIMIT * 10);
  const unboundedBytes = jsonUtf8ByteLength(unbounded);
  assert.ok(
    unboundedBytes > MAX_SEARCH_RESPONSE_BYTES,
    "unbounded restaurant search fixture should exceed the release byte budget (proves the cap matters)",
  );
}

{
  const started = performance.now();
  const payload = buildLiveTrucksFixture(LIVE_TRUCKS_MAX_LIMIT);
  const bytes = jsonUtf8ByteLength(payload);
  const elapsedMs = performance.now() - started;

  assert.equal(payload.trucks.length, LIVE_TRUCKS_MAX_LIMIT);
  assert.ok(
    bytes <= MAX_LIVE_TRUCKS_RESPONSE_BYTES,
    `live trucks fixture ${bytes} bytes exceeds ${MAX_LIVE_TRUCKS_RESPONSE_BYTES}`,
  );
  assert.ok(
    elapsedMs <= MAX_SEARCH_ASSEMBLE_MS,
    `live trucks fixture assemble took ${elapsedMs.toFixed(1)}ms (> ${MAX_SEARCH_ASSEMBLE_MS})`,
  );
  console.log(
    `live-trucks fixture: ${bytes} bytes / ${elapsedMs.toFixed(1)}ms (cap ${MAX_LIVE_TRUCKS_RESPONSE_BYTES})`,
  );
}

console.log("mealscout-search-response-bounds.contract: PASS");
