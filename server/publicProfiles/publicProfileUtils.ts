import type { PublicCta, PublicCtaType, PublicImageAsset } from "@shared/publicProfiles";

export const toSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

export const toPublicRouteSlug = (name: unknown, id: unknown) => {
  const baseSlug = toSlug(name);
  const safeId = String(id || "").trim();
  if (baseSlug && safeId) return `${baseSlug}--${safeId}`;
  return baseSlug || safeId;
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
  name: unknown;
  id: unknown;
}) => {
  const routeSlug = toPublicRouteSlug(input.name, input.id);
  if (!routeSlug) return "/";

  if (input.entityType === "truck") return `/truck/${routeSlug}`;
  if (input.entityType === "bar") return `/bar/${routeSlug}`;
  if (input.entityType === "caterer") return `/caterer/${routeSlug}`;
  if (input.entityType === "private_chef") return `/private-chef/${routeSlug}`;
  if (input.entityType === "location") return `/location/${routeSlug}`;
  if (input.entityType === "supplier") return `/supplier/${routeSlug}`;
  return `/restaurant/${routeSlug}`;
};

const normalizeUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
};

const isSafeInternalPath = (value: string) =>
  /^\/(?!\/)[a-z0-9\-/_?=&%.]*$/i.test(value);

const isSafeExternal = (value: string) => /^https?:\/\//i.test(value);

const isSafePhone = (value: string) => /^tel:[+\d][\d\s\-().]+$/i.test(value);

export const buildPublicCta = (input: {
  label: string;
  href: unknown;
  type: PublicCtaType;
  priority?: number;
}): PublicCta | null => {
  const href = normalizeUrl(input.href);
  if (!href) return null;
  const safe =
    (input.type === "internal" && isSafeInternalPath(href)) ||
    ((input.type === "external" ||
      input.type === "map" ||
      input.type === "menu" ||
      input.type === "order" ||
      input.type === "social" ||
      input.type === "catering" ||
      input.type === "booking" ||
      input.type === "share") &&
      isSafeExternal(href)) ||
    (input.type === "phone" && isSafePhone(href));
  if (!safe) return null;
  return {
    label: String(input.label || "").trim(),
    href,
    type: input.type,
    safe,
    priority:
      typeof input.priority === "number" && Number.isFinite(input.priority)
        ? input.priority
        : undefined,
  };
};

export const imageAsset = (
  url: unknown,
  source: PublicImageAsset["source"],
): PublicImageAsset | null => {
  const raw = String(url || "").trim();
  let normalized: string | null = null;
  if (/^\/(?!\/)/.test(raw)) {
    normalized = raw;
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      normalized =
        ["http:", "https:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password
          ? parsed.toString()
          : null;
    } catch {
      normalized = null;
    }
  }
  if (!normalized) return null;
  return {
    url: normalized,
    source,
    lastVerifiedAt: null,
    publicApproved: true,
  };
};

export const joinedAddressLabel = (
  address: unknown,
  city: unknown,
  state: unknown,
) =>
  [String(address || "").trim(), String(city || "").trim(), String(state || "").trim()]
    .filter(Boolean)
    .join(", ") || null;
