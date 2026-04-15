// Shared utilities for host routes modules
// These functions are extracted from hostRoutes.ts and shared across host subroutes

export const normalizeLocationValue = (value?: string | null): string =>
  (value ?? "").trim().toLowerCase();

export const buildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
): string =>
  [
    normalizeLocationValue(address),
    normalizeLocationValue(city),
    normalizeLocationValue(state),
  ].join("|");

export const buildGeocodeAddress = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
): string => [address, city, state, "USA"].filter(Boolean).join(", ");
