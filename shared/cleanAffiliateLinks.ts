const RESERVED_PUBLIC_BUSINESS_SLUGS = new Set([
  "",
  "about",
  "account-setup",
  "admin",
  "affiliate",
  "api",
  "business-team",
  "category",
  "change-password",
  "checkout",
  "city",
  "claim",
  "claim-truck",
  "compare",
  "contact",
  "customer-signup",
  "data-deletion",
  "deal",
  "deals",
  "deals-today",
  "delivery-app-alternatives",
  "directory",
  "event",
  "events",
  "events-today",
  "faq",
  "favorites",
  "food-truck-rush",
  "food-trucks",
  "food-trucks-today",
  "for-bars",
  "for-events",
  "for-hosts",
  "for-restaurants",
  "forgot-password",
  "help",
  "host-location-partner",
  "host-signup",
  "how-it-works",
  "install",
  "jobs",
  "kitchen",
  "location",
  "locations-with-trucks",
  "login",
  "map",
  "menu",
  "menu-builder",
  "moderation-policy",
  "online-ordering-platforms",
  "order-confirmation",
  "orders",
  "owner",
  "p",
  "parking-pass",
  "parking-pass-manage",
  "pensacola",
  "post-verification",
  "privacy-policy",
  "private-chefs",
  "profile",
  "ref",
  "reset-password",
  "restaurant",
  "restaurant-owner-dashboard",
  "restaurant-signup",
  "scout",
  "scout-prototype",
  "scoutcoin",
  "search",
  "settings",
  "share-hub",
  "signup",
  "sitemap",
  "staff",
  "status",
  "subscribe",
  "supplier",
  "suppliers",
  "supply",
  "terms-of-service",
  "trending",
  "truck",
  "user-dashboard",
  "video",
]);

const PUBLIC_PROFILE_ROUTE_PREFIXES = new Set([
  "restaurant",
  "truck",
  "bar",
  "location",
  "supplier",
]);

const UUID_SUFFIX_PATTERN = /--[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeSegment = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();

export function isDefaultLookingAffiliateTagSegment(value: unknown) {
  return /^user\d{4}$/i.test(String(value || "").trim());
}

export function isLikelyCleanAffiliateTagSegment(value: unknown) {
  const tag = String(value || "").trim().toLowerCase();
  if (!tag) return false;
  if (tag.length < 3 || tag.length > 24) return false;
  if (!/^[a-z0-9-]+$/.test(tag)) return false;
  if (tag.startsWith("-") || tag.endsWith("-")) return false;
  if (isDefaultLookingAffiliateTagSegment(tag)) return false;
  return true;
}

export function isReservedPublicBusinessSlug(value: unknown) {
  return RESERVED_PUBLIC_BUSINESS_SLUGS.has(normalizeSegment(value));
}

export function normalizeCleanBusinessSlug(value: unknown) {
  const raw = normalizeSegment(decodeSegment(String(value || "")));
  if (!raw) return null;
  if (!/^[a-z0-9-]+$/.test(raw)) return null;
  if (raw.startsWith("-") || raw.endsWith("-")) return null;
  if (isReservedPublicBusinessSlug(raw)) return null;
  return raw;
}

function stripLegacyProfileIdSuffix(value: unknown) {
  const raw = normalizeSegment(decodeSegment(String(value || "")));
  if (!raw) return null;
  const stripped = raw.replace(UUID_SUFFIX_PATTERN, "");
  return stripped || null;
}

export function buildCleanPublicBusinessPath(targetPath: string): string | null {
  const raw = String(targetPath || "").trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, "https://www.mealscout.us");
  } catch {
    return null;
  }

  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/") return null;

  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeSegment(part));

  let businessSlug: string | null = null;

  if (
    parts.length >= 2 &&
    PUBLIC_PROFILE_ROUTE_PREFIXES.has(normalizeSegment(parts[0]))
  ) {
    businessSlug = normalizeCleanBusinessSlug(stripLegacyProfileIdSuffix(parts[1]));
  } else if (parts.length >= 1) {
    const parsedRoute = parseCleanAffiliateBusinessRoute(pathname);
    businessSlug = parsedRoute?.businessSlug || null;
  }

  if (!businessSlug) return null;

  const cleanPath = `/${encodeURIComponent(businessSlug)}`;
  return `${cleanPath}${parsed.search}${parsed.hash}`;
}

export function buildCleanAffiliateBusinessPath(
  targetPath: string,
  affiliateTag: string,
): string | null {
  const cleanBase = buildCleanPublicBusinessPath(targetPath);
  const tag = String(affiliateTag || "").trim().toLowerCase();
  if (!cleanBase || !isLikelyCleanAffiliateTagSegment(tag)) return null;

  const parsed = new URL(cleanBase, "https://www.mealscout.us");
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/") return null;

  parsed.pathname = `${pathname}/${encodeURIComponent(tag)}`;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function parseCleanAffiliateBusinessRoute(pathname: string): {
  businessSlug: string;
  affiliateTag: string | null;
} | null {
  const raw = String(pathname || "").trim();
  if (!raw.startsWith("/")) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, "https://www.mealscout.us");
  } catch {
    return null;
  }

  const parts = parsed.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeSegment(part));

  if (parts.length === 0 || parts.length > 2) return null;

  const businessSlug = normalizeCleanBusinessSlug(parts[0]);
  if (!businessSlug) return null;

  if (parts.length === 1) {
    return { businessSlug, affiliateTag: null };
  }

  const affiliateTag = normalizeSegment(parts[1]);
  if (!isLikelyCleanAffiliateTagSegment(affiliateTag)) return null;

  return { businessSlug, affiliateTag };
}
