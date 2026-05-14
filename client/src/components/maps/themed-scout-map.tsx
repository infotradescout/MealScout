/**
 * ThemedScoutMap
 * --------------
 * Compact animated Scout mini-map for /scout.
 *
 * The collapsed hero is a lightweight, branded mini-map element: stylized
 * streets, animated route glow, user position, and nearby signal pins. Pulling
 * down expands into the full Google map for real pan/zoom/tap exploration.
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
      aria-label="MealScout animated mini map"
    >
      <div className="msm-holo__base" aria-hidden="true" />
      <div className="msm-holo__grid" aria-hidden="true" />
      <svg
        className="msm-mini-map"
        viewBox="0 0 1000 560"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <filter id="msm-road-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="msm-route-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
            <stop offset="48%" stopColor="#fb923c" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="msm-map-blocks">
          <path d="M-20 88 H1040" />
          <path d="M-20 236 H1040" />
          <path d="M-20 386 H1040" />
          <path d="M96 -20 V600" />
          <path d="M278 -20 V600" />
          <path d="M458 -20 V600" />
          <path d="M640 -20 V600" />
          <path d="M824 -20 V600" />
        </g>

        <g className="msm-map-roads msm-map-roads--base">
          <path d="M-40 474 C142 394 230 440 372 352 C518 262 644 290 1040 134" />
          <path d="M-20 190 C164 238 300 202 426 142 C570 76 722 108 1040 64" />
          <path d="M196 -40 C236 112 186 226 264 344 C340 460 498 474 584 620" />
          <path d="M720 -40 C668 98 694 204 770 294 C850 390 824 478 908 620" />
        </g>
        <g className="msm-map-roads msm-map-roads--minor">
          <path d="M-10 322 C116 286 226 294 358 248 C484 204 574 190 708 206 C834 222 930 196 1010 154" />
          <path d="M42 62 C176 132 268 116 390 96 C522 72 594 122 704 154 C818 186 908 170 1020 112" />
          <path d="M360 -20 C382 110 354 216 424 314 C500 420 612 438 684 594" />
          <path d="M548 -20 C518 132 548 224 612 316 C686 424 678 500 732 600" />
        </g>
        <path
          className="msm-map-route"
          d="M-40 474 C142 394 230 440 372 352 C518 262 644 290 1040 134"
        />
      </svg>
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
            radial-gradient(circle at 50% 47%, rgba(249, 115, 22, 0.2), transparent 15%),
            radial-gradient(circle at 70% 18%, rgba(255, 122, 24, 0.17), transparent 27%),
            radial-gradient(circle at 26% 30%, rgba(59, 130, 246, 0.12), transparent 28%),
            linear-gradient(180deg, #090a0d 0%, #100b08 55%, #050608 100%);
        }
        .msm-holo__base,
        .msm-holo__grid,
        .msm-mini-map,
        .msm-holo__scan,
        .msm-holo__vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .msm-holo__base {
          background:
            linear-gradient(115deg, transparent 0 43%, rgba(249, 115, 22, 0.13) 44%, transparent 45% 100%),
            linear-gradient(65deg, transparent 0 55%, rgba(245, 158, 11, 0.08) 56%, transparent 57% 100%);
          opacity: 0.58;
          transform: skewY(-2deg);
        }
        .msm-holo__grid {
          background-image:
            linear-gradient(rgba(255, 177, 87, 0.065) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 177, 87, 0.065) 1px, transparent 1px);
          background-size: 38px 38px;
          opacity: 0.28;
          transform: perspective(460px) rotateX(54deg) translateY(-12%);
          transform-origin: 50% 20%;
        }
        .msm-mini-map {
          width: 100%;
          height: 100%;
          opacity: 0.95;
          filter: drop-shadow(0 0 24px rgba(249, 115, 22, 0.16));
        }
        .msm-map-blocks path {
          fill: none;
          stroke: rgba(255, 237, 213, 0.06);
          stroke-width: 1.4;
        }
        .msm-map-roads path {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .msm-map-roads--base path {
          stroke: rgba(234, 88, 12, 0.76);
          stroke-width: 13;
          filter: url(#msm-road-glow);
        }
        .msm-map-roads--minor path {
          stroke: rgba(251, 146, 60, 0.34);
          stroke-width: 4;
        }
        .msm-map-route {
          fill: none;
          stroke: url(#msm-route-gradient);
          stroke-linecap: round;
          stroke-width: 5;
          stroke-dasharray: 86 220;
          animation: msm-route-flow 5.8s linear infinite;
          filter: url(#msm-road-glow);
        }
        .msm-holo__scan {
          border-radius: 9999px;
          border: 1px solid rgba(251, 191, 36, 0.18);
          box-shadow: 0 0 40px rgba(249, 115, 22, 0.12);
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
            linear-gradient(180deg, rgba(0, 0, 0, 0.18), transparent 34%, rgba(0, 0, 0, 0.36)),
            radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.42) 76%);
        }
        @keyframes msm-route-flow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -306; }
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
          .msm-map-route,
          .msm-signal {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export default ThemedScoutMap;
