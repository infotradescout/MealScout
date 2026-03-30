import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  AlertCircle,
  Activity,
  Bell,
  CheckCircle,
  Radio,
  Shield,
  Ticket,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LisaClaimStreamItem = {
  id?: string;
  lane: string;
  app: string;
  source: string;
  claimType: string;
  subjectType: string;
  subjectId: string;
  actorType?: string | null;
  actorId?: string | null;
  claimValue: Record<string, unknown>;
  confidence?: string | number | null;
  createdAt: string;
};

type LisaClaimsResponse = {
  ok: boolean;
  total: number;
  generatedAt: string;
  laneCounts: Record<string, number>;
  items: LisaClaimStreamItem[];
};

type UnifiedSignalItem = {
  id: string;
  streamType: string;
  lane: string;
  family: string;
  source: string;
  subjectType: string;
  subjectId: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  visibility: "on_platform" | "off_platform";
};

type UnifiedSignalsResponse = {
  ok: boolean;
  total: number;
  generatedAt: string;
  windowHours: number;
  familyCounts: Record<string, number>;
  items: UnifiedSignalItem[];
};

type CanonicalEntityItem = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  location: string;
  canonicalPath: string;
  health: string;
  quality: string;
  freshness: string;
  freshnessHours: number | null;
  machineReadiness: string;
  canonicalFields: Record<string, unknown>;
  knowledgeGaps: string[];
  opportunities: string[];
  updatedAt: string;
};

type CanonicalEntitiesResponse = {
  ok: boolean;
  generatedAt: string;
  counts: Record<string, number>;
  items: CanonicalEntityItem[];
};

type PriorityEntityItem = CanonicalEntityItem & {
  priorityScore: number;
  crawlerDemand: number;
  reasons: string[];
};

type PriorityEntitiesResponse = {
  ok: boolean;
  generatedAt: string;
  windowHours: number;
  items: PriorityEntityItem[];
};

type BotTrafficResponse = {
  ok: boolean;
  windowHours: number;
  generatedAt: string;
  summary: {
    requests: number;
    botRequests: number;
    llmRequests: number;
    searchCrawlerRequests: number;
    humanBrowserRequests: number;
    automationRequests: number;
    uniqueAgents: number;
    uniqueIps: number;
    humanShare: number;
    llmShare: number;
    botShare: number;
  };
  categories: Record<string, number>;
  topAgents: Array<{
    label: string;
    category: string;
    hits: number;
    lastSeen: string | null;
    sampleUserAgent: string;
    topPaths: Array<{ path: string; hits: number }>;
  }>;
  topPaths: Array<{
    path: string;
    hits: number;
    llmHits: number;
    botHits: number;
    humanHits: number;
  }>;
  notes: string[];
};

const ENABLE_SOCKETS = import.meta.env.VITE_ENABLE_SOCKETS === "true";
const LISA_FEED_LIMIT = 40;

function formatSignalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarizeClaimValue(value: Record<string, unknown>) {
  const entries = Object.entries(value || {}).slice(0, 3);
  if (entries.length === 0) return "No payload";
  return entries
    .map(([key, raw]) => {
      const rendered =
        typeof raw === "string"
          ? raw
          : typeof raw === "number" || typeof raw === "boolean"
            ? String(raw)
            : Array.isArray(raw)
              ? `${raw.length} items`
              : raw && typeof raw === "object"
                ? "object"
                : "null";
      return `${key}: ${rendered}`;
    })
    .join(" | ");
}

export default function AdminControlCenter() {
  const [activeTab, setActiveTab] = useState("overview");
  const [liveClaims, setLiveClaims] = useState<LisaClaimStreamItem[]>([]);
  const [signalFeed, setSignalFeed] = useState<UnifiedSignalItem[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [laneQuery, setLaneQuery] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [claimTypeFilter, setClaimTypeFilter] = useState("all");
  const [selectedEntity, setSelectedEntity] = useState<CanonicalEntityItem | null>(
    null,
  );

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: health } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: lisaFeed, isLoading: isLisaLoading } =
    useQuery<LisaClaimsResponse>({
      queryKey: ["/api/admin/lisa/claims", LISA_FEED_LIMIT],
      queryFn: async () => {
        const res = await fetch(`/api/admin/lisa/claims?limit=${LISA_FEED_LIMIT}`);
        if (!res.ok) throw new Error("Failed to fetch LISA feed");
        return res.json();
      },
      refetchInterval: 30000,
    });

  const { data: unifiedSignals, isLoading: isSignalLoading } =
    useQuery<UnifiedSignalsResponse>({
      queryKey: ["/api/admin/lisa/signals", 80],
      queryFn: async () => {
        const res = await fetch("/api/admin/lisa/signals?limit=80&hours=72");
        if (!res.ok) throw new Error("Failed to fetch unified signals");
        return res.json();
      },
      refetchInterval: 15000,
    });

  const { data: botTraffic, isLoading: isBotTrafficLoading } =
    useQuery<BotTrafficResponse>({
      queryKey: ["/api/admin/bot-traffic", 48],
      queryFn: async () => {
        const res = await fetch("/api/admin/bot-traffic?hours=48");
        if (!res.ok) throw new Error("Failed to fetch bot traffic");
        return res.json();
      },
      refetchInterval: 60000,
    });

  const { data: canonicalEntities, isLoading: isEntityLoading } =
    useQuery<CanonicalEntitiesResponse>({
      queryKey: ["/api/admin/lisa/entities", 12],
      queryFn: async () => {
        const res = await fetch("/api/admin/lisa/entities?limit=12");
        if (!res.ok) throw new Error("Failed to fetch canonical entities");
        return res.json();
      },
      refetchInterval: 30000,
    });

  const { data: priorityEntities, isLoading: isPriorityLoading } =
    useQuery<PriorityEntitiesResponse>({
      queryKey: ["/api/admin/lisa/priorities", 12],
      queryFn: async () => {
        const res = await fetch("/api/admin/lisa/priorities?limit=12");
        if (!res.ok) throw new Error("Failed to fetch LISA priorities");
        return res.json();
      },
      refetchInterval: 30000,
    });

  useEffect(() => {
    setLiveClaims(lisaFeed?.items ?? []);
  }, [lisaFeed]);

  useEffect(() => {
    setSignalFeed(unifiedSignals?.items ?? []);
  }, [unifiedSignals]);

  useEffect(() => {
    if (!ENABLE_SOCKETS) {
      setSocketError("Realtime disabled by config");
      return;
    }

    const socketUrl = import.meta.env.DEV ? undefined : API_BASE_URL || undefined;
    const socket: Socket = io(socketUrl, {
      autoConnect: true,
      transports: ["polling", "websocket"],
      withCredentials: true,
      path: "/socket.io",
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      setSocketError(null);
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("connect_error", (error) => {
      setSocketConnected(false);
      setSocketError(error.message || "Realtime connection failed");
    });

    socket.on("lisa_claim", (payload: { claim: LisaClaimStreamItem }) => {
      setLiveClaims((current) => {
        const next = [payload.claim, ...current.filter((item) => item.id !== payload.claim.id)];
        return next.slice(0, LISA_FEED_LIMIT);
      });
      setSignalFeed((current) => {
        const liveSignal: UnifiedSignalItem = {
          id: `claim:${payload.claim.id || payload.claim.subjectId}`,
          streamType: "lisa_claim",
          lane: payload.claim.lane,
          family: "lisa",
          source: payload.claim.source,
          subjectType: payload.claim.subjectType,
          subjectId: payload.claim.subjectId,
          title: payload.claim.claimType,
          summary: `${payload.claim.subjectType} ${payload.claim.subjectId}`,
          payload: payload.claim.claimValue,
          createdAt: payload.claim.createdAt,
          visibility: "on_platform",
        };
        const next = [
          liveSignal,
          ...current.filter((item) => item.id !== liveSignal.id),
        ];
        return next
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 80);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const liveLaneCounts = useMemo(() => {
    return liveClaims.reduce(
      (acc, item) => {
        acc[item.lane] = (acc[item.lane] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [liveClaims]);

  const topLanes = useMemo(() => {
    return Object.entries(liveLaneCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [liveLaneCounts]);

  const visibleFamilyCounts = useMemo(() => {
    return signalFeed.reduce(
      (acc, item) => {
        acc[item.family] = (acc[item.family] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [signalFeed]);

  const filterOptions = useMemo(() => {
    const unique = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      );

    return {
      apps: unique(signalFeed.map((signal) => signal.family)),
      sources: unique(signalFeed.map((signal) => signal.source)),
      subjects: unique(signalFeed.map((signal) => signal.subjectType)),
      claimTypes: unique(signalFeed.map((signal) => signal.streamType)),
    };
  }, [signalFeed]);

  const filteredSignals = useMemo(() => {
    const query = laneQuery.trim().toLowerCase();
    return signalFeed.filter((signal) => {
      if (appFilter !== "all" && signal.family !== appFilter) return false;
      if (sourceFilter !== "all" && signal.source !== sourceFilter) return false;
      if (subjectFilter !== "all" && signal.subjectType !== subjectFilter)
        return false;
      if (claimTypeFilter !== "all" && signal.streamType !== claimTypeFilter)
        return false;
      if (
        selectedEntity &&
        !(
          signal.subjectType === selectedEntity.entityType &&
          signal.subjectId === selectedEntity.entityId
        ) &&
        String(signal.payload?.restaurantId || "") !== selectedEntity.entityId &&
        String(signal.payload?.hostId || "") !== selectedEntity.entityId
      ) {
        return false;
      }
      if (!query) return true;

      const haystack = [
        signal.lane,
        signal.family,
        signal.source,
        signal.streamType,
        signal.subjectType,
        signal.subjectId,
        signal.title,
        signal.summary,
        summarizeClaimValue(signal.payload),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [
    signalFeed,
    laneQuery,
    appFilter,
    sourceFilter,
    subjectFilter,
    claimTypeFilter,
    selectedEntity,
  ]);

  const knowledgeGapCounts = useMemo(() => {
    const items = canonicalEntities?.items ?? [];
    return items.reduce(
      (acc, entity) => {
        for (const gap of entity.knowledgeGaps || []) {
          acc[gap] = (acc[gap] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [canonicalEntities]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <div className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Admin Control Center</h1>
              <p className="text-[color:var(--text-muted)] mt-1">
                MealScout operations, moderation, and LISA signal lanes
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  health?.status === "healthy"
                    ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                    : "bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]"
                }`}
              >
                <div className="w-2 h-2 rounded-full bg-current" />
                <span className="text-sm font-medium">
                  {health?.status || "Unknown"}
                </span>
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  socketConnected
                    ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                    : "bg-[color:var(--status-warning)]/12 text-[color:var(--status-warning)]"
                }`}
              >
                <Radio className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {socketConnected ? "LISA live" : "LISA standby"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Incidents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.incidents?.total || 0}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-[color:var(--status-error)] font-medium">
                      {stats?.incidents?.open || 0} new
                    </span>
                    <span className="text-[color:var(--status-warning)] font-medium">
                      {stats?.incidents?.critical || 0} critical
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Support Tickets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.tickets?.open || 0}
                  </div>
                  <div className="text-xs text-[color:var(--status-warning)] font-medium">
                    {stats?.tickets?.highPriority || 0} high priority
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Moderation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.moderation?.recentEvents || 0}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    Last 7 days
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">LISA Signals</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">{signalFeed.length}</div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    Recent observed signals
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Bot Traffic</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {botTraffic?.summary?.llmRequests ?? 0}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    LLM crawler hits in the last {botTraffic?.windowHours ?? 48}h
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="min-w-[108px]">
              Overview
            </TabsTrigger>
            <TabsTrigger value="incidents" className="min-w-[120px] gap-2">
              <AlertCircle className="hidden h-4 w-4 sm:block" />
              Incidents
            </TabsTrigger>
            <TabsTrigger value="tickets" className="min-w-[108px] gap-2">
              <Ticket className="hidden h-4 w-4 sm:block" />
              Tickets
            </TabsTrigger>
            <TabsTrigger value="moderation" className="min-w-[132px] gap-2">
              <Shield className="hidden h-4 w-4 sm:block" />
              Moderation
            </TabsTrigger>
            <TabsTrigger value="audit" className="min-w-[96px] gap-2">
              <Activity className="hidden h-4 w-4 sm:block" />
              Audit
            </TabsTrigger>
            <TabsTrigger value="health" className="min-w-[96px] gap-2">
              <Bell className="hidden h-4 w-4 sm:block" />
              Health
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Quick Start</CardTitle>
                  <CardDescription>
                    Navigate the control lanes and watch live LISA signals
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" /> Incidents
                      </h3>
                      <p className="text-sm text-[color:var(--text-muted)] mb-3">
                        View and manage security incidents with signatures and
                        timelines.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("incidents")}
                      >
                        Manage
                      </Button>
                    </div>

                    <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <Ticket className="w-4 h-4" /> Support Tickets
                      </h3>
                      <p className="text-sm text-[color:var(--text-muted)] mb-3">
                        Handle user support requests and resolve issues.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("tickets")}
                      >
                        Manage
                      </Button>
                    </div>

                    <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Moderation
                      </h3>
                      <p className="text-sm text-[color:var(--text-muted)] mb-3">
                        Review reported content and take moderation actions.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("moderation")}
                      >
                        Manage
                      </Button>
                    </div>

                    <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <Activity className="w-4 h-4" /> Audit Logs
                      </h3>
                      <p className="text-sm text-[color:var(--text-muted)] mb-3">
                        Search and filter all platform activity.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("audit")}
                      >
                        View
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

            <Card>
              <CardHeader>
                  <CardTitle>Signal Family Index</CardTitle>
                  <CardDescription>
                    Which kinds of MealScout data are active right now
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.keys(visibleFamilyCounts).length === 0 ? (
                    <p className="text-sm text-[color:var(--text-muted)]">
                      {isSignalLoading ? "Loading signal families..." : "No signals yet."}
                    </p>
                  ) : (
                    Object.entries(visibleFamilyCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([family, count]) => (
                      <div
                        key={family}
                        className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-2"
                      >
                        <span className="text-sm font-medium break-all">{family}</span>
                        <Badge variant="outline">{count}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Truth Registry</CardTitle>
                <CardDescription>
                  Canonical entities MealScout currently knows how to describe
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {canonicalEntities
                    ? Object.entries(canonicalEntities.counts).map(([key, count]) => (
                        <Badge key={key} variant="outline">
                          {key} ({count})
                        </Badge>
                      ))
                    : null}
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Knowledge gaps</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(knowledgeGapCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([gap, count]) => (
                        <Badge key={gap} variant="outline">
                          {gap} ({count})
                        </Badge>
                      ))}
                    {Object.keys(knowledgeGapCounts).length === 0 ? (
                      <span className="text-sm text-[color:var(--text-muted)]">
                        No knowledge gaps detected in the current sample.
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {isEntityLoading ? (
                    <p className="text-sm text-[color:var(--text-muted)]">
                      Loading canonical entities...
                    </p>
                  ) : canonicalEntities?.items?.length ? (
                    canonicalEntities.items.slice(0, 8).map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        onClick={() =>
                          setSelectedEntity((current) =>
                            current?.id === entity.id ? null : entity,
                          )
                        }
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          selectedEntity?.id === entity.id
                            ? "border-[color:var(--accent-text)] bg-[color:var(--accent-text)]/8"
                            : "border-[var(--border-subtle)]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entity.title}</span>
                          <Badge variant="outline">{entity.entityType}</Badge>
                          <Badge variant="outline">{entity.health}</Badge>
                          <Badge variant="outline">{entity.quality}</Badge>
                          <Badge variant="outline">{entity.freshness}</Badge>
                          <Badge variant="outline">{entity.machineReadiness}</Badge>
                        </div>
                        <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                          {entity.location || entity.entityId}
                        </div>
                        <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                          {entity.canonicalPath}
                        </div>
                        <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                          {summarizeClaimValue(entity.canonicalFields)}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(entity.knowledgeGaps || []).slice(0, 4).map((gap) => (
                            <Badge key={gap} variant="outline">
                              gap: {gap}
                            </Badge>
                          ))}
                          {(entity.opportunities || []).slice(0, 3).map((opportunity) => (
                            <Badge key={opportunity} variant="outline">
                              next: {opportunity}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                          Updated {formatSignalTime(entity.updatedAt)}
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-[color:var(--text-muted)]">
                      No canonical entities available.
                    </p>
                  )}
                </div>
                {selectedEntity ? (
                  <div className="flex items-center justify-between rounded-lg border border-[color:var(--accent-text)]/30 bg-[color:var(--accent-text)]/8 px-3 py-2 text-sm">
                    <span>
                      Stream focused on {selectedEntity.entityType}: {selectedEntity.title}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedEntity(null)}
                    >
                      Clear focus
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fix First Queue</CardTitle>
                <CardDescription>
                  Ranked entities where weak knowledge overlaps with likely demand
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isPriorityLoading ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Loading priority queue...
                  </p>
                ) : priorityEntities?.items?.length ? (
                  priorityEntities.items.map((entity) => (
                    <button
                      key={`priority-${entity.id}`}
                      type="button"
                      onClick={() => setSelectedEntity(entity)}
                      className="w-full rounded-xl border border-[var(--border-subtle)] p-4 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{entity.title}</span>
                        <Badge variant="outline">{entity.entityType}</Badge>
                        <Badge variant="outline">score {entity.priorityScore}</Badge>
                        <Badge variant="outline">{entity.crawlerDemand} crawler hits</Badge>
                        <Badge variant="outline">{entity.machineReadiness}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                        {entity.location || entity.entityId}
                      </div>
                      <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                        {entity.canonicalPath}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entity.reasons.map((reason) => (
                          <Badge key={reason} variant="outline">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    No priority entities detected.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>MealScout Signal Stream</CardTitle>
                    <CardDescription>
                      Unified on-platform and observed off-platform intelligence
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        socketConnected
                          ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                          : "bg-[color:var(--status-warning)]/12 text-[color:var(--status-warning)]"
                      }
                    >
                      {socketConnected ? "Streaming now" : "History only"}
                    </Badge>
                    <Badge variant="outline">{filteredSignals.length} signals</Badge>
                    {selectedEntity ? (
                      <Badge variant="outline">
                        Focus: {selectedEntity.entityType}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Input
                    value={laneQuery}
                    onChange={(event) => setLaneQuery(event.target.value)}
                    placeholder="Search signals, pages, bots, payload"
                  />
                  <select
                    value={appFilter}
                    onChange={(event) => setAppFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">All families</option>
                    {filterOptions.apps.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">All sources</option>
                    {filterOptions.sources.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    value={subjectFilter}
                    onChange={(event) => setSubjectFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">All subjects</option>
                    {filterOptions.subjects.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    value={claimTypeFilter}
                    onChange={(event) => setClaimTypeFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">All stream types</option>
                    {filterOptions.claimTypes.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>

                {socketError ? (
                  <div className="rounded-lg border border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 px-3 py-2 text-sm text-[color:var(--status-warning)]">
                    {socketError}
                  </div>
                ) : null}

                <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {filteredSignals.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-muted)]">
                      {isSignalLoading
                        ? "Loading signal stream..."
                        : "No signals match the current filters."}
                    </p>
                  ) : (
                    filteredSignals.map((signal) => (
                      <div
                        key={`${signal.id}-${signal.createdAt}`}
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-2 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{signal.lane}</Badge>
                              <Badge variant="outline">{signal.streamType}</Badge>
                              <Badge variant="outline">{signal.visibility}</Badge>
                              <span className="text-xs text-[color:var(--text-muted)]">
                                {formatSignalTime(signal.createdAt)}
                              </span>
                            </div>
                            <div className="text-sm">
                              <span className="font-medium">{signal.title}</span>
                              <span className="text-[color:var(--text-muted)]">
                                {" "}
                                {signal.subjectType}:{signal.subjectId}
                              </span>
                            </div>
                            <p className="text-sm text-[color:var(--text-muted)] break-all">
                              {signal.summary}
                            </p>
                            <p className="text-xs text-[color:var(--text-muted)] break-all">
                              {summarizeClaimValue(signal.payload)}
                            </p>
                          </div>

                          <div className="text-xs text-[color:var(--text-muted)] md:text-right">
                            <div>{signal.family}</div>
                            <div>{signal.source}</div>
                            <div>{signal.subjectType}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bot Traffic Intelligence</CardTitle>
                <CardDescription>
                  Decoded crawler demand across LLMs, search bots, automation,
                  and browser traffic
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isBotTrafficLoading ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Loading bot traffic...
                  </p>
                ) : botTraffic ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Total requests
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {botTraffic.summary.requests}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          LLM crawler hits
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {botTraffic.summary.llmRequests}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          {(botTraffic.summary.llmShare * 100).toFixed(1)}% share
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Search crawler hits
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {botTraffic.summary.searchCrawlerRequests}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Human browser hits
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {botTraffic.summary.humanBrowserRequests}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          {botTraffic.summary.uniqueAgents} agents,{" "}
                          {botTraffic.summary.uniqueIps} IPs
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                      <div className="space-y-3">
                        <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                          <div className="text-sm font-medium">Traffic mix</div>
                          <div className="mt-3 space-y-2">
                            {Object.entries(botTraffic.categories)
                              .sort((a, b) => b[1] - a[1])
                              .map(([category, count]) => (
                                <div
                                  key={category}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <span className="text-[color:var(--text-muted)]">
                                    {category}
                                  </span>
                                  <Badge variant="outline">{count}</Badge>
                                </div>
                              ))}
                          </div>
                        </div>

                        <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                          <div className="text-sm font-medium">Interpretation</div>
                          <div className="mt-3 space-y-2 text-sm text-[color:var(--text-muted)]">
                            {botTraffic.notes.map((note) => (
                              <p key={note}>{note}</p>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Top crawler agents</div>
                        <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                          {botTraffic.topAgents.map((agent) => (
                            <div
                              key={`${agent.label}-${agent.category}`}
                              className="rounded-lg border border-[var(--border-subtle)] p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{agent.label}</span>
                                <Badge variant="outline">{agent.category}</Badge>
                                <Badge variant="outline">{agent.hits} hits</Badge>
                              </div>
                              <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                                Last seen{" "}
                                {agent.lastSeen
                                  ? formatSignalTime(agent.lastSeen)
                                  : "unknown"}
                              </div>
                              <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                                {agent.sampleUserAgent || "No user agent captured"}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {agent.topPaths.map((path) => (
                                  <Badge key={path.path} variant="outline">
                                    {path.path} ({path.hits})
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                      <div className="text-sm font-medium">Most requested paths</div>
                      <div className="mt-3 space-y-2">
                        {botTraffic.topPaths.slice(0, 10).map((path) => (
                          <div
                            key={path.path}
                            className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 md:flex-row md:items-center md:justify-between"
                          >
                            <span className="text-sm break-all">{path.path}</span>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <Badge variant="outline">{path.hits} total</Badge>
                              <Badge variant="outline">{path.llmHits} LLM</Badge>
                              <Badge variant="outline">{path.botHits} bot</Badge>
                              <Badge variant="outline">{path.humanHits} human</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Bot traffic data is unavailable.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="incidents">
            <Card>
              <CardHeader>
                <CardTitle>Incidents</CardTitle>
                <CardDescription>View and manage system incidents</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Incidents module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets">
            <Card>
              <CardHeader>
                <CardTitle>Support Tickets</CardTitle>
                <CardDescription>View and manage support tickets</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Support tickets module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="moderation">
            <Card>
              <CardHeader>
                <CardTitle>Moderation Events</CardTitle>
                <CardDescription>
                  View and manage moderation events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Moderation events module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle>Audit Logs</CardTitle>
                <CardDescription>View system audit logs</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Audit logs module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="health">
            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
                <CardDescription>
                  Background jobs and service status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Database Connection</h3>
                    <Badge className="bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]">
                      Connected
                    </Badge>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Server Status</h3>
                    <Badge className="bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]">
                      Operational
                    </Badge>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Escalations Job</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-[color:var(--status-success)]" />
                      <span>Running (every 15 minutes)</span>
                    </div>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Auto-Close Job</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-[color:var(--status-success)]" />
                      <span>Running (daily)</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[color:var(--accent-text)]/10 border border-[color:var(--accent-text)]/30 rounded-lg">
                  <p className="text-sm text-[color:var(--accent-text)]">
                    Info: All background jobs are configured and running. Check
                    Vercel Cron for scheduled execution in production.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
