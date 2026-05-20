import assert from "node:assert/strict";

import { computePrivateBehaviorScoreFromSignals } from "../server/services/privateBehaviorScoreService";

const now = new Date("2026-05-19T12:00:00.000Z");

const lowActivity = computePrivateBehaviorScoreFromSignals(
  {
    restaurantId: "r-low",
    menuViews7d: 0,
    menuViews30d: 1,
    mapTaps7d: 0,
    mapTaps30d: 1,
    detailViews7d: 0,
    detailViews30d: 0,
    businessContactIntents7d: 0,
    businessContactIntents30d: 0,
    completedOrders7d: 0,
    completedOrders30d: 0,
    repeatCustomers90d: 0,
    menuItemsSold7d: 0,
    menuItemsSold30d: 0,
    dealViews30d: 40,
    dealClaimsUsed30d: 0,
    dislikes30d: 5,
    likes30d: 0,
    restaurantUpdatedAt: new Date("2025-12-01T00:00:00.000Z"),
    menuUpdatedAt: null,
    lastBroadcastAt: null,
  },
  now,
);

const strongActivity = computePrivateBehaviorScoreFromSignals(
  {
    restaurantId: "r-strong",
    menuViews7d: 18,
    menuViews30d: 42,
    mapTaps7d: 10,
    mapTaps30d: 22,
    detailViews7d: 12,
    detailViews30d: 30,
    businessContactIntents7d: 3,
    businessContactIntents30d: 7,
    completedOrders7d: 12,
    completedOrders30d: 34,
    repeatCustomers90d: 9,
    menuItemsSold7d: 30,
    menuItemsSold30d: 110,
    dealViews30d: 60,
    dealClaimsUsed30d: 12,
    dislikes30d: 1,
    likes30d: 14,
    restaurantUpdatedAt: new Date("2026-05-18T00:00:00.000Z"),
    menuUpdatedAt: new Date("2026-05-18T00:00:00.000Z"),
    lastBroadcastAt: new Date("2026-05-19T02:00:00.000Z"),
  },
  now,
);

const ordersOnly = computePrivateBehaviorScoreFromSignals(
  {
    restaurantId: "r-orders",
    menuViews7d: 0,
    menuViews30d: 0,
    mapTaps7d: 0,
    mapTaps30d: 0,
    detailViews7d: 0,
    detailViews30d: 0,
    businessContactIntents7d: 0,
    businessContactIntents30d: 0,
    completedOrders7d: 8,
    completedOrders30d: 20,
    repeatCustomers90d: 6,
    menuItemsSold7d: 0,
    menuItemsSold30d: 0,
    dealViews30d: 0,
    dealClaimsUsed30d: 0,
    dislikes30d: 0,
    likes30d: 0,
    restaurantUpdatedAt: new Date("2026-05-17T00:00:00.000Z"),
    menuUpdatedAt: null,
    lastBroadcastAt: null,
  },
  now,
);

assert.ok(
  strongActivity.privateBoostScore > lowActivity.privateBoostScore,
  "Strong private activity should rank above low/stale activity",
);

assert.ok(
  lowActivity.penalties.includes("weak_deal_conversion"),
  "Weak conversion should produce a penalty when view volume is high",
);

assert.ok(
  lowActivity.penalties.includes("negative_feedback_drift"),
  "Dislike-heavy activity should apply internal negative penalty",
);

assert.ok(
  ordersOnly.orderVelocityScore > 0,
  "Completed orders should contribute to private behavior scoring",
);

assert.ok(
  ordersOnly.repeatCustomerScore > 0,
  "Repeat customers should contribute to private behavior scoring",
);

assert.ok(
  typeof strongActivity.sourceCounts.pickupOrdersCompleted === "number",
  "Source counts should track completed order volume internally",
);

console.log("privateBehaviorScoreService checks passed");
