import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const scout = read("server/services/scoutSurfaceService.ts");
const recommendations = read("server/services/recommendationEngine.ts");
const menus = read("server/routes/menuRoutes.ts");
const orders = read("server/routes/pickupOrderRoutes.ts");
const webhook = read("server/routes/stripeWebhookRoutes.ts");
const notifications = read("server/services/pickupOrderNotificationService.ts");

test("Scout deduplicates one business across restaurant and truck identities", () => {
  assert.match(scout, /const identityKey = \(card: ScoutSurfaceCard\)/);
  assert.match(scout, /`business:\$\{card\.entityId\}`/);
  assert.match(recommendations, /restaurant\.isFoodTruck === true/);
  assert.match(recommendations, /businessType \|\| ""\).*=== "food_truck"/s);
});

test("paid orders notify both sides once and paid cancellation refunds safely", () => {
  assert.match(notifications, /type: "merchant_new_order"/);
  assert.match(notifications, /type: "confirmation"/);
  assert.match(notifications, /type: "cancelled"/);
  assert.match(notifications, /if \(existing\) return/);
  assert.match(webhook, /sendPickupOrderConfirmedNotifications\(updated\)/);
  assert.match(orders, /stripe\.transfers\.createReversal/);
  assert.match(orders, /stripe\.refunds\.create/);
  assert.match(orders, /pickup-order:\$\{order\.id\}:refund/);
  assert.match(orders, /updates\.payoutStatus = "reversed"/);
});

test("Scout never treats a truck profile address as a live map location", () => {
  assert.match(
    scout,
    /const coords = entityType === "truck" \? null : parseLatLng\(restaurant\)/,
  );
  assert.match(scout, /Live truck coordinates are handled by/);
});

test("food truck ordering requires a confirmed current stop in both reads and writes", () => {
  assert.match(menus, /id: "current_truck_stop"/);
  assert.match(menus, /currentTruckStop\?\.status === "here_now"/);
  assert.match(orders, /code: "TRUCK_CURRENT_STOP_REQUIRED"/);
  assert.match(orders, /currentStop\.status !== "here_now"/);
  assert.match(orders, /!currentStop\.addressPublicLabel/);
});

test("business-specific Scout links preserve caterer and private-chef identity", () => {
  assert.match(scout, /`\/caterer\/\$\{encodeURIComponent\(slug\)\}`/);
  assert.match(scout, /`\/private-chef\/\$\{encodeURIComponent\(slug\)\}`/);
});
