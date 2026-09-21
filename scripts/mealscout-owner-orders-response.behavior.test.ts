import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isOwnerOrdersAccessError,
  OwnerOrdersReadError,
  readOwnerOrdersResponse,
} from "../client/src/lib/owner-orders-response";

const businessId = "fixture-business";
const order = {
  id: "fixture-order-1",
  restaurantId: businessId,
  customerName: "Test customer",
  status: "confirmed",
  orderType: "pickup",
  paymentMethod: "card",
  payoutStatus: "transferred",
  totalCents: 1250,
  createdAt: "2026-09-19T12:00:00.000Z",
  items: [{ id: "fixture-item", itemName: "Lunch", quantity: 1, lineTotalCents: 1250 }],
};
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const rejectsUnverified = (payload: unknown) => assert.rejects(
  readOwnerOrdersResponse(response(payload), businessId),
  (error: unknown) => error instanceof OwnerOrdersReadError &&
    error.status === 200 && !isOwnerOrdersAccessError(error) &&
    error.message.includes("could not verify"),
);

test("a verified empty queue remains empty without invented orders", async () => {
  assert.deepEqual(await readOwnerOrdersResponse(response({ orders: [] }), businessId), {
    orders: [], page: 1, hasMore: false,
  });
});

test("valid orders, item notes, financial and delivery fields are not rewritten", async () => {
  const saved = { ...order, status: "cancellation_pending", payoutStatus: "reversal_pending",
    stripeRefundStatus: "pending", stripeRefundAmountCents: 1250,
    orderType: "delivery", deliveryInstructions: "Use side entrance",
    specialInstructions: "Allergy: no nuts", items: [{ ...order.items[0],
      specialInstructions: "No sauce", selectedModifiers: [{ label: "Large" }] }] };
  const result = await readOwnerOrdersResponse(response({ orders: [saved], page: 2, hasMore: true }), businessId);
  assert.deepEqual(result, { orders: [saved], page: 2, hasMore: true });
});

test("numeric-string page metadata keeps existing API compatibility", async () => {
  const result = await readOwnerOrdersResponse(response({ orders: [order], page: "2", hasMore: true }), businessId);
  assert.equal(result.page, 2);
  assert.equal(result.hasMore, true);
});

test("a valid response after a failed read recovers without changing the request identity", async () => {
  await rejectsUnverified({ message: "Temporary upstream response" });
  assert.deepEqual((await readOwnerOrdersResponse(response({ orders: [order] }), businessId)).orders, [order]);
});

for (const [label, body] of [
  ["HTML success response", "<html>Sign in</html>"],
  ["truncated JSON", '{"orders": ['],
  ["empty success body", ""],
]) {
  test(`${label} is an error, not No orders yet`, async () => {
    await assert.rejects(readOwnerOrdersResponse(new Response(body), businessId), OwnerOrdersReadError);
  });
}

test("204 without a queue is unverified, not empty", async () => {
  await assert.rejects(readOwnerOrdersResponse(new Response(null, { status: 204 }), businessId), OwnerOrdersReadError);
});

const invalidPayloads: Array<[string, unknown]> = [
  ["null envelope", null],
  ["array envelope", []],
  ["missing orders", { message: "OK" }],
  ["non-array orders", { orders: {} }],
  ["null order row", { orders: [null] }],
  ["empty order identity", { orders: [{ ...order, id: "" }] }],
  ["wrong business", { orders: [{ ...order, restaurantId: "another-business" }] }],
  ["mixed businesses", { orders: [order, { ...order, id: "other", restaurantId: "another-business" }] }],
  ["duplicate order rows", { orders: [order, order] }],
  ["missing status", { orders: [{ ...order, status: undefined }] }],
  ["missing fulfillment type", { orders: [{ ...order, orderType: undefined }] }],
  ["missing payment method", { orders: [{ ...order, paymentMethod: undefined }] }],
  ["missing item details", { orders: [{ ...order, items: undefined }] }],
  ["null item", { orders: [{ ...order, items: [null] }] }],
  ["invalid item quantity", { orders: [{ ...order, items: [{ ...order.items[0], quantity: "1" }] }] }],
  ["zero page", { orders: [order], page: 0 }],
  ["fractional page", { orders: [order], page: 1.5 }],
  ["invalid page text", { orders: [order], page: "later" }],
  ["boolean page", { orders: [order], page: true }],
  ["null page", { orders: [order], page: null }],
  ["unsafe next page", { orders: [order], page: Number.MAX_SAFE_INTEGER }],
  ["string hasMore", { orders: [order], hasMore: "false" }],
  ["empty page promising more", { orders: [], hasMore: true }],
];
for (const [label, payload] of invalidPayloads) {
  test(`${label} fails closed without silently dropping orders`, () => rejectsUnverified(payload));
}

test("an empty business identity never accepts an empty queue", async () => {
  await assert.rejects(readOwnerOrdersResponse(response({ orders: [] }), ""), OwnerOrdersReadError);
});

for (const status of [401, 403]) {
  test(`HTTP ${status} remains an access error even with a non-JSON body`, async () => {
    await assert.rejects(
      readOwnerOrdersResponse(new Response("upstream page", { status }), businessId),
      (error: unknown) => error instanceof OwnerOrdersReadError &&
        error.status === status && isOwnerOrdersAccessError(error),
    );
  });
}

test("server error messages are retained without accepting the response as an order list", async () => {
  await assert.rejects(readOwnerOrdersResponse(response({ message: "Temporary outage" }, 503), businessId),
    (error: unknown) => error instanceof OwnerOrdersReadError && error.message === "Temporary outage" &&
      error.status === 503 && !isOwnerOrdersAccessError(error));
});

test("non-string server errors use an actionable fallback instead of [object Object]", async () => {
  await assert.rejects(readOwnerOrdersResponse(response({ error: { internal: "fixture" } }, 500), businessId),
    (error: unknown) => error instanceof OwnerOrdersReadError && error.message.includes("try again") &&
      !error.message.includes("[object Object]"));
});

test("an error field containing text remains available to the operator", async () => {
  await assert.rejects(readOwnerOrdersResponse(response({ error: "Service unavailable" }, 503), businessId),
    (error: unknown) => error instanceof OwnerOrdersReadError && error.message === "Service unavailable");
});

// These three are source-wiring contracts, not browser or server acceptance.
const workspace = readFileSync("client/src/components/owner-orders-workspace.tsx", "utf8");
test("both owner read endpoints pass the selected business into the checked reader", () => {
  assert.match(workspace, /readOwnerOrdersResponse\(response, restaurantId\)/);
  assert.match(workspace, /\/api\/owner\/orders\/\$\{encodeURIComponent\(restaurantId\)\}[^`]*`,\s+restaurantId,/);
  assert.match(workspace, /\/api\/owner\/kitchen-queue\/\$\{encodeURIComponent\(restaurantId\)\}`,\s+restaurantId,/);
  assert.doesNotMatch(workspace, /orders: Array\.isArray\(payload\?\.orders\) \? payload\.orders : \[\]/);
});

test("unverified data cannot show empty-state success, live confirmation, or zero counts", () => {
  assert.match(workspace, /!error && !isLoading && orders\.length === 0/);
  assert.match(workspace, /\{error \|\| isLoading \? "—" : value\}/);
  assert.match(workspace, /error \? "Updates unverified"/);
  assert.match(workspace, /isConnected && !error && !isLoading/);
  assert.match(workspace, /!user \|\| error \|\| statusUpdatePendingRef\.current/);
});

test("retry remains an accessible read with a pending guard; financial mutation code stays separate", () => {
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /aria-busy=\{queueQuery\.isFetching \|\| historyQuery\.isFetching\}/);
  assert.match(workspace, /disabled=\{queueQuery\.isFetching \|\| historyQuery\.isFetching\}/);
  const reader = workspace.slice(workspace.indexOf("async function fetchOrders("), workspace.indexOf("function mergeOrder("));
  assert.doesNotMatch(reader, /PATCH|POST|DELETE|statusMutation|mutate/);
});
