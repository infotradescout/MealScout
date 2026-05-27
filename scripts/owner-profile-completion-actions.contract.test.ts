import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const ownerAttributionRoute = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
);

const requiredRouteSnippets = [
  'app.get("/api/owner/value-attribution"',
  "owner_dashboard_profile_completion",
  "profile_completion_cta_click",
  "completionActionClicks",
  "completionActions",
  "missingItemKey",
];

for (const snippet of requiredRouteSnippets) {
  if (!ownerAttributionRoute.includes(snippet)) {
    throw new Error(`Owner completion actions route contract missing: ${snippet}`);
  }
}

const requiredUiSnippets = [
  "Profile actions taken",
  "Menu update clicked",
  "Photos update clicked",
  "Hours update clicked",
  "No completion actions recorded yet.",
];

for (const snippet of requiredUiSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner completion actions UI contract missing: ${snippet}`);
  }
}

console.log("owner-profile-completion-actions.contract: PASS");
