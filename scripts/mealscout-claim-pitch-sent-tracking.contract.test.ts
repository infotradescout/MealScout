import { readFileSync } from "node:fs";

const truckImportAdminRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredStatusRouteSnippets = [
  '"/api/admin/claim-pitches/:listingId/status"',
  "isStaffOrAdmin",
  "requireAdminUser(req, res)",
  '"sent"',
  "sentChannel",
  "sentAt",
  "lastSentAt",
  "sendCount",
  "sentByUserId",
];

for (const snippet of requiredStatusRouteSnippets) {
  if (!truckImportAdminRoutes.includes(snippet)) {
    throw new Error(`Claim pitch sent tracking route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Mark sent",
  "claimPitchSentChannel",
  "Claim Pitches Sent",
  "Claim Pitch Sent Rate %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Claim pitch sent tracking UI missing snippet: ${snippet}`);
  }
}

const requiredLaunchBoardSnippets = [
  "claimPitchesSent",
  "claimPitchSentRate",
  "lower(trim(coalesce(${truckImportListings.city}, ''))) = ${cityKey}",
];

for (const snippet of requiredLaunchBoardSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Launch board sent rollup missing snippet: ${snippet}`);
  }
}

if (truckImportAdminRoutes.includes("Join MealScout")) {
  throw new Error("Claim pitch sent tracking regressed to generic join language.");
}

console.log("mealscout-claim-pitch-sent-tracking.contract: PASS");
