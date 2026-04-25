export type DeviceLocation = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  name?: string | null;
  timestamp: number;
};

export const DEVICE_LOCATION_STORAGE_KEY = "mealscout_last_location:device";
const LEGACY_LOCATION_STORAGE_KEY = "mealscout_last_location";

const isFiniteCoordinate = (lat: unknown, lng: unknown) => {
  const nextLat = Number(lat);
  const nextLng = Number(lng);
  return (
    Number.isFinite(nextLat) &&
    Number.isFinite(nextLng) &&
    Math.abs(nextLat) <= 90 &&
    Math.abs(nextLng) <= 180
  );
};

export function readDeviceLocation(): DeviceLocation | null {
  if (typeof window === "undefined") return null;

  try {
    const stored =
      window.localStorage.getItem(DEVICE_LOCATION_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_LOCATION_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<DeviceLocation> | null;
    if (!parsed || !isFiniteCoordinate(parsed.lat, parsed.lng)) return null;

    const location: DeviceLocation = {
      lat: Number(parsed.lat),
      lng: Number(parsed.lng),
      accuracy:
        parsed.accuracy == null || !Number.isFinite(Number(parsed.accuracy))
          ? null
          : Number(parsed.accuracy),
      name: parsed.name ? String(parsed.name) : null,
      timestamp: Number(parsed.timestamp || Date.now()),
    };

    if (!window.localStorage.getItem(DEVICE_LOCATION_STORAGE_KEY)) {
      window.localStorage.setItem(
        DEVICE_LOCATION_STORAGE_KEY,
        JSON.stringify(location),
      );
    }

    return location;
  } catch {
    return null;
  }
}

export function writeDeviceLocation(
  location: Pick<DeviceLocation, "lat" | "lng"> &
    Partial<Omit<DeviceLocation, "lat" | "lng">>,
) {
  if (typeof window === "undefined") return;
  if (!isFiniteCoordinate(location.lat, location.lng)) return;

  try {
    window.localStorage.setItem(
      DEVICE_LOCATION_STORAGE_KEY,
      JSON.stringify({
        lat: Number(location.lat),
        lng: Number(location.lng),
        accuracy:
          location.accuracy == null ||
          !Number.isFinite(Number(location.accuracy))
            ? null
            : Number(location.accuracy),
        name: location.name ? String(location.name) : null,
        timestamp: Number(location.timestamp || Date.now()),
      }),
    );
  } catch {
    // ignore localStorage issues
  }
}
