import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveGoogleMapsCredentials } from "../server/services/googleMapsCredentials";

const browserOnly = resolveGoogleMapsCredentials({
  VITE_GOOGLE_MAPS_WEB_API_KEY: "browser-referrer-key",
});
assert.equal(browserOnly.browserAuthorized, true);
assert.equal(browserOnly.serverAuthorized, false);
assert.equal(browserOnly.serverApiKey, "");
assert.equal(browserOnly.serverCredentialMode, "browser_only");

const serverOnly = resolveGoogleMapsCredentials({
  GOOGLE_MAPS_API_KEY: "server-authorized-key",
});
assert.equal(serverOnly.browserAuthorized, false);
assert.equal(serverOnly.serverAuthorized, true);
assert.equal(serverOnly.serverCredentialMode, "dedicated");

const both = resolveGoogleMapsCredentials({
  GOOGLE_MAPS_API_KEY: "server-authorized-key",
  VITE_GOOGLE_MAPS_API_KEY: "browser-referrer-key",
});
assert.equal(both.serverApiKey, "server-authorized-key");
assert.equal(both.browserApiKey, "browser-referrer-key");
assert.equal(both.serverCredentialMode, "dedicated");

const missing = resolveGoogleMapsCredentials({});
assert.equal(missing.browserAuthorized, false);
assert.equal(missing.serverAuthorized, false);
assert.equal(missing.serverCredentialMode, "missing");

const routes = readFileSync("server/routes/publicMapRoutes.ts", "utf8");
const geocoding = readFileSync("server/utils/geocoding.ts", "utf8");
const addressValidation = readFileSync(
  "server/utils/addressValidation.ts",
  "utf8",
);
const autocomplete = readFileSync(
  "client/src/components/maps/place-autocomplete-input.tsx",
  "utf8",
);
const parkingPass = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

assert.doesNotMatch(
  routes,
  /getGoogleMapsServerApiKey\(\)\s*\|\|\s*getGoogleMapsWebApiKey\(\)/,
  "A referrer-restricted browser key must never authorize a server request.",
);

for (const [name, utility] of [
  ["geocoding", geocoding],
  ["address validation", addressValidation],
] as const) {
  assert.match(
    utility,
    /getGoogleMapsServerApiKey/,
    `${name} must use the shared server-only Google credential resolver.`,
  );
  assert.doesNotMatch(
    utility,
    /VITE_GOOGLE/,
    `${name} must never fall back to an HTTP-referrer-restricted browser key.`,
  );
}
assert.doesNotMatch(
  routes,
  /const getGoogleMapsApiKey/,
  "The legacy browser-key server fallback must remain removed.",
);

const requiredRouteSnippets = [
  "getGoogleMapsServerApiKey",
  "resolveGoogleMapsCredentials",
  "serverAuthorized: hasServerMapsKey",
  "serverCredentialMode: credentials.serverCredentialMode",
  "usingBrowserKeyServerFallback: false",
  'app.get("/api/map/place-intelligence"',
  'app.get("/api/map/operator-support"',
  'reason: "server_places_not_configured"',
  'available: false',
  "fuelOptions",
  "parkingOptions",
  "accessibilityOptions",
  "routingSummaries",
  'textQuery: "propane supplier"',
  'textQuery: "restaurant supply store"',
  'textQuery: "commercial kitchen equipment repair"',
  'label: "area_activity"',
  "measuredFootTraffic",
];

for (const snippet of requiredRouteSnippets) {
  assert.ok(
    routes.includes(snippet),
    `Google API capability route missing snippet: ${snippet}`,
  );
}

for (const snippet of [
  'intent?: "destination" | "food"',
  'intent = "destination"',
  'url.searchParams.set("intent", intent)',
]) {
  assert.ok(
    autocomplete.includes(snippet),
    `Intent-aware autocomplete missing snippet: ${snippet}`,
  );
}

for (const snippet of [
  "/api/map/place-intelligence",
  "/api/map/operator-support",
  "Provider-backed place details",
  "No current provider prices were found for this spot.",
]) {
  assert.ok(
    parkingPass.includes(snippet),
    `Parking Pass API capability UI missing snippet: ${snippet}`,
  );
}

console.log("Parking Pass Google API capabilities contract OK");
