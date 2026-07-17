import { toCanonicalFoodBusinessType } from "@shared/businessTypes";

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

export type ScoutHorizontalRowId =
  | "live_trucks_now"
  | "food_trucks_today"
  | "open_now_near_you"
  | "saved_favorites"
  | "following"
  | "order_again"
  | "host_locations"
  | "popular_dishes"
  | "hot_deals"
  | "happy_hours"
  | "events_popups"
  | "nearby_restaurants"
  | "trending_this_week"
  | "new_to_mealscout"
  | "community_picks"
  | "worth_discovering";

export type ScoutRowDedupPolicy = "strict_business" | "content_entity";

export type ScoutHorizontalRowDefinition = {
  id: ScoutHorizontalRowId;
  title: string;
  acceptedCardKinds: ScoutNormalizedCardKind[];
  priority: number;
  maxCards: number;
  hideWhenEmpty: true;
  dedupPolicy: ScoutRowDedupPolicy;
};

export const SCOUT_HORIZONTAL_ROW_REGISTRY: ScoutHorizontalRowDefinition[] = [
  {
    id: "live_trucks_now",
    title: "Now Serving Trucks",
    acceptedCardKinds: ["food_truck"],
    priority: 1,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "food_trucks_today",
    title: "Food Trucks Today",
    acceptedCardKinds: ["food_truck", "truck_stop"],
    priority: 2,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "open_now_near_you",
    title: "Open Now Near You",
    acceptedCardKinds: ["restaurant", "food_truck", "map_place", "local_activity"],
    priority: 3,
    maxCards: 12,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "host_locations",
    title: "Host Locations Nearby",
    acceptedCardKinds: ["map_place"],
    priority: 4,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "saved_favorites",
    title: "Your Favorites",
    acceptedCardKinds: ["food_truck", "restaurant"],
    priority: 4,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "following",
    title: "Following",
    acceptedCardKinds: ["food_truck", "restaurant"],
    priority: 5,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "order_again",
    title: "Order Again",
    acceptedCardKinds: ["food_truck", "restaurant", "menu_item"],
    priority: 6,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "community_picks",
    title: "Community Picks",
    acceptedCardKinds: ["community_pick", "food_truck", "restaurant"],
    priority: 7,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "trending_this_week",
    title: "Local Activity",
    acceptedCardKinds: ["food_truck", "restaurant", "menu_item", "deal", "event"],
    priority: 8,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "new_to_mealscout",
    title: "Newest on MealScout",
    acceptedCardKinds: ["food_truck", "restaurant"],
    priority: 9,
    maxCards: 8,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "popular_dishes",
    title: "Menu Highlights",
    acceptedCardKinds: ["menu_item"],
    priority: 10,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "hot_deals",
    title: "Hot Deals",
    acceptedCardKinds: ["deal"],
    priority: 11,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "happy_hours",
    title: "Happy Hours",
    acceptedCardKinds: ["happy_hour"],
    priority: 12,
    maxCards: 8,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "events_popups",
    title: "Events & Pop-Ups",
    acceptedCardKinds: ["event"],
    priority: 13,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "nearby_restaurants",
    title: "Nearby Restaurants",
    acceptedCardKinds: ["restaurant"],
    priority: 14,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "worth_discovering",
    title: "Worth Discovering",
    acceptedCardKinds: ["food_truck", "restaurant", "map_place", "local_activity"],
    priority: 15,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
];

export type ScoutPrimarySectionId =
  | ScoutHorizontalRowId
  | "open_now"
  | "hot_deals"
  | "happy_hours"
  | "events_popups"
  | "popular_dishes";

export const SCOUT_PRIMARY_SECTION_PRIORITY: ScoutPrimarySectionId[] = [
  ...SCOUT_HORIZONTAL_ROW_REGISTRY.map((row) => row.id),
  "open_now",
  "hot_deals",
  "happy_hours",
  "events_popups",
  "popular_dishes",
];

const LOCATION_TYPES = new Set([
  "host",
  "host_location",
  "host_venue",
  "location",
  "venue",
  "map_place",
]);

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

  // Structural fields describe the card/entity itself. They take precedence
  // over food-business aliases so an event venue remains a map place even
  // though legacy restaurant rows used businessType="venue" for bars.
  const structuralType = readString(source, [
    "cardKind",
    "entityKind",
    "entityType",
    "profileType",
    "type",
    "kind",
  ]);

  if (structuralType) {
    const normalized = normalizeToken(structuralType);
    if (LOCATION_TYPES.has(normalized)) return "map_place";
    const businessType = toCanonicalFoodBusinessType(normalized);
    if (businessType === "food_truck") return "food_truck";
    if (businessType) return "restaurant";
    if (normalized === "truck_stop" || normalized === "scheduled_stop") return "truck_stop";
    if (normalized === "menu_item" || normalized === "dish") return "menu_item";
    if (normalized === "happy_hour") return "happy_hour";
    if (normalized === "deal") return "deal";
    if (normalized === "event" || normalized === "popup" || normalized === "pop_up") return "event";
    if (normalized === "community_pick" || normalized === "community") return "community_pick";
    return "local_activity";
  }

  const explicitBusinessType = readString(source, ["businessType"]);
  if (explicitBusinessType) {
    const normalized = normalizeToken(explicitBusinessType);
    const businessType = toCanonicalFoodBusinessType(normalized);
    if (businessType === "food_truck") return "food_truck";
    if (businessType) return "restaurant";
    if (LOCATION_TYPES.has(normalized)) return "map_place";
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

export const SCOUT_MIN_MENU_BUSINESS_DIVERSITY = 2;

/**
 * Groups duplicate business records by their human-facing identity before
 * falling back to database ids. This keeps punctuation-only listing variants
 * from occupying multiple positions in the same discovery category.
 */
export function getScoutCanonicalBusinessKey(
  source: unknown,
  route?: string | null,
): string | null {
  if (!source || typeof source !== "object") {
    return getScoutBusinessKey(source, route);
  }

  const explicitBusinessName = readString(source, [
    "businessName",
    "restaurantName",
  ]);
  const parentBusinessId = readString(source, [
    "businessId",
    "restaurantId",
    "truckId",
    "profileId",
    "entityId",
  ]);
  const displayName =
    explicitBusinessName ||
    (parentBusinessId ? null : readString(source, ["name", "title"]));
  const normalizedName = slugKey(displayName);

  return normalizedName
    ? `identity:${normalizedName}`
    : getScoutBusinessKey(source, route);
}

export function selectDistinctScoutMenuBusinesses<T>(
  items: readonly T[],
  limit = 10,
  claimedBusinessKeys: Set<string> = new Set<string>(),
): T[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) return [];

  const selected: T[] = [];
  for (const item of items) {
    const key = getScoutCanonicalBusinessKey(item);
    if (key && claimedBusinessKeys.has(key)) continue;
    if (key) claimedBusinessKeys.add(key);
    selected.push(item);
    if (selected.length >= normalizedLimit) break;
  }
  return selected;
}

function hashScoutRotationSeed(seedKey: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seedKey.length; index += 1) {
    hash ^= seedKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rotateScoutSpots<T>(
  items: readonly T[],
  seedKey: string,
  getKey: (item: T) => string | null,
  limit = 8,
): T[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0 || items.length === 0) return [];

  const seenKeys = new Set<string>();
  const uniqueItems: T[] = [];
  items.forEach((item, index) => {
    const key = getKey(item) || `unkeyed:${index}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    uniqueItems.push(item);
  });

  if (uniqueItems.length <= 1) return uniqueItems.slice(0, normalizedLimit);

  const offset = hashScoutRotationSeed(seedKey) % uniqueItems.length;
  return uniqueItems
    .slice(offset)
    .concat(uniqueItems.slice(0, offset))
    .slice(0, normalizedLimit);
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
  const priority = new Map(
    SCOUT_PRIMARY_SECTION_PRIORITY.map((sectionId, index) => [sectionId, index]),
  );
  const assigned: Partial<Record<ScoutPrimarySectionId, T[]>> = {};

  for (const section of [...sections].sort(
    (a, b) => (priority.get(a.id) ?? 999) - (priority.get(b.id) ?? 999),
  )) {
    // Keep one card per business inside a category. The same business may
    // legitimately appear in another category (for example, a restaurant
    // with both a popular dish and an active deal).
    assigned[section.id] = filterUniqueScoutBusinessCards(
      section.items,
      section.getBusinessKey,
      new Set<string>(),
    );
  }

  return assigned;
}
