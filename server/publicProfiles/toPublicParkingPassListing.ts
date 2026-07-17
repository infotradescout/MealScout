function toPublicParkingPassHost(host: any): Record<string, unknown> | null {
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
    spotImageUrl,
    showFuelPrices,
    fuelPrices,
    status,
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
    spotImageUrl,
    showFuelPrices: Boolean(showFuelPrices),
    fuelPrices: showFuelPrices ? fuelPrices ?? null : null,
    status,
  };
}

function toPublicParkingPassBooking(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const { truckId, truckName, slotType, spotNumber } = row || {};
  return {
    truckId,
    truckName,
    slotType,
    spotNumber,
  };
}

export function toPublicParkingPassListing(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
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
    paymentsEnabled,
    lastConfirmedAt,
    spotCount,
    bookedSpots,
    availableSpotNumbers,
    bookings,
    host,
  } = row;

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
    hardCapEnabled: Boolean(hardCapEnabled),
    hostPriceCents,
    breakfastPriceCents,
    lunchPriceCents,
    dinnerPriceCents,
    dailyPriceCents,
    weeklyPriceCents,
    monthlyPriceCents,
    requiresPayment: Boolean(requiresPayment),
    paymentsEnabled: Boolean(paymentsEnabled),
    lastConfirmedAt,
    spotCount,
    bookedSpots,
    availableSpotNumbers: Array.isArray(availableSpotNumbers)
      ? availableSpotNumbers
      : [],
    bookings: Array.isArray(bookings)
      ? bookings.map(toPublicParkingPassBooking)
      : [],
    host: toPublicParkingPassHost(host),
  };
}

export function toPublicParkingPassListingArray(
  rows: any[],
): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows.map(toPublicParkingPassListing) : [];
}
