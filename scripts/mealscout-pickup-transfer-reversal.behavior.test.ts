import assert from "node:assert/strict";
import type Stripe from "stripe";

import {
  reinstatePickupOrderDisputeTransfers,
  reversePickupOrderTransfers,
} from "../server/services/pickupOrderTransferReversalService";
import {
  pickupOrderCustomerFinancialLossCents,
  pickupOrderReconciledPayoutStatus,
} from "../server/services/pickupOrderNetSettlementPolicy";

const orderId = "order-net-settlement";
const transferGroup = "group-net-settlement";
const transfers = [
  {
    id: "tr_original",
    amount: 10_000,
    amount_reversed: 10_000,
    reversed: true,
    currency: "usd",
    destination: "acct_merchant",
    transfer_group: transferGroup,
    metadata: { pickupOrderId: orderId },
  },
  {
    id: "tr_reinstatement",
    amount: 10_000,
    amount_reversed: 0,
    reversed: false,
    currency: "usd",
    destination: "acct_merchant",
    transfer_group: transferGroup,
    metadata: {
      pickupOrderId: orderId,
      disputeReinstatementFor: "dp_won",
      originalTransferId: "tr_original",
    },
  },
];
const reversalCalls: Array<{ transferId: string; amount: number }> = [];
const stripe = {
  transfers: {
    list: async () => ({ data: transfers, has_more: false }),
    createReversal: async (transferId: string, params: { amount: number }) => {
      const transfer = transfers.find(
        (candidate) => candidate.id === transferId,
      );
      assert.ok(transfer);
      transfer.amount_reversed += params.amount;
      transfer.reversed = transfer.amount_reversed >= transfer.amount;
      reversalCalls.push({ transferId, amount: params.amount });
      return { id: `trr_${reversalCalls.length}`, amount: params.amount };
    },
  },
} as unknown as Stripe;

const partial = await reversePickupOrderTransfers({
  stripe,
  orderId,
  localTransferGroup: transferGroup,
  customerFinancialLossCents: 5_000,
  orderTotalCents: 10_000,
  idempotencyScope: "refund-half",
});
assert.deepEqual(reversalCalls, [
  { transferId: "tr_reinstatement", amount: 5_000 },
]);
assert.equal(partial.transferAmountCents, 10_000);
assert.equal(partial.currentMerchantNetCents, 5_000);
assert.equal(partial.targetMerchantNetCents, 5_000);

const full = await reversePickupOrderTransfers({
  stripe,
  orderId,
  localTransferGroup: transferGroup,
  customerFinancialLossCents: 10_000,
  orderTotalCents: 10_000,
  idempotencyScope: "refund-full",
});
assert.deepEqual(reversalCalls.at(-1), {
  transferId: "tr_reinstatement",
  amount: 5_000,
});
assert.equal(full.currentMerchantNetCents, 0);
assert.equal(full.targetMerchantNetCents, 0);

const raceOrderId = "order-refund-dispute-race";
const raceTransferGroup = "group-refund-dispute-race";
const raceTransfers: any[] = [
  {
    id: "tr_race_original",
    amount: 10_000,
    amount_reversed: 0,
    reversed: false,
    currency: "usd",
    destination: "acct_merchant",
    transfer_group: raceTransferGroup,
    metadata: { pickupOrderId: raceOrderId },
  },
];
const raceReversals: any[] = [];
const raceStripe = {
  transfers: {
    list: async () => ({ data: raceTransfers, has_more: false }),
    listReversals: async (transferId: string) => ({
      data: raceReversals.filter(
        (reversal) => reversal.transferId === transferId,
      ),
      has_more: false,
    }),
    createReversal: async (
      transferId: string,
      params: { amount: number; metadata?: Record<string, string> },
    ) => {
      const transfer = raceTransfers.find(
        (candidate) => candidate.id === transferId,
      );
      assert.ok(transfer);
      transfer.amount_reversed += params.amount;
      transfer.reversed = transfer.amount_reversed >= transfer.amount;
      const reversal = {
        id: `trr_race_${raceReversals.length + 1}`,
        transferId,
        amount: params.amount,
        metadata: params.metadata || {},
      };
      raceReversals.push(reversal);
      return reversal;
    },
    create: async (params: any) => {
      const transfer = {
        id: `tr_race_credit_${raceTransfers.length}`,
        amount: params.amount,
        amount_reversed: 0,
        reversed: false,
        currency: params.currency,
        destination: params.destination,
        transfer_group: params.transfer_group,
        metadata: params.metadata,
      };
      raceTransfers.push(transfer);
      return transfer;
    },
  },
} as unknown as Stripe;

const activeDisputeLoss = pickupOrderCustomerFinancialLossCents({
  totalCents: 10_000,
  succeededRefundAmountCents: 0,
  stripeDisputeStatus: "needs_response",
  stripeDisputeAmountCents: 10_000,
});
await reversePickupOrderTransfers({
  stripe: raceStripe,
  orderId: raceOrderId,
  localTransferGroup: raceTransferGroup,
  customerFinancialLossCents: activeDisputeLoss,
  orderTotalCents: 10_000,
  idempotencyScope: "dispute:dp_race",
  reversalMetadata: { stripeDisputeId: "dp_race" },
});
assert.equal(raceTransfers[0].amount_reversed, 10_000);

const refundWhileDisputedLoss = pickupOrderCustomerFinancialLossCents({
  totalCents: 10_000,
  succeededRefundAmountCents: 5_000,
  stripeDisputeStatus: "needs_response",
  stripeDisputeAmountCents: 10_000,
});
assert.equal(refundWhileDisputedLoss, 10_000);
await reversePickupOrderTransfers({
  stripe: raceStripe,
  orderId: raceOrderId,
  localTransferGroup: raceTransferGroup,
  customerFinancialLossCents: refundWhileDisputedLoss,
  orderTotalCents: 10_000,
  idempotencyScope: "completed-refund:re_partial",
});
assert.equal(raceTransfers.length, 1);

const disputeWonLoss = pickupOrderCustomerFinancialLossCents({
  totalCents: 10_000,
  succeededRefundAmountCents: 5_000,
  stripeDisputeStatus: "won",
  stripeDisputeAmountCents: 10_000,
});
await reinstatePickupOrderDisputeTransfers({
  stripe: raceStripe,
  orderId: raceOrderId,
  disputeId: "dp_race",
  transferGroups: [raceTransferGroup],
  customerFinancialLossCents: disputeWonLoss,
  orderTotalCents: 10_000,
});
assert.equal(raceTransfers.length, 2);
assert.equal(raceTransfers[1].amount, 5_000);
assert.equal(
  pickupOrderReconciledPayoutStatus({
    totalCents: 10_000,
    succeededRefundAmountCents: 5_000,
    stripeDisputeStatus: "won",
  }),
  "partially_reversed",
);
assert.equal(
  raceTransfers.reduce(
    (net, transfer) => net + transfer.amount - transfer.amount_reversed,
    0,
  ),
  5_000,
  "A dispute win may restore only the merchant net left after the partial refund",
);

const laterRefundLoss = pickupOrderCustomerFinancialLossCents({
  totalCents: 10_000,
  succeededRefundAmountCents: 7_000,
  stripeDisputeStatus: "won",
  stripeDisputeAmountCents: 10_000,
});
await reinstatePickupOrderDisputeTransfers({
  stripe: raceStripe,
  orderId: raceOrderId,
  disputeId: "dp_race",
  transferGroups: [raceTransferGroup],
  customerFinancialLossCents: laterRefundLoss,
  orderTotalCents: 10_000,
});
await reversePickupOrderTransfers({
  stripe: raceStripe,
  orderId: raceOrderId,
  localTransferGroup: raceTransferGroup,
  customerFinancialLossCents: laterRefundLoss,
  orderTotalCents: 10_000,
  idempotencyScope: `dispute:dp_race:net:${laterRefundLoss}`,
  reversalMetadata: { stripeDisputeId: "dp_race" },
});
assert.equal(
  raceTransfers.reduce(
    (net, transfer) => net + transfer.amount - transfer.amount_reversed,
    0,
  ),
  3_000,
  "A later aggregate refund must move a won-dispute merchant net downward too",
);

const multiRefundTransfer: any = {
  id: "tr_multi_refund",
  amount: 10_000,
  amount_reversed: 0,
  reversed: false,
  currency: "usd",
  destination: "acct_merchant",
  transfer_group: "group_multi_refund",
  metadata: { pickupOrderId: "order-multi-refund" },
};
const multiRefundReversalsByKey = new Map<string, any>();
const multiRefundStripe = {
  transfers: {
    list: async () => ({ data: [multiRefundTransfer], has_more: false }),
    createReversal: async (
      _transferId: string,
      params: { amount: number },
      options: { idempotencyKey: string },
    ) => {
      const cached = multiRefundReversalsByKey.get(options.idempotencyKey);
      if (cached) return cached;
      const reversal = {
        id: `trr_multi_${multiRefundReversalsByKey.size + 1}`,
        amount: params.amount,
      };
      multiRefundReversalsByKey.set(options.idempotencyKey, reversal);
      multiRefundTransfer.amount_reversed += params.amount;
      multiRefundTransfer.reversed =
        multiRefundTransfer.amount_reversed >= multiRefundTransfer.amount;
      return reversal;
    },
  },
} as unknown as Stripe;
await reversePickupOrderTransfers({
  stripe: multiRefundStripe,
  orderId: "order-multi-refund",
  localTransferGroup: "group_multi_refund",
  customerFinancialLossCents: 3_000,
  orderTotalCents: 10_000,
  idempotencyScope: "completed-refund:re_newest:loss:3000",
});
await reversePickupOrderTransfers({
  stripe: multiRefundStripe,
  orderId: "order-multi-refund",
  localTransferGroup: "group_multi_refund",
  customerFinancialLossCents: 7_000,
  orderTotalCents: 10_000,
  idempotencyScope: "completed-refund:re_newest:loss:7000",
});
assert.equal(multiRefundTransfer.amount_reversed, 7_000);
assert.equal(multiRefundReversalsByKey.size, 2);
assert.deepEqual(
  [...multiRefundReversalsByKey.values()].map((reversal) => reversal.amount),
  [3_000, 4_000],
  "Out-of-order refund success must use a new key for the larger aggregate loss",
);

console.log("MealScout pickup transfer net-reversal behavior: PASS");
