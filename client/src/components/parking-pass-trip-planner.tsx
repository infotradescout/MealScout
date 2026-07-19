import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, ChevronDown, ChevronUp, MapPinned, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TripPlannerHost = {
  locationId: string;
  hostId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  distanceFromRouteMiles: number;
  routeProgressMiles: number;
  addedDurationSeconds: number | null;
  directionsUri: string;
  available: boolean;
  priceCents: number | null;
  traffic: "high" | "medium" | "low" | "unknown";
};

type Scope = "local" | "regional" | "nationwide";
type ScheduledStop = TripPlannerHost & { serviceMinutes: number };
type SavedRoute = {
  id: string;
  name: string;
  origin: string;
  destination: string;
  scope: Scope;
  recurring: boolean;
  knownHostIds: string[];
  savedAt: string;
};
type ValueMetrics = {
  tripsPlanned: number;
  milesPlanned: number;
  opportunitiesDiscovered: number;
  stopsScheduled: number;
  bookingStarts: number;
};

const ROUTES_KEY = "mealscout_saved_planning_routes_v1";
const METRICS_KEY = "mealscout_travel_value_v1";
const scopeMiles: Record<Scope, number> = { local: 2, regional: 7, nationwide: 15 };
const scopeLabels: Record<Scope, string> = {
  local: "Local · 2 mi",
  regional: "Regional · 7 mi",
  nationwide: "Nationwide · 15 mi",
};

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const priceLabel = (cents: number | null) =>
  cents === null ? "Price pending" : `$${(cents / 100).toFixed(0)}`;

const detourMinutes = (seconds: number | null) =>
  seconds === null ? null : Math.max(0, Math.round(seconds / 60));

const addMinutes = (time: string, minutes: number) => {
  const [hours, mins] = time.split(":").map(Number);
  const total = ((hours || 0) * 60 + (mins || 0) + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function ParkingPassTripPlanner({
  hosts,
  origin,
  destination,
  routeMiles,
  routeDurationSeconds,
  selectedDate,
  onSeeAvailability,
}: {
  hosts: TripPlannerHost[];
  origin: string;
  destination: string;
  routeMiles: number;
  routeDurationSeconds: number;
  selectedDate: string;
  onSeeAvailability: (host: TripPlannerHost) => void;
}) {
  const [scope, setScope] = useState<Scope>("nationwide");
  const [schedule, setSchedule] = useState<ScheduledStop[]>([]);
  const [departureTime, setDepartureTime] = useState("08:00");
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() =>
    readJson<SavedRoute[]>(ROUTES_KEY, []),
  );
  const [routeName, setRouteName] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [newHostAlerts, setNewHostAlerts] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<ValueMetrics>(() =>
    readJson<ValueMetrics>(METRICS_KEY, {
      tripsPlanned: 0,
      milesPlanned: 0,
      opportunitiesDiscovered: 0,
      stopsScheduled: 0,
      bookingStarts: 0,
    }),
  );

  const scopedHosts = useMemo(
    () => hosts.filter((host) => host.distanceFromRouteMiles <= scopeMiles[scope]),
    [hosts, scope],
  );
  const rankedHosts = useMemo(() => {
    const trafficScore = { high: 20, medium: 13, low: 6, unknown: 9 } as const;
    return scopedHosts
      .map((host) => {
        const detour = detourMinutes(host.addedDurationSeconds);
        const detourScore = detour === null ? 8 : Math.max(0, 30 - detour * 1.5);
        const priceScore = host.priceCents === null
          ? 6
          : Math.max(0, 15 - host.priceCents / 1000);
        const score = Math.round(
          (host.available ? 35 : 8) + detourScore + trafficScore[host.traffic] + priceScore,
        );
        return { ...host, score };
      })
      .sort((a, b) => b.score - a.score || a.routeProgressMiles - b.routeProgressMiles);
  }, [scopedHosts]);

  useEffect(() => {
    const currentIds = new Set(hosts.map((host) => host.locationId));
    const alerts = savedRoutes
      .filter((route) => route.recurring && route.origin === origin && route.destination === destination)
      .flatMap((route) =>
        hosts
          .filter((host) => !route.knownHostIds.includes(host.locationId) && currentIds.has(host.locationId))
          .map((host) => host.name),
      );
    const uniqueAlerts = Array.from(new Set(alerts));
    setNewHostAlerts(uniqueAlerts);
    if (uniqueAlerts.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("New Parking Pass hosts on a saved route", {
        body: `${uniqueAlerts.slice(0, 3).join(", ")}${uniqueAlerts.length > 3 ? ` +${uniqueAlerts.length - 3} more` : ""}`,
      });
    }
  }, [destination, hosts, origin, savedRoutes]);

  useEffect(() => {
    const next = {
      ...metrics,
      opportunitiesDiscovered: Math.max(metrics.opportunitiesDiscovered, hosts.length),
    };
    if (next.opportunitiesDiscovered !== metrics.opportunitiesDiscovered) {
      setMetrics(next);
      localStorage.setItem(METRICS_KEY, JSON.stringify(next));
    }
  }, [hosts.length]);

  const persistMetrics = (patch: Partial<ValueMetrics>) => {
    const next = { ...metrics, ...patch };
    setMetrics(next);
    localStorage.setItem(METRICS_KEY, JSON.stringify(next));
  };

  const addStop = (host: TripPlannerHost) => {
    if (schedule.some((stop) => stop.locationId === host.locationId)) return;
    const next = [...schedule, { ...host, serviceMinutes: 120 }].sort(
      (a, b) => a.routeProgressMiles - b.routeProgressMiles,
    );
    setSchedule(next);
    persistMetrics({ stopsScheduled: metrics.stopsScheduled + 1 });
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= schedule.length) return;
    const next = [...schedule];
    [next[index], next[target]] = [next[target], next[index]];
    setSchedule(next);
  };

  const timeline = useMemo(() => {
    let elapsed = 0;
    let previousProgress = 0;
    return schedule.map((stop) => {
      const segmentMiles = Math.max(0, stop.routeProgressMiles - previousProgress);
      const driveMinutes = routeMiles > 0
        ? Math.round((routeDurationSeconds / 60) * (segmentMiles / routeMiles))
        : 0;
      elapsed += driveMinutes + (detourMinutes(stop.addedDurationSeconds) || 0);
      const arrival = addMinutes(departureTime, elapsed);
      const serviceEnd = addMinutes(arrival, stop.serviceMinutes);
      const cleanupEnd = addMinutes(serviceEnd, 30);
      elapsed += stop.serviceMinutes + 30;
      previousProgress = stop.routeProgressMiles;
      return { stop, arrival, serviceEnd, cleanupEnd, driveMinutes };
    });
  }, [departureTime, routeDurationSeconds, routeMiles, schedule]);

  const saveRoute = () => {
    const nextRoute: SavedRoute = {
      id: `${Date.now()}`,
      name: routeName.trim() || `${origin} → ${destination}`,
      origin,
      destination,
      scope,
      recurring,
      knownHostIds: hosts.map((host) => host.locationId),
      savedAt: new Date().toISOString(),
    };
    const next = [nextRoute, ...savedRoutes].slice(0, 20);
    setSavedRoutes(next);
    localStorage.setItem(ROUTES_KEY, JSON.stringify(next));
    persistMetrics({
      tripsPlanned: metrics.tripsPlanned + 1,
      milesPlanned: Math.round((metrics.milesPlanned + routeMiles) * 10) / 10,
    });
    setRouteName("");
  };

  return (
    <div className="space-y-4 rounded-2xl border border-orange-200 bg-orange-50/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-base font-semibold text-orange-950">
            <MapPinned className="h-4 w-4" /> Multi-stop trip planner
          </p>
          <p className="mt-1 text-xs text-orange-800">
            Build the schedule here. Open navigation only when you are ready to leave.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(scopeLabels) as Scope[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={scope === option ? "default" : "outline"}
              onClick={() => setScope(option)}
            >
              {scopeLabels[option]}
            </Button>
          ))}
        </div>
      </div>

      {newHostAlerts.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{newHostAlerts.length} new host{newHostAlerts.length === 1 ? "" : "s"}</strong> found on this saved route: {newHostAlerts.slice(0, 4).join(", ")}.</span>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Ranked host opportunities</p>
          <span className="text-[11px] text-muted-foreground">Availability · detour · traffic · price</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {rankedHosts.map((host, index) => {
            const selected = schedule.some((stop) => stop.locationId === host.locationId);
            return (
              <div key={host.locationId} className="rounded-xl border bg-white/90 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">#{index + 1} {host.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{host.city}, {host.state}</p>
                  </div>
                  <Badge variant={host.available ? "default" : "secondary"}>{host.score} fit</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{host.available ? "Open dates" : "No open pass"}</span>
                  <span>{detourMinutes(host.addedDurationSeconds) ?? "?"} min detour</span>
                  <span>{host.traffic} traffic</span>
                  <span>{priceLabel(host.priceCents)}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" className="flex-1" disabled={selected} onClick={() => addStop(host)}>
                    {selected ? "Scheduled" : "Add to trip"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    persistMetrics({ bookingStarts: metrics.bookingStarts + 1 });
                    onSeeAvailability(host);
                  }}>
                    Availability
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border bg-white/90 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> Trip timeline · {selectedDate}</p>
          <label className="flex items-center gap-2 text-xs">Depart <Input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} className="h-8 w-28" /></label>
        </div>
        {timeline.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Add ranked hosts to create the day’s service schedule.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {timeline.map(({ stop, arrival, serviceEnd, cleanupEnd, driveMinutes }, index) => (
              <div key={stop.locationId} className="grid gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-xs font-semibold">{arrival} · {stop.name}</p>
                  <p className="text-[11px] text-muted-foreground">Drive {driveMinutes} min · serve until {serviceEnd} · cleanup/depart {cleanupEnd}</p>
                </div>
                <div className="flex items-center gap-1">
                  <select value={stop.serviceMinutes} onChange={(event) => setSchedule((current) => current.map((item) => item.locationId === stop.locationId ? { ...item, serviceMinutes: Number(event.target.value) } : item))} className="h-8 rounded-md border bg-white px-2 text-xs">
                    <option value={60}>1 hr</option><option value={120}>2 hr</option><option value={180}>3 hr</option><option value={240}>4 hr</option>
                  </select>
                  <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => moveStop(index, -1)}><ChevronUp className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="ghost" disabled={index === schedule.length - 1} onClick={() => moveStop(index, 1)}><ChevronDown className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSchedule((current) => current.filter((item) => item.locationId !== stop.locationId))}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={routeName} onChange={(event) => setRouteName(event.target.value)} placeholder="Route name (optional)" />
          <label className="flex shrink-0 items-center gap-2 rounded-md border bg-white px-3 text-xs">
            <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Alert me when new hosts appear
          </label>
          <Button type="button" onClick={saveRoute}><Save className="mr-2 h-4 w-4" /> Save route</Button>
        </div>
        <div className="flex flex-wrap gap-2 text-center">
          <div className="rounded-lg border bg-white px-3 py-2"><p className="text-lg font-bold">{metrics.milesPlanned.toFixed(1)}</p><p className="text-[10px] text-muted-foreground">miles planned</p></div>
          <div className="rounded-lg border bg-white px-3 py-2"><p className="text-lg font-bold">{metrics.opportunitiesDiscovered}</p><p className="text-[10px] text-muted-foreground">hosts discovered</p></div>
          <div className="rounded-lg border bg-white px-3 py-2"><p className="text-lg font-bold">{metrics.stopsScheduled}</p><p className="text-[10px] text-muted-foreground">stops scheduled</p></div>
          <div className="rounded-lg border bg-white px-3 py-2"><p className="text-lg font-bold">{metrics.bookingStarts}</p><p className="text-[10px] text-muted-foreground">booking opportunities</p></div>
        </div>
      </div>

      {savedRoutes.length > 0 && (
        <div className="rounded-xl border bg-white/80 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="h-4 w-4" /> Saved recurring routes</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {savedRoutes.slice(0, 5).map((route) => <Badge key={route.id} variant="outline">{route.name}{route.recurring ? " · alerts on" : ""}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
}
