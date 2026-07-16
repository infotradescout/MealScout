import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  toPublicRestaurantListing,
  toPublicRestaurantListingArray,
} from "../server/publicProfiles/toPublicRestaurantListing";
import {
  toPublicEventListing,
  toPublicEventListingArray,
} from "../server/publicProfiles/toPublicEventListing";
import { toPublicMapLocationsPayload } from "../server/publicProfiles/toPublicMapLocations";
import { toPublicParkingPassListingArray } from "../server/publicProfiles/toPublicParkingPassListing";
import { toPublicRestaurantReviewArray } from "../server/publicProfiles/toPublicRestaurantReview";
import { canExposeAnonymousEventDetail } from "../server/publicProfiles/publicEventDetailAccess";

// --- Runtime: forbidden fields must never survive the DTO ---------------

const forbiddenRestaurantKeys = [
  "ownerId",
  "rawData",
  "rankingScore",
  "lockedPriceCents",
  "priceLockDate",
  "priceLockReason",
  "claimedFromImportId",
  "countyFips",
  "countyName",
  "geoEnrichedAt",
  "insuranceVerifiedAt",
  "insuranceExpiresAt",
  "insuranceVerifiedByUserId",
  "socialAutopostSettings",
  "promoCode",
];

const rawRestaurant: Record<string, unknown> = {
  id: "rest-1",
  name: "Test Kitchen",
  address: "123 Main St",
  phone: "555-0100",
  businessType: "restaurant",
  cuisineType: "bbq",
  latitude: "30.4",
  longitude: "-87.2",
  city: "Pensacola",
  state: "FL",
  isActive: true,
  isVerified: true,
  insuranceVerified: true,
  logoUrl: "https://example.com/logo.png",
  coverImageUrl: "https://example.com/cover.png",
  description: "A place to eat",
  websiteUrl: "https://example.com",
  amenities: { parking: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  distance: 1.2,
  favoriteCount: 3,
  homeRankingScore: 42,
  homeRankingReason: ["popular_here"],
};
for (const key of forbiddenRestaurantKeys) {
  rawRestaurant[key] = `SECRET_${key}`;
}

const publicRestaurant = toPublicRestaurantListing(rawRestaurant);
for (const key of forbiddenRestaurantKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicRestaurant, key),
    false,
    `toPublicRestaurantListing must strip "${key}"`,
  );
}
assert.equal(publicRestaurant.id, "rest-1");
assert.equal(publicRestaurant.name, "Test Kitchen");
// Computed/derived fields the canonical Scout page relies on for sorting
// must survive — this is not raw DB state, and dropping it silently
// degrades Scout's ranking tie-break.
assert.equal(publicRestaurant.homeRankingScore, 42);
assert.equal(publicRestaurant.distance, 1.2);

const publicRestaurantArray = toPublicRestaurantListingArray([rawRestaurant]);
assert.equal(publicRestaurantArray.length, 1);
for (const key of forbiddenRestaurantKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicRestaurantArray[0], key),
    false,
    `toPublicRestaurantListingArray must strip "${key}"`,
  );
}

const forbiddenEventKeys = [
  "coordinatorUserId",
  "stripeProductId",
  "stripePriceId",
  "unbookedNotificationSentAt",
];
const forbiddenHostKeys = [
  "userId",
  "contactPhone",
  "notes",
  "adminCreated",
  "spotCount",
  "expectedFootTraffic",
  "stripeConnectAccountId",
  "stripeConnectStatus",
  "stripeOnboardingCompleted",
  "stripeChargesEnabled",
  "stripePayoutsEnabled",
  "parkingPassBreakfastPriceCents",
  "parkingPassStartTime",
  "parkingPassDaysOfWeek",
];

const rawEvent: Record<string, unknown> = {
  id: "event-1",
  hostId: "host-1",
  name: "Friday Food Trucks",
  description: "Weekly food truck night",
  eventType: "food_truck_night",
  date: "2026-07-17T00:00:00.000Z",
  startTime: "17:00",
  endTime: "20:00",
  maxTrucks: 3,
  status: "open",
  requiresPayment: false,
  hostPriceCents: 5000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  host: {
    id: "host-1",
    businessName: "Downtown Taproom",
    address: "456 Palafox St",
    city: "Pensacola",
    state: "FL",
    latitude: "30.4",
    longitude: "-87.2",
    locationType: "bar",
    isVerified: true,
  },
  series: {
    id: "series-1",
    name: "Friday series",
    coordinatorUserId: "SECRET_series_coordinator",
    defaultHostPriceCents: 1234,
  },
};
for (const key of forbiddenEventKeys) {
  rawEvent[key] = `SECRET_${key}`;
}
for (const key of forbiddenHostKeys) {
  (rawEvent.host as Record<string, unknown>)[key] = `SECRET_${key}`;
}

const publicEvent = toPublicEventListing(rawEvent);
for (const key of forbiddenEventKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicEvent, key),
    false,
    `toPublicEventListing must strip "${key}"`,
  );
}
const publicHost = publicEvent.host as Record<string, unknown>;
assert.ok(publicHost, "toPublicEventListing must still include a host object");
for (const key of forbiddenHostKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicHost, key),
    false,
    `toPublicEventListing must strip host.${key}`,
  );
}
assert.equal(publicHost.businessName, "Downtown Taproom");
assert.equal(publicEvent.hostPriceCents, 5000);
assert.deepEqual(
  publicEvent.series,
  { id: "series-1", name: "Friday series" },
  "toPublicEventListing must preserve only the public series identity",
);

const publicEventArray = toPublicEventListingArray([rawEvent]);
assert.equal(publicEventArray.length, 1);
const arrayHost = (publicEventArray[0] as any).host as Record<string, unknown>;
for (const key of forbiddenHostKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(arrayHost, key),
    false,
    `toPublicEventListingArray must strip host.${key}`,
  );
}
assert.deepEqual(toPublicEventListingArray([null, [], "invalid"]), [
  {},
  {},
  {},
]);

assert.equal(
  canExposeAnonymousEventDetail({
    requiresPayment: false,
    status: "open",
    slotIsPublic: true,
  }),
  true,
  "a current confirmed free event may have an anonymous detail page",
);
for (const blockedDetail of [
  { requiresPayment: true, status: "open", slotIsPublic: true },
  { requiresPayment: false, status: "open", slotIsPublic: false },
  { requiresPayment: false, status: "draft", slotIsPublic: true },
]) {
  assert.equal(
    canExposeAnonymousEventDetail(blockedDetail),
    false,
    "paid, stale/unconfirmed, and draft event details must stay private",
  );
}

const rawMapPayload = {
  hostLocations: [
    {
      id: "host-map-1",
      type: "host_location",
      hostId: "host-map-1",
      name: "Public host",
      address: "123 Host St",
      latitude: "30.1",
      longitude: "-87.2",
      locationRequestId: "SECRET_request",
      preferredDates: ["SECRET_date"],
      userId: "SECRET_userId",
      contactPhone: "SECRET_contactPhone",
      notes: "SECRET_notes",
      expectedFootTraffic: 9000,
      stripeConnectAccountId: "SECRET_stripe",
      stripeConnectStatus: "SECRET_status",
      parkingPassBreakfastPriceCents: 1234,
    },
    null,
    [],
  ],
  eventLocations: [
    {
      id: "event-map-1",
      type: "event",
      name: "Public event",
      hostId: "host-map-1",
      hostName: "Public host",
      stripeProductId: "SECRET_product",
      stripePriceId: "SECRET_price",
      coordinatorUserId: "SECRET_coordinator",
    },
    "invalid-event-row",
  ],
  supplierLocations: [
    {
      id: "supplier-map-1",
      type: "supplier",
      supplierId: "supplier-map-1",
      name: "Public supplier",
      contactEmail: "SECRET_email",
      contactPhone: "SECRET_phone",
      stripeConnectAccountId: "SECRET_stripe",
    },
    null,
  ],
};
const publicMapPayload = toPublicMapLocationsPayload(rawMapPayload);
for (const key of [
  "userId",
  "contactPhone",
  "notes",
  "expectedFootTraffic",
  "stripeConnectAccountId",
  "stripeConnectStatus",
  "parkingPassBreakfastPriceCents",
  "locationRequestId",
  "preferredDates",
]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicMapPayload.hostLocations[0], key),
    false,
    `/api/map/locations must strip hostLocations.${key}`,
  );
}
assert.deepEqual(publicMapPayload.hostLocations[1], {});
assert.deepEqual(publicMapPayload.hostLocations[2], {});
assert.deepEqual(publicMapPayload.eventLocations[1], {});
assert.deepEqual(publicMapPayload.supplierLocations[1], {});
for (const key of ["stripeProductId", "stripePriceId", "coordinatorUserId"]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicMapPayload.eventLocations[0], key),
    false,
    `/api/map/locations must strip eventLocations.${key}`,
  );
}
for (const key of ["contactEmail", "contactPhone", "stripeConnectAccountId"]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicMapPayload.supplierLocations[0], key),
    false,
    `/api/map/locations must strip supplierLocations.${key}`,
  );
}

const publicParkingPass = toPublicParkingPassListingArray([
  {
    id: "parking-pass-1",
    hostId: "host-1",
    seriesId: "series-1",
    name: "Lunch parking",
    date: "2026-07-18T00:00:00.000Z",
    startTime: "11:00",
    endTime: "14:00",
    status: "open",
    requiresPayment: true,
    paymentsEnabled: true,
    breakfastPriceCents: 2500,
    stripeProductId: "SECRET_product",
    stripePriceId: "SECRET_price",
    unbookedNotificationSentAt: "SECRET_notification",
    coordinatorUserId: "SECRET_coordinator",
    bookings: [
      {
        truckId: "truck-1",
        truckName: "Public truck",
        slotType: "lunch",
        spotNumber: 2,
        bookingConfirmedAt: "SECRET_confirmation_time",
        stripePaymentIntentId: "SECRET_payment",
        userId: "SECRET_user",
      },
    ],
    host: {
      id: "host-1",
      businessName: "Public host",
      address: "123 Host St",
      city: "Pensacola",
      state: "FL",
      latitude: "30.1",
      longitude: "-87.2",
      userId: "SECRET_user",
      contactPhone: "SECRET_phone",
      notes: "SECRET_notes",
      expectedFootTraffic: 9000,
      adminCreated: true,
      stripeConnectAccountId: "SECRET_stripe",
      stripeConnectStatus: "SECRET_status",
      stripeOnboardingCompleted: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      parkingPassBreakfastPriceCents: 2500,
      parkingPassStartTime: "11:00",
      parkingPassDaysOfWeek: [1, 2, 3],
    },
  },
]);
assert.equal(publicParkingPass.length, 1);
for (const key of forbiddenEventKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicParkingPass[0], key),
    false,
    `/api/parking-pass must strip event.${key}`,
  );
}
const publicParkingHost = publicParkingPass[0].host as Record<string, unknown>;
for (const key of forbiddenHostKeys) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicParkingHost, key),
    false,
    `/api/parking-pass must strip host.${key}`,
  );
}
const publicParkingBooking = (
  publicParkingPass[0].bookings as Record<string, unknown>[]
)[0];
assert.deepEqual(publicParkingBooking, {
  truckId: "truck-1",
  truckName: "Public truck",
  slotType: "lunch",
  spotNumber: 2,
});
assert.deepEqual(toPublicParkingPassListingArray([null, [], "invalid"]), [
  {},
  {},
  {},
]);
assert.equal(toPublicParkingPassListingArray([{ host: [] }])[0].host, null);

const publicReviews = toPublicRestaurantReviewArray([
  {
    id: "review-1",
    restaurantId: "rest-1",
    userId: "SECRET_user",
    rating: 0,
    reviewText: "Worth the trip",
    createdAt: "2026-07-16T00:00:00.000Z",
    user: {
      firstName: "Public",
      lastName: "Reviewer",
      profileImageUrl: null,
      email: "SECRET_email",
    },
  },
]);
assert.equal(publicReviews.length, 1);
for (const key of ["userId", "rating"]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicReviews[0], key),
    false,
    `/api/reviews/restaurant/:restaurantId must strip ${key}`,
  );
}
assert.equal(
  Object.prototype.hasOwnProperty.call(
    publicReviews[0].user as Record<string, unknown>,
    "email",
  ),
  false,
  "public review user projection must strip email",
);
assert.deepEqual(toPublicRestaurantReviewArray([null, [], "invalid"]), [
  {},
  {},
  {},
]);

// --- Source: the public endpoints must actually call the DTOs -----------

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const restaurantRoutesSource = readSource(
  "server/routes/restaurantCoreRoutes.ts",
);
assert.match(
  restaurantRoutesSource,
  /toPublicRestaurantListing/,
  "restaurantCoreRoutes.ts must import the public restaurant DTO",
);

const sliceAfter = (source: string, marker: string, span = 400): string => {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + span);
};

assert.match(
  sliceAfter(restaurantRoutesSource, 'app.get("/api/restaurants/:id"'),
  /res\.json\(toPublicRestaurantListing\(restaurant\)\)/,
  "GET /api/restaurants/:id must return the sanitized restaurant DTO",
);
assert.match(
  sliceAfter(restaurantRoutesSource, 'app.get("/api/restaurants/search"', 2500),
  /res\.json\(toPublicRestaurantListingArray\(filteredRestaurants\)\)/,
  "GET /api/restaurants/search must return sanitized restaurant DTOs",
);
assert.match(
  sliceAfter(restaurantRoutesSource, 'app.get("/api/restaurants/nearby/:lat/:lng"'),
  /res\.json\(toPublicRestaurantListingArray\(restaurants\)\)/,
  "GET /api/restaurants/nearby must return sanitized restaurant DTOs",
);
assert.match(
  sliceAfter(restaurantRoutesSource, 'app.get("/api/restaurants/public"', 14000),
  /res\.json\(toPublicRestaurantListingArray\(sorted\.slice/,
  "GET /api/restaurants/public must return sanitized restaurant DTOs",
);
assert.doesNotMatch(
  sliceAfter(
    restaurantRoutesSource,
    '"/api/restaurants/:restaurantId/recommendations/public"',
    5000,
  ),
  /userId\s*:/,
  "GET public restaurant recommendations must not expose raw user ids",
);

const locationRoutesSource = readSource(
  "server/routes/locationUtilityRoutes.ts",
);
assert.match(
  locationRoutesSource,
  /toPublicRestaurantListing/,
  "locationUtilityRoutes.ts must import the public restaurant DTO",
);
assert.match(
  sliceAfter(
    locationRoutesSource,
    'app.get("/api/restaurants/subscribed/:lat/:lng"',
    6500,
  ),
  /toPublicRestaurantListing\(sanitizeRestaurantMedia\(restaurant\)\)/,
  "GET /api/restaurants/subscribed must return sanitized restaurant DTOs",
);

const eventRoutesSource = readSource("server/routes/eventRoutes.ts");
assert.match(
  eventRoutesSource,
  /toPublicEventListingArray/,
  "eventRoutes.ts must import the public event DTO",
);
assert.match(
  sliceAfter(eventRoutesSource, 'app.get("/api/events/public"'),
  /toPublicEventListingArray/,
  "GET /api/events/public must return sanitized event DTOs",
);
assert.match(
  sliceAfter(eventRoutesSource, 'app.get("/api/events/upcoming"'),
  /toPublicEventListingArray/,
  "GET /api/events/upcoming must return sanitized event DTOs",
);
const authenticatedEventsRoute = sliceAfter(
  eventRoutesSource,
  'app.get("/api/events", isAuthenticated',
  4500,
);
assert.match(
  authenticatedEventsRoute,
  /storage\.getHost\(hostIdFilter\)/,
  "GET /api/events?hostId must load the requested host before returning management data",
);
assert.match(
  authenticatedEventsRoute,
  /requestedHost\.userId[\s\S]*res\.status\(403\)/,
  "GET /api/events?hostId must enforce host ownership",
);
assert.match(
  authenticatedEventsRoute,
  /res\.json\(toPublicEventListingArray\(filtered\)\)/,
  "GET /api/events without a host filter must sanitize its cross-host feed",
);
const publicEventDetailRoute = sliceAfter(
  eventRoutesSource,
  'app.get("/api/public/events/:eventId"',
  8000,
);
assert.match(
  publicEventDetailRoute,
  /canExposeAnonymousEventDetail/,
  "public event detail must gate paid and non-public rows",
);
assert.match(
  publicEventDetailRoute,
  /!isAuthed[\s\S]*res\.status\(404\)/,
  "public event detail must hide protected rows from anonymous callers",
);
assert.match(
  publicEventDetailRoute,
  /isAuthed \? "private, no-store" : "public, max-age=60"/,
  "authenticated event detail must never enter a shared cache",
);
assert.match(
  eventRoutesSource,
  /toPublicParkingPassListingArray/,
  "eventRoutes.ts must import the public Parking Pass DTO",
);
assert.match(
  sliceAfter(eventRoutesSource, '"/api/parking-pass",', 6500),
  /toPublicParkingPassListingArray/,
  "GET /api/parking-pass must return allowlisted listings",
);
assert.match(
  sliceAfter(eventRoutesSource, '"/api/parking-pass/host-ids"', 7000),
  /normalizeParkingStatus\(series\?\.status\) === "published"/,
  "public Parking Pass host ids must require a published series",
);
const parkingPassHostStatusSource = sliceAfter(
  eventRoutesSource,
  "const buildParkingPassHostStatusPayload",
  5000,
);
assert.match(
  parkingPassHostStatusSource,
  /includeDraft: false/,
  "public Parking Pass host status must exclude draft virtual occurrences",
);
assert.match(
  parkingPassHostStatusSource,
  /isParkingPassFeedCandidate\(event\)/,
  "public Parking Pass host status must exclude unavailable legacy rows",
);
assert.match(
  parkingPassHostStatusSource,
  /publishedParkingPassSeriesIds\.has\(String\(event\.seriesId\)\)/,
  "public Parking Pass host status must reject legacy rows linked to draft series",
);

const dealDiscoveryRoutesSource = readSource(
  "server/routes/dealDiscoveryRoutes.ts",
);
assert.match(
  sliceAfter(
    dealDiscoveryRoutesSource,
    'app.get("/api/reviews/restaurant/:restaurantId"',
    1200,
  ),
  /toPublicRestaurantReviewArray/,
  "GET /api/reviews/restaurant/:restaurantId must return public review DTOs",
);

const publicMapRoutesSource = readSource("server/routes/publicMapRoutes.ts");
assert.match(
  publicMapRoutesSource,
  /to(?:Bounded)?PublicMapLocationsPayload/,
  "publicMapRoutes.ts must import the public map locations DTO",
);
assert.match(
  sliceAfter(publicMapRoutesSource, 'app.get("/api/map/locations"', 22000),
  /toBoundedPublicMapLocationsPayload/,
  "GET /api/map/locations must return sanitized map location DTOs",
);

const completenessReportSource = readSource(
  "scripts/realAccountCompletenessReport.ts",
);
assert.match(
  completenessReportSource,
  /from event_bookings eb[\s\S]*lower\(coalesce\(eb\.status, ''\)\) = 'confirmed'[\s\S]*e\.date >= current_date/,
  "account completeness must count confirmed current event bookings as schedule",
);
assert.doesNotMatch(
  completenessReportSource,
  /from telemetry_events|owner_created_at|owner_telemetry_event_count|owner_login_event_count/,
  "account completeness must not collect owner join/login/telemetry output data",
);
assert.match(
  completenessReportSource,
  /isLikelyTestBusiness\(\{[\s\S]*address: raw\.address[\s\S]*description: raw\.description/,
  "account completeness may use business evidence transiently for test-row exclusion",
);
const completenessOutputProjection = sliceAfter(
  completenessReportSource,
  "realRows.push({",
  1400,
);
for (const forbiddenOutputField of [
  "ownerCreatedAt",
  "ownerTelemetryEventCount",
  "ownerLoginEventCount",
  "address:",
  "description:",
  "cuisineType:",
  "operatingHours:",
  "logoUrl:",
  "coverImageUrl:",
]) {
  assert.equal(
    completenessOutputProjection.includes(forbiddenOutputField),
    false,
    `account completeness JSON projection must omit ${forbiddenOutputField}`,
  );
}
assert.match(completenessOutputProjection, /hasPhotos:/);
assert.match(completenessOutputProjection, /hasHours:/);

console.log("MealScout public data boundary contract: PASS");
