import { existsSync, readFileSync } from "node:fs";

const routeMapPath = "MEALSCOUT_ROUTE_MAP.md";
const appSource = readFileSync("client/src/App.tsx", "utf8");

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
  "Public route source inventory",
  "Legacy/dead-looking public surfaces to verify before editing",
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
  "`/scout`, `/scout/:refTag`, `/directory`, `/directory/:refTag`, `/scout-v2`, `/food-trucks` | `client/src/pages/explore-preview-v2.tsx`",
  "`/map` | `RedirectToScout` in `client/src/App.tsx`, then `client/src/pages/explore-preview-v2.tsx`",
  "The obsolete standalone map page has been retired.",
  "`/sitemap` | `client/src/pages/sitemap.tsx`",
  "`/restaurant/:id`, `/restaurant/:id/:profileSlug`, `/truck/:slug`, `/bar/:slug`, `/location/:slug`, `/p/:profileType/:profileId`, `/p/:profileType/:profileId/:profileSlug` | `client/src/pages/public-profile.tsx`",
  "`/city/:city/food`, `/food-trucks-today/:city`, `/deals-today/:city`, `/events-today/:city`, `/locations-with-trucks/:city`, `/cuisine/:cuisine/:city` | `client/src/pages/public-seo-landing.tsx`",
  "`/profile-setup` | `client/src/pages/profile-setup.tsx`",
  "The legacy `explore-preview.tsx` owner has been removed",
  "`client/src/pages/trending.tsx` exists, but `/trending` redirects to `/scout`",
].forEach((snippet) => requireIncludes(snippet, `public route source inventory ${snippet}`));

[
  'const ScoutPageV2 = lazy(() => import("@/pages/explore-preview-v2"));',
  '<Route path="/scout" component={ScoutPageV2} />',
  '<Route path="/scout/:refTag" component={ScoutPageV2} />',
  '<Route path="/directory" component={ScoutPageV2} />',
  '<Route path="/scout-v2" component={ScoutPageV2} />',
  '<Route path="/scout-prototype" component={RedirectToScout} />',
  '<Route path="/map" component={RedirectToScout} />',
  '<Route path="/trending" component={RedirectToScout} />',
  '<Route path="/sitemap" component={Sitemap} />',
  '<Route path="/profile-setup" component={ProfileSetupPage} />',
  '<Route path="/city/:city/food" component={PublicSeoLandingPage} />',
  '<Route path="/food-trucks-today/:city" component={PublicSeoLandingPage} />',
].forEach((snippet) => {
  if (!appSource.includes(snippet)) {
    throw new Error(`App route source missing expected routed surface: ${snippet}`);
  }
});

if (
  !/path="\/p\/:profileType\/:profileId\/:profileSlug"[\s\S]{0,120}component=\{PublicProfilePage\}/.test(
    appSource,
  )
) {
  throw new Error("App route source missing public profile slug route to PublicProfilePage.");
}

[
  '<Route path="/map" component={MapPage} />',
  'const MapPage = lazy(() => import("@/pages/map"));',
  '<Route path="/trending" component={Trending} />',
].forEach((snippet) => {
  if (appSource.includes(snippet)) {
    throw new Error(`App route source must not mount legacy public surface: ${snippet}`);
  }
});

[
  "/restaurant-owner-dashboard",
  "/restaurant/dashboard",
  "/owner-ai",
  "/merchant-delivery",
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
requireMatch(
  /registerMerchantDeliveryRoutes/i,
  "merchant delivery registration",
);
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
