import { dateKeyFromUnknown } from "./dateKeys";

/** Preserve event_series date-only boundaries as calendar keys. */
export function parkingPassSeriesBoundaryDateKey(
  value: unknown,
): string | null {
  return dateKeyFromUnknown(value, "UTC");
}
