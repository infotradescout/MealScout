// Allowlisted projection for unauthenticated event-feed responses
// (/api/events/public, /api/events/upcoming). Each event already carries a
// full `host` record merged in by storage.getAllUpcomingEvents(); this strips
// that down to what a consumer needs to find/attend the event, dropping the
// host's contact phone, internal notes, Stripe Connect state, payout
// settings, and Parking Pass pricing controls, none of which belong in a
// response any anonymous caller can fetch.
function toPublicEventHost(host: any): Record<string, unknown> | null {
  if (!host || typeof host !== "object" || Array.isArray(host)) return null;

  const {
    id,
    businessName,
    address,
    city,
    state,
    latitude,
    longitude,
    locationType,
    amenities,
    isVerified,
    spotImageUrl,
  } = host;

  return {
    id,
    businessName,
    address,
    city,
    state,
    latitude,
    longitude,
    locationType,
    amenities,
    isVerified,
    spotImageUrl,
  };
}

function toPublicEventSeries(
  series: any,
): Record<string, unknown> | null {
  if (!series || typeof series !== "object" || Array.isArray(series)) {
    return null;
  }

  const { id, name } = series;
  return { id, name };
}

export function toPublicEventListing(event: any): Record<string, unknown> {
  if (!event || typeof event !== "object" || Array.isArray(event)) return {};

  const {
    id,
    hostId,
    seriesId,
    name,
    description,
    eventType,
    date,
    startTime,
    endTime,
    maxTrucks,
    status,
    bookedRestaurantId,
    hardCapEnabled,
    hostPriceCents,
    breakfastPriceCents,
    lunchPriceCents,
    dinnerPriceCents,
    dailyPriceCents,
    weeklyPriceCents,
    monthlyPriceCents,
    requiresPayment,
    lastConfirmedAt,
    createdAt,
    updatedAt,
    host,
    series,
  } = event;

  return {
    id,
    hostId,
    seriesId,
    name,
    description,
    eventType,
    date,
    startTime,
    endTime,
    maxTrucks,
    status,
    bookedRestaurantId,
    hardCapEnabled,
    hostPriceCents,
    breakfastPriceCents,
    lunchPriceCents,
    dinnerPriceCents,
    dailyPriceCents,
    weeklyPriceCents,
    monthlyPriceCents,
    requiresPayment,
    lastConfirmedAt,
    createdAt,
    updatedAt,
    host: toPublicEventHost(host),
    series: toPublicEventSeries(series),
  };
}

export function toPublicEventListingArray(
  events: any[] | null | undefined,
): Record<string, unknown>[] {
  return Array.isArray(events) ? events.map(toPublicEventListing) : [];
}
