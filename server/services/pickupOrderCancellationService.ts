import Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";

import { ORDER_STATUS, pickupOrders, type PickupOrder } from "@shared/schema";
import {
  isPickupOrderCustomerMadeWhole,
  pickupOrderCustomerRecoveryAmountCents,
  pickupOrderDisputeRecoveryAmountCents,
} from "@shared/pickupOrderFinancialTruth";
import { db } from "../db";
import { pickupOrderFinancialLockKey } from "../utils/pickupOrderFinancialLock";
import { restoreTrackedInventoryForPickupOrderByOrderId } from "./pickupInventoryService";
import { recoverPayoutWithoutDowngradingCustomerRefund } from "./pickupOrderPayoutRecoveryPolicy";
import { reversePickupOrderTransfers } from "./pickupOrderTransferReversalService";
import {
  classifyStripeRefundStatus,
  describePickupOrderReconciliationFailure,
  derivePickupOrderAggregateRefundStatus,
  isPickupPaymentIntentAmountBound,
  isPickupPaymentIntentOrderIdentityBound,
  isPickupRefundFromOrder,
  isStripePaymentIntentCancelable,
  summarizePickupOrderRefunds,
} from "./pickupOrderPaymentReconciliation";

export const PICKUP_ORDER_PAYOUT_REVERSAL_PENDING = "reversal_pending";

type CancellationResult =
  | { outcome: "cancelled"; order: PickupOrder }
  | {
      outcome: "pending";
      order: PickupOrder;
      refundStatus: string | null;
    }
  | { outcome: "conflict"; order: PickupOrder | null };

function cancellationError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export async function reconcileCancelledPickupOrderPayoutReversal(input: {
  orderId: string;
  stripe: Stripe | null;
}): Promise<PickupOrder | null> {
  if (!input.stripe) return null;
  const stripe = input.stripe;

  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
    );
    const [current] = await tx
      .select()
      .from(pickupOrders)
      .where(eq(pickupOrders.id, input.orderId))
      .limit(1);
    if (
      !current ||
      current.status !== ORDER_STATUS.CANCELLED ||
      current.paymentMethod !== "card" ||
      !isPickupOrderCustomerMadeWhole(current)
    ) {
      return null;
    }
    const attemptCount =
      Math.max(0, Number(current.payoutReversalAttemptCount || 0)) + 1;
    const attemptedAt = new Date();
    try {
      if (!current.stripePaymentIntentId) {
        throw new Error(
          `Cancelled pickup order ${current.id} has no bound Stripe PaymentIntent.`,
        );
      }
      const paymentIntent = await stripe.paymentIntents.retrieve(
        current.stripePaymentIntentId,
      );
      if (
        !isPickupPaymentIntentAmountBound(paymentIntent, current.totalCents) ||
        !isPickupPaymentIntentOrderIdentityBound(paymentIntent, current)
      ) {
        throw new Error(
          `Stripe payment ${current.stripePaymentIntentId} does not match cancelled pickup order ${current.id}.`,
        );
      }
      const paymentIntentTransferGroup =
        String(paymentIntent.transfer_group || "").trim() || null;
      const localTransferGroup =
        String(current.stripeTransferGroupId || "").trim() || null;
      const reversal = await reversePickupOrderTransfers({
        stripe,
        orderId: current.id,
        paymentIntentTransferGroup,
        localTransferGroup,
        customerFinancialLossCents: current.totalCents,
        orderTotalCents: current.totalCents,
        idempotencyScope: "cancellation",
      });
      if (
        reversal.currentMerchantNetCents !== 0 ||
        reversal.targetMerchantNetCents !== 0
      ) {
        throw new Error(
          `Cancelled pickup order ${current.id} still has a merchant net of ${reversal.currentMerchantNetCents} cents.`,
        );
      }
      const [reversed] = await tx
        .update(pickupOrders)
        .set({
          payoutStatus: "reversed",
          stripeTransferGroupId:
            paymentIntentTransferGroup || localTransferGroup,
          payoutReversalAttemptCount: attemptCount,
          payoutReversalFailureReason: null,
          payoutReversalUpdatedAt: attemptedAt,
          updatedAt: attemptedAt,
        })
        .where(
          and(
            eq(pickupOrders.id, current.id),
            eq(pickupOrders.status, ORDER_STATUS.CANCELLED),
          ),
        )
        .returning();
      return reversed || current;
    } catch (error) {
      const [pending] = await tx
        .update(pickupOrders)
        .set({
          payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
          payoutReversalAttemptCount: attemptCount,
          payoutReversalFailureReason:
            describePickupOrderReconciliationFailure(error),
          payoutReversalUpdatedAt: attemptedAt,
          updatedAt: attemptedAt,
        })
        .where(
          and(
            eq(pickupOrders.id, current.id),
            eq(pickupOrders.status, ORDER_STATUS.CANCELLED),
          ),
        )
        .returning();
      return pending || current;
    }
  });
}

async function recoverCancelledPayoutForResult(
  result: Extract<CancellationResult, { outcome: "cancelled" }>,
  stripe: Stripe | null,
): Promise<Extract<CancellationResult, { outcome: "cancelled" }>> {
  const order = await recoverPayoutWithoutDowngradingCustomerRefund(
    result.order,
    () =>
      reconcileCancelledPickupOrderPayoutReversal({
        orderId: result.order.id,
        stripe,
      }),
    (error) => {
      console.error(
        `[pickup-order-cancellation] ${result.order.id} payout recovery failed after the customer refund was committed`,
        error,
      );
    },
  );
  return { outcome: "cancelled", order };
}

/**
 * Card cancellation is deliberately two-phase:
 * 1. Commit cancellation_pending while holding the same advisory lock as the
 *    payment webhook. Once committed, no webhook may create a new transfer.
 * 2. Reacquire the lock, reconcile the customer refund idempotently, and
 *    commit cancelled plus inventory restoration.
 * 3. Recover any merchant transfer separately. That recovery may remain
 *    pending, but it can never roll back or relabel the customer refund.
 *
 * If Stripe succeeds but the final database commit fails, the durable
 * cancellation_pending state remains. A retry resumes phase 2; it never
 * exposes a refundable order as pending/confirmed to the payout webhook.
 */
export async function requestAndFinalizeCardPickupOrderCancellation(input: {
  orderId: string;
  expectedStatuses: string[];
  cancellationReason: string;
  stripe: Stripe | null;
  stripeCancellationReason?:
    "duplicate" | "fraudulent" | "requested_by_customer" | "abandoned";
  allowFailedRefundRetry?: boolean;
}): Promise<CancellationResult> {
  const stripe = input.stripe;

  const request = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
    );
    const [current] = await tx
      .select()
      .from(pickupOrders)
      .where(eq(pickupOrders.id, input.orderId))
      .limit(1);
    if (!current) return { outcome: "conflict", order: null } as const;
    if (current.status === ORDER_STATUS.CANCELLED) {
      if (
        input.expectedStatuses.includes(ORDER_STATUS.CANCELLED) &&
        !isPickupOrderCustomerMadeWhole(current)
      ) {
        const [reopened] = await tx
          .update(pickupOrders)
          .set({
            status: ORDER_STATUS.CANCELLATION_PENDING,
            payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
            cancellationReason:
              current.cancellationReason || input.cancellationReason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pickupOrders.id, current.id),
              eq(pickupOrders.status, ORDER_STATUS.CANCELLED),
            ),
          )
          .returning();
        return reopened
          ? ({ outcome: "requested", order: reopened } as const)
          : ({ outcome: "conflict", order: current } as const);
      }
      return { outcome: "complete", order: current } as const;
    }
    if (current.paymentMethod !== "card") {
      throw cancellationError(
        "This paid order cannot be cancelled until its payment can be refunded safely.",
        503,
      );
    }
    if (current.status === ORDER_STATUS.CANCELLATION_PENDING) {
      await restoreTrackedInventoryForPickupOrderByOrderId(tx, current.id);
      return { outcome: "requested", order: current } as const;
    }
    if (!input.expectedStatuses.includes(current.status)) {
      return { outcome: "conflict", order: current } as const;
    }
    const [requested] = await tx
      .update(pickupOrders)
      .set({
        status: ORDER_STATUS.CANCELLATION_PENDING,
        payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
        cancellationReason: input.cancellationReason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pickupOrders.id, current.id),
          eq(pickupOrders.status, current.status),
        ),
      )
      .returning();
    if (requested) {
      // Once cancellation_pending is committed, fulfillment and merchant
      // transfer are blocked. Release the reservation immediately; a pending
      // or failed refund must not keep sellable stock hostage.
      await restoreTrackedInventoryForPickupOrderByOrderId(tx, requested.id);
    }
    return requested
      ? ({ outcome: "requested", order: requested } as const)
      : ({ outcome: "conflict", order: current } as const);
  });

  if (request.outcome === "conflict") return request;
  if (request.outcome === "complete") {
    return recoverCancelledPayoutForResult(
      { outcome: "cancelled", order: request.order },
      stripe,
    );
  }
  if (!stripe) {
    return {
      outcome: "pending",
      order: request.order,
      refundStatus: request.order.stripeRefundStatus || null,
    };
  }

  let finalized: CancellationResult;
  try {
    finalized = await db.transaction(
      async (tx: any): Promise<CancellationResult> => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
        );
        const [current] = await tx
          .select()
          .from(pickupOrders)
          .where(eq(pickupOrders.id, input.orderId))
          .limit(1);
        if (!current) return { outcome: "conflict", order: null };
        if (current.status === ORDER_STATUS.CANCELLED) {
          return { outcome: "cancelled", order: current };
        }
        if (current.status !== ORDER_STATUS.CANCELLATION_PENDING) {
          return { outcome: "conflict", order: current };
        }
        if (!current.stripePaymentIntentId) {
          const [reconciliationRequired] = await tx
            .update(pickupOrders)
            .set({
              payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
              stripeRefundStatus: "reconciliation_required",
              refundFailureReason:
                "The card checkout has no linked Stripe PaymentIntent and needs reconciliation.",
              refundUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(pickupOrders.id, current.id))
            .returning();
          return {
            outcome: "pending",
            order: reconciliationRequired || current,
            refundStatus: "reconciliation_required",
          };
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(
          current.stripePaymentIntentId,
        );
        const paymentIntentTransferGroup =
          String(paymentIntent.transfer_group || "").trim() || null;
        const localTransferGroup =
          String(current.stripeTransferGroupId || "").trim() || null;
        const authoritativeTransferGroup =
          paymentIntentTransferGroup || localTransferGroup;
        if (!isPickupPaymentIntentOrderIdentityBound(paymentIntent, current)) {
          throw cancellationError(
            `Stripe payment ${current.stripePaymentIntentId} identity does not match pickup order ${current.id}.`,
            502,
          );
        }
        if (paymentIntent.status === "succeeded") {
          if (
            !isPickupPaymentIntentAmountBound(paymentIntent, current.totalCents)
          ) {
            throw cancellationError(
              `Stripe payment ${current.stripePaymentIntentId} does not match pickup order ${current.id}.`,
              502,
            );
          }
          let summary = await summarizePickupOrderRefunds({
            stripe,
            paymentIntentId: current.stripePaymentIntentId,
            totalCents: current.totalCents,
          });
          let latestRefund = summary.latestRefund;
          const latestState = classifyStripeRefundStatus(latestRefund?.status);
          const disputeRecoveryAmountCents =
            pickupOrderDisputeRecoveryAmountCents(current);
          const refundTargetCents = Math.max(
            0,
            current.totalCents - disputeRecoveryAmountCents,
          );
          const mayCreateRemainingRefund =
            summary.pendingAmountCents === 0 &&
            summary.succeededAmountCents < refundTargetCents &&
            (latestState !== "failed" || input.allowFailedRefundRetry === true);
          if (mayCreateRemainingRefund) {
            const refundAttempt =
              Math.max(0, Number(current.refundAttemptCount || 0)) + 1;
            const remainingAmount =
              refundTargetCents - summary.succeededAmountCents;
            latestRefund = await stripe.refunds.create(
              {
                payment_intent: current.stripePaymentIntentId,
                amount: remainingAmount,
                reason: "requested_by_customer",
                metadata: { pickupOrderId: current.id },
              },
              {
                idempotencyKey: `pickup-order:${current.id}:refund:${refundAttempt}`,
              },
            );
            if (
              !isPickupRefundFromOrder(
                latestRefund,
                current.stripePaymentIntentId,
                current.totalCents,
              ) ||
              Number(latestRefund.amount) !== remainingAmount
            ) {
              throw cancellationError(
                `Stripe refund ${latestRefund.id} does not match pickup order ${current.id}.`,
                502,
              );
            }
            current.refundAttemptCount = refundAttempt;
            summary = await summarizePickupOrderRefunds({
              stripe,
              paymentIntentId: current.stripePaymentIntentId,
              totalCents: current.totalCents,
            });
            latestRefund = summary.latestRefund || latestRefund;
          }

          const customerRecoveryAmountCents =
            pickupOrderCustomerRecoveryAmountCents({
              ...current,
              stripeRefundAmountCents: summary.succeededAmountCents,
            });
          const customerMadeWhole =
            customerRecoveryAmountCents === current.totalCents;
          const refundStatus =
            summary.succeededAmountCents === current.totalCents
              ? "succeeded"
              : summary.pendingAmountCents > 0
                ? "pending"
                : summary.succeededAmountCents > 0
                  ? derivePickupOrderAggregateRefundStatus({
                      totalCents: current.totalCents,
                      succeededAmountCents: summary.succeededAmountCents,
                      pendingAmountCents: summary.pendingAmountCents,
                      latestRefundStatus: latestRefund?.status,
                    })
                  : customerMadeWhole
                    ? "not_required_dispute_recovery"
                    : String(latestRefund?.status || "reconciliation_required");
          const refundFailureReason =
            String(
              (
                latestRefund as
                  (Stripe.Refund & { failure_reason?: string | null }) | null
              )?.failure_reason || "",
            ).trim() || null;
          const [refundTracked] = await tx
            .update(pickupOrders)
            .set({
              stripeRefundId: latestRefund?.id || current.stripeRefundId,
              stripeRefundStatus: refundStatus,
              stripeRefundAmountCents: summary.succeededAmountCents,
              stripeTransferGroupId: authoritativeTransferGroup,
              refundAttemptCount: current.refundAttemptCount,
              refundFailureReason,
              refundUpdatedAt: new Date(),
              payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(pickupOrders.id, current.id),
                eq(pickupOrders.status, ORDER_STATUS.CANCELLATION_PENDING),
              ),
            )
            .returning();
          if (!refundTracked) return { outcome: "conflict", order: current };
          if (!customerMadeWhole) {
            return {
              outcome: "pending",
              order: refundTracked,
              refundStatus,
            };
          }
        } else if (paymentIntent.status !== "canceled") {
          if (!isStripePaymentIntentCancelable(paymentIntent.status)) {
            throw cancellationError(
              `Stripe payment ${current.stripePaymentIntentId} cannot be reconciled from status ${paymentIntent.status}.`,
              502,
            );
          }
          await stripe.paymentIntents.cancel(
            current.stripePaymentIntentId,
            {
              cancellation_reason:
                input.stripeCancellationReason || "requested_by_customer",
            },
            {
              idempotencyKey: `pickup-order:${current.id}:payment-intent-cancel`,
            },
          );
        }

        const now = new Date();
        const customerPaymentWasCaptured = paymentIntent.status === "succeeded";
        const [cancelled] = await tx
          .update(pickupOrders)
          .set({
            status: ORDER_STATUS.CANCELLED,
            payoutStatus: customerPaymentWasCaptured
              ? PICKUP_ORDER_PAYOUT_REVERSAL_PENDING
              : "reversed",
            ...(!customerPaymentWasCaptured
              ? {
                  stripeRefundStatus: "not_required_payment_not_captured",
                  stripeRefundAmountCents: 0,
                  refundUpdatedAt: now,
                }
              : {}),
            stripeTransferGroupId: authoritativeTransferGroup,
            refundFailureReason: null,
            payoutReversalFailureReason: null,
            cancelledAt: now,
            cancellationReason: current.cancellationReason,
            updatedAt: now,
          })
          .where(
            and(
              eq(pickupOrders.id, current.id),
              eq(pickupOrders.status, ORDER_STATUS.CANCELLATION_PENDING),
            ),
          )
          .returning();
        if (!cancelled) return { outcome: "conflict", order: current };

        await restoreTrackedInventoryForPickupOrderByOrderId(tx, cancelled.id);
        return { outcome: "cancelled", order: cancelled };
      },
    );
  } catch (error) {
    // The Stripe outcome may be ambiguous. Keep the prior attempt counter so
    // retrying uses the same idempotency key, but persist a visible fail-closed
    // reconciliation state after the rolled-back phase-2 transaction.
    return db.transaction(async (tx: any): Promise<CancellationResult> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(input.orderId)}))`,
      );
      const [current] = await tx
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, input.orderId))
        .limit(1);
      if (!current) return { outcome: "conflict", order: null };
      if (current.status === ORDER_STATUS.CANCELLED) {
        return { outcome: "cancelled", order: current };
      }
      if (current.status !== ORDER_STATUS.CANCELLATION_PENDING) {
        return { outcome: "conflict", order: current };
      }
      const [failed] = await tx
        .update(pickupOrders)
        .set({
          payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
          stripeRefundStatus: "reconciliation_required",
          refundFailureReason: describePickupOrderReconciliationFailure(error),
          refundUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pickupOrders.id, current.id),
            eq(pickupOrders.status, ORDER_STATUS.CANCELLATION_PENDING),
          ),
        )
        .returning();
      return {
        outcome: "pending",
        order: failed || current,
        refundStatus: "reconciliation_required",
      };
    });
  }

  return finalized.outcome === "cancelled"
    ? recoverCancelledPayoutForResult(finalized, stripe)
    : finalized;
}
