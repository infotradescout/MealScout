import { DateTime } from "luxon";
import { hasValidMerchantDeliveryConfiguration } from "./merchantDeliverySafety";

const DELIVERY_DAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

const DELIVERY_DAY_ALIASES = new Map(
  DELIVERY_DAY_KEYS.flatMap((key) => {
    const longName = {
      sun: "sunday",
      mon: "monday",
      tue: "tuesday",
      wed: "wednesday",
      thu: "thursday",
      fri: "friday",
      sat: "saturday",
    }[key];
    return [
      [key, key],
      [longName, key],
    ] as Array<[string, (typeof DELIVERY_DAY_KEYS)[number]]>;
  }),
);

function parseDeliveryTime(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 24) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

export function normalizeDeliverySchedule(
  value: unknown,
): Record<string, Array<{ start: string; end: string }>> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Delivery hours must be organized by day");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length === 0) return {};

  const normalized: Record<string, Array<{ start: string; end: string }>> = {};
  for (const [rawDay, rawValue] of Object.entries(input)) {
    const dayKey = DELIVERY_DAY_ALIASES.get(rawDay.trim().toLowerCase());
    if (!dayKey || normalized[dayKey]) {
      throw new Error(`Invalid or duplicate delivery day: ${rawDay}`);
    }
    const candidates = Array.isArray(rawValue)
      ? rawValue
      : rawValue &&
          typeof rawValue === "object" &&
          Array.isArray((rawValue as { slots?: unknown }).slots)
        ? (rawValue as { slots: unknown[] }).slots
        : [rawValue];
    normalized[dayKey] = candidates.map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        throw new Error(
          `Delivery hours for ${rawDay} must contain time windows`,
        );
      }
      const window = candidate as Record<string, unknown>;
      const rawStart = window.start ?? window.open;
      const rawEnd = window.end ?? window.close;
      const start = parseDeliveryTime(rawStart);
      const end = parseDeliveryTime(rawEnd);
      if (start === null || end === null || start === end) {
        throw new Error(
          `Delivery hours for ${rawDay} require distinct HH:MM start and end times`,
        );
      }
      return {
        start: String(rawStart).trim().padStart(5, "0"),
        end: String(rawEnd).trim().padStart(5, "0"),
      };
    });
  }
  return normalized;
}

function deliveryWindowsForDay(
  deliveryHours: Record<string, unknown>,
  dayKey: (typeof DELIVERY_DAY_KEYS)[number],
) {
  const matchingEntry = Object.entries(deliveryHours).find(
    ([key]) => DELIVERY_DAY_ALIASES.get(key.trim().toLowerCase()) === dayKey,
  );
  if (!matchingEntry) return [];
  const rawValue = matchingEntry[1];
  const candidates = Array.isArray(rawValue)
    ? rawValue
    : rawValue &&
        typeof rawValue === "object" &&
        Array.isArray((rawValue as { slots?: unknown }).slots)
      ? (rawValue as { slots: unknown[] }).slots
      : [rawValue];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const window = candidate as Record<string, unknown>;
    const start = parseDeliveryTime(window.start ?? window.open);
    const end = parseDeliveryTime(window.end ?? window.close);
    return start === null || end === null || start === end
      ? []
      : [{ start, end }];
  });
}

export function isDeliveryScheduleAvailable(input: {
  deliveryHours?: unknown;
  now?: Date;
  timeZone?: string;
}) {
  if (
    !input.deliveryHours ||
    typeof input.deliveryHours !== "object" ||
    Array.isArray(input.deliveryHours)
  ) {
    return input.deliveryHours == null;
  }
  const deliveryHours = input.deliveryHours as Record<string, unknown>;
  if (Object.keys(deliveryHours).length === 0) return true;
  if (!input.timeZone) return false;
  let normalizedDeliveryHours: Record<
    string,
    Array<{ start: string; end: string }>
  >;
  try {
    normalizedDeliveryHours = normalizeDeliverySchedule(deliveryHours);
  } catch {
    return false;
  }

  const localNow = DateTime.fromJSDate(input.now ?? new Date(), {
    zone: "utc",
  }).setZone(input.timeZone);
  if (!localNow.isValid) return false;
  const todayIndex = localNow.weekday % 7;
  const previousDayIndex = (todayIndex + 6) % 7;
  const minuteOfDay = localNow.hour * 60 + localNow.minute;

  const todayWindows = deliveryWindowsForDay(
    normalizedDeliveryHours,
    DELIVERY_DAY_KEYS[todayIndex],
  );
  if (
    todayWindows.some(({ start, end }) =>
      end > start
        ? minuteOfDay >= start && minuteOfDay < end
        : minuteOfDay >= start,
    )
  ) {
    return true;
  }

  return deliveryWindowsForDay(
    normalizedDeliveryHours,
    DELIVERY_DAY_KEYS[previousDayIndex],
  ).some(({ start, end }) => end < start && minuteOfDay < end);
}

export function evaluateDeliveryEligibility(input: {
  enabled: boolean;
  subtotalCents: number;
  minimumOrderCents: number;
  postalCode: string;
  postalCodes: unknown;
  activeOrders: number;
  maxConcurrentOrders: number;
  deliveryHours?: unknown;
  now?: Date;
  timeZone?: string;
}) {
  if (
    !hasValidMerchantDeliveryConfiguration({
      enabled: input.enabled,
      feeCents: 0,
      minimumOrderCents: input.minimumOrderCents,
      estimatedMinutes: 45,
      maxConcurrentOrders: input.maxConcurrentOrders,
      postalCodes: input.postalCodes,
    })
  )
    return { ok: false, statusCode: 400, message: "Delivery is not available" };
  if (
    !isDeliveryScheduleAvailable({
      deliveryHours: input.deliveryHours,
      now: input.now,
      timeZone: input.timeZone,
    })
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: "Merchant delivery is unavailable at this time",
    };
  }
  if (input.subtotalCents < input.minimumOrderCents) {
    return {
      ok: false,
      statusCode: 400,
      message: `Delivery requires a minimum order of $${(input.minimumOrderCents / 100).toFixed(2)}`,
    };
  }
  const allowedPostalCodes = Array.isArray(input.postalCodes)
    ? input.postalCodes.map((value) => String(value).trim().toUpperCase())
    : [];
  if (
    allowedPostalCodes.length &&
    !allowedPostalCodes.includes(input.postalCode.trim().toUpperCase())
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: "This address is outside the merchant's delivery area",
    };
  }
  if (input.activeOrders >= input.maxConcurrentOrders) {
    return {
      ok: false,
      statusCode: 409,
      message: "The merchant is at delivery capacity right now",
    };
  }
  return { ok: true as const };
}
