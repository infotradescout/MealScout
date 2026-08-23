import assert from "node:assert/strict";

import { isPendingPickupCheckoutReplayReady } from "../server/services/pickupCheckoutReplayPolicy";

const order = {
  pricesIncludeTax: true,
  merchantNameSnapshot: "Test Kitchen",
  merchantOwnerIdSnapshot: "owner-1",
  stripeConnectAccountIdSnapshot: "acct-ready",
  pickupAddressSnapshot: "100 Main St, Pensacola, FL",
  pickupDirectionsUrlSnapshot: "https://maps.google.com/?q=100%20Main",
  merchantAcknowledgementMinutesSnapshot: 10,
};
const readiness = {
  restaurantName: "Test Kitchen",
  pickupAddressLabel: "100 Main St, Pensacola, FL",
  pickupDirectionsUrl: "https://maps.google.com/?q=100%20Main",
  merchantAcknowledgementMinutes: 10,
  orderingEnabled: true,
  paymentMethods: { card: true },
  settlementIdentity: {
    merchantOwnerId: "owner-1",
    stripeConnectAccountId: "acct-ready",
  },
  menuReadiness: [
    { menuId: "menu-1", orderingEnabled: true, pricesIncludeTax: true },
  ],
};

assert.equal(
  isPendingPickupCheckoutReplayReady({
    order,
    menuId: "menu-1",
    allItemsStillAvailable: true,
    readiness,
  }),
  true,
);
assert.equal(
  isPendingPickupCheckoutReplayReady({
    order,
    menuId: "menu-1",
    allItemsStillAvailable: true,
    readiness: {
      ...readiness,
      orderingEnabled: false,
      paymentMethods: { card: false },
    },
  }),
  false,
  "A closed merchant or revoked Connect readiness must invalidate replay",
);
assert.equal(
  isPendingPickupCheckoutReplayReady({
    order,
    menuId: "menu-1",
    allItemsStillAvailable: true,
    readiness: {
      ...readiness,
      settlementIdentity: {
        ...readiness.settlementIdentity,
        stripeConnectAccountId: "acct-replaced",
      },
    },
  }),
  false,
  "A changed settlement destination must invalidate replay",
);
assert.equal(
  isPendingPickupCheckoutReplayReady({
    order,
    menuId: "menu-1",
    allItemsStillAvailable: false,
    readiness,
  }),
  false,
  "A disabled original item must invalidate replay",
);

console.log("MealScout pickup checkout replay behavior: PASS");
