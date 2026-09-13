import { dateOnlyKey, formatDateOnly } from "./date-only";

export type PublicEventServicePhase =
  | "future_date"
  | "before_start"
  | "in_service"
  | "ended"
  | "invalid";

export type PublicEventServiceTruth = {
  date?: unknown;
  serviceDateKey?: unknown;
  serviceTimezone?: unknown;
  servicePhase?: unknown;
  serviceStartsAtUtc?: unknown;
  serviceEndsAtUtc?: unknown;
};

export const eventServiceDateKey = (input: PublicEventServiceTruth) =>
  dateOnlyKey(input.serviceDateKey) || dateOnlyKey(input.date);

export const isEventOnAuthoritativeVenueDay = (
  input: PublicEventServiceTruth,
) =>
  input.servicePhase === "before_start" ||
  input.servicePhase === "in_service";

export const isEventAuthoritativelyOpenNow = (
  input: PublicEventServiceTruth,
) => input.servicePhase === "in_service";

export const eventServicePhaseLabel = (input: PublicEventServiceTruth) => {
  if (input.servicePhase === "in_service") return "Happening now";
  if (input.servicePhase === "before_start") return "Happening today";
  return "";
};

export const eventLongDateLabel = (value: unknown) =>
  formatDateOnly(
    value,
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
    "en-US",
  );

export const eventShortDateLabel = (value: unknown) =>
  formatDateOnly(
    value,
    { weekday: "short", month: "short", day: "numeric" },
    "en-US",
  );

export const eventNumericDateLabel = (value: unknown) =>
  formatDateOnly(
    value,
    { year: "numeric", month: "numeric", day: "numeric" },
    "en-US",
  );

export const eventClockLabel = (value: unknown) => {
  const match = String(value || "")
    .trim()
    .match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
};

export const eventCardWhenLabel = (input: {
  date?: unknown;
  serviceDateKey?: unknown;
  startTime?: unknown;
}) =>
  [
    eventShortDateLabel(input.serviceDateKey || input.date),
    eventClockLabel(input.startTime),
  ]
    .filter(Boolean)
    .join(" • ");

export const eventSeriesRangeLabel = (start: unknown, end: unknown) => {
  const startLabel = formatDateOnly(
    start,
    { month: "short", day: "numeric" },
    "en-US",
  );
  const endLabel = formatDateOnly(
    end,
    { month: "short", day: "numeric", year: "numeric" },
    "en-US",
  );
  return startLabel && endLabel ? `${startLabel} – ${endLabel}` : "";
};

export const eventNotificationWhenLabel = (input: {
  date: unknown;
  startTime: string;
  endTime: string;
}) =>
  `${eventNumericDateLabel(input.date)} • ${input.startTime} - ${input.endTime}`;
