import type { ScoutBlueprintConfig, ScoutEntity } from "./types";

type MealScoutLikeKind = "truck" | "restaurant" | "menu_item" | "deal" | "event";

export type MealScoutLikeRecord = {
  id: string;
  kind: MealScoutLikeKind;
  name: string;
  cuisine?: string | null;
  description?: string | null;
  profileHref?: string | null;
  imageUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  scheduleLabel?: string | null;
  menuLabel?: string | null;
  dealLabel?: string | null;
  startsAt?: string | null;
  distanceMiles?: number | null;
  metadata?: Record<string, unknown>;
};

export function mapMealScoutRecordToScoutEntity(
  record: MealScoutLikeRecord,
): ScoutEntity {
  return {
    id: record.id,
    kind: record.kind,
    title: record.name,
    subtitle: record.cuisine ?? record.scheduleLabel ?? record.dealLabel ?? null,
    body: record.description ?? null,
    href: record.profileHref ?? null,
    imageUrl: record.imageUrl ?? null,
    coordinates:
      typeof record.lat === "number" && typeof record.lng === "number"
        ? { lat: record.lat, lng: record.lng }
        : null,
    tags: [
      record.kind,
      record.cuisine,
      record.scheduleLabel,
      record.menuLabel,
      record.dealLabel,
    ].flatMap((value) => (value ? [String(value)] : [])),
    signals: {
      scheduleLabel: record.scheduleLabel,
      menuLabel: record.menuLabel,
      dealLabel: record.dealLabel,
      startsAt: record.startsAt,
      distanceMiles: record.distanceMiles,
    },
    payload: {
      adapter: "mealscout",
      foodSpecificMetadata: record.metadata ?? {},
    },
  };
}

export const mealScoutAdapterProofConfig: ScoutBlueprintConfig = {
  productName: "MealScout Adapter Proof",
  defaultLaneId: "best_now",
  defaultActionId: "nearby",
  features: [
    { id: "map", label: "Map", defaultEnabled: true },
    { id: "schedule", label: "Schedule", defaultEnabled: true },
    { id: "menus", label: "Menus", defaultEnabled: true },
    { id: "deals", label: "Deals", defaultEnabled: true },
  ],
  actions: [
    { id: "nearby", label: "Nearby", laneId: "best_now" },
    { id: "trucks", label: "Trucks", laneId: "trucks", kinds: ["truck"] },
    {
      id: "menus",
      label: "Menus",
      laneId: "menus",
      kinds: ["menu_item"],
      enabledFeatures: ["menus"],
    },
    {
      id: "deals",
      label: "Deals",
      laneId: "deals",
      kinds: ["deal"],
      enabledFeatures: ["deals"],
    },
  ],
  lanes: [
    { id: "best_now", title: "Best Now", maxItems: 6 },
    { id: "trucks", title: "Truck Results", kinds: ["truck"], maxItems: 8 },
    {
      id: "menus",
      title: "Menu Results",
      kinds: ["menu_item"],
      featureId: "menus",
      maxItems: 8,
    },
    {
      id: "deals",
      title: "Deal Results",
      kinds: ["deal"],
      featureId: "deals",
      maxItems: 8,
    },
  ],
};

export const mealScoutAdapterProofRecords: MealScoutLikeRecord[] = [
  {
    id: "truck-1",
    kind: "truck",
    name: "Example Mobile Kitchen",
    cuisine: "Island bowls",
    scheduleLabel: "Scheduled today",
    lat: 30.4213,
    lng: -87.2169,
  },
  {
    id: "menu-1",
    kind: "menu_item",
    name: "Example Bowl",
    cuisine: "Lunch",
    menuLabel: "Menu highlight",
  },
  {
    id: "deal-1",
    kind: "deal",
    name: "Example Lunch Deal",
    dealLabel: "Deal today",
    lat: 30.42,
    lng: -87.22,
  },
];
