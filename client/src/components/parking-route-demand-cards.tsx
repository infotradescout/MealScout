import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";

const fetchJson = async (url: string) => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Unavailable");
  return response.json();
};

export function HostRouteDemandCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/parking-pass/host-route-demand"],
    queryFn: () => fetchJson("/api/parking-pass/host-route-demand"),
    retry: false,
  });
  return (
    <Card className="rounded-2xl border border-orange-200 pp-glass">
      <CardContent className="space-y-3 p-4">
        <div><p className="text-sm font-semibold">Truck route demand near your property</p><p className="text-xs text-muted-foreground">Planning demand helps you choose when to publish Parking Pass availability.</p></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-orange-50 p-3 text-center"><p className="text-2xl font-bold text-orange-900">{isLoading ? "…" : data?.routesNearby ?? 0}</p><p className="text-[11px] text-orange-800">saved routes nearby</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-2xl font-bold text-emerald-900">{isLoading ? "…" : data?.scheduledStops ?? 0}</p><p className="text-[11px] text-emerald-800">scheduled stops</p></div>
        </div>
        <p className="text-[11px] text-muted-foreground">More nearby routes with few scheduled stops indicates an opportunity to add dates or improve pricing.</p>
      </CardContent>
    </Card>
  );
}

export function AdminRouteConversionCard() {
  const heatmap = useQuery({ queryKey: ["/api/admin/parking-pass/route-demand-heatmap"], queryFn: () => fetchJson("/api/admin/parking-pass/route-demand-heatmap"), retry: false });
  const funnel = useQuery({ queryKey: ["/api/admin/parking-pass/route-funnel"], queryFn: () => fetchJson("/api/admin/parking-pass/route-funnel"), retry: false });
  if (heatmap.isError && funnel.isError) return null;
  const counts = funnel.data?.counts || {};
  return (
    <Card className="rounded-2xl border border-violet-200 pp-glass">
      <CardContent className="space-y-3 p-4">
        <div><p className="text-sm font-semibold">Route demand → Parking Pass revenue</p><p className="text-xs text-muted-foreground">Supply gaps and the live conversion funnel from planning to confirmed booking.</p></div>
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {[["Planned", counts.route_planned], ["Saved", counts.route_saved], ["Stops", counts.route_stop_selected], ["Booking starts", counts.route_booking_started], ["Confirmed", counts.route_booking_confirmed], ["Alerts", counts.route_alert_generated]].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-violet-50 p-2"><p className="text-lg font-bold text-violet-950">{Number(value || 0)}</p><p className="text-[10px] text-violet-800">{label}</p></div>
          ))}
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-[11px] text-emerald-800">Confirmed MealScout fees</p>
          <p className="text-xl font-bold text-emerald-950">${(Number(funnel.data?.platformFeeCents || 0) / 100).toFixed(2)}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {(heatmap.data?.cells || []).slice(0, 8).map((cell: any) => (
            <span key={`${cell.lat}:${cell.lng}`} className="rounded-full border border-violet-200 bg-white px-2 py-1">{cell.lat.toFixed(1)}, {cell.lng.toFixed(1)} · {cell.routeCount} route{cell.routeCount === 1 ? "" : "s"} · {cell.hostOpportunities === 0 ? "supply gap" : `${cell.hostOpportunities} host matches`}</span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
