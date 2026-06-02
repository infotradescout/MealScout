import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "commandCenter",
  "marketHealthStatus",
  "topGrowthConstraint",
  "topRecommendedAction",
  "topRecommendedActionUrl",
  "highestPriorityFixType",
  "highestPriorityFixStatus",
  "openCriticalFixCount",
  "resolvedFixCount",
  "improvingFixCount",
  "bookingReadinessScore",
  "blocked",
  "at_risk",
  "building",
  "ready",
  "scaling",
  "usefulProfilesTotal",
  "bookingIntentProfilesTotal",
  "activeParkingPassListings",
  "parkingPassBookingStarts",
  "parkingPassBookingConfirmations",
  "leakFixesOpen",
  "leakFixesResolved",
  "leakFixesImproved",
  "parkingPassPaymentDisabledLeak === 0",
  "parkingPassMissingHostCoordinateLeak === 0",
  "cityFilterApplied: hasCityFilter",
  "city: cityFilter || \"all\"",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Launch Board command center route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Launch Board Priority Command Center",
  "launchBoardData?.commandCenter",
  "Market Health Status",
  "Top growth constraint",
  "Open recommended action",
  "Booking Readiness Score",
  "Highest Priority Fix Type",
  "Highest Priority Fix Status",
  "Open Critical Fix Count",
  "Resolved Fix Count",
  "Improving Fix Count",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Launch Board command center dashboard missing snippet: ${snippet}`);
  }
}

const commandCenterIndex = adminDashboard.indexOf("Launch Board Priority Command Center");
const metricGridIndex = adminDashboard.indexOf("Profiles Total");
if (commandCenterIndex === -1 || metricGridIndex === -1 || commandCenterIndex > metricGridIndex) {
  throw new Error("Launch Board command center must render above the metric grid.");
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker) || adminDashboard.includes(marker)) {
    throw new Error("Launch Board command center appears to use sample/generated data.");
  }
}

console.log("mealscout-launch-board-priority-command-center.contract: PASS");
