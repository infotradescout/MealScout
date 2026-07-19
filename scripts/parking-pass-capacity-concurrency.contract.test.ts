import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const repository = readFileSync(
  "server/storage/parkingPassRepository.ts",
  "utf8",
);
const bookingRoute = readFileSync("server/routes/hostRoutes.ts", "utf8");
const liveConcurrencyTest = readFileSync(
  "scripts/testParkingPassBookingConcurrency.ts",
  "utf8",
);

assert.equal(
  repository.match(/defaultHardCapEnabled:\s*true/g)?.length,
  2,
  "Both new draft and newly synced Parking Pass series must enforce capacity.",
);
assert.doesNotMatch(
  repository,
  /defaultHardCapEnabled:\s*false/,
  "Newly created Parking Pass series must not disable capacity by default.",
);

const existingSeriesUpdate = repository.slice(
  repository.indexOf("if (seriesId)"),
  repository.indexOf("const [created]", repository.indexOf("if (seriesId)")),
);
assert.doesNotMatch(
  existingSeriesUpdate,
  /defaultHardCapEnabled/,
  "Syncing an existing series must preserve its explicit legacy capacity override.",
);

const transactionStart = bookingRoute.indexOf(
  "insertedHolds = await db.transaction",
);
const rowLock = bookingRoute.indexOf("for update", transactionStart);
const capacityCount = bookingRoute.indexOf(
  'inArray(eventBookings.status, ["confirmed", "pending"])',
  rowLock,
);
const capacityGuard = bookingRoute.indexOf(
  "hardCapEnabled && reservedCount >= maxSpots",
  capacityCount,
);
const pendingInsert = bookingRoute.indexOf(
  ".insert(eventBookings)",
  capacityGuard,
);

assert.ok(transactionStart >= 0, "Booking holds must run in a transaction.");
assert.ok(
  transactionStart < rowLock &&
    rowLock < capacityCount &&
    capacityCount < capacityGuard &&
    capacityGuard < pendingInsert,
  "The event row must be locked before counting pending/confirmed holds and inserting the next hold.",
);
assert.match(
  liveConcurrencyTest,
  /await Promise\.all\(\[/,
  "The live regression runner must issue truly concurrent booking attempts.",
);
assert.match(
  liveConcurrencyTest,
  /Idempotency-Key/g,
  "Concurrent booking coverage must retain idempotency-key assertions.",
);

console.log("parking-pass-capacity-concurrency.contract: PASS");
