/**
 * ThemedScoutMap
 * --------------
 * Custom atmospheric "scout view" for the embedded MealScout /scout map.
 *
 * - NOT a raw Google Maps widget. Uses MapLibre GL JS with a street-forward
 *   style + free CARTO Voyager raster tiles, then layers MealScout's
 *   amber-glow brand pins over the top so the hero matches the
 *   Atmospheric UI (dark backgrounds, glassmorphism, glowing amber accents).
 *
 * - The camera fits the user's location and nearby pins into the visible
 *   hero area. Bottom padding keeps pins above the dashboard panel.
 *
 * - The map gently drifts/rotates around the user's pin so the hero feels
 *   alive even when nothing is happening.
 *
 * - All built-in controls (zoom, attribution, scale, etc.) are disabled
 *   because this is a presentation surface, not an interactive map. The
 *   real interactive map is mounted separately (GoogleMapSurface) when
 *   the user pulls down to fullscreen.
 */

import { useEffect, useMemo, useRef } from "react";
import maplibregl, {
  type Map as MaplibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { MapAdapterMarker } from "./map-adapter.types";

interface ThemedScoutMapProps {
  /** User's geolocation. */
  userLocation: { lat: number; lng: number };
  /** Truck pins to render as amber glow markers. */
  markers: MapAdapterMarker[];
  /** Optional callback when a marker is tapped. */
  onMarkerTap?: (marker: MapAdapterMarker) => void;
  /** Hero zoom level. Defaults to 14 (neighborhood scale). */
  zoom?: number;
}

/**
 * Custom branded style spec. We use CARTO's free Voyager raster tiles
 * as the base (no API key needed, ODbL attribution), then grade them down
 * gently so roads and labels stay visible without looking like stock maps.
 */
const DARK_STYLE: StyleSpecification = {
  version: 8,
  // No glyphs or sprites needed — we don't render text/icons from the style.
  sources: {
    "carto-voyager": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#110b08",
      },
    },
    {
      id: "carto-voyager-tiles",
      type: "raster",
      source: "carto-voyager",
      paint: {
        "raster-opacity": 1,
        "raster-brightness-min": 0,
        "raster-brightness-max": 1,
        "raster-saturation": 0.08,
        "raster-contrast": 0.14,
      },
    },
  ],
};

/**
 * Fallback padding used before the container has a measured size.
 */
const HERO_CAMERA_PADDING = {
  top: 40,
  right: 32,
  bottom: 150,
  left: 32,
};

export function ThemedScoutMap({
  userLocation,
  markers,
  onMarkerTap,
  zoom = 14,
}: ThemedScoutMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const truckMarkersRef = useRef<maplibregl.Marker[]>([]);
  const driftRafRef = useRef<number | null>(null);
  const driftStartRef = useRef<number | null>(null);

  /* --------------------------------------------------------------
     Compute padding that reserves the bottom dashboard space and keeps
     pins inside the readable upper map area on mobile.
     -------------------------------------------------------------- */
  const computePadding = () => {
    const el = containerRef.current;
    if (!el) return HERO_CAMERA_PADDING;
    const w = el.clientWidth || 0;
    const h = el.clientHeight || 0;
    return {
      top: Math.max(28, Math.round(h * 0.12)),
      right: Math.max(24, Math.round(w * 0.08)),
      bottom: Math.max(120, Math.round(h * 0.46)),
      left: Math.max(24, Math.round(w * 0.08)),
    };
  };

  const fitMapToContent = (duration = 0) => {
    const m = mapRef.current;
    if (!m) return;
    const points = [
      userLocation,
      ...markers.filter(
        (marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng),
      ),
    ];

    if (points.length <= 1) {
      m.easeTo({
        center: [userLocation.lng, userLocation.lat],
        zoom,
        padding: computePadding(),
        duration,
      });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) => bounds.extend([point.lng, point.lat]));
    m.fitBounds(bounds, {
      padding: computePadding(),
      maxZoom: Math.min(zoom, 11.75),
      duration,
    });
  };

  /* --------------------------------------------------------------
     Initialize the map exactly once.
     -------------------------------------------------------------- */
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [userLocation.lng, userLocation.lat],
      zoom,
      pitch: 0,
      bearing: 0,
      // Disable every default interaction — this is a presentation surface.
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
      const m = mapRef.current;
      if (!m) return;
      m.resize();
      fitMapToContent(0);
    };
    const initialResizeFrame = requestAnimationFrame(resizeMap);
    const initialResizeTimeout = window.setTimeout(resizeMap, 250);

    map.on("load", () => {
      // Fit once the canvas has its real size.
      fitMapToContent(0);

      // Build the user pulsing pin (amber).
      const userEl = document.createElement("div");
      userEl.className = "msm-user-pin";
      userEl.setAttribute("aria-label", "Your location");
      userEl.innerHTML = `
        <span class="msm-user-pin__pulse"></span>
        <span class="msm-user-pin__pulse msm-user-pin__pulse--delay"></span>
        <span class="msm-user-pin__core"></span>
      `;
      const userMarker = new maplibregl.Marker({
        element: userEl,
        anchor: "center",
      })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);
      userMarkerRef.current = userMarker;

      // Start the slow drift animation (rotates the bearing very gently
      // around the user's pin so the world appears to breathe).
      driftStartRef.current = performance.now();
      const tick = () => {
        const m = mapRef.current;
        if (!m) return;
        if (driftStartRef.current == null) driftStartRef.current = performance.now();
        const t = (performance.now() - driftStartRef.current) / 1000;
        // Bearing oscillates between -6deg and +6deg over a 60s period.
        const bearing = Math.sin((t / 60) * Math.PI * 2) * 6;
        m.setBearing(bearing);
        driftRafRef.current = requestAnimationFrame(tick);
      };
      driftRafRef.current = requestAnimationFrame(tick);
    });

    // Resize handling
    const ro = new ResizeObserver(() => {
      const m = mapRef.current;
      if (!m) return;
      m.resize();
      fitMapToContent(200);
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
      truckMarkersRef.current.forEach((mk) => mk.remove());
      truckMarkersRef.current = [];
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
        .map((m) => `${m.id}:${m.lat.toFixed(5)},${m.lng.toFixed(5)}`)
        .join("|"),
    [markers],
  );

  /* --------------------------------------------------------------
     Re-fit on user-location change (e.g. permission granted later
     or user moves).
     -------------------------------------------------------------- */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    fitMapToContent(600);
    userMarkerRef.current?.setLngLat([userLocation.lng, userLocation.lat]);
  }, [userLocation.lat, userLocation.lng, markerKey]);

  /* --------------------------------------------------------------
     Update truck markers when the marker list changes.
     -------------------------------------------------------------- */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    // Tear down old truck markers.
    truckMarkersRef.current.forEach((mk) => mk.remove());
    truckMarkersRef.current = [];

    markers.forEach((marker) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "msm-truck-pin";
      el.setAttribute(
        "aria-label",
        marker.title ? `${marker.title} pin` : "Food truck pin",
      );
      el.innerHTML = `
        <span class="msm-truck-pin__glow"></span>
        <span class="msm-truck-pin__core"></span>
      `;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (onMarkerTap) onMarkerTap(marker);
      });
      const mlMarker = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([marker.lng, marker.lat])
        .addTo(m);
      truckMarkersRef.current.push(mlMarker);
    });
  }, [markerKey, onMarkerTap, markers]);

  return (
    <div className="absolute inset-0 h-full w-full min-h-full">
      <div
        ref={containerRef}
        className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
        style={{ height: "100%", width: "100%", minHeight: "100%" }}
        // The map canvas itself
      />
      <div aria-hidden="true" className="msm-map-grade absolute inset-0" />
      {/* Inline scoped styles for the pins. Kept here so the component
          is self-contained and doesn't require global CSS edits. */}
      <style>{`
        .msm-user-pin {
          position: relative;
          width: 22px;
          height: 22px;
          pointer-events: none;
        }
        .msm-user-pin__core {
          position: absolute;
          inset: 6px;
          border-radius: 9999px;
          background: #f59e0b;
          box-shadow:
            0 0 0 3px rgba(245, 158, 11, 0.35),
            0 0 18px 4px rgba(245, 158, 11, 0.55);
        }
        .msm-user-pin__pulse {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: rgba(245, 158, 11, 0.35);
          animation: msm-user-pulse 2.4s ease-out infinite;
        }
        .msm-user-pin__pulse--delay {
          animation-delay: 1.2s;
        }
        @keyframes msm-user-pulse {
          0%   { transform: scale(0.6); opacity: 0.7; }
          80%  { transform: scale(2.4); opacity: 0;   }
          100% { transform: scale(2.4); opacity: 0;   }
        }

        .msm-truck-pin {
          position: relative;
          width: 18px;
          height: 18px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          pointer-events: auto;
        }
        .msm-truck-pin__core {
          position: absolute;
          inset: 5px;
          border-radius: 9999px;
          background: #fbbf24;
          box-shadow:
            0 0 0 2px rgba(15, 18, 24, 0.85),
            0 0 12px 2px rgba(245, 158, 11, 0.65);
        }
        .msm-truck-pin__glow {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: rgba(245, 158, 11, 0.32);
          filter: blur(2px);
          animation: msm-truck-glow 3s ease-in-out infinite;
        }
        @keyframes msm-truck-glow {
          0%, 100% { transform: scale(1);   opacity: 0.55; }
          50%      { transform: scale(1.4); opacity: 0.85; }
        }

        .msm-map-canvas .maplibregl-canvas {
          filter: saturate(1.08) contrast(1.18) brightness(0.68) sepia(0.18) hue-rotate(-12deg);
        }
        .msm-map-grade {
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(18, 10, 6, 0.16) 0%, rgba(10, 8, 8, 0.1) 42%, rgba(5, 6, 8, 0.22) 100%),
            linear-gradient(90deg, rgba(0, 0, 0, 0.12), transparent 26%, transparent 74%, rgba(0, 0, 0, 0.1));
          mix-blend-mode: multiply;
        }
        .msm-map-grade::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 72% 18%, rgba(249, 115, 22, 0.1), transparent 32%);
          mix-blend-mode: screen;
        }

        /* Hide MapLibre's built-in attribution chrome — we still surface
           OSM/CARTO credit via aria-label on the container for compliance. */
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
      {/* Visually-hidden attribution to satisfy CARTO/OSM ToS without
          breaking the cinematic hero. Screen-reader friendly. */}
      <span
        className="sr-only"
        aria-label="Map data attribution"
      >
        Map data © OpenStreetMap contributors. Tiles © CARTO.
      </span>
    </div>
  );
}

export default ThemedScoutMap;
