type DeviceLocation = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  updatedAt?: number;
};

const STORAGE_KEY = "mealscout:device-location:v1";

const isValidCoordinate = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function readDeviceLocation(): DeviceLocation | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<DeviceLocation>;
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    if (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lng, -180, 180)) {
      return null;
    }

    const accuracy =
      typeof parsed?.accuracy === "number" && Number.isFinite(parsed.accuracy)
        ? parsed.accuracy
        : null;
    const updatedAt =
      typeof parsed?.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : undefined;

    return { lat, lng, accuracy, updatedAt };
  } catch {
    return null;
  }
}

export function writeDeviceLocation(location: DeviceLocation): void {
  if (typeof window === "undefined") return;

  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lng, -180, 180)) return;

  const payload: DeviceLocation = {
    lat,
    lng,
    accuracy:
      typeof location?.accuracy === "number" && Number.isFinite(location.accuracy)
        ? location.accuracy
        : null,
    updatedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
}
