/**
 * ThemedScoutMap
 * --------------
 * Compact Scout mini-map for /scout.
 *
 * This is the collapsed map element that lives on the Scout page: a real
 * street map, branded with MealScout contrast and animated pins. Pulling down
 * expands into the full Google map for real pan/zoom/tap exploration.
 */

import { useEffect, useMemo, useRef } from "react";
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
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
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
        "background-color": "#010101",
      },
    },
    {
      id: "carto-dark-tiles",
      type: "raster",
      source: "carto-dark",
      paint: {
        "raster-opacity": 1,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.72,
        "raster-saturation": -0.52,
        "raster-contrast": 0.62,
      },
    },
  ],
};

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
    if (!containerRef.current || mapRef.current) return;

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

    return () => {
      ro.disconnect();
      cancelAnimationFrame(initialResizeFrame);
      window.clearTimeout(initialResizeTimeout);
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
  }, [interactive]);

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
      truck: "T", restaurant: "R", parking: "P",
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
        <div
          ref={containerRef}
          className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
          style={{ height: "100%", width: "100%", minHeight: "100%" }}
        />
      </div>
      {/* ── Atmospheric grade ── */}
      <div aria-hidden="true" className="msm-map-grade absolute inset-0" />

      {!interactive && (
        <>
          {/* ── Radar rings + sweep ── */}
          <div aria-hidden="true" className="msm-radar absolute inset-0 pointer-events-none">
            <span className="msm-radar__ring msm-radar__ring--1" />
            <span className="msm-radar__ring msm-radar__ring--2" />
            <span className="msm-radar__ring msm-radar__ring--3" />
            <span className="msm-radar__sweep" />
          </div>

          {/* ── Scanlines ── */}
          <div aria-hidden="true" className="msm-scanlines absolute inset-0 pointer-events-none" />

          {/* ── HUD corner brackets ── */}
          <div aria-hidden="true" className="msm-hud absolute inset-0 pointer-events-none">
            <span className="msm-hud__corner msm-hud__corner--tl" />
            <span className="msm-hud__corner msm-hud__corner--tr" />
            <span className="msm-hud__corner msm-hud__corner--bl" />
            <span className="msm-hud__corner msm-hud__corner--br" />
          </div>
        </>
      )}

      {/* ── LIVE badge ── */}
      <div aria-label="Live map" className="msm-live-badge">
        <span aria-hidden="true" className="msm-live-badge__dot" />
        LIVE
      </div>

      {/* ── Tap-to-explore hint ── */}
      {!interactive && <div aria-hidden="true" className="msm-tap-hint">TAP TO EXPLORE</div>}

      <style>{`
        /* ── Holographic amber filter ── */
        .msm-map-canvas .maplibregl-canvas {
          filter: sepia(1) hue-rotate(-18deg) saturate(6.6) contrast(2.45) brightness(0.38);
        }
        .msm-mode-interactive .msm-map-canvas .maplibregl-canvas {
          filter: sepia(0.86) hue-rotate(-14deg) saturate(4.4) contrast(2.05) brightness(0.45);
        }

        /* ── Atmospheric grade ── */
        .msm-map-grade {
          pointer-events: none;
          z-index: 1;
          background:
            radial-gradient(ellipse at 50% 52%, rgba(255, 128, 24, 0.20), transparent 60%),
            radial-gradient(ellipse at 24% 68%, rgba(255, 103, 15, 0.12), transparent 40%),
            radial-gradient(ellipse at 78% 32%, rgba(255, 162, 48, 0.10), transparent 34%),
            linear-gradient(180deg, rgba(0,0,0,0.66) 0%, transparent 24%, transparent 70%, rgba(0,0,0,0.80) 100%);
          mix-blend-mode: screen;
          opacity: 0.58;
        }
        .msm-mode-interactive .msm-map-grade {
          opacity: 0.38;
          mix-blend-mode: soft-light;
        }
        .msm-map-grade::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center, transparent 34%, rgba(0, 0, 0, 0.72) 100%);
          pointer-events: none;
          mix-blend-mode: normal;
        }
        .msm-mode-interactive .msm-map-grade::after {
          background: radial-gradient(ellipse at center, transparent 38%, rgba(0, 0, 0, 0.56) 100%);
        }

        /* ── Scanlines ── */
        .msm-scanlines {
          z-index: 2;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(0, 0, 0, 0.04) 3px,
            rgba(0, 0, 0, 0.04) 4px
          );
        }

        /* ── Radar rings ── */
        .msm-radar { z-index: 3; overflow: hidden; }
        .msm-radar__ring--1,
        .msm-radar__ring--2,
        .msm-radar__ring--3 {
          display: block;
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(245, 158, 11, 0.12);
          top: 50%;
          left: 50%;
        }
        .msm-radar__ring--1 {
          width: 240px; height: 240px;
          margin-top: -120px; margin-left: -120px;
          animation: msm-ring-pulse 4.8s ease-in-out infinite;
        }
        .msm-radar__ring--2 {
          width: 152px; height: 152px;
          margin-top: -76px; margin-left: -76px;
          animation: msm-ring-pulse 4.8s ease-in-out infinite 0.65s;
        }
        .msm-radar__ring--3 {
          width: 78px; height: 78px;
          margin-top: -39px; margin-left: -39px;
          animation: msm-ring-pulse 4.8s ease-in-out infinite 1.25s;
        }
        @keyframes msm-ring-pulse {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 1; }
        }

        /* ── Radar sweep ── */
        .msm-radar__sweep {
          display: block;
          position: absolute;
          width: 240px; height: 240px;
          top: 50%; left: 50%;
          margin-top: -120px; margin-left: -120px;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            rgba(245, 158, 11, 0.36) 0deg,
            rgba(245, 158, 11, 0.16) 36deg,
            rgba(245, 158, 11, 0.03) 68deg,
            transparent 75deg
          );
          animation: msm-radar-spin 9s linear infinite;
        }
        @keyframes msm-radar-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        /* ── HUD corner brackets ── */
        .msm-hud { z-index: 5; }
        .msm-hud__corner {
          display: block;
          position: absolute;
          width: 16px;
          height: 16px;
          border-color: rgba(245, 158, 11, 0.58);
          border-style: solid;
          border-width: 0;
        }
        .msm-hud__corner--tl { top: 10px; left: 10px; border-top-width: 2px; border-left-width: 2px; }
        .msm-hud__corner--tr { top: 10px; right: 10px; border-top-width: 2px; border-right-width: 2px; }
        .msm-hud__corner--bl { bottom: 10px; left: 10px; border-bottom-width: 2px; border-left-width: 2px; }
        .msm-hud__corner--br { bottom: 10px; right: 10px; border-bottom-width: 2px; border-right-width: 2px; }

        /* ── LIVE badge ── */
        .msm-live-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px 4px 8px;
          border-radius: 999px;
          background: rgba(8, 8, 10, 0.70);
          border: 1px solid rgba(255, 170, 52, 0.55);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          color: #ffe3ac;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
          pointer-events: none;
          font-family: ui-monospace, 'Courier New', monospace;
          box-shadow: 0 0 14px rgba(255, 160, 35, 0.24);
        }
        .msm-mode-interactive .msm-live-badge {
          background: rgba(8, 8, 10, 0.54);
          border-color: rgba(255, 170, 52, 0.40);
        }
        .msm-live-badge__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          background: #f59e0b;
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.95);
          animation: msm-live-blink 1.6s ease-in-out infinite;
        }
        @keyframes msm-live-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.18; }
        }

        /* ── Tap hint ── */
        .msm-tap-hint {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.22em;
          color: rgba(255, 228, 170, 0.52);
          text-transform: uppercase;
          pointer-events: none;
          font-family: ui-monospace, 'Courier New', monospace;
          text-shadow: 0 0 14px rgba(245, 158, 11, 0.50);
          white-space: nowrap;
          animation: msm-tap-fade 3.2s ease-in-out infinite;
        }
        @keyframes msm-tap-fade {
          0%, 100% { opacity: 0.65; }
          50%       { opacity: 1; }
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
          background: #fff8e0;
          border: 2px solid rgba(255, 210, 80, 0.92);
          box-shadow:
            0 0 0 4px rgba(255, 175, 35, 0.38),
            0 0 24px rgba(255, 210, 60, 0.9);
        }
        .msm-user-pin__pulse {
          position: absolute;
          inset: 1px;
          border-radius: 9999px;
          background: rgba(255, 155, 25, 0.38);
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
          background: #f59e0b;
          overflow: hidden;
          box-shadow:
            0 0 6px rgba(245, 158, 11, 0.95),
            0 0 16px rgba(245, 158, 11, 0.48),
            0 0 34px rgba(245, 158, 11, 0.20);
        }
        .msm-map-pin__icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          font-size: 7px;
          font-weight: 900;
          line-height: 1;
          color: rgba(5, 2, 0, 0.72);
          font-family: ui-monospace, 'Courier New', monospace;
          letter-spacing: 0;
          user-select: none;
        }
        .msm-map-pin__glow {
          position: absolute;
          inset: -6px;
          border-radius: 50% 50% 50% 0;
          background: rgba(245, 158, 11, 0.34);
          filter: blur(7px);
          animation: msm-pin-glow 2.8s ease-in-out infinite;
          pointer-events: none;
        }
        /* Parking — cyan */
        .msm-map-pin--parking .msm-map-pin__drop {
          background: #06b6d4;
          box-shadow: 0 0 6px rgba(6,182,212,0.95), 0 0 20px rgba(6,182,212,0.55), 0 0 44px rgba(6,182,212,0.22);
        }
        .msm-map-pin--parking .msm-map-pin__glow { background: rgba(6,182,212,0.42); }
        /* Restaurant / deal */
        .msm-map-pin--restaurant .msm-map-pin__drop,
        .msm-map-pin--deal .msm-map-pin__drop {
          background: #fb923c;
          box-shadow: 0 0 6px rgba(251,146,60,0.95), 0 0 20px rgba(251,146,60,0.55), 0 0 44px rgba(251,146,60,0.22);
        }
        .msm-map-pin--restaurant .msm-map-pin__glow,
        .msm-map-pin--deal .msm-map-pin__glow { background: rgba(251,146,60,0.42); }
        /* Event — fuchsia */
        .msm-map-pin--event .msm-map-pin__drop {
          background: #e879f9;
          box-shadow: 0 0 6px rgba(232,121,249,0.95), 0 0 20px rgba(232,121,249,0.55), 0 0 44px rgba(232,121,249,0.22);
        }
        .msm-map-pin--event .msm-map-pin__glow { background: rgba(232,121,249,0.42); }
        /* Geo ad — teal */
        .msm-map-pin--geo_ad .msm-map-pin__drop {
          background: #34d399;
          box-shadow: 0 0 6px rgba(52,211,153,0.95), 0 0 20px rgba(52,211,153,0.55), 0 0 44px rgba(52,211,153,0.22);
        }
        .msm-map-pin--geo_ad .msm-map-pin__glow { background: rgba(52,211,153,0.42); }
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
