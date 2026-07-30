import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPreOrderPaymentIntentStatus,
  paymentIntentMatchesPickupOrder,
} from "../server/services/pickupOrderPaymentIntentState";

test("a fresh unconfirmed PaymentIntent may proceed to local order creation", () => {
  assert.equal(
    classifyPreOrderPaymentIntentStatus("requires_payment_method"),
    "create_order",
  );
});

test("an ambiguously cancelled PaymentIntent cannot create a pending local order", () => {
  assert.equal(classifyPreOrderPaymentIntentStatus("canceled"), "cancelled");
});

test("a submitted provider state cannot start a second payment form", () => {
  for (const status of ["processing", "requires_capture", "succeeded"]) {
    assert.equal(
      classifyPreOrderPaymentIntentStatus(status),
      "payment_submitted",
    );
  }
});

test("an interrupted customer action can resume against the existing intent", () => {
  assert.equal(
    classifyPreOrderPaymentIntentStatus("requires_action"),
    "resume_payment",
  );
});

test("unknown provider states fail closed", () => {
  for (const status of ["requires_confirmation", "", undefined]) {
    assert.equal(classifyPreOrderPaymentIntentStatus(status), "unsafe_state");
  }
});

test("provider intent identity and money must match the deterministic order", () => {
  const expected = {
    orderId: "order-a",
    restaurantId: "restaurant-a",
    totalCents: 3099,
    transferGroup: "order_order-a",
  };
  const matching = {
    amount: 3099,
    currency: "usd",
    transfer_group: "order_order-a",
    metadata: {
      pickupOrderId: "order-a",
      orderId: "order-a",
      restaurantId: "restaurant-a",
    },
  };
  assert.equal(paymentIntentMatchesPickupOrder(matching, expected), true);
  for (const mismatch of [
    { ...matching, amount: 3100 },
    { ...matching, currency: "cad" },
    { ...matching, transfer_group: "order_other" },
    {
      ...matching,
      metadata: { ...matching.metadata, restaurantId: "restaurant-b" },
    },
    {
      ...matching,
      metadata: { ...matching.metadata, pickupOrderId: "order-b" },
    },
    {
      ...matching,
      metadata: { ...matching.metadata, orderId: "order-b" },
    },
  ]) {
    assert.equal(paymentIntentMatchesPickupOrder(mismatch, expected), false);
  }
});
