import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const opsRoutes = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
);

const requiredRouteSnippets = [
  'app.post("/api/owner/profile-completion-action"',
  "isAuthenticated",
  "getBusinessAccessContext",
  "Invalid profile completion action payload",
  "profile_completion_cta_click",
  "owner_dashboard_profile_completion",
  "missingItemKey",
  "requestLogs",
];

for (const snippet of requiredRouteSnippets) {
  if (!opsRoutes.includes(snippet)) {
    throw new Error(`Owner completion action contract missing route snippet: ${snippet}`);
  }
}

const requiredUiSnippets = [
  "/api/owner/profile-completion-action",
  "Update next missing item",
  "missingItemKey",
  "entityId",
  "entityType",
];

for (const snippet of requiredUiSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner completion action contract missing UI snippet: ${snippet}`);
  }
}

console.log("owner-profile-completion-action.contract: PASS");
