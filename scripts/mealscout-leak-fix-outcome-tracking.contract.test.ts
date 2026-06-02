import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  '"/api/admin/launch-board/leak-fixes/:fixId/outcome"',
  "isStaffOrAdmin",
  "request_logs",
  "requestLogs",
  "leak_fix_outcome",
  "leakFixesOpen",
  "leakFixesInProgress",
  "leakFixesResolved",
  "leakFixesImproved",
  "leakFixResolutionRate",
  "leakFixImprovementRate",
  "fixResolvedAt",
  "fixResolvedByUserId",
  "fixOutcomeStatus",
  "fixOutcomeNotes",
  "linkedMetricBefore",
  "linkedMetricAfter",
  "linkedMetricDelta",
  "resolved_improved",
  "resolved_no_change",
  "resolved_regressed",
  "dismissed_not_applicable",
  "needs_follow_up",
  "getLeakFixLinkedMetricValue",
  "parkingPassBookingStarts",
  "parkingPassBookingConfirmations",
  "parkingPassPaymentDisabledLeak",
  "parkingPassHostCapacityLeak",
  "parkingPassMissingHostCoordinateLeak",
  "parkingPassMissingTruckProfileLeak",
  "lower(trim(coalesce(rl.metadata->>'marketCity', ''))) = ${cityKey}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Leak fix outcome route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Leak Fixes Open",
  "Leak Fixes In Progress",
  "Leak Fixes Resolved",
  "Leak Fixes Improved",
  "Leak Fix Resolution Rate %",
  "Leak Fix Improvement Rate %",
  "fix.fixOutcomeStatus",
  "Outcome status",
  "linkedMetricBefore",
  "linkedMetricAfter",
  "linkedMetricDelta",
  "Mark in progress",
  "Mark resolved",
  "/api/admin/launch-board/leak-fixes/",
  "fixOutcomeStatus",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Leak fix outcome dashboard missing snippet: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker) || adminDashboard.includes(marker)) {
    throw new Error("Leak fix outcome tracking appears to use sample/generated data.");
  }
}

console.log("mealscout-leak-fix-outcome-tracking.contract: PASS");
