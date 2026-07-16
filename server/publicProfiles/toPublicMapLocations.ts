export type PublicMapPayload = {
  hostLocations: Record<string, unknown>[];
  eventLocations: Record<string, unknown>[];
  supplierLocations: Record<string, unknown>[];
};

export type PublicMapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

const toFiniteCoordinate = (value: unknown): number | null => {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

const normalizeLongitude = (value: number): number => {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
};

export function parsePublicMapBounds(
  raw: Record<string, unknown>,
): PublicMapBounds | null {
  const north = toFiniteCoordinate(raw.north);
  const south = toFiniteCoordinate(raw.south);
  const east = toFiniteCoordinate(raw.east);
  const west = toFiniteCoordinate(raw.west);
  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south ||
    north > 90 ||
    north < -90 ||
    south > 90 ||
    south < -90 ||
    east > 540 ||
    east < -540 ||
    west > 540 ||
    west < -540 ||
    Math.abs(east - west) > 360
  ) {
    return null;
  }

  if (Math.abs(east - west) === 360) {
    return { north, south, east: 180, west: -180 };
  }

  return {
    north,
    south,
    east: normalizeLongitude(east),
    west: normalizeLongitude(west),
  };
}

export function expandPublicMapBounds(
  bounds: PublicMapBounds,
  paddingDegrees: number,
): PublicMapBounds {
  const padding = Math.max(0, paddingDegrees);
  const longitudeSpan =
    bounds.west <= bounds.east
      ? bounds.east - bounds.west
      : 360 - (bounds.west - bounds.east);
  const latitudeBounds = {
    north: Math.min(90, bounds.north + padding),
    south: Math.max(-90, bounds.south - padding),
  };
  if (longitudeSpan + padding * 2 >= 360) {
    return { ...latitudeBounds, east: 180, west: -180 };
  }
  return {
    ...latitudeBounds,
    east: bounds.east + padding,
    west: bounds.west - padding,
  };
}

export const isPointInPublicMapBounds = (
  bounds: PublicMapBounds,
  latitude: unknown,
  longitude: unknown,
): boolean => {
  const lat = toFiniteCoordinate(latitude);
  const lng = toFiniteCoordinate(longitude);
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  const normalizedBounds = parsePublicMapBounds(
    bounds as unknown as Record<string, unknown>,
  );
  if (!normalizedBounds) return false;
  const normalizedLng = normalizeLongitude(lng);
  if (lat > normalizedBounds.north || lat < normalizedBounds.south) {
    return false;
  }
  if (normalizedBounds.west <= normalizedBounds.east) {
    return (
      normalizedLng >= normalizedBounds.west &&
      normalizedLng <= normalizedBounds.east
    );
  }
  return (
    normalizedLng >= normalizedBounds.west ||
    normalizedLng <= normalizedBounds.east
  );
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

export function toBoundedPublicMapLocationsPayload(
  payload: any,
  bounds: PublicMapBounds | null,
): PublicMapPayload {
  const publicPayload = toPublicMapLocationsPayload(payload);
  if (!bounds) return publicPayload;

  return {
    hostLocations: publicPayload.hostLocations.filter((host) =>
      isPointInPublicMapBounds(bounds, host.latitude, host.longitude),
    ),
    eventLocations: publicPayload.eventLocations.filter((event) =>
      isPointInPublicMapBounds(
        bounds,
        event.hostLatitude,
        event.hostLongitude,
      ),
    ),
    supplierLocations: publicPayload.supplierLocations.filter((supplier) =>
      isPointInPublicMapBounds(bounds, supplier.latitude, supplier.longitude),
    ),
  };
}
