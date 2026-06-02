import { readFileSync } from "node:fs";

const truckImportAdminRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/claim-pitches"',
  "isStaffOrAdmin",
  "requireAdminUser(req, res)",
  "claimPitchMessage",
  "claimPitchShortMessage",
  "claimPitchUrl",
  "profileUrl",
  "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
];

for (const snippet of requiredRouteSnippets) {
  if (!truckImportAdminRoutes.includes(snippet)) {
    throw new Error(`Claim pitch share-pack route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Copy message",
  "Copy claim URL",
  "Open profile URL",
  "Open claim URL",
  "claimPitchMessage",
  "claimPitchUrl",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Claim pitch share-pack dashboard missing snippet: ${snippet}`);
  }
}

if (truckImportAdminRoutes.includes("Join MealScout")) {
  throw new Error("Claim pitch share-pack regressed to generic join language.");
}

console.log("mealscout-claim-pitch-share-pack.contract: PASS");
