export type ScoutNormalizedCardKind =
  | "food_truck"
  | "restaurant"
  | "truck_stop"
  | "menu_item"
  | "deal"
  | "happy_hour"
  | "event"
  | "community_pick"
  | "map_place"
  | "local_activity";

export type ScoutBusinessSourceHint = "restaurant" | "truck" | "location" | "activity";

export type ScoutPrimarySectionId =
  | "open_now"
  | "food_trucks_today"
  | "hot_deals"
  | "happy_hours"
  | "events_popups"
  | "popular_dishes"
  | "nearby_restaurants"
  | "trending_this_week"
  | "new_to_mealscout"
  | "community_picks"
  | "worth_discovering";

export const SCOUT_PRIMARY_SECTION_PRIORITY: ScoutPrimarySectionId[] = [
  "open_now",
  "food_trucks_today",
  "hot_deals",
  "happy_hours",
  "events_popups",
  "popular_dishes",
  "nearby_restaurants",
  "trending_this_week",
  "new_to_mealscout",
  "community_picks",
  "worth_discovering",
];

const TRUCK_TYPES = new Set([
  "food_truck",
  "foodtruck",
  "truck",
  "mobile_food_vendor",
  "mobile_vendor",
]);

const RESTAURANT_TYPES = new Set([
  "restaurant",
  "restaurant_owner",
  "dine_in_restaurant",
  "sit_down_restaurant",
]);

const LOCATION_TYPES = new Set(["host", "host_location", "location", "venue", "map_place"]);

function readString(source: unknown, fields: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readBoolean(source: unknown, fields: string[]): boolean | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1"].includes(normalized)) return true;
      if (["false", "no", "0"].includes(normalized)) return false;
    }
  }
  return null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeScoutBusinessKind(
  source: unknown,
  sourceHint?: ScoutBusinessSourceHint,
): ScoutNormalizedCardKind {
  if (readBoolean(source, ["isFoodTruck", "foodTruck", "isTruck"]) === true) {
    return "food_truck";
  }

  const explicit = readString(source, [
    "cardKind",
    "entityKind",
    "entityType",
    "profileType",
    "businessType",
    "type",
    "kind",
  ]);

  if (explicit) {
    const normalized = normalizeToken(explicit);
    if (TRUCK_TYPES.has(normalized)) return "food_truck";
    if (RESTAURANT_TYPES.has(normalized)) return "restaurant";
    if (LOCATION_TYPES.has(normalized)) return "map_place";
    if (normalized === "truck_stop" || normalized === "scheduled_stop") return "truck_stop";
    if (normalized === "menu_item" || normalized === "dish") return "menu_item";
    if (normalized === "happy_hour") return "happy_hour";
    if (normalized === "deal") return "deal";
    if (normalized === "event" || normalized === "popup" || normalized === "pop_up") return "event";
    if (normalized === "community_pick" || normalized === "community") return "community_pick";
    return "local_activity";
  }

  if (sourceHint === "truck") return "food_truck";
  if (sourceHint === "restaurant") return "restaurant";
  if (sourceHint === "location") return "map_place";
  return "local_activity";
}

function slugKey(value: unknown): string | null {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

export function getScoutBusinessKey(source: unknown, route?: string | null): string | null {
  if (!source || typeof source !== "object") {
    return route ? `route:${route}` : null;
  }

  const id = readString(source, [
    "businessId",
    "profileId",
    "restaurantId",
    "truckId",
    "entityId",
    "id",
  ]);
  if (id) return `business:${id}`;

  if (route) return `route:${route}`;

  const slug = readString(source, ["slug", "profileSlug"]);
  if (slug) return `slug:${slugKey(slug)}`;

  const name = readString(source, ["businessName", "restaurantName", "name", "title"]);
  const normalizedName = slugKey(name);
  return normalizedName ? `name:${normalizedName}` : null;
}

export function filterUniqueScoutBusinessCards<T>(
  items: T[],
  getBusinessKey: (item: T) => string | null,
  claimedBusinessKeys: Set<string>,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const key = getBusinessKey(item);
    if (key && claimedBusinessKeys.has(key)) continue;
    if (key) claimedBusinessKeys.add(key);
    kept.push(item);
  }
  return kept;
}

export function assignScoutBusinessCardsBySection<T>(
  sections: Array<{
    id: ScoutPrimarySectionId;
    items: T[];
    getBusinessKey: (item: T) => string | null;
  }>,
): Partial<Record<ScoutPrimarySectionId, T[]>> {
  const claimedBusinessKeys = new Set<string>();
  const priority = new Map(
    SCOUT_PRIMARY_SECTION_PRIORITY.map((sectionId, index) => [sectionId, index]),
  );
  const assigned: Partial<Record<ScoutPrimarySectionId, T[]>> = {};

  for (const section of [...sections].sort(
    (a, b) => (priority.get(a.id) ?? 999) - (priority.get(b.id) ?? 999),
  )) {
    assigned[section.id] = filterUniqueScoutBusinessCards(
      section.items,
      section.getBusinessKey,
      claimedBusinessKeys,
    );
  }

  return assigned;
}
