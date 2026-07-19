export type GoogleMarkerRenderer =
  | "advanced"
  | "legacy"
  | "unavailable";

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
  if (typeof input.LegacyMarker === "function") return "legacy";
  return "unavailable";
}

export function createGoogleMarkerInstance(input: {
  renderer: GoogleMarkerRenderer;
  AdvancedMarkerElement?: any;
  LegacyMarker?: any;
  advancedOptions: Record<string, unknown>;
  legacyOptions: Record<string, unknown>;
}): any | null {
  if (input.renderer === "advanced") {
    return new input.AdvancedMarkerElement(input.advancedOptions);
  }
  if (input.renderer === "legacy") {
    return new input.LegacyMarker(input.legacyOptions);
  }
  return null;
}
