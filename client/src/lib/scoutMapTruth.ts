export type RestaurantOpenState = "open" | "closed" | "unknown";

export function shouldShowRestaurantMarker({
  openState,
  hasDeal,
  showOpenNow,
  showDeals,
  showAllRestaurants = false,
}: {
  openState: RestaurantOpenState;
  hasDeal: boolean;
  showOpenNow: boolean;
  showDeals: boolean;
  showAllRestaurants?: boolean;
}): boolean {
  return (
    showAllRestaurants ||
    (openState === "open" && showOpenNow) ||
    (hasDeal && showDeals)
  );
}

export function getScoutRecenterDecision({
  source,
  lastCenteredSource,
  userPushedMap,
}: {
  source: string | null;
  lastCenteredSource: string | null;
  userPushedMap: boolean;
}) {
  const freshDeviceLocation =
    source === "device" && lastCenteredSource !== "device";
  return {
    freshDeviceLocation,
    shouldRecenter: !userPushedMap || freshDeviceLocation,
  };
}

const RESTAURANT_OPEN_FIELDS = [
  "isOpen",
  "openNow",
  "currentlyOpen",
  "isCurrentlyOpen",
] as const;

const RESTAURANT_STATUS_FIELDS = [
  "openStatus",
  "status",
  "hoursStatus",
  "businessStatus",
] as const;

export function getRestaurantOpenState(
  source: unknown,
): RestaurantOpenState {
  if (!source || typeof source !== "object") return "unknown";
  const restaurant = source as Record<string, unknown>;

  for (const field of RESTAURANT_OPEN_FIELDS) {
    if (restaurant[field] === true) return "open";
    if (restaurant[field] === false) return "closed";
    if (typeof restaurant[field] === "string") {
      const value = restaurant[field].trim().toLowerCase();
      if (["true", "open", "serving", "available", "yes"].includes(value)) {
        return "open";
      }
      if (
        ["false", "closed", "not_open", "unavailable", "no"].includes(value)
      ) {
        return "closed";
      }
    }
  }

  for (const field of RESTAURANT_STATUS_FIELDS) {
    if (typeof restaurant[field] !== "string") continue;
    const status = restaurant[field]
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!status) continue;
    if (/\bnot (?:currently )?open\b/.test(status) || /\bclosed\b/.test(status)) {
      return "closed";
    }
    if (/\bopen\b/.test(status)) return "open";
  }

  return "unknown";
}

export function getEventCalendarDay(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const event = source as Record<string, unknown>;
  const calendarDate =
    typeof event.date === "string" ? event.date.trim() : "";
  if (calendarDate) {
    return (
      calendarDate.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || calendarDate
    );
  }
  return typeof event.startsAt === "string" && event.startsAt.trim()
    ? event.startsAt.trim()
    : null;
}
