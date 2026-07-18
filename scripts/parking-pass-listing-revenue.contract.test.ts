import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const eventRoutes = readFileSync("server/routes/eventRoutes.ts", "utf8");
const hostRoutes = readFileSync("server/routes/hostRoutes.ts", "utf8");
const hostParkingPassRoutes = readFileSync(
  "server/routes/hosts/eventsRoutes.ts",
  "utf8",
);
const parkingPassQuality = readFileSync(
  "server/services/parkingPassQuality.ts",
  "utf8",
);
const parkingPassPage = readFileSync(
  "client/src/pages/parking-pass.tsx",
  "utf8",
);
const recoveryMigration = readFileSync(
  "migrations/113_repair_parking_pass_inventory_readiness.sql",
  "utf8",
);

const legacyAvailabilityGuard = eventRoutes.indexOf(
  "if (!Boolean(event?.hardCapEnabled))",
);
const enumeratedAvailabilityGuard = eventRoutes.indexOf(
  "if (Array.isArray(event?.availableSpotNumbers))",
);

assert.ok(
  legacyAvailabilityGuard >= 0 &&
    legacyAvailabilityGuard < enumeratedAvailabilityGuard,
  "Legacy non-hard-cap listings must not be treated as full when spot numbers were never enumerated.",
);
assert.match(
  parkingPassQuality,
  /Number\(value\) > 0/,
  "A Parking Pass needs a positive price; zero is not bookable pricing.",
);
assert.match(
  hostRoutes,
  /if \(hostPriceCents <= 0\)/,
  "Booking must reject a listing without a positive host price.",
);
assert.match(
  hostParkingPassRoutes,
  /const hardCapEnabled = true/,
  "Every new Parking Pass listing must enforce its configured capacity.",
);
assert.doesNotMatch(
  hostParkingPassRoutes,
  /app\.(get|post|patch)\(\s*"\/api\/hosts\/events/,
  "Parking Pass handlers must not register event-route aliases.",
);
assert.match(
  recoveryMigration,
  /source\.max_trucks > COALESCE\(h\.spot_count, 0\)/,
  "Recovery must restore historical multi-space capacity.",
);
assert.match(
  recoveryMigration,
  /COALESCE\(h\.spot_count, 0\),\s+COALESCE\(es\.default_max_trucks, 0\)/,
  "Recovery must preserve the largest configured location or series capacity.",
);
assert.match(
  recoveryMigration,
  /e\.event_type = 'parking_pass'[\s\S]*e\.name ILIKE 'Parking Pass - %'/,
  "Historical recovery must identify Parking Pass rows without treating every paid event as parking inventory.",
);
assert.match(
  recoveryMigration,
  /default_hard_cap_enabled = TRUE/,
  "Recovered inventory must enforce capacity.",
);
assert.match(
  recoveryMigration,
  /\) > 0\s+THEN 'published'/,
  "Only positively priced inventory may be published.",
);
assert.doesNotMatch(
  parkingPassPage,
  /Capacity Guard v2\.2/,
  "Capacity enforcement is core booking behavior, not an optional experimental control.",
);
assert.match(
  parkingPassPage,
  /Booking closes automatically when every spot is/,
  "Hosts must be told that each configured space is finite inventory.",
);

console.log("parking-pass-listing-revenue.contract: PASS");
