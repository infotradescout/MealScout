const BAR_TYPES = new Set(["bar", "brewery", "taproom", "nightlife", "venue"]);
const TRUCK_TYPES = new Set(["food_truck", "truck", "food-truck", "foodtruck"]);

export function normalizeBusinessType(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isBarBusinessType(value: unknown): boolean {
  return BAR_TYPES.has(normalizeBusinessType(value));
}

export function isTruckBusinessType(value: unknown): boolean {
  return TRUCK_TYPES.has(normalizeBusinessType(value));
}

export function isRestaurantLikeBusinessType(value: unknown): boolean {
  const normalized = normalizeBusinessType(value);
  return normalized === "restaurant" || isBarBusinessType(normalized);
}
