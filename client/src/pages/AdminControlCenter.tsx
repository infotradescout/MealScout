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
import type { ProfileCompletionTruth } from "@shared/profileCompletionStatus";

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

type BusinessProfileCompletionItem = {
  id: string;
  businessName: string;
  profileType: "restaurant" | "truck" | "bar";
  city: string | null;
  state: string | null;
  claimed: boolean;
  verifiedProfile: boolean;
  locallyOwned: boolean;
  hasPublicProfile?: boolean;
  publicProfileUrl: string | null;
  profileCompletenessScore: number;
  missingFields: string[];
  menuStatus: {
    ready: boolean;
    state?: ProfileCompletionTruth["menuState"];
    menuCount: number;
    menuItemCount: number;
    hasMenuFallback: boolean;
    reviewedUnavailable?: boolean;
  };
  photoStatus: {
    ready: boolean;
    state?: ProfileCompletionTruth["mediaState"];
    hasLogo: boolean;
    hasCover: boolean;
    uploadedCount: number;
    reviewedUnavailable?: boolean;
  };
  contactActionStatus: {
    ready: boolean;
    hasPhone: boolean;
    hasWebsite: boolean;
    hasSocial: boolean;
    hasActionLinks: boolean;
  };
  scheduleStatus: {
    required: boolean;
    ready: boolean;
    kind?: "dated_truck_schedule" | "fixed_weekly_hours";
    state?:
      | ProfileCompletionTruth["datedTruckScheduleState"]
      | ProfileCompletionTruth["fixedWeeklyHoursState"];
    workflowState?: ProfileCompletionTruth["datedTruckScheduleWorkflowState"];
    mobileOnline: boolean;
    hasOperatingHours: boolean;
    reviewedUnavailable?: boolean;
  };
  dealsEventsStatus: {
    dealsActive: number;
    eventsUpcoming: number;
    dealsReviewedNone?: boolean;
    eventsReviewedNone?: boolean;
  };
  qrKitReady: boolean;
  identityNeedsReview?: boolean;
  identityReason?: string | null;
  similarBusinesses?: Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    phone: string | null;
    websiteUrl: string | null;
  }>;
  publicReady?: boolean;
  completionTruth?: ProfileCompletionTruth | null;
  handoffReady?: boolean;
  adminFixable?: boolean;
  blockedOwnerInput?: boolean;
  testOrQa?: boolean;
  primaryStatus?:
    | "public_ready"
    | "handoff_ready"
    | "admin_fixable"
    | "blocked_owner_input"
    | "identity_review_needed"
    | "test_or_qa";
  secondaryFlags?: string[];
  completionScore?: number;
  confidenceScore?: number;
  fixabilityScore?: number;
  actionabilityScore?: number;
  rankReason?: string[];
  adminFixableItems?: string[];
  ownerInputBlockers?: string[];
  blockerReason?: string | null;
  hasAnalyticsActivity?: boolean;
  taskLabels?: {
    basics?: string;
    contactActions?: string;
    menu?: string;
    photos?: string;
    schedule?: string;
    deals?: string;
    events?: string;
  };
  analyticsActivity: {
    viewsOrClicks30d: number;
  };
  lastUpdated: string;
};

type BusinessProfileCompletionResponse = {
  ok: boolean;
  generatedAt: string;
  total: number;
  counts: {
    complete: number;
    almostComplete: number;
    needsWork: number;
  };
  items: BusinessProfileCompletionItem[];
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
  signalContract?: {
    mode: "truth_only" | "recommendations";
    reason: string;
    thresholds: {
      minTruthSignalScore: number;
      minTopViewedBusinesses: number;
      minIntentOrRepeat: number;
    };
    observed: {
      truthSignalScore: number;
      topViewedBusinesses: number;
      intentActionsNow: number;
      repeatedBusinessInterestNow: number;
    };
  };
  truthCounters?: {
    humanSessionsNow: number;
    intentActionsNow: number;
    repeatedBusinessInterestNow: number;
    machineDiscoveryNow: number;
    frictionCasesNow: number;
  };
  recentTruthFeed?: Array<{
    id: string;
    family: string;
    summary: string;
    evidence: string;
    actionHint: string;
    occurredAt: string;
  }>;
  topViewedBusinesses?: Array<{
    restaurantId: string;
    title: string;
    views: number;
    uniqueVisitors: number;
    repeatVisitors: number;
    intentActions: number;
  }>;
  frictionCases?: Array<{
    id: string;
    restaurantId: string;
    title: string;
    views: number;
    uniqueVisitors: number;
    intentActions: number;
  }>;
  brief: {
    headline: string;
    audienceAngle: string;
    inventoryAngle: string;
    acquisitionAngle: string;
    recommendedPackage: string[];
  };
  changeSinceYesterday: {
    summary: string;
    items: Array<{
      id: string;
      title: string;
      summary: string;
      delta: number;
      next: string;
    }>;
  };
  dailyBriefChanges: {
    promotion: string;
    demand: string;
    acquisition: string;
    machineAttention: string;
  };
  trendWatch: Array<{
    id: string;
    label: string;
    currentCount: number;
    previousCount: number;
    delta: number;
    direction: string;
    momentum: string;
    summary: string;
    next: string;
  }>;
  priceScout: {
    summary: string;
    bestDeals: Array<{
      id: string;
      restaurantId: string;
      restaurantName: string;
      cuisineType: string | null;
      city: string | null;
      state: string | null;
      title: string;
      dealType: string;
      discountValue: number;
      minOrderAmount: number;
      endDate: string | null;
      isOngoing: boolean | null;
      valueScore: number;
      priceSignal: string;
    }>;
    cuisineValue: Array<{
      cuisineType: string;
      dealCount: number;
      avgValueScore: number;
      avgMinOrder: number;
    }>;
    supplyLaneSummary?: {
      totalRecentRecords: number;
      snapshotCount: number;
      alertCount: number;
      watchCount: number;
      laneCounts: Record<string, number>;
      spotlight: Array<{
        lane: string;
        signalType: string;
        itemKey: string;
        itemName: string;
        areaKey: string;
        valuePrimary: number | null;
        valueSecondary: number | null;
        source: string;
        createdAt: string;
      }>;
    };
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

type BriefActionLogItem = {
  id: string;
  userId?: string | null;
  createdAt: string;
  briefKey: string;
  action: "done" | "snooze" | "dismiss";
  title?: string;
  href?: string;
};

type BriefActionLogResponse = {
  ok: boolean;
  generatedAt: string;
  windowHours: number;
  items: BriefActionLogItem[];
  latest: BriefActionLogItem[];
};

type DiscoveryAnalyticsResponse = {
  window: "7d" | "30d";
  generatedAt: string;
  totals: {
    discoveryPageViews: number;
    cardClicks: number;
    profileClicks: number;
    ctaClicks: number;
  };
  topPages: Array<{
    sourcePageType: string;
    city?: string;
    cuisine?: string;
    sourcePath: string;
    views: number;
    clicks: number;
  }>;
  topProfilesFromDiscovery: Array<{
    profileId: string;
    profileType: string;
    profilePath: string;
    displayName?: string;
    clicks: number;
  }>;
  topCities: Array<{
    city: string;
    views: number;
    clicks: number;
  }>;
};

// Sockets are ON by default; set VITE_ENABLE_SOCKETS=false to disable
const ENABLE_SOCKETS = import.meta.env.VITE_ENABLE_SOCKETS !== "false";
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
  const [completionView, setCompletionView] = useState("next_20_actionable");
  const [selectedCompletionIds, setSelectedCompletionIds] = useState<string[]>([]);
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
  const [discoveryWindow, setDiscoveryWindow] = useState<"7d" | "30d">("7d");

  const isCompletionSelected = (id: string) => selectedCompletionIds.includes(id);
  const toggleCompletionSelected = (id: string) => {
    setSelectedCompletionIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

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

  const { data: businessCompletion, isLoading: isBusinessCompletionLoading } =
    useQuery<BusinessProfileCompletionResponse>({
      queryKey: ["/api/admin/business-profiles/completion", 200],
      queryFn: async () => {
        const res = await fetch("/api/admin/business-profiles/completion?limit=200");
        if (!res.ok) throw new Error("Failed to fetch business completion dashboard");
        return res.json();
      },
      refetchInterval: 60000,
    });

  const businessCompletionUpdateMutation = useMutation({
    mutationFn: async (payload: {
      businessId: string;
      body: Record<string, unknown>;
    }) => {
      const res = await fetch(
        `/api/admin/business-profiles/${encodeURIComponent(payload.businessId)}/completion`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload.body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to update business completion");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/business-profiles/completion", 200],
      });
      toast({
        title: "Completion updated",
        description: "Business completion data was updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Could not update completion fields.",
        variant: "destructive",
      });
    },
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

  const { data: briefActionLog } = useQuery<BriefActionLogResponse>({
    queryKey: ["/api/admin/lisa/brief-actions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/brief-actions?hours=720");
      if (!res.ok) throw new Error("Failed to fetch brief actions");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: discoveryAnalytics } = useQuery<DiscoveryAnalyticsResponse>({
    queryKey: ["/api/admin/discovery-analytics", discoveryWindow],
    queryFn: async () => {
      const res = await fetch(`/api/admin/discovery-analytics?window=${discoveryWindow}`);
      if (!res.ok) throw new Error("Failed to fetch discovery analytics");
      return res.json();
    },
    refetchInterval: 60000,
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

  const briefActionMutation = useMutation({
    mutationFn: async (payload: {
      briefKey: string;
      action: "done" | "snooze" | "dismiss";
      title: string;
      href: string;
    }) => {
      const res = await fetch("/api/admin/lisa/brief-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || "Failed to log brief action");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lisa/brief-actions"] });
    },
  });

  const promptAndUpdateCompletion = async (
    businessId: string,
    fieldLabel: string,
    bodyKey: string,
    currentValue?: string | null,
  ) => {
    const nextValue = window.prompt(
      `Set ${fieldLabel} (leave empty to clear):`,
      String(currentValue || ""),
    );
    if (nextValue === null) return;
    await businessCompletionUpdateMutation.mutateAsync({
      businessId,
      body: { [bodyKey]: nextValue.trim() || null },
    });
  };

  const promptAndUpdateNestedAction = async (
    businessId: string,
    fieldLabel: string,
    actionKey:
      | "onlineOrderingUrl"
      | "deliveryUrl"
      | "cateringInquiryUrl"
      | "truckBookingInquiryUrl",
  ) => {
    const nextValue = window.prompt(`Set ${fieldLabel} (leave empty to clear):`, "");
    if (nextValue === null) return;
    await businessCompletionUpdateMutation.mutateAsync({
      businessId,
      body: {
        publicActionLinks: {
          [actionKey]: nextValue.trim() || null,
        },
      },
    });
  };

  const markReviewedOptional = async (
    businessId: string,
    field:
      | "menuReviewedUnavailable"
      | "photosReviewedUnavailable"
      | "scheduleReviewedUnavailable"
      | "dealsReviewedNone"
      | "eventsReviewedNone",
    value: boolean,
  ) => {
    await businessCompletionUpdateMutation.mutateAsync({
      businessId,
      body: {
        reviewed: {
          [field]: value,
        },
      },
    });
  };

  const applyBulkReviewed = async (
    reviewed:
      | "dealsReviewedNone"
      | "eventsReviewedNone"
      | "menuReviewedUnavailable"
      | "photosReviewedUnavailable"
      | "scheduleReviewedUnavailable"
      | "hideAsTestQa"
      | "identityReviewNeeded"
      | "identityReviewed",
    value: boolean,
  ) => {
    if (!selectedCompletionIds.length) return;
    for (const businessId of selectedCompletionIds) {
      await businessCompletionUpdateMutation.mutateAsync({
        businessId,
        body: {
          reviewed: {
            [reviewed]: value,
          },
        },
      });
    }
  };

  const applyBulkBlockerReason = async () => {
    if (!selectedCompletionIds.length) return;
    const reason = window.prompt("Assign blocker reason (leave empty to clear):", "");
    if (reason === null) return;
    for (const businessId of selectedCompletionIds) {
      await businessCompletionUpdateMutation.mutateAsync({
        businessId,
        body: {
          reviewed: {
            blockerReason: reason.trim() || null,
          },
        },
      });
    }
  };

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

  const promotionBriefCandidates = useMemo(() => {
    if (marketIntel?.signalContract?.mode === "truth_only") return [];
    return (marketIntel?.contentMomentum ?? []).slice(0, 4).map((item) => {
      const linkedEntity = item.restaurantId
        ? canonicalEntityMap.get(`restaurant:${item.restaurantId}`)
        : null;
      return {
        briefKey: `promote:${item.id}`,
        title: item.title || "Top promotion opportunity",
        why: `${Number(item.viewCount ?? 0)} views and ${Number(item.impressionCount ?? 0)} impressions show live attention.`,
        next: "Promote it now or pair it with a deal, event, or sponsor slot while attention is active.",
        changed: marketIntel?.dailyBriefChanges?.promotion,
        rankReason: `Ranked #1 because it currently has the strongest live attention in MealScout content.`,
        actionLabel: linkedEntity ? "Focus restaurant" : "Open livestream",
        onAction: () => {
          if (linkedEntity) {
            focusEntity(linkedEntity, "overview");
            return;
          }
          setActiveTab("livestream");
        },
      };
    });
  }, [canonicalEntityMap, marketIntel]);

  const improvementBriefCandidates = useMemo(() => {
    if (marketIntel?.signalContract?.mode === "truth_only") return [];
    return (priorityEntities?.items ?? []).slice(0, 4).map((item) => ({
      briefKey: `improve:${item.id}`,
      title: item.title || "Top page to improve",
      why: `Demand is forming here, but the page is still ${toPlainLabel(item.quality)} and ${toPlainLabel(item.machineReadiness)}.`,
      next:
        item.reasons?.[0]
          ? `Fix ${toPlainLabel(item.reasons[0])} first.`
          : "Improve the page quality and freshness first.",
      changed: marketIntel?.changeSinceYesterday?.summary,
      rankReason: `Ranked #1 because demand and weak page quality are overlapping here more than anywhere else.`,
      actionLabel: "Focus page",
      onAction: () => focusEntity(item, "overview"),
    }));
  }, [marketIntel, priorityEntities]);

  const acquisitionBriefCandidates = useMemo(() => {
    if (marketIntel?.signalContract?.mode === "truth_only") return [];
    return (marketIntel?.acquisitionTargets ?? []).slice(0, 4).map((item) => {
      const entityId = String(item.id || "").split(":")[1] || item.id;
      const linkedEntity =
        canonicalEntityMap.get(`${item.entityType}:${entityId}`) ?? null;
      return {
        briefKey: `acquire:${item.id}`,
        title: item.title || "Top acquisition target",
        why: `${Number(item.crawlerHits ?? 0)} machine hits suggest outside interest is ahead of asset quality.`,
        next:
          "Review it for acquisition, partnership, or direct improvement before someone else captures the attention.",
        changed: marketIntel?.dailyBriefChanges?.acquisition,
        rankReason: `Ranked #1 because outside interest is high while the asset is still relatively weak.`,
        actionLabel: linkedEntity ? "Focus target" : "Open page",
        onAction: () => {
          if (linkedEntity) {
            focusEntity(linkedEntity, "overview");
            return;
          }
          window.location.href = item.canonicalPath || "/admin/control-center";
        },
      };
    });
  }, [canonicalEntityMap, marketIntel]);

  const machineAttentionBriefCandidates = useMemo(() => {
    if (marketIntel?.signalContract?.mode === "truth_only") return [];
    return filteredSignals
      .filter((signal) => signal.visibility === "off_platform")
      .slice(0, 4)
      .map((item) => ({
        briefKey: `machine:${item.id}`,
        title: item.title || "Top machine-attention opportunity",
        why: buildSignalSummary(item),
        next: buildSignalNextStep(item).replace(/^Next step:\s*/i, ""),
        changed: marketIntel?.dailyBriefChanges?.machineAttention,
        rankReason: `Ranked #1 because this is the strongest current off-platform attention signal in the stream.`,
        actionLabel: "Open livestream",
        onAction: () => {
          setActiveTab("livestream");
          setLaneQuery(String(item.subjectId || ""));
        },
      }));
  }, [filteredSignals, marketIntel]);

  const filteredCompletionItems = useMemo(() => {
    const items = businessCompletion?.items ?? [];
    const applyFilter = (item: BusinessProfileCompletionItem) => {
      const status = item.primaryStatus || "blocked_owner_input";
      const needsMenu = !item.menuStatus?.ready;
      const needsPhoto = !item.photoStatus?.ready;
      const needsSchedule = Boolean(item.scheduleStatus?.required && !item.scheduleStatus?.ready);
      const needsContactAction = !item.contactActionStatus?.ready;
      const hasAnalytics = Boolean(item.hasAnalyticsActivity || item.analyticsActivity?.viewsOrClicks30d > 0);
      if (completionView === "next_20_actionable") {
        return (
          !item.testOrQa &&
          !item.blockedOwnerInput &&
          !item.identityNeedsReview &&
          (status === "handoff_ready" || status === "public_ready" || status === "admin_fixable")
        );
      }
      if (completionView === "public_ready") return status === "public_ready";
      if (completionView === "handoff_ready") return status === "handoff_ready";
      if (completionView === "admin_fixable") return status === "admin_fixable";
      if (completionView === "blocked_owner_input") return status === "blocked_owner_input";
      if (completionView === "identity_review_needed") return status === "identity_review_needed";
      if (completionView === "test_or_qa") return status === "test_or_qa";
      if (completionView === "needs_menu") return needsMenu;
      if (completionView === "needs_photo") return needsPhoto;
      if (completionView === "needs_schedule") return needsSchedule;
      if (completionView === "needs_contact_action") return needsContactAction;
      if (completionView === "has_analytics_activity") return hasAnalytics;
      return true;
    };

    return items
      .filter(applyFilter)
      .sort((a, b) => {
        const scoreDiff = Number(b.actionabilityScore || 0) - Number(a.actionabilityScore || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.profileCompletenessScore || 0) - Number(a.profileCompletenessScore || 0);
      });
  }, [businessCompletion?.items, completionView]);

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

  const latestBriefActionByKey = useMemo(() => {
    const map = new Map<string, BriefActionLogItem>();
    for (const item of briefActionLog?.latest ?? []) {
      map.set(item.briefKey, item);
    }
    return map;
  }, [briefActionLog]);

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
    const localUntil = briefStatus[briefKey]?.until ?? 0;
    const latestAction = latestBriefActionByKey.get(briefKey);
    const actionUntil =
      latestAction?.action === "done"
        ? new Date(latestAction.createdAt).getTime() + 24 * 7 * 60 * 60 * 1000
        : latestAction?.action === "snooze"
          ? new Date(latestAction.createdAt).getTime() + 4 * 60 * 60 * 1000
          : latestAction?.action === "dismiss"
            ? new Date(latestAction.createdAt).getTime() + 16 * 60 * 60 * 1000
            : 0;
    return Math.max(localUntil, actionUntil) <= Date.now();
  };

  const pickVisibleBrief = (items: any[]) =>
    items.find((item) => isBriefVisible(item.briefKey)) || null;

  const visibleDailyPromotionOpportunity = pickVisibleBrief(promotionBriefCandidates);
  const visibleDailyImprovementOpportunity = pickVisibleBrief(improvementBriefCandidates);
  const visibleDailyAcquisitionOpportunity = pickVisibleBrief(acquisitionBriefCandidates);
  const visibleDailyMachineAttentionOpportunity = pickVisibleBrief(
    machineAttentionBriefCandidates,
  );

  const handleBriefAction = (
    brief: any | null,
    action: "done" | "snooze" | "dismiss",
  ) => {
    if (!brief) return;
    deferBrief(brief.briefKey, action);
    briefActionMutation.mutate({
      briefKey: brief.briefKey,
      action,
      title: brief.title,
      href: "/admin/control-center",
    });
  };

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
                  First-party truth now, with recommendations only when signal density is sufficient
                </CardDescription>
              </CardHeader>
              {marketIntel?.signalContract?.mode === "truth_only" ? (
                <div className="px-6 pb-2 text-xs text-[color:var(--text-muted)]">
                  {marketIntel.signalContract.reason}
                </div>
              ) : null}
              <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Top content promotion candidate</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyPromotionOpportunity
                      ? buildOpportunityBrief(visibleDailyPromotionOpportunity)
                      : "Not enough recent first-party signal to rank this safely."}
                  </div>
                  {visibleDailyPromotionOpportunity ? (
                    <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                      Why this is #1: {visibleDailyPromotionOpportunity.rankReason}
                    </div>
                  ) : null}
                  {visibleDailyPromotionOpportunity?.changed ? (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      What changed since yesterday: {visibleDailyPromotionOpportunity.changed}
                    </div>
                  ) : null}
                  {visibleDailyPromotionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyPromotionOpportunity.onAction}>
                        {visibleDailyPromotionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Most-viewed page with weak conversion</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyImprovementOpportunity
                      ? buildOpportunityBrief(visibleDailyImprovementOpportunity)
                      : "Not enough recent first-party signal to rank this safely."}
                  </div>
                  {visibleDailyImprovementOpportunity ? (
                    <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                      Why this is #1: {visibleDailyImprovementOpportunity.rankReason}
                    </div>
                  ) : null}
                  {visibleDailyImprovementOpportunity?.changed ? (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      What changed since yesterday: {visibleDailyImprovementOpportunity.changed}
                    </div>
                  ) : null}
                  {visibleDailyImprovementOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyImprovementOpportunity.onAction}>
                        {visibleDailyImprovementOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Strongest supply/acquisition watch target</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyAcquisitionOpportunity
                      ? buildOpportunityBrief(visibleDailyAcquisitionOpportunity)
                      : "Not enough recent first-party signal to rank this safely."}
                  </div>
                  {visibleDailyAcquisitionOpportunity ? (
                    <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                      Why this is #1: {visibleDailyAcquisitionOpportunity.rankReason}
                    </div>
                  ) : null}
                  {visibleDailyAcquisitionOpportunity?.changed ? (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      What changed since yesterday: {visibleDailyAcquisitionOpportunity.changed}
                    </div>
                  ) : null}
                  {visibleDailyAcquisitionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyAcquisitionOpportunity.onAction}>
                        {visibleDailyAcquisitionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium">Machine discovery pressure to address</div>
                  <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                    {visibleDailyMachineAttentionOpportunity
                      ? buildOpportunityBrief(visibleDailyMachineAttentionOpportunity)
                      : "Not enough recent first-party signal to rank this safely."}
                  </div>
                  {visibleDailyMachineAttentionOpportunity ? (
                    <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                      Why this is #1: {visibleDailyMachineAttentionOpportunity.rankReason}
                    </div>
                  ) : null}
                  {visibleDailyMachineAttentionOpportunity?.changed ? (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      What changed since yesterday: {visibleDailyMachineAttentionOpportunity.changed}
                    </div>
                  ) : null}
                  {visibleDailyMachineAttentionOpportunity ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={visibleDailyMachineAttentionOpportunity.onAction}>
                        {visibleDailyMachineAttentionOpportunity.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "snooze")}>
                        Snooze
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "done")}>
                        Done
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Truth Counters</CardTitle>
                <CardDescription>What happened in first-party signals before any recommendation layer</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)]">Human sessions now</div>
                  <div className="text-xl font-semibold">{marketIntel?.truthCounters?.humanSessionsNow ?? 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)]">Intent actions now</div>
                  <div className="text-xl font-semibold">{marketIntel?.truthCounters?.intentActionsNow ?? 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)]">Repeated business interest</div>
                  <div className="text-xl font-semibold">{marketIntel?.truthCounters?.repeatedBusinessInterestNow ?? 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)]">Machine discovery</div>
                  <div className="text-xl font-semibold">{marketIntel?.truthCounters?.machineDiscoveryNow ?? 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)]">Friction cases</div>
                  <div className="text-xl font-semibold">{marketIntel?.truthCounters?.frictionCasesNow ?? 0}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Public Discovery Analytics</CardTitle>
                <CardDescription>
                  Which public SEO pages are driving profile traffic and clicks
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={discoveryWindow === "7d" ? "default" : "outline"}
                    onClick={() => setDiscoveryWindow("7d")}
                  >
                    7 days
                  </Button>
                  <Button
                    size="sm"
                    variant={discoveryWindow === "30d" ? "default" : "outline"}
                    onClick={() => setDiscoveryWindow("30d")}
                  >
                    30 days
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-xs text-[color:var(--text-muted)]">Discovery page views</div>
                    <div className="text-xl font-semibold">{discoveryAnalytics?.totals.discoveryPageViews ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-xs text-[color:var(--text-muted)]">Card clicks</div>
                    <div className="text-xl font-semibold">{discoveryAnalytics?.totals.cardClicks ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-xs text-[color:var(--text-muted)]">Profile clicks</div>
                    <div className="text-xl font-semibold">{discoveryAnalytics?.totals.profileClicks ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-xs text-[color:var(--text-muted)]">CTA clicks</div>
                    <div className="text-xl font-semibold">{discoveryAnalytics?.totals.ctaClicks ?? 0}</div>
                  </div>
                </div>

                {(discoveryAnalytics?.totals.discoveryPageViews ?? 0) === 0 &&
                (discoveryAnalytics?.totals.cardClicks ?? 0) === 0 &&
                (discoveryAnalytics?.totals.profileClicks ?? 0) === 0 &&
                (discoveryAnalytics?.totals.ctaClicks ?? 0) === 0 ? (
                  <div className="text-sm text-[color:var(--text-muted)]">
                    No discovery activity recorded yet. Share or index the public SEO pages to start measuring traffic.
                  </div>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-3">
                    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                      <div className="text-sm font-medium">Top public pages</div>
                      <div className="mt-2 space-y-2 text-xs">
                        {(discoveryAnalytics?.topPages || []).slice(0, 5).map((page) => (
                          <div key={`${page.sourcePath}:${page.sourcePageType}`}>
                            <div className="font-medium">{page.sourcePath}</div>
                            <div className="text-[color:var(--text-muted)]">
                              {page.sourcePageType} • views {page.views} • clicks {page.clicks}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                      <div className="text-sm font-medium">Top profiles from discovery</div>
                      <div className="mt-2 space-y-2 text-xs">
                        {(discoveryAnalytics?.topProfilesFromDiscovery || []).slice(0, 5).map((profile) => (
                          <div key={`${profile.profileId}:${profile.profilePath}`}>
                            <div className="font-medium">{profile.displayName || profile.profilePath}</div>
                            <div className="text-[color:var(--text-muted)]">
                              {profile.profileType} • clicks {profile.clicks}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                      <div className="text-sm font-medium">Top cities</div>
                      <div className="mt-2 space-y-2 text-xs">
                        {(discoveryAnalytics?.topCities || []).slice(0, 5).map((city) => (
                          <div key={city.city}>
                            <div className="font-medium">{city.city}</div>
                            <div className="text-[color:var(--text-muted)]">
                              views {city.views} • clicks {city.clicks}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Truth Feed</CardTitle>
                <CardDescription>Recent, evidence-backed events with direct operator next steps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(marketIntel?.recentTruthFeed ?? []).length ? (
                  (marketIntel?.recentTruthFeed ?? []).map((item) => (
                    <div key={item.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
                      <div className="text-sm">{item.summary}</div>
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">{item.evidence}</div>
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">Next: {item.actionHint}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[color:var(--text-muted)]">
                    No recent first-party truth events are available yet.
                  </div>
                )}
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
                <CardTitle>Production Business Profile Completion</CardTitle>
                <CardDescription>
                  Activation queue for live businesses that need profile completion or promotion
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {businessCompletion ? (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Total ({businessCompletion.total})</Badge>
                    <Badge variant="outline">
                      Complete ({businessCompletion.counts.complete})
                    </Badge>
                    <Badge variant="outline">
                      Almost complete ({businessCompletion.counts.almostComplete})
                    </Badge>
                    <Badge variant="outline">
                      Needs work ({businessCompletion.counts.needsWork})
                    </Badge>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {[
                    ["next_20_actionable", "Next 20 actionable"],
                    ["public_ready", "Public-ready"],
                    ["handoff_ready", "Handoff-ready"],
                    ["admin_fixable", "Admin-fixable"],
                    ["blocked_owner_input", "Blocked owner input"],
                    ["identity_review_needed", "Identity review"],
                    ["test_or_qa", "Test / QA"],
                    ["needs_menu", "Needs menu"],
                    ["needs_photo", "Needs photo"],
                    ["needs_schedule", "Needs schedule"],
                    ["needs_contact_action", "Needs contact/action"],
                    ["has_analytics_activity", "Has analytics activity"],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={completionView === value ? "default" : "outline"}
                      onClick={() => setCompletionView(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="text-xs text-[color:var(--text-muted)] self-center">
                    Bulk actions ({selectedCompletionIds.length} selected)
                  </div>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("dealsReviewedNone", true)}>
                    Deals reviewed-none
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("eventsReviewedNone", true)}>
                    Events reviewed-none
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("menuReviewedUnavailable", true)}>
                    Menu reviewed-unavailable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("photosReviewedUnavailable", true)}>
                    Photos reviewed-unavailable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("scheduleReviewedUnavailable", true)}>
                    Schedule reviewed-unavailable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("hideAsTestQa", true)}>
                    Hide as test/QA
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("identityReviewNeeded", true)}>
                    Mark identity review needed
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => applyBulkReviewed("identityReviewed", true)}>
                    Mark identity reviewed
                  </Button>
                  <Button size="sm" variant="outline" onClick={applyBulkBlockerReason}>
                    Assign blocker reason
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
                  <table className="w-full min-w-[1560px] text-left text-xs">
                    <thead className="bg-[var(--surface-muted)] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Select</th>
                        <th className="px-3 py-2 font-medium">Business</th>
                        <th className="px-3 py-2 font-medium">Type / Location</th>
                        <th className="px-3 py-2 font-medium">Primary status</th>
                        <th className="px-3 py-2 font-medium">Actionability</th>
                        <th className="px-3 py-2 font-medium">Scores</th>
                        <th className="px-3 py-2 font-medium">Missing + blockers</th>
                        <th className="px-3 py-2 font-medium">Identity / QA</th>
                        <th className="px-3 py-2 font-medium">Activity</th>
                        <th className="px-3 py-2 font-medium">Last updated</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isBusinessCompletionLoading ? (
                        <tr>
                          <td className="px-3 py-3 text-[color:var(--text-muted)]" colSpan={11}>
                            Loading completion queue...
                          </td>
                        </tr>
                      ) : filteredCompletionItems.length ? (
                        filteredCompletionItems
                          .slice(0, completionView === "next_20_actionable" ? 20 : 60)
                          .map((item) => (
                          <tr key={item.id} className="border-t border-[var(--border-subtle)]">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={isCompletionSelected(item.id)}
                                onChange={() => toggleCompletionSelected(item.id)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{item.businessName}</div>
                              <div className="text-[color:var(--text-muted)]">{item.id}</div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline">{item.profileType}</Badge>
                              <div className="mt-1 text-[color:var(--text-muted)]">
                                {[item.city, item.state].filter(Boolean).join(", ") || "N/A"}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline">
                                {String(item.primaryStatus || "blocked_owner_input").replace(/_/g, " ")}
                              </Badge>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(item.secondaryFlags || []).slice(0, 3).map((flag) => (
                                  <Badge key={`${item.id}:${flag}`} variant="outline">
                                    {flag.replace(/_/g, " ")}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline">{item.actionabilityScore ?? 0}</Badge>
                              <div className="mt-1 text-[color:var(--text-muted)]">
                                {(item.rankReason || []).slice(0, 2).join(" • ") || "Needs review"}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div>C {item.completionScore ?? item.profileCompletenessScore}</div>
                              <div>Conf {item.confidenceScore ?? 0}</div>
                              <div>Fix {item.fixabilityScore ?? 0}</div>
                            </td>
                            <td className="px-3 py-2 text-[color:var(--text-muted)]">
                              <div>Missing: {item.missingFields.length ? item.missingFields.join(", ") : "None"}</div>
                              <div>Admin-fix: {(item.adminFixableItems || []).join(", ") || "None"}</div>
                              <div>Owner blockers: {(item.ownerInputBlockers || []).join(", ") || "None"}</div>
                              {item.blockerReason ? <div>Blocker note: {item.blockerReason}</div> : null}
                            </td>
                            <td className="px-3 py-2">
                              {item.identityNeedsReview ? (
                                <Badge variant="outline">Identity review needed</Badge>
                              ) : (
                                <Badge variant="outline">Identity clear</Badge>
                              )}
                              <div className="mt-1">
                                <Badge variant="outline">{item.testOrQa ? "Test/QA" : "Live"}</Badge>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {item.analyticsActivity.viewsOrClicks30d}
                            </td>
                            <td className="px-3 py-2 text-[color:var(--text-muted)]">
                              {formatSignalTime(item.lastUpdated)}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {item.hasPublicProfile && item.publicProfileUrl ? (
                                  <a
                                    href={item.publicProfileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                  >
                                    Open profile
                                  </a>
                                ) : (
                                  <span className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[color:var(--text-muted)]">
                                    No public profile yet
                                  </span>
                                )}
                                <a
                                  href={`/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(item.id)}&setup=1`}
                                  className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                >
                                  Edit profile
                                </a>
                                {item.identityNeedsReview ? (
                                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                                    {item.identityReason || "Identity review required"}
                                  </div>
                                ) : (
                                  <>
                                    <a
                                      href={`/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(item.id)}&setup=1`}
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Complete missing
                                    </a>
                                    <a
                                      href={`/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(item.id)}&setup=1`}
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Open QR kit
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateCompletion(item.id, "menu URL", "menuUrl", null)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add menu URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateCompletion(item.id, "logo URL", "logoUrl", null)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add logo URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateCompletion(item.id, "cover URL", "coverImageUrl", null)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add cover URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateCompletion(item.id, "gallery image URL", "galleryImageUrl", null)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add gallery URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateNestedAction(
                                          item.id,
                                          "online ordering URL",
                                          "onlineOrderingUrl",
                                        )
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add order URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        promptAndUpdateNestedAction(
                                          item.id,
                                          "delivery URL",
                                          "deliveryUrl",
                                        )
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Add delivery URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => markReviewedOptional(item.id, "dealsReviewedNone", true)}
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Mark no deals
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        markReviewedOptional(item.id, "menuReviewedUnavailable", true)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Mark menu reviewed
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        markReviewedOptional(item.id, "photosReviewedUnavailable", true)
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Mark photos reviewed
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => markReviewedOptional(item.id, "eventsReviewedNone", true)}
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Mark no events
                                    </button>
                                    {item.profileType === "truck" ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          markReviewedOptional(item.id, "scheduleReviewedUnavailable", true)
                                        }
                                        className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                      >
                                        Mark schedule reviewed
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        businessCompletionUpdateMutation.mutateAsync({
                                          businessId: item.id,
                                          body: { reviewed: { identityReviewNeeded: true } },
                                        })
                                      }
                                      className="inline-flex items-center rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                                    >
                                      Flag identity review
                                    </button>
                                  </>
                                )}
                              </div>
                              {item.identityNeedsReview && item.similarBusinesses?.length ? (
                                <div className="mt-1 text-[11px] text-amber-200/90">
                                  Similar:{" "}
                                  {item.similarBusinesses
                                    .map((candidate) =>
                                      `${candidate.name} (${[candidate.city, candidate.state]
                                        .filter(Boolean)
                                        .join(", ") || "N/A"})`,
                                    )
                                    .join(" | ")}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-3 py-3 text-[color:var(--text-muted)]" colSpan={11}>
                            No business profiles found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                          <a
                            href="/api/admin/lisa/market-data-lanes?hours=48&limit=1000&format=json"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            Export Price Scout lanes JSON
                          </a>
                          <a
                            href="/api/admin/lisa/market-data-lanes?hours=48&limit=1000&format=csv"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            Export Price Scout lanes CSV
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

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4 xl:col-span-2">
                        <div className="text-sm font-medium">What changed since yesterday</div>
                        <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                          {marketIntel.changeSinceYesterday.summary}
                        </div>
                        <div className="mt-3 space-y-3">
                          {marketIntel.changeSinceYesterday.items.slice(0, 4).map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-[var(--border-subtle)] p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">{item.title}</div>
                                <Badge variant="outline">
                                  {item.delta > 0 ? "+" : ""}
                                  {item.delta}
                                </Badge>
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                                {item.summary}
                              </div>
                              <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                                What to do: {item.next}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">Price Scout</div>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=json"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                            >
                              Export feed JSON
                            </a>
                            <a
                              href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=csv"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                            >
                              Export feed CSV
                            </a>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                          {marketIntel.priceScout.summary}
                        </div>
                        {marketIntel.priceScout.supplyLaneSummary ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">
                              {marketIntel.priceScout.supplyLaneSummary.totalRecentRecords} supply records
                            </Badge>
                            <Badge variant="outline">
                              {marketIntel.priceScout.supplyLaneSummary.snapshotCount} snapshots
                            </Badge>
                            <Badge variant="outline">
                              {marketIntel.priceScout.supplyLaneSummary.alertCount} alerts
                            </Badge>
                            <Badge variant="outline">
                              {marketIntel.priceScout.supplyLaneSummary.watchCount} active watches
                            </Badge>
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-3">
                          {marketIntel.priceScout.bestDeals.slice(0, 3).map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-[var(--border-subtle)] p-3"
                            >
                              <div className="font-medium">{item.restaurantName}</div>
                              <div className="text-sm text-[color:var(--text-muted)]">
                                {item.title}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">{item.priceSignal}</Badge>
                                <Badge variant="outline">value {item.valueScore}</Badge>
                                {item.cuisineType ? (
                                  <Badge variant="outline">{item.cuisineType}</Badge>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                        {marketIntel.priceScout.supplyLaneSummary?.spotlight?.length ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium text-[color:var(--text-muted)]">
                              Supply lane spotlight
                            </div>
                            {marketIntel.priceScout.supplyLaneSummary.spotlight
                              .slice(0, 3)
                              .map((signal) => (
                                <div
                                  key={`${signal.lane}:${signal.itemKey}:${signal.createdAt}`}
                                  className="rounded-lg border border-[var(--border-subtle)] p-2"
                                >
                                  <div className="text-sm font-medium">{signal.itemName}</div>
                                  <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                                    {signal.signalType.replace(/_/g, " ")} in {signal.areaKey}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                    {signal.valuePrimary !== null ? (
                                      <Badge variant="outline">
                                        primary {signal.valuePrimary}
                                      </Badge>
                                    ) : null}
                                    {signal.valueSecondary !== null ? (
                                      <Badge variant="outline">
                                        secondary {signal.valueSecondary}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : null}
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
                        <div className="text-sm font-medium">Food trend watch</div>
                        <div className="mt-3 space-y-3">
                          {marketIntel.trendWatch.slice(0, 6).map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-[var(--border-subtle)] p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium break-all">{item.label}</span>
                                <div className="flex gap-2">
                                  <Badge variant="outline">{item.currentCount} now</Badge>
                                  <Badge variant="outline">
                                    {item.delta > 0 ? "+" : ""}
                                    {item.delta}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                                {item.summary}
                              </div>
                              <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                                What to do: {item.next}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

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

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Best live value deals</div>
                        <div className="mt-3 space-y-3">
                          {marketIntel.priceScout.bestDeals.slice(0, 5).map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-[var(--border-subtle)] p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{item.restaurantName}</span>
                                <Badge variant="outline">value {item.valueScore}</Badge>
                                {item.cuisineType ? (
                                  <Badge variant="outline">{item.cuisineType}</Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--text-muted)]">
                                {item.title}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">{item.priceSignal}</Badge>
                                {item.city || item.state ? (
                                  <Badge variant="outline">
                                    {[item.city, item.state].filter(Boolean).join(", ")}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                        <div className="text-sm font-medium">Best value cuisines</div>
                        <div className="mt-3 space-y-2">
                          {marketIntel.priceScout.cuisineValue.slice(0, 6).map((item) => (
                            <div
                              key={item.cuisineType}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span>{item.cuisineType}</span>
                              <div className="flex gap-2">
                                <Badge variant="outline">{item.dealCount} deals</Badge>
                                <Badge variant="outline">
                                  value {item.avgValueScore}
                                </Badge>
                                <Badge variant="outline">
                                  avg min ${Math.round(item.avgMinOrder)}
                                </Badge>
                              </div>
                            </div>
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
                      <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                        Why this is #1: {visibleDailyPromotionOpportunity.rankReason}
                      </div>
                    ) : null}
                    {visibleDailyPromotionOpportunity?.changed ? (
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                        What changed since yesterday: {visibleDailyPromotionOpportunity.changed}
                      </div>
                    ) : null}
                    {visibleDailyPromotionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyPromotionOpportunity.onAction}>
                          {visibleDailyPromotionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyPromotionOpportunity, "dismiss")}>
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
                      <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                        Why this is #1: {visibleDailyImprovementOpportunity.rankReason}
                      </div>
                    ) : null}
                    {visibleDailyImprovementOpportunity?.changed ? (
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                        What changed since yesterday: {visibleDailyImprovementOpportunity.changed}
                      </div>
                    ) : null}
                    {visibleDailyImprovementOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyImprovementOpportunity.onAction}>
                          {visibleDailyImprovementOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyImprovementOpportunity, "dismiss")}>
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
                      <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                        Why this is #1: {visibleDailyAcquisitionOpportunity.rankReason}
                      </div>
                    ) : null}
                    {visibleDailyAcquisitionOpportunity?.changed ? (
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                        What changed since yesterday: {visibleDailyAcquisitionOpportunity.changed}
                      </div>
                    ) : null}
                    {visibleDailyAcquisitionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyAcquisitionOpportunity.onAction}>
                          {visibleDailyAcquisitionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyAcquisitionOpportunity, "dismiss")}>
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
                      <div className="mt-2 text-xs text-[color:var(--text-muted)]">
                        Why this is #1: {visibleDailyMachineAttentionOpportunity.rankReason}
                      </div>
                    ) : null}
                    {visibleDailyMachineAttentionOpportunity?.changed ? (
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                        What changed since yesterday: {visibleDailyMachineAttentionOpportunity.changed}
                      </div>
                    ) : null}
                    {visibleDailyMachineAttentionOpportunity ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={visibleDailyMachineAttentionOpportunity.onAction}>
                          {visibleDailyMachineAttentionOpportunity.actionLabel}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "snooze")}>
                          Snooze
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleBriefAction(visibleDailyMachineAttentionOpportunity, "dismiss")}>
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
