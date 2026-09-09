import type { Express } from "express";
import Stripe from "stripe";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  hosts,
  suppliers,
  restaurantSubscriptions,
  restaurants,
  users,
} from "@shared/schema";
import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import {
  resolvePickupPayoutSourceTransaction,
  shouldAttemptPickupWebhookPayoutTransfer,
} from "../utils/pickupWebhookPayout";
import { pickupOrderFinancialLockKey } from "../utils/pickupOrderFinancialLock";
import { isRestaurantOrderingAuthorityVersionCurrent } from "../services/restaurantOrderingAuthorityVersion";
import { shouldRevokeUserSubscriptionEntitlements } from "../utils/stripeSubscriptionEntitlements";
import { decideStripeWebhookVerificationMode } from "../utils/stripeWebhookVerification";
import { restoreTrackedInventoryForPickupOrderByOrderId } from "../services/pickupInventoryService";
import {
  PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
  requestAndFinalizeCardPickupOrderCancellation,
} from "../services/pickupOrderCancellationService";
import { reconcileCompletedPickupOrderRefund } from "../services/pickupOrderCompletedRefundService";
import { reconcilePickupOrderDispute } from "../services/pickupOrderDisputeService";
import {
  pickupDisputePaymentIntentId,
  retrieveAuthoritativePickupOrderDispute,
} from "../services/pickupOrderDisputeTruth";
import {
  PICKUP_ORDER_PAYMENT_EVENT_OUTSIDE_WINDOW_REASON,
  PICKUP_ORDER_SETTLEMENT_GRACE_EXPIRED_REASON,
  derivePickupOrderAggregateRefundStatus,
  isPickupPaymentIntentAmountBound,
  isPickupPaymentIntentOrderIdentityBound,
  isPickupPaymentIntentSettlementBound,
  isPickupPaymentSettlementWithinGrace,
  isPickupPaymentSuccessEventWithinWindow,
  isPickupRefundFromOrder,
  shouldPickupRefundEnterCancellation,
  summarizePickupOrderRefunds,
} from "../services/pickupOrderPaymentReconciliation";
import {
  confirmParkingPassPurchaseFromIntent,
  markParkingPassPurchaseDisputed,
  reconcileParkingPassRefund,
  recordParkingPassPaymentFailureFromIntent,
} from "../services/parkingPassBookingService";
const configuredStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
type NotifyHostCapacityWarningParams = {
  hostId: string;
  eventId: string;
  eventStartDate: Date | null;
  confirmedCount: number;
  maxTrucks: number;
};
type StripeWebhookRouteDependencies = {
  notifyHostCapacityWarning: (
    params: NotifyHostCapacityWarningParams,
  ) => Promise<void>;
  stripeClient?: Stripe | null;
};

function getSubscriptionCustomerId(
  customer: Stripe.Subscription["customer"],
): string | null {
  if (typeof customer === "string") return customer;
  return customer?.id || null;
}

async function deactivateSubscriptionEntitlements(params: {
  userId: string;
  subscriptionId: string;
  eventId: string;
  eventCreatedAt: Date;
}) {
  await db.transaction(async (tx: any) => {
    const [lockedSubscription] = await tx
      .select({
        id: restaurantSubscriptions.id,
        stripeEventCreatedAt: restaurantSubscriptions.stripeEventCreatedAt,
      })
      .from(restaurantSubscriptions)
      .where(
        eq(restaurantSubscriptions.stripeSubscriptionId, params.subscriptionId),
      )
      .limit(1)
      .for("update");

    if (!lockedSubscription) return;
    if (
      lockedSubscription.stripeEventCreatedAt &&
      lockedSubscription.stripeEventCreatedAt.getTime() >=
        params.eventCreatedAt.getTime()
    ) {
      return;
    }

    // Serialize delayed cancellation A against activation of replacement B.
    // The second event observes the committed current subscription before it
    // can change user-level access.
    const [lockedUser] = await tx
      .select({ stripeSubscriptionId: users.stripeSubscriptionId })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1)
      .for("update");

    // Retire legacy billing records without changing profile tools or public
    // content. Profile access no longer derives from subscription state.
    await tx
      .update(restaurantSubscriptions)
      .set({
        status: "canceled",
        canceledAt: new Date(),
        stripeEventId: params.eventId,
        stripeEventCreatedAt: params.eventCreatedAt,
        updatedAt: new Date(),
      })
      .where(eq(restaurantSubscriptions.id, lockedSubscription.id));

    if (
      !lockedUser ||
      !shouldRevokeUserSubscriptionEntitlements({
        currentSubscriptionId: lockedUser.stripeSubscriptionId,
        eventSubscriptionId: params.subscriptionId,
      })
    ) {
      return;
    }

    const clearedUsers = await tx
      .update(users)
      .set({
        stripeSubscriptionId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, params.userId),
          or(
            isNull(users.stripeSubscriptionId),
            eq(users.stripeSubscriptionId, params.subscriptionId),
          ),
        ),
      )
      .returning({ id: users.id });
    if (clearedUsers.length !== 1) {
      throw new Error(
        `Subscription changed while revoking ${params.subscriptionId}`,
      );
    }
  });
}

async function retireLegacyProfileSubscription(
  subscriptionId: string,
  eventId: string,
  eventCreatedAt: Date,
  customerId?: string | null,
) {
  let user = await storage.getUserByStripeSubscriptionId(subscriptionId);
  if (!user && customerId) {
    user = await storage.getUserByStripeCustomerId(customerId);
  }
  if (!user) return;

  await deactivateSubscriptionEntitlements({
    userId: user.id,
    subscriptionId,
    eventId,
    eventCreatedAt,
  });
}

async function recordLegacyProfileSubscriptionEvent(params: {
  subscriptionId: string;
  eventId: string;
  eventCreatedAt: Date;
}) {
  await db.transaction(async (tx: any) => {
    const [lockedSubscription] = await tx
      .select({
        id: restaurantSubscriptions.id,
        stripeEventCreatedAt: restaurantSubscriptions.stripeEventCreatedAt,
      })
      .from(restaurantSubscriptions)
      .where(
        eq(restaurantSubscriptions.stripeSubscriptionId, params.subscriptionId),
      )
      .limit(1)
      .for("update");

    if (!lockedSubscription) return;
    if (
      lockedSubscription.stripeEventCreatedAt &&
      lockedSubscription.stripeEventCreatedAt.getTime() >=
        params.eventCreatedAt.getTime()
    ) {
      return;
    }

    await tx
      .update(restaurantSubscriptions)
      .set({
        stripeEventId: params.eventId,
        stripeEventCreatedAt: params.eventCreatedAt,
        updatedAt: new Date(),
      })
      .where(eq(restaurantSubscriptions.id, lockedSubscription.id));
  });
}

export function registerStripeWebhookRoutes(
  app: Express,
  dependencies: StripeWebhookRouteDependencies,
) {
  const { notifyHostCapacityWarning } = dependencies;
  const stripe = Object.prototype.hasOwnProperty.call(
    dependencies,
    "stripeClient",
  )
    ? dependencies.stripeClient || null
    : configuredStripe;
  // Stripe Webhook Handler
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event;

    try {
      const payload = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : req.body;
      const forceVerify =
        String(process.env.STRIPE_WEBHOOK_FORCE_VERIFY || "")
          .trim()
          .toLowerCase() === "true";
      const allowUnsignedDev =
        String(process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED || "")
          .trim()
          .toLowerCase() === "true";

      const verificationMode = decideStripeWebhookVerificationMode({
        nodeEnv: process.env.NODE_ENV,
        forceVerify,
        allowUnsignedDev,
      });
      if (verificationMode === "accept_unsigned_dev") {
        event = typeof payload === "string" ? JSON.parse(payload) : payload;
      } else {
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !endpointSecret) {
          return res
            .status(503)
            .send("Webhook signature verification unavailable");
        }
        if (!Buffer.isBuffer(req.body)) {
          throw new Error("Stripe webhook request body was not raw bytes");
        }
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Webhook signature verification failed:`, errMsg);
      return res
        .status(400)
        .send("Webhook Error: signature verification failed");
    }

    console.log(`[WEBHOOK] Received event: ${event.type}`);

    try {
      switch (event.type) {
        case "invoice.payment_succeeded": {
          const invoice = event.data.object;
          console.log(`[WEBHOOK] Invoice ${invoice.id} payment succeeded`);

          if (invoice.subscription) {
            const subscriptionId = String(invoice.subscription);
            console.warn(
              `[WEBHOOK] Legacy profile subscription ${subscriptionId} received a payment; no automatic cancellation or access change was made`,
            );
          }
          break;
        }
        case "invoice.payment_failed": {
          const failedInvoice = event.data.object;
          console.log(`[WEBHOOK] Invoice ${failedInvoice.id} payment failed`);

          if (failedInvoice.subscription) {
            const subscriptionId = String(failedInvoice.subscription);
            console.warn(
              `[WEBHOOK] Legacy profile subscription ${subscriptionId} reported a failed payment; no automatic cancellation or access change was made`,
            );
          }
          break;
        }
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${paymentIntent.id} succeeded`);

          try {
            const { eventBookings, restaurants, hosts } =
              await import("@shared/schema");
            const metadata = paymentIntent.metadata || {};
            const parkingPassPurchase =
              await confirmParkingPassPurchaseFromIntent(paymentIntent, stripe);
            if (parkingPassPurchase.handled) break;

            // Pickup order payment. Older intents used orderId; newer callers may
            // send pickupOrderId. Accept both so paid orders do not stay pending.
            const pickupOrderId = metadata.pickupOrderId || metadata.orderId;
            if (pickupOrderId) {
              try {
                const {
                  pickupOrders,
                  pickupOrderItems,
                  menuCategories,
                  menuItems,
                } = await import("@shared/schema");
                const { getWebSocketServer } = await import("../websocket");
                const {
                  sendPickupOrderCancelledNotification,
                  sendPickupOrderConfirmedNotifications,
                } = await import("../services/pickupOrderNotificationService");
                const { buildOrderingReadiness } = await import("./menuRoutes");
                const {
                  isMenuItemCategoryOrderable,
                  isPickupOrderItemAvailableForExistingReservation,
                } = await import("../services/restaurantOrderingEligibility");
                const payoutResult = await db.transaction(async (tx: any) => {
                  const [candidate] = await tx
                    .select({ id: pickupOrders.id })
                    .from(pickupOrders)
                    .where(
                      or(
                        eq(
                          pickupOrders.stripePaymentIntentId,
                          paymentIntent.id,
                        ),
                        and(
                          eq(pickupOrders.id, String(pickupOrderId)),
                          isNull(pickupOrders.stripePaymentIntentId),
                        ),
                      ),
                    )
                    .limit(1);
                  if (!candidate) {
                    throw new Error(
                      `Pickup order not found for PaymentIntent ${paymentIntent.id}`,
                    );
                  }
                  await tx.execute(
                    sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(candidate.id)}))`,
                  );
                  let [order] = await tx
                    .select()
                    .from(pickupOrders)
                    .where(eq(pickupOrders.id, candidate.id))
                    .limit(1);
                  if (!order) {
                    throw new Error(
                      `Pickup order disappeared for PaymentIntent ${paymentIntent.id}`,
                    );
                  }
                  if (!order.stripePaymentIntentId) {
                    const metadataRestaurantId = String(
                      paymentIntent.metadata?.restaurantId || "",
                    ).trim();
                    const mayAttachLegacyCancelledPayment = Boolean(
                      order.status === "cancelled" &&
                      isPickupPaymentIntentOrderIdentityBound(
                        paymentIntent,
                        order,
                      ),
                    );
                    if (
                      !metadataRestaurantId ||
                      metadataRestaurantId !== order.restaurantId ||
                      (!isPickupPaymentIntentSettlementBound(
                        paymentIntent,
                        order,
                      ) &&
                        !mayAttachLegacyCancelledPayment)
                    ) {
                      throw new Error(
                        `Pickup order ${order.id} cannot bind PaymentIntent ${paymentIntent.id}`,
                      );
                    }
                    const [attached] = await tx
                      .update(pickupOrders)
                      .set({
                        stripePaymentIntentId: paymentIntent.id,
                        stripeTransferGroupId:
                          String(paymentIntent.transfer_group || "").trim() ||
                          order.stripeTransferGroupId,
                        updatedAt: new Date(),
                      })
                      .where(
                        and(
                          eq(pickupOrders.id, order.id),
                          isNull(pickupOrders.stripePaymentIntentId),
                        ),
                      )
                      .returning();
                    if (!attached) {
                      throw new Error(
                        `Pickup order ${order.id} PaymentIntent attachment raced`,
                      );
                    }
                    order = attached;
                  }

                  const paymentAmountMatches = isPickupPaymentIntentAmountBound(
                    paymentIntent,
                    order.totalCents,
                  );
                  const paymentSettlementMatches =
                    isPickupPaymentIntentSettlementBound(paymentIntent, order);
                  const terminalCancellationBindingMatches = Boolean(
                    isPickupPaymentIntentOrderIdentityBound(
                      paymentIntent,
                      order,
                    ),
                  );

                  const statusBeforeWebhook = String(order.status || "")
                    .trim()
                    .toLowerCase();
                  if (statusBeforeWebhook === "cancellation_pending") {
                    if (
                      !paymentAmountMatches ||
                      !terminalCancellationBindingMatches
                    ) {
                      return {
                        orderId: order.id,
                        restaurantId: order.restaurantId,
                        notificationOrder: null,
                        cancellationRequired: false,
                        cancellationOrder: null,
                        cancellationReason: null,
                        error: new Error(
                          `Succeeded PaymentIntent ${paymentIntent.id} does not match cancelling pickup order ${order.id}`,
                        ),
                      };
                    }
                    return {
                      orderId: order.id,
                      restaurantId: order.restaurantId,
                      notificationOrder: null,
                      cancellationRequired: true,
                      cancellationOrder: null,
                      cancellationReason:
                        order.cancellationReason ||
                        "Ordering eligibility changed before payment completed",
                      error: null,
                    };
                  }
                  if (statusBeforeWebhook === "cancelled") {
                    if (
                      !paymentAmountMatches ||
                      !terminalCancellationBindingMatches
                    ) {
                      return {
                        orderId: order.id,
                        restaurantId: order.restaurantId,
                        notificationOrder: null,
                        cancellationRequired: false,
                        cancellationOrder: null,
                        cancellationReason: null,
                        error: new Error(
                          `Succeeded PaymentIntent ${paymentIntent.id} does not match cancelled pickup order ${order.id}`,
                        ),
                      };
                    }
                    return {
                      orderId: order.id,
                      restaurantId: order.restaurantId,
                      notificationOrder: null,
                      cancellationRequired: true,
                      cancellationOrder: null,
                      cancellationReason:
                        order.cancellationReason ||
                        "A card payment completed after the order was cancelled",
                      error: null,
                    };
                  }

                  const payoutMayNeedFirstSettlement = Boolean(
                    order.payoutStatus !== "transferred" &&
                      ["pending", "confirmed"].includes(statusBeforeWebhook),
                  );
                  let lockedOrderingRestaurant:
                    | {
                        ownerId: string;
                        stripeConnectAccountId: string | null;
                        orderingAuthorityVersion: number;
                      }
                    | undefined;
                  if (
                    statusBeforeWebhook === "pending" ||
                    payoutMayNeedFirstSettlement
                  ) {
                    [lockedOrderingRestaurant] = await tx
                      .select({
                        ownerId: restaurants.ownerId,
                        stripeConnectAccountId:
                          restaurants.stripeConnectAccountId,
                        orderingAuthorityVersion:
                          restaurants.orderingAuthorityVersion,
                      })
                      .from(restaurants)
                      .where(eq(restaurants.id, order.restaurantId))
                      .limit(1)
                      .for("update", { of: restaurants });
                  }

                  // A client secret can outlive the page that issued it. Before
                  // the first confirmation, re-check the exact menu, every ordered
                  // item, current pickup location, hours, verification, payment
                  // readiness, and a bounded payment window. A failed check commits
                  // cancellation_pending before any Stripe refund side effect.
                  if (
                    statusBeforeWebhook === "pending" ||
                    payoutMayNeedFirstSettlement
                  ) {
                    const orderLines = await tx
                      .select({
                        menuItemId: menuItems.id,
                        menuId: menuItems.menuId,
                        categoryId: menuItems.categoryId,
                        categoryActive: menuCategories.isActive,
                        isAvailable: menuItems.isAvailable,
                        trackInventory: menuItems.trackInventory,
                        inventoryQty: menuItems.inventoryQty,
                        inventoryAutoUnavailable:
                          menuItems.inventoryAutoUnavailable,
                        inventoryReservedQuantity:
                          pickupOrderItems.inventoryReservedQuantity,
                        priceCents: menuItems.priceCents,
                        availableFrom: menuItems.availableFrom,
                        availableTo: menuItems.availableTo,
                      })
                      .from(pickupOrderItems)
                      .leftJoin(
                        menuItems,
                        eq(menuItems.id, pickupOrderItems.menuItemId),
                      )
                      .leftJoin(
                        menuCategories,
                        and(
                          eq(menuCategories.id, menuItems.categoryId),
                          eq(menuCategories.menuId, menuItems.menuId),
                          eq(
                            menuCategories.restaurantId,
                            menuItems.restaurantId,
                          ),
                        ),
                      )
                      .where(eq(pickupOrderItems.orderId, order.id));
                    const menuIds = new Set<string>(
                      orderLines.map((line: any) => String(line.menuId || "")),
                    );
                    const exactMenuId: string | null =
                      menuIds.size === 1 ? [...menuIds][0] : null;
                    const allItemsStillAvailable = Boolean(
                      orderLines.length > 0 &&
                      orderLines.every(
                        (line: any) =>
                          isPickupOrderItemAvailableForExistingReservation(
                            line,
                          ) &&
                          Number.isInteger(line.priceCents) &&
                          line.priceCents >= 0 &&
                          !String(line.availableFrom || "").trim() &&
                          !String(line.availableTo || "").trim() &&
                          isMenuItemCategoryOrderable(line),
                      ),
                    );
                    // Webhook delivery/replay can be delayed. Eligibility is
                    // bound to Stripe's signed success-event time, not the time
                    // this process happened to receive the event.
                    const paymentEventWithinWindow =
                      isPickupPaymentSuccessEventWithinWindow({
                        orderCreatedAt: order.createdAt,
                        eventCreatedSeconds: event.created,
                      });
                    const paymentSettlementWithinGrace =
                      isPickupPaymentSettlementWithinGrace({
                        orderCreatedAt: order.createdAt,
                      });
                    let readinessStillValid = false;
                    if (exactMenuId && allItemsStillAvailable) {
                      try {
                        const readiness = await buildOrderingReadiness(
                          order.restaurantId,
                          exactMenuId,
                          {
                            includeSettlementIdentity: true,
                            existingReservedMenuItemIds: orderLines
                              .filter(
                                (line: any) =>
                                  Number.isInteger(
                                    Number(line.inventoryReservedQuantity),
                                  ) &&
                                  Number(line.inventoryReservedQuantity) > 0,
                              )
                              .map((line: any) =>
                                String(line.menuItemId || "").trim(),
                              )
                              .filter(Boolean),
                            database: tx,
                          },
                        );
                        readinessStillValid = Boolean(
                          lockedOrderingRestaurant &&
                          readiness.orderingEnabled &&
                          readiness.paymentMethods.card &&
                          isRestaurantOrderingAuthorityVersionCurrent({
                            preflightVersion:
                              lockedOrderingRestaurant.orderingAuthorityVersion,
                            lockedVersion: readiness.orderingAuthorityVersion,
                          }) &&
                          order.pricesIncludeTax === true &&
                          String(readiness.restaurantName || "").trim() ===
                            String(order.merchantNameSnapshot || "").trim() &&
                          String(
                            readiness.settlementIdentity?.merchantOwnerId || "",
                          ).trim() ===
                            String(
                              order.merchantOwnerIdSnapshot || "",
                            ).trim() &&
                          String(
                            readiness.settlementIdentity
                              ?.stripeConnectAccountId || "",
                          ).trim() ===
                            String(
                              order.stripeConnectAccountIdSnapshot || "",
                            ).trim() &&
                          String(readiness.pickupAddressLabel || "").trim() ===
                            String(order.pickupAddressSnapshot || "").trim() &&
                          String(readiness.pickupDirectionsUrl || "").trim() ===
                            String(
                              order.pickupDirectionsUrlSnapshot || "",
                            ).trim() &&
                          Number(readiness.merchantAcknowledgementMinutes) ===
                            Number(
                              order.merchantAcknowledgementMinutesSnapshot,
                            ),
                        );
                      } catch (readinessError) {
                        console.error(
                          `[WEBHOOK] Pickup order ${order.id} eligibility recheck failed closed`,
                          readinessError,
                        );
                      }
                    }
                    if (
                      !paymentEventWithinWindow ||
                      !paymentSettlementWithinGrace ||
                      !paymentAmountMatches ||
                      !paymentSettlementMatches ||
                      !readinessStillValid
                    ) {
                      const cancellationReason = !paymentEventWithinWindow
                        ? PICKUP_ORDER_PAYMENT_EVENT_OUTSIDE_WINDOW_REASON
                        : !paymentSettlementWithinGrace
                          ? PICKUP_ORDER_SETTLEMENT_GRACE_EXPIRED_REASON
                          : !paymentAmountMatches
                            ? "Card payment did not match the authoritative order total"
                            : !paymentSettlementMatches
                              ? "Card payment did not match the authorized merchant payout identity"
                              : "Ordering eligibility changed before payment completed";
                      if (statusBeforeWebhook !== "pending") {
                        await tx
                          .update(pickupOrders)
                          .set({
                            payoutStatus: "failed",
                            updatedAt: new Date(),
                          })
                          .where(eq(pickupOrders.id, order.id));
                        return {
                          orderId: order.id,
                          restaurantId: order.restaurantId,
                          notificationOrder: null,
                          cancellationRequired: false,
                          cancellationOrder: null,
                          cancellationReason: null,
                          error: new Error(
                            `Ordering eligibility changed before first payout for confirmed pickup order ${order.id}`,
                          ),
                        };
                      }
                      const [cancellationPending] = await tx
                        .update(pickupOrders)
                        .set({
                          status: "cancellation_pending",
                          payoutStatus: PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
                          cancellationReason,
                          updatedAt: new Date(),
                        })
                        .where(
                          and(
                            eq(pickupOrders.id, order.id),
                            eq(pickupOrders.status, "pending"),
                          ),
                        )
                        .returning();
                      if (!cancellationPending) {
                        throw new Error(
                          `Pickup order ${order.id} changed during eligibility cancellation`,
                        );
                      }
                      return {
                        orderId: order.id,
                        restaurantId: order.restaurantId,
                        notificationOrder: null,
                        cancellationRequired: true,
                        cancellationOrder: null,
                        cancellationReason,
                        error: null,
                      };
                    }
                  }

                  const acknowledgementMinutes = Number(
                    order.merchantAcknowledgementMinutesSnapshot,
                  );
                  const failPayout = async (error: unknown) => {
                    await tx
                      .update(pickupOrders)
                      .set({ payoutStatus: "failed", updatedAt: new Date() })
                      .where(eq(pickupOrders.id, order.id));
                    return {
                      orderId: order.id,
                      restaurantId: order.restaurantId,
                      notificationOrder: null,
                      cancellationRequired: false,
                      cancellationOrder: null,
                      cancellationReason: null,
                      error,
                    };
                  };

                  if (!paymentAmountMatches) {
                    return {
                      orderId: order.id,
                      restaurantId: order.restaurantId,
                      notificationOrder: null,
                      cancellationRequired: false,
                      cancellationOrder: null,
                      cancellationReason: null,
                      error: new Error(
                        `PaymentIntent ${paymentIntent.id} amount or currency does not match pickup order ${order.id}`,
                      ),
                    };
                  }

                  // A Stripe transfer can succeed while the following database
                  // update fails. Settle before confirming the order, and give
                  // Stripe a stable idempotency key so a webhook replay can safely
                  // reconcile either side of that boundary.
                  const transferGroupId = String(
                    order.stripeTransferGroupId || "",
                  ).trim();
                  const payoutNeedsSettlement =
                    order.payoutStatus !== "transferred" &&
                    ["pending", "confirmed"].includes(statusBeforeWebhook);
                  if (payoutNeedsSettlement && !transferGroupId) {
                    return failPayout(
                      new Error(
                        `Stripe transfer group missing for pickup order ${order.id}`,
                      ),
                    );
                  }
                  const shouldTransferPayout =
                    shouldAttemptPickupWebhookPayoutTransfer({
                      statusBeforeWebhook: order.status,
                      paymentSucceeded: paymentIntent.status === "succeeded",
                      stripeTransferGroupId: transferGroupId,
                      payoutStatus: order.payoutStatus,
                    });
                  let payoutReconciledThisAttempt = false;
                  if (shouldTransferPayout) {
                    if (!stripe) {
                      return failPayout(
                        new Error(
                          "Stripe client unavailable for pickup order transfer",
                        ),
                      );
                    }
                    const restaurant = lockedOrderingRestaurant;
                    const connectAccountId = String(
                      order.stripeConnectAccountIdSnapshot || "",
                    ).trim();
                    if (
                      !restaurant ||
                      !connectAccountId ||
                      String(restaurant.ownerId || "").trim() !==
                        String(order.merchantOwnerIdSnapshot || "").trim() ||
                      String(restaurant.stripeConnectAccountId || "").trim() !==
                        connectAccountId ||
                      !paymentSettlementMatches
                    ) {
                      return failPayout(
                        new Error(
                          `Merchant payout identity changed for pickup order ${order.id}`,
                        ),
                      );
                    }

                    const merchantGrossCents =
                      order.subtotalCents +
                      Math.max(0, Number(order.deliveryFeeCents || 0) || 0);
                    const transferAmount = Math.max(
                      0,
                      order.feePaidByBusiness
                        ? merchantGrossCents -
                            Math.max(
                              0,
                              Number(order.platformFeeCents || 0) || 0,
                            )
                        : merchantGrossCents,
                    );
                    const sourceTransactionId =
                      resolvePickupPayoutSourceTransaction(
                        paymentIntent.latest_charge,
                      );
                    if (transferAmount > 0 && !sourceTransactionId) {
                      return failPayout(
                        new Error(
                          `Stripe source charge missing for pickup order ${order.id}`,
                        ),
                      );
                    }
                    try {
                      if (transferAmount > 0) {
                        await stripe.transfers.create(
                          {
                            amount: transferAmount,
                            currency: "usd",
                            destination: connectAccountId,
                            source_transaction: sourceTransactionId!,
                            transfer_group: transferGroupId,
                            metadata: { pickupOrderId: order.id },
                          },
                          {
                            idempotencyKey: `pickup-order:${order.id}:transfer`,
                          },
                        );
                      }
                      await tx
                        .update(pickupOrders)
                        .set({
                          payoutStatus: "transferred",
                          updatedAt: new Date(),
                        })
                        .where(eq(pickupOrders.id, order.id));
                      payoutReconciledThisAttempt = true;
                    } catch (error) {
                      return failPayout(error);
                    }
                  }

                  const payoutReady = Boolean(
                    order.payoutStatus === "transferred" ||
                    payoutReconciledThisAttempt,
                  );
                  let updated: typeof order | undefined;
                  if (order.status === "pending" && payoutReady) {
                    const confirmedAt = new Date();
                    [updated] = await tx
                      .update(pickupOrders)
                      .set({
                        status: "confirmed",
                        confirmedAt,
                        merchantAcknowledgementDueAt: new Date(
                          confirmedAt.getTime() +
                            acknowledgementMinutes * 60 * 1000,
                        ),
                        updatedAt: confirmedAt,
                      })
                      .where(
                        and(
                          eq(pickupOrders.id, order.id),
                          eq(pickupOrders.status, "pending"),
                        ),
                      )
                      .returning();
                  }

                  // Re-fetch every confirmed + settled replay, including a process
                  // crash after the transaction commit but before notifications.
                  // Notification claims are deduped and failed/stale claims can be
                  // reclaimed, so replay closes that crash window without duplicates.
                  let reconciledConfirmedOrder: typeof order | undefined;
                  if (!updated && order.status === "confirmed" && payoutReady) {
                    [reconciledConfirmedOrder] = await tx
                      .select()
                      .from(pickupOrders)
                      .where(eq(pickupOrders.id, order.id))
                      .limit(1);
                  }
                  return {
                    orderId: order.id,
                    restaurantId: order.restaurantId,
                    notificationOrder:
                      updated || reconciledConfirmedOrder || null,
                    cancellationRequired: false,
                    cancellationOrder: null,
                    cancellationReason: null,
                    error: null,
                  };
                });
                if (payoutResult.error) throw payoutResult.error;
                if (payoutResult.cancellationRequired) {
                  const cancellationResult =
                    await requestAndFinalizeCardPickupOrderCancellation({
                      orderId: payoutResult.orderId,
                      expectedStatuses: ["cancellation_pending", "cancelled"],
                      cancellationReason:
                        payoutResult.cancellationReason ||
                        "Ordering eligibility changed before payment completed",
                      stripe,
                    });
                  if (cancellationResult.outcome === "conflict") {
                    throw new Error(
                      `Pickup order ${pickupOrderId} cancellation reconciliation conflicted`,
                    );
                  }
                  const cancelledOrder = cancellationResult.order;
                  const wsIo = getWebSocketServer();
                  if (wsIo) {
                    wsIo
                      .to(`kitchen:${cancelledOrder.restaurantId}`)
                      .emit("kitchen:order_update", {
                        order: cancelledOrder as Record<string, unknown>,
                      });
                  }
                  if (cancellationResult.outcome === "cancelled") {
                    await sendPickupOrderCancelledNotification(cancelledOrder);
                  }
                  break;
                }
                if (payoutResult.cancellationOrder) {
                  await sendPickupOrderCancelledNotification(
                    payoutResult.cancellationOrder,
                  );
                  break;
                }
                const notificationOrder = payoutResult.notificationOrder;
                const wsIo = getWebSocketServer();
                if (wsIo && notificationOrder) {
                  wsIo
                    .to(`kitchen:${payoutResult.restaurantId}`)
                    .emit("kitchen:order_update", {
                      order: notificationOrder as Record<string, unknown>,
                    });
                }
                if (notificationOrder) {
                  await sendPickupOrderConfirmedNotifications(
                    notificationOrder,
                  );
                }
              } catch (pickupError) {
                console.error(
                  "[WEBHOOK] Pickup order payment confirmation failed:",
                  pickupError,
                );
                throw pickupError;
              }
              break;
            }

            // Supplier marketplace order payment
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                const [order] = await db
                  .select()
                  .from(supplierOrders)
                  .where(eq(supplierOrders.id, String(supplierOrderId)))
                  .limit(1);
                if (order) {
                  const storedIntentId = String(
                    (order as any).stripePaymentIntentId || "",
                  ).trim();
                  if (storedIntentId && storedIntentId !== paymentIntent.id) {
                    console.warn(
                      `[WEBHOOK] Supplier order ${supplierOrderId} ignored PaymentIntent ${paymentIntent.id}; expected ${storedIntentId}`,
                    );
                    break;
                  }
                  // Idempotent: only mark paid if not already.
                  if (String((order as any).paymentStatus || "") !== "paid") {
                    await db
                      .update(supplierOrders)
                      .set({
                        paymentStatus: "paid",
                        stripePaymentIntentId:
                          storedIntentId || paymentIntent.id,
                        updatedAt: new Date(),
                      } as any)
                      .where(eq(supplierOrders.id, String(supplierOrderId)));
                  }
                } else {
                  throw new Error(
                    `Supplier order ${supplierOrderId} not found for PaymentIntent ${paymentIntent.id}`,
                  );
                }
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order update failed:",
                  supplierError,
                );
                throw supplierError;
              }
              break;
            }

            // ── Single-event booking payment (bookingId metadata) ──────────
            const bookingId = String(metadata.bookingId || "").trim();
            if (bookingId && !metadata.passId) {
              const [legacyBooking] = await db
                .select({
                  id: eventBookings.id,
                  purchaseId: eventBookings.purchaseId,
                  stripePaymentIntentId:
                    eventBookings.stripePaymentIntentId,
                })
                .from(eventBookings)
                .where(eq(eventBookings.id, bookingId))
                .limit(1);
              if (!legacyBooking) {
                throw new Error(
                  `Legacy event booking ${bookingId} was not found for PaymentIntent ${paymentIntent.id}`,
                );
              }
              const expectedIntentId = String(
                legacyBooking.stripePaymentIntentId || "",
              ).trim();
              if (expectedIntentId && expectedIntentId !== paymentIntent.id) {
                throw new Error(
                  `Legacy event booking ${bookingId} expected PaymentIntent ${expectedIntentId}, received ${paymentIntent.id}`,
                );
              }
              await db
                .update(eventBookings)
                .set({
                  stripePaymentIntentId: expectedIntentId || paymentIntent.id,
                  stripePaymentStatus: "reconciliation_required",
                  settlementState: "action_required",
                  updatedAt: new Date(),
                })
                .where(eq(eventBookings.id, bookingId));
              console.error(
                `[WEBHOOK] PaymentIntent ${paymentIntent.id} references legacy booking ${bookingId} without a verified durable purchase binding; local confirmation is quarantined for reconciliation`,
              );
              break;

            }
            // ─────────────────────────────────────────────────────────────

            const passId = metadata.passId;
            const truckId = metadata.truckId;

            if (!passId || !truckId) {
              break;
            }

            const legacyIntentRows = await db
              .select({ id: eventBookings.id })
              .from(eventBookings)
              .where(
                and(
                  eq(eventBookings.stripePaymentIntentId, paymentIntent.id),
                  eq(eventBookings.truckId, truckId),
                ),
              );
            if (legacyIntentRows.length === 0) {
              throw new Error(
                `Legacy Parking Pass PaymentIntent ${paymentIntent.id} has no durable purchase or locally bound allocation rows`,
              );
            }
            await db
              .update(eventBookings)
              .set({
                stripePaymentStatus: "reconciliation_required",
                settlementState: "action_required",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(eventBookings.stripePaymentIntentId, paymentIntent.id),
                  eq(eventBookings.truckId, truckId),
                ),
              );
            console.error(
              `[WEBHOOK] PaymentIntent ${paymentIntent.id} uses legacy pass metadata without a verified durable purchase binding; ${legacyIntentRows.length} allocation row(s) quarantined for reconciliation`,
            );
            break;

          } catch (error) {
            console.error("[WEBHOOK] Error confirming booking:", error);
            throw error;
          }
          break;

        case "charge.dispute.created":
        case "charge.dispute.updated":
        case "charge.dispute.closed": {
          const webhookDispute = event.data.object as Stripe.Dispute;
          if (!stripe) {
            throw new Error(
              `Stripe client unavailable for dispute ${webhookDispute.id}`,
            );
          }
          const dispute = await retrieveAuthoritativePickupOrderDispute({
            stripe,
            webhookDispute,
          });
          const disputedPaymentIntentId = pickupDisputePaymentIntentId(dispute);
          if (!disputedPaymentIntentId) {
            throw new Error(
              `Stripe dispute ${dispute.id} has no PaymentIntent binding`,
            );
          }
          const parkingPassDispute =
            await markParkingPassPurchaseDisputed(dispute, stripe);
          if (parkingPassDispute.handled) break;
          const { pickupOrders } = await import("@shared/schema");
          const [candidate] = await db
            .select({ id: pickupOrders.id })
            .from(pickupOrders)
            .where(
              or(
                eq(pickupOrders.stripeDisputeId, dispute.id),
                eq(pickupOrders.stripePaymentIntentId, disputedPaymentIntentId),
              ),
            )
            .limit(1);
          if (!candidate) {
            console.warn(
              `[WEBHOOK] No pickup order matches Stripe dispute ${dispute.id}`,
            );
            break;
          }
          let reconciled = await reconcilePickupOrderDispute({
            orderId: candidate.id,
            dispute,
            stripe,
          });
          let shouldNotifyCancellation = reconciled.status === "cancelled";
          if (reconciled.status === "cancellation_pending") {
            const cancellation =
              await requestAndFinalizeCardPickupOrderCancellation({
                orderId: reconciled.id,
                expectedStatuses: ["cancellation_pending"],
                cancellationReason:
                  reconciled.cancellationReason ||
                  "Payment dispute resolution requires cancellation",
                stripe,
              });
            if (cancellation.outcome === "conflict") {
              throw new Error(
                `Pickup order ${reconciled.id} changed during post-dispute cancellation`,
              );
            }
            reconciled = cancellation.order;
            shouldNotifyCancellation = cancellation.outcome === "cancelled";
          }
          if (shouldNotifyCancellation) {
            const { sendPickupOrderCancelledNotification } =
              await import("../services/pickupOrderNotificationService");
            await sendPickupOrderCancelledNotification(reconciled);
          }
          const { getWebSocketServer } = await import("../websocket");
          getWebSocketServer()
            ?.to(`kitchen:${reconciled.restaurantId}`)
            .emit("kitchen:order_update", {
              order: reconciled as Record<string, unknown>,
            });
          break;
        }

        case "refund.created":
        case "refund.updated":
        case "refund.failed":
        case "charge.refund.updated": {
          const refund = event.data.object as Stripe.Refund;
          const parkingPassRefund = await reconcileParkingPassRefund(refund);
          if (parkingPassRefund.handled) break;
          const pickupOrderId = String(
            refund.metadata?.pickupOrderId || "",
          ).trim();
          const refundPaymentIntent = refund.payment_intent;
          const refundPaymentIntentId =
            typeof refundPaymentIntent === "string"
              ? refundPaymentIntent
              : String(refundPaymentIntent?.id || "").trim();
          if (!stripe) {
            throw new Error(
              `Stripe client unavailable for refund ${refund.id}`,
            );
          }
          const { pickupOrders } = await import("@shared/schema");
          const trackedOrder = await db.transaction(async (tx: any) => {
            let [candidate] = await tx
              .select({ id: pickupOrders.id })
              .from(pickupOrders)
              .where(eq(pickupOrders.stripeRefundId, refund.id))
              .limit(1);
            if (!candidate && pickupOrderId) {
              [candidate] = await tx
                .select({ id: pickupOrders.id })
                .from(pickupOrders)
                .where(eq(pickupOrders.id, pickupOrderId))
                .limit(1);
            }
            if (!candidate && refundPaymentIntentId) {
              [candidate] = await tx
                .select({ id: pickupOrders.id })
                .from(pickupOrders)
                .where(
                  and(
                    eq(
                      pickupOrders.stripePaymentIntentId,
                      refundPaymentIntentId,
                    ),
                    inArray(pickupOrders.status, [
                      "pending",
                      "confirmed",
                      "preparing",
                      "ready",
                      "cancellation_pending",
                      "cancelled",
                      "completed",
                    ]),
                  ),
                )
                .limit(1);
            }
            if (!candidate) return null;
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(candidate.id)}))`,
            );
            const [current] = await tx
              .select()
              .from(pickupOrders)
              .where(eq(pickupOrders.id, candidate.id))
              .limit(1);
            if (!current) return null;
            if (
              ![
                "pending",
                "confirmed",
                "preparing",
                "ready",
                "cancellation_pending",
                "cancelled",
                "completed",
              ].includes(String(current.status || "")) ||
              !isPickupRefundFromOrder(
                refund,
                current.stripePaymentIntentId,
                current.totalCents,
              )
            ) {
              console.warn(
                `[WEBHOOK] Pickup order ${current.id} ignored unbound refund ${refund.id}`,
              );
              return null;
            }
            const refundSummary = await summarizePickupOrderRefunds({
              stripe,
              paymentIntentId: current.stripePaymentIntentId,
              totalCents: current.totalCents,
            });
            if (
              !refundSummary.refunds.some(
                (listedRefund) => listedRefund.id === refund.id,
              )
            ) {
              throw new Error(
                `Stripe refund ${refund.id} was not present in the authoritative PaymentIntent refund list.`,
              );
            }
            const latestRefund = refundSummary.latestRefund || refund;
            const latestRefundStatus = String(latestRefund.status || "unknown");
            const aggregateRefundStatus =
              derivePickupOrderAggregateRefundStatus({
                totalCents: current.totalCents,
                succeededAmountCents: refundSummary.succeededAmountCents,
                pendingAmountCents: refundSummary.pendingAmountCents,
                latestRefundStatus,
              });
            const aggregateRefundFailed = [
              "failed",
              "canceled",
              "reconciliation_required",
            ].includes(aggregateRefundStatus);
            const shouldEnterCancellation = shouldPickupRefundEnterCancellation(
              current.status,
              aggregateRefundStatus,
            );
            const [updated] = await tx
              .update(pickupOrders)
              .set({
                status: shouldEnterCancellation
                  ? "cancellation_pending"
                  : current.status,
                cancellationReason: shouldEnterCancellation
                  ? current.cancellationReason ||
                    "Card payment was refunded in Stripe"
                  : current.cancellationReason,
                stripeRefundId: latestRefund.id,
                stripeRefundStatus: aggregateRefundStatus,
                stripeRefundAmountCents: refundSummary.succeededAmountCents,
                refundFailureReason:
                  String(
                    (
                      latestRefund as Stripe.Refund & {
                        failure_reason?: string | null;
                      }
                    ).failure_reason || "",
                  ).trim() || null,
                refundUpdatedAt: new Date(),
                payoutStatus:
                  current.status === "cancelled"
                    ? current.payoutStatus
                    : current.status === "completed" && aggregateRefundFailed
                      ? current.payoutStatus
                      : aggregateRefundFailed
                        ? "failed"
                        : PICKUP_ORDER_PAYOUT_REVERSAL_PENDING,
                updatedAt: new Date(),
              })
              .where(eq(pickupOrders.id, current.id))
              .returning();
            return updated || current;
          });

          if (!trackedOrder) break;
          if (trackedOrder.status === "cancellation_pending") {
            const result = await requestAndFinalizeCardPickupOrderCancellation({
              orderId: trackedOrder.id,
              expectedStatuses: ["cancellation_pending"],
              cancellationReason:
                trackedOrder.cancellationReason || "Order cancelled",
              stripe,
            });
            if (result.outcome === "cancelled") {
              const { sendPickupOrderCancelledNotification } =
                await import("../services/pickupOrderNotificationService");
              await sendPickupOrderCancelledNotification(result.order);
              const { getWebSocketServer } = await import("../websocket");
              getWebSocketServer()
                ?.to(`kitchen:${result.order.restaurantId}`)
                .emit("kitchen:order_update", {
                  order: result.order as Record<string, unknown>,
                });
            }
          } else if (trackedOrder.status === "completed") {
            await reconcileCompletedPickupOrderRefund({
              orderId: trackedOrder.id,
              stripe,
            });
          } else if (["failed", "canceled"].includes(String(refund.status))) {
            console.error(
              `[WEBHOOK] Refund ${refund.id} failed for pickup order ${trackedOrder.id}; owner reconciliation is required`,
            );
          }
          break;
        }

        case "payment_intent.canceled": {
          const cancelledIntent = event.data.object as Stripe.PaymentIntent;
          const parkingPassFailure =
            await recordParkingPassPaymentFailureFromIntent(cancelledIntent, {
              final: true,
            });
          if (parkingPassFailure.handled) break;
          const { eventBookings } = await import("@shared/schema");
          const legacyRows = await db
            .select({ id: eventBookings.id })
            .from(eventBookings)
            .where(
              and(
                eq(
                  eventBookings.stripePaymentIntentId,
                  cancelledIntent.id,
                ),
                inArray(eventBookings.status, ["pending"]),
              ),
            );
          if (legacyRows.length > 0) {
            await db
              .update(eventBookings)
              .set({
                stripePaymentStatus: "reconciliation_required",
                settlementState: "action_required",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(
                    eventBookings.stripePaymentIntentId,
                    cancelledIntent.id,
                  ),
                  inArray(eventBookings.status, ["pending"]),
                ),
              );
            console.error(
              `[WEBHOOK] Canceled legacy PaymentIntent ${cancelledIntent.id} is provider-final but not bound to a durable purchase; ${legacyRows.length} allocation row(s) require reconciliation before local release`,
            );
          }
          break;
        }

        case "payment_intent.payment_failed":
          const failedIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${failedIntent.id} failed`);

          try {
            const { eventBookings, pickupOrders } =
              await import("@shared/schema");
            const metadata = (failedIntent as any).metadata || {};
            const parkingPassFailure =
              await recordParkingPassPaymentFailureFromIntent(failedIntent);
            if (parkingPassFailure.handled) break;

            // Pickup order payment failure
            const pickupOrderId = String(
              metadata.pickupOrderId || metadata.orderId || "",
            ).trim();
            if (pickupOrderId) {
              try {
                await db.transaction(async (tx: any) => {
                  await tx.execute(
                    sql`select pg_advisory_xact_lock(hashtext(${pickupOrderFinancialLockKey(pickupOrderId)}))`,
                  );
                  const [order] = await tx
                    .select()
                    .from(pickupOrders)
                    .where(eq(pickupOrders.id, pickupOrderId))
                    .limit(1);
                  if (!order) {
                    throw new Error(
                      `Pickup order ${pickupOrderId} not found for failed PaymentIntent ${failedIntent.id}`,
                    );
                  }
                  const storedIntentId = String(
                    order.stripePaymentIntentId || "",
                  ).trim();
                  if (storedIntentId && storedIntentId !== failedIntent.id) {
                    console.warn(
                      `[WEBHOOK] Pickup order ${pickupOrderId} ignored failed PaymentIntent ${failedIntent.id}; expected ${storedIntentId}`,
                    );
                    return;
                  }
                  // A PaymentIntent can fail one confirmation attempt and later
                  // succeed on the same checkout. Keep the order and its
                  // reservation pending until the bounded expiry saga cancels
                  // the intent; a delayed succeeded event can then safely use
                  // the normal settlement path.
                  if (order.status !== "pending") {
                    console.log(
                      `[WEBHOOK] Pickup order ${order.id} ignored payment failure after leaving pending state`,
                    );
                    return;
                  }
                  if (!storedIntentId) {
                    await tx
                      .update(pickupOrders)
                      .set({
                        stripePaymentIntentId: failedIntent.id,
                        stripeTransferGroupId:
                          String(failedIntent.transfer_group || "").trim() ||
                          order.stripeTransferGroupId,
                        updatedAt: new Date(),
                      })
                      .where(
                        and(
                          eq(pickupOrders.id, order.id),
                          eq(pickupOrders.status, "pending"),
                          isNull(pickupOrders.stripePaymentIntentId),
                        ),
                      );
                  }
                });
              } catch (pickupError) {
                console.error(
                  "[WEBHOOK] Pickup order failure update failed:",
                  pickupError,
                );
                throw pickupError;
              }
              break;
            }

            // Supplier marketplace order payment failure
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                const [order] = await db
                  .select()
                  .from(supplierOrders)
                  .where(eq(supplierOrders.id, String(supplierOrderId)))
                  .limit(1);
                if (order) {
                  const storedIntentId = String(
                    (order as any).stripePaymentIntentId || "",
                  ).trim();
                  if (storedIntentId && storedIntentId !== failedIntent.id) {
                    console.warn(
                      `[WEBHOOK] Supplier order ${supplierOrderId} ignored failed PaymentIntent ${failedIntent.id}; expected ${storedIntentId}`,
                    );
                    break;
                  }
                  // Stripe may deliver events out of order. Never let an older
                  // failure event regress an order that a succeeded event has
                  // already marked paid.
                  if (String((order as any).paymentStatus || "") !== "paid") {
                    await db
                      .update(supplierOrders)
                      .set({
                        paymentStatus: "unpaid",
                        stripePaymentIntentId:
                          storedIntentId || failedIntent.id,
                        updatedAt: new Date(),
                      } as any)
                      .where(eq(supplierOrders.id, String(supplierOrderId)));
                  }
                } else {
                  throw new Error(
                    `Supplier order ${supplierOrderId} not found for failed PaymentIntent ${failedIntent.id}`,
                  );
                }
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order failure update failed:",
                  supplierError,
                );
                throw supplierError;
              }
              break;
            }

            const legacyRows = await db
              .select({ id: eventBookings.id })
              .from(eventBookings)
              .where(
                and(
                  eq(eventBookings.stripePaymentIntentId, failedIntent.id),
                  inArray(eventBookings.status, ["pending"]),
                ),
              );
            if (legacyRows.length > 0) {
              await db
                .update(eventBookings)
                .set({
                  stripePaymentStatus: "reconciliation_required",
                  settlementState: "action_required",
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(eventBookings.stripePaymentIntentId, failedIntent.id),
                    inArray(eventBookings.status, ["pending"]),
                  ),
                );
              console.error(
                `[WEBHOOK] Failed legacy PaymentIntent ${failedIntent.id} is not terminal and is not bound to a durable purchase; ${legacyRows.length} allocation row(s) remain reserved for reconciliation`,
              );
            }
          } catch (error) {
            console.error("[WEBHOOK] Error updating failed booking:", error);
            throw error;
          }
          break;

        case "customer.subscription.updated": {
          const subscriptionUpdated = event.data.object;
          const eventCreatedAt = new Date(Number(event.created) * 1000);
          const terminalLegacyStatus = [
            "canceled",
            "incomplete_expired",
          ].includes(String(subscriptionUpdated.status || ""));
          if (terminalLegacyStatus) {
            await retireLegacyProfileSubscription(
              subscriptionUpdated.id,
              event.id,
              eventCreatedAt,
              getSubscriptionCustomerId(subscriptionUpdated.customer),
            );
          } else {
            await recordLegacyProfileSubscriptionEvent({
              subscriptionId: subscriptionUpdated.id,
              eventId: event.id,
              eventCreatedAt,
            });
            console.warn(
              `[WEBHOOK] Legacy profile subscription ${subscriptionUpdated.id} changed to ${subscriptionUpdated.status}; no automatic cancellation or access change was made`,
            );
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscriptionDeleted = event.data.object;
          await retireLegacyProfileSubscription(
            subscriptionDeleted.id,
            event.id,
            new Date(Number(event.created) * 1000),
            getSubscriptionCustomerId(subscriptionDeleted.customer),
          );
          break;
        }

        case "account.updated": {
          const account = event.data.object as Stripe.Account;
          const accountId = String(account.id || "").trim();
          if (!accountId) break;

          const status =
            account.charges_enabled &&
            account.payouts_enabled &&
            account.details_submitted
              ? "active"
              : "pending";
          const updateValues = {
            stripeChargesEnabled: Boolean(account.charges_enabled),
            stripePayoutsEnabled: Boolean(account.payouts_enabled),
            stripeOnboardingCompleted: Boolean(account.details_submitted),
            stripeConnectStatus: status,
            updatedAt: new Date(),
          };

          const hostUpdate = await db
            .update(hosts)
            .set(updateValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(updateValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const restaurantUpdate = await db
            .update(restaurants)
            .set(updateValues)
            .where(eq(restaurants.stripeConnectAccountId, accountId));

          const hostRows = Number(
            (hostUpdate as { rowCount?: number })?.rowCount || 0,
          );
          const supplierRows = Number(
            (supplierUpdate as { rowCount?: number })?.rowCount || 0,
          );
          const restaurantRows = Number(
            (restaurantUpdate as { rowCount?: number })?.rowCount || 0,
          );
          console.log(
            `[WEBHOOK] Synced Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows}, restaurants: ${restaurantRows})`,
          );
          break;
        }

        case "account.application.deauthorized": {
          const accountId = String(event.account || "").trim();
          if (!accountId) break;

          const revokedValues = {
            stripeConnectStatus: "revoked",
            stripeOnboardingCompleted: false,
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            updatedAt: new Date(),
          };

          const hostUpdate = await db
            .update(hosts)
            .set(revokedValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(revokedValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const restaurantUpdate = await db
            .update(restaurants)
            .set({ ...revokedValues, stripeConnectAccountId: null })
            .where(eq(restaurants.stripeConnectAccountId, accountId));

          const hostRows = Number(
            (hostUpdate as { rowCount?: number })?.rowCount || 0,
          );
          const supplierRows = Number(
            (supplierUpdate as { rowCount?: number })?.rowCount || 0,
          );
          const restaurantRows = Number(
            (restaurantUpdate as { rowCount?: number })?.rowCount || 0,
          );
          console.log(
            `[WEBHOOK] Deauthorized Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows}, restaurants: ${restaurantRows})`,
          );
          break;
        }

        default:
          console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("[WEBHOOK] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}
