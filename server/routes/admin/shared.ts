/**
 * Shared utilities for admin route modules
 * Extracted from adminManagementRoutes during Phase 5: Oversized Route Splits
 */

export const buildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  `${(address || "").trim().toLowerCase()}|${(city || "")
    .trim()
    .toLowerCase()}|${(state || "").trim().toLowerCase()}`;

export const buildCanonicalPath = (entityType: string, entityId: string) => {
  switch (entityType) {
    case "restaurant":
      return `/restaurant/${entityId}`;
    case "deal":
      return `/deal/${entityId}`;
    case "event":
      return `/event/${entityId}`;
    case "host":
      return `/p/host/${entityId}`;
    default:
      return `/admin/control-center`;
  }
};

export const toCountDeltaLine = (
  label: string,
  currentCount: number,
  previousCount: number,
) => {
  const delta = currentCount - previousCount;
  if (delta > 0) {
    return `${label} is up ${delta} since yesterday (${currentCount} vs ${previousCount}).`;
  }
  if (delta < 0) {
    return `${label} is down ${Math.abs(delta)} since yesterday (${currentCount} vs ${previousCount}).`;
  }
  return `${label} is flat since yesterday (${currentCount} vs ${previousCount}).`;
};

export const formatDealValueLabel = (
  dealType?: string | null,
  discountValue?: string | number | null,
  minOrderAmount?: string | number | null,
) => {
  const discount = Number(discountValue || 0);
  const minOrder = Number(minOrderAmount || 0);
  const baseLabel =
    String(dealType || "").toLowerCase() === "fixed"
      ? `$${discount.toFixed(0)} off`
      : `${discount.toFixed(discount % 1 === 0 ? 0 : 2)}% off`;
  if (minOrder > 0) {
    return `${baseLabel} on orders from $${minOrder.toFixed(0)}`;
  }
  return baseLabel;
};
