export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validatedParts(dateKey: string) {
  if (!DATE_KEY_PATTERN.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Strictly preserve an API/local-calendar date as YYYY-MM-DD. API timestamps
 * used for date-only fields intentionally keep their leading calendar key;
 * they are not converted through the viewer's UTC offset.
 */
export function dateOnlyKey(value: unknown): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const candidate = DATE_KEY_PATTERN.test(raw) ? raw : raw.slice(0, 10);
  return validatedParts(candidate) ? candidate : null;
}

/** Local-noon avoids midnight/DST edges while retaining the calendar day. */
export function localCalendarDate(value: unknown): Date | null {
  const key = dateOnlyKey(value);
  if (!key) return null;
  const parts = validatedParts(key)!;
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
}

export function dateOnlyKeyForInstantInTimeZone(
  instant: Date,
  timeZone: string,
): string | null {
  if (!Number.isFinite(instant.getTime()) || !String(timeZone || "").trim()) {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const key = `${byType.get("year") || ""}-${byType.get("month") || ""}-${byType.get("day") || ""}`;
    return dateOnlyKey(key);
  } catch {
    return null;
  }
}

export function todayDateOnlyKey(
  now = new Date(),
  timeZone?: string | null,
): string {
  const zoned = timeZone
    ? dateOnlyKeyForInstantInTimeZone(now, timeZone)
    : null;
  if (zoned) return zoned;
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDateOnlyBeforeToday(
  value: unknown,
  options: { now?: Date; timeZone?: string | null } = {},
): boolean {
  return (
    compareDateOnly(
      value,
      todayDateOnlyKey(options.now ?? new Date(), options.timeZone),
    ) < 0
  );
}

export function compareDateOnly(left: unknown, right: unknown): number {
  const leftKey = dateOnlyKey(left);
  const rightKey = dateOnlyKey(right);
  if (leftKey === rightKey) return 0;
  if (!leftKey) return -1;
  if (!rightKey) return 1;
  return leftKey < rightKey ? -1 : 1;
}

export function addDaysToDateOnlyKey(
  value: unknown,
  days: number,
): string | null {
  const key = dateOnlyKey(value);
  if (!key || !Number.isInteger(days)) return null;
  const parts = validatedParts(key)!;
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdayForDateOnlyKey(value: unknown): number | null {
  const key = dateOnlyKey(value);
  if (!key) return null;
  const parts = validatedParts(key)!;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
}

export function formatDateOnly(
  value: unknown,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  },
  locale?: string | string[],
) {
  const date = localCalendarDate(value);
  return date ? new Intl.DateTimeFormat(locale, options).format(date) : "";
}

export function localDateTimeFromDateKey(
  dateValue: unknown,
  timeValue: unknown,
): Date | null {
  const key = dateOnlyKey(dateValue);
  const match = String(timeValue || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!key || !match) return null;
  const parts = validatedParts(key)!;
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    Number(match[1]),
    Number(match[2]),
    Number(match[3] || 0),
    0,
  );
}
