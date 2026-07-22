export function applyRestaurantCreationPolicy<T extends Record<string, any>>(
  restaurant: T,
  now = new Date(),
): T {
  const priceLockCutoff = new Date("2026-04-01");
  if (
    restaurant.isFoodTruck !== true &&
    now < priceLockCutoff &&
    !restaurant.lockedPriceCents
  ) {
    return {
      ...restaurant,
      lockedPriceCents: 2500,
      priceLockDate: now,
      priceLockReason: "early_rollout",
    };
  }
  return { ...restaurant };
}
