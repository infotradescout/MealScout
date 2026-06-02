import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "parkingPassViews",
  "parkingPassClicks",
  "parkingPassBookingStarts",
  "parkingPassBookingConfirmations",
  "parkingPassClickToStartRate",
  "parkingPassStartToConfirmRate",
  "bookingIntentToBookingStartRate",
  "bookingIntentToBookingConfirmRate",
  "request_logs rl",
  "parking_pass_view",
  "parking_pass_listing_view",
  "parking_pass_click",
  "eventBookings",
  'eq(events.eventType, "parking_pass")',
  "bookingStarts",
  "bookingConfirmations",
  "join hosts h on h.id = e.host_id",
  "lower(trim(coalesce(h.city, ''))) = ${cityKey}",
  "lower(trim(coalesce(r.city, ''))) = ${cityKey}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Parking Pass conversion route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Parking Pass Views",
  "Parking Pass Clicks",
  "Parking Pass Booking Starts",
  "Parking Pass Booking Confirmations",
  "Parking Pass Click to Start Rate %",
  "Parking Pass Start to Confirm Rate %",
  "Booking Intent to Booking Start Rate %",
  "Booking Intent to Booking Confirm Rate %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Parking Pass conversion dashboard snippet missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Parking Pass conversion funnel appears to use sample/generated data.");
  }
}

console.log("mealscout-parking-pass-conversion-funnel.contract: PASS");
