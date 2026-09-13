const clean = (value: unknown) => String(value ?? "").trim();

export function normalizePersistedIanaTimeZone(
  value: unknown,
): string | null {
  const timeZone = clean(value);
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}

/**
 * Series time is an explicit part of the event contract. A series event may
 * never fall back to host geography; a non-series event may use only a
 * persisted, validated venue timezone (currently the cities table).
 */
export function resolvePersistedEventServiceTimeZone(input: {
  seriesId?: unknown;
  seriesTimeZone?: unknown;
  venueTimeZone?: unknown;
}): string | null {
  if (clean(input.seriesId)) {
    return normalizePersistedIanaTimeZone(input.seriesTimeZone);
  }
  return normalizePersistedIanaTimeZone(input.venueTimeZone);
}
