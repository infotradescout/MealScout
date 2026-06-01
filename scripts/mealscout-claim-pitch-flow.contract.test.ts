import { readFileSync } from "node:fs";

const truckImportAdminRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/claim-pitches"',
  '"/api/admin/claim-pitches/:listingId/status"',
  "isStaffOrAdmin",
  "requireAdminUser(req, res)",
  "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
  "claimUrl",
  "pitchStatus",
  "pitchCreatedAt",
  "pitchOpenedAt",
  "claimStartedAt",
  "claimCompletedAt",
  "source",
  "createdByUserId",
];

for (const snippet of requiredRouteSnippets) {
  if (!truckImportAdminRoutes.includes(snippet)) {
    throw new Error(`Claim pitch route missing required snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Create claim pitch",
  "Claim pitch status",
  "Mark opened",
  "Mark claim started",
  "Mark claim completed",
  "Open claim URL",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Admin dashboard missing claim pitch UI snippet: ${snippet}`);
  }
}

if (truckImportAdminRoutes.includes("Join MealScout")) {
  throw new Error("Claim pitch copy regressed to generic join language.");
}

console.log("mealscout-claim-pitch-flow.contract: PASS");
