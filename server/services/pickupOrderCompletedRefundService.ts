import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";

import { pickupOrders, type PickupOrder } from "@shared/schema";
import { db } from "../db";
import { pickupOrderFinancialLockKey } from "../utils/pickupOrderFinancialLock";
import {
  describePickupOrderReconciliationFailure,
  derivePickupOrderAggregateRefundStatus,
  isPickupPaymentIntentAmountBound,
  isPickupPaymentIntentOrderIdentityBound,
  summarizePickupOrderRefunds,
} from "./pickupOrderPaymentReconciliation";
import { reversePickupOrderTransfers } from "./pickupOrderTransferReversalService";
import {
  pickupOrderCustomerFinancialLossCents,
  pickupOrderReconciledPayoutStatus,
} from "./pickupOrderNetSettlementPolicy";

export async function reconcileCompletedPickupOrderRefund(input: {
  orderId: string;
  stripe: Stripe | null;
}): Promise<PickupOrder | null> {
  if (!input.stripe) return null;
  const stripe = input.stripe;
  const attemptedAt = new Date();

  try {
    return await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
      );
      const [order] = await tx
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, input.orderId))
        .limit(1);
      if (!order || order.status !== "completed") return null;
      if (!order.stripePaymentIntentId) {
        throw new Error(
          `Completed pickup order ${order.id} lacks a bound payment.`,
        );
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(
        order.stripePaymentIntentId,
      );
      if (
        !isPickupPaymentIntentAmountBound(paymentIntent, order.totalCents) ||
        !isPickupPaymentIntentOrderIdentityBound(paymentIntent, order)
      ) {
        throw new Error(
          `Stripe payment ${order.stripePaymentIntentId} does not match completed pickup order ${order.id}.`,
        );
      }
      const summary = await summarizePickupOrderRefunds({
        stripe,
        paymentIntentId: order.stripePaymentIntentId,
        totalCents: order.totalCents,
      });
      const latestRefund = summary.latestRefund;
      if (!latestRefund) {
        throw new Error(
          `Stripe reports no refunds for completed pickup order ${order.id}.`,
        );
      }

      if (summary.succeededAmountCents === 0) {
        const latestStatus = String(latestRefund.status || "unknown");
        const latestFailureReason =
          String(
            (
              latestRefund as Stripe.Refund & {
                failure_reason?: string | null;
              }
            ).failure_reason || "",
          ).trim() || null;
        const [tracked] = await tx
          .update(pickupOrders)
          .set({
            stripeRefundId: latestRefund.id,
            stripeRefundStatus: latestStatus,
            stripeRefundAmountCents: 0,
            payoutStatus:
              order.payoutStatus === "reversal_pending"
                ? "transferred"
                : order.payoutStatus,
            refundFailureReason: latestFailureReason,
            refundUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pickupOrders.id, order.id),
              eq(pickupOrders.status, "completed"),
            ),
          )
          .returning();
        if (!tracked) {
          throw new Error(
            `Completed pickup order ${order.id} changed during refund tracking.`,
          );
        }
        return tracked;
      }

      const paymentIntentTransferGroup =
        String(paymentIntent.transfer_group || "").trim() || null;
      const localTransferGroup =
        String(order.stripeTransferGroupId || "").trim() || null;
      const customerFinancialLossCents = pickupOrderCustomerFinancialLossCents({
        totalCents: order.totalCents,
        succeededRefundAmountCents: summary.succeededAmountCents,
        stripeDisputeStatus: order.stripeDisputeStatus,
        stripeDisputeAmountCents: order.stripeDisputeAmountCents,
      });
      await reversePickupOrderTransfers({
        stripe,
        orderId: order.id,
        paymentIntentTransferGroup,
        localTransferGroup,
        customerFinancialLossCents,
        orderTotalCents: order.totalCents,
        idempotencyScope: `completed-refund:${latestRefund.id}:loss:${customerFinancialLossCents}`,
        reversalMetadata: { stripeRefundId: latestRefund.id },
      });

      const reconciledAt = new Date();
      const [reconciled] = await tx
        .update(pickupOrders)
        .set({
          payoutStatus: pickupOrderReconciledPayoutStatus({
            totalCents: order.totalCents,
            succeededRefundAmountCents: summary.succeededAmountCents,
            stripeDisputeStatus: order.stripeDisputeStatus,
          }),
          stripeTransferGroupId:
            paymentIntentTransferGroup || localTransferGroup,
          stripeRefundId: latestRefund.id,
          stripeRefundStatus: derivePickupOrderAggregateRefundStatus({
            totalCents: order.totalCents,
            succeededAmountCents: summary.succeededAmountCents,
            pendingAmountCents: summary.pendingAmountCents,
            latestRefundStatus: latestRefund.status,
          }),
          stripeRefundAmountCents: summary.succeededAmountCents,
          refundFailureReason: null,
          refundUpdatedAt: reconciledAt,
          payoutReversalAttemptCount:
            Math.max(0, Number(order.payoutReversalAttemptCount || 0)) + 1,
          payoutReversalFailureReason: null,
          payoutReversalUpdatedAt: reconciledAt,
          updatedAt: reconciledAt,
        })
        .where(
          and(
            eq(pickupOrders.id, order.id),
            eq(pickupOrders.status, "completed"),
          ),
        )
        .returning();
      if (!reconciled) {
        throw new Error(
          `Completed pickup order ${order.id} changed during refund reconciliation.`,
        );
      }
      return reconciled;
    });
  } catch (error) {
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
      );
      const [current] = await tx
        .select({
          id: pickupOrders.id,
          status: pickupOrders.status,
        })
        .from(pickupOrders)
        .where(eq(pickupOrders.id, input.orderId))
        .limit(1);
      if (!current || current.status !== "completed") return;
      await tx
        .update(pickupOrders)
        .set({
          payoutStatus: "failed",
          payoutReversalAttemptCount: sql`coalesce(${pickupOrders.payoutReversalAttemptCount}, 0) + 1`,
          payoutReversalFailureReason:
            describePickupOrderReconciliationFailure(error),
          payoutReversalUpdatedAt: attemptedAt,
          updatedAt: attemptedAt,
        })
        .where(
          and(
            eq(pickupOrders.id, input.orderId),
            eq(pickupOrders.status, "completed"),
          ),
        );
    });
    throw error;
  }
}
