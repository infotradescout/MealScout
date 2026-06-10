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
  search: string;
  hash: string;
} {
  const parsed = new URL(targetPath, "https://www.mealscout.us");

  // Direct tracked links never use nested destination params.
  parsed.searchParams.delete("to");

  // Canonical signup sharing should stay clean unless a role is truly required.
  if (
    parsed.pathname.toLowerCase() === "/customer-signup" &&
    parsed.searchParams.get("role") === "business"
  ) {
    parsed.searchParams.delete("role");
  }

  return {
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
}

function buildDirectAttributedPath(
  affiliateTag: string,
  targetPath: string,
): string {
  const sanitized = sanitizeTrackedTargetPath(targetPath);
  const parsed = new URL(
    `${sanitized.pathname}${sanitized.search}${sanitized.hash}`,
    "https://www.mealscout.us",
  );
  parsed.searchParams.set("ref", affiliateTag);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
