/**
 * SVGStreetMap — renders real OSM road geometry as a neon-amber SVG.
 *
 * Fetches road ways from the Overpass API for a ~1.5km bounding box around
 * the user's location, projects lat/lng to SVG coordinates, then draws:
 *   1. A blurred amber copy  → the glow halo
 *   2. A sharp amber copy    → the crisp road line on top
 *
 * The result is a true neon street glow where the light sits exactly on
 * the actual road geometry — not a CSS filter approximation.
 */

import { useEffect, useMemo, useRef, useState } from "react";

/* ── Road classification → stroke weight ─────────────────────── */
const ROAD_WEIGHTS: Record<string, number> = {
  motorway: 5,
  trunk: 4.5,
  primary: 3.5,
  secondary: 2.5,
  tertiary: 1.8,
  residential: 1.2,
  service: 0.8,
  unclassified: 1,
  living_street: 0.8,
  pedestrian: 0.6,
  footway: 0.4,
  cycleway: 0.4,
  path: 0.3,
};

/* ── Road classification → amber opacity ─────────────────────── */
const ROAD_OPACITY: Record<string, number> = {
  motorway: 1,
  trunk: 0.95,
  primary: 0.9,
  secondary: 0.8,
  tertiary: 0.7,
  residential: 0.55,
  service: 0.35,
  unclassified: 0.45,
  living_street: 0.35,
  pedestrian: 0.3,
  footway: 0.2,
  cycleway: 0.2,
  path: 0.15,
};

interface OsmNode {
  id: number;
  lat: number;
  lon: number;
}

interface OsmWay {
  id: number;
  tags: Record<string, string>;
  nodes: number[];
}

interface OsmResponse {
  elements: Array<{ type: "node" | "way"; id: number; lat?: number; lon?: number; tags?: Record<string, string>; nodes?: number[] }>;
}

interface RoadPath {
  d: string;
  highway: string;
  weight: number;
  opacity: number;
}

const SVG_W = 800;
const SVG_H = 800;
// Bounding box half-size in degrees (~1.2km at mid-latitudes)
const BOX_DEG = 0.011;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const STREET_CACHE_TTL_MS = 10 * 60 * 1000;
const streetPathCache = new Map<string, { expiresAt: number; paths: RoadPath[] }>();

function lngToX(lng: number, minLng: number, maxLng: number): number {
  return ((lng - minLng) / (maxLng - minLng)) * SVG_W;
}

function latToY(lat: number, minLat: number, maxLat: number): number {
  // Invert Y: higher lat = lower Y value
  return ((maxLat - lat) / (maxLat - minLat)) * SVG_H;
}

function buildOverpassQuery(lat: number, lng: number): string {
  const s = lat - BOX_DEG;
  const n = lat + BOX_DEG;
  const w = lng - BOX_DEG * 1.4; // slightly wider for landscape
  const e = lng + BOX_DEG * 1.4;
  return `
    [out:json][timeout:10];
    (
      way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service|unclassified|living_street|pedestrian"](${s},${w},${n},${e});
    );
    out body;
    >;
    out skel qt;
  `.trim();
}

function buildCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

async function parseOverpassJsonResponse(response: Response): Promise<OsmResponse> {
  const raw = await response.text();
  const text = raw.trim();
  if (!text) {
    throw new Error("Overpass returned an empty response");
  }

  try {
    return JSON.parse(text) as OsmResponse;
  } catch {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`Overpass returned non-JSON payload: ${snippet}`);
  }
}

async function fetchOverpassData(
  query: string,
  signal: AbortSignal,
): Promise<OsmResponse> {
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        signal,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Content-Type": "text/plain;charset=UTF-8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await parseOverpassJsonResponse(response);
    } catch (error: any) {
      if (error?.name === "AbortError") throw error;
      lastError =
        error instanceof Error ? error : new Error(String(error || "Unknown error"));
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed");
}

function parseOsmResponse(data: OsmResponse, lat: number, lng: number): RoadPath[] {
  const minLat = lat - BOX_DEG;
  const maxLat = lat + BOX_DEG;
  const minLng = lng - BOX_DEG * 1.4;
  const maxLng = lng + BOX_DEG * 1.4;

  const nodeMap = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];

  for (const el of data.elements) {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      nodeMap.set(el.id, { id: el.id, lat: el.lat, lon: el.lon });
    } else if (el.type === "way" && el.nodes && el.tags) {
      ways.push({ id: el.id, tags: el.tags, nodes: el.nodes });
    }
  }

  const paths: RoadPath[] = [];

  for (const way of ways) {
    const highway = way.tags.highway ?? "unclassified";
    const weight = ROAD_WEIGHTS[highway] ?? 0.8;
    const opacity = ROAD_OPACITY[highway] ?? 0.3;

    const coords = way.nodes
      .map((nid) => nodeMap.get(nid))
      .filter((n): n is OsmNode => n != null);

    if (coords.length < 2) continue;

    const parts = coords.map((n, i) => {
      const x = lngToX(n.lon, minLng, maxLng);
      const y = latToY(n.lat, minLat, maxLat);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    paths.push({ d: parts.join(" "), highway, weight, opacity });
  }

  return paths;
}

interface Props {
  lat: number;
  lng: number;
  /** Animated tilt transform applied to the outer wrapper */
  style?: React.CSSProperties;
  className?: string;
}

export function SVGStreetMap({ lat, lng, style, className }: Props) {
  const [paths, setPaths] = useState<RoadPath[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // User pin position in SVG coords
  const userPin = useMemo(() => ({
    x: lngToX(lng, lng - BOX_DEG * 1.4, lng + BOX_DEG * 1.4),
    y: latToY(lat, lat - BOX_DEG, lat + BOX_DEG),
  }), [lat, lng]);

  useEffect(() => {
    if (!lat || !lng) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const cacheKey = buildCacheKey(lat, lng);
    const cached = streetPathCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setPaths(cached.paths);
      setLoading(false);
      return () => ctrl.abort();
    }

    setLoading(true);

    const query = buildOverpassQuery(lat, lng);
    fetchOverpassData(query, ctrl.signal)
      .then((data: OsmResponse) => {
        if (ctrl.signal.aborted) return;
        const parsed = parseOsmResponse(data, lat, lng);
        streetPathCache.set(cacheKey, {
          paths: parsed,
          expiresAt: Date.now() + STREET_CACHE_TTL_MS,
        });
        setPaths(parsed);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.warn("[SVGStreetMap] Overpass fetch failed:", err);
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [lat, lng]);

  // Amber colour palette
  const AMBER = "#f97316"; // orange-500 — warmer than pure amber
  const AMBER_GLOW = "#fb923c"; // orange-400

  return (
    <div className={className} style={{ position: "absolute", inset: 0, ...style }}>
      {/* Dark base */}
      <div style={{ position: "absolute", inset: 0, background: "#05070d" }} />

      {/* SVG street geometry */}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
        aria-hidden="true"
      >
        <defs>
          {/* Glow filter — spreads light outward from road pixels */}
          <filter id="street-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Stronger glow for major roads */}
          <filter id="street-glow-major" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* User pin pulse */}
          <filter id="street-glow-halo" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="20" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="pin-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── GLOW PASS (blurred, behind) ─────────────────────── */}
        {/* Ultra-wide halo pass for deep bloom */}
        <g opacity="0.45">
          {paths.map((p, i) => {
            const isMajor = ["motorway", "trunk", "primary", "secondary"].includes(p.highway);
            if (!isMajor) return null;
            return (
              <path
                key={`halo-${i}`}
                d={p.d}
                fill="none"
                stroke={AMBER_GLOW}
                strokeWidth={p.weight * 12}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={p.opacity * 0.4}
                filter="url(#street-glow-halo)"
              />
            );
          })}
        </g>
        <g opacity="0.9">
          {paths.map((p, i) => {
            const isMajor = ["motorway", "trunk", "primary", "secondary"].includes(p.highway);
            return (
              <path
                key={`glow-${i}`}
                d={p.d}
                fill="none"
                stroke={AMBER_GLOW}
                strokeWidth={p.weight * (isMajor ? 8 : 5)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={p.opacity * 0.85}
                filter={isMajor ? "url(#street-glow-major)" : "url(#street-glow)"}
              />
            );
          })}
        </g>

        {/* ── CRISP PASS (sharp, on top) ──────────────────────── */}
        <g>
          {paths.map((p, i) => (
            <path
              key={`crisp-${i}`}
              d={p.d}
              fill="none"
              stroke={AMBER}
              strokeWidth={p.weight * 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={p.opacity}
            />
          ))}
        </g>

        {/* ── USER LOCATION PIN ───────────────────────────────── */}
        <g filter="url(#pin-glow)">
          <circle
            cx={userPin.x}
            cy={userPin.y}
            r={14}
            fill={AMBER}
            opacity={0.25}
          />
        </g>
        <circle
          cx={userPin.x}
          cy={userPin.y}
          r={7}
          fill={AMBER}
          stroke="#fff"
          strokeWidth={1.5}
          opacity={0.95}
        />
        {/* Arrow inside pin */}
        <polygon
          points={`${userPin.x},${userPin.y - 4} ${userPin.x - 3},${userPin.y + 3} ${userPin.x + 3},${userPin.y + 3}`}
          fill="#000"
          opacity={0.8}
        />

        {/* Loading shimmer overlay */}
        {loading && (
          <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#05070d" opacity="0.6" />
        )}
      </svg>
    </div>
  );
}
