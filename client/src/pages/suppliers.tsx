import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription as DialogDescriptionUI,
  DialogFooter,
  DialogHeader as DialogHeaderUI,
  DialogTitle as DialogTitleUI,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { fetchJsonWithRetry } from "@/lib/resilientFetch";
import {
  Building2,
  Calculator,
  SlidersHorizontal,
  Upload,
  Zap,
} from "lucide-react";
import { ShoppingListsDialog } from "@/components/supply/shopping-lists-dialog";

type Supplier = {
  id: string;
  businessName: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  isActive?: boolean | null;
  offersDelivery?: boolean | null;
  deliveryFeeCents?: number | null;
  deliveryMinOrderCents?: number | null;
};

type Restaurant = {
  id: string;
  name: string;
};

type SupplySearchRow = {
  product: {
    id: string;
    supplierId: string;
    name: string;
    sku?: string | null;
    description?: string | null;
    priceCents: number;
    unitLabel?: string | null;
  };
  supplier: Supplier;
  distanceMiles?: number | null;
};

type SupplyPreferences = {
  id: string;
  maxStops: number;
  maxRadiusMiles: number;
  costPerStopCents: number;
  stopMinutes: number;
  costPerMinuteCents: number;
  pingSuppliers: boolean;
  allowSubstitutions: boolean;
};

type PriceWatch = {
  id: string;
  buyerRestaurantId?: string | null;
  itemKey: string;
  itemName: string;
  targetPriceCents?: number | null;
  maxRadiusMiles: number;
  currentBest?: {
    unitPriceCents: number;
    observedAt?: string | null;
    storeName?: string | null;
    storeCity?: string | null;
    storeState?: string | null;
    distanceMiles?: number | null;
  } | null;
  targetMet?: boolean;
  updatedAt?: string;
};

type PriceWatchAlert = {
  id: string;
  watchId?: string | null;
  itemName: string;
  message: string;
  observedPriceCents?: number | null;
  baselinePriceCents?: number | null;
  storeName?: string | null;
  createdAt?: string | null;
};

type OrderListOffer = {
  supplierId: string;
  supplierName: string;
  supplier: Supplier;
  productId: string;
  productName: string;
  sku?: string | null;
  unitLabel?: string | null;
  priceCents: number;
  distanceMiles?: number | null;
};

type OrderListItem = {
  query: string;
  itemName?: string | null;
  sku?: string | null;
  quantity: number;
  offers: OrderListOffer[];
};

type OrderListSupplierAgg = {
  supplierId: string;
  supplier: Supplier;
  coverageCount: number;
  missingCount: number;
  subtotalCents: number;
};

type OrderListPlan = {
  type: "one_stop" | "two_stop";
  supplierIds: string[];
  suppliers: Supplier[];
  subtotalCents: number;
  stopCostCents: number;
  totalCents: number;
};

type OrderListImportResult = {
  success: true;
  itemCount: number;
  items: OrderListItem[];
  suppliers: OrderListSupplierAgg[];
  plan: OrderListPlan | null;
  preferencesUsed: {
    maxStops: number;
    maxRadiusMiles: number;
    stopMinutes: number;
    costPerMinuteCents: number;
    costPerStopCents: number;
    pingSuppliers: boolean;
    allowSubstitutions: boolean;
  };
  truncated: boolean;
};

const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;
const formatMiles = (miles: number) =>
  `${Number(miles).toFixed(miles < 10 ? 1 : 0)} mi`;
const safeText = (v: string | null | undefined, fallback = "Unknown") => {
  const s = String(v || "").trim();
  return s.length > 0 ? s : fallback;
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<"catalog" | "import" | "watch">("catalog");
  const [q, setQ] = useState("");
  const [orderListFile, setOrderListFile] = useState<File | null>(null);
  const [selectedBuyerRestaurantId, setSelectedBuyerRestaurantId] =
    useState<string>("");
  const [watchItemName, setWatchItemName] = useState("");
  const [watchTargetPriceDollars, setWatchTargetPriceDollars] = useState("");
  const [watchRadiusMiles, setWatchRadiusMiles] = useState("25");
  const [importResult, setImportResult] =
    useState<OrderListImportResult | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [prefsDialogOpen, setPrefsDialogOpen] = useState(false);

  const userType = String((user as any)?.userType || "").trim();
  const isSupplierUser = userType === "supplier";
  const isBuyerBusiness =
    userType === "restaurant_owner" || userType === "food_truck";
  const canUseBuyerTools = isAuthenticated && !isSupplierUser;

  const { data: supplierProfile } = useQuery<Supplier | null>({
    queryKey: ["/api/supplier/me", "presence"],
    queryFn: async () => {
      const res = await fetch("/api/supplier/me", { credentials: "include" });
      if ([401, 403, 404].includes(res.status)) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || "Failed to load supplier profile");
      return data as Supplier;
    },
    enabled: isAuthenticated && !isSupplierUser,
    retry: false,
    staleTime: 30_000,
  });
  const hasSupplierProfile = Boolean(supplierProfile?.id);

  const activateSupplierProfile = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/supplier/profile/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || "Failed to create supplier profile");
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Supplier profile created",
        description: "Opening your supplier dashboard.",
      });
      window.location.href = "/supplier/dashboard";
    },
    onError: (error: any) => {
      toast({
        title: "Unable to create supplier profile",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const { data: prefs } = useQuery<SupplyPreferences>({
    queryKey: ["/api/supply/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/supply/preferences", {
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || "Failed to load preferences");
      return data;
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    enabled: canUseBuyerTools,
  });

  const [prefsDraft, setPrefsDraft] = useState<Partial<SupplyPreferences>>({});
  useEffect(() => {
    if (!prefs) return;
    setPrefsDraft({
      maxStops: prefs.maxStops,
      maxRadiusMiles: prefs.maxRadiusMiles,
      costPerStopCents: prefs.costPerStopCents,
      stopMinutes: prefs.stopMinutes,
      costPerMinuteCents: prefs.costPerMinuteCents,
      pingSuppliers: prefs.pingSuppliers,
      allowSubstitutions: prefs.allowSubstitutions,
    });
  }, [prefs]);

  const {
    data: suppliers = [],
    isLoading,
    isError,
  } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

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
    enabled: canUseBuyerTools,
  });

  useEffect(() => {
    // Business-first: default to the first business profile when the user is a business buyer.
    if (!isBuyerBusiness) return;
    if (!selectedBuyerRestaurantId && myRestaurants.length > 0) {
      setSelectedBuyerRestaurantId(myRestaurants[0].id);
    }
  }, [isBuyerBusiness, myRestaurants, selectedBuyerRestaurantId]);

  const trimmedQ = q.trim();
  const showSearch = trimmedQ.length > 0;

  const { data: supplyMatches = [], isLoading: isSearchLoading } = useQuery<
    SupplySearchRow[]
  >({
    queryKey: ["/api/supply/search", trimmedQ, selectedBuyerRestaurantId],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmedQ });
      if (selectedBuyerRestaurantId) {
        params.set("buyerRestaurantId", selectedBuyerRestaurantId);
      }
      const res = await fetch(`/api/supply/search?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to search supply");
      return res.json();
    },
    enabled: canUseBuyerTools && showSearch,
    staleTime: 15_000,
  });

  const groupedMatches = useMemo(() => {
    const bySupplier = new Map<
      string,
      { supplier: Supplier; rows: SupplySearchRow[] }
    >();
    for (const row of supplyMatches) {
      const supplierId = row.supplier.id;
      const existing = bySupplier.get(supplierId);
      if (!existing)
        bySupplier.set(supplierId, { supplier: row.supplier, rows: [row] });
      else existing.rows.push(row);
    }
    const out = Array.from(bySupplier.values());
    out.sort((a, b) => {
      const aDistance =
        a.rows
          .map((r) => r.distanceMiles)
          .filter(
            (d): d is number => typeof d === "number" && Number.isFinite(d),
          )
          .sort((x, y) => x - y)[0] ?? Number.POSITIVE_INFINITY;
      const bDistance =
        b.rows
          .map((r) => r.distanceMiles)
          .filter(
            (d): d is number => typeof d === "number" && Number.isFinite(d),
          )
          .sort((x, y) => x - y)[0] ?? Number.POSITIVE_INFINITY;

      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return String(a.supplier.businessName || "").localeCompare(
        String(b.supplier.businessName || ""),
      );
    });
    return out;
  }, [supplyMatches]);
  const topMatch = groupedMatches[0] ?? null;
  const totalMatchedProducts = useMemo(
    () => groupedMatches.reduce((sum, g) => sum + g.rows.length, 0),
    [groupedMatches],
  );

  const savePreferences = useMutation({
    mutationFn: async () => {
      if (!canUseBuyerTools) {
        throw new Error("Please log in to save supply preferences.");
      }
      const body: any = {};
      const pickNum = (v: any) =>
        v === "" || v === null || v === undefined ? undefined : v;
      if (prefsDraft.maxStops !== undefined)
        body.maxStops = pickNum(prefsDraft.maxStops);
      if (prefsDraft.maxRadiusMiles !== undefined)
        body.maxRadiusMiles = pickNum(prefsDraft.maxRadiusMiles);
      if (prefsDraft.costPerStopCents !== undefined)
        body.costPerStopCents = pickNum(prefsDraft.costPerStopCents);
      if (prefsDraft.stopMinutes !== undefined)
        body.stopMinutes = pickNum(prefsDraft.stopMinutes);
      if (prefsDraft.costPerMinuteCents !== undefined)
        body.costPerMinuteCents = pickNum(prefsDraft.costPerMinuteCents);
      if (prefsDraft.pingSuppliers !== undefined)
        body.pingSuppliers = Boolean(prefsDraft.pingSuppliers);
      if (prefsDraft.allowSubstitutions !== undefined)
        body.allowSubstitutions = Boolean(prefsDraft.allowSubstitutions);

      const res = await fetch("/api/supply/preferences", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || "Failed to save preferences");
      return data as SupplyPreferences;
    },
    onSuccess: () => {
      toast({ title: "Preferences saved" });
      setPrefsDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save preferences",
        variant: "destructive",
      });
    },
  });

  const requestDemand = useMutation({
    mutationFn: async () => {
      if (!canUseBuyerTools) {
        throw new Error("Please log in to request an item.");
      }
      const res = await fetch("/api/supply/demand", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedBuyerRestaurantId
            ? { buyerRestaurantId: selectedBuyerRestaurantId }
            : {}),
          itemName: trimmedQ,
          quantity: null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to request item");
      return data;
    },
    onSuccess: (data: any) => {
      const notified = Number(data?.notified || 0) || 0;
      const reason = String(data?.reason || "");
      if (reason === "already_listed") {
        toast({ title: "Already listed", description: "Try searching again." });
        return;
      }
      toast({
        title: "Requested",
        description:
          notified > 0
            ? `We notified ${notified} local supplier(s).`
            : "We recorded demand for this item.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Request failed",
        description: error?.message || "Unable to request item",
        variant: "destructive",
      });
    },
  });

  const importOrderList = useMutation({
    mutationFn: async () => {
      if (!canUseBuyerTools) {
        throw new Error("Please log in to import an order list.");
      }
      if (!orderListFile) throw new Error("Choose an order list file first.");
      const form = new FormData();
      form.append("file", orderListFile);
      if (selectedBuyerRestaurantId)
        form.append("buyerRestaurantId", selectedBuyerRestaurantId);
      const res = await fetch("/api/supply/order-list/import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || "Failed to import order list");
      return data as OrderListImportResult;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setImportDialogOpen(true);
      const suppliersOut = Array.isArray(data?.suppliers) ? data.suppliers : [];
      if (suppliersOut.length === 0) {
        toast({
          title: "Imported",
          description: "No matching supplier deals found for that list yet.",
        });
        return;
      }
      const top = suppliersOut[0];
      toast({
        title: "Best match found",
        description: `${top?.supplier?.businessName || "Supplier"} can fulfill ${top.coverageCount} item(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error?.message || "Unable to import order list",
        variant: "destructive",
      });
    },
  });

  const {
    data: priceWatches = [],
    isLoading: isPriceWatchLoading,
    refetch: refetchPriceWatches,
  } = useQuery<PriceWatch[]>({
    queryKey: ["/api/supply/price-watches"],
    queryFn: async () => {
      const { response, data } = await fetchJsonWithRetry<PriceWatch[]>(
        "/api/supply/price-watches",
        { credentials: "include" },
        { attempts: 2, retryStatuses: [503], baseDelayMs: 600, fallbackValue: [] },
      );
      if ([401, 403, 404].includes(response.status)) return [];
      if (!response.ok) throw new Error("Failed to load watches");
      return Array.isArray(data) ? data : [];
    },
    enabled: canUseBuyerTools,
    staleTime: 20_000,
  });

  const { data: priceWatchAlerts = [] } = useQuery<PriceWatchAlert[]>({
    queryKey: ["/api/supply/price-watches/alerts"],
    queryFn: async () => {
      const { response, data } = await fetchJsonWithRetry<PriceWatchAlert[]>(
        "/api/supply/price-watches/alerts",
        { credentials: "include" },
        { attempts: 2, retryStatuses: [503], baseDelayMs: 600, fallbackValue: [] },
      );
      if ([401, 403, 404].includes(response.status)) return [];
      if (!response.ok) throw new Error("Failed to load watch alerts");
      return Array.isArray(data) ? data : [];
    },
    enabled: canUseBuyerTools,
    staleTime: 20_000,
  });

  const createPriceWatch = useMutation({
    mutationFn: async () => {
      if (!watchItemName.trim()) {
        throw new Error("Enter an ingredient or supply item name.");
      }
      const targetPriceCents =
        watchTargetPriceDollars.trim().length > 0
          ? Math.max(1, Math.round(Number(watchTargetPriceDollars) * 100))
          : null;
      const radiusMiles = Math.max(1, Math.min(250, Number(watchRadiusMiles || 25) || 25));

      const res = await fetch("/api/supply/price-watches", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName: watchItemName.trim(),
          targetPriceCents,
          maxRadiusMiles: radiusMiles,
          buyerRestaurantId: selectedBuyerRestaurantId || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to create price watch");
      }
      return data;
    },
    onSuccess: async () => {
      setWatchItemName("");
      setWatchTargetPriceDollars("");
      await refetchPriceWatches();
      toast({ title: "Watch added", description: "We'll track local price movement." });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to add watch",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deletePriceWatch = useMutation({
    mutationFn: async (watchId: string) => {
      const res = await fetch(`/api/supply/price-watches/${encodeURIComponent(watchId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to remove watch");
      }
      return data;
    },
    onSuccess: async () => {
      await refetchPriceWatches();
      toast({ title: "Watch removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to remove watch",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen pb-24">
      <h1 className="sr-only">MealScout supply marketplace</h1>
      <BackHeader title="Supply Marketplace" fallbackHref="/map" />

      <div className="px-4 space-y-4">
        {!canUseBuyerTools && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Browse suppliers</CardTitle>
              <CardDescription>
                You can browse without an account. Sign in to search across
                suppliers, upload order sheets, and place orders.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => {
                  window.location.href = "/login";
                }}
              >
                Sign in
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/customer-signup";
                }}
              >
                Create account
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="rounded-xl border bg-gradient-to-br from-background to-muted/30 p-4 shadow-clean">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="text-base font-semibold">
                Order supplies like a catalog
              </div>
              <div className="text-sm text-muted-foreground">
                Search supplier products, request pickup or delivery, and upload
                order sheets to compare deals.
              </div>
              <div className="flex flex-wrap gap-2 pt-3">
                {isSupplierUser || hasSupplierProfile ? (
                  <Link href="/supplier/dashboard">
                    <Button size="sm" className="w-full sm:w-auto">
                      Supplier dashboard
                    </Button>
                  </Link>
                ) : isAuthenticated ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={activateSupplierProfile.isPending}
                    onClick={() => activateSupplierProfile.mutate()}
                  >
                    {activateSupplierProfile.isPending
                      ? "Creating profile..."
                      : "Become a supplier"}
                  </Button>
                ) : (
                  <>
                    <Link href="/customer-signup?role=supplier">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto"
                      >
                        Become a supplier
                      </Button>
                    </Link>
                    {canUseBuyerTools && !isBuyerBusiness && (
                      <Link href="/customer-signup?role=business">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full sm:w-auto"
                        >
                          Create business account
                        </Button>
                      </Link>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant="secondary" className="gap-1">
                  <Zap className="h-3.5 w-3.5" />
                  Fast requests
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  <Calculator className="h-3.5 w-3.5" />
                  Best-deal planning
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  <Upload className="h-3.5 w-3.5" />
                  Upload lists
                </Badge>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {isSupplierUser ? null : (
                <Dialog
                  open={prefsDialogOpen}
                  onOpenChange={setPrefsDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full gap-2 sm:w-auto"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Preferences
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm sm:max-w-lg">
                    <DialogHeaderUI>
                      <DialogTitleUI>Preferences</DialogTitleUI>
                      <DialogDescriptionUI>
                        Make recommendations match your radius, stops, and stop
                        cost.
                      </DialogDescriptionUI>
                    </DialogHeaderUI>

                    <div className="grid gap-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label>Max stops</Label>
                          <Input
                            type="number"
                            min={1}
                            max={5}
                            value={String(prefsDraft.maxStops ?? "")}
                            onChange={(e) =>
                              setPrefsDraft((p) => ({
                                ...p,
                                maxStops: Number(e.target.value || 0) || 1,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Max radius (miles)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={250}
                            value={String(prefsDraft.maxRadiusMiles ?? "")}
                            onChange={(e) =>
                              setPrefsDraft((p) => ({
                                ...p,
                                maxRadiusMiles:
                                  Number(e.target.value || 0) || 20,
                              }))
                            }
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="text-sm font-medium">
                          Minutes-based stop cost
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label>Stop minutes</Label>
                            <Input
                              type="number"
                              min={0}
                              max={240}
                              value={String(prefsDraft.stopMinutes ?? "")}
                              onChange={(e) =>
                                setPrefsDraft((p) => ({
                                  ...p,
                                  stopMinutes: Number(e.target.value || 0) || 0,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Cost/min (cents)</Label>
                            <Input
                              type="number"
                              min={0}
                              max={5000}
                              value={String(
                                prefsDraft.costPerMinuteCents ?? "",
                              )}
                              onChange={(e) =>
                                setPrefsDraft((p) => ({
                                  ...p,
                                  costPerMinuteCents:
                                    Number(e.target.value || 0) || 0,
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Effective stop cost:{" "}
                          <span className="font-medium">
                            {formatMoney(
                              Math.max(
                                0,
                                Math.round(
                                  Number(prefsDraft.stopMinutes || 0) *
                                    Number(prefsDraft.costPerMinuteCents || 0),
                                ),
                              ),
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="text-sm font-medium">
                            Ping suppliers for missing items
                          </div>
                          <div className="text-xs text-muted-foreground">
                            If we can’t match an item, notify local suppliers
                            it’s in demand.
                          </div>
                        </div>
                        <Switch
                          checked={Boolean(prefsDraft.pingSuppliers ?? true)}
                          onCheckedChange={(v) =>
                            setPrefsDraft((p) => ({
                              ...p,
                              pingSuppliers: Boolean(v),
                            }))
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="text-sm font-medium">
                            Allow substitutions
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Match close items when exact names aren't listed.
                          </div>
                        </div>
                        <Switch
                          checked={Boolean(
                            prefsDraft.allowSubstitutions ?? true,
                          )}
                          onCheckedChange={(v) =>
                            setPrefsDraft((p) => ({
                              ...p,
                              allowSubstitutions: Boolean(v),
                            }))
                          }
                        />
                      </div>
                    </div>

                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setPrefsDialogOpen(false)}
                        disabled={savePreferences.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => savePreferences.mutate()}
                        disabled={savePreferences.isPending}
                      >
                        {savePreferences.isPending ? "Saving..." : "Save"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {!isSupplierUser && (
                <ShoppingListsDialog
                  buyerRestaurantId={selectedBuyerRestaurantId}
                  triggerLabel="My lists"
                />
              )}

              {canUseBuyerTools && (
                <Link href="/supply/orders">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Orders
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        {isBuyerBusiness && myRestaurants.length === 0 && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Add a restaurant or food truck profile to request supplies and
              calculate local delivery distance.
              <div className="pt-3">
                <Link href="/restaurant-signup">
                  <Button size="sm" variant="outline">
                    Create my business profile
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="catalog" className="flex-1">
              Catalog
            </TabsTrigger>
            <TabsTrigger
              value="watch"
              className="flex-1"
              disabled={!canUseBuyerTools}
            >
              Price watch
            </TabsTrigger>
            <TabsTrigger
              value="import"
              className="flex-1"
              disabled={!canUseBuyerTools}
            >
              Best-deal import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalog">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Search</CardTitle>
                <CardDescription>
                  Find items across supplier catalogs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Try: lemons, cups, ice, tortillas..."
                  disabled={!canUseBuyerTools}
                />
                {!canUseBuyerTools && (
                  <div className="text-sm text-muted-foreground">
                    Sign in to search across suppliers and place orders. You can
                    still browse suppliers below.
                  </div>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label>Your business</Label>
                    <div className="text-xs text-muted-foreground">
                      Optional, but recommended for restaurants and trucks
                    </div>
                  </div>
                  {myRestaurants.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Ordering as an individual. Add a business profile for
                      better local ranking.
                    </div>
                  ) : (
                    <select
                      className="w-full border rounded px-2 py-2 text-sm bg-background"
                      value={selectedBuyerRestaurantId}
                      onChange={(e) =>
                        setSelectedBuyerRestaurantId(e.target.value)
                      }
                    >
                      <option value="">Order as individual</option>
                      {myRestaurants.map((biz) => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="watch">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Localized Price Watch</CardTitle>
                <CardDescription>
                  Track ingredient and supply prices by your area and get alerts when targets hit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1 md:col-span-1">
                    <Label>Item</Label>
                    <Input
                      value={watchItemName}
                      onChange={(e) => setWatchItemName(e.target.value)}
                      placeholder="eggs, fryer oil, cups..."
                      disabled={!canUseBuyerTools}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Target price ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={watchTargetPriceDollars}
                      onChange={(e) => setWatchTargetPriceDollars(e.target.value)}
                      placeholder="Optional"
                      disabled={!canUseBuyerTools}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Radius (miles)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={250}
                      value={watchRadiusMiles}
                      onChange={(e) => setWatchRadiusMiles(e.target.value)}
                      disabled={!canUseBuyerTools}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => createPriceWatch.mutate()}
                    disabled={!canUseBuyerTools || createPriceWatch.isPending}
                  >
                    {createPriceWatch.isPending ? "Adding watch..." : "Add watch"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => refetchPriceWatches()}
                    disabled={isPriceWatchLoading}
                  >
                    Refresh
                  </Button>
                </div>

                {isPriceWatchLoading ? (
                  <div className="text-sm text-muted-foreground">Loading watches...</div>
                ) : priceWatches.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No watches yet. Add one to start tracking local market movement.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {priceWatches.map((watch) => (
                      <div
                        key={watch.id}
                        className="rounded-md border p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{watch.itemName}</div>
                          <div className="text-xs text-muted-foreground">
                            Radius {watch.maxRadiusMiles} mi
                            {watch.currentBest
                              ? ` • Best $${(Number(watch.currentBest.unitPriceCents || 0) / 100).toFixed(2)} at ${watch.currentBest.storeName || "store"}`
                              : " • No local observations yet"}
                          </div>
                          {watch.targetPriceCents ? (
                            <div className="text-xs text-muted-foreground">
                              Target ${(Number(watch.targetPriceCents || 0) / 100).toFixed(2)}
                              {watch.targetMet ? " • target hit" : ""}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {watch.targetMet ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                              Target hit
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Watching</Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deletePriceWatch.mutate(watch.id)}
                            disabled={deletePriceWatch.isPending}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium mb-2">Recent alerts</div>
                  {priceWatchAlerts.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No alerts yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {priceWatchAlerts.slice(0, 8).map((alert) => (
                        <div key={alert.id} className="text-xs text-muted-foreground rounded border p-2">
                          <div className="text-foreground font-medium">{alert.itemName}</div>
                          <div>{alert.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Upload an order list</CardTitle>
                <CardDescription>
                  CSV/TSV/XLSX with <code>sku</code> or <code>name</code> and{" "}
                  <code>quantity</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label>Your business</Label>
                    <div className="text-xs text-muted-foreground">
                      Optional, but recommended for restaurants and trucks
                    </div>
                  </div>
                  {myRestaurants.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Ordering as an individual. Add a business profile for
                      better local ranking.
                    </div>
                  ) : (
                    <select
                      className="w-full border rounded px-2 py-2 text-sm bg-background"
                      value={selectedBuyerRestaurantId}
                      onChange={(e) =>
                        setSelectedBuyerRestaurantId(e.target.value)
                      }
                    >
                      <option value="">Order as individual</option>
                      {myRestaurants.map((biz) => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>File</Label>
                  <input
                    type="file"
                    accept=".csv,.tsv,.xlsx"
                    onChange={(e) =>
                      setOrderListFile(e.target.files?.[0] || null)
                    }
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    disabled={!orderListFile || importOrderList.isPending}
                    onClick={() => importOrderList.mutate()}
                    className="gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    {importOrderList.isPending
                      ? "Importing..."
                      : "Find best deals"}
                  </Button>
                  {importResult ? (
                    <Button
                      variant="outline"
                      onClick={() => setImportDialogOpen(true)}
                    >
                      View results
                    </Button>
                  ) : null}
                </div>

                {importResult?.plan ? (
                  <div className="rounded-lg border p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        Recommended:{" "}
                        {importResult.plan.type === "one_stop"
                          ? "1 stop"
                          : "2 stops"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {importResult.plan.suppliers
                          .map((s) => s.businessName)
                          .join(" + ")}
                      </div>
                    </div>
                    <div className="text-sm font-semibold whitespace-nowrap">
                      {formatMoney(importResult.plan.totalCents)}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {tab === "catalog" ? (
          <>
            {showSearch ? (
              isSearchLoading ? (
                <div className="text-sm text-muted-foreground">Searching…</div>
              ) : supplyMatches.length === 0 ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">No matches yet</CardTitle>
                    <CardDescription>
                      Request it and we'll notify local suppliers to list it.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground truncate">
                      Item:{" "}
                      <span className="font-medium text-foreground">
                        {trimmedQ}
                      </span>
                    </div>
                    <Button
                      disabled={!trimmedQ || requestDemand.isPending}
                      onClick={() => requestDemand.mutate()}
                    >
                      {requestDemand.isPending ? "Requesting…" : "Request item"}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  <Card>
                    <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm">
                        <span className="font-semibold">
                          {groupedMatches.length}
                        </span>{" "}
                        supplier{groupedMatches.length === 1 ? "" : "s"} matched{" "}
                        <span className="font-semibold">
                          {totalMatchedProducts}
                        </span>{" "}
                        product{totalMatchedProducts === 1 ? "" : "s"} for{" "}
                        <span className="font-semibold">
                          {safeText(trimmedQ)}
                        </span>
                        .
                      </div>
                      {topMatch ? (
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-muted-foreground">
                            Best match:{" "}
                            {safeText(topMatch.supplier.businessName)}
                          </div>
                          <Link href={`/suppliers/${topMatch.supplier.id}`}>
                            <Button size="sm">Shop best match</Button>
                          </Link>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  {groupedMatches.map(({ supplier, rows }) => {
                    const location = [
                      supplier.address,
                      supplier.city,
                      supplier.state,
                    ]
                      .map((v) => (v || "").trim())
                      .filter(Boolean)
                      .join(", ");
                    const bestDistance =
                      rows
                        .map((r) => r.distanceMiles)
                        .filter(
                          (d): d is number =>
                            typeof d === "number" && Number.isFinite(d),
                        )
                        .sort((a, b) => a - b)[0] ?? null;
                    return (
                      <Card key={supplier.id}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <CardTitle className="text-lg truncate">
                                  {supplier.businessName}
                                </CardTitle>
                                <Badge variant="secondary">
                                  {supplier.offersDelivery
                                    ? "Delivery"
                                    : "Pickup"}
                                </Badge>
                                {bestDistance !== null ? (
                                  <Badge variant="outline">
                                    {formatMiles(bestDistance)}
                                  </Badge>
                                ) : null}
                              </div>
                              {location ? (
                                <CardDescription className="truncate">
                                  {location}
                                </CardDescription>
                              ) : null}
                            </div>
                            <Link href={`/suppliers/${supplier.id}`}>
                              <Button size="sm" className="shrink-0">
                                Shop
                              </Button>
                            </Link>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            {rows.slice(0, 6).map((r) => (
                              <div
                                key={r.product.id}
                                className="flex items-center justify-between gap-3 rounded-md border p-3"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">
                                    {r.product.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {r.product.sku
                                      ? `SKU ${r.product.sku}`
                                      : "—"}
                                  </div>
                                </div>
                                <div className="text-sm font-semibold whitespace-nowrap">
                                  {formatMoney(r.product.priceCents)}
                                  <span className="text-xs text-muted-foreground">
                                    {r.product.unitLabel
                                      ? ` / ${r.product.unitLabel}`
                                      : ""}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {rows.length > 6 ? (
                            <div className="text-xs text-muted-foreground">
                              +{rows.length - 6} more matches
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )
            ) : null}

            {!showSearch ? (
              isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading suppliers...
                </p>
              ) : isError ? (
                <p className="text-sm text-muted-foreground">
                  Unable to load suppliers. Please try again.
                </p>
              ) : suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No suppliers yet. Check back soon.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {suppliers.map((supplier) => {
                    const location = [
                      supplier.address,
                      supplier.city,
                      supplier.state,
                    ]
                      .map((v) => (v || "").trim())
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <Link
                        key={supplier.id}
                        href={`/suppliers/${supplier.id}`}
                      >
                        <Card className="cursor-pointer hover:opacity-90 transition">
                          <CardContent className="p-4 flex items-start gap-3">
                            <div className="mt-1">
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="font-semibold truncate">
                                {supplier.businessName}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {location || "—"}
                              </div>
                              <div className="pt-1">
                                <Badge variant="secondary">
                                  {supplier.offersDelivery
                                    ? "Delivery"
                                    : "Pickup"}
                                </Badge>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              )
            ) : null}
          </>
        ) : null}

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-w-sm md:max-w-3xl">
            <DialogHeaderUI>
              <DialogTitleUI>Best-deal results</DialogTitleUI>
              <DialogDescriptionUI>
                Ranked by coverage first, then subtotal. Stop cost is included
                in the recommendation.
              </DialogDescriptionUI>
            </DialogHeaderUI>

            {!importResult ? (
              <div className="text-sm text-muted-foreground">
                No results yet.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Recommended plan</CardTitle>
                    <CardDescription>
                      {importResult.plan
                        ? importResult.plan.type === "one_stop"
                          ? "All items covered by one supplier."
                          : "Splitting stops can be cheaper after stop cost."
                        : "No full-coverage plan yet."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {importResult.plan ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {importResult.plan.suppliers.map((s) => (
                            <Link key={s.id} href={`/suppliers/${s.id}`}>
                              <Badge className="cursor-pointer">
                                {s.businessName}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                        {importResult.plan.suppliers.length > 0 ? (
                          <Link
                            href={`/suppliers/${importResult.plan.suppliers[0].id}`}
                          >
                            <Button size="sm">
                              Open first recommended supplier
                            </Button>
                          </Link>
                        ) : null}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Subtotal
                            </div>
                            <div className="font-semibold">
                              {formatMoney(importResult.plan.subtotalCents)}
                            </div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Stop cost
                            </div>
                            <div className="font-semibold">
                              {formatMoney(importResult.plan.stopCostCents)}
                            </div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">
                              Total
                            </div>
                            <div className="font-semibold">
                              {formatMoney(importResult.plan.totalCents)}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Try enabling substitutions or increasing your radius.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Top suppliers</CardTitle>
                    <CardDescription>
                      Open a supplier to place a request.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[320px] pr-3">
                      <div className="space-y-2">
                        {importResult.suppliers.slice(0, 15).map((s) => (
                          <Link
                            key={s.supplierId}
                            href={`/suppliers/${s.supplierId}`}
                          >
                            <div className="rounded-md border p-3 cursor-pointer hover:opacity-90 transition">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">
                                    {s.supplier.businessName}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Covers {s.coverageCount} • Missing{" "}
                                    {s.missingCount}
                                  </div>
                                </div>
                                <div className="text-sm font-semibold whitespace-nowrap">
                                  {formatMoney(s.subtotalCents)}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Navigation />
    </div>
  );
}
