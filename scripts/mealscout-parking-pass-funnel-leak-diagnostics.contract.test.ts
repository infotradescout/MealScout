import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "parkingPassNoListingLeak",
  "parkingPassClickNoStartLeak",
  "parkingPassStartNoConfirmLeak",
  "parkingPassPaymentDisabledLeak",
  "parkingPassHostCapacityLeak",
  "parkingPassMissingHostCoordinateLeak",
  "parkingPassMissingTruckProfileLeak",
  "parkingPassTopLeakReason",
  "active_parking_pass_listings",
  "request_logs",
  "event_bookings",
  "event_series",
  "stripe_connect_account_id",
  "stripe_onboarding_completed",
  "stripe_charges_enabled",
  "stripe_payouts_enabled",
  "default_max_trucks",
  "spot_count",
  "latitude",
  "longitude",
  "lower(trim(coalesce(h.city, ''))) = ${cityKey}",
  "no_active_parking_pass_listing",
  "click_no_booking_start",
  "booking_start_no_confirmation",
  "payment_disabled",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Parking Pass leak diagnostics route missing snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "Parking Pass No Listing Leak",
  "Parking Pass Click No Start Leak",
  "Parking Pass Start No Confirm Leak",
  "Parking Pass Payment Disabled Leak",
  "Parking Pass Host Capacity Leak",
  "Parking Pass Missing Host Coordinate Leak",
  "Parking Pass Missing Truck Profile Leak",
  "Parking Pass Top Leak Reason",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Parking Pass leak diagnostics dashboard snippet missing: ${snippet}`);
  }
}

const disallowedMockMarkers = ["sampleData", "mockData", "fakeData"];
for (const marker of disallowedMockMarkers) {
  if (adminCoreOpsRoutes.includes(marker)) {
    throw new Error("Parking Pass leak diagnostics appears to use sample/generated data.");
  }
}

console.log("mealscout-parking-pass-funnel-leak-diagnostics.contract: PASS");
