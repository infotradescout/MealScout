import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getBusinessCapabilities,
  toCanonicalFoodBusinessType,
} from "../shared/businessTypes";
import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
  resolveCoordinatePair,
  resolveTruckCoordinates,
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
assert.equal(
  toCanonicalFoodBusinessType("venue"),
  "bar",
  "legacy food-business venue values must retain their prior bar/nightlife meaning",
);
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

assert.deepEqual(
  resolveCoordinatePair(" 30.4213 ", " -87.2169 "),
  { latitude: 30.4213, longitude: -87.2169 },
  "Coordinate pairs must accept finite numeric strings",
);
assert.equal(resolveCoordinatePair("91", "-87.2169"), null);
assert.equal(resolveCoordinatePair("30.4213", "-181"), null);
assert.equal(resolveCoordinatePair(true, -87.2169), null);

const freshLiveCoordinates = resolveTruckCoordinates(
  {
    mobileOnline: true,
    currentLatitude: "31.1001",
    currentLongitude: "-88.2002",
    lastBroadcastAt: "2026-07-13T14:58:00.000Z",
    latitude: "30.4213",
    longitude: "-87.2169",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.deepEqual(
  freshLiveCoordinates,
  { latitude: 31.1001, longitude: -88.2002 },
  "A complete fresh live pair must take precedence over static profile coordinates",
);

const staleLiveCoordinates = resolveTruckCoordinates(
  {
    mobileOnline: true,
    currentLatitude: 31.1001,
    currentLongitude: -88.2002,
    lastBroadcastAt: "2026-07-13T14:30:00.000Z",
    latitude: "30.4213",
    longitude: "-87.2169",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.deepEqual(
  staleLiveCoordinates,
  { latitude: 30.4213, longitude: -87.2169 },
  "Stale live coordinates must fall back to the complete static pair",
);

const partialLiveCoordinates = resolveTruckCoordinates(
  {
    mobileOnline: true,
    currentLatitude: 31.1001,
    currentLongitude: null,
    lastBroadcastAt: "2026-07-13T14:58:00.000Z",
    latitude: 30.4213,
    longitude: -87.2169,
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.deepEqual(
  partialLiveCoordinates,
  { latitude: 30.4213, longitude: -87.2169 },
  "A partial live pair must never borrow one static axis",
);

const aliasedStaticCoordinates = resolveTruckCoordinates(
  {
    mobileOnline: true,
    currentLatitude: "not-a-coordinate",
    currentLongitude: "-88.2002",
    lastBroadcastAt: "2026-07-13T14:58:00.000Z",
    latitude: 30.4213,
    longitude: null,
    lat: "29.9876",
    lng: "-86.5432",
  },
  { now, freshnessMs: 5 * 60_000 },
);
assert.deepEqual(
  aliasedStaticCoordinates,
  { latitude: 29.9876, longitude: -86.5432 },
  "Static coordinate aliases must also resolve as a complete pair",
);

assert.equal(
  resolveTruckCoordinates(
    {
      mobileOnline: true,
      currentLatitude: 95,
      currentLongitude: -88.2002,
      lastBroadcastAt: "2026-07-13T14:58:00.000Z",
      latitude: 91,
      longitude: -87.2169,
      lat: null,
      lng: null,
    },
    { now, freshnessMs: 5 * 60_000 },
  ),
  null,
  "Out-of-range live and static pairs must be rejected",
);

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

const serializedRestaurantHours = toPublicRestaurantProfile({
  row: {
    id: "restaurant-hours",
    name: "Hours Restaurant",
    hoursSummary: "Mon-Fri 9:00 AM-5:00 PM",
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "restaurant",
});
assert.equal(
  serializedRestaurantHours.operatingHoursSummary,
  "Mon-Fri 9:00 AM-5:00 PM",
);
assert.equal(
  serializedRestaurantHours.hours,
  serializedRestaurantHours.operatingHoursSummary,
  "The deprecated hours alias must remain compatible during migration",
);

for (const path of [
  "client/src/pages/public-profile.tsx",
  "client/src/components/public-profile/RestaurantHoursPanel.tsx",
  "client/src/components/public-profile/PublicProfileDecisionBar.tsx",
  "client/src/components/public-profile/WhyGoNowPanel.tsx",
  "client/src/components/public-profile/ThinProfileState.tsx",
  "client/src/components/public-profile/ElevatedProfileHero.tsx",
]) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  assert.doesNotMatch(
    source,
    /profile\.hours\b/,
    `${path} must use operatingHoursSummary, not the ambiguous hours alias`,
  );
}

const ownerDashboardSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/restaurant-owner-dashboard.tsx"),
  "utf8",
);
assert.match(
  ownerDashboardSource,
  /import \{[\s\S]*deriveTruckPresence[\s\S]*\} from "@shared\/consumerEntity"/,
);
assert.match(
  ownerDashboardSource,
  /serverTruckPresence\.broadcastState === "live"/,
);
assert.doesNotMatch(
  ownerDashboardSource,
  /Boolean\(\s*\(currentRestaurant as any\)\.mobileOnline/,
  "Owner readiness must not infer live state from mobileOnline alone",
);

const storageSource = readFileSync(
  resolve(process.cwd(), "server/storage.ts"),
  "utf8",
);
assert.match(storageSource, /presence: deriveTruckPresence\(/);
assert.doesNotMatch(
  storageSource,
  /const freshnessCutoffMs = Date\.now\(\)/,
  "Live-truck storage must use the canonical freshness policy",
);

const scoutSurfaceSource = readFileSync(
  resolve(process.cwd(), "server/services/scoutSurfaceService.ts"),
  "utf8",
);
assert.match(scoutSurfaceSource, /deriveTruckPresence\(/);
assert.doesNotMatch(
  scoutSurfaceSource,
  /return truck\?\.mobileOnline === true/,
  "Server Scout cards must not infer serving state from mobileOnline alone",
);

const dealCardSource = readFileSync(
  resolve(process.cwd(), "client/src/components/deal-card.tsx"),
  "utf8",
);
assert.match(dealCardSource, /deriveTruckPresence\(/);
assert.doesNotMatch(
  dealCardSource,
  /!!deal\.restaurant\?\.mobileOnline/,
  "Deal cards must not show Live now from mobileOnline alone",
);

const scoutSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/explore-preview-v2.tsx"),
  "utf8",
);
assert.match(scoutSource, /return isTruckBroadcastLive\(truck\)/);
assert.match(
  scoutSource,
  /currentLatitude: truck\.currentLatitude,\s*currentLongitude: truck\.currentLongitude,/,
  "Scout presence checks must receive only the current broadcast pair",
);
assert.doesNotMatch(
  scoutSource,
  /currentLatitude: truck\.currentLatitude \?\?/,
  "Scout presence checks must never substitute a static latitude",
);
assert.match(
  scoutSource,
  /resolveTruckCoordinates\(truck,/,
  "Scout maps, radius checks, and directions must share pairwise coordinate resolution",
);
assert.doesNotMatch(
  scoutSource,
  /return truck\.liveBroadcasting === true/,
  "Scout must not fall back to an unvalidated liveBroadcasting flag",
);
assert.doesNotMatch(
  scoutSource,
  /imageUrl: r\.coverImageUrl \|\| r\.logoUrl \|\| r\.imageUrl/,
  "Scout map cards must use the shared business media resolver",
);
assert.doesNotMatch(
  scoutSource,
  /const img =\s*restaurant\.coverImageUrl \|\|/,
  "Saved Scout cards must use the shared business media resolver",
);

const publicProfileSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/public-profile.tsx"),
  "utf8",
);
assert.match(
  publicProfileSource,
  /const truckMedia = buildPublicProfileHeroAssets\(/,
);
assert.doesNotMatch(
  publicProfileSource,
  /truck\.coverImageUrl \|\| truck\.logoUrl \|\| truck\.imageUrl/,
  "Public discovery truck cards must use the shared profile media policy",
);

const publicDiscoverySource = readFileSync(
  resolve(process.cwd(), "server/routes/publicDiscoveryRoutes.ts"),
  "utf8",
);
assert.match(publicDiscoverySource, /const truckPresence = deriveTruckPresence\(/);
assert.doesNotMatch(
  publicDiscoverySource,
  /liveLocationActive: Boolean\(row\.mobileOnline\)/,
  "Public canonical metadata must not expose stale mobileOnline rows as live",
);

for (const path of [
  "server/seo/publicProfilePrerender.ts",
  "server/routes/publicSeoLandingRoutes.ts",
  "server/routes/seoRoutes.ts",
]) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(
    source,
    /isTruckBusinessType|isBarBusinessType|toCanonicalFoodBusinessType/,
    `${path} must use the canonical business taxonomy`,
  );
  assert.doesNotMatch(
    source,
    /businessType === "(?:food_truck|bar)"/,
    `${path} must not hardcode public business-type routing`,
  );
}

const slugOwnershipSource = readFileSync(
  resolve(
    process.cwd(),
    "server/publicProfiles/publicBusinessSlugOwnership.ts",
  ),
  "utf8",
);
assert.match(slugOwnershipSource, /isTruckBusinessType\(row\.businessType\)/);
assert.match(slugOwnershipSource, /isBarBusinessType\(row\.businessType\)/);
assert.doesNotMatch(
  slugOwnershipSource,
  /row\.businessType === "(?:food_truck|bar)"/,
  "Clean public slugs must use the canonical business taxonomy",
);

const dealDiscoverySource = readFileSync(
  resolve(process.cwd(), "server/routes/dealDiscoveryRoutes.ts"),
  "utf8",
);
assert.match(dealDiscoverySource, /entityPath: buildPublicProfilePath\(/);
assert.match(dealDiscoverySource, /: "restaurant",/);
assert.doesNotMatch(
  dealDiscoverySource,
  /row\.businessType === "bar"/,
  "Deal discovery must route restaurant, truck, and bar profiles canonically",
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
