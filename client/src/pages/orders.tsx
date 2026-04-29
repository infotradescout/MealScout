import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChefHat,
  CheckCircle,
  Clock,
  PackageCheck,
  Receipt,
  ShoppingBag,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";
import { authUrl } from "@/lib/api";

type ClaimedDeal = {
  id: string;
  dealId: string;
  claimedAt: string;
  usedAt?: string | null;
  isUsed?: boolean | null;
  orderAmount?: string | number | null;
  dealTitle?: string | null;
  dealType?: string | null;
  discountValue?: string | number | null;
  restaurantId?: string | null;
  restaurantName?: string | null;
};

type PickupOrder = {
  id: string;
  restaurantId: string;
  restaurantName?: string | null;
  orderType: "pickup" | "dine_in" | string;
  status: string;
  paymentMethod: string;
  subtotalCents: number;
  platformFeeCents: number;
  feePaidByBusiness: boolean;
  totalCents: number;
  prepTimeMinutes?: number | null;
  scheduledFor?: string | null;
  createdAt?: string | null;
  confirmedAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
};

type OrdersResponse = {
  orders?: PickupOrder[];
};

type OrdersTab = "active" | "past" | "deals";

const activeOrderStatuses = new Set([
  "pending",
  "confirmed",
  "preparing",
  "ready",
]);

const statusConfig: Record<
  string,
  {
    label: string;
    Icon: typeof Clock;
    className: string;
    helper: string;
  }
> = {
  pending: {
    label: "Received",
    Icon: Clock,
    className:
      "bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]",
    helper: "Waiting for the kitchen to confirm.",
  },
  confirmed: {
    label: "Confirmed",
    Icon: CheckCircle,
    className: "bg-blue-500/15 text-blue-300",
    helper: "The kitchen has your order.",
  },
  preparing: {
    label: "Preparing",
    Icon: ChefHat,
    className: "bg-orange-500/15 text-orange-300",
    helper: "Your food is being made now.",
  },
  ready: {
    label: "Ready",
    Icon: PackageCheck,
    className:
      "bg-[color:var(--status-success)]/15 text-[color:var(--status-success)]",
    helper: "Ready for pickup.",
  },
  completed: {
    label: "Complete",
    Icon: CheckCircle,
    className:
      "bg-[color:var(--status-success)]/15 text-[color:var(--status-success)]",
    helper: "Order completed.",
  },
  cancelled: {
    label: "Cancelled",
    Icon: XCircle,
    className:
      "bg-[color:var(--status-error)]/15 text-[color:var(--status-error)]",
    helper: "This order was cancelled.",
  },
};

const formatMoneyFromCents = (cents?: number | null) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

const formatMoney = (value?: string | number | null) => {
  if (value === null || value === undefined) return "--";
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "--";
  return `$${amount.toFixed(2)}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDiscount = (claim: ClaimedDeal) => {
  if (claim.discountValue === null || claim.discountValue === undefined) {
    return "Deal claimed";
  }
  const value =
    typeof claim.discountValue === "string"
      ? Number(claim.discountValue)
      : claim.discountValue;
  if (!Number.isFinite(value)) return "Deal claimed";
  return claim.dealType === "fixed"
    ? `$${value.toFixed(2)} off`
    : `${value}% off`;
};

function OrderStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.Icon;
  return (
    <Badge className={`${config.className} gap-1 border-0 capitalize`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
}

export default function OrdersPage() {
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<OrdersTab>("active");

  const { data: orderData, isLoading: ordersLoading } =
    useQuery<OrdersResponse>({
      queryKey: ["/api/my/orders"],
      enabled: isAuthenticated,
      queryFn: async () => {
        const response = await fetch("/api/my/orders", {
          credentials: "include",
        });
        if (!response.ok) return { orders: [] };
        return response.json();
      },
    });

  const { data: claimedDeals, isLoading: dealsLoading } = useQuery<
    ClaimedDeal[]
  >({
    queryKey: ["/api/deals/claimed"],
    enabled: isAuthenticated,
  });

  const orders = Array.isArray(orderData?.orders) ? orderData.orders : [];
  const activeOrders = orders.filter((order) =>
    activeOrderStatuses.has(String(order.status || "pending")),
  );
  const pastOrders = orders.filter(
    (order) => !activeOrderStatuses.has(String(order.status || "pending")),
  );
  const claims = Array.isArray(claimedDeals) ? claimedDeals : [];
  const isLoading = ordersLoading || (activeTab === "deals" && dealsLoading);

  const visibleOrders = activeTab === "active" ? activeOrders : pastOrders;

  if (!isAuthenticated) {
    return (
      <div className="mx-auto min-h-screen max-w-md bg-[var(--bg-layered)] pb-20">
        <BackHeader
          title="Orders"
          fallbackHref="/"
          icon={ShoppingBag}
          className="border-b border-[color:var(--border-subtle)] bg-[hsl(var(--background))/0.94] shadow-clean"
        />

        <div className="px-4 py-12 text-center sm:px-6">
          <ShoppingBag className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold text-foreground">
            Sign in to view orders
          </h2>
          <p className="mb-6 text-muted-foreground">
            Log in to track pickup orders, dine-in orders, and saved deal
            claims.
          </p>
          <Button
            onClick={() =>
              (window.location.href = authUrl("/api/auth/facebook"))
            }
          >
            Sign In
          </Button>
        </div>

        <Navigation />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-[var(--bg-layered)] pb-20">
      <SEOHead
        title="Orders - MealScout | Pickup, Dine-In & Deal History"
        description="Track your MealScout online food orders, pickup status, dine-in orders, and saved deal claims."
        keywords="orders, pickup orders, online ordering, deal history, MealScout"
        canonicalUrl="https://www.mealscout.us/orders"
        noIndex={true}
      />
      <h1 className="sr-only">MealScout orders</h1>
      <BackHeader
        title="Orders"
        fallbackHref="/"
        icon={ShoppingBag}
        className="border-b border-[color:var(--border-subtle)] bg-[hsl(var(--background))/0.94] shadow-clean"
      />

      <section className="border-b border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-4 py-4 sm:px-6">
        <div className="mb-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[linear-gradient(135deg,rgba(255,159,10,0.16),rgba(17,17,22,0.92))] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)]">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--accent-text)]">
                Online ordering
              </p>
              <p className="mt-1 text-sm font-medium text-[color:var(--text-secondary)]">
                Follow active pickup and dine-in orders from confirmation to
                ready.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 rounded-xl bg-[var(--bg-surface-muted)] p-1">
          <Button
            variant={activeTab === "active" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("active")}
            className="rounded-lg text-xs"
            data-testid="tab-active-orders"
          >
            Active ({activeOrders.length})
          </Button>
          <Button
            variant={activeTab === "past" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("past")}
            className="rounded-lg text-xs"
            data-testid="tab-past-orders"
          >
            Past ({pastOrders.length})
          </Button>
          <Button
            variant={activeTab === "deals" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("deals")}
            className="rounded-lg text-xs"
            data-testid="tab-deal-claims"
          >
            Deals ({claims.length})
          </Button>
        </div>
      </section>

      <div className="px-4 py-6 sm:px-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="animate-pulse rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="h-6 w-2/3 rounded bg-muted" />
                  <div className="h-6 w-20 rounded bg-muted" />
                </div>
                <div className="mb-2 h-4 w-1/2 rounded bg-muted" />
                <div className="h-4 w-1/3 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : activeTab === "deals" ? (
          claims.length > 0 ? (
            <div className="space-y-4">
              {claims.map((claim) => {
                const status = claim.isUsed ? "completed" : "active";
                const claimedAt = claim.claimedAt
                  ? new Date(claim.claimedAt)
                  : null;
                return (
                  <div
                    key={claim.id}
                    className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean"
                    data-testid={`deal-claim-${claim.id}`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {claim.restaurantName || "Restaurant"}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {claim.dealTitle || "Deal"}
                        </p>
                      </div>
                      <Badge className="border-0 bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)]">
                        {status === "active" ? "Claimed" : "Used"}
                      </Badge>
                    </div>
                    <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
                      <span>{formatDiscount(claim)}</span>
                      <span>{formatMoney(claim.orderAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {claimedAt ? claimedAt.toLocaleDateString() : "--"}
                      </span>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/deal/${claim.dealId}`}>View Deal</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyOrdersState
              title="No deal claims yet"
              copy="Claimed specials will stay here, separate from online food orders."
              buttonText="Browse Deals"
              href="/deals"
              Icon={Receipt}
            />
          )
        ) : visibleOrders.length > 0 ? (
          <div className="space-y-4">
            {visibleOrders.map((order) => {
              const config = statusConfig[order.status] || statusConfig.pending;
              const createdAt = formatDateTime(order.createdAt);
              const scheduledFor = order.scheduledFor
                ? formatDateTime(order.scheduledFor)
                : "ASAP";
              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean"
                  data-testid={`order-${order.id}`}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[color:var(--accent-text)]">
                        Order #{order.id.slice(-6).toUpperCase()}
                      </p>
                      <h3 className="mt-1 text-lg font-black text-foreground">
                        {order.restaurantName || "Restaurant"}
                      </h3>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-[var(--bg-surface-muted)] p-3">
                      <p className="text-xs text-muted-foreground">Type</p>
                      <p className="font-semibold capitalize text-foreground">
                        {String(order.orderType || "pickup").replace("_", " ")}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-surface-muted)] p-3">
                      <p className="text-xs text-muted-foreground">When</p>
                      <p className="font-semibold text-foreground">
                        {scheduledFor}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-surface-muted)] p-3">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-semibold text-foreground">
                        {formatMoneyFromCents(order.totalCents)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-surface-muted)] p-3">
                      <p className="text-xs text-muted-foreground">Placed</p>
                      <p className="font-semibold text-foreground">
                        {createdAt}
                      </p>
                    </div>
                  </div>

                  <p className="mb-4 text-sm text-muted-foreground">
                    {config.helper}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" asChild className="flex-1">
                      <Link href={`/order-confirmation/${order.id}`}>
                        Track Order
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/menu/${order.restaurantId}`}>Menu</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeTab === "active" ? (
          <EmptyOrdersState
            title="No active online orders"
            copy="Orders you place from a MealScout menu will show live status here."
            buttonText="Find Food"
            href="/find-food"
            Icon={ShoppingBag}
          />
        ) : (
          <EmptyOrdersState
            title="No past online orders"
            copy="Completed and cancelled pickup or dine-in orders will appear here."
            buttonText="Browse Menus"
            href="/find-food"
            Icon={PackageCheck}
          />
        )}
      </div>

      <Navigation />
    </div>
  );
}

function EmptyOrdersState({
  title,
  copy,
  buttonText,
  href,
  Icon,
}: {
  title: string;
  copy: string;
  buttonText: string;
  href: string;
  Icon: typeof Receipt;
}) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--bg-surface-muted)]">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-bold text-foreground">{title}</h3>
      <p className="mx-auto mb-6 max-w-xs text-muted-foreground">{copy}</p>
      <Button asChild data-testid="button-browse-orders">
        <Link href={href}>{buttonText}</Link>
      </Button>
    </div>
  );
}
