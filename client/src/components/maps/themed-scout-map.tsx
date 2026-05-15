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
        'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>, tiles © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#050807",
      },
    },
    {
      id: "carto-dark-tiles",
      type: "raster",
      source: "carto-dark",
      paint: {
        "raster-opacity": 1,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.9,
        "raster-saturation": 0.05,
        "raster-contrast": 0.34,
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
      pitch: 0,
      bearing: 0,
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
        current.setBearing(Math.sin((t / 70) * Math.PI * 2) * 3);
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
        <span class="msm-map-pin__halo"></span>
        <span class="msm-map-pin__core"></span>
      `;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerTap?.(marker);
      });

      markerRefs.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([marker.lng, marker.lat])
          .addTo(map),
      );
    });
  }, [markerKey, markers, onMarkerTap]);

  return (
    <div className="absolute inset-0 h-full w-full min-h-full">
      <div
        ref={containerRef}
        className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
        style={{ height: "100%", width: "100%", minHeight: "100%" }}
      />
      <div aria-hidden="true" className="msm-map-grade absolute inset-0" />
      <style>{`
        .msm-map-canvas .maplibregl-canvas {
          filter: saturate(1.08) contrast(1.25) brightness(1.08) sepia(0.22) hue-rotate(-12deg);
        }
        .msm-map-grade {
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(22, 9, 4, 0.18), rgba(4, 9, 8, 0.02) 34%, rgba(22, 9, 4, 0.14)),
            radial-gradient(circle at 55% 43%, rgba(255, 108, 55, 0.12), transparent 24%),
            radial-gradient(circle at 23% 26%, rgba(255, 180, 92, 0.04), transparent 26%),
            radial-gradient(circle at 79% 22%, rgba(255, 112, 52, 0.05), transparent 28%),
            linear-gradient(180deg, rgba(17, 8, 4, 0.08) 0%, rgba(17, 8, 4, 0) 44%, rgba(3, 4, 5, 0.2) 100%);
          background-size: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%;
          mix-blend-mode: normal;
          opacity: 0.58;
        }
        .msm-map-grade::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at center, transparent 0%, transparent 64%, rgba(0, 0, 0, 0.26) 100%),
            linear-gradient(180deg, rgba(10, 4, 2, 0.06), rgba(5, 6, 7, 0.18));
          mix-blend-mode: normal;
        }
        .msm-user-pin {
          position: relative;
          width: 24px;
          height: 24px;
          pointer-events: none;
        }
        .msm-user-pin__core {
          position: absolute;
          inset: 7px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid rgba(255, 255, 255, 0.9);
          box-shadow:
            0 0 0 5px rgba(37, 99, 235, 0.34),
            0 0 22px rgba(37, 99, 235, 0.7);
        }
        .msm-user-pin__pulse {
          position: absolute;
          inset: 1px;
          border-radius: 9999px;
          background: rgba(37, 99, 235, 0.34);
          animation: msm-user-pulse 2.4s ease-out infinite;
        }
        .msm-user-pin__pulse--delay {
          animation-delay: 1.2s;
        }
        @keyframes msm-user-pulse {
          0%   { transform: scale(0.7); opacity: 0.8; }
          80%  { transform: scale(2.3); opacity: 0; }
          100% { transform: scale(2.3); opacity: 0; }
        }

        .msm-map-pin {
          position: relative;
          width: 18px;
          height: 18px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          pointer-events: auto;
        }
        .msm-map-pin__halo,
        .msm-map-pin__core {
          position: absolute;
          border-radius: 9999px;
        }
        .msm-map-pin__halo {
          inset: 0;
          background: rgba(245, 158, 11, 0.32);
          filter: blur(3px);
          animation: msm-map-pin-glow 3s ease-in-out infinite;
        }
        .msm-map-pin__core {
          inset: 5px;
          background: #f59e0b;
          box-shadow:
            0 0 0 2px rgba(15, 18, 24, 0.82),
            0 0 14px rgba(245, 158, 11, 0.72);
        }
        .msm-map-pin--parking .msm-map-pin__halo { background: rgba(14, 165, 233, 0.32); }
        .msm-map-pin--parking .msm-map-pin__core { background: #38bdf8; }
        .msm-map-pin--restaurant .msm-map-pin__halo,
        .msm-map-pin--deal .msm-map-pin__halo { background: rgba(34, 197, 94, 0.26); }
        .msm-map-pin--restaurant .msm-map-pin__core,
        .msm-map-pin--deal .msm-map-pin__core { background: #22c55e; }
        .msm-map-pin--event .msm-map-pin__halo { background: rgba(217, 70, 239, 0.26); }
        .msm-map-pin--event .msm-map-pin__core { background: #d946ef; }
        @keyframes msm-map-pin-glow {
          0%, 100% { transform: scale(1); opacity: 0.58; }
          50% { transform: scale(1.55); opacity: 0.95; }
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
        Map data © OpenStreetMap contributors. Tiles © CARTO.
      </span>
    </div>
  );
}

export default ThemedScoutMap;
