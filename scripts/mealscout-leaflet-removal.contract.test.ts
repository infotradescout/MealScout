import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");
const app = read("client/src/App.tsx");
const main = read("client/src/main.tsx");
const styles = read("client/src/index.css");
const picker = read("client/src/components/maps/GoogleMapPicker.tsx");
const parkingPass = read("client/src/pages/parking-pass.tsx");
const packageJson = read("package.json");
const packageLock = read("package-lock.json");
const preLaunchGate = read("scripts/preLaunchGate.mjs");

for (const retiredPath of [
  "client/src/pages/map.tsx",
  "client/src/pages/scout-prototype.tsx",
]) {
  assert.equal(existsSync(retiredPath), false, `obsolete map surface returned: ${retiredPath}`);
}

assert.match(app, /<Route path="\/map" component=\{RedirectToScout\} \/>/);
assert.equal(
  (app.match(/<Route path="\/scout-prototype" component=\{RedirectToScout\} \/>/g) || [])
    .length,
  2,
  "guest and authenticated prototype routes must both redirect to Scout",
);
assert.doesNotMatch(app, /ScoutPrototype|@\/pages\/map/);

for (const source of [main, styles, picker, packageJson, packageLock]) {
  assert.doesNotMatch(source, /react-leaflet|(?:^|["'\/])leaflet(?:["'\/.-]|$)/im);
}
assert.doesNotMatch(picker, /Leaflet|OpenStreetMap/);
assert.match(picker, /Google Maps is temporarily unavailable/);
assert.match(picker, /new g\.maps\.Polyline/);
assert.match(picker, /map\.fitBounds\(bounds, 72\)/);
assert.equal((parkingPass.match(/\bfitPins\b/g) || []).length, 3);
assert.match(parkingPass, /routePath=\{journeyResult\.route\.path\}/);
assert.match(picker, /new g\.maps\.InfoWindow/);
assert.match(picker, /createPortal\(infoPortalContent/);
assert.doesNotMatch(preLaunchGate, /Leaflet|OpenStreetMap/);

console.log("mealscout-leaflet-removal.contract: PASS");
