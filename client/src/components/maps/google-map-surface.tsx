import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  MapAdapterMarker,
  MapBoundsLike,
  MapTrafficCell,
} from "./map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import {
  createGoogleMarkerInstance,
  resolveGoogleMarkerRenderer,
} from "./google-marker-runtime";

type GeoPoint = { lat: number; lng: number };
type ScreenPoint = { x: number; y: number };
type AreaBounds = { north: number; south: number; east: number; west: number };

type GoogleMapSurfaceProps = {
  apiKey: string;
  mapId?: string;
  center: GeoPoint;
  zoom: number;
  markers: MapAdapterMarker[];
  selectedMarkerId?: string | null;
  trafficCells?: MapTrafficCell[];
  showRoadTrafficLayer?: boolean;
  userLocation: GeoPoint | null;
  isNightTheme: boolean;
  useNativeMapStyle?: boolean;
  onBoundsChanged: (bounds: MapBoundsLike) => void;
  onZoomChanged: (zoom: number) => void;
  onCenterChanged?: (center: GeoPoint) => void;
  onMarkerHover?: (
    marker: MapAdapterMarker | null,
    position: ScreenPoint | null,
  ) => void;
  popupAnchor?: GeoPoint | null;
  onPopupAnchorPosition?: (position: ScreenPoint | null) => void;
  drawingActive?: boolean;
  onAreaSelected?: (bounds: AreaBounds | null) => void;
  onMarkerTap: (marker: MapAdapterMarker) => void;
  onFatalError?: (message: string) => void;
  interactive?: boolean;
  showZoomControls?: boolean;
  zoomControlsPosition?: "top" | "below-header";
};

type GoogleMapsWindow = Window & {
  google?: any;
  __mealScoutGoogleMapsPromise?: Promise<void>;
  gm_authFailure?: () => void;
};

const createBoundsLike = (
  north: number,
  south: number,
  east: number,
  west: number,
): MapBoundsLike => ({
  north,
  south,
  east,
  west,
  contains: ([lat, lng]) => {
    const withinLat = lat <= north && lat >= south;
    const crossesDateLine = west > east;
    const withinLng = crossesDateLine
      ? lng >= west || lng <= east
      : lng >= west && lng <= east;
    return withinLat && withinLng;
  },
});

const latLngToContainerPixel = (
  googleMaps: any,
  map: any,
  point: GeoPoint,
): ScreenPoint | null => {
  const projection = map?.getProjection?.();
  const bounds = map?.getBounds?.();
  const zoom = Number(map?.getZoom?.() || 0);
  if (!projection || !bounds || !Number.isFinite(zoom)) return null;

  const latLng = new googleMaps.LatLng(point.lat, point.lng);
  const worldPoint = projection.fromLatLngToPoint(latLng);
  const ne = projection.fromLatLngToPoint(bounds.getNorthEast());
  const sw = projection.fromLatLngToPoint(bounds.getSouthWest());
  if (!worldPoint || !ne || !sw) return null;

  const scale = Math.pow(2, zoom);
  const x = (worldPoint.x - sw.x) * scale;
  const y = (worldPoint.y - ne.y) * scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const hasMeaningfulCenterDelta = (a: GeoPoint, b: GeoPoint) =>
  Math.abs(a.lat - b.lat) > 0.00001 || Math.abs(a.lng - b.lng) > 0.00001;

const refreshGoogleMapLayout = (googleMaps: any, map: any) => {
  if (!googleMaps || !map) return;
  const center = map.getCenter?.();
  googleMaps.event.trigger(map, "resize");
  if (center) map.setCenter(center);
};

const ensureGoogleMapConstructor = async (googleMaps: any) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (typeof googleMaps?.Map === "function") return googleMaps.Map;
    if (typeof googleMaps?.importLibrary === "function") {
      const mapsLibrary = await googleMaps.importLibrary("maps");
      if (typeof mapsLibrary?.Map === "function") return mapsLibrary.Map;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("Google Maps Map constructor unavailable");
};

/* ─── Google Maps style — MealScout scout plate ─────────────────────────────
   Keep the map readable and let the brand live in restrained color grading:
   dark field, warm labels, clear orange roads, no artificial line overlays.
   ────────────────────────────────────────────────────────────────────────── */
const mapStyleNeon = [
  { elementType: "geometry", stylers: [{ color: "#202225" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#c5a07c" }] },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#151719" }, { weight: 3 }],
  },

  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#49392f" }, { weight: 0.45 }],
  },
  {
    featureType: "administrative",
    elementType: "labels.text.fill",
    stylers: [{ color: "#a98466" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.province",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.neighborhood",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.land_parcel",
    stylers: [{ visibility: "off" }],
  },

  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#202326" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#232427" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#1d2522" }],
  },

  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#222421" }],
  },
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1f2b24" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },

  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "road",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bd8c67" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#151719" }, { weight: 2.6 }],
  },

  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#3d332e" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e57842" }, { weight: 1.75 }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.fill",
    stylers: [{ color: "#44342d" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.stroke",
    stylers: [{ color: "#f08a48" }, { weight: 1.95 }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#dfa06f" }],
  },

  {
    featureType: "road.arterial",
    elementType: "geometry.fill",
    stylers: [{ color: "#302b27" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry.stroke",
    stylers: [{ color: "#9d5638" }, { weight: 0.9 }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.fill",
    stylers: [{ color: "#b47c58" }],
  },

  {
    featureType: "road.local",
    elementType: "geometry.fill",
    stylers: [{ color: "#282827" }],
  },
  {
    featureType: "road.local",
    elementType: "geometry.stroke",
    stylers: [{ color: "#4a3d35" }, { weight: 0.35 }],
  },
  {
    featureType: "road.local",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },

  { featureType: "transit", stylers: [{ visibility: "off" }] },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#163039" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6992a0" }],
  },
];

const mapStyleFoodDay = [
  { elementType: "geometry", stylers: [{ color: "#fff4d6" }] },
  {
    elementType: "labels.icon",
    stylers: [{ saturation: -15 }, { lightness: 18 }],
  },
  { elementType: "labels.text.fill", stylers: [{ color: "#6f3b18" }] },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#fff8e8" }, { weight: 3 }],
  },

  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e5b779" }, { weight: 0.55 }],
  },
  {
    featureType: "administrative",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a5a28" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.province",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.land_parcel",
    stylers: [{ visibility: "off" }],
  },

  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#fff2cf" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#ffefd0" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#f4f2c7" }],
  },

  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#ffe8bf" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9a5a1f" }],
  },
  {
    featureType: "poi.business",
    elementType: "labels.icon",
    stylers: [{ visibility: "on" }, { saturation: -20 }, { lightness: 22 }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#dff0b5" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5f7a2d" }],
  },

  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "road",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a5a28" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#fff8e8" }, { weight: 2.8 }],
  },

  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#ffc66d" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#f97316" }, { weight: 1.15 }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.fill",
    stylers: [{ color: "#ffb85a" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.stroke",
    stylers: [{ color: "#ea580c" }, { weight: 1.35 }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#7c3b12" }],
  },

  {
    featureType: "road.arterial",
    elementType: "geometry.fill",
    stylers: [{ color: "#ffd98f" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry.stroke",
    stylers: [{ color: "#f59e0b" }, { weight: 0.55 }],
  },
  {
    featureType: "road.local",
    elementType: "geometry.fill",
    stylers: [{ color: "#fffaf0" }],
  },
  {
    featureType: "road.local",
    elementType: "geometry.stroke",
    stylers: [{ color: "#efd59d" }, { weight: 0.35 }],
  },
  {
    featureType: "road.local",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },

  { featureType: "transit", stylers: [{ visibility: "off" }] },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#a7e8f0" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#2f7484" }],
  },
];

/* ─── Marker colors ─────────────────────────────────────────────────────── */
const markerColor = (marker: MapAdapterMarker): string => {
  if (marker.color) return marker.color;
  switch (marker.kind) {
    case "user":
      return "#3b82f6"; // blue
    case "truck":
      return "#f97316"; // amber-orange
    case "restaurant":
      return "#fbbf24"; // amber-yellow (distinct from truck)
    case "parking":
      return "#f59e0b"; // host amber
    case "event":
      return "#d946ef"; // fuchsia
    case "deal":
      return "#22c55e"; // green
    case "geo_ad":
      return "#eab308"; // yellow
    default:
      return "#f97316";
  }
};

const markerGlyph = (marker: MapAdapterMarker): string => {
  switch (marker.kind) {
    case "truck":
      return "T";
    case "restaurant":
      return "F";
    case "parking":
      return "H";
    case "event":
      return "E";
    case "deal":
      return "$";
    case "user":
      return "";
    default:
      return "•";
  }
};

const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

/* ─── Glowing SVG dot marker (AdvancedMarker content) ───────────────────── */
const buildGlowDotElement = (
  marker: MapAdapterMarker,
  selected = false,
): HTMLElement => {
  if (marker.kind === "parking") {
    const wrapper = document.createElement("div");
    wrapper.className = selected
      ? "ms-google-marker ms-google-marker--selected"
      : "ms-google-marker";
    wrapper.style.cssText =
      `position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;${
        selected
          ? "transform:translateY(-5px) scale(1.22);filter:drop-shadow(0 0 8px rgba(255,255,255,.95)) drop-shadow(0 0 18px rgba(249,115,22,.8));outline:3px solid #fff7ed;outline-offset:4px;border-radius:999px;"
          : ""
      }`;
    const img = document.createElement("img");
    img.src = mealScoutIcon;
    img.alt = marker.title || "Host location";
    img.width = 34;
    img.height = 34;
    img.style.cssText =
      "width:34px;height:34px;display:block;filter:drop-shadow(0 8px 16px rgba(0,0,0,0.38));";
    wrapper.appendChild(img);
    if ((marker.parkedTrucks?.length || 0) > 0) {
      const badge = document.createElement("span");
      badge.textContent = "T";
      badge.style.cssText = [
        "position:absolute",
        "right:-2px",
        "top:-2px",
        "width:17px",
        "height:17px",
        "border-radius:999px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:#fb923c",
        "color:#1b0b02",
        "font:900 10px/1 Arial,sans-serif",
        "border:2px solid #fff7ed",
        "box-shadow:0 4px 12px rgba(0,0,0,0.35)",
      ].join(";");
      wrapper.appendChild(badge);
    }
    return wrapper;
  }

  const color = markerColor(marker);
  const isUser = marker.kind === "user";
  const outerSize = isUser ? 36 : 30;
  const dotSize = isUser ? 14 : 11;
  const glowSpread = isUser ? 14 : 10;

  const wrapper = document.createElement("div");
  wrapper.className = selected
    ? "ms-google-marker ms-google-marker--selected"
    : "ms-google-marker";
  wrapper.style.cssText = `
    position:relative;
    width:${outerSize}px;
    height:${outerSize}px;
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    ${
      selected
        ? "transform:translateY(-5px) scale(1.28);filter:drop-shadow(0 0 8px rgba(255,255,255,.95));outline:3px solid #fff7ed;outline-offset:3px;border-radius:999px;"
        : ""
    }
  `;

  // Pulse ring (CSS animation via injected keyframes)
  const ring = document.createElement("div");
  ring.style.cssText = `
    position:absolute;
    inset:0;
    border-radius:50%;
    border:1.5px solid ${color};
    opacity:0.5;
    animation:msPulse 2.2s ease-out infinite;
  `;

  // Glow halo
  const halo = document.createElement("div");
  halo.style.cssText = `
    position:absolute;
    width:${dotSize + glowSpread}px;
    height:${dotSize + glowSpread}px;
    border-radius:50%;
    background:${color};
    opacity:0.18;
    filter:blur(${Math.round(glowSpread * 0.7)}px);
  `;

  // Core dot
  const dot = document.createElement("div");
  dot.style.cssText = `
    position:relative;
    width:${dotSize}px;
    height:${dotSize}px;
    border-radius:50%;
    background:${color};
    box-shadow:0 0 ${glowSpread}px ${Math.round(glowSpread * 0.6)}px ${color}80;
    border:1.5px solid rgba(255,255,255,0.35);
  `;

  wrapper.appendChild(ring);
  wrapper.appendChild(halo);
  wrapper.appendChild(dot);

  // Inject keyframes once
  if (!document.getElementById("ms-marker-keyframes")) {
    const style = document.createElement("style");
    style.id = "ms-marker-keyframes";
    style.textContent = `
      @keyframes msPulse {
        0%   { transform:scale(0.5); opacity:0.6; }
        70%  { transform:scale(1.8); opacity:0; }
        100% { transform:scale(0.5); opacity:0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ms-google-marker, .ms-google-marker * {
          animation: none !important;
          transition: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  return wrapper;
};

const removeMarkerFromMap = (instance: any) => {
  if (!instance) return;
  if (typeof instance.setMap === "function") {
    instance.setMap(null);
    return;
  }
  if ("map" in instance) {
    instance.map = null;
  }
};

/* ─── Script loader ─────────────────────────────────────────────────────── */
export const loadGoogleMaps = async (apiKey: string) => {
  if (!apiKey) throw new Error("Missing Google Maps API key");
  const w = window as GoogleMapsWindow;
  if (w.google?.maps) return;
  if (w.__mealScoutGoogleMapsPromise) {
    try {
      await w.__mealScoutGoogleMapsPromise;
      if (w.google?.maps) return;
    } catch {
      w.__mealScoutGoogleMapsPromise = undefined;
    }
  }

  w.__mealScoutGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mealscout-google-maps="1"]',
    );
    if (existing) {
      if ((window as GoogleMapsWindow).google?.maps) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          existing.remove();
          reject(new Error("Failed to load Google Maps script"));
        },
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.dataset.mealscoutGoogleMaps = "1";
    script.onload = () => {
      if ((window as GoogleMapsWindow).google?.maps) {
        resolve();
      } else {
        script.remove();
        reject(new Error("Google Maps API unavailable after script load"));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });

  try {
    await w.__mealScoutGoogleMapsPromise;
  } catch (error) {
    w.__mealScoutGoogleMapsPromise = undefined;
    throw error;
  }
};

export const preloadGoogleMapsScript = (apiKey: string) => {
  if (!apiKey) return;
  void loadGoogleMaps(apiKey).catch(() => {
    // Prefetch is opportunistic. The mounted interactive map will surface
    // any real load/auth failures through its normal fallback path.
  });
};

/* ─── Component ─────────────────────────────────────────────────────────── */
export function GoogleMapSurface({
  apiKey,
  mapId,
  center,
  zoom,
  markers,
  selectedMarkerId = null,
  trafficCells = [],
  showRoadTrafficLayer = false,
  userLocation,
  isNightTheme,
  useNativeMapStyle = false,
  onBoundsChanged,
  onZoomChanged,
  onCenterChanged,
  onMarkerHover,
  popupAnchor,
  onPopupAnchorPosition,
  onMarkerTap,
  onFatalError,
  interactive = true,
  showZoomControls = true,
  zoomControlsPosition = "top",
}: GoogleMapSurfaceProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const markerRefs = useRef<Map<string, any>>(new Map());
  const markerSignatureRefs = useRef<Map<string, string>>(new Map());
  const trafficCircleRefs = useRef<Map<string, any>>(new Map());
  const roadTrafficLayerRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  const [mapVisualReady, setMapVisualReady] = useState(false);
  const hasReportedFatalErrorRef = useRef(false);
  const onWindowResizeRef = useRef<(() => void) | null>(null);
  const idleListenerRef = useRef<any>(null);
  const tilesLoadedListenerRef = useRef<any>(null);
  const layoutTimeoutIdsRef = useRef<number[]>([]);
  const onBoundsChangedRef = useRef(onBoundsChanged);
  const onZoomChangedRef = useRef(onZoomChanged);
  const onCenterChangedRef = useRef(onCenterChanged);
  const onMarkerTapRef = useRef(onMarkerTap);
  const onMarkerHoverRef = useRef(onMarkerHover);
  const onPopupAnchorPositionRef = useRef(onPopupAnchorPosition);
  const onFatalErrorRef = useRef(onFatalError);
  const popupAnchorRef = useRef<GeoPoint | null>(popupAnchor || null);
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);

  const renderedMarkers = useMemo<MapAdapterMarker[]>(() => {
    if (!userLocation) return markers;
    return [
      {
        id: "__user-location",
        sourceId: "__user-location",
        kind: "user",
        lat: userLocation.lat,
        lng: userLocation.lng,
        title: "You are here",
        subtitle: "Your current location",
      },
      ...markers.filter((marker) => marker.id !== "__user-location"),
    ];
  }, [markers, userLocation?.lat, userLocation?.lng]);

  const markerIndex = useMemo(
    () => new Map(renderedMarkers.map((m) => [m.id, m])),
    [renderedMarkers],
  );

  useEffect(() => {
    onBoundsChangedRef.current = onBoundsChanged;
    onZoomChangedRef.current = onZoomChanged;
    onCenterChangedRef.current = onCenterChanged;
    onMarkerTapRef.current = onMarkerTap;
    onMarkerHoverRef.current = onMarkerHover;
    onPopupAnchorPositionRef.current = onPopupAnchorPosition;
    onFatalErrorRef.current = onFatalError;
    popupAnchorRef.current = popupAnchor || null;
    centerRef.current = center;
    zoomRef.current = zoom;
  }, [
    onBoundsChanged,
    onZoomChanged,
    onCenterChanged,
    onMarkerTap,
    onMarkerHover,
    onPopupAnchorPosition,
    onFatalError,
    popupAnchor,
    center,
    zoom,
  ]);

  useEffect(() => {
    hasReportedFatalErrorRef.current = false;
  }, [apiKey]);

  // Auth failure handler
  useEffect(() => {
    const w = window as GoogleMapsWindow;
    const prev = w.gm_authFailure;
    const handler = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {}
      }
      const msg =
        "Google Maps authorization failed for this domain. Falling back to legacy map.";
      setLoadError(msg);
      if (!hasReportedFatalErrorRef.current) {
        hasReportedFatalErrorRef.current = true;
        onFatalErrorRef.current?.(msg);
      }
    };
    w.gm_authFailure = handler;
    return () => {
      if (w.gm_authFailure === handler) w.gm_authFailure = prev;
    };
  }, []);

  // Map init
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (!mounted || !mapContainerRef.current) return;
        const googleMaps = (window as GoogleMapsWindow).google?.maps;
        if (!googleMaps) throw new Error("Google Maps not available");
        const GoogleMapConstructor =
          await ensureGoogleMapConstructor(googleMaps);

        if (!mapRef.current) {
          setMapVisualReady(false);
          const prefersFinePointer =
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(pointer: fine)").matches;

          const mapOptions: any = {
            center: centerRef.current,
            zoom: zoomRef.current,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: interactive,
            tilt: isNightTheme && !useNativeMapStyle ? 25 : 0,
            heading: isNightTheme && !useNativeMapStyle ? 8 : 0,
            draggable: interactive,
            keyboardShortcuts: interactive,
            scrollwheel: interactive,
            disableDoubleClickZoom: !interactive,
            gestureHandling: interactive
              ? prefersFinePointer
                ? "greedy"
                : "cooperative"
              : "none",
          };
          const configuredMapId = String(mapId || "").trim();
          if (configuredMapId) {
            // AdvancedMarkerElement requires a map ID. A map ID also owns its
            // cloud style, so legacy JSON styles must not be supplied.
            mapOptions.mapId = configuredMapId;
            mapOptions.mapTypeId = "roadmap";
          } else if (useNativeMapStyle) {
            mapOptions.mapTypeId = "roadmap";
            mapOptions.styles = null;
          } else if (isNightTheme) {
            mapOptions.mapTypeId = "roadmap";
            mapOptions.styles = mapStyleNeon;
          } else {
            mapOptions.mapTypeId = "roadmap";
            mapOptions.styles = mapStyleFoodDay;
          }

          mapRef.current = new GoogleMapConstructor(
            mapContainerRef.current,
            mapOptions,
          );

          const emitViewportState = () => {
            const map = mapRef.current;
            if (!map) return;
            const bounds = map.getBounds?.();
            const z = Number(map.getZoom?.() || 0);
            if (Number.isFinite(z) && z > 0) {
              onZoomChangedRef.current?.(z);
            }
            const c = map.getCenter?.();
            if (c && onCenterChangedRef.current) {
              onCenterChangedRef.current({
                lat: Number(c.lat()),
                lng: Number(c.lng()),
              });
            }
            if (bounds && onBoundsChangedRef.current) {
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              onBoundsChangedRef.current(
                createBoundsLike(
                  Number(ne.lat()),
                  Number(sw.lat()),
                  Number(ne.lng()),
                  Number(sw.lng()),
                ),
              );
            }
            if (popupAnchorRef.current && onPopupAnchorPositionRef.current) {
              onPopupAnchorPositionRef.current(
                latLngToContainerPixel(googleMaps, map, popupAnchorRef.current),
              );
            } else if (onPopupAnchorPositionRef.current) {
              onPopupAnchorPositionRef.current(null);
            }
          };

          idleListenerRef.current?.remove?.();
          idleListenerRef.current = mapRef.current.addListener(
            "idle",
            emitViewportState,
          );
          tilesLoadedListenerRef.current?.remove?.();
          tilesLoadedListenerRef.current = mapRef.current.addListener(
            "tilesloaded",
            () => {
              if (mounted) setMapVisualReady(true);
              tilesLoadedListenerRef.current?.remove?.();
              tilesLoadedListenerRef.current = null;
            },
          );

          // Trigger resize whenever the container changes size (e.g. on
          // first pull-down expand). Without this the map renders blank
          // until the user interacts because it was initialized in a
          // zero-height or hidden container.
          if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
          }
          resizeObserverRef.current = new ResizeObserver(() => {
            const map = mapRef.current;
            if (!map) return;
            refreshGoogleMapLayout(googleMaps, map);
          });
          if (mapContainerRef.current) {
            resizeObserverRef.current.observe(mapContainerRef.current);
          }

          // Also listen to window resize so the post-transition dispatch
          // from Scout (fired 340ms after pull-down) triggers a
          // full re-tile at the correct 100dvh dimensions.
          onWindowResizeRef.current = () => {
            const map = mapRef.current;
            if (map) {
              refreshGoogleMapLayout(googleMaps, map);
            }
          };
          window.addEventListener("resize", onWindowResizeRef.current);

          setMapReadyVersion((v) => v + 1);
          layoutTimeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
          layoutTimeoutIdsRef.current = [0, 80, 240, 520].map((delay) =>
            window.setTimeout(() => {
              const map = mapRef.current;
              if (map) refreshGoogleMapLayout(googleMaps, map);
            }, delay),
          );
        } else {
          if (mapId) {
            // mapId is immutable after construction; retain its cloud style.
          } else if (useNativeMapStyle) {
            mapRef.current.setOptions({
              mapId: undefined,
              styles: null,
              mapTypeId: "roadmap",
              tilt: 0,
              heading: 0,
            });
          } else if (isNightTheme) {
            mapRef.current.setOptions({
              mapId: undefined,
              styles: mapStyleNeon,
              mapTypeId: "roadmap",
              tilt: 25,
              heading: 8,
            });
          } else {
            mapRef.current.setOptions({
              mapId: undefined,
              mapTypeId: "roadmap",
              styles: mapStyleFoodDay,
              tilt: 0,
              heading: 0,
            });
          }
          mapRef.current.setOptions({
            clickableIcons: interactive,
            draggable: interactive,
            keyboardShortcuts: interactive,
            scrollwheel: interactive,
            disableDoubleClickZoom: !interactive,
            gestureHandling: interactive
              ? typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(pointer: fine)").matches
                ? "greedy"
                : "cooperative"
              : "none",
          });
        }

        setLoadError(null);
      } catch (error: any) {
        if (!mounted) return;
        const msg =
          error?.message ||
          "Unable to load Google Maps. Falling back to legacy map.";
        setLoadError(msg);
        if (!hasReportedFatalErrorRef.current) {
          hasReportedFatalErrorRef.current = true;
          onFatalErrorRef.current?.(msg);
        }
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [apiKey, mapId, isNightTheme, interactive, useNativeMapStyle]);

  useEffect(() => {
    if (!mapRef.current) return;
    const current = mapRef.current.getCenter?.();
    if (!current) {
      mapRef.current.setCenter(center);
      return;
    }
    const currentLat = Number(current.lat?.() ?? current.lat);
    const currentLng = Number(current.lng?.() ?? current.lng);
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng)) {
      mapRef.current.setCenter(center);
      return;
    }
    if (
      hasMeaningfulCenterDelta({ lat: currentLat, lng: currentLng }, center)
    ) {
      mapRef.current.setCenter(center);
    }
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!mapRef.current) return;
    const cur = Number(mapRef.current.getZoom?.() || 0);
    if (!Number.isFinite(cur) || cur !== zoom) mapRef.current.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (
      !googleMaps ||
      !mapRef.current ||
      !popupAnchor ||
      !onPopupAnchorPositionRef.current
    ) {
      if (!popupAnchor) onPopupAnchorPositionRef.current?.(null);
      return;
    }
    onPopupAnchorPositionRef.current(
      latLngToContainerPixel(googleMaps, mapRef.current, popupAnchor),
    );
  }, [popupAnchor?.lat, popupAnchor?.lng, mapReadyVersion]);

  // Marker sync
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    const AdvancedMarkerElement = googleMaps.marker?.AdvancedMarkerElement;
    const markerRenderer = resolveGoogleMarkerRenderer({
      mapId,
      AdvancedMarkerElement,
    });
    const useAdvanced = markerRenderer === "advanced";
    const failMarkerRuntime = (detail?: string) => {
      const msg = detail
        ? `Google Maps marker rendering failed (${detail}). Falling back to the local map.`
        : "Google Maps loaded without a supported marker renderer. Falling back to the local map.";
      setLoadError(msg);
      if (!hasReportedFatalErrorRef.current) {
        hasReportedFatalErrorRef.current = true;
        onFatalErrorRef.current?.(msg);
      }
    };
    if (markerRenderer === "unavailable" && renderedMarkers.length > 0) {
      failMarkerRuntime();
      return;
    }
    const usedIds = new Set<string>();
    let markerRuntimeFailed = false;

    renderedMarkers.forEach((marker) => {
      if (markerRuntimeFailed) return;
      usedIds.add(marker.id);
      const existing = markerRefs.current.get(marker.id);
      const isSelected = marker.id === selectedMarkerId;
      const signature = [
        marker.kind,
        marker.lat.toFixed(6),
        marker.lng.toFixed(6),
        marker.color || "",
        marker.title || "",
        marker.subtitle || "",
        marker.parkingStatus || "",
        isSelected ? "selected" : "idle",
        (marker.parkedTrucks || [])
          .map((truck) => `${truck.id || ""}:${truck.name}`)
          .join(","),
      ].join("|");

      if (existing) {
        if (markerSignatureRefs.current.get(marker.id) === signature) {
          return;
        }
        // Update position
        if (typeof existing.setPosition === "function") {
          existing.setPosition({ lat: marker.lat, lng: marker.lng });
        } else {
          existing.position = { lat: marker.lat, lng: marker.lng };
        }
        // Update icon
        if (useAdvanced && "content" in existing) {
          existing.content = buildGlowDotElement(marker, isSelected);
          existing.zIndex = isSelected ? 1000 : undefined;
        }
        markerSignatureRefs.current.set(marker.id, signature);
        return;
      }

      let instance: any | null = null;
      try {
        instance = createGoogleMarkerInstance({
          renderer: markerRenderer,
          AdvancedMarkerElement,
          advancedOptions: {
            map: mapRef.current,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title || marker.subtitle || marker.kind,
            content: buildGlowDotElement(marker, isSelected),
            gmpClickable: interactive && marker.id !== "__user-location",
            zIndex: isSelected ? 1000 : undefined,
          },
        });
      } catch (error) {
        markerRuntimeFailed = true;
        failMarkerRuntime(
          error instanceof Error ? error.message : "constructor unavailable",
        );
        return;
      }
      if (!instance) return;

      if (typeof instance.addEventListener === "function") {
        instance.addEventListener("gmp-click", () => {
          if (!interactive) return;
          if (marker.id === "__user-location") return;
          const tapped = markerIndex.get(marker.id);
          if (tapped) onMarkerTapRef.current?.(tapped);
        });
      } else {
        instance.addListener("click", () => {
          if (!interactive) return;
          if (marker.id === "__user-location") return;
          const tapped = markerIndex.get(marker.id);
          if (tapped) onMarkerTapRef.current?.(tapped);
        });
        instance.addListener("mouseover", (event: any) => {
          if (!interactive) return;
          const hovered = markerIndex.get(marker.id);
          if (!hovered || !onMarkerHoverRef.current) return;
          const latLng = event?.latLng;
          if (!latLng) return;
          const position = latLngToContainerPixel(googleMaps, mapRef.current, {
            lat: Number(latLng.lat()),
            lng: Number(latLng.lng()),
          });
          onMarkerHoverRef.current(hovered, position);
        });
        instance.addListener("mouseout", () => {
          if (!interactive) return;
          onMarkerHoverRef.current?.(null, null);
        });
      }
      markerRefs.current.set(marker.id, instance);
      markerSignatureRefs.current.set(marker.id, signature);
    });

    Array.from(markerRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      removeMarkerFromMap(instance);
      markerRefs.current.delete(id);
      markerSignatureRefs.current.delete(id);
    });
  }, [
    renderedMarkers,
    markerIndex,
    mapReadyVersion,
    interactive,
    selectedMarkerId,
    mapId,
  ]);

  // Traffic cells
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    const trafficCellColor = (source: MapTrafficCell["source"]) =>
      source === "google_places"
        ? "#60a5fa"
        : source === "supply_signal"
          ? "#ef4444"
          : "#f97316";

    const usedIds = new Set<string>();
    trafficCells.forEach((cell) => {
      usedIds.add(cell.id);
      const existing = trafficCircleRefs.current.get(cell.id);
      const radius = Math.max(140, Math.min(1800, (cell.weight || 1) * 15));
      const style = {
        clickable: false,
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: trafficCellColor(cell.source),
        fillOpacity:
          cell.source === "google_places"
            ? 0.14
            : cell.source === "supply_signal"
              ? 0.22
              : 0.18,
      };
      if (existing) {
        existing.setCenter({ lat: cell.lat, lng: cell.lng });
        existing.setRadius(radius);
        existing.setOptions(style);
        return;
      }
      const circle = new googleMaps.Circle({
        map: mapRef.current,
        center: { lat: cell.lat, lng: cell.lng },
        radius,
        ...style,
      });
      trafficCircleRefs.current.set(cell.id, circle);
    });

    Array.from(trafficCircleRefs.current.entries()).forEach(
      ([id, instance]) => {
        if (usedIds.has(id)) return;
        instance.setMap(null);
        trafficCircleRefs.current.delete(id);
      },
    );
  }, [trafficCells, mapReadyVersion]);

  // Road traffic layer
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;
    if (!showRoadTrafficLayer) {
      if (roadTrafficLayerRef.current) {
        roadTrafficLayerRef.current.setMap(null);
        roadTrafficLayerRef.current = null;
      }
      return;
    }
    if (!roadTrafficLayerRef.current)
      roadTrafficLayerRef.current = new googleMaps.TrafficLayer();
    roadTrafficLayerRef.current.setMap(mapRef.current);
  }, [showRoadTrafficLayer, mapReadyVersion]);

  // Cleanup
  useEffect(() => {
    return () => {
      const googleMaps = (window as GoogleMapsWindow).google?.maps;
      layoutTimeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      layoutTimeoutIdsRef.current = [];
      idleListenerRef.current?.remove?.();
      idleListenerRef.current = null;
      tilesLoadedListenerRef.current?.remove?.();
      tilesLoadedListenerRef.current = null;
      Array.from(markerRefs.current.values()).forEach((instance) => {
        googleMaps?.event?.clearInstanceListeners?.(instance);
        removeMarkerFromMap(instance);
      });
      markerRefs.current.clear();
      Array.from(trafficCircleRefs.current.values()).forEach((i) =>
        i.setMap(null),
      );
      trafficCircleRefs.current.clear();
      markerSignatureRefs.current.clear();
      onMarkerHoverRef.current?.(null, null);
      onPopupAnchorPositionRef.current?.(null);
      if (roadTrafficLayerRef.current) {
        roadTrafficLayerRef.current.setMap(null);
        roadTrafficLayerRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (onWindowResizeRef.current) {
        window.removeEventListener("resize", onWindowResizeRef.current);
        onWindowResizeRef.current = null;
      }
      const map = mapRef.current;
      if (map) googleMaps?.event?.clearInstanceListeners?.(map);
      mapRef.current = null;
    };
  }, []);

  const btnClass = isNightTheme
    ? "h-11 w-11 rounded-full border border-orange-200/35 bg-[#120805]/85 p-0 text-orange-200 shadow-lg backdrop-blur transition-colors hover:bg-[#1f0d06]"
    : "h-11 w-11 rounded-full border border-orange-200/70 bg-white/90 p-0 text-orange-700 shadow-lg backdrop-blur transition-colors hover:bg-orange-50";

  const adjustZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;

    const currentZoom = Number(map.getZoom?.() ?? zoom);
    const nextZoom = Math.max(1, Math.min(21, Math.round(currentZoom + delta)));
    const currentCenter = map.getCenter?.();
    const camera: Record<string, unknown> = { zoom: nextZoom };

    if (currentCenter) camera.center = currentCenter;
    if (isNightTheme && !useNativeMapStyle) {
      camera.tilt = 25;
      camera.heading = 8;
    }

    if (typeof map.moveCamera === "function") {
      map.moveCamera(camera);
    } else {
      if (currentCenter) map.setCenter?.(currentCenter);
      map.setZoom?.(nextZoom);
      if (currentCenter) {
        window.requestAnimationFrame(() => map.setCenter?.(currentCenter));
      }
    }

    onZoomChangedRef.current?.(nextZoom);
  };

  return (
    <div
      className={`relative h-full w-full ${
        isNightTheme ? "bg-[#17110d]" : "bg-[#f7ead0]"
      }`}
    >
      <div className="h-full w-full">
        <div
          ref={mapContainerRef}
          className={`ms-google-map-canvas h-full w-full overflow-hidden transition-opacity duration-300 ${
            mapVisualReady ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      {!mapVisualReady && !loadError ? (
        <div
          className={`pointer-events-none absolute inset-0 z-[2] overflow-hidden ${
            isNightTheme ? "bg-[#17110d]" : "bg-[#f7ead0]"
          }`}
          data-google-map-loading="true"
          role="status"
          aria-label="Loading map"
        >
          <div
            className={`absolute -left-10 top-[30%] h-2 w-[72%] -rotate-6 rounded-full ${
              isNightTheme ? "bg-white/10" : "bg-white/80"
            }`}
          />
          <div
            className={`absolute -right-16 top-[58%] h-2 w-[78%] rotate-12 rounded-full ${
              isNightTheme ? "bg-white/10" : "bg-white/75"
            }`}
          />
          <div
            className={`absolute left-[34%] -top-12 h-[82%] w-2 rotate-[24deg] rounded-full ${
              isNightTheme ? "bg-white/10" : "bg-white/70"
            }`}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_25%,rgba(255,185,94,0.28),transparent_32%),radial-gradient(circle_at_20%_78%,rgba(103,190,151,0.22),transparent_30%)]" />
          <div
            className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full px-3 py-2 text-xs font-black shadow-sm ring-1 ${
              isNightTheme
                ? "bg-[#211710]/92 text-orange-50 ring-white/12"
                : "bg-white/90 text-[#4a2917] ring-orange-200/70"
            }`}
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
            Loading map
          </div>
        </div>
      ) : null}

      {/* Cinematic grade over the live map; no bitmap overlay, map stays interactive. */}
      {isNightTheme && !useNativeMapStyle && (
        <>
          <div aria-hidden="true" className="ms-google-map-grade" />
          <style>{`
            .ms-google-map-canvas .gm-style > div:first-child {
              filter: saturate(1.04) contrast(1.04) brightness(1.08) sepia(0.04) hue-rotate(-3deg);
            }
            .ms-google-map-canvas .gm-style-cc,
            .ms-google-map-canvas a[href^="https://maps.google.com/maps"] {
              opacity: 0.28;
            }
            .ms-google-map-grade {
              position: absolute;
              inset: 0;
              pointer-events: none;
              z-index: 1;
              mix-blend-mode: normal;
              background:
                linear-gradient(90deg, rgba(26, 9, 3, 0.08), rgba(3, 9, 8, 0.01) 38%, rgba(26, 9, 3, 0.06)),
                radial-gradient(circle at 58% 47%, rgba(255, 112, 58, 0.04), transparent 25%),
                radial-gradient(circle at 76% 18%, rgba(255, 168, 86, 0.025), transparent 27%),
                radial-gradient(circle at 12% 72%, rgba(255, 132, 64, 0.025), transparent 26%);
              background-size:
                100% 100%,
                100% 100%,
                100% 100%,
                100% 100%;
              opacity: 0.2;
            }
            .ms-google-map-grade::after {
              content: "";
              position: absolute;
              inset: 0;
              background:
                radial-gradient(ellipse at 50% 46%, transparent 0%, rgba(0, 0, 0, 0) 62%, rgba(0, 0, 0, 0.14) 100%),
                linear-gradient(180deg, rgba(9, 4, 2, 0.03) 0%, rgba(3, 4, 5, 0) 44%, rgba(3, 4, 5, 0.08) 100%);
              mix-blend-mode: normal;
            }
          `}</style>
        </>
      )}

      {interactive && showZoomControls && (
        <div
          className={`absolute right-5 flex flex-col gap-2 z-[1000] ${
            zoomControlsPosition === "below-header" ? "top-20" : "top-5"
          }`}
        >
          <Button
            variant="secondary"
            size="sm"
            className={btnClass}
            onClick={() => adjustZoom(1)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <span className="text-lg font-bold leading-none">+</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={btnClass}
            onClick={() => adjustZoom(-1)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <span className="text-lg font-bold leading-none">-</span>
          </Button>
        </div>
      )}

      {loadError && (
        <div className="absolute left-3 right-3 bottom-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {loadError}
        </div>
      )}
    </div>
  );
}
