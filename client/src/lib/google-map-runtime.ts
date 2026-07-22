type GoogleMapConstructor<TMap> = new (
  container: unknown,
  options: Record<string, unknown>,
) => TMap;

export function createGoogleMapWithRasterFallback<TMap>(input: {
  MapConstructor: GoogleMapConstructor<TMap>;
  container: unknown;
  options: Record<string, unknown>;
  mapId?: string;
}): { map: TMap; mapIdApplied: boolean } {
  const { MapConstructor, container, options, mapId } = input;
  if (!mapId) {
    return {
      map: new MapConstructor(container, options),
      mapIdApplied: false,
    };
  }

  try {
    return {
      map: new MapConstructor(container, { ...options, mapId }),
      mapIdApplied: true,
    };
  } catch {
    // A configured map ID selects Google's vector renderer. Browsers without
    // usable WebGL still need the ordinary raster map instead of losing the
    // entire Parking Pass map surface.
    return {
      map: new MapConstructor(container, options),
      mapIdApplied: false,
    };
  }
}
