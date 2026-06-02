import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "claimedProfilesUpdatedAfterPitch",
  "claimedProfilesWithMenuAfterPitch",
  "claimedProfilesWithScheduleAfterPitch",
  "claimedProfilesWithContactAfterPitch",
  "claimedProfilesWithPhotoAfterPitch",
  "claimToUsefulProfileRate",
  "coalesce(trim(r.website_url), '') <> ''",
  "claimCompletedAt",
  "claimStartedAt",
  "join restaurants r on r.claimed_from_import_id = l.id",
  "truck_manual_schedules tms where tms.truck_id = r.id",
  "lower(trim(coalesce(l.city, ''))) = ${cityKey}",
  "from request_logs rl",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Launch board reconciliation missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Claimed Profiles Updated After Pitch",
  "Claimed Profiles w/ Menu After Pitch",
  "Claimed Profiles w/ Schedule After Pitch",
  "Claimed Profiles w/ Contact After Pitch",
  "Claimed Profiles w/ Photo After Pitch",
  "Claim to Useful Profile Rate %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Admin dashboard reconciliation metric missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Launch board reconciliation appears to use sample/generated data.");
  }
}

if (adminCoreOpsRoutes.includes("truck_manual_schedules tms where tms.restaurant_id = r.id")) {
  throw new Error("Launch board reconciliation must use truck_manual_schedules.truck_id, not restaurant_id.");
}

if (adminCoreOpsRoutes.includes("coalesce(trim(r.email), '')")) {
  throw new Error("Launch board reconciliation must use real restaurant contact columns, not missing r.email.");
}

console.log("mealscout-claim-profile-update-reconciliation.contract: PASS");
