import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import type { Restaurant } from "@shared/schema";
import {
  AlertTriangle,
  Archive,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { SEOHead } from "@/components/seo-head";
import {
  getScopedBusinessPermissions,
  isScopedBusinessOwner,
  type BusinessAccessContext,
} from "@/lib/business-access";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";

type JsonRecord = Record<string, unknown>;

type OwnerAiCredential = {
  id: string;
  name: string;
  keyPrefix?: string | null;
  restaurantId?: string | null;
  isActive?: boolean | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
};

type OwnerAiSocialDraft = {
  platform: "facebook" | "instagram" | "x" | string;
  message?: string | null;
  selectedMessage?: string | null;
  attemptedPayloadText?: string | null;
  caption?: string | null;
  link?: string | null;
  imageUrl?: string | null;
  previewUrl?: string | null;
  fallbackPreviewUrl?: string | null;
  status?: string | null;
  errorMessage?: string | null;
  providerUrl?: string | null;
};

type OwnerAiMediaPreview = {
  assetKey: string;
  label: string;
  previewUrl: string;
  rightsAffirmed?: boolean;
  contentSha256?: string | null;
};

type OwnerAiDraft = {
  id: string;
  restaurantId: string;
  intent?: string | null;
  providerLabel?: string | null;
  createdVia?: string | null;
  status: string;
  revision?: number | null;
  packet?: JsonRecord | null;
  currentSnapshot?: JsonRecord | null;
  normalizedPlan?: JsonRecord | unknown[] | null;
  socialDrafts?: OwnerAiSocialDraft[] | Record<string, unknown> | null;
  socialResults?: OwnerAiSocialDraft[] | Record<string, unknown> | null;
  mediaPreviews?: OwnerAiMediaPreview[] | null;
  approvalUrl?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  approvedAt?: string | null;
  appliedAt?: string | null;
};

const DRAFT_STATUSES = new Set(["draft", "ready", "pending_approval"]);

function readArray<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as JsonRecord;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

function readDraft(payload: unknown): OwnerAiDraft | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as JsonRecord;
  const candidate = (record.draft || record.data || record) as unknown;
  if (!candidate || typeof candidate !== "object") return null;
  const draft = candidate as OwnerAiDraft;
  return draft.id ? draft : null;
}

function readCredentialSecret(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as JsonRecord;
  return String(
    record.token || record.apiKey || record.secret || record.plaintextKey || "",
  ).trim();
}

function normalizeSocialDrafts(draft: OwnerAiDraft | null) {
  if (!draft) return [];
  const normalize = (platform: string, value: unknown): OwnerAiSocialDraft => {
    const record =
      value && typeof value === "object" ? (value as JsonRecord) : {};
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as JsonRecord)
        : {};
    const selectedMessage =
      String(record.selectedMessage || record.message || "") || null;
    const link = String(record.link || "") || null;
    return {
      platform,
      message: selectedMessage,
      selectedMessage,
      attemptedPayloadText:
        String(record.attemptedPayloadText || "") ||
        [selectedMessage, link].filter(Boolean).join("\n") ||
        null,
      caption: String(record.caption || "") || null,
      link,
      imageUrl: String(record.imageUrl || "") || null,
      previewUrl: String(record.previewUrl || "") || null,
      fallbackPreviewUrl: String(record.fallbackPreviewUrl || "") || null,
      status: String(record.status || "") || null,
      errorMessage: String(record.errorMessage || record.error || "") || null,
      providerUrl:
        String(record.providerUrl || metadata.providerUrl || "") || null,
    };
  };

  const entries = (raw: OwnerAiDraft["socialDrafts"]) => {
    if (Array.isArray(raw)) {
      return raw.map((value) => {
        const record =
          value && typeof value === "object" ? (value as JsonRecord) : {};
        return normalize(String(record.platform || "social"), value);
      });
    }
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw).map(([platform, value]) =>
      normalize(platform, value),
    );
  };

  const byPlatform = new Map(
    entries(draft.socialDrafts).map((post) => [post.platform, post]),
  );
  for (const result of entries(draft.socialResults)) {
    const preview = byPlatform.get(result.platform);
    byPlatform.set(result.platform, {
      ...preview,
      ...result,
      message: preview?.message || result.message,
      selectedMessage: preview?.selectedMessage || result.selectedMessage,
      attemptedPayloadText:
        preview?.attemptedPayloadText || result.attemptedPayloadText,
      previewUrl: preview?.previewUrl || result.previewUrl,
      fallbackPreviewUrl:
        preview?.fallbackPreviewUrl || result.fallbackPreviewUrl,
      imageUrl: result.imageUrl || preview?.imageUrl,
      providerUrl: result.providerUrl || preview?.providerUrl,
    });
  }
  return [...byPlatform.values()];
}

function localOwnerAiPreviewUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const origin =
      typeof window === "undefined" ? "https://www.mealscout.us" : window.location.origin;
    const parsed = new URL(value, origin);
    if (parsed.pathname.startsWith("/api/owner-ai/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return "";
  }
  return value;
}

function operationLabel(operation: unknown) {
  if (!operation || typeof operation !== "object") return "Business update";
  const record = operation as JsonRecord;
  const raw = String(
    record.type ||
      [record.section, record.action].filter(Boolean).join(".") ||
      "business.update",
  );
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectDraftChanges(draft: OwnerAiDraft | null): unknown[] {
  if (!draft) return [];
  const normalized = draft.normalizedPlan;
  if (Array.isArray(normalized)) return normalized;
  if (normalized && Array.isArray(normalized.operations)) {
    return normalized.operations;
  }
  const packet = draft.packet || {};
  const changes: unknown[] = [];
  if (packet.profile) {
    changes.push({ type: "profile.update", changes: packet.profile });
  }
  if (packet.hours) {
    changes.push({ type: "hours.replace", hours: packet.hours });
  }
  if (Array.isArray(packet.menus)) {
    packet.menus.forEach((menu) => changes.push({ type: "menu.upsert", menu }));
  }
  if (Array.isArray(packet.schedules)) {
    packet.schedules.forEach((schedule) =>
      changes.push({ type: "schedule.upsert", schedule }),
    );
  }
  if (Array.isArray(packet.deals)) {
    packet.deals.forEach((deal) => changes.push({ type: "deal.upsert", deal }));
  }
  return changes;
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not yet";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function draftStatusDetails(statusValue: string) {
  const status = String(statusValue || "draft").toLowerCase();
  if (status === "applied" || status === "completed") {
    return {
      label: "Applied",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }
  if (status === "partially_published" || status === "partial") {
    return {
      label: "Applied · social follow-up",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }
  if (status === "failed") {
    return {
      label: "Needs attention",
      className: "border-red-200 bg-red-50 text-red-800",
    };
  }
  if (status === "cancelled" || status === "canceled") {
    return {
      label: "Cancelled",
      className: "border-stone-200 bg-stone-100 text-stone-700",
    };
  }
  return {
    label: "Waiting for approval",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  };
}

function buildStarterPacket(businessName: string) {
  const nextDay = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      intent: `Update ${businessName} from my instructions and prepare the matching social posts.`,
      source: {
        tool: "Replace with the AI you used",
      },
      schedules: [
        {
          operation: "upsert",
          ref: "example-stop",
          kind: "event_stop",
          eventName: "Replace with the confirmed event name",
          date: nextDay,
          startTime: "11:00",
          endTime: "14:00",
          locationName: "Replace with the confirmed stop name",
          address: "Replace with the confirmed public address",
          timezone: "America/Chicago",
          isPublic: true,
        },
      ],
      social: {
        enabled: true,
        platforms: ["facebook", "instagram", "x"],
        headline: "New schedule update",
        subheadline:
          "MealScout will create the descriptions and a branded image preview before approval.",
      },
    },
    null,
    2,
  );
}

async function fetchJson(url: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || "Request failed");
  }
  return response.json();
}

export default function OwnerAiActionsPage() {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const composerRef = useRef<HTMLDivElement | null>(null);
  const queryRestaurantId = useMemo(
    () => String(new URLSearchParams(search).get("restaurantId") || "").trim(),
    [search],
  );
  const queryDraftId = useMemo(
    () => String(new URLSearchParams(search).get("ownerAiDraft") || "").trim(),
    [search],
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [packetText, setPacketText] = useState("");
  const [connectorName, setConnectorName] = useState("My AI chat");
  const [revealedCredential, setRevealedCredential] = useState("");
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [loadedPreviews, setLoadedPreviews] = useState<Record<string, boolean>>(
    {},
  );
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>(
    {},
  );

  const { data: businesses = [], isLoading: businessesLoading } = useQuery<
    Restaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: Boolean(user),
  });
  const { data: businessAccess } = useQuery<BusinessAccessContext>({
    queryKey: ["/api/business-access/me"],
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const selectedBusiness =
    businesses.find((business) => business.id === queryRestaurantId) ||
    businesses[0] ||
    null;
  const restaurantId = selectedBusiness?.id || "";
  const ownsBusiness = isScopedBusinessOwner(businessAccess, restaurantId);
  const scopedPermissions = getScopedBusinessPermissions(
    businessAccess,
    restaurantId,
  );
  const publicProfileHref = selectedBusiness
    ? buildPublicProfilePath({
        entityType: selectedBusiness.isFoodTruck ? "truck" : "restaurant",
        id: selectedBusiness.id,
        name: selectedBusiness.name,
      })
    : null;

  useEffect(() => {
    if (!selectedBusiness) return;
    if (queryRestaurantId === selectedBusiness.id) return;
    setLocation(
      `/owner-ai?restaurantId=${encodeURIComponent(selectedBusiness.id)}`,
    );
  }, [queryRestaurantId, selectedBusiness, setLocation]);

  useEffect(() => {
    if (!selectedBusiness) return;
    setPacketText(buildStarterPacket(selectedBusiness.name));
    setSelectedDraftId(null);
    setRevealedCredential("");
  }, [selectedBusiness?.id, selectedBusiness?.name]);

  const draftsQuery = useQuery<OwnerAiDraft[]>({
    queryKey: ["owner-ai-drafts", restaurantId],
    queryFn: async () =>
      readArray<OwnerAiDraft>(
        await fetchJson(
          `/api/owner-ai/restaurants/${encodeURIComponent(restaurantId)}/drafts`,
        ),
        ["drafts", "items", "data"],
      ),
    enabled: Boolean(restaurantId && ownsBusiness),
    refetchOnWindowFocus: false,
  });
  const drafts = draftsQuery.data || [];

  useEffect(() => {
    if (queryDraftId && drafts.some((draft) => draft.id === queryDraftId)) {
      if (selectedDraftId !== queryDraftId) setSelectedDraftId(queryDraftId);
      return;
    }
    if (selectedDraftId && drafts.some((draft) => draft.id === selectedDraftId)) {
      return;
    }
    setSelectedDraftId(drafts[0]?.id || null);
  }, [drafts, queryDraftId, selectedDraftId]);

  const draftDetailQuery = useQuery<OwnerAiDraft | null>({
    queryKey: ["owner-ai-draft", selectedDraftId],
    queryFn: async () =>
      readDraft(
        await fetchJson(
          `/api/owner-ai/drafts/${encodeURIComponent(selectedDraftId || "")}`,
        ),
      ),
    enabled: Boolean(selectedDraftId && ownsBusiness),
    refetchOnWindowFocus: false,
  });
  const selectedDraft =
    draftDetailQuery.data ||
    drafts.find((draft) => draft.id === selectedDraftId) ||
    null;

  const contextQuery = useQuery<JsonRecord>({
    queryKey: ["owner-ai-context", restaurantId],
    queryFn: () =>
      fetchJson(
        `/api/owner-ai/restaurants/${encodeURIComponent(restaurantId)}/context`,
      ),
    enabled: Boolean(restaurantId && ownsBusiness),
    refetchOnWindowFocus: false,
  });

  const credentialsQuery = useQuery<OwnerAiCredential[]>({
    queryKey: ["owner-ai-credentials", restaurantId],
    queryFn: async () =>
      readArray<OwnerAiCredential>(
        await fetchJson(
          `/api/owner-ai/restaurants/${encodeURIComponent(restaurantId)}/credentials`,
        ),
        ["credentials", "keys", "items", "data"],
      ),
    enabled: Boolean(restaurantId && ownsBusiness),
    refetchOnWindowFocus: false,
  });
  const credentials = credentialsQuery.data || [];

  const refreshDrafts = async (draftId?: string | null) => {
    await queryClient.invalidateQueries({
      queryKey: ["owner-ai-drafts", restaurantId],
    });
    if (draftId) {
      await queryClient.invalidateQueries({
        queryKey: ["owner-ai-draft", draftId],
      });
    }
  };

  const createDraftMutation = useMutation({
    mutationFn: async () => {
      let parsed: JsonRecord;
      try {
        parsed = JSON.parse(packetText) as JsonRecord;
      } catch {
        throw new Error("The action packet is not valid JSON.");
      }
      const request =
        parsed.packet && typeof parsed.packet === "object"
          ? parsed
          : { packet: parsed };
      const response = await apiRequest(
        "POST",
        `/api/owner-ai/restaurants/${encodeURIComponent(restaurantId)}/drafts`,
        request,
      );
      return readDraft(await response.json());
    },
    onSuccess: async (draft) => {
      await refreshDrafts(draft?.id);
      if (draft?.id) {
        setSelectedDraftId(draft.id);
        setLocation(
          `/owner-ai?restaurantId=${encodeURIComponent(restaurantId)}&ownerAiDraft=${encodeURIComponent(draft.id)}`,
        );
      }
      toast({
        title: "Draft prepared",
        description:
          "Review the MealScout changes, post descriptions, and images before approving.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Draft could not be prepared",
        description: error.message,
        variant: "destructive",
      }),
  });

  const approveDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/owner-ai/drafts/${encodeURIComponent(draftId)}/approve`,
        { expectedRevision: selectedDraft?.revision || 1 },
      );
      return response.json();
    },
    onSuccess: async (_payload, draftId) => {
      await refreshDrafts(draftId);
      toast({
        title:
          selectedDraft?.status === "applied"
            ? "Social publishing checked"
            : "MealScout updated",
        description:
          "The canonical update and each social result are shown separately below.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Approval sequence needs attention",
        description: error.message,
        variant: "destructive",
      }),
  });

  const cancelDraftMutation = useMutation({
    mutationFn: async (draftId: string) =>
      apiRequest(
        "POST",
        `/api/owner-ai/drafts/${encodeURIComponent(draftId)}/cancel`,
        { expectedRevision: selectedDraft?.revision || 1 },
      ),
    onSuccess: async (_response, draftId) => {
      await refreshDrafts(draftId);
      toast({ title: "Draft cancelled", description: "Nothing was changed." });
    },
    onError: (error: Error) =>
      toast({
        title: "Draft could not be cancelled",
        description: error.message,
        variant: "destructive",
      }),
  });

  const createCredentialMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/owner-ai/credentials", {
        restaurantId,
        name: connectorName.trim() || "My AI chat",
      });
      return response.json();
    },
    onSuccess: async (payload) => {
      const secret = readCredentialSecret(payload);
      setRevealedCredential(secret);
      await queryClient.invalidateQueries({
        queryKey: ["owner-ai-credentials", restaurantId],
      });
      toast({
        title: "Draft-only connector created",
        description: secret
          ? "Copy it now. MealScout will not show the full key again."
          : "The connector is ready.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Connector could not be created",
        description: error.message,
        variant: "destructive",
      }),
  });

  const revokeCredentialMutation = useMutation({
    mutationFn: async (credentialId: string) =>
      apiRequest(
        "POST",
        `/api/owner-ai/credentials/${encodeURIComponent(credentialId)}/revoke`,
        {},
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["owner-ai-credentials", restaurantId],
      });
      toast({ title: "Connector revoked" });
    },
    onError: (error: Error) =>
      toast({
        title: "Connector could not be revoked",
        description: error.message,
        variant: "destructive",
      }),
  });

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(label);
      window.setTimeout(() => setCopiedValue(null), 1800);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const aiSetupPrompt = useMemo(() => {
    const baseUrl =
      typeof window === "undefined"
        ? "https://www.mealscout.us"
        : window.location.origin;
    return [
      `You are helping me manage ${selectedBusiness?.name || "my business"} in MealScout.`,
      `Read the model-neutral instructions at ${baseUrl}/api/owner-ai/instructions.`,
      `My business ID is ${restaurantId}.`,
      revealedCredential
        ? `Use this revocable draft-only connector key: ${revealedCredential}`
        : "Ask me for a draft-only connector key, or return a portable MealScout JSON action packet I can paste into the owner approval page.",
      "Read current MealScout context before proposing changes. Prepare profile, hours, schedules/events, menus, item prices, logos/gallery images, deals, and social content exactly from my instructions.",
      "Create platform-ready descriptions and an image or MealScout generated-card brief for each requested social post.",
      "Never say anything was updated or published until I approve the MealScout preview. Return the MealScout approval link after creating the draft.",
    ].join("\n");
  }, [restaurantId, revealedCredential, selectedBusiness?.name]);
  const freeAiContextPrompt = useMemo(
    () =>
      JSON.stringify(
        {
          task:
            "Use this current MealScout context and my plain-language instructions to return one valid MealScout Owner AI draft request. Do not claim anything was changed or published. Return JSON only.",
          contract: {
            instructions: "/api/owner-ai/instructions",
            schema: "/api/owner-ai/schema",
            acceptedShape: {
              expectedVersions: "copy from currentMealScoutContext.expectedVersions",
              packet: {
                schemaVersion: "1.0",
                intent: "describe the requested update",
              },
            },
          },
          currentMealScoutContext: contextQuery.data || null,
        },
        null,
        2,
      ),
    [contextQuery.data],
  );

  const operations = useMemo(
    () => collectDraftChanges(selectedDraft),
    [selectedDraft],
  );
  const socialDrafts = useMemo(
    () => normalizeSocialDrafts(selectedDraft),
    [selectedDraft],
  );
  const mediaPreviews = useMemo(
    () =>
      (selectedDraft?.mediaPreviews || []).filter(
        (preview) => !preview.assetKey.startsWith("social-"),
      ),
    [selectedDraft],
  );
  const previewRevisionKey = `${selectedDraft?.id || "none"}:${
    selectedDraft?.revision || 0
  }`;
  const requiredPreviewKeys = useMemo(
    () => [
      ...mediaPreviews.map(
        (preview) => `${previewRevisionKey}:media:${preview.assetKey}`,
      ),
      ...socialDrafts.map(
        (post) => `${previewRevisionKey}:social:${post.platform}`,
      ),
    ],
    [mediaPreviews, previewRevisionKey, socialDrafts],
  );
  const previewsFailed = requiredPreviewKeys.some((key) => failedPreviews[key]);
  const previewsReady =
    !previewsFailed && requiredPreviewKeys.every((key) => loadedPreviews[key]);

  const selectedStatus = draftStatusDetails(selectedDraft?.status || "draft");
  const canApprove = Boolean(
    selectedDraft && DRAFT_STATUSES.has(String(selectedDraft.status).toLowerCase()),
  );
  const canContinueSocial = Boolean(
    String(selectedDraft?.status || "").toLowerCase() === "applied" &&
      socialDrafts.some((post) =>
        ["approved", "publishing"].includes(
          String(post.status || "").toLowerCase(),
        ),
      ),
  );

  if (businessesLoading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-orange-600" />
        <span className="ml-3 text-sm text-muted-foreground">
          Loading your business…
        </span>
      </main>
    );
  }

  if (!selectedBusiness) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Connect a business first</CardTitle>
            <CardDescription>
              AI control only works for a MealScout business you own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/restaurant-signup") }>
              Connect a business
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const workspaceCapabilities = {
    overview: true,
    profile: ownsBusiness || scopedPermissions.manageProfile,
    menu: ownsBusiness || scopedPermissions.manageProfile,
    availability: ownsBusiness || scopedPermissions.manageParkingPass,
    media: ownsBusiness || scopedPermissions.manageProfile,
    deals: ownsBusiness || scopedPermissions.manageDeals,
    audience: ownsBusiness || scopedPermissions.viewAnalytics,
    team: ownsBusiness,
    payments: ownsBusiness,
    settings: ownsBusiness || scopedPermissions.manageProfile,
  };

  return (
    <BusinessWorkspaceShell
      activeModule="ai"
      business={selectedBusiness}
      businesses={businesses}
      onBusinessChange={(businessId) =>
        setLocation(`/owner-ai?restaurantId=${encodeURIComponent(businessId)}`)
      }
      publicProfileHref={publicProfileHref}
      capabilities={workspaceCapabilities}
    >
      <SEOHead
        title={`AI Control | ${selectedBusiness.name} | MealScout`}
        description="Review and approve model-neutral AI drafts for MealScout business content and connected social publishing."
        noIndex
      />
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-5 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-orange-800">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                One approval for the whole business
              </div>
              <h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-stone-950 sm:text-4xl">
                Run MealScout from the AI you already use
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700 sm:text-base">
                Tell any free or paid AI what changed. It prepares menus, prices,
                schedules, events, profile copy, logos and images, deals, plus the
                matching social descriptions and artwork. You see the complete
                preview before anything changes.
              </p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
              {[
                ["1", "AI prepares", "No MealScout mutation"],
                ["2", "You approve", "Changes and posts shown together"],
                ["3", "MealScout commits", "Then connected socials publish"],
              ].map(([step, title, detail]) => (
                <div key={step} className="flex gap-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-600 text-sm font-black text-white">
                    {step}
                  </span>
                  <div>
                    <p className="text-sm font-black text-stone-950">{title}</p>
                    <p className="text-xs text-stone-600">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!ownsBusiness ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Owner approval required</AlertTitle>
            <AlertDescription>
              Team access does not grant this full-business AI authority. The
              business owner must create connectors and approve action packets.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              icon: Store,
              title: "Profile + media",
              detail: "Descriptions, links, logo, cover, and gallery",
            },
            {
              icon: UtensilsCrossed,
              title: "Menus + prices",
              detail: "Menus, categories, items, photos, and availability",
            },
            {
              icon: Clock3,
              title: "Hours + events",
              detail: "Business hours, truck stops, schedules, and events",
            },
            {
              icon: Megaphone,
              title: "Deals + socials",
              detail: "Offers, post descriptions, artwork, and publishing",
            },
          ].map(({ icon: Icon, title, detail }) => (
            <Card key={title} className="border-stone-200">
              <CardContent className="p-4">
                <Icon className="h-5 w-5 text-orange-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-black text-stone-950">{title}</p>
                <p className="mt-1 text-xs leading-5 text-stone-600">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="space-y-6">
            <Card ref={composerRef}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Clipboard className="h-5 w-5 text-orange-600" />
                      Portable action packet
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Paste the JSON returned by any AI chat. Preparing a draft
                      creates previews only—it cannot update or publish.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPacketText(
                        buildStarterPacket(selectedBusiness.name),
                      )
                    }
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset example
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-blue-200 bg-blue-50 text-blue-950">
                  <Bot className="h-4 w-4" />
                  <AlertTitle>Using a free AI with no tools?</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>
                      Copy your current MealScout facts into that chat, describe what changed,
                      then paste its returned JSON below.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!contextQuery.data || contextQuery.isLoading}
                      onClick={() => copyText("context", freeAiContextPrompt)}
                    >
                      {contextQuery.isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : copiedValue === "context" ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      Copy current context for any AI
                    </Button>
                  </AlertDescription>
                </Alert>
                <Label htmlFor="owner-ai-packet">MealScout JSON packet</Label>
                <Textarea
                  id="owner-ai-packet"
                  value={packetText}
                  onChange={(event) => setPacketText(event.target.value)}
                  className="min-h-[360px] font-mono text-xs leading-5"
                  spellCheck={false}
                  aria-describedby="owner-ai-packet-help"
                />
                <p id="owner-ai-packet-help" className="text-xs text-stone-600">
                  Facts remain owner-controlled. Remote images are copied into
                  MealScout only after approval; unconfirmed claims are rejected.
                </p>
                <Button
                  type="button"
                  onClick={() => createDraftMutation.mutate()}
                  disabled={!ownsBusiness || createDraftMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  {createDraftMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Prepare changes and social previews
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-orange-600" />
                  Connect an AI that supports tools
                </CardTitle>
                <CardDescription>
                  This revocable key can read this business and prepare drafts.
                  It cannot approve, alter MealScout, or publish a post.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <Label htmlFor="connector-name">Connector name</Label>
                    <Input
                      id="connector-name"
                      value={connectorName}
                      onChange={(event) => setConnectorName(event.target.value)}
                      placeholder="ChatGPT, Claude, Gemini, Copilot…"
                    />
                  </div>
                  <Button
                    type="button"
                    className="self-end"
                    onClick={() => createCredentialMutation.mutate()}
                    disabled={!ownsBusiness || createCredentialMutation.isPending}
                  >
                    {createCredentialMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    Create draft-only key
                  </Button>
                </div>

                {revealedCredential ? (
                  <Alert className="border-emerald-200 bg-emerald-50">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                    <AlertTitle>Copy this key now</AlertTitle>
                    <AlertDescription className="mt-2 space-y-3">
                      <code className="block overflow-x-auto rounded-lg border border-emerald-200 bg-white p-3 text-xs text-stone-900">
                        {revealedCredential}
                      </code>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => copyText("key", revealedCredential)}
                        >
                          {copiedValue === "key" ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Copy className="mr-2 h-4 w-4" />
                          )}
                          Copy key
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => copyText("prompt", aiSetupPrompt)}
                        >
                          {copiedValue === "prompt" ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Bot className="mr-2 h-4 w-4" />
                          )}
                          Copy AI setup prompt
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyText("prompt", aiSetupPrompt)}
                  >
                    {copiedValue === "prompt" ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copy vendor-neutral setup prompt
                  </Button>
                )}

                {credentials.length ? (
                  <div className="divide-y rounded-xl border">
                    {credentials.map((credential) => {
                      const expired = Boolean(
                        credential.expiresAt &&
                          new Date(credential.expiresAt).getTime() <= Date.now(),
                      );
                      const active =
                        credential.isActive !== false &&
                        !credential.revokedAt &&
                        !expired;
                      return (
                      <div
                        key={credential.id}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-stone-900">
                            {credential.name || "AI connector"}
                          </p>
                          <p className="text-xs text-stone-600">
                            {credential.keyPrefix || "Hidden key"} · last used{" "}
                            {formatWhen(credential.lastUsedAt)}
                          </p>
                        </div>
                        {active ? <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" variant="ghost">
                              <Trash2 className="mr-2 h-4 w-4" />
                              Revoke
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke this connector?</AlertDialogTitle>
                              <AlertDialogDescription>
                                It will immediately lose access to current
                                business context and draft creation. Existing
                                drafts remain available for your review.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep connector</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  revokeCredentialMutation.mutate(credential.id)
                                }
                              >
                                Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog> : (
                          <Badge
                            variant="outline"
                            className="border-stone-200 bg-stone-100 text-stone-700"
                          >
                            {expired ? "Expired" : "Revoked"}
                          </Badge>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Approval queue</CardTitle>
                    <CardDescription>
                      Each draft stays inert until the owner approves it.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => draftsQuery.refetch()}
                    disabled={draftsQuery.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${draftsQuery.isFetching ? "animate-spin" : ""}`}
                    />
                    <span className="sr-only">Refresh drafts</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {draftsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-stone-600">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading drafts…
                  </div>
                ) : drafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-6 text-center">
                    <Sparkles className="mx-auto h-7 w-7 text-orange-500" />
                    <p className="mt-3 text-sm font-bold text-stone-900">
                      No drafts yet
                    </p>
                    <p className="mt-1 text-xs leading-5 text-stone-600">
                      Ask your AI for an update or paste a portable packet to see
                      the complete approval preview here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {drafts.map((draft) => {
                      const details = draftStatusDetails(draft.status);
                      const isSelected = draft.id === selectedDraftId;
                      return (
                        <button
                          key={draft.id}
                          type="button"
                          onClick={() => {
                            setSelectedDraftId(draft.id);
                            setLocation(
                              `/owner-ai?restaurantId=${encodeURIComponent(restaurantId)}&ownerAiDraft=${encodeURIComponent(draft.id)}`,
                            );
                          }}
                          className={`w-full rounded-xl border p-3 text-left transition ${
                            isSelected
                              ? "border-orange-300 bg-orange-50 ring-2 ring-orange-100"
                              : "border-stone-200 bg-white hover:border-orange-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-bold text-stone-950">
                                {draft.intent || "Business update"}
                              </p>
                              <p className="mt-1 text-xs text-stone-600">
                                {formatWhen(draft.createdAt)} ·{" "}
                                {draft.providerLabel || draft.createdVia || "portable packet"}
                              </p>
                            </div>
                            <Badge variant="outline" className={details.className}>
                              {details.label}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedDraft ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>Review the complete sequence</CardTitle>
                      <CardDescription>
                        MealScout commits first. Only then does each approved
                        social channel publish.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={selectedStatus.className}>
                      {selectedStatus.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {selectedDraft.lastError ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Action needed</AlertTitle>
                      <AlertDescription>{selectedDraft.lastError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <section aria-labelledby="meal-changes-heading">
                    <h2
                      id="meal-changes-heading"
                      className="flex items-center gap-2 text-sm font-black text-stone-950"
                    >
                      <Store className="h-4 w-4 text-orange-600" />
                      MealScout changes
                    </h2>
                    <div className="mt-3 space-y-2">
                      {operations.length ? (
                        operations.map((operation, index) => (
                          <div
                            key={`${operationLabel(operation)}-${index}`}
                            className="flex gap-3 rounded-xl border bg-stone-50 p-3"
                          >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-stone-900">
                                {operationLabel(operation)}
                              </p>
                              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-stone-600">
                                {JSON.stringify(operation, null, 2)}
                              </pre>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-xl border border-dashed p-3 text-xs text-stone-600">
                          No normalized operations were returned for this draft.
                        </p>
                      )}
                    </div>
                  </section>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <details className="rounded-2xl border border-stone-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-black text-stone-950">
                        Current values before this revision
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-stone-600">
                        The targeted records as they existed when this draft was created.
                      </p>
                      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-950 p-4 text-[11px] leading-5 text-stone-100">
                        {JSON.stringify(selectedDraft.currentSnapshot || {}, null, 2)}
                      </pre>
                    </details>
                    <details
                      open
                      className="rounded-2xl border border-orange-200 bg-orange-50 p-4"
                    >
                      <summary className="cursor-pointer text-sm font-black text-stone-950">
                        Exact validated MealScout values after approval
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-stone-600">
                        These are the complete values locked to this revision. Approval cannot
                        pick up a later AI edit.
                      </p>
                      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-950 p-4 text-[11px] leading-5 text-stone-100">
                        {JSON.stringify(selectedDraft.packet || {}, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {mediaPreviews.length ? (
                    <section aria-labelledby="media-previews-heading">
                      <h2
                        id="media-previews-heading"
                        className="flex items-center gap-2 text-sm font-black text-stone-950"
                      >
                        <ImageIcon className="h-4 w-4 text-orange-600" />
                        Logos, menu photos, and other supplied images
                      </h2>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {mediaPreviews.map((preview) => (
                          <figure
                            key={preview.assetKey}
                            className="overflow-hidden rounded-2xl border bg-white"
                          >
                            <img
                              key={`${selectedDraft.id}:${selectedDraft.revision}:${preview.assetKey}`}
                              src={localOwnerAiPreviewUrl(preview.previewUrl)}
                              alt={`${preview.label} approval preview`}
                              loading="lazy"
                              decoding="async"
                              onLoad={() =>
                                setLoadedPreviews((current) => ({
                                  ...current,
                                  [`${previewRevisionKey}:media:${preview.assetKey}`]: true,
                                }))
                              }
                              onError={() =>
                                setFailedPreviews((current) => ({
                                  ...current,
                                  [`${previewRevisionKey}:media:${preview.assetKey}`]: true,
                                }))
                              }
                              className="aspect-video w-full bg-stone-100 object-contain"
                            />
                            <figcaption className="flex items-center justify-between gap-3 p-3 text-xs font-bold text-stone-700">
                              <span>{preview.label}</span>
                              {preview.rightsAffirmed ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-emerald-800"
                                >
                                  Rights affirmed
                                </Badge>
                              ) : null}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section aria-labelledby="social-previews-heading">
                    <h2
                      id="social-previews-heading"
                      className="flex items-center gap-2 text-sm font-black text-stone-950"
                    >
                      <ImageIcon className="h-4 w-4 text-orange-600" />
                      Social descriptions and images
                    </h2>
                    <div className="mt-3 space-y-3">
                      {socialDrafts.length ? (
                        socialDrafts.map((post) => {
                          const previewSrc = localOwnerAiPreviewUrl(
                            post.previewUrl ||
                              post.imageUrl ||
                              `/api/owner-ai/drafts/${encodeURIComponent(selectedDraft.id)}/social-preview/${encodeURIComponent(post.platform)}.svg`,
                          );
                          const postStatus = String(post.status || "preview").toLowerCase();
                          const posted = postStatus === "posted";
                          const failed = postStatus === "failed";
                          const manualRequired = postStatus === "manual_required";
                          return (
                            <article
                              key={post.platform}
                              className="overflow-hidden rounded-2xl border bg-white"
                            >
                              <img
                                key={`${selectedDraft.id}:${selectedDraft.revision}:${post.platform}`}
                                src={previewSrc}
                                alt={`${post.platform} post artwork preview`}
                                loading="lazy"
                                decoding="async"
                                onLoad={() =>
                                  setLoadedPreviews((current) => ({
                                    ...current,
                                    [`${previewRevisionKey}:social:${post.platform}`]: true,
                                  }))
                                }
                                onError={() =>
                                  setFailedPreviews((current) => ({
                                    ...current,
                                    [`${previewRevisionKey}:social:${post.platform}`]: true,
                                  }))
                                }
                                className="aspect-square w-full bg-stone-100 object-cover"
                              />
                              <div className="space-y-3 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-black capitalize text-stone-950">
                                    {post.platform}
                                  </p>
                                  <Badge
                                    variant="outline"
                                    className={
                                      posted
                                         ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                         : failed
                                           ? "border-red-200 bg-red-50 text-red-800"
                                           : manualRequired
                                             ? "border-amber-200 bg-amber-50 text-amber-900"
                                           : "border-blue-200 bg-blue-50 text-blue-800"
                                    }
                                  >
                                    {post.status || "Preview only"}
                                  </Badge>
                                </div>
                                <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">
                                  {post.attemptedPayloadText ||
                                    post.message ||
                                    post.caption ||
                                    "Description will be generated from the approved changes."}
                                </p>
                                {post.errorMessage ? (
                                  <p className="text-xs font-semibold text-red-700">
                                    {post.errorMessage}
                                  </p>
                                ) : null}
                                {post.providerUrl ? (
                                  <a
                                    href={post.providerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center text-xs font-bold text-orange-700 hover:underline"
                                  >
                                    Open published post
                                    <ExternalLink className="ml-1 h-3 w-3" />
                                  </a>
                                ) : null}
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <p className="rounded-xl border border-dashed p-3 text-xs text-stone-600">
                          This packet did not request social publishing.
                        </p>
                      )}
                    </div>
                  </section>

                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
                    Approval is atomic for MealScout content. A social provider
                    failure is reported for that channel and never reverses or
                    disguises the MealScout update.
                  </div>

                  {canApprove && requiredPreviewKeys.length > 0 && !previewsReady ? (
                    <Alert variant={previewsFailed ? "destructive" : "default"}>
                      <ImageIcon className="h-4 w-4" />
                      <AlertTitle>
                        {previewsFailed
                          ? "An image changed or could not be reviewed"
                          : "Loading every image before approval"}
                      </AlertTitle>
                      <AlertDescription>
                        {previewsFailed
                          ? "Approval is disabled. Ask your AI to create a fresh draft so the owner reviews the same immutable image MealScout will apply and publish."
                          : "Approval unlocks after every logo, menu, deal, and social image in this revision has loaded."}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {canApprove || canContinueSocial ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            disabled={
                              approveDraftMutation.isPending ||
                              (canApprove && !previewsReady)
                            }
                            className="flex-1"
                          >
                            {approveDraftMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ShieldCheck className="mr-2 h-4 w-4" />
                            )}
                            {canContinueSocial
                              ? "Continue approved posts"
                              : "Approve changes and posts"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {canContinueSocial
                                ? "Continue the already-approved posts?"
                                : "Apply this exact preview?"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {canContinueSocial ? (
                                <>
                                  The MealScout changes are already committed. This only resumes
                                  the stored, owner-approved social intents and cannot pick up a
                                  later AI edit.
                                </>
                              ) : (
                                <>
                                  MealScout will first commit the {operations.length} approved
                                  business {operations.length === 1 ? "change" : "changes"}. It
                                  will then publish the approved description and image to each
                                  connected social account. This cannot publish any later AI edit.
                                </>
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => approveDraftMutation.mutate(selectedDraft.id)}
                            >
                              {canContinueSocial
                                ? "Continue approved sequence"
                                : "Approve this revision"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      {canApprove ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setPacketText(
                                JSON.stringify(selectedDraft.packet || {}, null, 2),
                              );
                              composerRef.current?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }}
                          >
                            <Clipboard className="mr-2 h-4 w-4" />
                            Load packet to revise
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              cancelDraftMutation.mutate(selectedDraft.id)
                            }
                            disabled={cancelDraftMutation.isPending}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Cancel
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </BusinessWorkspaceShell>
  );
}
