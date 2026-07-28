import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeliveryEligibility } from "../server/services/deliveryEligibility";

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
  assert.equal(evaluateDeliveryEligibility({ ...base, enabled: false }).ok, false);
  assert.match(evaluateDeliveryEligibility({ ...base, subtotalCents: 1000 }).message || "", /minimum/i);
  assert.match(evaluateDeliveryEligibility({ ...base, postalCode: "99999" }).message || "", /outside/i);
  const capacity = evaluateDeliveryEligibility({ ...base, activeOrders: 5 });
  assert.equal(capacity.statusCode, 409);
  assert.match(capacity.message || "", /capacity/i);
});
