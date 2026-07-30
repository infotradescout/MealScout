import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const orders = read("client/src/pages/orders.tsx");
const kitchen = read("client/src/pages/kitchen-display.tsx");
const workspace = read("client/src/components/owner-orders-workspace.tsx");
const workspaceShell = read(
  "client/src/components/business-workspace-shell.tsx",
);
const merchantDelivery = read("client/src/pages/merchant-delivery.tsx");
const confirmation = read("client/src/pages/order-confirmation.tsx");
const checkout = read("client/src/pages/pickup-checkout.tsx");
const routes = read("server/routes/pickupOrderRoutes.ts");
const idempotencyMiddleware = read("server/middleware/idempotency.ts");
const webhookStatefulReplay = read(
  "scripts/mealscout-stripe-webhook-stateful-replay.integration.test.ts",
);
const paymentCancellation = read(
  "server/services/pickupOrderPaymentCancellation.ts",
);
const paymentIntentState = read(
  "server/services/pickupOrderPaymentIntentState.ts",
);
const menuRoutes = read("server/routes/menuRoutes.ts");
const actionRoutes = read("server/routes/actionRoutes.ts");
const schema = read("shared/schema/legacy.ts");
const merchantDeliveryRoutes = read("server/routes/merchantDeliveryRoutes.ts");
const cityTimeZone = read("server/services/cityTimeZone.ts");
const websocket = read("server/websocket.ts");
const app = read("client/src/App.tsx");
const navigation = read("client/src/components/navigation.tsx");
const profile = read("client/src/pages/profile.tsx");
const cleanAffiliateLinks = read("shared/cleanAffiliateLinks.ts");

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
  assert.ok(
    workspace.includes(expected),
    `Missing Orders behavior: ${expected}`,
  );
}
assert.doesNotMatch(workspace, /subscription|Review plan/i);
assert.match(workspace, /requestedRestaurantId/);
assert.match(workspace, /payload\?\.order \|\| payload/);
assert.match(workspace, /selectedVariant\?\.label/);
assert.match(workspace, /selectedModifiers/);
assert.match(workspace, /subscribe_kitchen/);
assert.match(workspace, /invalidateQueries\(\{ queryKey: queueQueryKey \}\)/);

assert.match(
  workspaceShell,
  /id: "work"[\s\S]*?buildWorkspaceHref\("\/orders", business\.id\)/,
);
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
const sharedPublicRoutes = app.slice(
  app.indexOf("function SharedPublicRoutes()"),
  app.indexOf("function Router()"),
);
assert.doesNotMatch(
  sharedPublicRoutes,
  /path="\/merchant-delivery"/,
  "Owner delivery settings must not be registered as a shared public route",
);
assert.equal(
  (app.match(/path="\/merchant-delivery"/g) || []).length,
  2,
  "Merchant delivery needs one guest guard and one authenticated route",
);
assert.match(app, /path="\/merchant-delivery"\s+component=\{RedirectToLogin\}/);
assert.match(
  app,
  /path="\/merchant-delivery"\s+component=\{MerchantDeliveryPage\}/,
);
assert.match(
  app,
  /const usesBusinessWorkspace =[\s\S]*currentPath === "\/merchant-delivery"/,
);
assert.match(
  app,
  /shouldUseGuestRoutes \? \(\s*<Switch>[\s\S]*\) : \(\s*<Switch>/,
  "Guest and authenticated route sets need their own Switch boundary",
);
assert.match(
  cleanAffiliateLinks,
  /"merchant-delivery"/,
  "The owner-only delivery route must not be parsed as a public business slug",
);

const ownerQueueStart = routes.indexOf(
  '"/api/owner/kitchen-queue/:restaurantId"',
);
const ownerHistoryStart = routes.indexOf('"/api/owner/orders/:restaurantId"');
const ownerMutationStart = routes.indexOf(
  '"/api/owner/orders/:orderId/status"',
);
assert.ok(ownerQueueStart >= 0 && ownerHistoryStart > ownerQueueStart);
assert.ok(ownerMutationStart > ownerHistoryStart);
const ownerRoutes = routes.slice(
  ownerQueueStart,
  routes.indexOf('"/api/my/orders"'),
);
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
assert.match(confirmation, /order\.orderType === "delivery"/);
assert.match(confirmation, /order\.deliveryFeeCents/);
assert.match(confirmation, />Merchant delivery</);
assert.match(confirmation, />Deliver to</);
assert.match(confirmation, /order\.deliveryEstimateMinutes/);
assert.match(confirmation, /out_for_delivery/);
assert.match(confirmation, /delivered/);
assert.match(confirmation, /Ready for Delivery/);
assert.match(confirmation, /window\.sessionStorage\.removeItem/);
assert.match(
  confirmation,
  /order\.paymentMethod === "card" && order\.status === "pending"\) return/,
  "Pending card orders must retain their durable checkout retry key",
);
assert.match(
  confirmation,
  /window\.localStorage\.setItem\(\s*"mealscout_cart"/,
);
assert.match(confirmation, /if \(order\.status === "cancelled"\) return/);
assert.doesNotMatch(confirmation, /setOrder\(data\)/);
assert.match(checkout, /creatingOrderRef\.current/);
assert.match(checkout, /orderIdempotencyKeyRef\.current/);
assert.match(checkout, /window\.sessionStorage/);
assert.match(checkout, /fingerprintCheckoutPayload/);
assert.match(checkout, /retryableResponse/);
assert.match(checkout, /cancel-payment/);
assert.match(checkout, /Cancel payment and release order/);
assert.match(checkout, /"Idempotency-Key": idempotencyKey/);
assert.match(
  checkout,
  /onSuccess=\{\(\) => \{\s*navigate\(`\/order-confirmation\/\$\{orderId\}`\);\s*\}\}/,
  "Client-side payment submission must defer durable key/cart cleanup to authoritative order state",
);
assert.match(
  checkout,
  /if \(data\.clientSecret\)[\s\S]*setClientSecret\(data\.clientSecret\)[\s\S]*navigate\(`\/order-confirmation\/\$\{data\.order\.id\}`\)/,
  "Recovered submitted payments must go to authoritative status instead of opening another payment form",
);
assert.match(
  routes,
  /requireIdempotencyKey\(\{[\s\S]*scope: "pickup-order-create"/,
);
assert.match(
  idempotencyMiddleware,
  /installDurableResponseGate\([\s\S]*\.persist\(statusCode, bodyJson\)[\s\S]*\.then\(\(\) => \{[\s\S]*send\(\)/,
);
assert.match(
  idempotencyMiddleware,
  /AND state = 'processing'[\s\S]*AND locked_until <= now\(\)[\s\S]*RETURNING id/,
  "Expired leases must be claimed atomically",
);
assert.match(
  idempotencyMiddleware,
  /SET state = 'completed'[\s\S]*AND locked_until = \$\{lockedUntil\}[\s\S]*RETURNING id/,
  "Only the active lease may complete a durable response",
);
assert.match(idempotencyMiddleware, /DELETE FROM idempotency_keys/);
assert.match(idempotencyMiddleware, /code: "idempotency_unavailable"/);
assert.doesNotMatch(idempotencyMiddleware, /localFallback/);
assert.doesNotMatch(idempotencyMiddleware, /res\.on\("finish"/);
assert.match(
  webhookStatefulReplay,
  /remote database replay is disabled/,
  "Stateful payment replay must remain loopback-only",
);
assert.match(webhookStatefulReplay, /syntheticSigningOnly: true/);
assert.doesNotMatch(
  webhookStatefulReplay,
  /MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID/,
);
assert.match(
  webhookStatefulReplay,
  /const fixtureClient = await pool\.connect\(\)[\s\S]*const pool = fixtureClient[\s\S]*await pool\.query\("BEGIN"\)/,
  "Fixture setup must use one checked-out PostgreSQL session",
);
assert.match(merchantDeliveryRoutes, /resolveCityTimeZoneStrict/);
assert.match(cityTimeZone, /export async function resolveCityTimeZoneStrict/);
assert.match(cityTimeZone, /return timeZones\.size === 1/);
assert.match(routes, /pg_advisory_lock\(hashtext\(\$1\)\)/);
assert.match(routes, /code: "scheduled_delivery_unsupported"/);
assert.match(routes, /requestedQuantityByItem/);
assert.match(
  routes,
  /inventoryQty: sql`\$\{menuItems\.inventoryQty\} - \$\{requestedQuantity\}`/,
);
assert.match(routes, /gte\(menuItems\.inventoryQty, requestedQuantity\)/);
assert.match(
  routes,
  /inventoryAutoUnavailable: sql`\$\{menuItems\.inventoryQty\} - \$\{requestedQuantity\} = 0`/,
);
assert.match(routes, /scope: "pickup-order-cancel-payment"/);
assert.match(
  routes,
  /Card orders are confirmed only after Stripe reports a successful payment/,
);
assert.match(
  routes,
  /confirmed card order requires a separately authorized refund flow/,
);
assert.match(
  routes,
  /order already being prepared cannot be returned to inventory/,
);
assert.match(routes, /cancelCashPickupOrderByOwner/);
assert.match(routes, /stripe\.paymentIntents\.create\([\s\S]*idempotencyKey:/);
assert.match(
  routes,
  /classifyPreOrderPaymentIntentStatus\([\s\S]*payment_setup_cancelled[\s\S]*payment_state_reconciliation_required/,
  "Provider intent state must be reconciled before local order writes",
);
assert.match(
  routes,
  /intentDisposition !== "create_order" \|\|[\s\S]*!paymentIntent\.client_secret/,
  "A pending card order must not reserve inventory without a usable client secret",
);
assert.match(
  routes,
  /paymentIntent = await stripe\.paymentIntents\.retrieve\([\s\S]*classifyPreOrderPaymentIntentStatus/,
  "An idempotently replayed create response must be refreshed from current provider state",
);
assert.match(
  routes,
  /identity\}\|\$\{idempotencyKey\}\|\$\{orderId\}\|\$\{body\.restaurantId\}/,
  "Provider idempotency must be scoped to the deterministic order and restaurant",
);
assert.ok(
  (routes.match(/paymentIntentMatchesPickupOrder\(/g) || []).length >= 2,
  "Fresh and recovered PaymentIntents must both match order identity and money",
);
assert.ok(
  routes.indexOf("paymentIntent = await stripe.paymentIntents.retrieve(") <
    routes.indexOf(".insert(pickupOrders)"),
  "Current PaymentIntent state must be read before local order persistence",
);
assert.match(
  routes,
  /existingOrder\.status === ORDER_STATUS\.CANCELLED[\s\S]*payment_setup_cancelled/,
);
assert.match(
  routes,
  /recoveredDisposition === "cancelled"[\s\S]*cancelPendingPickupOrderForCanceledPaymentIntent/,
);
assert.match(
  routes,
  /recoveredDisposition === "payment_submitted"[\s\S]*clientSecret: null/,
);
assert.match(
  routes,
  /recoveredDisposition === "resume_payment"[\s\S]*recoveredIntent\.client_secret/,
);
assert.match(paymentIntentState, /requires_payment_method/);
assert.match(paymentIntentState, /"cancelled"/);
assert.match(paymentIntentState, /"resume_payment"/);
assert.match(paymentIntentState, /"payment_submitted"/);
assert.match(paymentIntentState, /"unsafe_state"/);
for (const field of [
  "pickupOrderId",
  "orderId",
  "restaurantId",
  "totalCents",
  "transferGroup",
]) {
  assert.ok(
    paymentIntentState.includes(field),
    `PaymentIntent order matcher missing ${field}`,
  );
}
assert.match(routes, /db\.transaction\(async \(tx: any\)/);
assert.match(routes, /consumePromotionAttribution\([\s\S]*tx,/);
assert.match(routes, /stripe\.paymentIntents\.cancel\(/);
assert.match(
  paymentCancellation,
  /eq\(pickupOrders\.status, "pending"\)[\s\S]*eq\(pickupOrders\.paymentMethod, "card"\)/,
);
assert.match(paymentCancellation, /sum\(\$\{pickupOrderItems\.quantity\}\)/);
assert.match(
  paymentCancellation,
  /inventoryQty: sql`\$\{menuItems\.inventoryQty\} \+ \$\{reservation\.quantity\}`/,
);
assert.match(
  paymentCancellation,
  /currentItem\.inventoryAutoUnavailable === true/,
);
assert.match(
  paymentCancellation,
  /inventoryAutoUnavailable: restoreAutomaticAvailability[\s\S]*\? false/,
);
assert.match(
  paymentCancellation,
  /cancelCashPickupOrderByOwner[\s\S]*eq\(pickupOrders\.status, "confirmed"\)/,
);
assert.doesNotMatch(
  paymentCancellation,
  /cancelCashPickupOrderByOwner[\s\S]*inArray\(pickupOrders\.status, \["confirmed", "preparing"\]\)/,
);
assert.match(paymentCancellation, /status: "reversed"/);
assert.doesNotMatch(paymentCancellation, /promotionAttributions\).*update/);
assert.ok(
  routes.indexOf("stripe.paymentIntents.create(") <
    routes.indexOf(".insert(pickupOrders)"),
  "Card provider setup must occur before local order side effects",
);

assert.match(
  schema,
  /insertMenuItemSchema[\s\S]*inventoryAutoUnavailable: true/,
  "Inventory availability provenance must not be client-writable",
);
for (const source of [menuRoutes, actionRoutes]) {
  assert.match(
    source,
    /hasOwnProperty\.call\(updates, "isAvailable"\)[\s\S]*hasOwnProperty\.call\(updates, "inventoryQty"\)[\s\S]*inventoryAutoUnavailable: false/,
    "Owner menu mutations must clear automatic-unavailability provenance",
  );
}

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
