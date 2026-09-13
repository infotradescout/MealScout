import { buildSlotDateTimes } from "./timeIntent";
import { resolvePersistedEventServiceTimeZone } from "./persistedServiceTimeZoneRules";

export function isEventWithinPublicFeedWindow(
  event: any,
  now = new Date(),
  graceMs = 30 * 60 * 1000,
) {
  const timeZone = resolvePersistedEventServiceTimeZone({
    seriesId: event?.seriesId || event?.series?.id,
    seriesTimeZone: event?.series?.timezone || event?.seriesTimeZone,
    venueTimeZone: event?.venueTimeZone,
  });
  if (!timeZone) return false;
  const interval = buildSlotDateTimes({
    timeZone,
    date: event?.date,
    startTime: String(event?.startTime || ""),
    endTime: String(event?.endTime || ""),
  });
  return Boolean(
    interval && interval.endUtc.getTime() >= now.getTime() - graceMs,
  );
}
