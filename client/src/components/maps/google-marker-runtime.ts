export type GoogleMarkerRenderer = "advanced" | "unavailable";

export function resolveGoogleMarkerRenderer(input: {
  mapId?: string | null;
  AdvancedMarkerElement?: unknown;
  LegacyMarker?: unknown;
}): GoogleMarkerRenderer {
  if (
    String(input.mapId || "").trim().length > 0 &&
    typeof input.AdvancedMarkerElement === "function"
  ) {
    return "advanced";
  }
  // A callable legacy Marker constructor does not guarantee that pins render.
  // Scout only trusts AdvancedMarker with a real production Map ID; otherwise
  // its populated map must fail over to the local MapLibre surface.
  return "unavailable";
}

export function createGoogleMarkerInstance(input: {
  renderer: GoogleMarkerRenderer;
  AdvancedMarkerElement?: any;
  advancedOptions: Record<string, unknown>;
}): any | null {
  if (input.renderer === "advanced") {
    return new input.AdvancedMarkerElement(input.advancedOptions);
  }
  return null;
}
