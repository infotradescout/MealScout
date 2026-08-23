export function normalizeOrderContactPhone(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 40 || !/^[+\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}
