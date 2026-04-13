/**
 * Kitchen Display System (KDS)
 * Real-time WebSocket-connected order queue for kitchen staff.
 * Mobile-first, auto-refreshes on new orders via Socket.IO.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "@/lib/api";
import {
  Clock,
  CheckCircle,
  ChefHat,
  Bell,
  Loader2,
  RefreshCw,
  Package,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

const ORDER_STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  confirmed: "bg-blue-100 text-blue-800 border-blue-300",
  preparing: "bg-orange-100 text-orange-800 border-orange-300",
  ready: "bg-green-100 text-green-800 border-green-300",
  completed: "bg-gray-100 text-gray-600 border-gray-300",
  cancelled: "bg-red-100 text-red-700 border-red-300",
};

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

interface OrderItem {
  id: string;
  itemName: string;
  quantity: number;
  variantLabel: string | null;
  modifierLabels: string[] | null;
  lineTotalCents: number;
  specialInstructions: string | null;
}

interface KitchenOrder {
  id: string;
  restaurantId: string;
  customerName: string;
  orderType: "pickup" | "dine_in";
  status: string;
  subtotalCents: number;
  totalCents: number;
  paymentMethod: "card" | "cash";
  scheduledFor: string | null;
  confirmedAt: string | null;
  createdAt: string;
  prepTimeMinutes: number | null;
  specialInstructions: string | null;
  items: OrderItem[];
}

function useRestaurantId(): string | null {
  const { user } = useAuth();
  return (user as any)?.restaurantId ?? null;
}

const ENABLE_SOCKETS = import.meta.env.VITE_ENABLE_SOCKETS === "true";

export default function KitchenDisplayPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<boolean>(false);

  // Initial fetch
  const queueQuery = useQuery<KitchenOrder[]>({
    queryKey: ["/api/owner/kitchen-queue", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const res = await fetch(
        `/api/owner/kitchen-queue/${encodeURIComponent(restaurantId)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load kitchen queue");
      return res.json();
    },
    enabled: !!restaurantId,
    refetchInterval: 30_000, // fallback polling every 30s
  });

  useEffect(() => {
    if (queueQuery.data) {
      setOrders(queueQuery.data);
    }
  }, [queueQuery.data]);

  // WebSocket subscription
  useEffect(() => {
    if (!restaurantId || !ENABLE_SOCKETS) return;

    const socketUrl = import.meta.env.DEV ? undefined : (API_BASE_URL || undefined);
    const socket: Socket = io(socketUrl as string, {
      autoConnect: true,
      transports: ["polling", "websocket"],
      withCredentials: true,
      path: "/socket.io",
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("subscribe_kitchen", { restaurantId });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("kitchen:order_update", (payload: { order: KitchenOrder }) => {
      const updatedOrder = payload.order;
      setOrders((prev) => {
        const existing = prev.find((o) => o.id === updatedOrder.id);
        if (existing) {
          // Update in place
          return prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
        } else if (ACTIVE_STATUSES.includes(updatedOrder.status)) {
          // New order — play notification sound via vibration on mobile
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
          return [updatedOrder, ...prev];
        }
        return prev;
      });
      // Remove completed/cancelled orders from active queue
      if (!ACTIVE_STATUSES.includes(updatedOrder.status)) {
        setOrders((prev) => prev.filter((o) => o.id !== updatedOrder.id));
      }
    });

    return () => {
      socket.emit("unsubscribe_kitchen", { restaurantId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/owner/orders/${orderId}/status`, { status });
      return res.json();
    },
    onSuccess: (updatedOrder: KitchenOrder) => {
      setOrders((prev) => {
        if (!ACTIVE_STATUSES.includes(updatedOrder.status)) {
          return prev.filter((o) => o.id !== updatedOrder.id);
        }
        return prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const nextStatus: Record<string, string> = {
    pending: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ready: "completed",
  };

  const nextLabel: Record<string, string> = {
    pending: "Confirm Order",
    confirmed: "Start Preparing",
    preparing: "Mark Ready",
    ready: "Mark Completed",
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No restaurant linked to your account.</p>
        </div>
      </div>
    );
  }

  const pendingOrders = orders.filter((o) => o.status === "pending");
  const activeOrders = orders.filter((o) => ["confirmed", "preparing"].includes(o.status));
  const readyOrders = orders.filter((o) => o.status === "ready");

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ChefHat className="w-7 h-7" />
            <div>
              <h1 className="text-xl font-bold">Kitchen Display</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                {isConnected ? "Live updates connected" : "Polling (not live)"}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queueQuery.refetch()}
            disabled={queueQuery.isFetching}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${queueQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {queueQuery.isError && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span className="text-sm text-destructive">Failed to load orders. Check your connection.</span>
          </div>
        )}

        {orders.length === 0 && !queueQuery.isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="w-12 h-12 text-muted-foreground mb-3" />
            <h3 className="font-medium text-lg">No active orders</h3>
            <p className="text-muted-foreground text-sm">New orders will appear here automatically.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Column 1: New */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-amber-600" />
              <h2 className="font-semibold text-amber-800">
                New Orders
                {pendingOrders.length > 0 && (
                  <Badge className="ml-2 bg-amber-500 text-white">{pendingOrders.length}</Badge>
                )}
              </h2>
            </div>
            <div className="space-y-3">
              {pendingOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  nextStatusLabel={nextLabel[order.status] ?? ""}
                  onAdvance={() =>
                    updateStatusMutation.mutate({
                      orderId: order.id,
                      status: nextStatus[order.status],
                    })
                  }
                  onCancel={() =>
                    updateStatusMutation.mutate({ orderId: order.id, status: "cancelled" })
                  }
                  isUpdating={updateStatusMutation.isPending}
                />
              ))}
            </div>
          </div>

          {/* Column 2: In Progress */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-orange-600" />
              <h2 className="font-semibold text-orange-800">
                In Progress
                {activeOrders.length > 0 && (
                  <Badge className="ml-2 bg-orange-500 text-white">{activeOrders.length}</Badge>
                )}
              </h2>
            </div>
            <div className="space-y-3">
              {activeOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  nextStatusLabel={nextLabel[order.status] ?? ""}
                  onAdvance={() =>
                    updateStatusMutation.mutate({
                      orderId: order.id,
                      status: nextStatus[order.status],
                    })
                  }
                  onCancel={() =>
                    updateStatusMutation.mutate({ orderId: order.id, status: "cancelled" })
                  }
                  isUpdating={updateStatusMutation.isPending}
                />
              ))}
            </div>
          </div>

          {/* Column 3: Ready */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <h2 className="font-semibold text-green-800">
                Ready for Pickup
                {readyOrders.length > 0 && (
                  <Badge className="ml-2 bg-green-500 text-white">{readyOrders.length}</Badge>
                )}
              </h2>
            </div>
            <div className="space-y-3">
              {readyOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  nextStatusLabel={nextLabel[order.status] ?? ""}
                  onAdvance={() =>
                    updateStatusMutation.mutate({
                      orderId: order.id,
                      status: nextStatus[order.status],
                    })
                  }
                  onCancel={() =>
                    updateStatusMutation.mutate({ orderId: order.id, status: "cancelled" })
                  }
                  isUpdating={updateStatusMutation.isPending}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── OrderCard ────────────────────────────────────
function OrderCard({
  order,
  nextStatusLabel,
  onAdvance,
  onCancel,
  isUpdating,
}: {
  order: KitchenOrder;
  nextStatusLabel: string;
  onAdvance: () => void;
  onCancel: () => void;
  isUpdating: boolean;
}) {
  const colorClass = ORDER_STATUS_COLOR[order.status] ?? ORDER_STATUS_COLOR.pending;
  const timeAgo = formatDistanceToNow(new Date(order.createdAt), { addSuffix: true });
  const orderNum = order.id.slice(-6).toUpperCase();

  return (
    <Card className={`border-2 ${order.status === "pending" ? "border-amber-400 shadow-amber-100 shadow-md" : "border-border"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-bold text-base">#{orderNum}</span>
            <span className="ml-2 text-sm text-muted-foreground">{order.customerName}</span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge className={`text-xs px-1.5 py-0 ${colorClass}`}>
              {ORDER_STATUS_LABEL[order.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          <Badge variant="outline" className="text-xs">
            {order.orderType === "dine_in" ? "Dine In" : "Pickup"}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">
            {order.paymentMethod === "cash" ? "💵 Cash" : "💳 Card"}
          </Badge>
          {order.scheduledFor && (
            <Badge variant="outline" className="text-xs">
              ⏰ {new Date(order.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {/* Items */}
        <div className="space-y-1.5 mb-3">
          {order.items.map((item) => (
            <div key={item.id} className="text-sm">
              <div className="flex gap-2">
                <span className="font-semibold text-base w-5 text-right shrink-0">{item.quantity}×</span>
                <div className="flex-1">
                  <span className="font-medium">{item.itemName}</span>
                  {item.variantLabel && (
                    <span className="text-muted-foreground text-xs"> · {item.variantLabel}</span>
                  )}
                  {item.modifierLabels && item.modifierLabels.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      + {item.modifierLabels.join(", ")}
                    </div>
                  )}
                  {item.specialInstructions && (
                    <div className="text-xs italic text-orange-700 mt-0.5">
                      Note: {item.specialInstructions}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {order.specialInstructions && (
          <div className="text-xs italic text-orange-700 bg-orange-50 rounded p-2 mb-3">
            Order note: {order.specialInstructions}
          </div>
        )}

        {/* Actions */}
        {nextStatusLabel && order.status !== "completed" && order.status !== "cancelled" && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={onAdvance}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : nextStatusLabel}
            </Button>
            {order.status === "pending" && (
              <Button
                size="sm"
                variant="destructive"
                onClick={onCancel}
                disabled={isUpdating}
                className="px-3"
              >
                ✕
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
