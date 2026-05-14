/**
 * ThemedScoutMap
 * --------------
 * Compact holographic Scout surface for /scout.
 *
 * This is intentionally not a street map. The collapsed hero should feel like
 * a branded local-signal preview, then expand into the full Google map when the
 * user pulls down. Keeping this surface abstract avoids fighting with map tile
 * contrast, labels, centering, and stale cartography in a space that is mostly
 * covered by the Scout sheet.
 */

import { useMemo } from "react";

import type { MapAdapterMarker } from "./map-adapter.types";

interface ThemedScoutMapProps {
  userLocation: { lat: number; lng: number };
  markers: MapAdapterMarker[];
  onMarkerTap?: (marker: MapAdapterMarker) => void;
  zoom?: number;
}

type ProjectedMarker = MapAdapterMarker & {
  x: number;
  y: number;
  distanceKm: number;
};

const compact = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const markerClassName = (kind: MapAdapterMarker["kind"] | undefined) => {
  switch (kind) {
    case "parking":
      return "msm-signal msm-signal--parking";
    case "restaurant":
      return "msm-signal msm-signal--food";
    case "event":
      return "msm-signal msm-signal--event";
    case "deal":
      return "msm-signal msm-signal--deal";
    default:
      return "msm-signal msm-signal--truck";
  }
};

const projectMarkers = (
  userLocation: { lat: number; lng: number },
  markers: MapAdapterMarker[],
): ProjectedMarker[] => {
  const lngKm = Math.max(25, 111.32 * Math.cos((userLocation.lat * Math.PI) / 180));
  const rangeKm = 42;

  return markers
    .filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng))
    .map((marker) => {
      const dxKm = (marker.lng - userLocation.lng) * lngKm;
      const dyKm = (marker.lat - userLocation.lat) * 110.57;
      const distanceKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);
      return {
        ...marker,
        distanceKm,
        x: compact(50 + (dxKm / rangeKm) * 38, 9, 91),
        y: compact(50 - (dyKm / rangeKm) * 38, 9, 91),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 24);
};

export function ThemedScoutMap({
  userLocation,
  markers,
  onMarkerTap,
}: ThemedScoutMapProps) {
  const projectedMarkers = useMemo(
    () => projectMarkers(userLocation, markers),
    [userLocation.lat, userLocation.lng, markers],
  );

  return (
    <div
      className="msm-holo absolute inset-0 h-full w-full min-h-full overflow-hidden"
      aria-label="MealScout local signal preview"
    >
      <div className="msm-holo__base" aria-hidden="true" />
      <div className="msm-holo__grid" aria-hidden="true" />
      <div className="msm-holo__scan msm-holo__scan--one" aria-hidden="true" />
      <div className="msm-holo__scan msm-holo__scan--two" aria-hidden="true" />
      <div className="msm-holo__core" aria-hidden="true">
        <span className="msm-holo__core-ring" />
        <span className="msm-holo__core-dot" />
      </div>

      <div className="msm-holo__signals" aria-hidden={projectedMarkers.length === 0}>
        {projectedMarkers.map((marker, index) => (
          <button
            key={`${marker.id}-${index}`}
            type="button"
            className={markerClassName(marker.kind)}
            style={{
              left: `${marker.x}%`,
              top: `${marker.y}%`,
              animationDelay: `${(index % 7) * 110}ms`,
            }}
            aria-label={marker.title ? `${marker.title} signal` : "MealScout signal"}
            onClick={(event) => {
              event.stopPropagation();
              onMarkerTap?.(marker);
            }}
          >
            <span className="msm-signal__halo" />
            <span className="msm-signal__dot" />
          </button>
        ))}
      </div>

      <div className="msm-holo__vignette" aria-hidden="true" />

      <style>{`
        .msm-holo {
          background:
            radial-gradient(circle at 50% 45%, rgba(249, 115, 22, 0.22), transparent 13%),
            radial-gradient(circle at 68% 22%, rgba(255, 122, 24, 0.16), transparent 24%),
            radial-gradient(circle at 28% 28%, rgba(59, 130, 246, 0.11), transparent 26%),
            linear-gradient(180deg, #080a0d 0%, #0c0a08 58%, #050608 100%);
        }
        .msm-holo__base,
        .msm-holo__grid,
        .msm-holo__scan,
        .msm-holo__vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .msm-holo__base {
          background:
            linear-gradient(115deg, transparent 0 44%, rgba(249, 115, 22, 0.14) 45%, transparent 46% 100%),
            linear-gradient(65deg, transparent 0 56%, rgba(245, 158, 11, 0.08) 57%, transparent 58% 100%);
          opacity: 0.68;
          transform: skewY(-3deg);
        }
        .msm-holo__grid {
          background-image:
            linear-gradient(rgba(255, 177, 87, 0.085) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 177, 87, 0.085) 1px, transparent 1px);
          background-size: 38px 38px;
          opacity: 0.34;
          transform: perspective(460px) rotateX(54deg) translateY(-12%);
          transform-origin: 50% 20%;
        }
        .msm-holo__scan {
          border-radius: 9999px;
          border: 1px solid rgba(251, 191, 36, 0.22);
          box-shadow: 0 0 40px rgba(249, 115, 22, 0.14);
          animation: msm-scan 5.8s ease-in-out infinite;
        }
        .msm-holo__scan--one {
          inset: 26% 34%;
        }
        .msm-holo__scan--two {
          inset: 12% 22%;
          animation-delay: 1.6s;
          opacity: 0.68;
        }
        .msm-holo__core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 28px;
          height: 28px;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }
        .msm-holo__core-ring,
        .msm-holo__core-dot {
          position: absolute;
          border-radius: 9999px;
        }
        .msm-holo__core-ring {
          inset: 0;
          border: 2px solid rgba(255, 255, 255, 0.72);
          box-shadow:
            0 0 0 5px rgba(59, 130, 246, 0.45),
            0 0 28px rgba(59, 130, 246, 0.55);
        }
        .msm-holo__core-dot {
          inset: 8px;
          background: #3b82f6;
          box-shadow: 0 0 24px rgba(59, 130, 246, 0.82);
        }
        .msm-holo__signals {
          position: absolute;
          inset: 0;
        }
        .msm-signal {
          position: absolute;
          width: 18px;
          height: 18px;
          padding: 0;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          transform: translate(-50%, -50%);
          cursor: pointer;
          pointer-events: auto;
          animation: msm-signal-float 3.4s ease-in-out infinite;
        }
        .msm-signal__halo,
        .msm-signal__dot {
          position: absolute;
          border-radius: 9999px;
          inset: 0;
        }
        .msm-signal__halo {
          background: rgba(249, 115, 22, 0.28);
          filter: blur(4px);
          transform: scale(1.8);
        }
        .msm-signal__dot {
          inset: 5px;
          background: #f59e0b;
          box-shadow:
            0 0 0 2px rgba(15, 10, 8, 0.74),
            0 0 18px rgba(245, 158, 11, 0.78);
        }
        .msm-signal--parking .msm-signal__halo { background: rgba(14, 165, 233, 0.28); }
        .msm-signal--parking .msm-signal__dot {
          background: #38bdf8;
          box-shadow: 0 0 0 2px rgba(15, 10, 8, 0.74), 0 0 18px rgba(56, 189, 248, 0.72);
        }
        .msm-signal--food .msm-signal__halo,
        .msm-signal--deal .msm-signal__halo { background: rgba(34, 197, 94, 0.24); }
        .msm-signal--food .msm-signal__dot,
        .msm-signal--deal .msm-signal__dot {
          background: #22c55e;
          box-shadow: 0 0 0 2px rgba(15, 10, 8, 0.74), 0 0 18px rgba(34, 197, 94, 0.66);
        }
        .msm-signal--event .msm-signal__halo { background: rgba(217, 70, 239, 0.24); }
        .msm-signal--event .msm-signal__dot {
          background: #d946ef;
          box-shadow: 0 0 0 2px rgba(15, 10, 8, 0.74), 0 0 18px rgba(217, 70, 239, 0.66);
        }
        .msm-holo__vignette {
          background:
            linear-gradient(180deg, rgba(0, 0, 0, 0.28), transparent 34%, rgba(0, 0, 0, 0.34)),
            radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.48) 74%);
        }
        @keyframes msm-scan {
          0%, 100% { transform: scale(0.82); opacity: 0.15; }
          45% { transform: scale(1.12); opacity: 0.58; }
        }
        @keyframes msm-signal-float {
          0%, 100% { transform: translate(-50%, -50%) scale(0.95); opacity: 0.76; }
          50% { transform: translate(-50%, -54%) scale(1.08); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .msm-holo__scan,
          .msm-signal {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export default ThemedScoutMap;
