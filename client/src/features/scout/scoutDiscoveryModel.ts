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
    title: "Live Food Trucks Now",
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
    id: "popular_dishes",
    title: "Popular Dishes",
    acceptedCardKinds: ["menu_item"],
    priority: 7,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "hot_deals",
    title: "Hot Deals",
    acceptedCardKinds: ["deal"],
    priority: 8,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "happy_hours",
    title: "Happy Hours",
    acceptedCardKinds: ["happy_hour"],
    priority: 9,
    maxCards: 8,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "events_popups",
    title: "Events & Pop-Ups",
    acceptedCardKinds: ["event"],
    priority: 10,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "content_entity",
  },
  {
    id: "nearby_restaurants",
    title: "Nearby Restaurants",
    acceptedCardKinds: ["restaurant"],
    priority: 11,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "trending_this_week",
    title: "Trending This Week",
    acceptedCardKinds: ["food_truck", "restaurant", "menu_item", "deal", "event"],
    priority: 12,
    maxCards: 10,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "new_to_mealscout",
    title: "New to MealScout",
    acceptedCardKinds: ["food_truck", "restaurant"],
    priority: 13,
    maxCards: 8,
    hideWhenEmpty: true,
    dedupPolicy: "strict_business",
  },
  {
    id: "community_picks",
    title: "Community Picks",
    acceptedCardKinds: ["community_pick", "food_truck", "restaurant"],
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
