import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const repository = readFileSync(
  "server/storage/parkingPassRepository.ts",
  "utf8",
);
const bookingRoute = readFileSync("server/routes/hostRoutes.ts", "utf8");
const bookingService = readFileSync(
  "server/services/parkingPassBookingService.ts",
  "utf8",
);
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

assert.match(
  bookingRoute,
  /const purchaseResult = await createParkingPassPurchase\(/,
  "The Parking Pass route must delegate holds to the canonical purchase transaction.",
);
const purchaseStart = bookingService.indexOf("export async function createParkingPassPurchase(");
assert.ok(purchaseStart >= 0, "The canonical purchase entrypoint must exist.");
const purchaseEnd = bookingService.indexOf("\nexport ", purchaseStart + 1);
const purchase = bookingService.slice(purchaseStart, purchaseEnd < 0 ? undefined : purchaseEnd);
const transactionStart = purchase.indexOf("const created = await db.transaction");
const eventSelection = purchase.indexOf(".where(inArray(events.id, selectedEventIds))", transactionStart);
const rowLock = purchase.indexOf('.for("update")', eventSelection);
const capacityCount = purchase.indexOf(
  'inArray(eventBookings.status, ["pending", "confirmed"])',
  rowLock,
);
const capacityGuard = purchase.indexOf(
  "if (!capacityDecision.allowed)",
  capacityCount,
);
const pendingInsert = purchase.indexOf(
  ".insert(eventBookings)",
  capacityGuard,
);

assert.ok(transactionStart >= 0, "Booking holds must run in a transaction.");
assert.ok(
  transactionStart < eventSelection &&
    eventSelection < rowLock &&
    rowLock < capacityCount &&
    capacityCount < capacityGuard &&
    capacityGuard < pendingInsert,
  "The event row must be locked before counting pending/confirmed holds and inserting the next hold.",
);
assert.match(
  purchase.slice(capacityCount, capacityGuard),
  /evaluatePaidLineReservation\(\{\s*hardCapEnabled: Boolean\(event\.hardCapEnabled\),\s*reservedCount,\s*maxTrucks,/,
  "Capacity must be evaluated from the locked event and current reservation count.",
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
