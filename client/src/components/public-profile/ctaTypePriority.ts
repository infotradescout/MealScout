/**
 * Shared CTA type priority order for surfaces that don't have full
 * entity-aware context (MobileActionDock, ThinProfileState) and just need
 * "which CTA type wins if more than one is available." The richer,
 * entity-aware CTA scoring used by the desktop QuickActionRow
 * (ctaPriorityForProfile in public-profile.tsx) is intentionally separate
 * — it weighs order/menu/map differently per restaurant/host/supplier,
 * which this flat list can't represent.
 */
export const CTA_TYPE_PRIORITY_ORDER = [
  "map",
  "order",
  "menu",
  "phone",
  "booking",
  "catering",
  "external",
  "social",
  "share",
  "internal",
] as const;

export const CTA_TYPE_PRIORITY: Record<string, number> =
  Object.fromEntries(
    CTA_TYPE_PRIORITY_ORDER.map((type, index) => [type, index + 1]),
  );
