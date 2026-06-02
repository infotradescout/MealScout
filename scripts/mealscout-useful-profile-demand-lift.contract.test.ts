import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "usefulProfilesTotal",
  "usefulProfilesWithViews",
  "usefulProfilesWithActions",
  "usefulProfileViewLift",
  "usefulProfileActionLift",
  "usefulProfileBookingClickLift",
  "cohort_flags",
  "is_useful",
  "request_logs",
  "public_profile",
  "profile_view",
  "profile_action",
  "booking_click",
  "menu_click",
  "directions_click",
  "call_click",
  "lower(trim(coalesce(r.city, ''))) = ${cityKey}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Useful profile demand-lift route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Useful Profiles Total",
  "Useful Profiles With Views",
  "Useful Profiles With Actions",
  "Useful Profile View Lift %",
  "Useful Profile Action Lift %",
  "Useful Profile Booking Click Lift %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Useful profile demand-lift dashboard snippet missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Useful profile demand-lift appears to use sample/generated data.");
  }
}

console.log("mealscout-useful-profile-demand-lift.contract: PASS");
