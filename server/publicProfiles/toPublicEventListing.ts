// Allowlisted projection for unauthenticated event-feed responses
// (/api/events/public, /api/events/upcoming). Each event already carries a
// full `host` record merged in by storage.getAllUpcomingEvents(); this strips
// that down to what a consumer needs to find/attend the event, dropping the
// host's contact phone, internal notes, Stripe Connect state, payout
// settings, and private Parking Pass controls. Event-level booking prices stay
// in the response because public callers use them to evaluate an event.
function toPublicEventHost(host: any): Record<string, unknown> {
  if (!host || typeof host !== "object") return host;

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

export function toPublicEventListing(event: any): Record<string, unknown> {
  if (!event || typeof event !== "object") return event;

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
    series: series ?? null,
  };
}

export function toPublicEventListingArray(
  events: any[] | null | undefined,
): Record<string, unknown>[] {
  return Array.isArray(events) ? events.map(toPublicEventListing) : [];
}
