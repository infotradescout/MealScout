import { readFileSync } from "node:fs";

const routes = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

const routeSnippets = [
  '"/api/restaurants/:restaurantId/owner-value-dashboard"',
  'window must be 7d or 30d',
  "verifyRestaurantOwnership",
  "viewAnalytics",
  "profileViews",
  "menuClicks",
  "directionsClicks",
  "callClicks",
  "websiteClicks",
  "orderClicks",
  "deliveryClicks",
  "qrOpens",
  "topActions",
  "recommendations",
  "generatedAt",
  "freshnessLabel",
];

for (const snippet of routeSnippets) {
  if (!routes.includes(snippet)) {
    throw new Error(`Owner value dashboard route contract missing: ${snippet}`);
  }
}

if (routes.includes("res.json({ logs")) {
  throw new Error("Owner value dashboard must not expose raw event logs");
}

// The owner dashboard's analytics panel was migrated from the
// menuClicks/directionsClicks/callClicks/qrOpens breakdown this test
// originally checked to a newer /api/owner/value-attribution-backed
// panel (discoveryImpressions/ctaClicks/shareOpens/highIntentActions).
// The old /api/restaurants/:restaurantId/owner-value-dashboard route
// checked by routeSnippets above still exists server-side but the
// frontend no longer calls it -- update the UI checks to the panel
// that's actually rendered now.
const uiSnippets = [
  "Profile value",
  "7 days",
  "30 days",
  "Profile views",
  "Discovery impressions",
  "CTA clicks",
  "Share opens",
  "High-intent actions",
  "Last activity",
  "Open QR Kit",
  "Copy public profile link",
  "/api/owner/value-attribution",
];

for (const snippet of uiSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner value dashboard UI contract missing: ${snippet}`);
  }
}

console.log("owner-value-dashboard.contract: PASS");
