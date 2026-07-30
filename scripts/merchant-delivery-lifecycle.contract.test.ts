import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDeliveryEligibility,
  isDeliveryScheduleAvailable,
  normalizeDeliverySchedule,
} from "../server/services/deliveryEligibility";

const base = {
  enabled: true,
  subtotalCents: 3000,
  minimumOrderCents: 2000,
  postalCode: "75201",
  postalCodes: ["75201", "75202"],
  activeOrders: 1,
  maxConcurrentOrders: 5,
};

test("merchant delivery accepts an eligible order", () => {
  assert.deepEqual(evaluateDeliveryEligibility(base), { ok: true });
});

test("merchant delivery enforces switch, minimum, zone, and capacity", () => {
  assert.equal(
    evaluateDeliveryEligibility({ ...base, enabled: false }).ok,
    false,
  );
  assert.match(
    evaluateDeliveryEligibility({ ...base, subtotalCents: 1000 }).message || "",
    /minimum/i,
  );
  assert.match(
    evaluateDeliveryEligibility({ ...base, postalCode: "99999" }).message || "",
    /outside/i,
  );
  const capacity = evaluateDeliveryEligibility({ ...base, activeOrders: 5 });
  assert.equal(capacity.statusCode, 409);
  assert.match(capacity.message || "", /capacity/i);
});

test("merchant delivery evaluates configured hours in the restaurant timezone", () => {
  const tuesdayMorning = new Date("2026-07-28T15:00:00.000Z");
  const tuesdayEvening = new Date("2026-07-28T23:00:00.000Z");
  const schedule = {
    tue: [{ open: "09:00", close: "17:00" }],
  };

  assert.equal(
    isDeliveryScheduleAvailable({
      deliveryHours: schedule,
      now: tuesdayMorning,
      timeZone: "America/Chicago",
    }),
    true,
  );
  const closed = evaluateDeliveryEligibility({
    ...base,
    deliveryHours: schedule,
    now: tuesdayEvening,
    timeZone: "America/Chicago",
  });
  assert.equal(closed.ok, false);
  assert.match(closed.message || "", /unavailable at this time/i);
});

test("merchant delivery supports overnight windows and fails closed on configured closed days", () => {
  const overnightSchedule = {
    mon: [{ start: "22:00", end: "02:00" }],
    tue: [],
  };
  assert.equal(
    isDeliveryScheduleAvailable({
      deliveryHours: overnightSchedule,
      now: new Date("2026-07-28T06:00:00.000Z"),
      timeZone: "America/Chicago",
    }),
    true,
  );
  assert.equal(
    isDeliveryScheduleAvailable({
      deliveryHours: { tue: [] },
      now: new Date("2026-07-28T15:00:00.000Z"),
      timeZone: "America/Chicago",
    }),
    false,
  );
  assert.equal(
    isDeliveryScheduleAvailable({
      deliveryHours: { unsupported: true },
      now: new Date("2026-07-28T15:00:00.000Z"),
      timeZone: "America/Chicago",
    }),
    false,
  );
  assert.equal(isDeliveryScheduleAvailable({ deliveryHours: {} }), true);
});

test("merchant delivery normalizes write-time schedules and rejects malformed windows", () => {
  assert.deepEqual(
    normalizeDeliverySchedule({
      Tuesday: [{ open: "9:00", close: "17:00" }],
    }),
    {
      tue: [{ start: "09:00", end: "17:00" }],
    },
  );
  assert.throws(
    () => normalizeDeliverySchedule({ tue: [{ open: "09:00" }] }),
    /distinct HH:MM/i,
  );
  assert.throws(
    () => normalizeDeliverySchedule({ unsupported: [] }),
    /invalid or duplicate delivery day/i,
  );
});

test("configured schedules fail closed without a restaurant timezone", () => {
  assert.equal(
    isDeliveryScheduleAvailable({
      deliveryHours: { tue: [{ start: "09:00", end: "17:00" }] },
      now: new Date("2026-07-28T15:00:00.000Z"),
    }),
    false,
  );
});
