const BLOCKED_PREFIXES = ["/admin", "/staff", "/api", "/ref"];
const FIRST_PARTY_AFFILIATE_HOSTS = new Set([
  "mealscout.us",
  "www.mealscout.us",
  "api.mealscout.thetradescout.com",
  "meal-scout.vercel.app",
]);

export function normalizeInternalShareTarget(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.startsWith("//")) return null;
  if (!raw.startsWith("/")) return null;

  try {
    const parsed = new URL(raw, "https://www.mealscout.us");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function isEligibleInternalShareTarget(value: unknown): boolean {
  const target = normalizeInternalShareTarget(value);
  if (!target) return false;

  const pathname = target.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname === "/" || pathname === "") return false;
  return !BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Convert legacy affiliate destinations to a safe, internal path.
 *
 * Older affiliate records stored absolute URLs. We continue to support known
 * MealScout hosts (and the exact current application origin), but never retain
 * an origin in the redirect target. This keeps old first-party links working
 * without allowing the affiliate click endpoint to become an open redirect.
 */
export function normalizeEligibleAffiliateDestination(
  value: unknown,
  currentAppOrigin?: unknown,
): string | null {
  const internalTarget = normalizeInternalShareTarget(value);
  if (internalTarget) {
    return isEligibleInternalShareTarget(internalTarget)
      ? internalTarget
      : null;
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    let currentOrigin: string | null = null;
    try {
      const configured = new URL(String(currentAppOrigin || "").trim());
      if (configured.protocol === "https:" || configured.protocol === "http:") {
        currentOrigin = configured.origin;
      }
    } catch {
      currentOrigin = null;
    }

    const isFirstParty =
      parsed.origin === currentOrigin ||
      FIRST_PARTY_AFFILIATE_HOSTS.has(parsed.hostname.toLowerCase());
    if (!isFirstParty) return null;

    const normalized = normalizeInternalShareTarget(
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
    );
    return normalized && isEligibleInternalShareTarget(normalized)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export function buildUniversalAttributedPath(
  affiliateTag: string,
  targetPath: string,
): string {
  return `/ref/${encodeURIComponent(affiliateTag)}?to=${encodeURIComponent(
    targetPath,
  )}`;
}

function sanitizeTrackedTargetPath(targetPath: string): {
  pathname: string;
  searchParams: URLSearchParams;
  hash: string;
} {
  const parsed = new URL(targetPath, "https://www.mealscout.us");

  // Direct tracked links never use nested destination params or stale refs.
  parsed.searchParams.delete("to");
  parsed.searchParams.delete("ref");

  // Canonical signup sharing should stay clean unless a role is truly required.
  if (
    parsed.pathname.toLowerCase() === "/customer-signup" &&
    parsed.searchParams.get("role") === "business"
  ) {
    parsed.searchParams.delete("role");
  }

  return {
    pathname: parsed.pathname.replace(/\/+$/, "") || "/",
    searchParams: parsed.searchParams,
    hash: parsed.hash,
  };
}

function buildDirectAttributedPath(
  affiliateTag: string,
  targetPath: string,
): string {
  const normalizedTag = String(affiliateTag || "").trim();
  if (!normalizedTag) {
    throw new Error("Affiliate tag required");
  }
  const sanitized = sanitizeTrackedTargetPath(targetPath);
  if (sanitized.pathname === "/") {
    throw new Error("Invalid share target");
  }
  sanitized.searchParams.set("ref", normalizedTag);
  const search = sanitized.searchParams.toString();
  return `${sanitized.pathname}${search ? `?${search}` : ""}${sanitized.hash}`;
}

export function buildTrackedAttributedPath(
  affiliateTag: string,
  targetPath: string,
): string {
  const normalizedTarget = normalizeInternalShareTarget(targetPath);
  if (!normalizedTarget) {
    throw new Error("Invalid share target");
  }

  return buildDirectAttributedPath(affiliateTag, normalizedTarget);
}

export function buildUniversalAttributedUrl(
  baseUrl: string,
  affiliateTag: string,
  targetPath: string,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${buildUniversalAttributedPath(affiliateTag, targetPath)}`;
}

export function buildTrackedAttributedUrl(
  baseUrl: string,
  affiliateTag: string,
  targetPath: string,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${buildTrackedAttributedPath(affiliateTag, targetPath)}`;
}
