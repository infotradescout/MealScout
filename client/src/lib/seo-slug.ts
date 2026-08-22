const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractUuidFromSlug(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(UUID_RE);
  return match ? match[0] : null;
}

export function extractIdFromSlug(value: unknown): string {
  const supplied = String(value || "").trim();
  if (!supplied) return "";
  let raw = supplied;
  try {
    raw = decodeURIComponent(supplied);
  } catch {
    // Keep malformed percent-encoding fail-closed as the literal route value.
  }
  const marker = raw.lastIndexOf("--");
  if (marker >= 0) {
    const suffix = raw.slice(marker + 2).trim();
    if (suffix) return suffix;
  }
  return extractUuidFromSlug(raw) || raw;
}

export function toSeoSlug(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

export function makeEntitySlug(name: unknown, id: unknown): string {
  const slug = toSeoSlug(name);
  const uuid = extractUuidFromSlug(id);
  if (slug && uuid) return `${slug}--${uuid}`;
  if (uuid) return uuid;
  return slug || String(id || "").trim();
}

