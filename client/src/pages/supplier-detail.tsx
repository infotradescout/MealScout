import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import Navigation from "@/components/navigation";
import { BackHeader } from "@/components/back-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Minus, Plus, Truck } from "lucide-react";
import { SupplierOrderPaymentModal } from "@/components/supply/supplier-order-payment-modal";
import { useAuth } from "@/hooks/useAuth";
import { extractUuidFromSlug } from "@/lib/seo-slug";

type Supplier = {
  id: string;
  businessName: string;
  offersDelivery?: boolean | null;
  deliveryRadiusMiles?: number | null;
  deliveryFeeCents?: number | null;
  deliveryMinOrderCents?: number | null;
  deliveryNotes?: string | null;
  onlinePaymentsEnabled?: boolean | null;
  onlinePaymentsAllowAch?: boolean | null;
  onlinePaymentsAllowCard?: boolean | null;
  onlinePaymentsMinOrderCents?: number | null;
  onlinePaymentsNotes?: string | null;
};

type SupplierProduct = {
  id: string;
  name: string;
  description?: string | null;
  priceCents: number;
  unitLabel?: string | null;
  deliveryEligible?: boolean | null;
};

type Restaurant = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};

const formatMoney = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export default function SupplierDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const supplierParam = params.supplierId || params.slug || "";
  const directSupplierId =
    extractUuidFromSlug(supplierParam) ||
    (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      supplierParam,
    )
      ? supplierParam
      : null);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [pickupNote, setPickupNote] = useState("");
  const [productQ, setProductQ] = useState("");
  const [selectedBuyerRestaurantId, setSelectedBuyerRestaurantId] =
    useState<string>("");
  const [payOrderId, setPayOrderId] = useState<string | null>(null);
  const [requestedFulfillment, setRequestedFulfillment] = useState<
    "pickup" | "delivery"
  >("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPostalCode, setDeliveryPostalCode] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [paymentPreference, setPaymentPreference] = useState<
    "offsite" | "in_person" | "online"
  >("offsite");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const { data: resolvedSupplier } = useQuery<{ id: string; profilePath?: string }>({
    queryKey: ["public-profile-resolve", "supplier", supplierParam],
    enabled: Boolean(supplierParam && !directSupplierId),
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/resolve-profile/supplier/${encodeURIComponent(supplierParam)}`,
        { credentials: "include" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message || "Supplier not found");
      return payload;
    },
  });
  const supplierId = directSupplierId || resolvedSupplier?.id || "";

  const { data: supplier } = useQuery<Supplier>({
    queryKey: ["/api/suppliers", supplierId],
    enabled: Boolean(supplierId),
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${supplierId}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to load supplier");
      return data;
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const { data: products = [], isLoading: isProductsLoading } = useQuery<
    SupplierProduct[]
  >({
    queryKey: ["/api/suppliers", supplierId, "products"],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${supplierId}/products`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load products");
      return res.json();
    },
    enabled: Boolean(supplierId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const filteredProducts = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const desc = String(p.description || "").toLowerCase();
      return name.includes(q) || (desc && desc.includes(q));
    });
  }, [products, productQ]);

  const { data: myRestaurants = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    queryFn: async () => {
      const res = await fetch("/api/restaurants/my-restaurants", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load restaurants");
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    enabled: isAuthenticated,
  });

  const myTrucks = useMemo(
    () => myRestaurants,
    [myRestaurants],
  );

  const userType = String((user as any)?.userType || "").trim();
  const isBuyerBusiness = userType === "restaurant_owner" || userType === "food_truck";
  const canOrder = isAuthenticated;

  useEffect(() => {
    if (!isBuyerBusiness) return;
    if (selectedBuyerRestaurantId) return;
    if (myRestaurants.length === 0) return;
    setSelectedBuyerRestaurantId(myRestaurants[0].id);
  }, [isBuyerBusiness, myRestaurants, selectedBuyerRestaurantId]);

  const selectedBiz = useMemo(() => {
    return myRestaurants.find((r) => r.id === selectedBuyerRestaurantId) || null;
  }, [myRestaurants, selectedBuyerRestaurantId]);

  const { data: myRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/supplier-requests/mine", selectedBuyerRestaurantId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBuyerRestaurantId) params.set("buyerRestaurantId", selectedBuyerRestaurantId);
      const q = params.toString();
      const res = await fetch(`/api/supplier-requests/mine${q ? `?${q}` : ""}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to load requests");
      return data;
    },
    staleTime: 10_000,
    enabled: isAuthenticated,
  });

  const myRequestsForSupplier = useMemo(() => {
    const rows = Array.isArray(myRequests) ? myRequests : [];
    return rows
      .filter((r) => String(r?.supplierId || "") === String(supplierId || ""))
      .slice(0, 8);
  }, [myRequests, supplierId]);

  useEffect(() => {
    if (requestedFulfillment !== "delivery") return;
    if (!selectedBiz) return;
    setDeliveryAddress((prev) => prev || String(selectedBiz.address || ""));
    setDeliveryCity((prev) => prev || String(selectedBiz.city || ""));
    setDeliveryState((prev) => prev || String(selectedBiz.state || ""));
  }, [requestedFulfillment, selectedBiz]);

  const cartItems = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = Object.entries(quantities)
      .map(([productId, quantity]) => ({
        product: byId.get(productId) || null,
        productId,
        quantity,
      }))
      .filter((row) => row.product && row.quantity > 0) as Array<{
      product: SupplierProduct;
      productId: string;
      quantity: number;
    }>;
    return items;
  }, [quantities, products]);

  const undeliverableCartItems = useMemo(() => {
    if (requestedFulfillment !== "delivery") return [];
    return cartItems.filter((i) => i.product.deliveryEligible === false);
  }, [cartItems, requestedFulfillment]);

  const subtotalCents = useMemo(() => {
    return cartItems.reduce(
      (sum, item) => sum + item.quantity * Number(item.product.priceCents || 0),
      0,
    );
  }, [cartItems]);

  const deliveryFeeCents = useMemo(() => {
    if (requestedFulfillment !== "delivery") return 0;
    return Number(supplier?.deliveryFeeCents || 0) || 0;
  }, [requestedFulfillment, supplier]);

  const estimatedTotalCents = subtotalCents + deliveryFeeCents;
  const deliveryMinOrderCents = Number(supplier?.deliveryMinOrderCents || 0) || 0;
  const deliveryMinMet = deliveryMinOrderCents <= 0 || subtotalCents >= deliveryMinOrderCents;
  const deliveryAddressOk =
    Boolean(deliveryAddress.trim()) &&
    Boolean(deliveryCity.trim()) &&
    Boolean(deliveryState.trim());
  const canRequestDelivery =
    Boolean(supplier?.offersDelivery) && deliveryMinMet && deliveryAddressOk;

  const deliveryEligibilityMet =
    requestedFulfillment !== "delivery" || undeliverableCartItems.length === 0;

  const canRequestDeliveryFull =
    canRequestDelivery && deliveryEligibilityMet;
  const supplierAllowsAch = Boolean(supplier?.onlinePaymentsAllowAch ?? true);
  const supplierAllowsCard = Boolean(supplier?.onlinePaymentsAllowCard ?? true);
  const supplierOnlineMethodsEnabled = supplierAllowsAch || supplierAllowsCard;
  const onlineMinOrderCents = Number(supplier?.onlinePaymentsMinOrderCents || 0) || 0;
  const onlineMinMet = onlineMinOrderCents <= 0 || estimatedTotalCents >= onlineMinOrderCents;
  const onlineEnabledForBuyer =
    Boolean(supplier?.onlinePaymentsEnabled) && supplierOnlineMethodsEnabled;
  const onlineSelectionValid =
    paymentPreference !== "online" || (onlineEnabledForBuyer && onlineMinMet);

  useEffect(() => {
    if (paymentPreference !== "online") return;
    if (onlineEnabledForBuyer && onlineMinMet) return;
    setPaymentPreference("offsite");
  }, [paymentPreference, onlineEnabledForBuyer, onlineMinMet]);

  const submitRequest = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/supplier-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          ...(selectedBuyerRestaurantId ? { buyerRestaurantId: selectedBuyerRestaurantId } : {}),
          requestedFulfillment,
          paymentPreference,
          note: pickupNote.trim() || null,
          deliveryInstructions:
            requestedFulfillment === "delivery"
              ? deliveryInstructions.trim() || null
              : null,
          deliveryAddress:
            requestedFulfillment === "delivery"
              ? deliveryAddress.trim() || null
              : null,
          deliveryCity:
            requestedFulfillment === "delivery" ? deliveryCity.trim() || null : null,
          deliveryState:
            requestedFulfillment === "delivery" ? deliveryState.trim() || null : null,
          deliveryPostalCode:
            requestedFulfillment === "delivery"
              ? deliveryPostalCode.trim() || null
              : null,
          items: cartItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to submit request");
      return data;
    },
    onSuccess: () => {
      setQuantities({});
      setPickupNote("");
      setDeliveryInstructions("");
      toast({
        title: "Request sent",
        description: "Your request was sent to the supplier.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Request failed",
        description: error?.message || "Unable to send request",
        variant: "destructive",
      });
    },
  });

  const importRequest = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error("Select a file");
      const form = new FormData();
      form.set("file", importFile);
      form.set("supplierId", String(supplierId || ""));
      if (selectedBuyerRestaurantId) form.set("buyerRestaurantId", selectedBuyerRestaurantId);
      form.set("requestedFulfillment", requestedFulfillment);
      form.set("paymentPreference", paymentPreference);
      form.set("note", pickupNote.trim());
      if (requestedFulfillment === "delivery") {
        form.set("deliveryInstructions", deliveryInstructions.trim());
        form.set("deliveryAddress", deliveryAddress.trim());
        form.set("deliveryCity", deliveryCity.trim());
        form.set("deliveryState", deliveryState.trim());
        form.set("deliveryPostalCode", deliveryPostalCode.trim());
      }

      const res = await fetch("/api/supplier-requests/import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to import request");
      return data;
    },
    onSuccess: (data: any) => {
      setImportFile(null);
      setQuantities({});
      toast({
        title: "Request imported",
        description: `Created request with ${Number(data?.items ?? 0)} items.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error?.message || "Unable to import request",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen pb-24">
      <h1 className="sr-only">
        {supplier?.businessName ? `${supplier.businessName} supplies` : "Supplier supplies"}
      </h1>
      <BackHeader
        title={supplier?.businessName || "Supplier"}
        fallbackHref="/suppliers"
      />

      <div className="px-4 space-y-4">
        {!canOrder && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Sign in to place an order or request supplies. You can browse products without an account.
              <div className="pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/login";
                  }}
                >
                  Sign in
                </Button>
                <Button
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    window.location.href = "/customer-signup";
                  }}
                >
                  Create account
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {canOrder && myRestaurants.length === 0 && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Ordering as an individual. Add a restaurant or food truck profile to keep orders separated by business.
              <div className="pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/restaurant-signup";
                  }}
                >
                  Create my business profile
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {canOrder ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Your requests</CardTitle>
              <CardDescription>
                Track accepted requests and pay online when available.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {myRequestsForSupplier.length === 0 ? (
                <div className="text-sm text-muted-foreground">No requests yet.</div>
              ) : (
                myRequestsForSupplier.map((r) => (
                  <div key={r.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {String(r.status || "submitted")}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {String(r.requestedFulfillment || "pickup")} - {String(r.paymentPreference || "offsite")}
                      </div>
                    </div>
                    {String(r.status) === "accepted" && r.orderId && String(r.paymentPreference) === "online" ? (
                      <Button size="sm" className="w-full sm:w-auto" onClick={() => setPayOrderId(String(r.orderId))}>
                        Pay
                      </Button>
                    ) : (
                      <Badge variant="secondary">{String(r.status || "submitted")}</Badge>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Request settings</CardTitle>
            <CardDescription>
              Business-first: pick a restaurant or truck profile if you have one. Individuals can still request supplies.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant="secondary">Pickup</Badge>
              {supplier?.offersDelivery ? (
                <Badge variant="secondary" className="gap-1">
                  <Truck className="h-3.5 w-3.5" />
                  Delivery available
                </Badge>
              ) : null}
              {supplier?.offersDelivery && (supplier.deliveryFeeCents || 0) > 0 ? (
                <Badge variant="outline">
                  Delivery fee {formatMoney(Number(supplier.deliveryFeeCents || 0))}
                </Badge>
              ) : null}
              {supplier?.offersDelivery && (supplier.deliveryMinOrderCents || 0) > 0 ? (
                <Badge variant="outline">
                  Min {formatMoney(Number(supplier.deliveryMinOrderCents || 0))}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="text-sm font-semibold">Your business</div>
            {myTrucks.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Ordering as a personal buyer (no business profile).
              </div>
            ) : (
              <select
                className="w-full border rounded px-2 py-2 text-sm bg-background"
                value={selectedBuyerRestaurantId}
                onChange={(e) => setSelectedBuyerRestaurantId(e.target.value)}
              >
                <option value="">Select a business...</option>
                {myTrucks.map((biz) => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name}
                  </option>
                ))}
              </select>
            )}

            <div className="text-sm font-semibold">Fulfillment</div>
            <select
              className="w-full border rounded px-2 py-2 text-sm bg-background"
              value={requestedFulfillment}
              onChange={(e) =>
                setRequestedFulfillment(e.target.value as "pickup" | "delivery")
              }
              disabled={!supplier?.offersDelivery}
            >
              <option value="pickup">Pickup</option>
              <option
                value="delivery"
                disabled={
                  !supplier?.offersDelivery || !deliveryMinMet || undeliverableCartItems.length > 0
                }
              >
                Delivery
              </option>
            </select>
            {supplier?.offersDelivery ? (
              <div className="text-xs text-muted-foreground">
                Delivery fee: {formatMoney(Number(supplier.deliveryFeeCents || 0))}
                {supplier.deliveryMinOrderCents ? (
                  <>
                    {" "}
                    - Min order:{" "}
                    {formatMoney(Number(supplier.deliveryMinOrderCents || 0))}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                This supplier currently offers pickup only.
              </div>
            )}
            {supplier?.offersDelivery && !deliveryMinMet ? (
              <div className="text-xs text-muted-foreground">
                Add {formatMoney(deliveryMinOrderCents - subtotalCents)} more to meet the delivery minimum.
              </div>
            ) : null}

            {requestedFulfillment === "delivery" ? (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Delivery address</div>
                <Input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Street address"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={deliveryCity}
                    onChange={(e) => setDeliveryCity(e.target.value)}
                    placeholder="City"
                  />
                  <Input
                    value={deliveryState}
                    onChange={(e) => setDeliveryState(e.target.value)}
                    placeholder="State"
                  />
                </div>
                <Input
                  value={deliveryPostalCode}
                  onChange={(e) => setDeliveryPostalCode(e.target.value)}
                  placeholder="Postal code (optional)"
                />
                <div className="text-sm font-semibold">Delivery instructions</div>
                <Input
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  placeholder="Gate code, contact name, etc. (optional)"
                />
                {supplier?.deliveryNotes ? (
                  <div className="text-xs text-muted-foreground">
                    Supplier notes: {supplier.deliveryNotes}
                  </div>
                ) : null}
                {undeliverableCartItems.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Some items in your cart are pickup-only from this supplier:{" "}
                    {undeliverableCartItems
                      .slice(0, 5)
                      .map((i) => i.product.name)
                      .join(", ")}
                    {undeliverableCartItems.length > 5 ? "…" : ""}.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="text-sm font-semibold">Payment preference</div>
            <select
              className="w-full border rounded px-2 py-2 text-sm bg-background"
              value={paymentPreference}
              onChange={(e) =>
                setPaymentPreference(
                  e.target.value as "offsite" | "in_person" | "online",
                )
              }
            >
              <option value="offsite">Pay offsite</option>
              <option value="in_person">Pay in person</option>
              <option value="online" disabled={!onlineEnabledForBuyer}>
                Pay through MealScout
              </option>
            </select>
            {onlineEnabledForBuyer ? (
              <div className="text-xs text-muted-foreground">
                Online methods:
                {" "}
                {[
                  supplierAllowsAch ? "ACH" : null,
                  supplierAllowsCard ? "Card" : null,
                ]
                  .filter(Boolean)
                  .join(" + ")}
                {onlineMinOrderCents > 0 ? ` • Minimum ${formatMoney(onlineMinOrderCents)}` : ""}
              </div>
            ) : null}
            {paymentPreference === "online" && !onlineEnabledForBuyer ? (
              <div className="text-xs text-muted-foreground">
                This supplier isn't accepting online payments yet.
              </div>
            ) : null}
            {paymentPreference === "online" && !onlineMinMet ? (
              <div className="text-xs text-muted-foreground">
                Add {formatMoney(onlineMinOrderCents - estimatedTotalCents)} more to use online payment.
              </div>
            ) : null}
            <div className="text-sm font-semibold">Pickup note</div>
            <Input
              value={pickupNote}
              onChange={(e) => setPickupNote(e.target.value)}
              placeholder="Optional note for the supplier"
            />
            <div className="text-xs text-muted-foreground">
              Estimated total: {formatMoney(estimatedTotalCents)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Upload an order sheet</CardTitle>
            <CardDescription>
              CSV/TSV/XLSX with columns like <code>sku</code> or <code>name</code> and{" "}
              <code>quantity</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <input
              type="file"
              accept=".csv,.tsv,.xlsx"
              className="w-full text-sm"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={
                importRequest.isPending ||
                !importFile ||
                !selectedBuyerRestaurantId ||
                (requestedFulfillment === "delivery" && !canRequestDeliveryFull) ||
                !onlineSelectionValid
              }
              onClick={() => importRequest.mutate()}
            >
              {importRequest.isPending ? "Importing..." : "Import to cart"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg">Products</CardTitle>
                <CardDescription>
                  Search and add quantities to build your request.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {filteredProducts.length}/{products.length}
              </Badge>
            </div>
            <div className="pt-2">
              <Input
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
                placeholder="Search this catalog…"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isProductsLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : products.length === 0 ? (
              <div className="text-sm text-muted-foreground">No products available.</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No matches for <span className="font-medium">{productQ.trim()}</span>.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredProducts.map((product) => {
                  const qty = quantities[product.id] || 0;
                  const pickupOnly = product.deliveryEligible === false;
                  return (
                    <div key={product.id} className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatMoney(product.priceCents)}
                            {product.unitLabel ? ` / ${product.unitLabel}` : ""}
                          </div>
                        </div>
                        {pickupOnly ? (
                          <Badge variant="outline" className="shrink-0">
                            Pickup only
                          </Badge>
                        ) : null}
                      </div>

                      {product.description ? (
                        <div className="text-xs text-muted-foreground">
                          {product.description}
                        </div>
                      ) : null}

                      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-muted-foreground">Quantity</div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setQuantities((prev) => ({
                                ...prev,
                                [product.id]: Math.max(0, (prev[product.id] || 0) - 1),
                              }))
                            }
                            disabled={qty <= 0}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            value={qty}
                            onChange={(e) => {
                              const next = Math.max(0, Math.floor(Number(e.target.value || 0)));
                              setQuantities((prev) => ({
                                ...prev,
                                [product.id]: Number.isFinite(next) ? next : 0,
                              }));
                            }}
                            className="w-16 text-center sm:w-20"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setQuantities((prev) => ({
                                ...prev,
                                [product.id]: (prev[product.id] || 0) + 1,
                              }))
                            }
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Subtotal</div>
              <div className="text-lg font-semibold">{formatMoney(subtotalCents)}</div>
            </div>
            <Button
              className="w-full sm:w-auto"
              disabled={
                submitRequest.isPending ||
                cartItems.length === 0 ||
                subtotalCents <= 0 ||
                (requestedFulfillment === "delivery" && !canRequestDeliveryFull) ||
                !onlineSelectionValid
              }
              onClick={() => submitRequest.mutate()}
            >
              {submitRequest.isPending ? "Sending..." : "Send request"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Navigation />

      {payOrderId ? (
        <SupplierOrderPaymentModal
          open={Boolean(payOrderId)}
          orderId={payOrderId}
          onOpenChange={(open) => {
            if (!open) setPayOrderId(null);
          }}
          onPaid={() => {
            toast({ title: "Payment received" });
            queryClient.invalidateQueries({ queryKey: ["/api/supplier-requests/mine"] });
            queryClient.invalidateQueries({ queryKey: ["/api/supplier-requests/mine", selectedBuyerRestaurantId] });
          }}
        />
      ) : null}
    </div>
  );
}
