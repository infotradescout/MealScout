import assert from "node:assert/strict";

import { toAuthoritativePaymentOrder } from "../client/src/lib/pickupCheckoutTruth";

const staleGetReadiness = {
  restaurantName: "Old Merchant Name",
  pickupAddressLabel: "1 Old Address",
};
const returnedOrder = {
  merchantNameSnapshot: "Current Merchant Snapshot",
  pickupAddressSnapshot: "99 Current Pickup Address",
  pricesIncludeTax: true,
};

const paymentDisplay = toAuthoritativePaymentOrder(returnedOrder);
assert.deepEqual(paymentDisplay, returnedOrder);
assert.notEqual(
  paymentDisplay.merchantNameSnapshot,
  staleGetReadiness.restaurantName,
);
assert.notEqual(
  paymentDisplay.pickupAddressSnapshot,
  staleGetReadiness.pickupAddressLabel,
);

console.log("MealScout authoritative checkout display behavior: PASS");
