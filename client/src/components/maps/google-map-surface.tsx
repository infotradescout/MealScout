import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Navigation as NavigationIcon } from "lucide-react";
import type {
  MapAdapterMarker,
  MapBoundsLike,
  MapTrafficCell,
} from "./map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";

type GeoPoint = { lat: number; lng: number };

type GoogleMapSurfaceProps = {
  apiKey: string;
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
  onMarkerTap: (marker: MapAdapterMarker) => void;
  onFatalError?: (message: string) => void;
};

type GoogleMapsWindow = Window & {
  google?: any;
  __mealScoutGoogleMapsPromise?: Promise<void>;
  gm_authFailure?: () => void;
};
const GOOGLE_MAP_ID = String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "").trim();

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

/* ─── Google Maps style — MealScout Neon Night ──────────────────────────────
   Goals:
   - Land: near-black (#080b12), same as the SVG hero base
   - Roads: warm amber/orange neon glow — highways brightest, locals dimmest
   - Labels: amber-gold text, dark stroke so they read on the black base
   - Water: deep navy, not distracting
   - POI / parks: suppressed — roads dominate
   - No Google default blue/grey palette anywhere
   ────────────────────────────────────────────────────────────────────────── */
const mapStyleNeon = [
  // ── Base ──────────────────────────────────────────────────────────────────
  { elementType: "geometry",            stylers: [{ color: "#080b12" }] },
  { elementType: "labels.text.fill",    stylers: [{ color: "#d4a843" }] },
  { elementType: "labels.text.stroke",  stylers: [{ color: "#080b12" }] },
  { elementType: "labels.icon",         stylers: [{ visibility: "off" }] },

  // ── Roads ─────────────────────────────────────────────────────────────────
  // Highway — brightest amber, thick stroke
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#4a2000" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#fb923c" }, { weight: 2.5 }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#fb923c" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#080b12" }],
  },
  // Arterial — medium amber
  {
    featureType: "road.arterial",
    elementType: "geometry.fill",
    stylers: [{ color: "#2a1200" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry.stroke",
    stylers: [{ color: "#f97316" }, { weight: 1.5 }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f97316" }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#080b12" }],
  },
  // Local — dim amber
  {
    featureType: "road.local",
    elementType: "geometry.fill",
    stylers: [{ color: "#180a00" }],
  },
  {
    featureType: "road.local",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c2410c" }, { weight: 0.8 }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#c2410c" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#080b12" }],
  },

  // ── Water ─────────────────────────────────────────────────────────────────
  { featureType: "water", elementType: "geometry",          stylers: [{ color: "#060d1e" }] },
  { featureType: "water", elementType: "labels.text.fill",  stylers: [{ color: "#1e3a5f" }] },

  // ── Landscape ─────────────────────────────────────────────────────────────
  { featureType: "landscape",         elementType: "geometry", stylers: [{ color: "#080b12" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#080f08" }] },
  { featureType: "landscape.man_made",elementType: "geometry", stylers: [{ color: "#0a0d14" }] },

  // ── Parks ─────────────────────────────────────────────────────────────────
  { featureType: "poi.park",  elementType: "geometry",          stylers: [{ color: "#0a120a" }] },
  { featureType: "poi.park",  elementType: "labels.text.fill",  stylers: [{ color: "#1e3d1e" }] },

  // ── POI — suppress everything else ────────────────────────────────────────
  { featureType: "poi",       elementType: "geometry",          stylers: [{ color: "#0a0d14" }] },
  { featureType: "poi",       elementType: "labels.text.fill",  stylers: [{ color: "#4a3a10" }] },
  { featureType: "poi",       elementType: "labels.icon",       stylers: [{ visibility: "off" }] },

  // ── Transit ───────────────────────────────────────────────────────────────
  { featureType: "transit",           elementType: "geometry",          stylers: [{ color: "#14100a" }] },
  { featureType: "transit.station",   elementType: "labels.text.fill",  stylers: [{ color: "#d97706" }] },

  // ── Administrative ────────────────────────────────────────────────────────
  { featureType: "administrative",              elementType: "geometry.stroke",  stylers: [{ color: "#2d1e00" }, { weight: 0.5 }] },
  { featureType: "administrative",              elementType: "labels.text.fill", stylers: [{ color: "#8a6520" }] },
  { featureType: "administrative.locality",     elementType: "labels.text.fill", stylers: [{ color: "#d4a843" }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#9a7a30" }] },
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
  if (marker.kind === "parking") {
    return {
      url: mealScoutIcon,
      scaledSize: new googleMaps.Size(34, 34),
      anchor: new googleMaps.Point(17, 34),
    };
  }
  const color = markerColor(marker);
  return {
    path: googleMaps.SymbolPath.CIRCLE,
    scale: marker.kind === "user" ? 9 : 7,
    fillColor: color,
    fillOpacity: 0.95,
    strokeColor: "#080b12",
    strokeWeight: 1.5,
  };
};

const removeMarkerFromMap = (instance: any) => {
  if (!instance) return;
  if (typeof instance.setMap === "function") { instance.setMap(null); return; }
  if ("map" in instance) { instance.map = null; }
};

/* ─── Script loader ─────────────────────────────────────────────────────── */
const loadGoogleMaps = async (apiKey: string) => {
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

/* ─── Component ─────────────────────────────────────────────────────────── */
export function GoogleMapSurface({
  apiKey,
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
  onMarkerTap,
  onFatalError,
}: GoogleMapSurfaceProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, any>>(new Map());
  const trafficCircleRefs = useRef<Map<string, any>>(new Map());
  const roadTrafficLayerRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  const hasReportedFatalErrorRef = useRef(false);
  const onWindowResizeRef = useRef<(() => void) | null>(null);

  const markerIndex = useMemo(
    () => new Map(markers.map((m) => [m.id, m])),
    [markers],
  );

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
        onFatalError?.(msg);
      }
    };
    w.gm_authFailure = handler;
    return () => { if (w.gm_authFailure === handler) w.gm_authFailure = prev; };
  }, [onFatalError]);

  // Map init
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (!mounted || !mapContainerRef.current) return;
        const googleMaps = (window as GoogleMapsWindow).google?.maps;
        if (!googleMaps) throw new Error("Google Maps not available");

        if (!mapRef.current) {
          const prefersFinePointer =
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(pointer: fine)").matches;

          // NOTE: Google Maps ignores `styles` when a `mapId` is present.
          // For the Scout neon theme we intentionally omit mapId so the
          // custom style JSON takes full effect. Advanced Markers are not
          // needed on this surface — glowing SVG dots via classic Markers
          // are used instead.
          mapRef.current = new googleMaps.Map(mapContainerRef.current, {
            center,
            zoom,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: false,
            tilt: 0,
            heading: 0,
            gestureHandling: prefersFinePointer ? "greedy" : "cooperative",
            styles: mapStyleNeon,
          });

          mapRef.current.addListener("idle", () => {
            const b = mapRef.current?.getBounds?.();
            const z = Number(mapRef.current?.getZoom?.() || 0);
            if (Number.isFinite(z) && z > 0) onZoomChanged(z);
            if (!b) return;
            const ne = b.getNorthEast();
            const sw = b.getSouthWest();
            onBoundsChanged(createBoundsLike(Number(ne.lat()), Number(sw.lat()), Number(ne.lng()), Number(sw.lng())));
          });

          mapRef.current.addListener("center_changed", () => {
            const c = mapRef.current?.getCenter?.();
            if (c && onCenterChanged) onCenterChanged({ lat: Number(c.lat()), lng: Number(c.lng()) });
          });

          // Trigger resize whenever the container changes size (e.g. on
          // first pull-down expand). Without this the map renders blank
          // until the user interacts because it was initialized in a
          // zero-height or hidden container.
          const ro = new ResizeObserver(() => {
            if (mapRef.current) {
              googleMaps.event.trigger(mapRef.current, "resize");
            }
          });
          if (mapContainerRef.current) ro.observe(mapContainerRef.current);

          // Also listen to window resize so the post-transition dispatch
          // from explore-preview (fired 340ms after pull-down) triggers a
          // full re-tile at the correct 100dvh dimensions.
          onWindowResizeRef.current = () => {
            if (mapRef.current) {
              googleMaps.event.trigger(mapRef.current, "resize");
            }
          };
          window.addEventListener("resize", onWindowResizeRef.current);

          setMapReadyVersion((v) => v + 1);
        } else {
          mapRef.current.setOptions({ styles: mapStyleNeon });
        }

        setLoadError(null);
      } catch (error: any) {
        if (!mounted) return;
        const msg = error?.message || "Unable to load Google Maps. Falling back to legacy map.";
        setLoadError(msg);
        if (!hasReportedFatalErrorRef.current) {
          hasReportedFatalErrorRef.current = true;
          onFatalError?.(msg);
        }
      }
    };
    init();
    return () => { mounted = false; };
  }, [apiKey, center, zoom, isNightTheme, onBoundsChanged, onZoomChanged, onCenterChanged, onFatalError]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setCenter(center);
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!mapRef.current) return;
    const cur = Number(mapRef.current.getZoom?.() || 0);
    if (!Number.isFinite(cur) || cur !== zoom) mapRef.current.setZoom(zoom);
  }, [zoom]);

  // Marker sync
  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    // AdvancedMarkerElement requires a mapId — since we strip mapId for
    // neon style support, we always use classic Markers on this surface.
    const AdvancedMarkerElement = googleMaps.marker?.AdvancedMarkerElement;
    const useAdvanced = false;
    const usedIds = new Set<string>();

    markers.forEach((marker) => {
      usedIds.add(marker.id);
      const existing = markerRefs.current.get(marker.id);

      if (existing) {
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
          const tapped = markerIndex.get(marker.id);
          if (tapped) onMarkerTap(tapped);
        });
      } else {
        instance.addListener("click", () => {
          const tapped = markerIndex.get(marker.id);
          if (tapped) onMarkerTap(tapped);
        });
      }
      markerRefs.current.set(marker.id, instance);
    });

    Array.from(markerRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      removeMarkerFromMap(instance);
      markerRefs.current.delete(id);
    });
  }, [markers, markerIndex, onMarkerTap, mapReadyVersion]);

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
      Array.from(trafficCircleRefs.current.values()).forEach((i) => i.setMap(null));
      trafficCircleRefs.current.clear();
      if (roadTrafficLayerRef.current) { roadTrafficLayerRef.current.setMap(null); roadTrafficLayerRef.current = null; }
      if (onWindowResizeRef.current) {
        window.removeEventListener("resize", onWindowResizeRef.current);
        onWindowResizeRef.current = null;
      }
    };
  }, []);

  const btnClass = "w-11 h-11 p-0 rounded-full bg-black/70 border border-white/15 shadow-lg backdrop-blur text-amber-300 hover:bg-black/85 transition-colors";

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainerRef} className="h-full w-full rounded-lg overflow-hidden" />

      {/* Neon bloom overlay — screen blend amplifies the amber road glow */}
      {isNightTheme && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: "0.5rem",
            overflow: "hidden",
            zIndex: 1,
            mixBlendMode: "screen",
            background: "radial-gradient(ellipse 100% 80% at 50% 50%, rgba(249,115,22,0.06) 0%, transparent 70%)",
          }}
        />
      )}

      {/* Map controls */}
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
          <span className="text-lg font-bold leading-none">−</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={btnClass}
          disabled={!userLocation}
          onClick={() => { if (!userLocation) return; mapRef.current?.setCenter?.(userLocation); }}
          title="Center on my location"
          aria-label="Center on my location"
        >
          <NavigationIcon className="w-4 h-4" />
        </Button>
      </div>

      {loadError && (
        <div className="absolute left-3 right-3 bottom-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {loadError}
        </div>
      )}
    </div>
  );
}
