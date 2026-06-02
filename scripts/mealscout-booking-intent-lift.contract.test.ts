import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "bookingIntentProfilesTotal",
  "bookingIntentFromUsefulProfiles",
  "bookingIntentFromNonUsefulProfiles",
  "bookingIntentUsefulProfileRate",
  "bookingIntentNonUsefulProfileRate",
  "bookingIntentUsefulLift",
  "bookingIntentToParkingPassClickRate",
  "booking_intent_cohorts",
  "is_useful",
  "truck_manual_schedules tms where tms.truck_id = r.id",
  "coalesce(trim(r.website_url), '') <> ''",
  "request_logs",
  "public_profile",
  "truck_booking_click",
  "booking_click",
  "schedule_click",
  "parking_pass_click",
  "catering_click",
  "call_click",
  "directions_click",
  "lower(trim(coalesce(r.city, ''))) = ${cityKey}",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Booking intent lift route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Booking Intent Profiles Total",
  "Booking Intent From Useful Profiles",
  "Booking Intent From Non-Useful Profiles",
  "Booking Intent Useful Profile Rate %",
  "Booking Intent Non-Useful Profile Rate %",
  "Booking Intent Useful Lift %",
  "Booking Intent to Parking Pass Click Rate %",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Booking intent lift dashboard snippet missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Booking intent lift appears to use sample/generated data.");
  }
}

if (adminCoreOpsRoutes.includes("truck_manual_schedules tms where tms.restaurant_id = r.id")) {
  throw new Error("Booking intent lift must use truck_manual_schedules.truck_id, not restaurant_id.");
}

if (adminCoreOpsRoutes.includes("coalesce(trim(r.email), '')")) {
  throw new Error("Booking intent lift must use real restaurant contact columns, not missing r.email.");
}

console.log("mealscout-booking-intent-lift.contract: PASS");
