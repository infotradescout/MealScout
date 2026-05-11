import { FormEvent, useMemo, useState } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import countiesAtlas from "us-atlas/counties-10m.json";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Map as MapIcon,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Search,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { BackHeader } from "@/components/back-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Timeframe = "7d" | "30d" | "90d";
type Lens = "coverage" | "metrics";

type MarketCounty = {
  countyFips: string;
  countyName: string;
  stateCode: string;
  metrics: Record<string, number>;
  updatedAt?: string | null;
};

type MarketNote = {
  id: string;
  category: string;
  content: string;
  createdAt?: string | null;
};

type MarketEntity = {
  id: string;
  entityType: string;
  label: string;
  status: string;
};

type FormMutation = {
  mutate: (event: FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
};

const metricOptions = [
  "users_total",
  "diners_total",
  "restaurants_total",
  "restaurants_verified",
  "restaurants_claimed",
  "vendors_total",
  "orders_30d",
  "searches_30d",
  "menu_views_30d",
  "reviews_30d",
  "unmet_demand_score",
  "delivery_coverage_score",
  "market_coverage_status",
];

const coverageLabel = (score: number) =>
  score >= 2 ? "ready" : score >= 1 ? "partial" : "empty";

const coverageColor = (score: number) =>
  score >= 2 ? "#15803d" : score >= 1 ? "#d97706" : "#e5e7eb";

const metricColor = (value: number, max: number) => {
  if (!value || !max) return "#e5e7eb";
  const intensity = Math.max(0.15, Math.min(1, value / max));
  const green = Math.round(232 - intensity * 92);
  const blue = Math.round(213 - intensity * 156);
  return `rgb(14, ${green}, ${blue})`;
};

export default function AdminMarketHeatmap() {
  const { toast } = useToast();
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [lens, setLens] = useState<Lens>("coverage");
  const [metric, setMetric] = useState("restaurants_total");
  const [query, setQuery] = useState("");
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [hoveredFips, setHoveredFips] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const { data, isLoading } = useQuery<{
    timeframe: Timeframe;
    counties: MarketCounty[];
  }>({
    queryKey: [`/api/admin/heatmap?timeframe=${timeframe}`],
    retry: false,
  });

  const counties = data?.counties || [];
  const countyByFips = useMemo(() => {
    const map = new globalThis.Map<string, MarketCounty>();
    counties.forEach((county) => map.set(county.countyFips, county));
    return map;
  }, [counties]);

  const selectedCounty = selectedFips ? countyByFips.get(selectedFips) : null;
  const hoveredCounty = hoveredFips ? countyByFips.get(hoveredFips) : null;
  const selectedMetricMax = Math.max(
    1,
    ...counties.map((county) => Number(county.metrics?.[metric] || 0)),
  );

  const filteredCounties = counties.filter((county) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${county.countyName} ${county.stateCode} ${county.countyFips}`
      .toLowerCase()
      .includes(needle);
  });

  const countyFeatures = useMemo(() => {
    const collection = feature(
      countiesAtlas as any,
      (countiesAtlas as any).objects.counties,
    ) as any;
    return collection.features as any[];
  }, []);

  const path = useMemo(() => {
    const projection = geoAlbersUsa().scale(1280).translate([480, 300]);
    return geoPath(projection);
  }, []);

  const { data: notes = [] } = useQuery<MarketNote[]>({
    queryKey: selectedFips
      ? [`/api/admin/geo/counties/${selectedFips}/notes`]
      : ["admin-market-notes-none"],
    enabled: Boolean(selectedFips),
  });

  const { data: entities = [] } = useQuery<MarketEntity[]>({
    queryKey: selectedFips
      ? [`/api/admin/geo/counties/${selectedFips}/entities`]
      : ["admin-market-entities-none"],
    enabled: Boolean(selectedFips),
  });

  const refresh = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/geo/metrics/refresh", { timeframe }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/heatmap"] });
      toast({ title: "Market metrics refreshed" });
    },
    onError: (error: Error) =>
      toast({ title: "Refresh failed", description: error.message }),
  });

  const addNote = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFips || !selectedCounty) throw new Error("Select a county");
      const form = new FormData(event.currentTarget);
      const response = await apiRequest(
        "POST",
        `/api/admin/geo/counties/${selectedFips}/notes`,
        {
          countyName: selectedCounty.countyName,
          stateCode: selectedCounty.stateCode,
          category: String(form.get("category") || "general"),
          content: String(form.get("content") || "").trim(),
        },
      );
      event.currentTarget.reset();
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/geo/counties/${selectedFips}/notes`],
      });
      toast({ title: "Note added" });
    },
  });

  const addEntity = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFips || !selectedCounty) throw new Error("Select a county");
      const form = new FormData(event.currentTarget);
      const response = await apiRequest(
        "POST",
        `/api/admin/geo/counties/${selectedFips}/entities`,
        {
          countyName: selectedCounty.countyName,
          stateCode: selectedCounty.stateCode,
          entityType: String(form.get("entityType") || "local_operator"),
          label: String(form.get("label") || "").trim(),
          status: String(form.get("status") || "active"),
        },
      );
      event.currentTarget.reset();
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/geo/counties/${selectedFips}/entities`],
      });
      toast({ title: "Assignment added" });
    },
  });

  const colorForCounty = (fips: string) => {
    const row = countyByFips.get(fips);
    if (!row) return "#f3f4f6";
    if (lens === "coverage") {
      return coverageColor(Number(row.metrics.market_coverage_status || 0));
    }
    return metricColor(Number(row.metrics[metric] || 0), selectedMetricMax);
  };

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] pb-20">
      <BackHeader
        title="Market Heatmap"
        subtitle="County-level MealScout demand, supply, and ops coverage"
        fallbackHref="/admin/dashboard"
        icon={MapIcon}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Market intelligence</h1>
            <p className="text-sm text-muted-foreground">
              Stored county facts, notes, and operator assignments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["7d", "30d", "90d"] as Timeframe[]).map((option) => (
              <Button
                key={option}
                variant={timeframe === option ? "default" : "outline"}
                size="sm"
                onClick={() => setTimeframe(option)}
              >
                {option}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Tracked markets</CardDescription>
              <CardTitle className="text-3xl">{counties.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ready</CardDescription>
              <CardTitle className="text-3xl">
                {
                  counties.filter(
                    (county) =>
                      Number(county.metrics.market_coverage_status || 0) >= 2,
                  ).length
                }
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Partial</CardDescription>
              <CardTitle className="text-3xl">
                {
                  counties.filter(
                    (county) =>
                      Number(county.metrics.market_coverage_status || 0) === 1,
                  ).length
                }
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Restaurants</CardDescription>
              <CardTitle className="text-3xl">
                {counties.reduce(
                  (sum, county) => sum + Number(county.metrics.restaurants_total || 0),
                  0,
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="map" className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList>
              <TabsTrigger value="map">County map</TabsTrigger>
              <TabsTrigger value="activity">Activity list</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <select
                value={lens}
                onChange={(event) => setLens(event.target.value as Lens)}
                className="h-10 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
              >
                <option value="coverage">Coverage</option>
                <option value="metrics">Metrics</option>
              </select>
              <select
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                className="h-10 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
              >
                {metricOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="County, state, FIPS"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <TabsContent value="map" className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">County map</CardTitle>
                    <CardDescription>
                      {hoveredCounty
                        ? `${hoveredCounty.countyName}, ${hoveredCounty.stateCode}`
                        : "Hover or click a county"}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPan((p) => ({ ...p, x: p.x + 40 }))}
                  >
                    Left
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPan((p) => ({ ...p, x: p.x - 40 }))}
                  >
                    Right
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPan((p) => ({ ...p, y: p.y + 30 }))}
                  >
                    Up
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPan((p) => ({ ...p, y: p.y - 30 }))}
                  >
                    Down
                  </Button>
                </div>
                <div className="overflow-hidden rounded-md border bg-white">
                  <svg viewBox="0 0 960 600" className="h-[520px] w-full">
                    <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                      {countyFeatures.map((county) => {
                        const fips = String(county.id).padStart(5, "0");
                        const row = countyByFips.get(fips);
                        return (
                          <path
                            key={fips}
                            d={path(county) || ""}
                            fill={colorForCounty(fips)}
                            stroke={selectedFips === fips ? "#111827" : "#ffffff"}
                            strokeWidth={selectedFips === fips ? 1.3 / zoom : 0.35 / zoom}
                            opacity={row ? 1 : 0.62}
                            onMouseEnter={() => setHoveredFips(fips)}
                            onMouseLeave={() => setHoveredFips(null)}
                            onClick={() => setSelectedFips(fips)}
                            className="cursor-pointer transition-opacity hover:opacity-80"
                          />
                        );
                      })}
                    </g>
                  </svg>
                </div>
              </CardContent>
            </Card>

            <CountyPanel
              selectedCounty={selectedCounty}
              metric={metric}
              notes={notes}
              entities={entities}
              addNote={addNote}
              addEntity={addEntity}
            />
          </TabsContent>

          <TabsContent value="activity" className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active markets</CardTitle>
                <CardDescription>
                  Ranked by selected metric, then restaurant coverage.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : filteredCounties.length ? (
                  filteredCounties
                    .sort(
                      (a, b) =>
                        Number(b.metrics[metric] || 0) -
                          Number(a.metrics[metric] || 0) ||
                        Number(b.metrics.restaurants_total || 0) -
                          Number(a.metrics.restaurants_total || 0),
                    )
                    .map((county) => (
                      <button
                        key={county.countyFips}
                        className="w-full rounded-md border border-border p-4 text-left hover:bg-[color:var(--bg-surface-muted)]"
                        onClick={() => setSelectedFips(county.countyFips)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold">
                              {county.countyName}, {county.stateCode}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {county.countyFips}
                            </div>
                          </div>
                          <Badge variant="outline">
                            {coverageLabel(
                              Number(county.metrics.market_coverage_status || 0),
                            )}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                          <Metric label={metric} value={county.metrics[metric]} />
                          <Metric
                            label="restaurants"
                            value={county.metrics.restaurants_total}
                          />
                          <Metric
                            label="verified"
                            value={county.metrics.restaurants_verified}
                          />
                          <Metric
                            label="diners"
                            value={county.metrics.diners_total}
                          />
                        </div>
                      </button>
                    ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No stored market facts yet. Run refresh.
                  </p>
                )}
              </CardContent>
            </Card>

            <CountyPanel
              selectedCounty={selectedCounty}
              metric={metric}
              notes={notes}
              entities={entities}
              addNote={addNote}
              addEntity={addEntity}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-md bg-[color:var(--bg-surface-muted)] p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{Number(value || 0)}</div>
    </div>
  );
}

function CountyPanel({
  selectedCounty,
  metric,
  notes,
  entities,
  addNote,
  addEntity,
}: {
  selectedCounty: MarketCounty | null | undefined;
  metric: string;
  notes: MarketNote[];
  entities: MarketEntity[];
  addNote: FormMutation;
  addEntity: FormMutation;
}) {
  if (!selectedCounty) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Select a county to inspect market readiness.
        </CardContent>
      </Card>
    );
  }

  const coverage = coverageLabel(
    Number(selectedCounty.metrics.market_coverage_status || 0),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {selectedCounty.countyName}, {selectedCounty.stateCode}
            </CardTitle>
            <CardDescription>{selectedCounty.countyFips}</CardDescription>
          </div>
          <Badge>{coverage}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <Metric label={metric} value={selectedCounty.metrics[metric]} />
          <Metric
            label="restaurants"
            value={selectedCounty.metrics.restaurants_total}
          />
          <Metric label="verified" value={selectedCounty.metrics.restaurants_verified} />
          <Metric label="vendors" value={selectedCounty.metrics.vendors_total} />
        </div>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            Assignments
          </h3>
          {entities.length ? (
            <div className="space-y-2">
              {entities.map((entity) => (
                <div key={entity.id} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{entity.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {entity.entityType} · {entity.status}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No assignments yet.</p>
          )}
          <form className="space-y-2" onSubmit={(event) => addEntity.mutate(event)}>
            <select
              name="entityType"
              className="h-10 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
            >
              <option value="market_manager">Market manager</option>
              <option value="restaurant_partner">Restaurant partner</option>
              <option value="delivery_partner">Delivery partner</option>
              <option value="vendor">Vendor</option>
              <option value="affiliate">Affiliate</option>
              <option value="local_operator">Local operator</option>
            </select>
            <Input name="label" placeholder="Name or assignment label" required />
            <Input name="status" placeholder="active, prospect, blocked" />
            <Button size="sm" disabled={addEntity.isPending}>
              Assign
            </Button>
          </form>
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquarePlus className="h-4 w-4" />
            Notes
          </h3>
          {notes.length ? (
            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="rounded-md border p-3 text-sm">
                  <Badge variant="outline">{note.category}</Badge>
                  <p className="mt-2 whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
          <form className="space-y-2" onSubmit={(event) => addNote.mutate(event)}>
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              name="category"
              className="h-10 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
            >
              <option value="general">General</option>
              <option value="restaurant">Restaurant</option>
              <option value="delivery">Delivery</option>
              <option value="vendor">Vendor</option>
              <option value="operations">Operations</option>
              <option value="risk">Risk</option>
              <option value="growth">Growth</option>
            </select>
            <Textarea name="content" placeholder="Market note" required />
            <Button size="sm" disabled={addNote.isPending}>
              Add note
            </Button>
          </form>
        </section>
      </CardContent>
    </Card>
  );
}
