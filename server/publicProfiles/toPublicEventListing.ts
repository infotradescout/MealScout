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

function toPublicEventTrucks(trucks: any): Record<string, unknown>[] {
  if (!Array.isArray(trucks)) return [];
  const projected: Record<string, unknown>[] = [];
  for (const truck of trucks) {
    const id = String(truck?.id || truck?.truckId || "").trim();
    if (!id) continue;
    projected.push({
      id,
      name: String(truck?.name || "Food truck"),
      cuisineType: truck?.cuisineType || null,
      city: truck?.city || null,
      state: truck?.state || null,
      logoUrl: truck?.logoUrl || null,
      coverImageUrl: truck?.coverImageUrl || null,
    });
  }
  return projected;
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
    trucks,
  } = event;
  const publicTrucks = toPublicEventTrucks(trucks);

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
    bookedRestaurantId: publicTrucks[0]?.id || null,
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
    trucks: publicTrucks,
  };
}

export function toPublicEventListingArray(
  events: any[] | null | undefined,
): Record<string, unknown>[] {
  return Array.isArray(events) ? events.map(toPublicEventListing) : [];
}
