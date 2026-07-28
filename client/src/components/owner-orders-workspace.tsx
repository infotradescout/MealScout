import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import { io, type Socket } from "socket.io-client";
import type { Restaurant } from "@shared/schema";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChefHat,
  Clock3,
  History,
  Loader2,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { API_BASE_URL } from "@/lib/api";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import { apiRequest, queryClient } from "@/lib/queryClient";

type OwnerOrdersView = "orders" | "kitchen";
type OrderFilter = "all" | "active" | "completed" | "cancelled";

type OrderModifier = {
  label?: string | null;
  groupName?: string | null;
};

type OwnerOrderItem = {
  id: string;
  itemName: string;
  quantity: number;
  lineTotalCents: number;
  specialInstructions?: string | null;
  selectedVariant?: { label?: string | null } | null;
  selectedModifiers?: OrderModifier[] | null;
  variantLabel?: string | null;
  modifierLabels?: string[] | null;
};

export type OwnerOrder = {
  id: string;
  restaurantId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  orderType: "pickup" | "dine_in" | string;
  deliveryAddress?: string | null;
  deliveryCity?: string | null;
  deliveryState?: string | null;
  deliveryPostalCode?: string | null;
  deliveryFeeCents?: number | null;
  deliveryInstructions?: string | null;
  status: string;
  subtotalCents: number;
  platformFeeCents: number;
  feePaidByBusiness: boolean;
  totalCents: number;
  paymentMethod: "card" | "cash" | string;
  payoutStatus?: string | null;
  scheduledFor?: string | null;
  confirmedAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  prepTimeMinutes?: number | null;
  specialInstructions?: string | null;
  items: OwnerOrderItem[];
};

type OrdersResponse = {
  orders: OwnerOrder[];
  page?: number;
  hasMore?: boolean;
};

type OwnerOrdersWorkspaceProps = {
  view: OwnerOrdersView;
};

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "delivered"];
const CANCELLABLE_STATUSES = ["pending", "confirmed", "preparing"];

const STATUS_DETAILS: Record<
  string,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  pending: {
    label: "New",
    className: "border-amber-200 bg-amber-50 text-amber-900",
    icon: Bell,
  },
  confirmed: {
    label: "Confirmed",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    icon: CheckCircle2,
  },
  preparing: {
    label: "Preparing",
    className: "border-orange-200 bg-orange-50 text-orange-800",
    icon: ChefHat,
  },
  ready: {
    label: "Ready",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: PackageCheck,
  },
  out_for_delivery: {
    label: "Out for delivery",
    className: "border-violet-200 bg-violet-50 text-violet-800",
    icon: ShoppingBag,
  },
  delivered: {
    label: "Delivered",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: PackageCheck,
  },
  completed: {
    label: "Completed",
    className: "border-stone-200 bg-stone-100 text-stone-700",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    className: "border-red-200 bg-red-50 text-red-800",
    icon: XCircle,
  },
};

const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  pending: { status: "confirmed", label: "Confirm order" },
  confirmed: { status: "preparing", label: "Start preparing" },
  preparing: { status: "ready", label: "Mark ready" },
  ready: { status: "completed", label: "Complete order" },
  out_for_delivery: { status: "delivered", label: "Mark delivered" },
  delivered: { status: "completed", label: "Complete order" },
};

export function isBusinessOrderOperator(userType: unknown) {
  return [
    "restaurant_owner",
    "food_truck",
    "admin",
    "duper_admin",
    "super_admin",
  ].includes(String(userType || ""));
}

function formatMoney(cents: number | null | undefined) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function orderNumber(order: OwnerOrder) {
  return order.id.slice(-6).toUpperCase();
}

function getVariantLabel(item: OwnerOrderItem) {
  return item.selectedVariant?.label || item.variantLabel || null;
}

function getModifierLabels(item: OwnerOrderItem) {
  if (Array.isArray(item.selectedModifiers)) {
    return item.selectedModifiers
      .map((modifier) => modifier?.label)
      .filter((label): label is string => Boolean(label));
  }
  return Array.isArray(item.modifierLabels) ? item.modifierLabels : [];
}

async function fetchOrders(url: string): Promise<OrdersResponse> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Orders could not be loaded");
  }
  return {
    orders: Array.isArray(payload?.orders) ? payload.orders : [],
    page: Number(payload?.page || 1),
    hasMore: payload?.hasMore === true,
  };
}

function mergeOrder(current: OwnerOrder[], incoming: OwnerOrder) {
  const existing = current.find((order) => order.id === incoming.id);
  const normalized = {
    ...existing,
    ...incoming,
    items:
      Array.isArray(incoming.items) && incoming.items.length > 0
        ? incoming.items
        : existing?.items || [],
  } as OwnerOrder;
  if (!ACTIVE_STATUSES.includes(normalized.status)) {
    return current.filter((order) => order.id !== normalized.id);
  }
  if (existing) {
    return current.map((order) =>
      order.id === normalized.id ? normalized : order,
    );
  }
  return [normalized, ...current];
}

function OrderStatusBadge({ status }: { status: string }) {
  const details = STATUS_DETAILS[status] || STATUS_DETAILS.pending;
  const Icon = details.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${details.className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {details.label}
    </Badge>
  );
}

function OwnerOrderCard({
  order,
  onAdvance,
  onCancel,
  isUpdating,
  compact = false,
}: {
  order: OwnerOrder;
  onAdvance: (order: OwnerOrder) => void;
  onCancel: (order: OwnerOrder) => void;
  isUpdating: boolean;
  compact?: boolean;
}) {
  const next =
    order.status === "ready" && order.orderType === "delivery"
      ? { status: "out_for_delivery", label: "Send out for delivery" }
      : NEXT_STATUS[order.status];
  const createdAt = new Date(order.createdAt);
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? "Time unavailable"
    : formatDistanceToNow(createdAt, { addSuffix: true });
  const scheduledAt = order.scheduledFor
    ? new Date(order.scheduledFor)
    : null;

  return (
    <Card
      className={`overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean ${
        order.status === "pending" ? "ring-2 ring-amber-200" : ""
      }`}
      data-testid={`owner-order-${order.id}`}
    >
      <CardContent className={compact ? "p-4" : "p-4 sm:p-5"}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-black text-[color:var(--text-primary)]">
                #{orderNumber(order)}
              </p>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-1 truncate text-sm font-bold text-[color:var(--text-primary)]">
              {order.customerName || "Customer"}
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
              {createdLabel}
              {scheduledAt && !Number.isNaN(scheduledAt.getTime())
                ? ` · Scheduled ${format(scheduledAt, "MMM d, h:mm a")}`
                : " · ASAP"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-black text-[color:var(--text-primary)]">
              {formatMoney(order.totalCents)}
            </p>
            <p className="mt-0.5 text-xs capitalize text-[color:var(--text-muted)]">
              {order.orderType.replace("_", " ")} · {order.paymentMethod}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-[color:var(--border-subtle)] pt-4">
          {order.items.length > 0 ? (
            order.items.map((item) => {
              const variant = getVariantLabel(item);
              const modifiers = getModifierLabels(item);
              return (
                <div key={item.id} className="flex items-start gap-3 text-sm">
                  <span className="w-6 shrink-0 text-right font-black text-orange-700">
                    {item.quantity}×
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[color:var(--text-primary)]">
                      {item.itemName}
                    </p>
                    {variant || modifiers.length > 0 ? (
                      <p className="text-xs text-[color:var(--text-muted)]">
                        {[variant, ...modifiers].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {item.specialInstructions ? (
                      <p className="mt-1 rounded-lg bg-orange-50 px-2 py-1 text-xs text-orange-900">
                        {item.specialInstructions}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-[color:var(--text-secondary)]">
                    {formatMoney(item.lineTotalCents)}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-[color:var(--text-muted)]">
              Item details are loading. Refresh if they do not appear.
            </p>
          )}
        </div>

        {order.specialInstructions ? (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
            <span className="font-black">Order note:</span>{" "}
            {order.specialInstructions}
          </div>
        ) : null}

        {order.orderType === "delivery" ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
            <p className="font-black">Deliver to</p>
            <p>{[order.deliveryAddress, order.deliveryCity, order.deliveryState, order.deliveryPostalCode].filter(Boolean).join(", ")}</p>
            {order.deliveryInstructions ? <p className="mt-1 text-xs">{order.deliveryInstructions}</p> : null}
          </div>
        ) : null}

        {order.status === "cancelled" && order.cancellationReason ? (
          <p className="mt-4 text-xs text-red-700">
            {order.cancellationReason}
          </p>
        ) : null}

        {next || CANCELLABLE_STATUSES.includes(order.status) ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-[color:var(--border-subtle)] pt-4 sm:flex-row">
            {next ? (
              <Button
                type="button"
                size="sm"
                className="min-h-11 flex-1"
                onClick={() => onAdvance(order)}
                disabled={isUpdating}
                data-testid={`button-advance-order-${order.id}`}
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  next.label
                )}
              </Button>
            ) : null}
            {CANCELLABLE_STATUSES.includes(order.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => onCancel(order)}
                disabled={isUpdating}
              >
                Cancel order
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function OwnerOrdersWorkspace({ view }: OwnerOrdersWorkspaceProps) {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [queueOrders, setQueueOrders] = useState<OwnerOrder[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<OwnerOrder | null>(null);

  const { data: businesses = [], isLoading: businessesLoading } = useQuery<
    Restaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: Boolean(user),
  });
  const requestedRestaurantId = new URLSearchParams(search).get("restaurantId");
  const selectedBusiness =
    businesses.find((business) => business.id === requestedRestaurantId) ||
    businesses.find((business) => business.id === (user as any)?.restaurantId) ||
    businesses[0] ||
    null;
  const restaurantId = selectedBusiness?.id || "";
  const historyQueryKey = useMemo(
    () => ["/api/owner/orders", restaurantId] as const,
    [restaurantId],
  );
  const queueQueryKey = useMemo(
    () => ["/api/owner/kitchen-queue", restaurantId] as const,
    [restaurantId],
  );

  const historyQuery = useInfiniteQuery<OrdersResponse>({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) =>
      fetchOrders(
        `/api/owner/orders/${encodeURIComponent(restaurantId)}?page=${Number(pageParam || 1)}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? Number(lastPage.page || 1) + 1 : undefined,
    enabled: Boolean(restaurantId && view === "orders"),
    retry: false,
  });

  const queueQuery = useQuery<OrdersResponse>({
    queryKey: queueQueryKey,
    queryFn: () =>
      fetchOrders(
        `/api/owner/kitchen-queue/${encodeURIComponent(restaurantId)}`,
      ),
    enabled: Boolean(restaurantId && view === "kitchen"),
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (view === "kitchen") {
      setQueueOrders(queueQuery.data?.orders || []);
    }
  }, [queueQuery.data, restaurantId, view]);

  useEffect(() => {
    if (!restaurantId || view !== "kitchen") return;
    const socketUrl = import.meta.env.DEV
      ? undefined
      : API_BASE_URL || undefined;
    const socket: Socket = io(socketUrl as string, {
      autoConnect: true,
      transports: ["polling", "websocket"],
      withCredentials: true,
      path: "/socket.io",
    });

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("subscribe_kitchen", { restaurantId });
    });
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("kitchen:order_update", (payload: { order?: OwnerOrder }) => {
      if (!payload?.order) return;
      setQueueOrders((current) => mergeOrder(current, payload.order!));
      void queryClient.invalidateQueries({ queryKey: queueQueryKey });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey });
    });

    return () => {
      socket.emit("unsubscribe_kitchen", { restaurantId });
      socket.disconnect();
      setIsConnected(false);
    };
  }, [historyQueryKey, queueQueryKey, restaurantId, view]);

  const statusMutation = useMutation({
    mutationFn: async ({ order, status }: { order: OwnerOrder; status: string }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/owner/orders/${encodeURIComponent(order.id)}/status`,
        { status },
      );
      const payload = await response.json();
      return (payload?.order || payload) as OwnerOrder;
    },
    onSuccess: async (updatedOrder) => {
      setQueueOrders((current) => mergeOrder(current, updatedOrder));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: historyQueryKey }),
        queryClient.invalidateQueries({ queryKey: queueQueryKey }),
      ]);
      toast({
        title: STATUS_DETAILS[updatedOrder.status]?.label || "Order updated",
        description: `Order #${orderNumber(updatedOrder)} is up to date.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Order could not be updated",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const historyOrders = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.orders) || [],
    [historyQuery.data],
  );
  const orders = view === "kitchen" ? queueOrders : historyOrders;
  const counts = useMemo(
    () => ({
      active: orders.filter((order) => ACTIVE_STATUSES.includes(order.status)).length,
      new: orders.filter((order) => order.status === "pending").length,
      ready: orders.filter((order) => order.status === "ready").length,
      completed: orders.filter((order) => order.status === "completed").length,
      cancelled: orders.filter((order) => order.status === "cancelled").length,
    }),
    [orders],
  );
  const filteredOrders =
    filter === "all"
      ? orders
      : filter === "active"
        ? orders.filter((order) => ACTIVE_STATUSES.includes(order.status))
        : orders.filter((order) => order.status === filter);
  const kitchenColumns = [
    {
      id: "pending",
      title: "New",
      icon: Bell,
      orders: orders.filter((order) => order.status === "pending"),
    },
    {
      id: "progress",
      title: "In progress",
      icon: ChefHat,
      orders: orders.filter((order) =>
        ["confirmed", "preparing"].includes(order.status),
      ),
    },
    {
      id: "ready",
      title: "Ready",
      icon: PackageCheck,
      orders: orders.filter((order) => ["ready", "out_for_delivery", "delivered"].includes(order.status)),
    },
  ];

  if (businessesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)]">
        <Loader2 className="h-7 w-7 animate-spin text-orange-600" />
        <span className="ml-3 font-bold text-[color:var(--text-secondary)]">
          Loading orders
        </span>
      </div>
    );
  }

  if (!selectedBusiness) {
    return (
      <main className="min-h-screen bg-[var(--bg-layered)] px-4 py-16">
        <Card className="mx-auto max-w-xl border-[color:var(--border-subtle)] bg-[var(--bg-surface)]">
          <CardContent className="p-8 text-center">
            <ShoppingBag className="mx-auto h-10 w-10 text-orange-600" />
            <h1 className="mt-4 text-2xl font-black">Orders need a business</h1>
            <p className="mt-2 text-sm text-[color:var(--text-muted)]">
              Create or claim your business before accepting MealScout orders.
            </p>
            <Button asChild className="mt-6">
              <Link href="/claim-business">Claim a business</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const isFoodTruck =
    selectedBusiness.isFoodTruck || selectedBusiness.businessType === "food_truck";
  const entityType = isFoodTruck
    ? "truck"
    : selectedBusiness.businessType === "bar"
      ? "bar"
      : "restaurant";
  const publicProfileHref = buildPublicProfilePath({
    entityType,
    id: selectedBusiness.id,
    name: selectedBusiness.name,
  });
  const routePath = view === "kitchen" ? "/kitchen" : "/orders";
  const handleBusinessChange = (businessId: string) => {
    setLocation(`${routePath}?restaurantId=${encodeURIComponent(businessId)}`);
  };
  const alternateHref = `${
    view === "kitchen" ? "/orders" : "/kitchen"
  }?restaurantId=${encodeURIComponent(restaurantId)}`;
  const error = view === "kitchen" ? queueQuery.error : historyQuery.error;
  const isLoading =
    view === "kitchen" ? queueQuery.isLoading : historyQuery.isLoading;
  const isUnauthorized = /not authorized|access required|forbidden/i.test(
    String((error as Error | null)?.message || ""),
  );

  const advanceOrder = (order: OwnerOrder) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    statusMutation.mutate({ order, status: next.status });
  };

  return (
    <BusinessWorkspaceShell
      activeModule="work"
      business={selectedBusiness}
      businesses={businesses}
      onBusinessChange={handleBusinessChange}
      publicProfileHref={publicProfileHref}
      headerActions={
        <Button asChild variant="outline" size="sm">
          <Link href={alternateHref}>
            {view === "kitchen" ? (
              <History className="mr-2 h-4 w-4" />
            ) : (
              <ChefHat className="mr-2 h-4 w-4" />
            )}
            {view === "kitchen" ? "Order history" : "Kitchen view"}
          </Link>
        </Button>
      }
    >
      <div
        className="mx-auto w-full max-w-[92rem] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
        data-owner-orders-workspace={view}
      >
        <section className="rounded-[1.75rem] border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50/70 to-white p-5 shadow-clean sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">
                {selectedBusiness.name}
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-[color:var(--text-primary)] sm:text-3xl">
                {view === "kitchen" ? "Kitchen view" : "Orders"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">
                {view === "kitchen"
                  ? "Move active orders from new to ready without losing the customer details or item notes."
                  : "See what needs attention now, then review completed and cancelled orders in the same place."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {view === "kitchen" ? (
                <Badge
                  variant="outline"
                  className={
                    isConnected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-stone-200 bg-white text-stone-600"
                  }
                >
                  {isConnected ? (
                    <Wifi className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <WifiOff className="mr-1 h-3.5 w-3.5" />
                  )}
                  {isConnected ? "Live updates" : "30-second refresh"}
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  view === "kitchen"
                    ? queueQuery.refetch()
                    : historyQuery.refetch()
                }
                disabled={queueQuery.isFetching || historyQuery.isFetching}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    queueQuery.isFetching || historyQuery.isFetching
                      ? "animate-spin"
                      : ""
                  }`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Needs attention", counts.active],
              ["New", counts.new],
              ["Ready", counts.ready],
              ["Completed", counts.completed],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-orange-100 bg-white/90 p-3">
                <p className="text-xs font-semibold text-[color:var(--text-muted)]">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-black text-[color:var(--text-primary)]">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {isUnauthorized ? (
          <Card className="mt-5 border-red-200 bg-red-50">
            <CardContent className="flex items-start gap-3 p-5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
              <div>
                <h3 className="font-black text-red-950">Order access is unavailable</h3>
                <p className="mt-1 text-sm text-red-800">
                  Your account does not have access to orders for this business.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="mt-5 border-red-200 bg-red-50">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                <div>
                  <h3 className="font-black text-red-950">Orders could not be loaded</h3>
                  <p className="mt-1 text-sm text-red-800">
                    {(error as Error).message || "Check your connection and try again."}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  view === "kitchen"
                    ? queueQuery.refetch()
                    : historyQuery.refetch()
                }
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!error && view === "orders" ? (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([
              ["all", "All", orders.length],
              ["active", "Needs attention", counts.active],
              ["completed", "Completed", counts.completed],
              ["cancelled", "Cancelled", counts.cancelled],
            ] as const).map(([value, label, count]) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "default" : "outline"}
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => setFilter(value)}
              >
                {label} {count}
              </Button>
            ))}
          </div>
        ) : null}

        {!error && isLoading ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-56 animate-pulse rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
              />
            ))}
          </div>
        ) : null}

        {!error && !isLoading && orders.length === 0 ? (
          <Card className="mt-6 border-dashed border-orange-200 bg-[var(--bg-surface)]">
            <CardContent className="px-6 py-14 text-center">
              <Receipt className="mx-auto h-11 w-11 text-orange-600" />
              <h3 className="mt-4 text-xl font-black text-[color:var(--text-primary)]">
                No orders yet
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--text-muted)]">
                {view === "kitchen"
                  ? "Active customer orders will appear here automatically."
                  : "When customers place an order from your published menu, it will appear here."}
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href={`/menu-builder?restaurantId=${encodeURIComponent(restaurantId)}`}>
                  Review ordering setup
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!error && !isLoading && view === "orders" && orders.length > 0 ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {filteredOrders.map((order) => (
              <OwnerOrderCard
                key={order.id}
                order={order}
                onAdvance={advanceOrder}
                onCancel={setOrderToCancel}
                isUpdating={statusMutation.isPending}
              />
            ))}
            {filteredOrders.length === 0 ? (
              <Card className="border-dashed border-[color:var(--border-subtle)] lg:col-span-2">
                <CardContent className="p-10 text-center text-sm text-[color:var(--text-muted)]">
                  No orders match this status.
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {!error && !isLoading && view === "orders" && historyQuery.hasNextPage ? (
          <div className="mt-6 text-center">
            <Button
              variant="outline"
              onClick={() => historyQuery.fetchNextPage()}
              disabled={historyQuery.isFetchingNextPage}
            >
              {historyQuery.isFetchingNextPage ? "Loading…" : "Load older orders"}
            </Button>
          </div>
        ) : null}

        {!error && !isLoading && view === "kitchen" && orders.length > 0 ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-3">
            {kitchenColumns.map((column) => {
              const Icon = column.icon;
              return (
                <section key={column.id} aria-labelledby={`kitchen-${column.id}`}>
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <Icon className="h-4 w-4 text-orange-700" />
                    <h3 id={`kitchen-${column.id}`} className="font-black text-[color:var(--text-primary)]">
                      {column.title}
                    </h3>
                    <Badge variant="secondary">{column.orders.length}</Badge>
                  </div>
                  <div className="space-y-4">
                    {column.orders.length > 0 ? (
                      column.orders.map((order) => (
                        <OwnerOrderCard
                          key={order.id}
                          order={order}
                          onAdvance={advanceOrder}
                          onCancel={setOrderToCancel}
                          isUpdating={statusMutation.isPending}
                          compact
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)]/45 p-6 text-center text-sm text-[color:var(--text-muted)]">
                        Nothing here right now.
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={Boolean(orderToCancel)}
        onOpenChange={(open) => {
          if (!open) setOrderToCancel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will see that order #{orderToCancel ? orderNumber(orderToCancel) : ""} was cancelled. This cannot be undone from the order queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (orderToCancel) {
                  statusMutation.mutate({
                    order: orderToCancel,
                    status: "cancelled",
                  });
                }
                setOrderToCancel(null);
              }}
            >
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BusinessWorkspaceShell>
  );
}
