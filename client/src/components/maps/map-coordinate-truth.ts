export type MapGeoPoint = { lat: number; lng: number };

/**
 * Google can briefly report Null Island while a newly mounted map is being
 * resized. MealScout never uses that sentinel as a real market center.
 */
export function isUsableMapCenter(
  point: MapGeoPoint | null | undefined,
): point is MapGeoPoint {
  if (!point) return false;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  if (point.lat < -90 || point.lat > 90) return false;
  if (point.lng < -180 || point.lng > 180) return false;
  return !(Math.abs(point.lat) < 0.0001 && Math.abs(point.lng) < 0.0001);
}
