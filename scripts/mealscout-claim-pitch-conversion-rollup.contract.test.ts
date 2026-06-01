import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "claimPitchesCreated",
  "claimPitchesOpened",
  "claimPitchesStarted",
  "claimPitchesCompleted",
  "claimPitchOpenRate",
  "claimPitchStartRate",
  "claimPitchCompletionRate",
  "lower(trim(coalesce(${truckImportListings.city}, ''))) = ${cityKey}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Claim pitch rollup route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Claim Pitches Created",
  "Claim Pitches Opened",
  "Claim Pitches Started",
  "Claim Pitches Completed",
  "Claim Pitch Open Rate %",
  "Claim Pitch Start Rate %",
  "Claim Pitch Completion Rate %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Launch board UI missing claim pitch rollup snippet: ${snippet}`);
  }
}

console.log("mealscout-claim-pitch-conversion-rollup.contract: PASS");
