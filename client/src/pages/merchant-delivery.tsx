import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Truck } from "lucide-react";
import type { Restaurant } from "@shared/schema";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

type Settings = {
  enabled: boolean;
  feeCents: number;
  minimumOrderCents: number;
  estimatedMinutes: number;
  maxConcurrentOrders: number;
  postalCodes: string[];
  instructions?: string | null;
  deliveryHours: Record<string, unknown>;
};

const defaults: Settings = {
  enabled: false,
  feeCents: 0,
  minimumOrderCents: 0,
  estimatedMinutes: 45,
  maxConcurrentOrders: 5,
  postalCodes: [],
  instructions: "",
  deliveryHours: {},
};

export default function MerchantDeliveryPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [settings, setSettings] = useState(defaults);
  const [postalCodes, setPostalCodes] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: businesses = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
  });
  const requestedId = new URLSearchParams(search).get("restaurantId");
  const business = businesses.find((item) => item.id === requestedId) || businesses[0];

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/owner/restaurants/${encodeURIComponent(business.id)}/delivery`, { credentials: "include" })
      .then((response) => response.json())
      .then((payload) => {
        setSettings({ ...defaults, ...payload });
        setPostalCodes(Array.isArray(payload.postalCodes) ? payload.postalCodes.join(", ") : "");
      });
  }, [business?.id]);

  if (!business) return null;
  const isTruck = business.isFoodTruck || business.businessType === "food_truck";
  const publicProfileHref = buildPublicProfilePath({
    entityType: isTruck ? "truck" : business.businessType === "bar" ? "bar" : "restaurant",
    id: business.id,
    name: business.name,
  });

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/owner/restaurants/${encodeURIComponent(business.id)}/delivery`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          postalCodes: postalCodes.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Delivery settings could not be saved");
      toast({ title: "Delivery settings saved", description: settings.enabled ? "Customers can now choose merchant delivery." : "Merchant delivery is off." });
    } catch (error: any) {
      toast({ title: "Settings not saved", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <BusinessWorkspaceShell
      activeModule="work"
      business={business}
      businesses={businesses}
      onBusinessChange={(id) => setLocation(`/merchant-delivery?restaurantId=${encodeURIComponent(id)}`)}
      publicProfileHref={publicProfileHref}
      headerActions={<Button asChild variant="outline"><Link href={`/orders?restaurantId=${encodeURIComponent(business.id)}`}>Orders</Link></Button>}
    >
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-widest text-orange-700">{business.name}</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black"><Truck className="h-7 w-7" /> Merchant delivery</h1>
          <p className="mt-2 text-sm text-muted-foreground">You set the area, price, minimum, timing, and capacity. MealScout does not assign a driver.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Delivery controls</CardTitle></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2 flex items-center justify-between rounded-xl border p-4">
              <div><p className="font-bold">Offer merchant-operated delivery</p><p className="text-xs text-muted-foreground">Turn this off any time capacity changes.</p></div>
              <Switch checked={settings.enabled} onCheckedChange={(enabled) => setSettings((value) => ({ ...value, enabled }))} />
            </div>
            <div><Label>Delivery fee ($)</Label><Input type="number" min="0" step="0.01" value={(settings.feeCents / 100).toFixed(2)} onChange={(e) => setSettings((v) => ({ ...v, feeCents: Math.round(Number(e.target.value || 0) * 100) }))} /></div>
            <div><Label>Minimum order ($)</Label><Input type="number" min="0" step="0.01" value={(settings.minimumOrderCents / 100).toFixed(2)} onChange={(e) => setSettings((v) => ({ ...v, minimumOrderCents: Math.round(Number(e.target.value || 0) * 100) }))} /></div>
            <div><Label>Estimated delivery minutes</Label><Input type="number" min="10" max="240" value={settings.estimatedMinutes} onChange={(e) => setSettings((v) => ({ ...v, estimatedMinutes: Number(e.target.value) }))} /></div>
            <div><Label>Maximum active delivery orders</Label><Input type="number" min="1" max="100" value={settings.maxConcurrentOrders} onChange={(e) => setSettings((v) => ({ ...v, maxConcurrentOrders: Number(e.target.value) }))} /></div>
            <div className="sm:col-span-2"><Label>Delivery ZIP codes</Label><Input value={postalCodes} onChange={(e) => setPostalCodes(e.target.value)} placeholder="75201, 75202, 75203" /><p className="mt-1 text-xs text-muted-foreground">Comma-separated. Customers outside these ZIP codes cannot submit delivery orders.</p></div>
            <div className="sm:col-span-2"><Label>Customer-facing delivery note</Label><Input value={settings.instructions || ""} onChange={(e) => setSettings((v) => ({ ...v, instructions: e.target.value }))} placeholder="Delivery entrance, coverage note, or timing details" /></div>
            <Button className="sm:col-span-2" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save delivery settings"}</Button>
          </CardContent>
        </Card>
      </main>
    </BusinessWorkspaceShell>
  );
}
