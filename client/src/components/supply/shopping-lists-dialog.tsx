import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription as DialogDescriptionUI,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type SupplyShoppingList = {
  id: string;
  buyerRestaurantId?: string | null;
  name: string;
  notes?: string | null;
  updatedAt?: string | null;
};

type SupplyShoppingListItem = {
  id: string;
  listId: string;
  rawName: string;
  quantity: string | number;
  unit?: string | null;
};

type OptimizeResult = {
  plan: null | {
    type: "one_stop" | "two_stop";
    suppliers: Array<{ id: string; businessName: string }>;
    subtotalCents: number;
    stopCostCents: number;
    totalCents: number;
  };
};

const formatMoney = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export function ShoppingListsDialog(props: {
  buyerRestaurantId: string;
  triggerLabel?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const triggerLabel = props.triggerLabel ?? "Lists";
  const [open, setOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemQty, setNewItemQty] = useState("1");
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);

  const { data: lists = [] } = useQuery<SupplyShoppingList[]>({
    queryKey: ["/api/supply/lists", props.buyerRestaurantId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (props.buyerRestaurantId) params.set("buyerRestaurantId", props.buyerRestaurantId);
      const res = await fetch(`/api/supply/lists?${params.toString()}`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to load lists");
      return data;
    },
    staleTime: 20_000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (selectedListId) return;
    if (lists.length > 0) setSelectedListId(lists[0].id);
  }, [lists, open, selectedListId]);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) || null,
    [lists, selectedListId],
  );

  const { data: items = [] } = useQuery<SupplyShoppingListItem[]>({
    queryKey: ["/api/supply/lists/items", selectedListId],
    queryFn: async () => {
      const res = await fetch(`/api/supply/lists/${selectedListId}/items`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to load list items");
      return data;
    },
    enabled: open && Boolean(selectedListId),
    staleTime: 10_000,
  });

  const createList = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/supply/lists", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerRestaurantId: props.buyerRestaurantId || null,
          name: newListName.trim(),
          notes: null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to create list");
      return data as SupplyShoppingList;
    },
    onSuccess: (list) => {
      setNewListName("");
      setSelectedListId(list.id);
      queryClient.invalidateQueries({ queryKey: ["/api/supply/lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supply/lists", props.buyerRestaurantId] });
      toast({ title: "List created" });
    },
    onError: (error: any) => {
      toast({
        title: "Create failed",
        description: error?.message || "Unable to create list",
        variant: "destructive",
      });
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!selectedListId) throw new Error("Select a list first.");
      const qty = Number(newItemQty);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Enter a valid quantity.");
      const res = await fetch(`/api/supply/lists/${selectedListId}/items`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawName: newItemName.trim(),
          quantity: qty,
          unit: null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to add item");
      return data as SupplyShoppingListItem;
    },
    onSuccess: () => {
      setNewItemName("");
      setNewItemQty("1");
      queryClient.invalidateQueries({ queryKey: ["/api/supply/lists/items", selectedListId] });
      toast({ title: "Added to list" });
    },
    onError: (error: any) => {
      toast({
        title: "Add failed",
        description: error?.message || "Unable to add item",
        variant: "destructive",
      });
    },
  });

  const optimize = useMutation({
    mutationFn: async () => {
      if (!selectedListId) throw new Error("Select a list first.");
      const res = await fetch(`/api/supply/lists/${selectedListId}/optimize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to optimize list");
      return data as OptimizeResult;
    },
    onSuccess: (data) => {
      setOptimizeResult(data);
      if (data?.plan) {
        toast({
          title: "Plan ready",
          description: `Recommended: ${data.plan.type === "one_stop" ? "1 stop" : "2 stops"} • ${formatMoney(data.plan.totalCents)}`,
        });
      } else {
        toast({ title: "No full plan yet", description: "Try adding more items or widening radius." });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Optimize failed",
        description: error?.message || "Unable to optimize",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (setOpen(v), v ? null : setOptimizeResult(null))}>
      <DialogTrigger asChild>
        <Button variant="outline">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Shopping lists</DialogTitle>
          <DialogDescriptionUI>
            Build a list, then generate an optimized plan to buy at the best price.
          </DialogDescriptionUI>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Lists</CardTitle>
              <CardDescription>Create and select a list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lists.length === 0 ? (
                <div className="text-sm text-muted-foreground">No lists yet.</div>
              ) : (
                <select
                  className="w-full border rounded px-2 py-2 text-sm bg-background"
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="rounded-lg border p-3 space-y-2">
                <Label>New list name</Label>
                <Input value={newListName} onChange={(e) => setNewListName(e.target.value)} />
                <Button
                  disabled={createList.isPending || !newListName.trim()}
                  onClick={() => createList.mutate()}
                >
                  {createList.isPending ? "Creating..." : "Create list"}
                </Button>
              </div>

              <Button
                variant="outline"
                disabled={optimize.isPending || !selectedListId || items.length === 0}
                onClick={() => optimize.mutate()}
              >
                {optimize.isPending ? "Optimizing..." : "Optimize plan"}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{selectedList?.name || "Items"}</CardTitle>
                  <CardDescription>Add items like “lemons”, “12oz cups”, “ice”.</CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {items.length} item(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label>Item</Label>
                  <Input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
                </div>
                <div>
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    min={0}
                    value={newItemQty}
                    onChange={(e) => setNewItemQty(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                disabled={addItem.isPending || !selectedListId || !newItemName.trim()}
                onClick={() => addItem.mutate()}
              >
                {addItem.isPending ? "Adding..." : "Add item"}
              </Button>

              <ScrollArea className="h-[320px] pr-3">
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No items yet.</div>
                  ) : (
                    items.map((i) => (
                      <div key={i.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{i.rawName}</div>
                          <div className="text-xs text-muted-foreground">
                            Qty {Number(i.quantity)}
                            {i.unit ? ` ${i.unit}` : ""}
                          </div>
                        </div>
                        {optimizeResult?.plan ? (
                          <Badge variant="outline" className="shrink-0">
                            In plan
                          </Badge>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {optimizeResult?.plan ? (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      Recommended: {optimizeResult.plan.type === "one_stop" ? "1 stop" : "2 stops"}
                    </div>
                    <div className="text-sm font-semibold">{formatMoney(optimizeResult.plan.totalCents)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {optimizeResult.plan.suppliers.map((s) => (
                      <Link key={s.id} href={`/suppliers/${s.id}`}>
                        <Badge className="cursor-pointer">{s.businessName}</Badge>
                      </Link>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Subtotal {formatMoney(optimizeResult.plan.subtotalCents)} + stop cost{" "}
                    {formatMoney(optimizeResult.plan.stopCostCents)}.
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

