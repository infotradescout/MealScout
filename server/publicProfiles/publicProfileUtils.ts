import type { PublicCta, PublicCtaType, PublicImageAsset } from "@shared/publicProfiles";

export const toSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

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
}): PublicCta | null => {
  const href = normalizeUrl(input.href);
  if (!href) return null;
  const safe =
    (input.type === "internal" && isSafeInternalPath(href)) ||
    ((input.type === "external" || input.type === "map" || input.type === "menu") &&
      isSafeExternal(href)) ||
    (input.type === "phone" && isSafePhone(href));
  if (!safe) return null;
  return {
    label: String(input.label || "").trim(),
    href,
    type: input.type,
    safe,
  };
};

export const imageAsset = (
  url: unknown,
  source: PublicImageAsset["source"],
): PublicImageAsset | null => {
  const normalized = normalizeUrl(url);
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
