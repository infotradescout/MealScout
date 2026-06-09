const deletedOwnerEmailPattern = /^deleted\+[^@\s]+@mealscout\.invalid$/i;

const signalLabels: Record<string, string> = {
  emailDomainHasMx: "Email MX",
  websiteDomainResolves: "Website DNS",
  emailMatchesWebsite: "Email matches website",
  hasSocial: "Social",
  hasGeo: "Geo",
  hasAddress: "Address",
  phoneMatches: "Phone match",
  freeEmailDomain: "Free email",
  menu: "Menu",
  phone: "Phone",
  email: "Email",
};

const toFiniteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const titleCaseSignal = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export function formatVacScoreDisplay(
  score: unknown,
  maxScore?: unknown,
): string {
  const numericScore = toFiniteNumber(score);
  if (numericScore === null) return "Unknown";

  const numericMax = toFiniteNumber(maxScore);
  const normalized =
    numericMax && numericMax > 0 && numericMax !== 100
      ? Math.round((numericScore / numericMax) * 100)
      : Math.round(numericScore);

  const bounded = Math.max(0, Math.min(100, normalized));
  return `${bounded} / 100`;
}

export function formatSignalsDisplay(signals: unknown): string {
  if (signals == null || signals === "") return "No signals";
  if (typeof signals === "string") return signals.trim() || "No signals";

  const entries = Array.isArray(signals)
    ? signals.map((value, index) => [String(index), value] as const)
    : typeof signals === "object"
      ? Object.entries(signals as Record<string, unknown>)
      : [];

  if (!entries.length) return "No signals";

  const active = entries
    .filter(([, value]) => value === true || (typeof value === "string" && value.trim()))
    .map(([key, value]) =>
      typeof value === "string" && Array.isArray(signals)
        ? value.trim()
        : signalLabels[key] || titleCaseSignal(key),
    )
    .filter(Boolean);

  if (active.length) return active.slice(0, 4).join(" + ");
  return `${entries.length} signals`;
}

export function formatOwnerEmailDisplay(email: unknown): string {
  const value = String(email || "").trim();
  if (!value) return "No active owner";
  if (deletedOwnerEmailPattern.test(value)) return "Deleted owner";
  if (value.toLowerCase().endsWith("@mealscout.invalid")) return "System owner";
  return value;
}

export function getAdminSmokeRowStatus(row: {
  name?: unknown;
  isQuarantined?: unknown;
  isActive?: unknown;
  ownerEmail?: unknown;
  missingFields?: unknown;
}): "operational" | "quarantined" | "test_smoke" | "deleted_system" {
  if (row.isQuarantined) return "quarantined";
  if (formatOwnerEmailDisplay(row.ownerEmail) === "Deleted owner") return "deleted_system";

  const name = String(row.name || "").trim().toLowerCase();
  if (
    /^test(?:\s|$)/.test(name) ||
    name.includes("smoke") ||
    name.includes("asdf") ||
    /\b\d{10,}\b/.test(name)
  ) {
    return "test_smoke";
  }

  if (row.isActive === false) return "deleted_system";
  return "operational";
}

export function formatSignupDateDisplay(value: unknown, now = new Date()): string {
  if (!value) return "Unknown";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Invalid date";
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    return "Future/test date";
  }
  return date.toLocaleDateString();
}
