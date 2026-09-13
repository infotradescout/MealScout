import assert from "node:assert/strict";
import { decideSupplierIntentHandling } from "../server/utils/supplierPaymentIntent";

type Case = {
  name: string;
  input: Parameters<typeof decideSupplierIntentHandling>[0];
  expected: ReturnType<typeof decideSupplierIntentHandling>;
};

const cases: Case[] = [
  {
    name: "reuse when amount and ACH method match",
    input: {
      intent: {
        status: "requires_payment_method",
        amount: 10123,
        metadataPaymentMethod: "ach",
        paymentMethodTypes: ["us_bank_account"],
      },
      paymentMethod: "ach",
      chargeAmountCents: 10123,
    },
    expected: "reuse",
  },
  {
    name: "cancel+recreate when method changes on cancellable intent",
    input: {
      intent: {
        status: "requires_confirmation",
        amount: 10123,
        metadataPaymentMethod: "card",
        paymentMethodTypes: ["card"],
      },
      paymentMethod: "ach",
      chargeAmountCents: 10123,
    },
    expected: "cancel_and_recreate",
  },
  {
    name: "cancel+recreate when amount changes on cancellable intent",
    input: {
      intent: {
        status: "requires_action",
        amount: 9999,
        metadataPaymentMethod: "ach",
        paymentMethodTypes: ["us_bank_account"],
      },
      paymentMethod: "ach",
      chargeAmountCents: 10000,
    },
    expected: "cancel_and_recreate",
  },
  {
    name: "conflict when method changes on processing intent",
    input: {
      intent: {
        status: "processing",
        amount: 10123,
        metadataPaymentMethod: "card",
        paymentMethodTypes: ["card"],
      },
      paymentMethod: "ach",
      chargeAmountCents: 10123,
    },
    expected: "conflict",
  },
  {
    name: "conflict when amount changes on processing intent",
    input: {
      intent: {
        status: "processing",
        amount: 10000,
        metadataPaymentMethod: "ach",
        paymentMethodTypes: ["us_bank_account"],
      },
      paymentMethod: "ach",
      chargeAmountCents: 9999,
    },
    expected: "conflict",
  },
  {
    name: "conflict when a succeeded intent awaits reconciliation",
    input: {
      intent: {
        status: "succeeded",
        amount: 12000,
        metadataPaymentMethod: "card",
        paymentMethodTypes: ["card"],
      },
      paymentMethod: "card",
      chargeAmountCents: 12000,
    },
    expected: "conflict",
  },
];

let passed = 0;
for (const t of cases) {
  const actual = decideSupplierIntentHandling(t.input);
  assert.equal(actual, t.expected, `${t.name}: expected ${t.expected}, got ${actual}`);
  passed += 1;
}

console.log(`supplier payment intent tests passed: ${passed}/${cases.length}`);

