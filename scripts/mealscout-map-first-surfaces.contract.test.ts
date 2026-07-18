import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const parkingPass = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const activeScenePanel = readFileSync(
  "client/src/components/scout/ActiveScenePanel.tsx",
  "utf8",
);
const mapPicker = readFileSync(
  "client/src/components/maps/GoogleMapPicker.tsx",
  "utf8",
);
const googleSurface = readFileSync(
  "client/src/components/maps/google-map-surface.tsx",
  "utf8",
);

assert.match(
  scout,
  /const primaryScoutMapHeight = isThinScoutViewport[\s\S]*"clamp\(300px, 39dvh, 430px\)"[\s\S]*"clamp\(340px, 46dvh, 520px\)"/,
  "Scout must keep a prominent map without pushing the first decision below the fold.",
);
assert.match(scout, /data-scout-primary-map="true"/);
assert.doesNotMatch(scout, /ThemedScoutMap|themed-scout-map/);
assert.doesNotMatch(
  scout,
  /isNightTheme=\{true\}/,
  "Scout must not force the entire discovery route into the retired night treatment.",
);
assert.match(activeScenePanel, /data-scout-results-surface="integrated"/);

assert.match(
  parkingPass,
  /useState<"map" \| "list">\("map"\)/,
  "Parking Pass must open on the map at every viewport size.",
);
assert.doesNotMatch(
  parkingPass,
  /matchMedia\("\(max-width: 639px\)"\).*"list"/s,
);
assert.match(parkingPass, /data-parking-pass-map-controls=/);
assert.match(parkingPass, /data-parking-pass-map-workspace=/);
assert.match(parkingPass, /data-parking-pass-map-canvas="integrated"/);
assert.match(parkingPass, /data-parking-pass-selection-panel=/);
assert.match(parkingPass, /h-\[min\(68dvh,760px\)\] min-h-\[540px\]/);
assert.ok(
  parkingPass.match(/surfaceMode="parking"/g)?.length === 2,
  "Both active-listing and host-fallback browse maps must use the canonical Google surface.",
);
for (const snippet of [
  "fitPins={true}",
  "showMapTypeControl={true}",
  "showRoadTrafficLayer={showRoadTrafficLayer}",
  "markerPriceLabel",
  "markerStatus: hasAvailability",
]) {
  assert.ok(
    parkingPass.includes(snippet),
    `Parking Pass map-first contract missing: ${snippet}`,
  );
}

assert.doesNotMatch(mapPicker, /react-leaflet|LeafletRenderer|OpenStreetMap/);

for (const snippet of [
  'data-parking-pass-google-map="true"',
  "<GoogleMapSurface",
  "useNativeMapStyle={true}",
  "fitMarkers={fitPins}",
  "showMapTypeControl={showMapTypeControl}",
]) {
  assert.ok(
    mapPicker.includes(snippet),
    `Parking Pass canonical Google adapter missing: ${snippet}`,
  );
}

for (const snippet of [
  "fitMarkers?: boolean",
  "showMapTypeControl?: boolean",
  "ControlPosition.LEFT_BOTTOM",
  "map.fitBounds(bounds, fitMarkerPadding)",
  'marker.kind === "parking" && marker.label',
  "marker.selected ? 1000 : undefined",
  "isUsableMapCenter(nextCenter)",
]) {
  assert.ok(
    googleSurface.includes(snippet),
    `Google map decision-layer behavior missing: ${snippet}`,
  );
}

console.log("MealScout map-first surfaces contract OK");
