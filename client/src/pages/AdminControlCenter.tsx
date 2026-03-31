import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";

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
  recommendedActions: Array<{
    id: string;
    label: string;
    href: string;
    kind: "admin" | "public";
  }>;
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

type AuthorityGapItem = CanonicalEntityItem & {
  crawlerHits: number;
  humanHits: number;
  authorityDelta: number;
  pressure: string;
};

type AuthorityGapResponse = {
  ok: boolean;
  generatedAt: string;
  windowHours: number;
  items: AuthorityGapItem[];
};

type MarketIntelResponse = {
  ok: boolean;
  generatedAt: string;
  brief: {
    headline: string;
    audienceAngle: string;
    inventoryAngle: string;
    acquisitionAngle: string;
    recommendedPackage: string[];
  };
  advertiserSignals: {
    topQueries: Array<{ query: string; count: number }>;
    cityDemand: Array<{
      businessName: string | null;
      address: string | null;
      locationType: string | null;
      requestCount: number;
      interestCount: number;
    }>;
    cuisineDemand: Array<{
      cuisineType: string | null;
      restaurantCount: number;
      avgRankingScore: number;
    }>;
    geoAds: {
      impressions: number;
      clicks: number;
      ctr: number;
    };
    footTraffic: {
      totalPings: number;
      uniqueVisitors: number;
    };
  };
  contentMomentum: Array<{
    id: string;
    title: string;
    restaurantId: string | null;
    viewCount: number;
    impressionCount: number;
    createdAt: string;
  }>;
  acquisitionTargets: Array<{
    id: string;
    title: string;
    entityType: string;
    canonicalPath: string;
    location: string;
    machineReadiness: string;
    quality: string;
    crawlerHits: number;
    advertiserScore: number;
    reasons: string[];
  }>;
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

type RemediationLogItem = {
  id: string;
  userId: string | null;
  createdAt: string;
  entityType: string;
  entityId: string;
  actionId: string;
  actionLabel: string;
  actionHref: string;
  actionKind: string;
  status: "started" | "completed";
  notes?: string;
};

type RemediationLogResponse = {
  ok: boolean;
  generatedAt: string;
  windowHours: number;
  items: RemediationLogItem[];
  latest: RemediationLogItem[];
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

function isOperationalNoiseSignal(signal: UnifiedSignalItem) {
  const path = String(signal.subjectId || signal.payload?.path || "").toLowerCase();
  return (
    signal.streamType === "external_crawler" &&
    (path === "/api/health" ||
      path === "/health" ||
      path.startsWith("/api/admin/health") ||
      path.startsWith("/api/auth/admin/verify"))
  );
}

function signalPriorityScore(signal: UnifiedSignalItem) {
  let score = 0;
  if (signal.visibility === "off_platform") score += 1;
  if (signal.family === "commerce") score += 5;
  if (signal.family === "events") score += 5;
  if (signal.family === "distribution") score += 4;
  if (signal.family === "search") score += 4;
  if (signal.family === "external") score += 3;
  if (signal.family === "mobility") score += 3;
  if (signal.streamType === "external_crawler") score += 1;
  if (signal.streamType === "deal_created") score += 3;
  if (signal.streamType === "event_created") score += 3;
  if (signal.streamType === "social_post") score += 2;
  if (signal.subjectType === "restaurant" || signal.subjectType === "event") score += 2;
  return score;
}

function toPlainLabel(value: string) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEntitySummary(entity: CanonicalEntityItem) {
  const issue = entity.knowledgeGaps?.[0]
    ? `Main issue: ${toPlainLabel(entity.knowledgeGaps[0])}.`
    : "";
  const nextMove = entity.opportunities?.[0]
    ? `Next move: ${toPlainLabel(entity.opportunities[0])}.`
    : "";
  return `This ${entity.entityType} is ${toPlainLabel(entity.quality)}, ${toPlainLabel(
    entity.freshness,
  )}, and ${toPlainLabel(entity.machineReadiness)}. ${issue} ${nextMove}`.trim();
}

function buildPrioritySummary(entity: PriorityEntityItem) {
  const reason = entity.reasons?.[0]
    ? `Main issue: ${toPlainLabel(entity.reasons[0])}.`
    : "";
  return `Demand is already forming here, but the page is still ${toPlainLabel(
    entity.quality,
  )} and ${toPlainLabel(entity.machineReadiness)}. ${reason}`.trim();
}

function buildAuthoritySummary(entity: AuthorityGapItem) {
  const gap = entity.knowledgeGaps?.[0]
    ? `Main gap: ${toPlainLabel(entity.knowledgeGaps[0])}.`
    : "";
  return `Outside systems hit this page ${entity.crawlerHits} times while it is still ${toPlainLabel(
    entity.machineReadiness,
  )} and ${toPlainLabel(entity.freshness)}. ${gap}`.trim();
}

function buildSignalSummary(signal: UnifiedSignalItem) {
  if (signal.streamType === "deal_created") {
    return "A deal is live or was just created. This is something you can promote or attach to paid visibility right now.";
  }
  if (signal.streamType === "event_created") {
    return "A new event is active. This is useful for promotion, local demand capture, and sponsor packaging.";
  }
  if (signal.streamType === "social_post") {
    return "MealScout pushed something outward. This matters because distribution is happening off-platform.";
  }
  if (signal.streamType === "external_crawler") {
    return `An outside system checked ${signal.subjectId || "a MealScout page"}. This matters because machines are deciding whether this page is worth using or citing.`;
  }
  if (signal.family === "search") {
    return "Search demand is appearing around this topic. This is a signal to publish, promote, or improve coverage here.";
  }
  if (signal.family === "mobility") {
    return "A live location changed. This matters because freshness and place accuracy drive trust and discovery.";
  }
  if (signal.family === "distribution") {
    return "This is an outward distribution signal. It matters because content or offers are reaching beyond the platform.";
  }
  return "This is a recent MealScout activity signal. Use it to decide what to promote, improve, or watch next.";
}

function buildSignalNextStep(signal: UnifiedSignalItem) {
  if (signal.streamType === "deal_created") {
    return "Next step: feature the deal, pair it with traffic sources, or sell it into a sponsor package.";
  }
  if (signal.streamType === "event_created") {
    return "Next step: push event visibility and make sure the page has enough detail to convert interest.";
  }
  if (signal.streamType === "social_post") {
    return "Next step: check whether the destination page is strong enough to benefit from that attention.";
  }
  if (signal.streamType === "external_crawler") {
    return "Next step: strengthen the page being hit so outside machines find better facts, freshness, and structure.";
  }
  if (signal.family === "search") {
    return "Next step: build or improve the page that best matches this demand before traffic leaks elsewhere.";
  }
  if (signal.family === "mobility") {
    return "Next step: confirm the location data is accurate and visible on the public page.";
  }
  return "Next step: decide whether this signal should trigger promotion, cleanup, or closer monitoring.";
}

function buildSignalClusterKey(signal: UnifiedSignalItem) {
  if (signal.streamType === "external_crawler") {
    return `external:${signal.subjectId}`;
  }
  if (signal.streamType === "deal_created") {
    return `deal:${String(signal.payload?.restaurantId || signal.subjectId)}`;
  }
  if (signal.streamType === "event_created") {
    return `event:${String(signal.payload?.hostId || signal.subjectId)}`;
  }
  if (signal.family === "distribution") {
    return `distribution:${signal.source}`;
  }
  if (signal.family === "mobility") {
    return `mobility:${signal.subjectId}`;
  }
  return `${signal.family}:${signal.subjectType}:${signal.subjectId}`;
}

function buildSignalClusterSummary(signals: UnifiedSignalItem[]) {
  const lead = signals[0];
  const count = signals.length;
  if (lead.streamType === "external_crawler") {
    return {
      title: `${count} machine checks on ${lead.subjectId}`,
      why: "Outside systems are repeatedly looking at this page, which usually means it is becoming discovery-relevant.",
      next: "Make sure the page is fresh, specific, and worth citing.",
    };
  }
  if (lead.streamType === "deal_created") {
    return {
      title: `${count} deal signal${count === 1 ? "" : "s"} tied to this restaurant`,
      why: "Deals are one of the clearest monetizable promotion surfaces in MealScout.",
      next: "Feature the strongest deal and pair it with demand or ad inventory.",
    };
  }
  if (lead.streamType === "event_created") {
    return {
      title: `${count} event signal${count === 1 ? "" : "s"} around this host or event`,
      why: "Events create timely demand and are strong candidates for promotion packages.",
      next: "Push visibility while the timing is still relevant.",
    };
  }
  if (lead.family === "distribution") {
    return {
      title: `${count} outbound distribution action${count === 1 ? "" : "s"} on ${lead.source}`,
      why: "MealScout is sending attention outward, so the destination pages need to be strong.",
      next: "Verify that the linked pages are conversion-ready before more traffic lands.",
    };
  }
  if (lead.family === "mobility") {
    return {
      title: `${count} location update${count === 1 ? "" : "s"} for ${lead.subjectId}`,
      why: "Fresh location data increases trust and helps discovery surfaces stay accurate.",
      next: "Confirm the public page reflects the latest location details.",
    };
  }
  return {
    title: `${count} related ${toPlainLabel(lead.family)} signal${count === 1 ? "" : "s"}`,
    why: "Several related signals appeared together, which usually means this topic deserves attention now.",
    next: "Review the cluster and decide whether it should trigger promotion, cleanup, or follow-up.",
  };
}

function buildOpportunityBrief(item: {
  title: string;
  why: string;
  next: string;
}) {
  return `${item.title}. ${item.why} ${item.next}`;
}

export default function AdminControlCenter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
  const [usefulOnly, setUsefulOnly] = useState(true);
  const [briefStatus, setBriefStatus] = useState<Record<string, { until: number }>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("lisa-control-brief-state-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(parsed || {}).filter(([, value]: any) => Number(value?.until || 0) > now),
      ) as Record<string, { until: number }>;
    } catch {
      return {};
    }
  });
  const [selectedEntity, setSelectedEntity] = useState<CanonicalEntityItem | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "lisa-control-brief-state-v1",
      JSON.stringify(briefStatus),
    );
  }, [briefStatus]);

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

  const { data: authorityGap, isLoading: isAuthorityGapLoading } =
    useQuery<AuthorityGapResponse>({
      queryKey: ["/api/admin/lisa/authority-gap", 12],
      queryFn: async () => {
        const res = await fetch("/api/admin/lisa/authority-gap?limit=12");
        if (!res.ok) throw new Error("Failed to fetch LISA authority gap");
        return res.json();
      },
      refetchInterval: 30000,
    });

  const { data: marketIntel, isLoading: isMarketIntelLoading } =
    useQuery<MarketIntelResponse>({
      queryKey: ["/api/admin/lisa/market-intel"],
      queryFn: async () => {
        const res = await fetch("/api/admin/lisa/market-intel");
        if (!res.ok) throw new Error("Failed to fetch market intel");
        return res.json();
      },
      refetchInterval: 30000,
    });

  const { data: remediationLog } = useQuery<RemediationLogResponse>({
    queryKey: ["/api/admin/lisa/remediations"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/remediations?hours=720");
      if (!res.ok) throw new Error("Failed to fetch remediations");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const remediationMutation = useMutation({
    mutationFn: async (payload: {
      entityType: string;
      entityId: string;
      actionId: string;
      actionLabel: string;
      actionHref: string;
      actionKind: "admin" | "public";
      status: "started" | "completed";
    }) => {
      const res = await fetch("/api/admin/lisa/remediations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || "Failed to log remediation");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lisa/remediations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lisa/signals", 80] });
      toast({
        title:
          variables.status === "completed"
            ? "Remediation completed"
            : "Remediation started",
        description: `${variables.actionLabel} logged for ${variables.entityType}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Remediation failed",
        description: error?.message || "Could not log remediation action.",
        variant: "destructive",
      });
    },
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
    return signalFeed
      .filter((signal) => {
        if (usefulOnly && isOperationalNoiseSignal(signal)) return false;
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
      })
      .sort((a, b) => {
        const scoreDiff = signalPriorityScore(b) - signalPriorityScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
  }, [
    signalFeed,
    laneQuery,
    appFilter,
    sourceFilter,
    subjectFilter,
    claimTypeFilter,
    selectedEntity,
    usefulOnly,
  ]);

  const signalHighlights = useMemo(() => {
    const items = filteredSignals.slice(0, 24);
    const counts = items.reduce(
      (acc, signal) => {
        acc[signal.family] = (acc[signal.family] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [filteredSignals]);

  const groupedSignalSummaries = useMemo(() => {
    const clusters = new Map<string, UnifiedSignalItem[]>();
    for (const signal of filteredSignals.slice(0, 40)) {
      const key = buildSignalClusterKey(signal);
      const existing = clusters.get(key) ?? [];
      existing.push(signal);
      clusters.set(key, existing);
    }

    return Array.from(clusters.values())
      .filter((signals) => signals.length > 1)
      .sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        return (
          new Date(b[0].createdAt).getTime() - new Date(a[0].createdAt).getTime()
        );
      })
      .slice(0, 6);
  }, [filteredSignals]);

  const canonicalEntityMap = useMemo(() => {
    const map = new Map<string, CanonicalEntityItem>();
    for (const entity of canonicalEntities?.items ?? []) {
      map.set(`${entity.entityType}:${entity.entityId}`, entity);
    }
    return map;
  }, [canonicalEntities]);

  const dailyPromotionOpportunity = useMemo(() => {
    if (!marketIntel?.contentMomentum?.length) return null;
    const item = marketIntel.contentMomentum[0];
    const linkedEntity = item.restaurantId
      ? canonicalEntityMap.get(`restaurant:${item.restaurantId}`)
      : null;
    return {
      briefKey: `promote:${item.id}`,
      title: item.title || "Top promotion opportunity",
      why: `${Number(item.viewCount ?? 0)} views and ${Number(item.impressionCount ?? 0)} impressions show live attention.`,
      next: "Promote it now or pair it with a deal, event, or sponsor slot while attention is active.",
      actionLabel: linkedEntity ? "Focus restaurant" : "Open livestream",
      onAction: () => {
        if (linkedEntity) {
          focusEntity(linkedEntity, "overview");
          return;
        }
        setActiveTab("livestream");
      },
    };
  }, [canonicalEntityMap, marketIntel]);

  const dailyImprovementOpportunity = useMemo(() => {
    if (!priorityEntities?.items?.length) return null;
    const item = priorityEntities.items[0];
    return {
      briefKey: `improve:${item.id}`,
      title: item.title || "Top page to improve",
      why: `Demand is forming here, but the page is still ${toPlainLabel(item.quality)} and ${toPlainLabel(item.machineReadiness)}.`,
      next:
        item.reasons?.[0]
          ? `Fix ${toPlainLabel(item.reasons[0])} first.`
          : "Improve the page quality and freshness first.",
      actionLabel: "Focus page",
      onAction: () => focusEntity(item, "overview"),
    };
  }, [priorityEntities]);

  const dailyAcquisitionOpportunity = useMemo(() => {
    if (!marketIntel?.acquisitionTargets?.length) return null;
    const item = marketIntel.acquisitionTargets[0];
    const entityId = String(item.id || "").split(":")[1] || item.id;
    const linkedEntity =
      canonicalEntityMap.get(`${item.entityType}:${entityId}`) ?? null;
    return {
      briefKey: `acquire:${item.id}`,
      title: item.title || "Top acquisition target",
      why: `${Number(item.crawlerHits ?? 0)} machine hits suggest outside interest is ahead of asset quality.`,
      next: "Review it for acquisition, partnership, or direct improvement before someone else captures the attention.",
      actionLabel: linkedEntity ? "Focus target" : "Open page",
      onAction: () => {
        if (linkedEntity) {
          focusEntity(linkedEntity, "overview");
          return;
        }
        window.location.href = item.canonicalPath || "/admin/control-center";
      },
    };
  }, [canonicalEntityMap, marketIntel]);

  const dailyMachineAttentionOpportunity = useMemo(() => {
    const item = filteredSignals.find((signal) => signal.visibility === "off_platform");
    if (!item) return null;
    return {
      briefKey: `machine:${item.id}`,
      title: item.title || "Top machine-attention opportunity",
      why: buildSignalSummary(item),
      next: buildSignalNextStep(item).replace(/^Next step:\s*/i, ""),
      actionLabel: "Open livestream",
      onAction: () => {
        setActiveTab("livestream");
        setLaneQuery(String(item.subjectId || ""));
      },
    };
  }, [filteredSignals]);

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

  const actionPlaybookCounts = useMemo(() => {
    const items = canonicalEntities?.items ?? [];
    return items.reduce(
      (acc, entity) => {
        for (const action of entity.recommendedActions || []) {
          acc[action.label] = (acc[action.label] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [canonicalEntities]);

  const latestRemediationByAction = useMemo(() => {
    const items = remediationLog?.latest ?? [];
    return items.reduce(
      (acc, item) => {
        acc[`${item.entityType}:${item.entityId}:${item.actionId}`] = item;
        return acc;
      },
      {} as Record<string, RemediationLogItem>,
    );
  }, [remediationLog]);

  const focusEntity = (entity: CanonicalEntityItem | null, tab: string = "overview") => {
    if (!entity) return;
    setSelectedEntity(entity);
    setActiveTab(tab);
  };

  const deferBrief = (briefKey: string, mode: "dismiss" | "snooze" | "done") => {
    const hours = mode === "done" ? 24 * 7 : mode === "snooze" ? 4 : 16;
    setBriefStatus((current) => ({
      ...current,
      [briefKey]: { until: Date.now() + hours * 60 * 60 * 1000 },
    }));
  };

  const isBriefVisible = (briefKey?: string) => {
    if (!briefKey) return false;
    return (briefStatus[briefKey]?.until ?? 0) <= Date.now();
  };

  const visibleDailyPromotionOpportunity =
    dailyPromotionOpportunity && isBriefVisible(dailyPromotionOpportunity.briefKey)
      ? dailyPromotionOpportunity
      : null;
  const visibleDailyImprovementOpportunity =
    dailyImprovementOpportunity && isBriefVisible(dailyImprovementOpportunity.briefKey)
      ? dailyImprovementOpportunity
      : null;
  const visibleDailyAcquisitionOpportunity =
    dailyAcquisitionOpportunity && isBriefVisible(dailyAcquisitionOpportunity.briefKey)
      ? dailyAcquisitionOpportunity
      : null;
  const visibleDailyMachineAttentionOpportunity =
    dailyMachineAttentionOpportunity &&
    isBriefVisible(dailyMachineAttentionOpportunity.briefKey)
      ? dailyMachineAttentionOpportunity
      : null;

  const renderActionControls = (entity: CanonicalEntityItem) =>
    (entity.recommendedActions || []).slice(0, 3).map((action) => {
      const remediationKey = `${entity.entityType}:${entity.entityId}:${action.id}`;
      const latestRemediation = latestRemediationByAction[remediationKey];
      return (
        <div
          key={action.id}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs"
        >
          <a
            href={action.href}
            className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            onClick={(event) => event.stopPropagation()}
          >
            {action.label}
          </a>
          <button
            type="button"
            className="rounded border border-[var(--border-subtle)] px-2 py-0.5 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            onClick={(event) => {
              event.stopPropagation();
              remediationMutation.mutate({
                entityType: entity.entityType,
                entityId: entity.entityId,
                actionId: action.id,
                actionLabel: action.label,
                actionHref: action.href,
                actionKind: action.kind,
                status: "started",
              });
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border-subtle)] px-2 py-0.5 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            onClick={(event) => {
              event.stopPropagation();
              remediationMutation.mutate({
                entityType: entity.entityType,
                entityId: entity.entityId,
                actionId: action.id,
                actionLabel: action.label,
                actionHref: action.href,
                actionKind: action.kind,
                status: "completed",
              });
            }}
          >
            Done
          </button>
          {latestRemediation ? (
            <Badge variant="outline">{latestRemediation.status}</Badge>
          ) : null}
        </div>
      );
    });

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
          <TabsList className="flex w-full flex-nowrap justify-start overflow-x-auto">
            <TabsTrigger value="overview" className="min-w-[108px]">
              Overview
            </TabsTrigger>
            <TabsTrigger value="livestream" className="min-w-[120px] gap-2">
              <Radio className="hidden h-4 w-4 sm:block" />
              Livestream
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
            <Card>
              <CardHeader>
                <CardTitle>Daily Operating Brief</CardTitle>
                <CardDescription>
                  The best promotion, improvement, acquisition, and machine-attention opportunity right now
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Best thing to promote</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyPromotionOpportunity
                      ? buildOpportunityBrief(visibleDailyPromotionOpportunity)
                      : "No clear promotion opportunity yet."}
                  </div>
                  {visibleDailyPromotionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyPromotionOpportunity.onAction}>
                        {visibleDailyPromotionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Most valuable page to improve</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyImprovementOpportunity
                      ? buildOpportunityBrief(visibleDailyImprovementOpportunity)
                      : "No clear page-improvement target yet."}
                  </div>
                  {visibleDailyImprovementOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyImprovementOpportunity.onAction}>
                        {visibleDailyImprovementOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Most promising acquisition target</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyAcquisitionOpportunity
                      ? buildOpportunityBrief(visibleDailyAcquisitionOpportunity)
                      : "No obvious acquisition target yet."}
                  </div>
                  {visibleDailyAcquisitionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyAcquisitionOpportunity.onAction}>
                        {visibleDailyAcquisitionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Biggest machine-attention opportunity</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyMachineAttentionOpportunity
                      ? buildOpportunityBrief(visibleDailyMachineAttentionOpportunity)
                      : "No meaningful outside-machine attention yet."}
                  </div>
                  {visibleDailyMachineAttentionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyMachineAttentionOpportunity.onAction}>
                        {visibleDailyMachineAttentionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

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
                    <div className="p-4 border border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/5 rounded-lg">
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <Radio className="w-4 h-4" /> LISA Livestream
                      </h3>
                      <p className="text-sm text-[color:var(--text-muted)] mb-3">
                        Watch the live MealScout signal feed with filters for lanes,
                        sources, subjects, and stream types.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => setActiveTab("livestream")}>
                          Open Livestream
                        </Button>
                        <Badge
                          className={
                            socketConnected
                              ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                              : "bg-[color:var(--status-warning)]/12 text-[color:var(--status-warning)]"
                          }
                        >
                          {socketConnected ? "Live stream connected" : "Signal history only"}
                        </Badge>
                      </div>
                    </div>

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
                  <CardTitle>What Is Active Right Now</CardTitle>
                  <CardDescription>
                    The main kinds of business activity showing up across MealScout
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
                <CardTitle>Important Pages And Entities</CardTitle>
                <CardDescription>
                  The trucks, hosts, deals, and events MealScout can currently stand behind
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
                  <div className="text-sm font-medium">What is missing</div>
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

                <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Most common next moves</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(actionPlaybookCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([label, count]) => (
                        <Badge key={label} variant="outline">
                          {label} ({count})
                        </Badge>
                      ))}
                    {Object.keys(actionPlaybookCounts).length === 0 ? (
                      <span className="text-sm text-[color:var(--text-muted)]">
                        No remediation actions available in the current sample.
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
                          <Badge variant="outline">{toPlainLabel(entity.health)}</Badge>
                          <Badge variant="outline">{toPlainLabel(entity.quality)}</Badge>
                          <Badge variant="outline">{toPlainLabel(entity.freshness)}</Badge>
                          <Badge variant="outline">{toPlainLabel(entity.machineReadiness)}</Badge>
                        </div>
                        <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                          {entity.location || entity.entityId}
                        </div>
                        <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                          {entity.canonicalPath}
                        </div>
                        <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                          {buildEntitySummary(entity)}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(entity.knowledgeGaps || []).slice(0, 2).map((gap) => (
                            <Badge key={gap} variant="outline">
                              missing: {toPlainLabel(gap)}
                            </Badge>
                          ))}
                          {(entity.opportunities || []).slice(0, 2).map((opportunity) => (
                            <Badge key={opportunity} variant="outline">
                              next: {toPlainLabel(opportunity)}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderActionControls(entity)}
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
                <CardTitle>Promote, Sell, Or Acquire</CardTitle>
                <CardDescription>
                  Demand, momentum, sponsor angles, and assets worth improving or buying
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isMarketIntelLoading ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Loading market intelligence...
                  </p>
                ) : marketIntel ? (
                  <>
                    <div className="rounded-xl border border-[color:var(--accent-text)]/25 bg-[color:var(--accent-text)]/8 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="text-sm font-medium">What matters now</div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href="/api/admin/lisa/market-intel/export?type=advertiser_brief&format=markdown"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            Export brief
                          </a>
                          <a
                            href="/api/admin/lisa/market-intel/export?type=acquisition_watchlist&format=markdown"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            Export watchlist
                          </a>
                          <a
                            href="/api/admin/lisa/market-intel/export?type=sponsor_package&format=json"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            Export package JSON
                          </a>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <p>{marketIntel.brief.headline}</p>
                        <p className="text-[color:var(--text-muted)]">
                          {marketIntel.brief.audienceAngle}
                        </p>
                        <p className="text-[color:var(--text-muted)]">
                          {marketIntel.brief.inventoryAngle}
                        </p>
                        <p className="text-[color:var(--text-muted)]">
                          {marketIntel.brief.acquisitionAngle}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {marketIntel.brief.recommendedPackage.map((item) => (
                          <Badge key={item} variant="outline">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Geo ad impressions
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {marketIntel.advertiserSignals.geoAds.impressions}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          CTR {(marketIntel.advertiserSignals.geoAds.ctr * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Foot traffic pings
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {marketIntel.advertiserSignals.footTraffic.totalPings}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          {marketIntel.advertiserSignals.footTraffic.uniqueVisitors} unique visitors
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Search demand themes
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {marketIntel.advertiserSignals.topQueries.length}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Top advertiser keyword inputs
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          Acquisition targets
                        </div>
                        <div className="mt-2 text-2xl font-bold">
                          {marketIntel.acquisitionTargets.length}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          High-leverage weak assets
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Top search demand</div>
                        <div className="mt-3 space-y-2">
                          {marketIntel.advertiserSignals.topQueries.slice(0, 6).map((item) => (
                            <div
                              key={item.query}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="break-all">{item.query}</span>
                              <Badge variant="outline">{item.count}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Location demand</div>
                        <div className="mt-3 space-y-2">
                          {marketIntel.advertiserSignals.cityDemand.slice(0, 6).map((item) => (
                            <div
                              key={`${item.businessName}-${item.address}`}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="max-w-[70%]">
                                {item.businessName || item.address || item.locationType || "Unknown"}
                              </span>
                              <div className="flex gap-2">
                                <Badge variant="outline">{item.requestCount} req</Badge>
                                <Badge variant="outline">{item.interestCount} interest</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Cuisine clusters</div>
                        <div className="mt-3 space-y-2">
                          {marketIntel.advertiserSignals.cuisineDemand.slice(0, 6).map((item) => (
                            <div
                              key={item.cuisineType || "unknown"}
                              className="flex items-center justify-between text-sm"
                            >
                              <span>{item.cuisineType || "Unknown"}</span>
                              <div className="flex gap-2">
                                <Badge variant="outline">{item.restaurantCount}</Badge>
                                <Badge variant="outline">
                                  rank {Math.round(item.avgRankingScore || 0)}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Content momentum</div>
                        <div className="mt-3 space-y-3">
                          {marketIntel.contentMomentum.slice(0, 5).map((item) => (
                            <div key={item.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
                              <div className="font-medium">{item.title}</div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">{item.impressionCount} impressions</Badge>
                                <Badge variant="outline">{item.viewCount} views</Badge>
                                {item.restaurantId ? (
                                  <Badge variant="outline">{item.restaurantId}</Badge>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Strategic acquisition targets</div>
                        <div className="mt-3 space-y-3">
                          {marketIntel.acquisitionTargets.slice(0, 5).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                setSelectedEntity({
                                  id: item.id,
                                  entityType: item.entityType,
                                  entityId: item.id.split(":")[1] || item.id,
                                  title: item.title,
                                  location: item.location,
                                  canonicalPath: item.canonicalPath,
                                  health: "target",
                                  quality: item.quality,
                                  freshness: "unknown",
                                  freshnessHours: null,
                                  machineReadiness: item.machineReadiness,
                                  canonicalFields: {},
                                  knowledgeGaps: item.reasons,
                                  opportunities: [],
                                  recommendedActions: [],
                                  updatedAt: new Date().toISOString(),
                                })
                              }
                              className="w-full rounded-lg border border-[var(--border-subtle)] p-3 text-left"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{item.title}</span>
                                <Badge variant="outline">{item.entityType}</Badge>
                                <Badge variant="outline">score {item.advertiserScore}</Badge>
                              </div>
                              <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                                {item.canonicalPath}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">{item.crawlerHits} crawler hits</Badge>
                                <Badge variant="outline">{item.machineReadiness}</Badge>
                                <Badge variant="outline">{item.quality}</Badge>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Market intelligence is unavailable.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fix These First</CardTitle>
                <CardDescription>
                  Pages where demand and weak information are colliding
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
                        <Badge variant="outline">priority {entity.priorityScore}</Badge>
                        <Badge variant="outline">{entity.crawlerDemand} machine hits</Badge>
                        <Badge variant="outline">{toPlainLabel(entity.machineReadiness)}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                        {entity.location || entity.entityId}
                      </div>
                      <div className="mt-2 text-xs text-[color:var(--text-muted)] break-all">
                        {entity.canonicalPath}
                      </div>
                      <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                        {buildPrioritySummary(entity)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entity.reasons.slice(0, 2).map((reason) => (
                          <Badge key={reason} variant="outline">
                            {toPlainLabel(reason)}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {renderActionControls(entity)}
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
                <CardTitle>Outside Attention vs Page Quality</CardTitle>
                <CardDescription>
                  Places where outside systems are looking before the page is truly ready
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isAuthorityGapLoading ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Loading authority delta...
                  </p>
                ) : authorityGap?.items?.length ? (
                  authorityGap.items.map((entity) => (
                    <button
                      key={`authority-${entity.id}`}
                      type="button"
                      onClick={() => setSelectedEntity(entity)}
                      className="w-full rounded-xl border border-[var(--border-subtle)] p-4 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{entity.title}</span>
                        <Badge variant="outline">{entity.entityType}</Badge>
                        <Badge variant="outline">{toPlainLabel(entity.pressure)}</Badge>
                        <Badge variant="outline">gap {entity.authorityDelta}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                        {entity.canonicalPath}
                      </div>
                      <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                        {buildAuthoritySummary(entity)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{entity.crawlerHits} machine hits</Badge>
                        <Badge variant="outline">{entity.humanHits} human hits</Badge>
                        <Badge variant="outline">{toPlainLabel(entity.machineReadiness)}</Badge>
                        <Badge variant="outline">{toPlainLabel(entity.freshness)}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entity.knowledgeGaps.slice(0, 2).map((gap) => (
                          <Badge key={gap} variant="outline">
                            {toPlainLabel(gap)}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {renderActionControls(entity)}
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    No authority delta issues detected.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who Is Discovering MealScout</CardTitle>
                <CardDescription>
                  Which outside systems and visitors are checking MealScout, and where they are looking
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

          <TabsContent value="livestream" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>LISA Livestream</CardTitle>
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
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">Best thing to promote</div>
                    <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                      {visibleDailyPromotionOpportunity
                        ? buildOpportunityBrief(visibleDailyPromotionOpportunity)
                        : "No clear promotion opportunity yet."}
                    </div>
                    {visibleDailyPromotionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyPromotionOpportunity.onAction}>
                          {visibleDailyPromotionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyPromotionOpportunity.briefKey, "dismiss")}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">Best page to improve</div>
                    <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                      {visibleDailyImprovementOpportunity
                        ? buildOpportunityBrief(visibleDailyImprovementOpportunity)
                        : "No clear page-improvement target yet."}
                    </div>
                    {visibleDailyImprovementOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyImprovementOpportunity.onAction}>
                          {visibleDailyImprovementOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyImprovementOpportunity.briefKey, "dismiss")}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">Best acquisition target</div>
                    <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                      {visibleDailyAcquisitionOpportunity
                        ? buildOpportunityBrief(visibleDailyAcquisitionOpportunity)
                        : "No obvious acquisition target yet."}
                    </div>
                    {visibleDailyAcquisitionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyAcquisitionOpportunity.onAction}>
                          {visibleDailyAcquisitionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyAcquisitionOpportunity.briefKey, "dismiss")}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">Best machine-attention play</div>
                    <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                      {visibleDailyMachineAttentionOpportunity
                        ? buildOpportunityBrief(visibleDailyMachineAttentionOpportunity)
                        : "No meaningful outside-machine attention yet."}
                    </div>
                    {visibleDailyMachineAttentionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyMachineAttentionOpportunity.onAction}>
                          {visibleDailyMachineAttentionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deferBrief(visibleDailyMachineAttentionOpportunity.briefKey, "dismiss")}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">What matters now</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {signalHighlights.length === 0 ? (
                        <span className="text-sm text-[color:var(--text-muted)]">
                          No meaningful signal clusters yet.
                        </span>
                      ) : (
                        signalHighlights.map(([family, count]) => (
                          <Badge key={family} variant="outline">
                            {family}: {count}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="mt-3 text-xs text-[color:var(--text-muted)]">
                      The livestream now prioritizes demand, deals, events,
                      distribution, and public-entity activity ahead of crawler noise.
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-medium">Signal mode</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={usefulOnly ? "default" : "outline"}
                        onClick={() => setUsefulOnly(true)}
                      >
                        Useful only
                      </Button>
                      <Button
                        size="sm"
                        variant={!usefulOnly ? "default" : "outline"}
                        onClick={() => setUsefulOnly(false)}
                      >
                        Show everything
                      </Button>
                    </div>
                    <div className="mt-3 text-xs text-[color:var(--text-muted)]">
                      Useful mode suppresses operational noise like uptime checks and
                      ranks business signals first.
                    </div>
                  </div>
                </div>

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

                {groupedSignalSummaries.length ? (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Grouped patterns</div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {groupedSignalSummaries.map((signals, index) => {
                        const summary = buildSignalClusterSummary(signals);
                        return (
                          <div
                            key={`${buildSignalClusterKey(signals[0])}:${index}`}
                            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{signals.length} related signals</Badge>
                              <Badge variant="outline">
                                {toPlainLabel(signals[0].family)}
                              </Badge>
                            </div>
                            <div className="mt-2 font-medium">{summary.title}</div>
                            <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                              Why it matters: {summary.why}
                            </div>
                            <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                              What to do: {summary.next}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
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
                              <Badge variant="outline">{toPlainLabel(signal.family)}</Badge>
                              <Badge variant="outline">{toPlainLabel(signal.visibility)}</Badge>
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
                              {buildSignalSummary(signal)}
                            </p>
                            <p className="text-sm text-[color:var(--text-muted)] break-all">
                              {buildSignalNextStep(signal)}
                            </p>
                            <p className="text-xs text-[color:var(--text-muted)] break-all">
                              Detail: {signal.summary}
                            </p>
                          </div>

                          <div className="text-xs text-[color:var(--text-muted)] md:text-right">
                            <div>{toPlainLabel(signal.streamType)}</div>
                            <div>{signal.source}</div>
                            <div>{signal.lane}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
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
