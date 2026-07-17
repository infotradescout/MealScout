import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const normalizedOwnerDashboard = ownerDashboard.replace(/\s+/g, " ");
const ownerAttributionClient = readFileSync(
  "client/src/lib/owner-value-attribution-client.ts",
  "utf8",
);
const ownerAttributionRoute = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
);

const requiredRouteSnippets = [
  'app.get("/api/owner/value-attribution"',
  "isAuthenticated",
  "window must be 7d or 30d",
  "getBusinessAccessContext",
  "profileViews",
  "discoveryImpressions",
  "ctaClicks",
  "shareOpens",
  "highIntentActions",
  "topSources",
  "lastActivityAt",
];

for (const snippet of requiredRouteSnippets) {
  if (!ownerAttributionRoute.includes(snippet)) {
    throw new Error(`Owner attribution route contract missing: ${snippet}`);
  }
}

const requiredUiSnippets = [
  "7 days",
  "30 days",
  "Loading owner analytics...",
  "Owner analytics could not be loaded right now.",
  "No discovery activity yet.",
  "Your profile is ready to receive views, clicks, and shares as people find you through MealScout.",
  "Profile views",
  "Discovery impressions",
  "CTA clicks",
  "Share opens",
  "High-intent actions",
  "Top sources",
  "Last activity",
  "Profile actions taken",
  "No completion actions recorded yet.",
  "Completion outcomes after clicks",
  "No completion outcomes recorded yet.",
];

for (const snippet of requiredUiSnippets) {
  if (!normalizedOwnerDashboard.includes(snippet)) {
    throw new Error(`Owner attribution UI contract missing: ${snippet}`);
  }
}

if (!ownerAttributionClient.includes("/api/owner/value-attribution?window=")) {
  throw new Error(
    "Owner attribution client contract missing endpoint: /api/owner/value-attribution?window=",
  );
}

if (
  ownerDashboard.includes("/api/restaurants/") &&
  ownerDashboard.includes("owner-value-dashboard")
) {
  throw new Error(
    "Owner dashboard must consume /api/owner/value-attribution for PDA-2.3",
  );
}

console.log("owner-value-attribution-ui.contract: PASS");
