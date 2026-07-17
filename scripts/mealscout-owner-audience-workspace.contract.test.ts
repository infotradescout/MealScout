import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const audience = readFileSync(
  "client/src/components/owner-audience-workspace.tsx",
  "utf8",
);
const routes = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
);

const dashboardRequirements = [
  'import OwnerAudienceWorkspace from "@/components/owner-audience-workspace"',
  'workspaceMode === "audience" || setupMode === "analytics"',
  'activeWorkspaceModule === "audience"',
  "<OwnerAudienceWorkspace",
  'activeWorkspaceModule === "overview"',
  'activeWorkspaceModule === "availability"',
  "legacyAnalyticsEnabled &&",
];

for (const requirement of dashboardRequirements) {
  if (!dashboard.includes(requirement)) {
    throw new Error(`Owner dashboard audience contract missing: ${requirement}`);
  }
}

const audienceRequirements = [
  "owner-value-dashboard?window=",
  "See what people do after finding",
  "These are real views and actions from your public MealScout profile.",
  "Profile views",
  "Menu opens",
  "Directions and calls",
  "Order and delivery taps",
  "What people did",
  "What to do next",
  "No profile activity in this period yet",
  "Audience activity is unavailable",
  "Audience access is not enabled",
  '(["7d", "30d"] as const)',
  "audience-window-${value}",
];

for (const requirement of audienceRequirements) {
  if (!audience.includes(requirement)) {
    throw new Error(`Owner audience UI contract missing: ${requirement}`);
  }
}

const routeRequirements = [
  '"/api/restaurants/:restaurantId/owner-value-dashboard"',
  "isAdminLikeUserType",
  '"viewAnalytics"',
  "profileViewsCurrent",
  "menuClicksCurrent",
  "directionsClicksCurrent",
  "callClicksCurrent",
  "orderClicksCurrent",
  "deliveryClicksCurrent",
  "qrOpensCurrent",
  "topActions",
  "recommendations",
  "freshnessLabel",
  "/deal-creation?restaurantId=",
];

for (const requirement of routeRequirements) {
  if (!routes.includes(requirement)) {
    throw new Error(`Owner audience route contract missing: ${requirement}`);
  }
}

for (const forbiddenCopy of [
  "Open Scout",
  "Scout nearby",
  "Keep scouting",
  "Back to Scout",
]) {
  if (audience.includes(forbiddenCopy)) {
    throw new Error(`Owner audience uses forbidden Scout copy: ${forbiddenCopy}`);
  }
}

console.log("mealscout-owner-audience-workspace.contract: PASS");
