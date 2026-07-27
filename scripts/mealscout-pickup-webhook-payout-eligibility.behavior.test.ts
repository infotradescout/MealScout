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
};

const cases: Case[] = [
  {
    name: "pending order may transfer only after this handler confirms it",
    input: {
      ...base,
      statusBeforeWebhook: "pending",
      transitionedToConfirmed: true,
    },
    expected: true,
  },
  {
    name: "pending order without a confirmed transition cannot transfer",
    input: {
      ...base,
      statusBeforeWebhook: "pending",
      transitionedToConfirmed: false,
    },
    expected: false,
  },
  {
    name: "already-confirmed order may reconcile an incomplete payout",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
      transitionedToConfirmed: false,
    },
    expected: true,
  },
  {
    name: "cancelled order never transfers",
    input: {
      ...base,
      statusBeforeWebhook: "cancelled",
      transitionedToConfirmed: false,
    },
    expected: false,
  },
  {
    name: "cancelled order remains ineligible even with an impossible transition flag",
    input: {
      ...base,
      statusBeforeWebhook: "cancelled",
      transitionedToConfirmed: true,
    },
    expected: false,
  },
  {
    name: "preparing order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "preparing",
      transitionedToConfirmed: false,
    },
    expected: false,
  },
  {
    name: "ready order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "ready",
      transitionedToConfirmed: false,
    },
    expected: false,
  },
  {
    name: "completed order does not receive a delayed payout transfer",
    input: {
      ...base,
      statusBeforeWebhook: "completed",
      transitionedToConfirmed: false,
    },
    expected: false,
  },
  {
    name: "missing transfer group is never eligible",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
      transitionedToConfirmed: false,
      stripeTransferGroupId: null,
    },
    expected: false,
  },
  {
    name: "already-transferred payout is never retried",
    input: {
      ...base,
      statusBeforeWebhook: "confirmed",
      transitionedToConfirmed: false,
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
