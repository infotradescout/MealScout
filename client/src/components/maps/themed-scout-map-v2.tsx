/**
 * ThemedScoutMapV2
 * ----------------
 * Clear local-tile fallback for Scout when Google Maps is unavailable.
 *
 * This must stay flat, readable, and truthful because it can become the full
 * map during a provider outage; it is not a decorative substitute.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type Map as MaplibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { MapAdapterMarker } from "./map-adapter.types";

interface ThemedScoutMapV2Props {
  userLocation: { lat: number; lng: number };
  showUserLocation?: boolean;
  markers: MapAdapterMarker[];
  selectedMarkerId?: string | null;
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
        "background-color": "#f5f3ee",
      },
    },
    {
      id: "carto-light-tiles",
      type: "raster",
      source: "carto-light",
      paint: {
        "raster-opacity": 1,
        "raster-brightness-min": 0,
        "raster-brightness-max": 1,
        "raster-saturation": 0,
        "raster-contrast": 0,
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

const PREVIEW_FRAME_MARKER_MILES = 18;
const FALLBACK_PIN_LIMIT = 60;

function getMarkerDistanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(hav)));
}

// Browsers block (or silently drop) http:// image requests on an https://
// page as mixed content. Owner-submitted photo URLs occasionally predate
// the site's HTTPS-only rollout, so upgrade the scheme instead of letting
// the pin photo fail closed with no visible error.
function resolveSecureImageUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return url;
}

const MAP_PIN_KIND_ICONS: Record<string, string> = {
  truck: "T",
  restaurant: "R",
  parking: "H",
  event: "E",
  deal: "$",
  geo_ad: "◆",
  supplier: "S",
};

// Plain equirectangular projection onto the visible box - fine at the local
// (single metro area) scale this fallback operates at, and it only needs to
// place pins close enough to tap, not survey-accurate.
function projectFallbackPositions(
  userLocation: { lat: number; lng: number },
  markers: MapAdapterMarker[],
): Array<{ marker: MapAdapterMarker; leftPct: number; topPct: number }> {
  const finite = markers.filter(
    (marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng),
  );
  if (finite.length === 0) return [];

  const nearest = [...finite]
    .sort(
      (a, b) =>
        getMarkerDistanceMiles(userLocation, a) -
        getMarkerDistanceMiles(userLocation, b),
    )
    .slice(0, FALLBACK_PIN_LIMIT);

  const lats = [userLocation.lat, ...nearest.map((marker) => marker.lat)];
  const lngs = [userLocation.lng, ...nearest.map((marker) => marker.lng)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, 0.006);
  const lngSpan = Math.max(maxLng - minLng, 0.006);
  const pad = 0.14;

  return nearest.map((marker) => {
    const xRatio = (marker.lng - minLng) / lngSpan;
    const yRatio = (marker.lat - minLat) / latSpan;
    return {
      marker,
      leftPct: (pad + xRatio * (1 - 2 * pad)) * 100,
      topPct: (pad + (1 - yRatio) * (1 - 2 * pad)) * 100,
    };
  });
}

function FallbackMapPin({
  marker,
  leftPct,
  topPct,
  onTap,
}: {
  marker: MapAdapterMarker;
  leftPct: number;
  topPct: number;
  onTap?: (marker: MapAdapterMarker) => void;
}) {
  const secureImageUrl = resolveSecureImageUrl(marker.imageUrl);
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = !!secureImageUrl && !photoFailed;
  const icon = MAP_PIN_KIND_ICONS[marker.kind || "truck"] ?? "·";
  const truckBadge = (marker.parkedTrucks?.length || 0) > 0;

  return (
    <button
      type="button"
      className={`msm-map-pin msm-map-pin--${marker.kind || "truck"} msm-fallback-pin ${showPhoto ? "msm-map-pin--photo" : ""}`}
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      aria-label={marker.title ? `${marker.title} pin` : "MealScout map pin"}
      onClick={(event) => {
        event.stopPropagation();
        onTap?.(marker);
      }}
    >
      {showPhoto ? (
        <>
          <span className="msm-map-pin__photo-glow" aria-hidden="true" />
          <span className="msm-map-pin__photo-ring" aria-hidden="true">
            <img
              className="msm-map-pin__photo"
              alt=""
              loading="lazy"
              src={secureImageUrl ?? undefined}
              onError={() => setPhotoFailed(true)}
            />
          </span>
          <span className="msm-map-pin__photo-point" aria-hidden="true" />
        </>
      ) : (
        <>
          <span className="msm-map-pin__drop" aria-hidden="true">
            <span className="msm-map-pin__icon">{icon}</span>
            <span className="msm-map-pin__glow" />
          </span>
          {truckBadge && (
            <span className="msm-map-pin__truck-badge" aria-hidden="true">
              T
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function ThemedScoutMapV2({
  userLocation,
  showUserLocation = false,
  markers,
  selectedMarkerId = null,
  onMarkerTap,
  zoom = 13,
  interactive = false,
}: ThemedScoutMapV2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const mapHasLoadedRef = useRef(false);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const frameStateRef = useRef({ userLocation, markers, zoom });
  frameStateRef.current = { userLocation, markers, zoom };
  // Tracks either "no WebGL" (checked up front) or "tiles never loaded"
  // (network/ad-blocker interference with the CDN) so we can show a plain
  // warm placeholder instead of a mysteriously blank card.
  const [tilesUnavailable, setTilesUnavailable] = useState(
    () => !isWebglAvailable(),
  );

  const frameMap = (duration = 0) => {
    const map = mapRef.current;
    if (!map) return;
    const frameState = frameStateRef.current;
    const frameLocation = frameState.userLocation;
    const baseZoom = frameState.zoom;
    const localMarkers = frameState.markers
      .filter(
        (marker) =>
          Number.isFinite(marker.lat) &&
          Number.isFinite(marker.lng) &&
          getMarkerDistanceMiles(frameLocation, marker) <= PREVIEW_FRAME_MARKER_MILES,
      )
      .slice(0, 8);
    if (localMarkers.length > 0) {
      const latValues = [frameLocation.lat, ...localMarkers.map((marker) => marker.lat)];
      const lngValues = [frameLocation.lng, ...localMarkers.map((marker) => marker.lng)];
      const farthestMiles = Math.max(
        ...localMarkers.map((marker) => getMarkerDistanceMiles(frameLocation, marker)),
      );
      const targetZoom =
        farthestMiles > 12 ? 10.6 :
        farthestMiles > 6 ? 11.2 :
        farthestMiles > 2.5 ? 12 :
        farthestMiles > 0.9 ? 12.55 :
        baseZoom;
      map.easeTo({
        center: [
          (Math.min(...lngValues) + Math.max(...lngValues)) / 2,
          (Math.min(...latValues) + Math.max(...latValues)) / 2,
        ],
        zoom: Math.min(baseZoom, targetZoom),
        pitch: 0,
        bearing: 0,
        duration,
      });
      return;
    }
    map.easeTo({
      center: [frameLocation.lng, frameLocation.lat],
      zoom: baseZoom,
      pitch: 0,
      bearing: 0,
      duration,
    });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current || tilesUnavailable) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MINI_MAP_STYLE,
      center: [frameStateRef.current.userLocation.lng, frameStateRef.current.userLocation.lat],
      zoom: frameStateRef.current.zoom,
      pitch: 0,
      bearing: 0,
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
      frameMap(0);
    };
    const initialResizeFrame = requestAnimationFrame(resizeMap);
    const initialResizeTimeout = window.setTimeout(resizeMap, 250);

    const handleLoad = () => {
      mapHasLoadedRef.current = true;
      frameMap(0);
    };
    map.on("load", handleLoad);

    const ro = new ResizeObserver(() => {
      const current = mapRef.current;
      if (!current) return;
      current.resize();
      if (!interactive) {
        frameMap(160);
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
      map.off("load", handleLoad);
      map.off("sourcedata", handleSourceData);
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      mapHasLoadedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, tilesUnavailable]);

  const markerKey = useMemo(
    () =>
      markers
        .map(
          (marker) =>
            `${marker.id}:${marker.lat.toFixed(5)},${marker.lng.toFixed(5)}:${
              marker.id === selectedMarkerId ? "selected" : "idle"
            }`,
        )
        .join("|"),
    [markers, selectedMarkerId],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncUserMarker = () => {
      if (!showUserLocation) {
        userMarkerRef.current?.remove();
        userMarkerRef.current = null;
        return;
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
        return;
      }
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
    };

    if (mapHasLoadedRef.current) syncUserMarker();
    else map.once("load", syncUserMarker);
    return () => {
      map.off("load", syncUserMarker);
    };
  }, [
    interactive,
    showUserLocation,
    tilesUnavailable,
    userLocation.lat,
    userLocation.lng,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!interactive) {
      frameMap(500);
    }
  }, [interactive, markerKey, userLocation.lat, userLocation.lng, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    const KIND_ICONS: Record<string, string> = {
      truck: "T", restaurant: "R",
      parking: "H", event: "E", deal: "$", geo_ad: "◆", supplier: "S",
    };

    const renderIconPin = (el: HTMLButtonElement, marker: MapAdapterMarker) => {
      el.classList.remove("msm-map-pin--photo");
      const icon = KIND_ICONS[marker.kind || "truck"] ?? "·";
      const truckBadge = (marker.parkedTrucks?.length || 0) > 0
        ? `<span class="msm-map-pin__truck-badge" aria-hidden="true">T</span>`
        : "";
      el.innerHTML = `
        <span class="msm-map-pin__drop" aria-hidden="true">
          <span class="msm-map-pin__icon">${icon}</span>
          <span class="msm-map-pin__glow"></span>
        </span>
        ${truckBadge}
      `;
    };

    markers.forEach((marker) => {
      if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) return;

      const el = document.createElement("button");
      el.type = "button";
      el.className = `msm-map-pin msm-map-pin--${marker.kind || "truck"}`;
      if (marker.id === selectedMarkerId) {
        el.classList.add("msm-map-pin--selected");
        el.style.zIndex = "20";
      }
      el.setAttribute(
        "aria-label",
        marker.title ? `${marker.title} pin` : "MealScout map pin",
      );

      if (marker.imageUrl) {
        el.classList.add("msm-map-pin--photo");
        // Built via DOM APIs (not innerHTML) so the URL is assigned as a
        // property, not parsed as markup - avoids injecting attacker-
        // controlled owner-submitted image URLs into the page as HTML.
        el.innerHTML = `
          <span class="msm-map-pin__photo-glow" aria-hidden="true"></span>
          <span class="msm-map-pin__photo-ring" aria-hidden="true"></span>
          <span class="msm-map-pin__photo-point" aria-hidden="true"></span>
        `;
        const ring = el.querySelector<HTMLSpanElement>(
          ".msm-map-pin__photo-ring",
        );
        const img = document.createElement("img");
        img.className = "msm-map-pin__photo";
        img.alt = "";
        img.loading = "lazy";
        img.src = resolveSecureImageUrl(marker.imageUrl) as string;
        img.addEventListener("error", () => renderIconPin(el, marker), {
          once: true,
        });
        ring?.appendChild(img);
      } else {
        renderIconPin(el, marker);
      }

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
    if (!interactive) {
      let frameId: number | null = null;
      const frameTimeoutIds: number[] = [];
      const runFrame = () => {
        frameId = window.requestAnimationFrame(() => frameMap(420));
        frameTimeoutIds.push(
          window.setTimeout(() => frameMap(420), 280),
          window.setTimeout(() => frameMap(420), 900),
        );
      };
      if (mapHasLoadedRef.current) {
        runFrame();
      } else {
        map.once("load", runFrame);
      }
      return () => {
        map.off("load", runFrame);
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        frameTimeoutIds.forEach((id) => window.clearTimeout(id));
      };
    }
  }, [interactive, markerKey, markers, onMarkerTap, selectedMarkerId, zoom]);

  const fallbackPositions = useMemo(
    () =>
      tilesUnavailable
        ? projectFallbackPositions(userLocation, markers)
        : [],
    [tilesUnavailable, userLocation, markerKey, markers],
  );

  return (
    <div
      className={`absolute inset-0 h-full w-full min-h-full ${interactive ? "msm-mode-interactive" : "msm-mode-preview"}`}
    >
      <div className="absolute inset-0">
        {tilesUnavailable ? (
          // No WebGL, or tiles never loaded (ad-blocker/CDN interference) -
          // show the same warm background the map style would have used,
          // but keep every pin clickable instead of leaving a dead rectangle.
          <div
            className="absolute inset-0 h-full w-full min-h-full"
            style={{ backgroundColor: "#211710" }}
          >
            {showUserLocation && (
              <span
                className="msm-user-pin msm-fallback-user-pin"
                aria-label="Your location"
                style={{ left: "50%", top: "50%" }}
              >
                <span className="msm-user-pin__pulse" />
                <span className="msm-user-pin__pulse msm-user-pin__pulse--delay" />
                <span className="msm-user-pin__core" />
              </span>
            )}
            {fallbackPositions.map(({ marker, leftPct, topPct }) => (
              <FallbackMapPin
                key={marker.id}
                marker={marker}
                leftPct={leftPct}
                topPct={topPct}
                onTap={onMarkerTap}
              />
            ))}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="msm-map-canvas absolute inset-0 h-full w-full min-h-full"
            style={{ height: "100%", width: "100%", minHeight: "100%" }}
          />
        )}
      </div>

      <style>{`
        .msm-map-canvas .maplibregl-canvas {
          filter: brightness(0.48) saturate(0.72) sepia(0.18) contrast(1.12);
        }

        /* ── No-tiles fallback pins (positioned by lat/lng ratio, not MapLibre) ──
           Compound selectors so these win over the base .msm-map-pin /
           .msm-user-pin position:relative rules regardless of declaration order. */
        .msm-map-pin.msm-fallback-pin {
          position: absolute;
          transform: translate(-50%, -100%);
          z-index: 4;
        }
        .msm-user-pin.msm-fallback-user-pin {
          position: absolute;
          transform: translate(-50%, -50%);
          z-index: 3;
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
        .msm-map-pin--selected {
          transform: translateY(-5px) scale(1.24);
          filter: drop-shadow(0 0 8px rgba(255,255,255,0.95)) drop-shadow(0 0 18px rgba(249,115,22,0.8));
        }
        .msm-map-pin--selected::before {
          content: "";
          position: absolute;
          inset: -7px;
          border: 3px solid #fff7ed;
          border-radius: 999px;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .msm-map-pin, .msm-map-pin * { animation: none !important; transition: none !important; }
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
        /* Host location */
        .msm-map-pin--parking .msm-map-pin__drop {
          background: #f59e0b;
          box-shadow: 0 2px 0 rgba(255,255,255,0.62) inset, 0 8px 18px rgba(180,83,9,0.26), 0 0 0 3px rgba(254,243,199,0.88);
        }
        .msm-map-pin--parking .msm-map-pin__glow { background: rgba(245,158,11,0.26); }
        .msm-map-pin__truck-badge {
          position: absolute;
          right: -5px;
          top: -5px;
          z-index: 3;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fb923c;
          color: #1b0b02;
          border: 2px solid #fff7ed;
          box-shadow: 0 5px 12px rgba(0,0,0,0.36);
          font: 900 9px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        /* Geo ad — teal */
        .msm-map-pin--geo_ad .msm-map-pin__drop {
          background: #34d399;
          box-shadow: 0 2px 0 rgba(255,255,255,0.58) inset, 0 8px 18px rgba(5,150,105,0.24), 0 0 0 3px rgba(209,250,229,0.82);
        }
        .msm-map-pin--geo_ad .msm-map-pin__glow { background: rgba(52,211,153,0.24); }
        /* ── Circular photo pins ── */
        .msm-map-pin--photo {
          width: 64px;
          height: 78px;
          align-items: center;
        }
        .msm-map-pin__photo-glow {
          position: absolute;
          top: 2px;
          width: 64px;
          height: 64px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(255, 140, 60, 0.55), transparent 68%);
          pointer-events: none;
        }
        .msm-map-pin__photo-ring {
          position: relative;
          width: 52px;
          height: 52px;
          border-radius: 9999px;
          overflow: hidden;
          background: #241209;
          box-shadow:
            0 0 0 3px rgba(255, 180, 110, 0.9),
            0 10px 22px rgba(0, 0, 0, 0.45);
        }
        .msm-map-pin__photo {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .msm-map-pin__photo-point {
          position: absolute;
          bottom: 8px;
          width: 12px;
          height: 12px;
          border-radius: 2px;
          transform: rotate(45deg);
          background: rgba(255, 180, 110, 0.9);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
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

export default ThemedScoutMapV2;
