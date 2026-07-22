import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGoogleMarkerInstance,
  resolveGoogleMarkerRenderer,
} from "../client/src/components/maps/google-marker-runtime";

let advancedCount = 0;
class AdvancedMarkerMock {
  constructor(public options: Record<string, unknown>) {
    advancedCount += 1;
  }
}
class LegacyMarkerMock {
  constructor(public options: Record<string, unknown>) {}
}

const modernRuntime = resolveGoogleMarkerRenderer({
  mapId: "production-map-id",
  AdvancedMarkerElement: AdvancedMarkerMock,
  LegacyMarker: undefined,
});
assert.equal(
  modernRuntime,
  "advanced",
  "A configured Map ID must use AdvancedMarkerElement when weekly Google Maps no longer exposes Marker.",
);

const surfaceSource = readFileSync(
  "client/src/components/maps/google-map-surface.tsx",
  "utf8",
);
assert.ok(
  surfaceSource.includes('markerRenderer === "unavailable"') &&
    surfaceSource.includes("onFatalErrorRef.current?.(msg)"),
  "An unavailable production marker renderer must immediately invoke the parent fallback.",
);
assert.ok(
  surfaceSource.includes("mapOptions.mapId = configuredMapId") &&
    !surfaceSource.includes('const useAdvanced = false'),
  "A real configured Map ID must activate AdvancedMarker instead of the removed forced-legacy path.",
);
assert.ok(
  !surfaceSource.includes("DEMO_MAP_ID"),
  "Production must never substitute Google's demo Map ID.",
);

const expectedMarkers = 4;
const instances = Array.from({ length: expectedMarkers }, (_, index) =>
  createGoogleMarkerInstance({
    renderer: modernRuntime,
    AdvancedMarkerElement: AdvancedMarkerMock,
    advancedOptions: { position: { lat: 30 + index, lng: -87 } },
  }),
);
assert.equal(instances.filter(Boolean).length, expectedMarkers);
assert.equal(
  advancedCount,
  expectedMarkers,
  "A populated marker set must create one visible AdvancedMarker instance per marker.",
);

const legacyRuntime = resolveGoogleMarkerRenderer({
  mapId: null,
  AdvancedMarkerElement: AdvancedMarkerMock,
  LegacyMarker: LegacyMarkerMock,
});
assert.equal(
  legacyRuntime,
  "unavailable",
  "A missing Map ID must trigger MapLibre fallback even when legacy Marker is callable, because that runtime can silently render zero pins.",
);
assert.equal(
  createGoogleMarkerInstance({
    renderer: legacyRuntime,
    advancedOptions: {},
  }),
  null,
);

assert.equal(
  resolveGoogleMarkerRenderer({
    mapId: null,
    AdvancedMarkerElement: AdvancedMarkerMock,
    LegacyMarker: undefined,
  }),
  "unavailable",
  "Production without a real Map ID or legacy Marker must trigger the local map fallback instead of silently showing zero pins.",
);

console.log("scout-google-marker-runtime.contract: PASS");
