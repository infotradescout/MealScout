/**
 * Order status page
 * Shows live order status with auto-polling.
 */
import { useEffect, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { PublicOrderingTopBar } from "@/components/public-ordering/PublicOrderingTopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  CheckCircle,
  Clock,
  ChefHat,
  Package,
  XCircle,
  MapPin,
} from "lucide-react";
import {
  isPickupOrderCustomerMadeWhole,
  isPickupOrderFullyRefunded,
  pickupOrderCustomerRecoveryAmountCents,
  pickupOrderDisputeRecoveryAmountCents,
  pickupOrderSucceededRefundAmountCents,
} from "@shared/pickupOrderFinancialTruth";

const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; description: string }
> = {
  pending: {
    label: "Order Received",
    icon: Clock,
    color: "text-amber-600",
    description: "Payment and order confirmation are still in progress.",
  },
  confirmed: {
    label: "Payment Confirmed",
    icon: CheckCircle,
    color: "text-blue-600",
    description:
      "Payment is confirmed and the order was sent to the business. The business has not started preparation yet.",
  },
  preparing: {
    label: "Being Prepared",
    icon: ChefHat,
    color: "text-orange-600",
    description: "The kitchen is preparing your order now.",
  },
  ready: {
    label: "Ready for Pickup!",
    icon: Package,
    color: "text-green-600",
    description: "Your order is ready. Head to the pickup location below.",
  },
  out_for_delivery: {
    label: "Out for Delivery",
    icon: Package,
    color: "text-violet-600",
    description: "The merchant is bringing your order to the delivery address.",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircle,
    color: "text-green-600",
    description: "The merchant marked your order as delivered.",
  },
  completed: {
    label: "Order Complete",
    icon: CheckCircle,
    color: "text-gray-600",
    description: "Thank you! Your order was completed.",
  },
  payment_disputed: {
    label: "Payment Under Review",
    icon: Clock,
    color: "text-amber-600",
    description:
      "Fulfillment is paused because the card payment is disputed. Keep this page and contact MealScout support.",
  },
  cancellation_pending: {
    label: "Cancellation Processing",
    icon: Clock,
    color: "text-amber-600",
    description:
      "MealScout blocked fulfillment and is finalizing the payment cancellation or refund.",
  },
  cancelled: {
    label: "Order Cancelled",
    icon: XCircle,
    color: "text-red-600",
    description: "This order was cancelled.",
  },
};

const STATUS_ORDER = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
];

interface OrderItem {
  id: string;
  itemName: string;
  quantity: number;
  variantLabel: string | null;
  lineTotalCents: number;
}

interface Order {
  id: string;
  status: string;
  customerName: string;
  orderType: string;
  paymentMethod: string;
  subtotalCents: number;
  mealscoutFeeCents?: number;
  processingFeeCents?: number;
  platformFeeCents: number;
  feePaidByBusiness: boolean;
  pricesIncludeTax?: boolean;
  totalCents: number;
  createdAt: string;
  confirmedAt: string | null;
  merchantAcknowledgementMinutesSnapshot?: number | null;
  merchantAcknowledgementDueAt?: string | null;
  merchantAcknowledgedAt?: string | null;
  readyAt: string | null;
  completedAt: string | null;
  scheduledFor: string | null;
  prepTimeMinutes?: number | null;
  merchantNameSnapshot?: string | null;
  pickupAddressSnapshot?: string | null;
  pickupDirectionsUrlSnapshot?: string | null;
  stripeRefundStatus?: string | null;
  stripeRefundAmountCents?: number | null;
  stripeDisputeStatus?: string | null;
  stripeDisputeAmountCents?: number | null;
  deliveryFeeCents?: number;
  deliveryAddress?: string | null;
  deliveryCity?: string | null;
  deliveryState?: string | null;
  deliveryPostalCode?: string | null;
  deliveryInstructions?: string | null;
  items: OrderItem[];
}

const UNRESOLVED_REFUND_STATUSES = new Set([
  "pending",
  "requires_action",
  "reconciliation_required",
  "failed",
  "canceled",
]);

function isOrderFinancialOutcomeOpen(order: Order) {
  const disputeStatus = String(order.stripeDisputeStatus || "")
    .trim()
    .toLowerCase();
  const disputeStillOpen = [
    "warning_needs_response",
    "warning_under_review",
    "needs_response",
    "under_review",
  ].includes(disputeStatus);
  const refundStatus = String(order.stripeRefundStatus || "")
    .trim()
    .toLowerCase();
  if (
    disputeStillOpen ||
    UNRESOLVED_REFUND_STATUSES.has(refundStatus) ||
    order.status === "cancellation_pending" ||
    order.status === "payment_disputed"
  ) {
    return true;
  }
  if (order.status !== "cancelled") return false;
  if (refundStatus === "not_required_payment_not_captured") return false;
  return !isPickupOrderCustomerMadeWhole(order);
}

function normalizeOrderPayload(payload: any): Order | null {
  const order = payload?.order || payload;
  if (!order?.id) return null;
  return {
    ...order,
    items: (Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(order.items)
        ? order.items
        : []
    ).map((item: any) => ({
      ...item,
      variantLabel: item?.variantLabel || item?.selectedVariant?.label || null,
    })),
  } as Order;
}

export default function OrderConfirmationPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const search = useSearch();
  const accessToken =
    new URLSearchParams(search).get("accessToken") ||
    window.sessionStorage.getItem(`mealscout:order-access:${orderId}`);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = async () => {
    try {
      const res = await fetch(
        `/api/pickup-orders/${encodeURIComponent(orderId ?? "")}`,
        {
          credentials: "include",
          headers: accessToken ? { "X-Order-Access-Token": accessToken } : {},
        },
      );
      if (!res.ok) {
        // Try by payment_intent (Stripe redirect case)
        const url = new URL(window.location.href);
        const piId = url.searchParams.get("payment_intent");
        if (piId) {
          const piRes = await fetch(
            `/api/pickup-orders/by-intent/${encodeURIComponent(piId)}`,
            { credentials: "include" },
          );
          if (piRes.ok) {
            const data = await piRes.json();
            const normalized = normalizeOrderPayload(data);
            if (!normalized) throw new Error("Order not found");
            setOrder(normalized);
            return;
          }
        }
        throw new Error("Order not found");
      }
      const data = await res.json();
      const normalized = normalizeOrderPayload(data);
      if (!normalized) throw new Error("Order not found");
      setOrder(normalized);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  // Poll for status updates on active orders
  useEffect(() => {
    if (!order) return;
    if (
      ["cancelled", "completed"].includes(order.status) &&
      !isOrderFinancialOutcomeOpen(order)
    ) {
      return;
    }

    const interval = setInterval(fetchOrder, 10_000);
    return () => clearInterval(interval);
  }, [
    order?.status,
    order?.stripeDisputeStatus,
    order?.stripeRefundStatus,
    order?.stripeRefundAmountCents,
    orderId,
  ]);

  if (loading) {
    return (
      <div
        className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)]"
        data-public-order-status-shell="warm-food-led"
      >
        <PublicOrderingTopBar />
        <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center px-4 py-20">
          <div className="profile-surface flex items-center gap-3 rounded-3xl px-6 py-5 text-[color:var(--profile-ink-soft)]">
            <Loader2 className="h-5 w-5 animate-spin text-[color:var(--profile-accent)]" />
            <span className="font-bold">Loading order status</span>
          </div>
        </main>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div
        className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)]"
        data-public-order-status-shell="warm-food-led"
      >
        <PublicOrderingTopBar />
        <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center px-4 py-20">
          <section className="profile-surface w-full rounded-[2rem] p-7 text-center sm:p-10">
            <XCircle className="mx-auto h-11 w-11 text-[#b33122]" />
            <h1 className="mt-4 text-2xl font-black tracking-tight text-[color:var(--profile-ink)]">
              Order status unavailable
            </h1>
            <p className="mt-2 text-sm text-[color:var(--profile-muted)]">
              {error ?? "Order not found."}
            </p>
            <Link
              href="/scout"
              className="profile-action-primary mt-6 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-black"
            >
              Scout
            </Link>
          </section>
        </main>
      </div>
    );
  }

  const fullRefundSucceeded = isPickupOrderFullyRefunded(order);
  const partialRefundAmountCents = fullRefundSucceeded
    ? 0
    : pickupOrderSucceededRefundAmountCents(order);
  const disputeRecoveryAmountCents =
    pickupOrderDisputeRecoveryAmountCents(order);
  const customerRecoveryAmountCents =
    pickupOrderCustomerRecoveryAmountCents(order);
  const customerMadeWhole = isPickupOrderCustomerMadeWhole(order);
  const refundStatus = String(order.stripeRefundStatus || "")
    .trim()
    .toLowerCase();
  const disputeStatus = String(order.stripeDisputeStatus || "")
    .trim()
    .toLowerCase();
  const disputeResolved = [
    "won",
    "lost",
    "prevented",
    "warning_closed",
  ].includes(disputeStatus);
  const paymentUnderReview = Boolean(disputeStatus) && !disputeResolved;
  const config =
    order.status === "cancelled" && fullRefundSucceeded
      ? {
          ...STATUS_CONFIG.cancelled,
          label: "Order Cancelled · Refunded",
          description: `The full ${formatMoney(order.totalCents)} card payment was refunded.`,
        }
      : order.status === "cancelled" && customerMadeWhole
        ? {
            ...STATUS_CONFIG.cancelled,
            label: "Order Cancelled · Customer Recovered",
            description:
              partialRefundAmountCents > 0
                ? `The issuer returned ${formatMoney(disputeRecoveryAmountCents)} through the dispute and MealScout refunded ${formatMoney(partialRefundAmountCents)}.`
                : `The issuer returned the full ${formatMoney(disputeRecoveryAmountCents)} through the dispute; no separate MealScout refund was needed.`,
          }
        : order.status === "cancelled" &&
            refundStatus === "not_required_payment_not_captured"
          ? {
              ...STATUS_CONFIG.cancelled,
              label: "Order Cancelled · No Card Charge",
              description:
                "The card payment was not captured, so no refund was required.",
            }
          : order.status === "cancelled"
            ? {
                ...STATUS_CONFIG.cancelled,
                label: "Order Cancelled · Payment Reconciliation Open",
                description:
                  partialRefundAmountCents > 0
                    ? `${formatMoney(partialRefundAmountCents)} has been refunded. The remaining payment outcome is still being reconciled.`
                    : "No final card refund outcome is recorded yet. MealScout support must finish the reconciliation.",
              }
            : order.status === "completed" && paymentUnderReview
              ? {
                  ...STATUS_CONFIG.completed,
                  label: "Order Complete · Payment Under Review",
                  description:
                    "The order was completed. The card issuer is now reviewing the payment; the recorded fulfillment history remains completed.",
                }
              : order.status === "completed" &&
                  UNRESOLVED_REFUND_STATUSES.has(refundStatus)
                ? {
                    ...STATUS_CONFIG.completed,
                    label: "Order Complete · Refund Reconciliation",
                    description:
                      partialRefundAmountCents > 0
                        ? `${formatMoney(partialRefundAmountCents)} is refunded, but the later payment adjustment is not final yet.`
                        : "The completed fulfillment record is unchanged, but the later refund attempt is not final yet.",
                  }
                : order.status === "completed" && fullRefundSucceeded
                  ? {
                      ...STATUS_CONFIG.completed,
                      label: "Order Complete · Refunded",
                      description:
                        "This order was completed and the full card payment was later refunded.",
                    }
                  : order.status === "completed" && partialRefundAmountCents > 0
                    ? {
                        ...STATUS_CONFIG.completed,
                        label: "Order Complete · Partially Refunded",
                        description: `${formatMoney(partialRefundAmountCents)} of the card payment was refunded after completion.`,
                      }
                    : (STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending);
  const acknowledgementDueAt = order.merchantAcknowledgementDueAt
    ? new Date(order.merchantAcknowledgementDueAt)
    : null;
  const acknowledgementDeadlineLabel =
    acknowledgementDueAt && !Number.isNaN(acknowledgementDueAt.getTime())
      ? new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(acknowledgementDueAt)
      : null;
  const statusDescription =
    order.status === "cancellation_pending" &&
    ["failed", "canceled", "reconciliation_required"].includes(
      String(order.stripeRefundStatus || ""),
    )
      ? "The refund needs manual support. The order will not be fulfilled; keep this page for the final update."
      : order.status === "confirmed"
        ? acknowledgementDeadlineLabel
          ? `The business must start preparation by ${acknowledgementDeadlineLabel}. If it does not, MealScout will cancel the order and begin transfer and refund reconciliation automatically.`
          : "Payment is confirmed, but the merchant response deadline is unavailable. MealScout will not treat the order as being prepared until the business starts it."
        : config.description;
  const StatusIcon = config.icon;
  const orderNum = order.id.slice(-6).toUpperCase();
  const isTerminal =
    ["cancelled", "completed"].includes(order.status) &&
    !isOrderFinancialOutcomeOpen(order);
  const financialOutcomeOpen = isOrderFinancialOutcomeOpen(order);
  const showPaymentOutcome =
    ["cancelled", "cancellation_pending", "payment_disputed"].includes(
      order.status,
    ) ||
    (order.status === "completed" && financialOutcomeOpen);
  const supportHref = `mailto:support@mealscout.us?subject=${encodeURIComponent(
    `MealScout order ${order.id} payment help`,
  )}&body=${encodeURIComponent(
    `Please review MealScout order ${order.id}. The current status is ${order.status} and the recorded refund status is ${refundStatus || "not recorded"}.`,
  )}`;
  const statusOrder =
    order.orderType === "delivery"
      ? [
          "pending",
          "confirmed",
          "preparing",
          "ready",
          "out_for_delivery",
          "delivered",
          "completed",
        ]
      : STATUS_ORDER;

  return (
    <div
      className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)] pb-12 text-[color:var(--profile-ink)]"
      data-public-order-status-shell="warm-food-led"
    >
      <PublicOrderingTopBar />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
        {/* Status hero */}
        <div className="profile-surface mb-8 rounded-[2rem] p-6 text-center sm:p-8">
          <StatusIcon className={`mx-auto mb-3 h-16 w-16 ${config.color}`} />
          <h1 className="text-2xl font-black tracking-tight text-[color:var(--profile-ink)]">
            {config.label}
          </h1>
          <p className="mt-1 text-sm leading-6 text-[color:var(--profile-muted)]">
            {statusDescription}
          </p>
          <p className="mt-2 font-mono text-sm text-[color:var(--profile-muted)]">
            Order #{orderNum}
          </p>
        </div>

        {showPaymentOutcome ? (
          <Card className="profile-surface mb-4 rounded-3xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
                Payment outcome
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[color:var(--profile-ink-soft)]">
              <p>
                {fullRefundSucceeded
                  ? `Full card refund recorded: ${formatMoney(order.totalCents)}.`
                  : customerMadeWhole && disputeRecoveryAmountCents > 0
                    ? partialRefundAmountCents > 0
                      ? `Customer recovery complete: ${formatMoney(disputeRecoveryAmountCents)} returned through the issuer dispute plus ${formatMoney(partialRefundAmountCents)} refunded by MealScout.`
                      : `Customer recovery complete: the issuer returned the full ${formatMoney(disputeRecoveryAmountCents)} through the dispute; no separate MealScout refund was needed.`
                    : refundStatus === "not_required_payment_not_captured"
                      ? "The card payment was not captured. No refund was required."
                      : paymentUnderReview
                        ? `${formatMoney(Number(order.stripeDisputeAmountCents || 0))} is under issuer review. This is not a final refund outcome.`
                        : partialRefundAmountCents > 0
                          ? `${formatMoney(partialRefundAmountCents)} is recorded as refunded; ${formatMoney(Math.max(0, order.totalCents - customerRecoveryAmountCents))} remains unresolved.`
                          : "No final card refund outcome is recorded yet."}
              </p>
              {financialOutcomeOpen ? (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                  <p>
                    {order.status === "completed"
                      ? "Fulfillment remains recorded as completed. The later payment adjustment is still open; keep this page and do not treat a pending or failed refund as money returned."
                      : "Fulfillment is paused. Do not pick up this order or place a duplicate while payment reconciliation is open. A cancellation is financially complete only when this page records no capture, a full refund, or issuer recovery plus refund equal to the order total."}
                  </p>
                  <a
                    className="mt-2 inline-flex min-h-10 items-center font-black underline underline-offset-2"
                    href={supportHref}
                  >
                    Email MealScout support about order #{orderNum}
                  </a>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {order.merchantNameSnapshot ? (
          <Card className="profile-surface mb-4 rounded-3xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
                {order.orderType === "delivery" ? "Prepared by" : "Pickup from"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-black">{order.merchantNameSnapshot}</p>
              {order.orderType !== "delivery" && order.pickupAddressSnapshot ? (
                <a
                  href={
                    order.pickupDirectionsUrlSnapshot ||
                    `https://maps.google.com/?q=${encodeURIComponent(order.pickupAddressSnapshot)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-start gap-1.5 text-sm text-[color:var(--profile-accent)] underline underline-offset-2"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {order.pickupAddressSnapshot}
                </a>
              ) : null}
              {order.status === "payment_disputed" ? (
                <p className="mt-2 text-xs text-amber-700">
                  Do not pick up this order unless MealScout support confirms a
                  resolution.
                </p>
              ) : order.status === "completed" && disputeStatus ? (
                <p className="mt-2 text-xs text-amber-700">
                  {paymentUnderReview
                    ? "The card payment is under issuer review. This does not change the completed fulfillment record shown here."
                    : "The issuer review has concluded. This does not change the completed fulfillment record shown here."}
                </p>
              ) : order.status === "cancellation_pending" ? (
                <p className="mt-2 text-xs text-amber-700">
                  Payment reconciliation is still in progress. Keep this page
                  for the final cancelled status.
                </p>
              ) : !order.confirmedAt ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Waiting for payment and order confirmation.
                </p>
              ) : order.status === "confirmed" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {acknowledgementDeadlineLabel
                    ? `The business must start preparation by ${acknowledgementDeadlineLabel}. If it does not, MealScout will cancel this order and begin refund reconciliation.`
                    : "Payment is confirmed. MealScout is waiting for the business to start preparation."}
                </p>
              ) : order.status === "preparing" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  The business started preparation
                  {order.prepTimeMinutes
                    ? ` with a ${order.prepTimeMinutes}-minute estimate.`
                    : "."}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Progress bar (for non-cancelled orders) */}
        {!["cancelled", "cancellation_pending", "payment_disputed"].includes(
          order.status,
        ) && (
          <div className="flex items-center justify-between mb-8 px-2">
            {statusOrder.slice(0, -1).map((s, idx) => {
              const stepIdx = statusOrder.indexOf(order.status);
              const isDone = idx < stepIdx;
              const isCurrent = idx === stepIdx;
              return (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isDone
                        ? "bg-green-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? "✓" : idx + 1}
                  </div>
                  {idx < statusOrder.length - 2 && (
                    <div
                      className={`h-1 flex-1 mx-1 ${
                        isDone ? "bg-green-500" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Order details */}
        <Card className="profile-surface mb-4 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Order details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.quantity}× {item.itemName}
                  {item.variantLabel && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {item.variantLabel}
                    </span>
                  )}
                </span>
                <span>{formatMoney(item.lineTotalCents)}</span>
              </div>
            ))}
            <div className="mt-2 space-y-1 border-t border-[color:var(--profile-border)] pt-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoney(order.subtotalCents)}</span>
              </div>
              {!order.feePaidByBusiness &&
              Number(order.mealscoutFeeCents || 0) > 0 ? (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>MealScout fee</span>
                  <span>{formatMoney(order.mealscoutFeeCents || 0)}</span>
                </div>
              ) : null}
              {order.pricesIncludeTax ? (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tax</span>
                  <span>Included in item prices</span>
                </div>
              ) : null}
              {!order.feePaidByBusiness &&
              Number(order.processingFeeCents || 0) > 0 ? (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Card processing</span>
                  <span>{formatMoney(order.processingFeeCents || 0)}</span>
                </div>
              ) : null}
              {!order.feePaidByBusiness &&
              Number(order.platformFeeCents || 0) > 0 &&
              Number(order.mealscoutFeeCents || 0) === 0 &&
              Number(order.processingFeeCents || 0) === 0 ? (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Order fees</span>
                  <span>{formatMoney(order.platformFeeCents)}</span>
                </div>
              ) : null}
              {Number(order.deliveryFeeCents || 0) > 0 ? (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Merchant delivery</span>
                  <span>{formatMoney(order.deliveryFeeCents || 0)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-black">
                <span>Total</span>
                <span>{formatMoney(order.totalCents)}</span>
              </div>
            </div>
            {order.orderType === "delivery" && order.deliveryAddress ? (
              <div className="mt-3 rounded-xl border border-[color:var(--profile-border)] p-3 text-sm">
                <p className="font-black">Deliver to</p>
                <p>
                  {[
                    order.deliveryAddress,
                    order.deliveryCity,
                    order.deliveryState,
                    order.deliveryPostalCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {order.deliveryInstructions ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.deliveryInstructions}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground pt-1 flex gap-3 flex-wrap">
              <span className="capitalize">
                {order.orderType.replace("_", " ")}
              </span>
              <span className="capitalize">{order.paymentMethod}</span>
            </div>
          </CardContent>
        </Card>

        {/* Live status note */}
        {!isTerminal && (
          <p className="text-xs text-center text-muted-foreground mb-4">
            This page auto-updates every 10 seconds.
          </p>
        )}

        <div className="flex gap-3">
          <Link href="/scout" className="flex-1">
            <Button className="w-full rounded-full bg-[#d84a12] font-black text-white hover:bg-[#b83a0a]">
              Scout
            </Button>
          </Link>
          {!isTerminal && (
            <Button variant="ghost" className="shrink-0" onClick={fetchOrder}>
              <Loader2 className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
