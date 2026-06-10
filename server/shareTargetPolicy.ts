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

export function buildUniversalAttributedUrl(
  baseUrl: string,
  affiliateTag: string,
  targetPath: string,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${buildUniversalAttributedPath(affiliateTag, targetPath)}`;
}
