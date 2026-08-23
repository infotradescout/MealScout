import assert from "node:assert/strict";
import { shouldAttemptPickupWebhookPayoutTransfer } from "../server/utils/pickupWebhookPayout";

type Case = {
  name: string;
  input: Parameters<typeof shouldAttemptPickupWebhookPayoutTransfer>[0];
  expected: boolean;
};

const base = {
  stripeTransferGroupId: "group_fixture",
  payoutStatus: "pending",
  paymentSucceeded: true,
};

const cases: Case[] = [
  {
    name: "a succeeded payment may settle while the order is pending",
    input: {
      ...base,
      statusBeforeWebhook: "pending",
    },
    expected: true,
  },
  {
    name: "a pending order cannot settle before payment succeeds",
    input: {
      ...base,
      statusBeforeWebhook: "pending",
      paymentSucceeded: false,
    },
    expected: false,
  },
  {
    name: "already-confirmed order may reconcile an incomplete payout",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
    },
    expected: true,
  },
  {
    name: "cancelled order never transfers",
    input: {
      ...base,
      statusBeforeWebhook: "cancelled",
    },
    expected: false,
  },
  {
    name: "cancelled order remains ineligible after a succeeded payment event",
    input: {
      ...base,
      statusBeforeWebhook: "cancelled",
    },
    expected: false,
  },
  {
    name: "preparing order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "preparing",
    },
    expected: false,
  },
  {
    name: "ready order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "ready",
    },
    expected: false,
  },
  {
    name: "completed order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "completed",
    },
    expected: false,
  },
  {
    name: "missing transfer group is never eligible",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
      stripeTransferGroupId: null,
    },
    expected: false,
  },
  {
    name: "already-transferred payout is never retried",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
      payoutStatus: "transferred",
    },
    expected: false,
  },
];

for (const testCase of cases) {
  assert.equal(
    shouldAttemptPickupWebhookPayoutTransfer(testCase.input),
    testCase.expected,
    testCase.name,
  );
}

console.log(
  `mealscout-pickup-webhook-payout-eligibility: PASS (${cases.length}/${cases.length})`,
);
