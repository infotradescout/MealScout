import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const orders = read("client/src/pages/orders.tsx");
const kitchen = read("client/src/pages/kitchen-display.tsx");
const workspace = read("client/src/components/owner-orders-workspace.tsx");
const workspaceShell = read("client/src/components/business-workspace-shell.tsx");
const merchantDelivery = read("client/src/pages/merchant-delivery.tsx");
const confirmation = read("client/src/pages/order-confirmation.tsx");
const routes = read("server/routes/pickupOrderRoutes.ts");
const websocket = read("server/websocket.ts");
const app = read("client/src/App.tsx");
const navigation = read("client/src/components/navigation.tsx");
const profile = read("client/src/pages/profile.tsx");

assert.match(orders, /isBusinessOrderOperator\(user\?\.userType\)/);
assert.match(orders, /<OwnerOrdersWorkspace view="orders"/);
assert.match(orders, /queryKey: \["\/api\/my\/orders"\]/);
assert.match(orders, /queryKey: \["\/api\/deals\/claimed"\]/);
assert.match(orders, /Claimed deals/);
assert.match(orders, /View status/);
assert.doesNotMatch(orders, /<Navigation/);

assert.match(kitchen, /<OwnerOrdersWorkspace view="kitchen"/);
assert.doesNotMatch(kitchen, /<Navigation/);

for (const expected of [
  'activeModule="work"',
  "Kitchen view",
  "Order history",
  "Needs attention",
  "New",
  "Ready",
  "Completed",
  "Cancel this order?",
  "Orders could not be loaded",
  "No orders yet",
  "Load older orders",
  "30-second refresh",
]) {
  assert.ok(workspace.includes(expected), `Missing Orders behavior: ${expected}`);
}
assert.doesNotMatch(workspace, /subscription|Review plan/i);
assert.match(workspace, /requestedRestaurantId/);
assert.match(workspace, /payload\?\.order \|\| payload/);
assert.match(workspace, /selectedVariant\?\.label/);
assert.match(workspace, /selectedModifiers/);
assert.match(workspace, /subscribe_kitchen/);
assert.match(workspace, /invalidateQueries\(\{ queryKey: queueQueryKey \}\)/);

assert.match(workspaceShell, /id: "work"[\s\S]*?buildWorkspaceHref\("\/orders", business\.id\)/);
assert.match(
  workspaceShell,
  /export type BusinessWorkspaceModuleId[\s\S]*?\| "work"[\s\S]*?\| "delivery"/,
);
assert.match(
  workspaceShell,
  /id: "delivery"[\s\S]*?buildWorkspaceHref\("\/merchant-delivery", business\.id\)/,
);
assert.match(merchantDelivery, /activeModule="delivery"/);
assert.doesNotMatch(merchantDelivery, /activeModule="work"/);

const ownerQueueStart = routes.indexOf('"/api/owner/kitchen-queue/:restaurantId"');
const ownerHistoryStart = routes.indexOf('"/api/owner/orders/:restaurantId"');
const ownerMutationStart = routes.indexOf('"/api/owner/orders/:orderId/status"');
assert.ok(ownerQueueStart >= 0 && ownerHistoryStart > ownerQueueStart);
assert.ok(ownerMutationStart > ownerHistoryStart);
const ownerRoutes = routes.slice(ownerQueueStart, routes.indexOf('"/api/my/orders"'));
assert.match(ownerRoutes, /assertOrderingWorkspaceAccess/);
assert.match(ownerRoutes, /isAuthenticated/);
assert.match(ownerRoutes, /pickupOrderItems/);
assert.match(ownerRoutes, /hasMore: orders\.length === limit/);
assert.match(
  routes,
  /if \(status === ORDER_STATUS\.CONFIRMED\) \{[\s\S]*?updates\.confirmedAt = now/,
);
assert.match(routes, /isAdminUserType\(user\?\.userType\)/);
assert.match(routes, /\["restaurant_owner", "food_truck"\]/);
assert.match(
  websocket,
  /subscribe_kitchen[\s\S]*?isAdminUserType\(socket\.user\.userType\)[\s\S]*?verifyRestaurantOwnership/,
);

assert.match(confirmation, /function normalizeOrderPayload/);
assert.match(confirmation, /payload\?\.order \|\| payload/);
assert.match(confirmation, /payload\?\.items/);
assert.match(confirmation, /selectedVariant\?\.label/);
assert.doesNotMatch(confirmation, /setOrder\(data\)/);

for (const source of [app, navigation]) {
  assert.match(source, /currentPath === "\/orders"/);
  assert.match(source, /currentPath === "\/kitchen"/);
}
assert.match(navigation, /path: "\/orders", icon: Receipt, label: "Activity"/);
assert.match(profile, /label: "Activity"[\s\S]*?href: "\/orders"/);

for (const source of [orders, kitchen, workspace, confirmation]) {
  assert.doesNotMatch(
    source,
    /Open Scout|Scout nearby|Keep scouting|Back to Scout/,
  );
}

console.log("mealscout-orders-workspace.contract: PASS");
