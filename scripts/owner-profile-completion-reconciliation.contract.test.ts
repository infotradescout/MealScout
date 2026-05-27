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
  "completionActionReconciliation",
  "clicked",
  "nowComplete",
  "stillMissing",
  "owner_dashboard_profile_completion",
  "profile_completion_cta_click",
];

for (const snippet of requiredRouteSnippets) {
  if (!ownerAttributionRoute.includes(snippet)) {
    throw new Error(`Owner completion reconciliation route contract missing: ${snippet}`);
  }
}

const requiredUiSnippets = [
  "Completion outcomes after clicks",
  "now complete",
  "still missing",
  "No completion outcomes recorded yet.",
];

for (const snippet of requiredUiSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner completion reconciliation UI contract missing: ${snippet}`);
  }
}

console.log("owner-profile-completion-reconciliation.contract: PASS");
