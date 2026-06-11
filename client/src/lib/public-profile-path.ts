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
  entityType: "restaurant" | "truck" | "bar" | "location" | "supplier";
  id: unknown;
  name?: unknown;
  slug?: unknown;
}) => {
  const safeId = String(input.id || "").trim();
  if (!safeId) return null;
  const routeSlug = toPublicRouteSlug(input.slug || input.name || safeId, safeId);
  if (!routeSlug) return null;

  if (input.entityType === "truck") return `/truck/${encodeURIComponent(routeSlug)}`;
  if (input.entityType === "bar") return `/bar/${encodeURIComponent(routeSlug)}`;
  if (input.entityType === "location") return `/location/${encodeURIComponent(routeSlug)}`;
  if (input.entityType === "supplier") return `/supplier/${encodeURIComponent(routeSlug)}`;
  return `/restaurant/${encodeURIComponent(routeSlug)}`;
};
