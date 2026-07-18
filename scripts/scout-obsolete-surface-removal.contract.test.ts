import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const app = readFileSync("client/src/App.tsx", "utf8");
const scout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const mapPicker = readFileSync(
  "client/src/components/maps/GoogleMapPicker.tsx",
  "utf8",
);
const packageJson = readFileSync("package.json", "utf8");

for (const retiredPath of [
  "client/src/pages/explore-preview.tsx",
  "client/src/pages/scout-prototype.tsx",
  "client/src/pages/map.tsx",
  "client/src/pages/trending.tsx",
  "client/src/components/maps/themed-scout-map.tsx",
  "client/src/components/maps/themed-scout-map-v2.tsx",
  "client/src/components/maps/svg-street-map.tsx",
  "client/src/components/maps/usePinZoomCardMode.ts",
]) {
  assert.equal(
    existsSync(retiredPath),
    false,
    `Retired surface must not return: ${retiredPath}`,
  );
}

assert.ok(
  app.includes('<Route path="/scout-prototype" component={RedirectToScout} />'),
  "External prototype links must resolve to canonical Scout.",
);
assert.doesNotMatch(app, /ScoutPrototype|@\/pages\/explore-preview"/);
assert.doesNotMatch(scout, /ThemedScoutMap|themed-scout-map|react-leaflet/);
assert.doesNotMatch(mapPicker, /Leaflet|OpenStreetMap|react-leaflet/);
assert.doesNotMatch(
  readFileSync("client/src/features/scout/scoutDiscoveryModel.ts", "utf8"),
  /host_locations|Host Locations/,
  "Parking-only hosts must not return to consumer Scout discovery.",
);
assert.doesNotMatch(
  packageJson,
  /"(?:leaflet|react-leaflet|@types\/leaflet|maplibre-gl)"/,
);

console.log("scout-obsolete-surface-removal.contract: PASS");
