import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  MapAdapterMarker,
  MapBoundsLike,
  MapTrafficCell,
} from "./map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";

type GeoPoint = { lat: number; lng: number };
type ScreenPoint = { x: number; y: number };
type AreaBounds = { north: number; south: number; east: number; west: number };

type GoogleMapSurfaceProps = {
  apiKey: string;
  mapId?: string;
  center: GeoPoint;
  zoom: number;
  markers: MapAdapterMarker[];
  trafficCells?: MapTrafficCell[];
  showRoadTrafficLayer?: boolean;
  userLocation: GeoPoint | null;
  isNightTheme: boolean;
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
   The actual Google map gets pushed toward a dark aerial plate: muted land,
   low-label density, ember roads, and no default bright map personality.
   ────────────────────────────────────────────────────────────────────────── */
const mapStyleNeon = [
  { elementType: "geometry", stylers: [{ color: "#101a12" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#c19165" }, { lightness: -4 }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#07100a" }, { weight: 3.1 }] },

  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#684024" }, { weight: 0.55 }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#a97852" }] },
  { featureType: "administrative.country", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.province", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },

  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#101b12" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#141811" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#132314" }] },

  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#11160f" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#142815" }] },
  { featureType: "poi.park", elementType: "labels", stylers: [{ visibility: "off" }] },

  { featureType: "road", elementType: "geometry", stylers: [{ visibility: "simplified" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9f6845" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#050504" }, { weight: 2.8 }] },

  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#79301a" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#ff7045" }, { weight: 2.45 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.fill", stylers: [{ color: "#87351c" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: "#ff8752" }, { weight: 2.75 }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#dda071" }] },

  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#352018" }] },
  { featureType: "road.arterial", elementType: "geometry.stroke", stylers: [{ color: "#b8562d" }, { weight: 1.2 }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#b47c58" }] },

  { featureType: "road.local", elementType: "geometry.fill", stylers: [{ color: "#18140f" }] },
  { featureType: "road.local", elementType: "geometry.stroke", stylers: [{ color: "#513120" }, { weight: 0.45 }] },
  { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },

  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#092432" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4f8192" }] },
];

/* ─── Marker colors ─────────────────────────────────────────────────────── */
const markerColor = (marker: MapAdapterMarker): string => {
  if (marker.color) return marker.color;
  switch (marker.kind) {
    case "user":       return "#3b82f6"; // blue
    case "truck":      return "#f97316"; // amber-orange
    case "restaurant": return "#fbbf24"; // amber-yellow (distinct from truck)
    case "parking":    return "#0ea5e9"; // sky
    case "event":      return "#d946ef"; // fuchsia
    case "deal":       return "#22c55e"; // green
    case "geo_ad":     return "#eab308"; // yellow
    default:           return "#f97316";
  }
};

const markerGlyph = (marker: MapAdapterMarker): string => {
  switch (marker.kind) {
    case "truck": return "T";
    case "restaurant": return "F";
    case "parking": return "P";
    case "event": return "E";
    case "deal": return "$";
    case "user": return "";
    default: return "•";
  }
};

const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

/* ─── Glowing SVG dot marker (AdvancedMarker content) ───────────────────── */
const buildGlowDotElement = (marker: MapAdapterMarker): HTMLElement => {
  if (marker.kind === "parking") {
    const img = document.createElement("img");
    img.src = mealScoutIcon;
    img.alt = marker.title || "Parking";
    img.width = 34;
    img.height = 34;
    img.style.cssText = "width:34px;height:34px;display:block;";
    return img;
  }

  const color = markerColor(marker);
  const isUser = marker.kind === "user";
  const outerSize = isUser ? 36 : 30;
  const dotSize = isUser ? 14 : 11;
  const glowSpread = isUser ? 14 : 10;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position:relative;
    width:${outerSize}px;
    height:${outerSize}px;
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
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
    `;
    document.head.appendChild(style);
  }

  return wrapper;
};

/* ─── Legacy Marker icon (fallback when no Map ID) ──────────────────────── */
const buildLegacyIcon = (googleMaps: any, marker: MapAdapterMarker) => {
  const color = markerColor(marker);
  if (marker.kind !== "user") {
    const glyph = markerGlyph(marker);
    const svg = `
      <svg width="54" height="66" viewBox="0 0 54 66" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 1 0 0.38 0 0 0.32 0 0 0.08 0 0 0 0 0.75 0"/>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <ellipse cx="27" cy="59" rx="12" ry="4" fill="#000" opacity="0.42"/>
        <path filter="url(#glow)" d="M27 3C15.4 3 6 12.4 6 24c0 15.8 21 38 21 38s21-22.2 21-38C48 12.4 38.6 3 27 3z" fill="${color}" stroke="#ffd08a" stroke-width="2"/>
        <circle cx="27" cy="24" r="13" fill="#1b0d05" opacity="0.9" stroke="#fff3d6" stroke-width="1.5"/>
        <text x="27" y="29" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="900" fill="#fff3d6">${glyph}</text>
      </svg>
    `;
    return {
      url: svgDataUrl(svg),
      scaledSize: new googleMaps.Size(42, 52),
      anchor: new googleMaps.Point(21, 52),
    };
  }
  return {
    path: googleMaps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: color,
    fillOpacity: 0.95,
    strokeColor: "#dbeafe",
    strokeWeight: 3,
  };
};

const removeMarkerFromMap = (instance: any) => {
  if (!instance) return;
  if (typeof instance.setMap === "function") { instance.setMap(null); return; }
  if ("map" in instance) { instance.map = null; }
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
      if ((window as GoogleMapsWindow).google?.maps) { resolve(); return; }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => { existing.remove(); reject(new Error("Failed to load Google Maps script")); }, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.dataset.mealscoutGoogleMaps = "1";
    script.onload = () => {
      if ((window as GoogleMapsWindow).google?.maps) { resolve(); }
      else { script.remove(); reject(new Error("Google Maps API unavailable after script load")); }
    };
    script.onerror = () => { script.remove(); reject(new Error("Failed to load Google Maps script")); };
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
  trafficCells = [],
  showRoadTrafficLayer = false,
  userLocation,
  isNightTheme,
  onBoundsChanged,
  onZoomChanged,
  onCenterChanged,
  onMarkerHover,
  popupAnchor,
  onPopupAnchorPosition,
  onMarkerTap,
  onFatalError,
  interactive = true,
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
  const hasReportedFatalErrorRef = useRef(false);
  const onWindowResizeRef = useRef<(() => void) | null>(null);
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

  useEffect(() => { hasReportedFatalErrorRef.current = false; }, [apiKey]);

  // Auth failure handler
  useEffect(() => {
    const w = window as GoogleMapsWindow;
    const prev = w.gm_authFailure;
    const handler = () => {
      if (typeof prev === "function") { try { prev(); } catch {} }
      const msg = "Google Maps authorization failed for this domain. Falling back to legacy map.";
      setLoadError(msg);
      if (!hasReportedFatalErrorRef.current) {
        hasReportedFatalErrorRef.current = true;
        onFatalErrorRef.current?.(msg);
      }
    };
    w.gm_authFailure = handler;
    return () => { if (w.gm_authFailure === handler) w.gm_authFailure = prev; };
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
        const GoogleMapConstructor = await ensureGoogleMapConstructor(googleMaps);

        if (!mapRef.current) {
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
            tilt: isNightTheme ? 45 : 0,
            heading: isNightTheme ? 18 : 0,
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
          const runtimeMapId = String(mapId || "").trim();
          if (isNightTheme) {
            mapOptions.mapTypeId = "satellite";
          } else if (runtimeMapId) {
            mapOptions.mapId = runtimeMapId;
          } else {
            mapOptions.styles = mapStyleNeon;
          }

          mapRef.current = new GoogleMapConstructor(mapContainerRef.current, mapOptions);

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

          mapRef.current.addListener("idle", emitViewportState);

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
          [0, 80, 240, 520].forEach((delay) => {
            window.setTimeout(() => {
              if (mapRef.current) refreshGoogleMapLayout(googleMaps, mapRef.current);
            }, delay);
          });
        } else {
          const runtimeMapId = String(mapId || "").trim();
          if (isNightTheme) {
            mapRef.current.setOptions({
              mapId: undefined,
              styles: null,
              mapTypeId: "satellite",
              tilt: 45,
              heading: 18,
            });
          } else if (runtimeMapId) {
            mapRef.current.setOptions({ mapId: runtimeMapId, tilt: 0, heading: 0 });
          } else {
            mapRef.current.setOptions({
              mapId: undefined,
              mapTypeId: "roadmap",
              styles: mapStyleNeon,
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
        const msg = error?.message || "Unable to load Google Maps. Falling back to legacy map.";
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
  }, [apiKey, mapId, isNightTheme, interactive]);

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
    if (hasMeaningfulCenterDelta({ lat: currentLat, lng: currentLng }, center)) {
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
    if (!googleMaps || !mapRef.current || !popupAnchor || !onPopupAnchorPositionRef.current) {
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

    // AdvancedMarkerElement requires a mapId — since we strip mapId for
    // neon style support, we always use classic Markers on this surface.
    const AdvancedMarkerElement = googleMaps.marker?.AdvancedMarkerElement;
    const useAdvanced = false;
    const usedIds = new Set<string>();

    renderedMarkers.forEach((marker) => {
      usedIds.add(marker.id);
      const existing = markerRefs.current.get(marker.id);
      const signature = [
        marker.kind,
        marker.lat.toFixed(6),
        marker.lng.toFixed(6),
        marker.color || "",
        marker.title || "",
        marker.subtitle || "",
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
          existing.content = buildGlowDotElement(marker);
        } else if (typeof existing.setIcon === "function") {
          existing.setIcon(buildLegacyIcon(googleMaps, marker));
        }
        markerSignatureRefs.current.set(marker.id, signature);
        return;
      }

      const instance = useAdvanced
        ? new AdvancedMarkerElement({
            map: mapRef.current,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title || marker.subtitle || marker.kind,
            content: buildGlowDotElement(marker),
          })
        : new googleMaps.Marker({
            map: mapRef.current,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title || marker.subtitle || marker.kind,
            icon: buildLegacyIcon(googleMaps, marker),
          });

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
  }, [renderedMarkers, markerIndex, mapReadyVersion, interactive]);

  // Traffic cells
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    const trafficCellColor = (source: MapTrafficCell["source"]) =>
      source === "google_places" ? "#60a5fa"
      : source === "supply_signal" ? "#ef4444"
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
        fillOpacity: cell.source === "google_places" ? 0.14 : cell.source === "supply_signal" ? 0.22 : 0.18,
      };
      if (existing) {
        existing.setCenter({ lat: cell.lat, lng: cell.lng });
        existing.setRadius(radius);
        existing.setOptions(style);
        return;
      }
      const circle = new googleMaps.Circle({ map: mapRef.current, center: { lat: cell.lat, lng: cell.lng }, radius, ...style });
      trafficCircleRefs.current.set(cell.id, circle);
    });

    Array.from(trafficCircleRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      instance.setMap(null);
      trafficCircleRefs.current.delete(id);
    });
  }, [trafficCells, mapReadyVersion]);

  // Road traffic layer
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;
    if (!showRoadTrafficLayer) {
      if (roadTrafficLayerRef.current) { roadTrafficLayerRef.current.setMap(null); roadTrafficLayerRef.current = null; }
      return;
    }
    if (!roadTrafficLayerRef.current) roadTrafficLayerRef.current = new googleMaps.TrafficLayer();
    roadTrafficLayerRef.current.setMap(mapRef.current);
  }, [showRoadTrafficLayer, mapReadyVersion]);

  // Cleanup
  useEffect(() => {
    return () => {
      Array.from(markerRefs.current.values()).forEach((instance) =>
        removeMarkerFromMap(instance),
      );
      markerRefs.current.clear();
      Array.from(trafficCircleRefs.current.values()).forEach((i) => i.setMap(null));
      trafficCircleRefs.current.clear();
      markerSignatureRefs.current.clear();
      onMarkerHoverRef.current?.(null, null);
      onPopupAnchorPositionRef.current?.(null);
      if (roadTrafficLayerRef.current) { roadTrafficLayerRef.current.setMap(null); roadTrafficLayerRef.current = null; }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (onWindowResizeRef.current) {
        window.removeEventListener("resize", onWindowResizeRef.current);
        onWindowResizeRef.current = null;
      }
    };
  }, []);

  const btnClass =
    "h-11 w-11 rounded-full border border-orange-200/35 bg-[#120805]/85 p-0 text-orange-200 shadow-lg backdrop-blur transition-colors hover:bg-[#1f0d06]";

  return (
    <div className="h-full w-full relative">
      <div className={isNightTheme ? "ms-google-map-camera" : "h-full w-full"}>
        <div
          ref={mapContainerRef}
          className="ms-google-map-canvas h-full w-full overflow-hidden"
        />
      </div>

      {/* Cinematic grade over the live map; no bitmap overlay, map stays interactive. */}
      {isNightTheme && (
        <>
          <div
            aria-hidden="true"
            className="ms-google-map-grade"
          />
          <style>{`
            .ms-google-map-canvas .gm-style > div:first-child {
              filter: saturate(0.72) contrast(1.38) brightness(0.74) sepia(0.38) hue-rotate(-16deg);
            }
            .ms-google-map-camera {
              position: absolute;
              inset: -18% -12% -10% -12%;
              height: auto;
              width: auto;
              transform: perspective(760px) rotateX(46deg) rotateZ(-3deg) scale(1.26);
              transform-origin: 50% 54%;
              will-change: transform;
            }
            .ms-google-map-camera .ms-google-map-canvas {
              height: 100%;
              width: 100%;
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
                linear-gradient(90deg, rgba(26, 9, 3, 0.3), rgba(3, 9, 8, 0.02) 36%, rgba(26, 9, 3, 0.24)),
                radial-gradient(circle at 58% 47%, rgba(255, 112, 58, 0.15), transparent 25%),
                radial-gradient(circle at 76% 18%, rgba(255, 168, 86, 0.08), transparent 27%),
                radial-gradient(circle at 12% 72%, rgba(255, 132, 64, 0.08), transparent 26%);
              background-size:
                100% 100%,
                100% 100%,
                100% 100%,
                100% 100%;
              opacity: 0.7;
            }
            .ms-google-map-grade::after {
              content: "";
              position: absolute;
              inset: 0;
              background:
                radial-gradient(ellipse at 50% 46%, transparent 0%, rgba(0, 0, 0, 0) 58%, rgba(0, 0, 0, 0.34) 100%),
                linear-gradient(180deg, rgba(9, 4, 2, 0.12) 0%, rgba(3, 4, 5, 0) 44%, rgba(3, 4, 5, 0.28) 100%);
              mix-blend-mode: normal;
            }
          `}</style>
        </>
      )}

      {interactive && (
        <div className="absolute top-5 right-5 flex flex-col gap-2 z-[1000]">
          <Button
            variant="secondary"
            size="sm"
            className={btnClass}
            onClick={() => mapRef.current?.setZoom?.((mapRef.current?.getZoom?.() || zoom) + 1)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <span className="text-lg font-bold leading-none">+</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={btnClass}
            onClick={() => mapRef.current?.setZoom?.((mapRef.current?.getZoom?.() || zoom) - 1)}
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
