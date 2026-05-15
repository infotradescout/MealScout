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
        "raster-brightness-max": 0.88,
        "raster-saturation": -0.4,
        "raster-contrast": 0.38,
      },
    },
  ],
};

export function ThemedScoutMap({
  userLocation,
  markers,
  onMarkerTap,
  zoom = 13,
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
      pitch: 48,
      bearing: 14,
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
      pitch: 48,
      bearing: 14,
      interactive: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      keyboard: false,
      doubleClickZoom: false,
      boxZoom: false,
      scrollZoom: false,
      dragPan: false,
      touchZoomRotate: false,
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

      driftStartRef.current = performance.now();
      const tick = () => {
        const current = mapRef.current;
        if (!current) return;
        if (driftStartRef.current == null) {
          driftStartRef.current = performance.now();
        }
        const t = (performance.now() - driftStartRef.current) / 1000;
        current.setBearing(14 + Math.sin((t / 70) * Math.PI * 2) * 3);
        current.setPitch(48 + Math.sin((t / 90) * Math.PI * 2) * 2.5);
        driftRafRef.current = requestAnimationFrame(tick);
      };
      driftRafRef.current = requestAnimationFrame(tick);
    });

    const ro = new ResizeObserver(() => {
      const current = mapRef.current;
      if (!current) return;
      current.resize();
      centerMapOnUser(160);
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
  }, []);

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
    centerMapOnUser(500);
    userMarkerRef.current?.setLngLat([userLocation.lng, userLocation.lat]);
  }, [userLocation.lat, userLocation.lng, markerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    markers.forEach((marker) => {
      if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) return;

      const el = document.createElement("button");
      el.type = "button";
      el.className = `msm-map-pin msm-map-pin--${marker.kind || "truck"}`;
      el.setAttribute(
        "aria-label",
        marker.title ? `${marker.title} pin` : "MealScout map pin",
      );
      el.innerHTML = `
        <span class="msm-map-pin__drop" aria-hidden="true">
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
    <div className="absolute inset-0 h-full w-full min-h-full">
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
          style={{ height: "100%", width: "100%", minHeight: "100%" }}
        />
      </div>
      <div aria-hidden="true" className="msm-map-grade absolute inset-0" />
      <style>{`
        /* ── Holographic amber filter ───────────────────────────────── */
        .msm-map-canvas .maplibregl-canvas {
          filter: sepia(1) hue-rotate(-18deg) saturate(5.5) contrast(2.1) brightness(0.46);
        }

        /* ── Atmospheric amber glow overlay ─────────────────────────── */
        .msm-map-grade {
          pointer-events: none;
          background:
            radial-gradient(ellipse at 50% 55%, rgba(255, 140, 30, 0.26), transparent 62%),
            radial-gradient(ellipse at 18% 72%, rgba(255, 110, 20, 0.16), transparent 44%),
            radial-gradient(ellipse at 82% 28%, rgba(230, 95, 10, 0.14), transparent 40%),
            radial-gradient(ellipse at 60% 20%, rgba(255, 180, 50, 0.10), transparent 35%),
            linear-gradient(180deg, rgba(0,0,0,0.60) 0%, transparent 22%, transparent 72%, rgba(0,0,0,0.72) 100%);
          mix-blend-mode: screen;
          opacity: 0.88;
        }
        .msm-map-grade::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center, transparent 38%, rgba(0, 0, 0, 0.62) 100%);
          pointer-events: none;
          mix-blend-mode: normal;
        }

        /* ── User location pin (amber pulse) ─────────────────────────── */
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
        .msm-user-pin__pulse--delay {
          animation-delay: 1.2s;
        }
        @keyframes msm-user-pulse {
          0%   { transform: scale(0.7); opacity: 0.9; }
          80%  { transform: scale(2.7); opacity: 0; }
          100% { transform: scale(2.7); opacity: 0; }
        }

        /* ── Teardrop map pins ───────────────────────────────────────── */
        .msm-map-pin {
          position: relative;
          width: 24px;
          height: 30px;
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
          width: 18px;
          height: 18px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: #f59e0b;
          box-shadow:
            0 0 6px rgba(245, 158, 11, 0.95),
            0 0 18px rgba(245, 158, 11, 0.55),
            0 0 40px rgba(245, 158, 11, 0.22);
        }
        .msm-map-pin__drop::after {
          content: '';
          position: absolute;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(8, 3, 0, 0.55);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        .msm-map-pin__glow {
          position: absolute;
          inset: -5px;
          border-radius: 50% 50% 50% 0;
          background: rgba(245, 158, 11, 0.44);
          filter: blur(6px);
          animation: msm-pin-glow 2.8s ease-in-out infinite;
        }
        /* Parking — cyan */
        .msm-map-pin--parking .msm-map-pin__drop {
          background: #06b6d4;
          box-shadow: 0 0 6px rgba(6,182,212,0.95), 0 0 18px rgba(6,182,212,0.55), 0 0 40px rgba(6,182,212,0.22);
        }
        .msm-map-pin--parking .msm-map-pin__glow { background: rgba(6,182,212,0.44); }
        /* Restaurant / deal — warm orange */
        .msm-map-pin--restaurant .msm-map-pin__drop,
        .msm-map-pin--deal .msm-map-pin__drop {
          background: #fb923c;
          box-shadow: 0 0 6px rgba(251,146,60,0.95), 0 0 18px rgba(251,146,60,0.55), 0 0 40px rgba(251,146,60,0.22);
        }
        .msm-map-pin--restaurant .msm-map-pin__glow,
        .msm-map-pin--deal .msm-map-pin__glow { background: rgba(251,146,60,0.44); }
        /* Event — fuchsia */
        .msm-map-pin--event .msm-map-pin__drop {
          background: #e879f9;
          box-shadow: 0 0 6px rgba(232,121,249,0.95), 0 0 18px rgba(232,121,249,0.55), 0 0 40px rgba(232,121,249,0.22);
        }
        .msm-map-pin--event .msm-map-pin__glow { background: rgba(232,121,249,0.44); }
        @keyframes msm-pin-glow {
          0%, 100% { opacity: 0.44; transform: scale(1); }
          50%       { opacity: 1;    transform: scale(1.45); }
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
