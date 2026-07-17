import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const owner = read("client/src/pages/restaurant-owner-dashboard.tsx");
const bookingRoutes = read("server/routes/bookingRoutes.ts");
const eventRoutes = read("server/routes/eventRoutes.ts");

assert.match(owner, /setupMode === "bookings"[\s\S]*"availability"/);
assert.match(owner, /activeWorkspaceModule === "availability"/);
assert.match(owner, /data-testid="owner-booked-stops-workspace"/);
assert.match(owner, /TabsTrigger value="bookings">Booked stops/);
assert.match(owner, /currentIsTruckBusiness/);
assert.match(
  owner,
  /queryKey: \["\/api\/bookings\/my-truck", selectedRestaurant\]/,
);
assert.match(owner, /truckId=\$\{encodeURIComponent\(selectedRestaurant\)\}/);
assert.match(owner, /<AlertDialog/);
assert.match(owner, /Cancel without refund/);
assert.ok(!owner.includes("confirm("));

assert.match(
  bookingRoutes,
  /const requestedTruckId = String\(req\.query\?\.truckId/,
);
assert.match(bookingRoutes, /"manageParkingPass"/);
assert.match(bookingRoutes, /isInternalTeamUserType\(req\.user\?\.userType\)/);
assert.match(eventRoutes, /req\.user\?\.userType/);
assert.match(eventRoutes, /refundStatus: "none"/);
assert.match(eventRoutes, /refunded: false/);

console.log("mealscout-owner-booked-stops-workspace.contract: PASS");
