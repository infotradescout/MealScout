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

const uiSnippets = [
  "Profile value",
  "7 days",
  "30 days",
  "Profile views",
  "Menu clicks",
  "Directions clicks",
  "Calls",
  "Orders / delivery",
  "QR opens",
  "Top customer actions",
  "Recommended next action",
  "No customer activity recorded yet.",
  "Open QR Kit",
  "Copy public profile link",
  "owner-value-dashboard?window=",
];

for (const snippet of uiSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner value dashboard UI contract missing: ${snippet}`);
  }
}

console.log("owner-value-dashboard.contract: PASS");
