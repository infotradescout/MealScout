/**
 * Order Confirmation page
 * Shows live order status with auto-polling.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
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
} from "lucide-react";

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
    description: "Waiting for the kitchen to confirm your order...",
  },
  confirmed: {
    label: "Order Confirmed",
    icon: CheckCircle,
    color: "text-blue-600",
    description: "Your order has been confirmed and will be prepared shortly.",
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
    description: "Your order is ready! Come grab it now.",
  },
  completed: {
    label: "Order Complete",
    icon: CheckCircle,
    color: "text-gray-600",
    description: "Thank you! Your order was completed.",
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
  platformFeeCents: number;
  feePaidByBusiness: boolean;
  totalCents: number;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  scheduledFor: string | null;
  items: OrderItem[];
}

export default function OrderConfirmationPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = async () => {
    try {
      const res = await fetch(
        `/api/pickup-orders/${encodeURIComponent(orderId ?? "")}`,
        {
          credentials: "include",
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
            setOrder(data);
            return;
          }
        }
        throw new Error("Order not found");
      }
      const data = await res.json();
      setOrder(data);
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
    if (["completed", "cancelled"].includes(order.status)) return;

    const interval = setInterval(fetchOrder, 10_000);
    return () => clearInterval(interval);
  }, [order?.status, orderId]);

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

  const config = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = config.icon;
  const orderNum = order.id.slice(-6).toUpperCase();
  const isTerminal = ["completed", "cancelled"].includes(order.status);

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
            {config.description}
          </p>
          <p className="mt-2 font-mono text-sm text-[color:var(--profile-muted)]">
            Order #{orderNum}
          </p>
        </div>

        {/* Progress bar (for non-cancelled orders) */}
        {order.status !== "cancelled" && (
          <div className="flex items-center justify-between mb-8 px-2">
            {STATUS_ORDER.slice(0, -1).map((s, idx) => {
              const stepIdx = STATUS_ORDER.indexOf(order.status);
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
                  {idx < 3 && (
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
              {!order.feePaidByBusiness && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>MealScout fee</span>
                  <span>{formatMoney(order.platformFeeCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-black">
                <span>Total</span>
                <span>{formatMoney(order.totalCents)}</span>
              </div>
            </div>
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
