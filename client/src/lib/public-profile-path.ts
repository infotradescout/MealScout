const slugify = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const toPublicRouteSlug = (name: unknown, id: unknown) => {
  const slug = slugify(name);
  const safeId = String(id || "").trim();
  if (slug && safeId) return `${slug}--${safeId}`;
  return slug || safeId;
};

export const buildPublicProfilePath = (input: {
  entityType:
    | "restaurant"
    | "truck"
    | "bar"
    | "caterer"
    | "private_chef"
    | "location"
    | "supplier";
  id: unknown;
  name?: unknown;
  slug?: unknown;
  businessType?: unknown;
}) => {
  const safeId = String(input.id || "").trim();
  if (!safeId) return null;
  const routeSlug = toPublicRouteSlug(input.slug || input.name || safeId, safeId);
  if (!routeSlug) return null;

  const canonicalBusinessType = toCanonicalFoodBusinessType(input.businessType);
  const entityType =
    input.entityType === "restaurant" && canonicalBusinessType
      ? canonicalBusinessType === "food_truck"
        ? "truck"
        : canonicalBusinessType
      : input.entityType;

  if (entityType === "truck") return `/truck/${encodeURIComponent(routeSlug)}`;
  if (entityType === "bar") return `/bar/${encodeURIComponent(routeSlug)}`;
  if (entityType === "caterer") return `/caterer/${encodeURIComponent(routeSlug)}`;
  if (entityType === "private_chef") return `/private-chef/${encodeURIComponent(routeSlug)}`;
  if (entityType === "location") return `/location/${encodeURIComponent(routeSlug)}`;
  if (entityType === "supplier") return `/supplier/${encodeURIComponent(routeSlug)}`;
  return `/restaurant/${encodeURIComponent(routeSlug)}`;
};
import { toCanonicalFoodBusinessType } from "@shared/businessTypes";
