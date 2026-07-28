const BLOCKED_PREFIXES = ["/admin", "/staff", "/api", "/ref"];

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
