import type { StyleSpecification } from "maplibre-gl";

/** CARTO requires a project key even when a raster tile returns HTTP 200.
 * A configured key is not proof that the provider accepted a request.
 * Missing configuration must never fetch the watermarked anonymous tiles.
 */
export function withCartoBasemapKey(style: StyleSpecification, key: unknown): StyleSpecification | null {
  if (typeof key !== "string") return null;
  const token = key.trim();
  if (!token || token.length > 512 || /[\s\x00-\x1f\x7f]/.test(token)) return null;
  const sources: StyleSpecification["sources"] = {};
  for (const [name, source] of Object.entries(style.sources)) {
    if (source.type !== "raster" || !source.tiles?.length) return null;
    const tiles: string[] = [];
    for (const tile of source.tiles) {
      let url: URL;
      try { url = new URL(tile); } catch { return null; }
      if (url.protocol !== "https:" || !/^(?:[a-d]\.)?basemaps\.cartocdn\.com$/.test(url.hostname) || url.username || url.password || url.search || url.hash) return null;
      tiles.push(`${tile}?key=${encodeURIComponent(token)}`);
    }
    sources[name] = { ...source, tiles };
  }
  return { ...style, sources };
}
