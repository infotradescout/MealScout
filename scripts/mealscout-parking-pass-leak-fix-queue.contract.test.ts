import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "leakFixQueue",
  "parkingPassTopLeakReason",
  "fixId",
  "marketCity",
  "leakReason",
  "fixType",
  "priority",
  "title",
  "description",
  "targetEntityType",
  "targetEntityId",
  "targetUrl",
  "status: \"open\"",
  "createdAt",
  "create_parking_pass_listing",
  "enable_host_payments",
  "add_host_coordinates",
  "increase_or_open_capacity",
  "complete_truck_profile",
  "add_truck_schedule",
  "follow_up_booking_start_no_confirm",
  "review_missing_active_hosts",
  "city=${encodeURIComponent(marketCity)}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Parking Pass leak fix queue route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Leak Fix Queue",
  "Top fix priority",
  "leakFixQueue",
  "fix.priority",
  "fix.status",
  "fix.targetUrl",
  "Open target",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Parking Pass leak fix queue dashboard snippet missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Parking Pass leak fix queue appears to use sample/generated data.");
  }
}

console.log("mealscout-parking-pass-leak-fix-queue.contract: PASS");
