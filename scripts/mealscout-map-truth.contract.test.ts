import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getEventCalendarDay,
  getRestaurantOpenState,
  getScoutRecenterDecision,
  shouldShowRestaurantMarker,
} from "../client/src/lib/scoutMapTruth";
import {
  expandPublicMapBounds,
  parsePublicMapBounds,
  toBoundedPublicMapLocationsPayload,
} from "../server/publicProfiles/toPublicMapLocations";

const scout = readFileSync(
  new URL("../client/src/pages/explore-preview-v2.tsx", import.meta.url),
  "utf8",
);
const googleMap = readFileSync(
  new URL(
    "../client/src/components/maps/google-map-surface.tsx",
    import.meta.url,
  ),
  "utf8",
);
const fallbackMap = readFileSync(
  new URL(
    "../client/src/components/maps/themed-scout-map-v2.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicMapRoutes = readFileSync(
  new URL("../server/routes/publicMapRoutes.ts", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing contract start: ${start}`);
  assert.ok(endIndex > startIndex, `Missing contract end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const compactMap = between(
  scout,
  'data-testid="scout-map-preview"',
  "{/* GoogleMapSurface:",
);
const compactGoogleIndex = compactMap.indexOf("<GoogleMapSurface");
const compactFallbackIndex = compactMap.indexOf("<ThemedScoutMap");
assert.ok(compactGoogleIndex >= 0, "Compact Scout must render Google Maps.");
assert.ok(
  compactFallbackIndex >= 0,
  "Compact Scout must retain a no-key/error fallback.",
);
assert.ok(
  compactGoogleIndex < compactFallbackIndex,
  "The local-tile map must be a fallback, not the primary compact renderer.",
);
assert.match(
  compactMap,
  /hasMapKey\s*&&\s*!googleMapFailed\s*&&\s*mapCenter\s*\?/,
  "Compact Scout must prefer the real map whenever Google Maps is healthy.",
);
assert.doesNotMatch(
  scout,
  /decorative teaser|Premium overlay frame|rgba\(11,8,6,0\.62\)/i,
  "The customer map must not be decoration or covered by the dark teaser grade.",
);

const googleTags = scout.match(/<GoogleMapSurface[\s\S]*?\/>/g) || [];
assert.equal(googleTags.length, 2, "Scout must have compact and full Google maps.");
for (const tag of googleTags) {
  assert.match(tag, /useNativeMapStyle=\{false\}/);
  assert.match(tag, /isNightTheme=\{false\}/);
}
assert.match(googleTags[0], /showZoomControls=\{false\}/);
assert.match(googleTags[1], /showZoomControls=\{true\}/);
assert.match(googleMap, /useNativeMapStyle[\s\S]*styles\s*=\s*null/);
assert.match(googleMap, /mapStyleFoodDay/);
assert.match(googleMap, /data-google-map-loading="true"/);
assert.match(googleMap, /tilesLoadedListenerRef\.current/);
assert.match(googleMap, /idleListenerRef\.current\?\.remove/);
assert.match(googleMap, /layoutTimeoutIdsRef\.current[\s\S]*clearTimeout/);
assert.match(googleMap, /clearInstanceListeners/);
assert.match(googleMap, /mapRef\.current\s*=\s*null/);

for (const distortion of [
  "dark_all",
  "driftRafRef",
  "mix-blend-mode: screen",
  'aria-label="Live map"',
]) {
  assert.ok(
    !fallbackMap.includes(distortion),
    `Fallback map must not restore visual/status distortion: ${distortion}`,
  );
}
assert.doesNotMatch(fallbackMap, /filter:\s*blur\(/);
assert.doesNotMatch(fallbackMap, /pitch:\s*(?:[1-9]|-[1-9])/);
assert.doesNotMatch(fallbackMap, /bearing:\s*(?:[1-9]|-[1-9])/);
assert.match(fallbackMap, /rastertiles\/voyager/);
assert.match(fallbackMap, /showUserLocation\s*=\s*false/);
assert.match(fallbackMap, /mapHasLoadedRef\.current/);
assert.doesNotMatch(fallbackMap, /map\.loaded\(\)/);

const resolvedLocation = between(
  scout,
  "const resolvedScoutLocation = useMemo",
  "const resolvedScoutCoords",
);
assert.ok(
  resolvedLocation.indexOf("if (deviceCoords)") <
    resolvedLocation.indexOf("if (savedLocation)"),
  "Fresh device coordinates must win over an older saved location.",
);
assert.match(
  scout,
  /resolvedScoutLocation\?\.source === "device" \? resolvedScoutCoords : null/,
  "Only verified device coordinates may create a You-are-here pin.",
);
assert.deepEqual(
  getScoutRecenterDecision({
    source: "device",
    lastCenteredSource: "saved",
    userPushedMap: true,
  }),
  { freshDeviceLocation: true, shouldRecenter: true },
  "The first device fix must override initial map-idle callbacks.",
);
assert.equal(
  getScoutRecenterDecision({
    source: "device",
    lastCenteredSource: "device",
    userPushedMap: true,
  }).shouldRecenter,
  false,
  "A real user pan after device centering must be preserved.",
);
assert.match(
  scout,
  /getScoutRecenterDecision\([\s\S]*shiftCenterForRightQuadrant/,
);

const openStateCases: Array<[unknown, ReturnType<typeof getRestaurantOpenState>]> = [
  [{ isOpen: true }, "open"],
  [{ isOpen: false, status: "open" }, "closed"],
  [{ isOpen: "true" }, "open"],
  [{ isOpen: "false" }, "closed"],
  [{ status: "open" }, "open"],
  [{ status: "not open" }, "closed"],
  [{ status: "not currently open" }, "closed"],
  [{ status: "not_open" }, "closed"],
  [{ status: "temporarily_closed" }, "closed"],
  [{ status: "operational" }, "unknown"],
  [{}, "unknown"],
];
for (const [source, expected] of openStateCases) {
  assert.equal(getRestaurantOpenState(source), expected);
}
assert.equal(
  shouldShowRestaurantMarker({
    openState: "closed",
    hasDeal: false,
    showOpenNow: true,
    showDeals: false,
  }),
  false,
);
assert.equal(
  shouldShowRestaurantMarker({
    openState: "open",
    hasDeal: false,
    showOpenNow: true,
    showDeals: false,
  }),
  true,
);
assert.equal(
  shouldShowRestaurantMarker({
    openState: "open",
    hasDeal: true,
    showOpenNow: true,
    showDeals: false,
  }),
  true,
  "Turning Deals off must not hide an otherwise open restaurant.",
);
assert.equal(
  shouldShowRestaurantMarker({
    openState: "closed",
    hasDeal: true,
    showOpenNow: false,
    showDeals: true,
  }),
  true,
  "A closed restaurant may appear only as a truthful deal result.",
);

assert.equal(
  getEventCalendarDay({
    date: "2026-07-17T00:00:00.000Z",
    startsAt: "2026-07-16T19:00:00-05:00",
  }),
  "2026-07-17",
  "The event's calendar date must not shift to the prior US-local day.",
);
assert.equal(
  getEventCalendarDay({ startsAt: "2026-08-03T18:30:00.000Z" }),
  "2026-08-03T18:30:00.000Z",
  "Without a canonical event date, retain the instant for local-time comparison.",
);

const truckMarkers = between(
  scout,
  "const truckMarkers = useMemo",
  "const liveTruckById",
);
assert.match(truckMarkers, /\.filter\(isTruckBroadcastLive\)/);

const restaurantMarkers = between(
  scout,
  "const restaurantMarkers = useMemo",
  "const eventMarkers",
);
assert.match(restaurantMarkers, /resolveCoordinatePair\(r\.latitude, r\.longitude\)/);
assert.match(restaurantMarkers, /isOpen:\s*openState === "open"/);
assert.doesNotMatch(restaurantMarkers, /isOpen:\s*true/);

const markerFilter = between(
  scout,
  "const filteredMapMarkers = useMemo",
  "const sceneFilteredMapMarkers",
);
assert.match(markerFilter, /shouldShowRestaurantMarker/);
assert.doesNotMatch(
  scout,
  /nearbyHosts\.length\s*>\s*0\s*\?\s*nearbyHosts\s*:\s*rows/,
);
assert.match(
  scout,
  /parkingStatus:\s*parkedTrucks\.length\s*>\s*0\s*\?\s*"occupied"\s*:\s*null/,
);
assert.match(
  scout,
  /resolveCoordinatePair\(event\.host\?\.latitude, event\.host\?\.longitude\)/,
);
assert.match(
  scout,
  /\.filter\(\(event\) => isTodayDate\(getEventCalendarDay\(event\)\)\)/,
);
assert.match(markerFilter, /hasParkedTruck\s*&&[\s\S]*activeMapLayers\.happeningToday/);

const allMapMarkers = between(
  scout,
  "const allMapMarkers = useMemo",
  "const scoutDebugCounts",
);
assert.doesNotMatch(allMapMarkers, /activityFallback|network/);

const markerCounts = between(
  scout,
  "const sceneMapMarkerCounts = useMemo",
  "const toggleMapLayer",
);
assert.match(markerCounts, /pinCount:\s*sceneFilteredMapMarkers\.length/);
for (const kind of ["truck", "restaurant", "deal", "event"]) {
  assert.match(markerCounts, new RegExp(`marker\\.kind === "${kind}"`));
}
const hudCall = between(scout, "<ScoutMapHud", "/>");
assert.match(hudCall, /pinCount=\{sceneMapMarkerCounts\.pinCount\}/);
assert.doesNotMatch(hudCall, /liveTrucks\.length|visibleEvents|visibleHosts|allDeals/);
const hudSource = between(scout, "function ScoutMapHud", "function MapHudCount");
assert.match(hudSource, /isExpanded && pinCount === 0/);
assert.doesNotMatch(hudSource, /pan the map/i);
const pipsSource = between(scout, "function MapActivityPips", "function MapLayerToggles");
assert.match(pipsSource, /label: "Food places"/);
assert.doesNotMatch(pipsSource, /Open places/);

const bounds = { north: 31, south: 29, east: -86, west: -88 };
const bounded = toBoundedPublicMapLocationsPayload(
  {
    hostLocations: [
      { id: "host-local", latitude: "30.4", longitude: "-87.2" },
      { id: "host-empty", latitude: "", longitude: "" },
      { id: "host-away", latitude: 40.7, longitude: -74 },
    ],
    eventLocations: [
      { id: "event-local", hostLatitude: 30.5, hostLongitude: -87.1 },
      { id: "event-unlocated", hostAddress: "Pensacola" },
      { id: "event-away", hostLatitude: 34.1, hostLongitude: -118.2 },
    ],
    supplierLocations: [
      { id: "supplier-local", latitude: 30.3, longitude: -87.3 },
      { id: "supplier-away", latitude: 47.6, longitude: -122.3 },
    ],
  },
  bounds,
);
assert.deepEqual(bounded.hostLocations.map((row) => row.id), ["host-local"]);
assert.deepEqual(bounded.eventLocations.map((row) => row.id), ["event-local"]);
assert.deepEqual(bounded.supplierLocations.map((row) => row.id), ["supplier-local"]);

const unwrappedDatelineBounds = parsePublicMapBounds({
  north: 10,
  south: -10,
  west: 179.5,
  east: 180.5,
});
assert.deepEqual(unwrappedDatelineBounds, {
  north: 10,
  south: -10,
  west: 179.5,
  east: -179.5,
});
const datelineBounded = toBoundedPublicMapLocationsPayload(
  {
    hostLocations: [
      { id: "east-dateline", latitude: 0, longitude: 179.8 },
      { id: "west-dateline", latitude: 0, longitude: -179.8 },
      { id: "outside-dateline", latitude: 0, longitude: 0 },
    ],
  },
  unwrappedDatelineBounds,
);
assert.deepEqual(
  datelineBounded.hostLocations.map((row) => row.id),
  ["east-dateline", "west-dateline"],
);

const worldBounds = parsePublicMapBounds({
  north: 90,
  south: -90,
  west: -180,
  east: 180,
});
assert.deepEqual(worldBounds, { north: 90, south: -90, west: -180, east: 180 });
assert.deepEqual(expandPublicMapBounds(worldBounds, 0.12), worldBounds);
assert.deepEqual(
  expandPublicMapBounds(
    { north: 80, south: -80, west: -179.95, east: 179.95 },
    0.1,
  ),
  { north: 80.1, south: -80.1, west: -180, east: 180 },
  "Padding a near-world viewport must preserve all longitudes.",
);
assert.equal(
  toBoundedPublicMapLocationsPayload(
    {
      hostLocations: [
        { id: "west", latitude: 0, longitude: -120 },
        { id: "center", latitude: 0, longitude: 0 },
        { id: "east", latitude: 0, longitude: 120 },
      ],
    },
    worldBounds,
  ).hostLocations.length,
  3,
);

for (const invalid of [
  { north: "", south: -10, west: -20, east: 20 },
  { north: 91, south: -10, west: -20, east: 20 },
  { north: 10, south: -91, west: -20, east: 20 },
  { north: 10, south: -10, west: -20, east: 541 },
  { north: 10, south: -10, west: -200, east: 200 },
]) {
  assert.equal(parsePublicMapBounds(invalid), null);
}

const mapRoute = between(
  publicMapRoutes,
  'app.get("/api/map/locations"',
  'app.post("/api/public/truck-sightings"',
);
assert.equal(
  (mapRoute.match(/res\.json\(toRequestedMapPayload\(/g) || []).length,
  3,
  "Cache, fresh, and recent-stale map responses must all be bounded.",
);
assert.match(mapRoute, /status\(503\)/);
assert.match(mapRoute, /Cache-Control", "no-store"/);
assert.match(mapRoute, /X-MealScout-Degraded/);
assert.match(mapRoute, /MAP_LOCATIONS_UNAVAILABLE/);
assert.match(publicMapRoutes, /MAP_LOCATIONS_MAX_STALE_MS/);
assert.match(publicMapRoutes, /capturedAt/);

const mapQuery = between(
  scout,
  'queryKey: mapBoundsForScout',
  'const allScoutHostLocations',
);
assert.match(mapQuery, /if \(!response\.ok\)\s*\{[\s\S]*throw new Error/);

const overlaysRoute = between(
  publicMapRoutes,
  'app.get("/api/map/overlays"',
  'app.get("/api/map/route-summary"',
);
assert.match(overlaysRoute, /toBoundedPublicMapLocationsPayload/);
assert.match(overlaysRoute, /expandPublicMapBounds\(bounds, pad\)/);
assert.match(overlaysRoute, /version = String\(snapshot\.capturedAt\)/);
assert.match(overlaysRoute, /status\(503\)/);
assert.doesNotMatch(overlaysRoute, /hostAddress/);

console.log("mealscout-map-truth.contract: PASS");
