export const FOOD_BUSINESS_TYPES = [
  "restaurant",
  "bar",
  "food_truck",
  "caterer",
  "private_chef",
] as const;

export type FoodBusinessType = (typeof FOOD_BUSINESS_TYPES)[number];

export type BusinessCapabilities = {
  recurringHours: boolean;
  datedStops: boolean;
  liveLocationBroadcast: boolean;
  menu: boolean;
  onlineOrdering: boolean;
  booking: boolean;
  eventParticipation: boolean;
  supplierCatalog: boolean;
  hostLocations: boolean;
};

const BAR_ALIASES = new Set([
  "bar",
  "brewery",
  "taproom",
  "brewery_taproom",
  "nightlife",
  // Legacy food-business rows used "venue" for bar/nightlife businesses.
  // New host/event venues use the separate canonical "host_venue" value.
  "venue",
]);
const TRUCK_ALIASES = new Set([
  "food_truck",
  "truck",
  "food-truck",
  "foodtruck",
  "mobile_food_vendor",
]);
const RESTAURANT_ALIASES = new Set(["restaurant"]);

const CAPABILITIES: Record<FoodBusinessType, BusinessCapabilities> = {
  restaurant: {
    recurringHours: true,
    datedStops: false,
    liveLocationBroadcast: false,
    menu: true,
    onlineOrdering: true,
    booking: true,
    eventParticipation: true,
    supplierCatalog: false,
    hostLocations: true,
  },
  bar: {
    recurringHours: true,
    datedStops: false,
    liveLocationBroadcast: false,
    menu: true,
    onlineOrdering: true,
    booking: true,
    eventParticipation: true,
    supplierCatalog: false,
    hostLocations: true,
  },
  food_truck: {
    recurringHours: true,
    datedStops: true,
    liveLocationBroadcast: true,
    menu: true,
    onlineOrdering: true,
    booking: true,
    eventParticipation: true,
    supplierCatalog: false,
    hostLocations: false,
  },
  caterer: {
    recurringHours: false,
    datedStops: false,
    liveLocationBroadcast: false,
    menu: true,
    onlineOrdering: true,
    booking: true,
    eventParticipation: true,
    supplierCatalog: false,
    hostLocations: false,
  },
  private_chef: {
    recurringHours: false,
    datedStops: false,
    liveLocationBroadcast: false,
    menu: true,
    onlineOrdering: false,
    booking: true,
    eventParticipation: true,
    supplierCatalog: false,
    hostLocations: false,
  },
};

export function normalizeBusinessType(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function toCanonicalFoodBusinessType(
  value: unknown,
): FoodBusinessType | null {
  const normalized = normalizeBusinessType(value);
  if (BAR_ALIASES.has(normalized)) return "bar";
  if (TRUCK_ALIASES.has(normalized)) return "food_truck";
  if (RESTAURANT_ALIASES.has(normalized)) return "restaurant";
  if (normalized === "caterer" || normalized === "private_chef") {
    return normalized;
  }
  return null;
}

export function resolveStoredFoodBusinessType(input: {
  businessType?: unknown;
  isFoodTruck?: unknown;
}): FoodBusinessType | null {
  const canonical = toCanonicalFoodBusinessType(input.businessType);
  if (input.isFoodTruck === true || canonical === "food_truck") {
    return "food_truck";
  }
  return canonical;
}

export function getBusinessCapabilities(
  value: unknown,
): BusinessCapabilities | null {
  const type = toCanonicalFoodBusinessType(value);
  return type ? CAPABILITIES[type] : null;
}

export function isBarBusinessType(value: unknown): boolean {
  return toCanonicalFoodBusinessType(value) === "bar";
}

export function isTruckBusinessType(value: unknown): boolean {
  return toCanonicalFoodBusinessType(value) === "food_truck";
}

export function isRestaurantLikeBusinessType(value: unknown): boolean {
  const normalized = toCanonicalFoodBusinessType(value);
  return normalized === "restaurant" || normalized === "bar";
}
