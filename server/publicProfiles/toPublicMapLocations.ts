type PublicMapPayload = {
  hostLocations: Record<string, unknown>[];
  eventLocations: Record<string, unknown>[];
  supplierLocations: Record<string, unknown>[];
};

export function toPublicMapHostLocation(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const {
    id,
    type,
    hostId,
    name,
    address,
    city,
    state,
    spotImageUrl,
    locationType,
    status,
    latitude,
    longitude,
    description,
    googlePlaceId,
    googlePriceLevel,
    googleBusinessStatus,
    googlePhotos,
    googleCategories,
    businessHours,
    businessWebsite,
    showFuelPrices,
    fuelPrices,
  } = row;

  return {
    id,
    type,
    hostId,
    name,
    address,
    city,
    state,
    spotImageUrl,
    locationType,
    status,
    latitude,
    longitude,
    description,
    googlePlaceId,
    googlePriceLevel,
    googleBusinessStatus,
    googlePhotos,
    googleCategories,
    businessHours,
    businessWebsite,
    showFuelPrices: Boolean(showFuelPrices),
    fuelPrices: showFuelPrices ? fuelPrices ?? null : null,
  };
}

export function toPublicMapEventLocation(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const {
    id,
    type,
    name,
    description,
    date,
    startTime,
    endTime,
    maxTrucks,
    status,
    hostId,
    hostName,
    hostAddress,
    hostCity,
    hostState,
    hostLatitude,
    hostLongitude,
    hardCapEnabled,
    seriesId,
    bookedRestaurantId,
    truckId,
    truckName,
    manualScheduleId,
    lastConfirmedAt,
  } = row;

  return {
    id,
    type,
    name,
    description,
    date,
    startTime,
    endTime,
    maxTrucks,
    status,
    hostId,
    hostName,
    hostAddress,
    hostCity,
    hostState,
    hostLatitude,
    hostLongitude,
    hardCapEnabled,
    seriesId,
    bookedRestaurantId,
    truckId,
    truckName,
    manualScheduleId,
    lastConfirmedAt,
  };
}

export function toPublicMapSupplierLocation(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const {
    id,
    type,
    supplierId,
    name,
    address,
    city,
    state,
    latitude,
    longitude,
    offersDelivery,
    deliveryRadiusMiles,
    productHighlights,
    profileUrl,
    category,
    categoryLabel,
  } = row;

  return {
    id,
    type,
    supplierId,
    name,
    address,
    city,
    state,
    latitude,
    longitude,
    offersDelivery,
    deliveryRadiusMiles,
    productHighlights,
    profileUrl,
    category,
    categoryLabel,
  };
}

export function toPublicMapLocationsPayload(payload: any): PublicMapPayload {
  return {
    hostLocations: Array.isArray(payload?.hostLocations)
      ? payload.hostLocations.map(toPublicMapHostLocation)
      : [],
    eventLocations: Array.isArray(payload?.eventLocations)
      ? payload.eventLocations.map(toPublicMapEventLocation)
      : [],
    supplierLocations: Array.isArray(payload?.supplierLocations)
      ? payload.supplierLocations.map(toPublicMapSupplierLocation)
      : [],
  };
}
