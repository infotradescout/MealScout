import { existsSync, readFileSync } from "node:fs";

const routeMapPath = "MEALSCOUT_ROUTE_MAP.md";

if (!existsSync(routeMapPath)) {
  throw new Error("MEALSCOUT_ROUTE_MAP.md must exist.");
}

const routeMap = readFileSync(routeMapPath, "utf8");

function requireIncludes(snippet: string, label = snippet) {
  if (!routeMap.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Route map missing ${label}.`);
  }
}

function requireMatch(pattern: RegExp, label: string) {
  if (!pattern.test(routeMap)) {
    throw new Error(`Route map missing ${label}.`);
  }
}

[
  "client/src/App.tsx",
  "server/routes.ts",
  "Public Customer Routes",
  "Owner / Truck Routes",
  "Host / Event Routes",
  "Parking Pass Routes",
  "Admin / Staff Routes",
  "Server Route Registration Map",
  "Danger Routes",
  "Validation Routes",
  "Trace Examples",
].forEach((snippet) => requireIncludes(snippet));

[
  "/",
  "/scout",
  "/search",
  "/map",
  "/p/:profileType/:profileId/:profileSlug",
  "/food-trucks-today/:city",
  "/deals-today/:city",
  "/events-today/:city",
  "/locations-with-trucks/:city",
  "/menu/:restaurantId",
].forEach((snippet) => requireIncludes(snippet, `public customer route ${snippet}`));

[
  "/restaurant-owner-dashboard",
  "/restaurant/dashboard",
  "/claim-truck",
  "/account-setup",
  "/owner/verify",
  "/post-verification",
].forEach((snippet) => requireIncludes(snippet, `owner/truck route ${snippet}`));

[
  "/host-signup",
  "/host/dashboard",
  "/events",
  "/event/:slug",
].forEach((snippet) => requireIncludes(snippet, `host/event route ${snippet}`));

[
  "/parking-pass",
  "/parking-pass-manage",
  "/parking-pass/manage",
  "not present in `client/src/App.tsx`",
].forEach((snippet) => requireIncludes(snippet, `Parking Pass route ${snippet}`));

[
  "/admin",
  "/admin/dashboard",
  "/staff",
  "/admin/incidents",
  "/admin/telemetry",
  "/admin/geo/heatmap",
].forEach((snippet) => requireIncludes(snippet, `admin/staff route ${snippet}`));

[
  "Auth/account",
  "Public discovery/profile/SEO/search",
  "Restaurant operations",
  "Menu/order",
  "Host/event/booking",
  "Parking Pass/payment/webhook",
  "Admin/staff",
  "Analytics/Launch Board",
  "Media/uploads",
  "Support/moderation",
  "Supplier",
  "Growth/referral",
].forEach((snippet) => requireIncludes(snippet, `server route group ${snippet}`));

[
  "/admin/dashboard",
  "/api/admin/launch-board",
  "/api/admin/users/:id/verify-insurance",
  "/api/admin/claim-pitches",
  "/api/hosts/parking-pass",
  "/api/parking-pass/:passId/book",
  "/api/bookings/*",
  "/api/stripe/webhook",
  "/api/restaurants/:restaurantId/mobile-settings",
  "/api/restaurants/:restaurantId/location",
].forEach((snippet) => requireIncludes(snippet, `danger route ${snippet}`));

[
  "/api/health",
  "/health/ready",
  "/p/truck/t1/taco-bandito",
  "GET https://www.mealscout.us/scout",
  "GET https://www.mealscout.us/parking-pass",
  "admin launch-board",
  "guest auth rejection",
  "IndexNow",
  "requires fixtures, staging, or explicit production-test-record approval",
].forEach((snippet) => requireIncludes(snippet, `production gate expectation ${snippet}`));

[
  "Public user enters `/scout`",
  "Customer opens `/p/...`",
  "Truck owner reaches dashboard",
  "Host creates/open spots",
  "Admin reads Launch Board",
  "Parking Pass booking path starts",
].forEach((snippet) => requireIncludes(snippet, `trace example ${snippet}`));

requireMatch(/registerPublicDiscoveryRoutes[\s\S]*registerPublicMapRoutes/i, "public backend registrations");
requireMatch(/registerHostRoutes[\s\S]*registerBookingRoutes/i, "host booking backend registrations");
requireMatch(/registerStripeWebhookRoutes/i, "stripe webhook registration");

if (/Merlin[^.\n]*active project/i.test(routeMap) || /active project[^.\n]*Merlin/i.test(routeMap)) {
  throw new Error("Route map describes Merlin as an active project.");
}

const featureLines = routeMap
  .split(/\r?\n/)
  .filter((line) => /new product feature|new dashboard|new monetization flow|new provider integration/i.test(line));
for (const line of featureLines) {
  if (!/(no |not |disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Route map appears to propose product feature scope: ${line}`);
  }
}

console.log("mealscout-route-map.contract: PASS");
