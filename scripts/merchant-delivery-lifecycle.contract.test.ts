import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  evaluateDeliveryEligibility,
  isDeliveryScheduleAvailable,
  normalizeDeliverySchedule,
} from "../server/services/deliveryEligibility";
import {
  calculateAuthoritativeMerchantDeliveryTotals,
  customerAccessTokenMatches,
  hasValidMerchantDeliveryConfiguration,
  hashCustomerAccessToken,
  projectOrderForCustomer,
} from "../server/services/merchantDeliverySafety";

const base = {
  enabled: true,
  subtotalCents: 3000,
  minimumOrderCents: 2000,
  postalCode: "75201",
  postalCodes: ["75201", "75202"],
  activeOrders: 1,
  maxConcurrentOrders: 5,
};

test("delivery is off until the merchant has a bounded service area", () => {
  assert.equal(hasValidMerchantDeliveryConfiguration(undefined), false);
  assert.equal(hasValidMerchantDeliveryConfiguration({ enabled: true, feeCents: 500, minimumOrderCents: 2000, estimatedMinutes: 45, maxConcurrentOrders: 5, postalCodes: [] }), false);
  assert.equal(hasValidMerchantDeliveryConfiguration({ enabled: true, feeCents: 500, minimumOrderCents: 2000, estimatedMinutes: 45, maxConcurrentOrders: 5, postalCodes: ["75201"] }), true);
});

test("authoritative totals include delivery once and isolate pickup", () => {
  assert.deepEqual(calculateAuthoritativeMerchantDeliveryTotals({ subtotalCents: 3000, platformFeeCents: 100, deliveryFeeCents: 500 }), {
    subtotalCents: 3000, platformFeeCents: 100, deliveryFeeCents: 500,
    taxCents: 0, tipCents: 0, discountCents: 0, totalCents: 3600,
  });
  assert.equal(calculateAuthoritativeMerchantDeliveryTotals({ subtotalCents: 3000, platformFeeCents: 100, deliveryFeeCents: 0 }).totalCents, 3100);
});

test("guest access token protects delivery data", () => {
  const token = "a".repeat(64);
  const hash = hashCustomerAccessToken(token);
  assert.equal(customerAccessTokenMatches(token, hash), true);
  assert.equal(customerAccessTokenMatches("b".repeat(64), hash), false);
  const order = { id: "order-1", customerEmail: "customer@example.com", deliveryAddress: "1 Private Way", customerAccessTokenHash: hash, stripePaymentIntentId: "pi_private" };
  assert.equal(projectOrderForCustomer(order, false).deliveryAddress, undefined);
  assert.equal(projectOrderForCustomer(order, true).deliveryAddress, "1 Private Way");
  assert.equal(projectOrderForCustomer(order, true).stripePaymentIntentId, undefined);
});

test("public checkout is pickup-only while legacy delivery utilities stay isolated", () => {
  const route = fs.readFileSync(new URL("../server/routes/pickupOrderRoutes.ts", import.meta.url), "utf8");
  const deliveryRoute = fs.readFileSync(new URL("../server/routes/merchantDeliveryRoutes.ts", import.meta.url), "utf8");
  const notifications = fs.readFileSync(new URL("../server/services/pickupOrderNotificationService.ts", import.meta.url), "utf8");
  const checkout = fs.readFileSync(new URL("../client/src/pages/pickup-checkout.tsx", import.meta.url), "utf8");
  assert.match(route, /checkoutRequestId: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /body\.orderType !== "pickup"/);
  assert.match(route, /code: "FULFILLMENT_MODE_UNAVAILABLE"/);
  assert.doesNotMatch(route, /getDeliveryQuote\(/);
  assert.match(route, /projectOrderForCustomer/);
  assert.doesNotMatch(route, /totalCents:\s*z\./);
  assert.match(deliveryRoute, /code: "DELIVERY_ORDERING_UNAVAILABLE"/);
  assert.match(deliveryRoute, /enabled: false/);
  assert.match(notifications, /onConflictDoNothing/);
  assert.match(notifications, /merchant_new_order/);
  assert.match(checkout, /!orderType/);
  assert.doesNotMatch(checkout, /deliveryInfo\.availableNow/);
  assert.doesNotMatch(checkout, /value="delivery"/);
});

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
