import assert from "node:assert/strict";
import {
  getBusinessCapabilities,
  toCanonicalFoodBusinessType,
} from "../shared/businessTypes";
import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
  visitStatusFromPresence,
} from "../shared/consumerEntity";
import { resolveBusinessMedia } from "../client/src/lib/businessMedia";
import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";
import {
  primaryPublicCta,
  rankPublicCtas,
} from "../client/src/components/public-profile/profileActionPolicy";

function cta(type: string, href: string, safe = true) {
  return { type, href, safe, label: type } as any;
}

assert.equal(toCanonicalFoodBusinessType(" FOOD-TRUCK "), "food_truck");
assert.equal(toCanonicalFoodBusinessType("brewery"), "bar");
assert.equal(toCanonicalFoodBusinessType("caterer"), "caterer");
assert.equal(toCanonicalFoodBusinessType("private_chef"), "private_chef");
assert.equal(toCanonicalFoodBusinessType("venue"), null);
assert.equal(toCanonicalFoodBusinessType("ghost_kitchen"), null);
assert.equal(getBusinessCapabilities("food_truck")?.liveLocationBroadcast, true);
assert.equal(getBusinessCapabilities("private_chef")?.recurringHours, false);

const now = new Date("2026-07-13T15:00:00.000Z");
const fresh = deriveTruckPresence(
  {
    mobileOnline: true,
    currentLatitude: "30.4213",
    currentLongitude: "-87.2169",
    lastBroadcastAt: "2026-07-13T14:58:00.000Z",
    liveUntilAt: "2026-07-13T15:30:00.000Z",
    locationSource: "gps",
    gpsAccuracy: 12,
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.equal(fresh.broadcastState, "live");
assert.equal(fresh.reason, "fresh_broadcast");
assert.equal(visitStatusFromPresence(fresh)?.state, "live_now");
assert.equal(DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS, 4 * 60 * 60 * 1000);

const liveSource = deriveTruckPresence(
  {
    mobileOnline: true,
    currentLatitude: 30.4213,
    currentLongitude: -87.2169,
    lastBroadcastAt: "2026-07-13T14:58:00.000Z",
    locationSource: "live",
  },
  { now, freshnessMs: DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS },
);
assert.equal(liveSource.location?.source, "owner_gps");

const serializedLiveTruck = toPublicRestaurantProfile({
  row: {
    id: "truck-live",
    name: "Live Truck",
    isFoodTruck: true,
    mobileOnline: true,
    currentLatitude: "30.4213",
    currentLongitude: "-87.2169",
    lastBroadcastAt: new Date(),
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "truck",
});
assert.equal(serializedLiveTruck.truckPresence?.broadcastState, "live");
assert.equal(serializedLiveTruck.truckPresence?.location?.source, "owner_gps");
assert.match(
  serializedLiveTruck.cta.find((action) => action.type === "map")?.href || "",
  /30\.4213,-87\.2169/,
);

const serializedStaleTruck = toPublicRestaurantProfile({
  row: {
    id: "truck-stale",
    name: "Stale Truck",
    isFoodTruck: true,
    mobileOnline: true,
    currentLatitude: "30.4213",
    currentLongitude: "-87.2169",
    lastBroadcastAt: "2020-01-01T00:00:00.000Z",
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "truck",
});
assert.equal(serializedStaleTruck.truckPresence?.broadcastState, "stale");
assert.equal(serializedStaleTruck.truckPresence?.location, null);
assert.equal(
  serializedStaleTruck.cta.some((action) => action.type === "map"),
  false,
  "Stale live coordinates must not leak into public directions",
);

const stale = deriveTruckPresence(
  {
    mobileOnline: true,
    currentLatitude: 30.4213,
    currentLongitude: -87.2169,
    lastBroadcastAt: "2026-07-13T14:30:00.000Z",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.equal(stale.broadcastState, "stale");
assert.equal(stale.reason, "broadcast_expired");
assert.equal(visitStatusFromPresence(stale), null);

const missingTimestamp = deriveTruckPresence(
  {
    mobileOnline: true,
    currentLatitude: 30.4213,
    currentLongitude: -87.2169,
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.equal(missingTimestamp.broadcastState, "stale");
assert.equal(missingTimestamp.reason, "missing_timestamp");

const expired = deriveTruckPresence(
  {
    mobileOnline: true,
    currentLatitude: 30.4213,
    currentLongitude: -87.2169,
    lastBroadcastAt: "2026-07-13T14:59:00.000Z",
    liveUntilAt: "2026-07-13T14:59:30.000Z",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.equal(expired.broadcastState, "stale");

const offline = deriveTruckPresence(
  {
    mobileOnline: false,
    currentLatitude: 30.4213,
    currentLongitude: -87.2169,
    lastBroadcastAt: "2026-07-13T14:59:00.000Z",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.equal(offline.broadcastState, "offline");

const restaurantActions = rankPublicCtas(
  [cta("map", "/map"), cta("menu", "/menu"), cta("order", "/order")],
  "restaurant",
);
assert.deepEqual(
  restaurantActions.map((action) => action.type),
  ["order", "menu", "map"],
);

const truckActions = rankPublicCtas(
  [
    cta("order", "/order"),
    cta("map", "https://maps.example"),
    cta("menu", "/menu"),
    cta("phone", "tel:123", false),
  ],
  "truck",
);
assert.deepEqual(
  truckActions.map((action) => action.type),
  ["map", "order", "menu"],
);
assert.equal(primaryPublicCta(truckActions, "truck")?.type, "map");

const publicHero = resolveBusinessMedia(
  [
    {
      kind: "gallery",
      image: "https://example.com/pending.jpg",
      publicApproved: false,
    },
    {
      kind: "cover",
      image: "https://example.com/cover.jpg",
      publicApproved: true,
    },
    {
      kind: "logo",
      image: "https://example.com/logo.jpg",
      publicApproved: false,
    },
  ],
  "profile_hero",
);
assert.equal(publicHero?.url, "https://example.com/cover.jpg");

const publicGallery = resolveBusinessMedia(
  [
    {
      kind: "gallery",
      image: "https://example.com/pending.jpg",
      publicApproved: false,
    },
  ],
  "profile_gallery",
);
assert.equal(publicGallery, null);

const ownerPreview = resolveBusinessMedia(
  [
    {
      kind: "cover",
      image: "https://example.com/pending-cover.jpg",
      publicApproved: false,
    },
  ],
  "owner_preview",
  { ownerView: true },
);
assert.equal(ownerPreview?.url, "https://example.com/pending-cover.jpg");

console.log("MealScout consumer entity foundation contract: PASS");
