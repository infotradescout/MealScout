import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getScoutHostParkingCopy,
  getScoutParkingInventoryStatus,
  hasVerifiedParkingPassCapacity,
  hasVerifiedParkingPassPrice,
} from "../client/src/lib/scoutParkingPassTruth";

const activeInventory = {
  status: "open",
  hardCapEnabled: true,
  spotCount: 2,
  bookedSpots: 1,
  availableSpotNumbers: [2],
  dailyPriceCents: 2500,
};

assert.equal(hasVerifiedParkingPassPrice(activeInventory), true);
assert.equal(hasVerifiedParkingPassCapacity(activeInventory), true);
assert.equal(getScoutParkingInventoryStatus(activeInventory, true), "available");
assert.equal(getScoutParkingInventoryStatus(activeInventory, false), "scheduled");
assert.equal(
  getScoutParkingInventoryStatus(
    { ...activeInventory, availableSpotNumbers: [], bookedSpots: 2 },
    true,
  ),
  "scheduled",
);
assert.equal(
  getScoutParkingInventoryStatus({ ...activeInventory, dailyPriceCents: 0 }, true),
  "scheduled",
);
assert.equal(
  getScoutParkingInventoryStatus({ ...activeInventory, status: "inactive" }, true),
  "scheduled",
);
assert.equal(
  getScoutParkingInventoryStatus(
    {
      ...activeInventory,
      hardCapEnabled: false,
      availableSpotNumbers: [],
      bookedSpots: 99,
    },
    true,
  ),
  "available",
  "Explicit legacy no-cap inventory remains bookable.",
);

assert.deepEqual(getScoutHostParkingCopy(null), {
  badge: "Host location",
  description: "Route-planning host location. No verified active Parking Pass inventory.",
});
assert.equal(
  getScoutHostParkingCopy("scheduled").badge,
  "Watch availability",
);
assert.equal(
  getScoutHostParkingCopy("available").badge,
  "Parking Pass available",
);

const scout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
assert.match(
  scout,
  /for \(const host of \[\.\.\.mapHostLocations, \.\.\.visibleParkingPassHosts\]\)/,
  "Every valid map host must remain in the route-planning marker inventory.",
);
assert.match(
  scout,
  /parkingStatus =\s*parkedTrucks\.length > 0 \? "occupied" : inventoryStatus/,
  "A host marker must derive availability from verified inventory, not host existence.",
);
assert.doesNotMatch(
  scout,
  /parkingStatus:\s*parkedTrucks\.length > 0 \? "occupied" : "available"/,
  "Ordinary hosts must never be marked available by default.",
);
assert.doesNotMatch(
  scout,
  /Host spot available for Parking Pass visits/,
  "Ordinary host copy must not imply Parking Pass inventory.",
);
assert.match(
  scout,
  /activeMapLayers\.happeningToday \|\| activeMapLayers\.foodTrucks/,
  "Host pins may be layer-filtered, but must not be filtered by bookability.",
);

console.log("scout-parking-pass-host-truth.contract: PASS");
