import type { ScoutBlueprintConfig, ScoutEntity } from "./types";

type TradeScoutLikeKind = "business" | "helper" | "job" | "supplier" | "follow_up";

export type TradeScoutLikeRecord = {
  id: string;
  kind: TradeScoutLikeKind;
  name: string;
  statusLabel?: string | null;
  description?: string | null;
  profileHref?: string | null;
  lat?: number | null;
  lng?: number | null;
  urgency?: number | null;
  proximity?: number | null;
  availableNow?: boolean | null;
  serviceCategory?: string | null;
  metadata?: Record<string, unknown>;
};

export function mapTradeScoutRecordToScoutEntity(
  record: TradeScoutLikeRecord,
): ScoutEntity {
  return {
    id: record.id,
    kind: record.kind,
    title: record.name,
    subtitle: record.statusLabel ?? record.serviceCategory ?? null,
    body: record.description ?? null,
    href: record.profileHref ?? null,
    coordinates:
      typeof record.lat === "number" && typeof record.lng === "number"
        ? { lat: record.lat, lng: record.lng }
        : null,
    tags: [
      record.kind,
      record.statusLabel,
      record.serviceCategory,
      record.availableNow ? "available_now" : null,
    ].flatMap((value) => (value ? [String(value)] : [])),
    signals: {
      urgency: record.urgency,
      proximity: record.proximity,
      availableNow: record.availableNow,
      serviceCategory: record.serviceCategory,
    },
    payload: {
      adapter: "tradescout",
      tradeSpecificMetadata: record.metadata ?? {},
    },
  };
}

export const tradeScoutBlueprintConfig: ScoutBlueprintConfig = {
  productName: "TradeScout",
  defaultLaneId: "best_next",
  defaultActionId: "urgent",
  features: [
    { id: "map", label: "Map", defaultEnabled: true },
    { id: "availability", label: "Availability", defaultEnabled: true },
    { id: "pricing", label: "Pricing", defaultEnabled: true },
    { id: "messages", label: "Messages", defaultEnabled: false },
  ],
  actions: [
    {
      id: "urgent",
      label: "Urgent",
      laneId: "best_next",
      queryBoosts: ["urgent open available today"],
      mapLayerIds: ["jobs", "pros"],
    },
    {
      id: "contractors",
      label: "Providers",
      laneId: "pros",
      kinds: ["business", "helper"],
      mapLayerIds: ["pros"],
    },
    {
      id: "open_jobs",
      label: "Open Jobs",
      laneId: "jobs",
      kinds: ["job"],
      mapLayerIds: ["jobs"],
    },
    {
      id: "suppliers",
      label: "Suppliers",
      laneId: "suppliers",
      kinds: ["supplier"],
      mapLayerIds: ["suppliers"],
    },
    {
      id: "followups",
      label: "Follow-ups",
      laneId: "followups",
      queryBoosts: ["follow up estimate message waiting"],
      enabledFeatures: ["messages"],
    },
  ],
  lanes: [
    {
      id: "best_next",
      title: "Best Next",
      subtitle: "The most useful next actions based on current trade signals.",
      maxItems: 8,
    },
    {
      id: "pros",
      title: "Available Pros",
      kinds: ["business", "helper"],
      maxItems: 12,
    },
    {
      id: "jobs",
      title: "Open Jobs",
      kinds: ["job"],
      maxItems: 12,
    },
    {
      id: "suppliers",
      title: "Supply Points",
      kinds: ["supplier"],
      featureId: "map",
      maxItems: 12,
    },
    {
      id: "followups",
      title: "Follow-ups",
      subtitle: "Messages, estimates, and stalled handoffs.",
      featureId: "messages",
      maxItems: 10,
    },
  ],
  rank(entity, state) {
    const urgency = Number(entity.signals?.urgency ?? 0);
    const proximity = Number(entity.signals?.proximity ?? 0);
    const availability = entity.signals?.availableNow ? 20 : 0;
    const actionBoost =
      state.activeActionId && entity.tags?.includes(state.activeActionId) ? 15 : 0;
    return urgency + proximity + availability + actionBoost;
  },
};

export const tradeScoutAdapterProofRecords: TradeScoutLikeRecord[] = [
  {
    id: "business-1",
    kind: "business",
    name: "Northside Electric",
    statusLabel: "Available today",
    serviceCategory: "electrical",
    urgency: 80,
    proximity: 12,
    availableNow: true,
    lat: 33.74,
    lng: -84.38,
  },
  {
    id: "job-1",
    kind: "job",
    name: "Panel repair request",
    statusLabel: "Open job",
    serviceCategory: "electrical",
    urgency: 65,
    proximity: 8,
  },
  {
    id: "supplier-1",
    kind: "supplier",
    name: "Westside Supply Counter",
    statusLabel: "Parts nearby",
    serviceCategory: "materials",
    lat: 33.73,
    lng: -84.4,
  },
  {
    id: "follow-up-1",
    kind: "follow_up",
    name: "Estimate follow-up",
    statusLabel: "Waiting on reply",
    urgency: 35,
    proximity: 4,
  },
];
