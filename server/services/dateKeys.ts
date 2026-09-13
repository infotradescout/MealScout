import { DateTime } from "luxon";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  const normalized = String(value || "").trim();
  if (!DATE_KEY_RE.test(normalized)) return false;
  return DateTime.fromISO(normalized, { zone: "utc" }).toFormat("yyyy-LL-dd") === normalized;
}

export function dateKeyInZone(date: Date | string, timeZone: string): string {
  const dt =
    date instanceof Date
      ? DateTime.fromJSDate(date, { zone: "utc" }).setZone(timeZone)
      : DateTime.fromISO(String(date), { zone: timeZone });
  return dt.toFormat("yyyy-LL-dd");
}

export function dateKeyFromUnknown(
  value: unknown,
  _timeZone: string,
): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    // Database date-only columns are commonly returned as UTC-midnight Date
    // instances. Preserve that stored calendar key; converting the instant to
    // a venue zone would incorrectly move it to the prior day.
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dateKey = raw.includes("T") ? raw.split("T")[0] : raw;
  if (!isDateKey(dateKey)) return null;
  return dateKey;
}

export function utcDateFromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  return DateTime.fromISO(dateKey, { zone: "utc" })
    .plus({ days })
    .toFormat("yyyy-LL-dd");
}

export function formatDateKeyForDisplay(
  value: unknown,
  locale = "en-US",
): string {
  const dateKey = dateKeyFromUnknown(value, "UTC");
  if (!dateKey) return "";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function weekdayInZoneForDateKey(
  dateKey: string,
  timeZone: string,
): number {
  const dt = DateTime.fromISO(dateKey, { zone: timeZone }).startOf("day");
  // Luxon weekday: 1=Mon ... 7=Sun
  return dt.weekday % 7;
}
