/**
 * ThemedScoutMap
 * --------------
 * Compact Scout mini-map for /scout.
 *
 * This is the collapsed map element that lives on the Scout page: a bright,
 * food-forward street map with animated pins. Pulling down expands into the
 * full Google map for real pan/zoom/tap exploration.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type Map as MaplibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { MapAdapterMarker } from "./map-adapter.types";

interface ThemedScoutMapProps {
  userLocation: { lat: number; lng: number };
  markers: MapAdapterMarker[];
  onMarkerTap?: (marker: MapAdapterMarker) => void;
  zoom?: number;
  interactive?: boolean;
}

const MINI_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "carto-light": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        'Map tiles © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>, data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#fff7df",
      },
    },
    {
      id: "carto-light-tiles",
      type: "raster",
      source: "carto-light",
      paint: {
        "raster-opacity": 1,
        "raster-brightness-min": 0.08,
        "raster-brightness-max": 1,
        "raster-saturation": 0.14,
        "raster-contrast": 0.08,
      },
    },
  ],
};

// MapLibre GL requires WebGL and has no fallback rendering path - if the
// browser has WebGL disabled or blocked (privacy hardening, some webviews,
// GPU/driver issues), it can silently fail to paint anything at all,
// including its own background color. Detect that case up front instead of
// leaving the canvas blank with no explanation.
function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export function ThemedScoutMap({
  userLocation,
  markers,
  onMarkerTap,
  zoom = 13,
  interactive = false,
}: ThemedScoutMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const driftRafRef = useRef<number | null>(null);
  const driftStartRef = useRef<number | null>(null);
  // Tracks either "no WebGL" (checked up front) or "tiles never loaded"
  // (network/ad-blocker interference with the CDN) so we can show a plain
  // warm placeholder instead of a mysteriously blank card.
  const [tilesUnavailable, setTilesUnavailable] = useState(
    () => !isWebglAvailable(),
  );

  const centerMapOnUser = (duration = 0) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [userLocation.lng, userLocation.lat],
      zoom,
      pitch: 34,
      bearing: 9,
      duration,
    });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current || tilesUnavailable) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MINI_MAP_STYLE,
      center: [userLocation.lng, userLocation.lat],
      zoom,
      pitch: 34,
      bearing: 9,
      interactive,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      keyboard: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      scrollZoom: interactive,
      dragPan: interactive,
      touchZoomRotate: interactive,
      fadeDuration: 240,
    });

    mapRef.current = map;

    const resizeMap = () => {
      const current = mapRef.current;
      if (!current) return;
      current.resize();
      centerMapOnUser(0);
    };
    const initialResizeFrame = requestAnimationFrame(resizeMap);
    const initialResizeTimeout = window.setTimeout(resizeMap, 250);

    map.on("load", () => {
      centerMapOnUser(0);

      const userEl = document.createElement("div");
      userEl.className = "msm-user-pin";
      userEl.setAttribute("aria-label", "Your location");
      userEl.innerHTML = `
        <span class="msm-user-pin__pulse"></span>
        <span class="msm-user-pin__pulse msm-user-pin__pulse--delay"></span>
        <span class="msm-user-pin__core"></span>
      `;
      userMarkerRef.current = new maplibregl.Marker({
        element: userEl,
        anchor: "center",
      })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);

      if (!interactive) {
        driftStartRef.current = performance.now();
        const tick = () => {
          const current = mapRef.current;
          if (!current) return;
          if (driftStartRef.current == null) {
            driftStartRef.current = performance.now();
          }
          const t = (performance.now() - driftStartRef.current) / 1000;
          current.setBearing(9 + Math.sin((t / 78) * Math.PI * 2) * 1.6);
          current.setPitch(34 + Math.sin((t / 98) * Math.PI * 2) * 1.2);
          driftRafRef.current = requestAnimationFrame(tick);
        };
        driftRafRef.current = requestAnimationFrame(tick);
      }
    });

    const ro = new ResizeObserver(() => {
      const current = mapRef.current;
      if (!current) return;
      current.resize();
      if (!interactive) {
        centerMapOnUser(160);
      }
    });
    ro.observe(containerRef.current);

    // Tiles can fail to load even with WebGL working fine (ad-blockers and
    // some privacy tools block third-party CDN image hosts like CARTO's).
    // If nothing has loaded after a grace period, fall back to the plain
    // placeholder rather than leaving a blank map on screen.
    let sawTileLoad = false;
    const handleSourceData = (e: any) => {
      if (e?.sourceId === "carto-light" && e.isSourceLoaded) {
        sawTileLoad = true;
      }
    };
    map.on("sourcedata", handleSourceData);
    const tileWatchdog = window.setTimeout(() => {
      if (!sawTileLoad) setTilesUnavailable(true);
    }, 6000);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(initialResizeFrame);
      window.clearTimeout(initialResizeTimeout);
      window.clearTimeout(tileWatchdog);
      map.off("sourcedata", handleSourceData);
      if (driftRafRef.current != null) {
        cancelAnimationFrame(driftRafRef.current);
        driftRafRef.current = null;
      }
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, tilesUnavailable]);

  const markerKey = useMemo(
    () =>
      markers
        .map((marker) => `${marker.id}:${marker.lat.toFixed(5)},${marker.lng.toFixed(5)}`)
        .join("|"),
    [markers],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!interactive) {
      centerMapOnUser(500);
    }
    userMarkerRef.current?.setLngLat([userLocation.lng, userLocation.lat]);
  }, [interactive, userLocation.lat, userLocation.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    const KIND_ICONS: Record<string, string> = {
      truck: "T", restaurant: "R",
      event: "E", deal: "$", geo_ad: "◆", supplier: "S",
    };

    markers.forEach((marker) => {
      if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) return;

      const el = document.createElement("button");
      el.type = "button";
      el.className = `msm-map-pin msm-map-pin--${marker.kind || "truck"}`;
      el.setAttribute(
        "aria-label",
        marker.title ? `${marker.title} pin` : "MealScout map pin",
      );
      const icon = KIND_ICONS[marker.kind || "truck"] ?? "·";
      el.innerHTML = `
        <span class="msm-map-pin__drop" aria-hidden="true">
          <span class="msm-map-pin__icon">${icon}</span>
          <span class="msm-map-pin__glow"></span>
        </span>
      `;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerTap?.(marker);
      });

      markerRefs.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([marker.lng, marker.lat])
          .addTo(map),
      );
    });
  }, [markerKey, markers, onMarkerTap]);

  return (
    <div
      className={`absolute inset-0 h-full w-full min-h-full ${interactive ? "msm-mode-interactive" : "msm-mode-preview"}`}
    >
      <div className="absolute inset-0">
        {tilesUnavailable ? (
          // No WebGL, or tiles never loaded (ad-blocker/CDN interference) -
          // show the same warm background the map style would have used
          // instead of leaving a blank/void-looking canvas.
          <div
            className="absolute inset-0 h-full w-full min-h-full"
            style={{ backgroundColor: "#fff7df" }}
          />
        ) : (
          <div
            ref={containerRef}
            className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
            style={{ height: "100%", width: "100%", minHeight: "100%" }}
          />
        )}
      </div>
      <svg
        className="msm-map-illustration absolute inset-0 h-full w-full pointer-events-none"
        viewBox="0 0 800 520"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="msm-soft-shadow" x="-20%" y="-40%" width="140%" height="180%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#9a4812" floodOpacity="0.16" />
          </filter>
        </defs>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#msm-soft-shadow)">
          <path className="msm-road msm-road--major" d="M-40 365 C120 312 196 244 322 250 C456 256 548 338 840 278" />
          <path className="msm-road msm-road--major msm-road--alt" d="M96 -28 C120 90 182 170 280 214 C410 274 458 344 506 548" />
          <path className="msm-road" d="M-10 174 C126 186 210 164 306 112 C392 66 510 76 812 128" />
          <path className="msm-road" d="M56 512 C100 440 182 386 294 354 C436 314 570 326 828 390" />
          <path className="msm-road msm-road--thin" d="M164 18 C198 112 242 168 300 210 C370 260 424 276 560 286" />
          <path className="msm-road msm-road--thin" d="M14 268 C114 242 224 244 346 284 C430 312 508 374 620 514" />
          <path className="msm-road msm-road--thin" d="M594 -20 C562 92 560 176 596 244 C636 322 650 410 628 548" />
        </g>
        <g className="msm-food-dots">
          <circle cx="166" cy="168" r="8" />
          <circle cx="300" cy="250" r="7" />
          <circle cx="512" cy="286" r="8" />
          <circle cx="620" cy="390" r="7" />
        </g>
      </svg>
      {/* ── Warm daylight grade ── */}
      <div aria-hidden="true" className="msm-map-grade absolute inset-0" />

      {!interactive && (
        <>
          <div aria-hidden="true" className="msm-food-glow absolute inset-0 pointer-events-none">
            <span className="msm-food-glow__spot msm-food-glow__spot--1" />
            <span className="msm-food-glow__spot msm-food-glow__spot--2" />
            <span className="msm-food-glow__spot msm-food-glow__spot--3" />
          </div>
        </>
      )}

      {/* ── LIVE badge ── */}
      <div aria-label="Live map" className="msm-live-badge">
        <span aria-hidden="true" className="msm-live-badge__dot" />
        Open
      </div>

      <style>{`
        .msm-map-canvas .maplibregl-canvas {
          filter: saturate(1.12) contrast(1.03) brightness(1.04) sepia(0.06);
        }
        .msm-mode-interactive .msm-map-canvas .maplibregl-canvas {
          filter: saturate(1.08) contrast(1.02) brightness(1.03) sepia(0.04);
        }

        .msm-map-illustration {
          z-index: 1;
          opacity: 0.92;
          mix-blend-mode: multiply;
        }
        .msm-road {
          stroke: rgba(255, 178, 80, 0.78);
          stroke-width: 18;
        }
        .msm-road--major {
          stroke: rgba(249, 115, 22, 0.68);
          stroke-width: 28;
        }
        .msm-road--alt {
          stroke: rgba(34, 197, 94, 0.34);
        }
        .msm-road--thin {
          stroke: rgba(255, 214, 128, 0.72);
          stroke-width: 10;
        }
        .msm-food-dots circle {
          fill: #fff7ed;
          stroke: #f97316;
          stroke-width: 4;
          filter: drop-shadow(0 5px 10px rgba(154,72,18,0.18));
        }

        .msm-map-grade {
          pointer-events: none;
          z-index: 2;
          background:
            radial-gradient(ellipse at 22% 18%, rgba(255, 188, 68, 0.28), transparent 34%),
            radial-gradient(ellipse at 78% 26%, rgba(255, 111, 72, 0.18), transparent 32%),
            linear-gradient(180deg, rgba(255, 253, 244, 0.40) 0%, transparent 44%, rgba(255, 206, 117, 0.18) 100%);
          mix-blend-mode: soft-light;
          opacity: 0.72;
        }
        .msm-mode-interactive .msm-map-grade {
          opacity: 0.45;
          mix-blend-mode: soft-light;
        }
        .msm-map-grade::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at center, transparent 38%, rgba(255, 236, 184, 0.34) 100%),
            linear-gradient(180deg, rgba(255,255,255,0.20), transparent 30%, rgba(150,77,25,0.08) 100%);
          pointer-events: none;
          mix-blend-mode: multiply;
        }
        .msm-mode-interactive .msm-map-grade::after {
          background: radial-gradient(ellipse at center, transparent 42%, rgba(255, 236, 184, 0.22) 100%);
        }

        .msm-food-glow { z-index: 3; overflow: hidden; }
        .msm-food-glow__spot {
          position: absolute;
          display: block;
          border-radius: 999px;
          filter: blur(2px);
          opacity: 0.58;
          animation: msm-food-float 8s ease-in-out infinite;
        }
        .msm-food-glow__spot--1 {
          width: 132px;
          height: 132px;
          left: 8%;
          top: 14%;
          background: radial-gradient(circle, rgba(255, 188, 68, 0.32), transparent 64%);
        }
        .msm-food-glow__spot--2 {
          width: 116px;
          height: 116px;
          right: 12%;
          top: 30%;
          background: radial-gradient(circle, rgba(255, 111, 72, 0.24), transparent 66%);
          animation-delay: 1.4s;
        }
        .msm-food-glow__spot--3 {
          width: 150px;
          height: 150px;
          left: 36%;
          bottom: 3%;
          background: radial-gradient(circle, rgba(52, 211, 153, 0.16), transparent 64%);
          animation-delay: 2.2s;
        }
        @keyframes msm-food-float {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -8px, 0) scale(1.05); }
        }

        /* ── LIVE badge ── */
        .msm-live-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px 5px 9px;
          border-radius: 999px;
          background: rgba(255, 253, 244, 0.88);
          border: 1px solid rgba(255, 142, 70, 0.38);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #8a2d0d;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
          pointer-events: none;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 10px 28px rgba(154, 72, 18, 0.18);
        }
        .msm-mode-interactive .msm-live-badge {
          background: rgba(255, 253, 244, 0.78);
          border-color: rgba(255, 142, 70, 0.30);
        }
        .msm-live-badge__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          background: #22c55e;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.75);
          animation: msm-live-blink 1.6s ease-in-out infinite;
        }
        @keyframes msm-live-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.18; }
        }

        /* ── User location pin ── */
        .msm-user-pin {
          position: relative;
          width: 28px;
          height: 28px;
          pointer-events: none;
        }
        .msm-user-pin__core {
          position: absolute;
          inset: 8px;
          border-radius: 9999px;
          background: #fff7ed;
          border: 2px solid rgba(249, 115, 22, 0.92);
          box-shadow:
            0 0 0 4px rgba(255, 237, 213, 0.80),
            0 8px 22px rgba(194, 65, 12, 0.28);
        }
        .msm-user-pin__pulse {
          position: absolute;
          inset: 1px;
          border-radius: 9999px;
          background: rgba(249, 115, 22, 0.22);
          animation: msm-user-pulse 2.4s ease-out infinite;
        }
        .msm-user-pin__pulse--delay { animation-delay: 1.2s; }
        @keyframes msm-user-pulse {
          0%   { transform: scale(0.7); opacity: 0.9; }
          80%  { transform: scale(2.7); opacity: 0; }
          100% { transform: scale(2.7); opacity: 0; }
        }

        /* ── Teardrop pins ── */
        .msm-map-pin {
          position: relative;
          width: 26px;
          height: 32px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          pointer-events: auto;
          display: flex;
          align-items: flex-start;
          justify-content: center;
        }
        .msm-map-pin__drop {
          position: relative;
          width: 20px;
          height: 20px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: #ff6f3c;
          overflow: hidden;
          box-shadow:
            0 2px 0 rgba(255, 255, 255, 0.58) inset,
            0 8px 18px rgba(194, 65, 12, 0.25),
            0 0 0 3px rgba(255, 237, 213, 0.72);
        }
        .msm-map-pin__icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          font-size: 7px;
          font-weight: 900;
          line-height: 1;
          color: rgba(68, 22, 7, 0.86);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
          user-select: none;
        }
        .msm-map-pin__glow {
          position: absolute;
          inset: -6px;
          border-radius: 50% 50% 50% 0;
          background: rgba(255, 111, 60, 0.24);
          filter: blur(8px);
          animation: msm-pin-glow 2.8s ease-in-out infinite;
          pointer-events: none;
        }
        /* Restaurant / deal */
        .msm-map-pin--restaurant .msm-map-pin__drop,
        .msm-map-pin--deal .msm-map-pin__drop {
          background: #fbbf24;
          box-shadow: 0 2px 0 rgba(255,255,255,0.62) inset, 0 8px 18px rgba(180,83,9,0.24), 0 0 0 3px rgba(254,243,199,0.86);
        }
        .msm-map-pin--restaurant .msm-map-pin__glow,
        .msm-map-pin--deal .msm-map-pin__glow { background: rgba(251,191,36,0.24); }
        /* Event — fuchsia */
        .msm-map-pin--event .msm-map-pin__drop {
          background: #e879f9;
          box-shadow: 0 2px 0 rgba(255,255,255,0.60) inset, 0 8px 18px rgba(192,38,211,0.24), 0 0 0 3px rgba(250,232,255,0.86);
        }
        .msm-map-pin--event .msm-map-pin__glow { background: rgba(232,121,249,0.24); }
        /* Geo ad — teal */
        .msm-map-pin--geo_ad .msm-map-pin__drop {
          background: #34d399;
          box-shadow: 0 2px 0 rgba(255,255,255,0.58) inset, 0 8px 18px rgba(5,150,105,0.24), 0 0 0 3px rgba(209,250,229,0.82);
        }
        .msm-map-pin--geo_ad .msm-map-pin__glow { background: rgba(52,211,153,0.24); }
        @keyframes msm-pin-glow {
          0%, 100% { opacity: 0.36; transform: scale(1); }
          50%       { opacity: 0.92; transform: scale(1.36); }
        }

        .maplibregl-ctrl-attrib,
        .maplibregl-ctrl-bottom-right,
        .maplibregl-ctrl-bottom-left {
          display: none !important;
        }
        .maplibregl-map,
        .maplibregl-canvas-container,
        .maplibregl-canvas {
          min-height: 100% !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
      <span className="sr-only" aria-label="Map data attribution">
        Map tiles © CARTO. Data © OpenStreetMap contributors.
      </span>
    </div>
  );
}

export default ThemedScoutMap;
