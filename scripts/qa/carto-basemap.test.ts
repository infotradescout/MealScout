import assert from "node:assert/strict";
import { test } from "node:test";
import type { StyleSpecification } from "maplibre-gl";
import { withCartoBasemapKey } from "../../client/src/lib/carto-basemap";
const tile = "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png";
const style: StyleSpecification = { version: 8, sources: { carto: { type: "raster", tiles: [tile], tileSize: 256, attribution: "CARTO / OpenStreetMap" } }, layers: [{ id: "carto", type: "raster", source: "carto" }] };
for (const key of [undefined, null, "", "   ", "key\nvalue", {}, "x".repeat(513)]) {
  test(`missing or malformed project key does not produce a requestable style: ${typeof key}`, () => {
    assert.equal(withCartoBasemapKey(style, key), null);
  });
}
test("configured key is encoded while tile placeholders, attribution and source identity stay intact", () => {
  const before = JSON.stringify(style);
  const result = withCartoBasemapKey(style, "qa+key/value");
  assert.ok(result);
  assert.deepEqual(result.sources.carto, { ...style.sources.carto, tiles: [tile + "?key=qa%2Bkey%2Fvalue"] });
  assert.deepEqual(result.layers, style.layers);
  assert.equal(JSON.stringify(style), before, "Never mutate shared style or its source");
});
for (const url of ["http://a.basemaps.cartocdn.com/x", "https://evil.invalid/x", "https://a.basemaps.cartocdn.com.evil.invalid/x", "https://u:p@basemaps.cartocdn.com/x", tile + "?key=old", "invalid"]) {
  test(`configuration does not send a project key to an unapproved URL: ${url}`, () => {
    assert.equal(withCartoBasemapKey({ ...style, sources: { carto: { type: "raster", tiles: [url] } } }, "qa-key"), null);
  });
}
