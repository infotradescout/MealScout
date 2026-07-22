/**
 * GoogleMapPicker
 *
 * A reusable Google Maps component for pin editing and Parking Pass browsing.
 *
 * Supports:
 *  - Click-to-place a draggable pin
 *  - Optional circle overlay (for geo-ad radius visualisation)
 *  - Read-only multi-pin view (for parking-pass browse maps)
 *  - Controlled center + zoom
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import { createGoogleMapWithRasterFallback } from "@/lib/google-map-runtime";
import type { MapBoundsLike, MapTrafficCell } from "./map-adapter.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeoPoint = { lat: number; lng: number };

export interface MapPickerPin {
  key: string;
  position: GeoPoint;
  /** If provided the pin is draggable and calls onPinDrag when released */
  draggable?: boolean;
  /** Popup content rendered inside a Google Maps InfoWindow */
  popup?: React.ReactNode;
  /** Whether this pin uses the "occupied" (dot) variant */
  occupied?: boolean;
}

export interface GoogleMapPickerProps {
  center: GeoPoint;
  zoom?: number;
  /** Called when the user clicks the map (for pin-picker mode) */
  onMapClick?: (point: GeoPoint) => void;
  /** Called when a draggable pin is released */
  onPinDrag?: (key: string, point: GeoPoint) => void;
  /** Called when a pin marker is clicked (key = MapPickerPin.key) */
  onPinClick?: (key: string) => void;
  /** Pins to render on the map */
  pins?: MapPickerPin[];
  /** Optional owner planning heat cells rendered above the map */
  trafficCells?: MapTrafficCell[];
  /** Called after viewport changes so callers can fetch viewport-scoped overlays */
  onBoundsChanged?: (bounds: MapBoundsLike) => void;
  /** If set, draws a circle around `center` with this radius in metres */
  circleRadiusMetres?: number;
  /** Extra CSS classes applied to the outer wrapper div */
  className?: string;
  /** Disable scroll/drag interactions (e.g. when a popup is open) */
  interactionsEnabled?: boolean;
  /** Google Maps Map ID — required for Advanced Markers; from VITE_GOOGLE_MAPS_MAP_ID */
  mapId?: string;
  fitPins?: boolean;
  /** Optional route geometry rendered on parking browse maps. */
  routePath?: GeoPoint[];
}

const removeGoogleMarker = (marker: any) => {
  if (!marker) return;
  if (typeof marker.setMap === "function") {
    marker.setMap(null);
    return;
  }
  if ("map" in marker) marker.map = null;
};

const updateGoogleMarkerPosition = (marker: any, position: GeoPoint) => {
  if (!marker) return;
  if (typeof marker.setPosition === "function") {
    marker.setPosition(position);
    return;
  }
  marker.position = position;
};

// ─── Google Maps loader (shared singleton) ────────────────────────────────────

type GoogleMapsWindow = Window & {
  google?: any;
  __mealScoutGoogleMapsPromise?: Promise<void>;
  gm_authFailure?: () => void;
};

async function loadGoogleMaps(apiKey: string): Promise<void> {
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
  } catch (err) {
    w.__mealScoutGoogleMapsPromise = undefined;
    throw err;
  }
}

// ─── Google Maps renderer ─────────────────────────────────────────────────────

function GoogleMapRenderer({
  apiKey,
  mapId,
  center,
  zoom = 13,
  pins = [],
  trafficCells = [],
  circleRadiusMetres,
  onMapClick,
  onPinDrag,
  onPinClick,
  onBoundsChanged,
  fitPins = false,
  routePath = [],
  interactionsEnabled = true,
  onLoadError,
}: {
  apiKey: string;
  mapId?: string;
  center: GeoPoint;
  zoom?: number;
  pins?: MapPickerPin[];
  trafficCells?: MapTrafficCell[];
  circleRadiusMetres?: number;
  onMapClick?: (p: GeoPoint) => void;
  onPinDrag?: (key: string, p: GeoPoint) => void;
  onPinClick?: (key: string) => void;
  onBoundsChanged?: (bounds: MapBoundsLike) => void;
  fitPins?: boolean;
  routePath?: GeoPoint[];
  interactionsEnabled?: boolean;
  onLoadError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const trafficCircleRefs = useRef<Map<string, any>>(new Map());
  const circleRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const mapIdAppliedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  // Portal state: the DOM node injected into the InfoWindow + the ReactNode to render there
  const [infoPortalContainer, setInfoPortalContainer] = useState<HTMLDivElement | null>(null);
  const [infoPortalContent, setInfoPortalContent] = useState<React.ReactNode>(null);
  const fitPinsKey = fitPins
    ? pins
        .map(
          (pin) =>
            `${pin.key}:${pin.position.lat.toFixed(6)},${pin.position.lng.toFixed(6)}`,
        )
        .join("|")
    : "";

  // Load SDK + initialise map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const g = (window as GoogleMapsWindow).google;
        if (!g?.maps) return;
        const mapOptions = {
          center: { lat: center.lat, lng: center.lng },
          zoom,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: interactionsEnabled ? "auto" : "none",
          mapTypeId: "roadmap",
        };
        const { map, mapIdApplied } = createGoogleMapWithRasterFallback<any>({
          MapConstructor: g.maps.Map,
          container: containerRef.current,
          options: mapOptions,
          mapId,
        });
        mapIdAppliedRef.current = mapIdApplied;
        mapRef.current = map;
        setMapReadyVersion((version) => version + 1);
        const refreshLayout = () => {
          const currentMap = mapRef.current;
          if (!currentMap) return;
          const currentCenter = currentMap.getCenter?.();
          g.maps.event.trigger(currentMap, "resize");
          if (currentCenter) currentMap.setCenter(currentCenter);
        };
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = new ResizeObserver(refreshLayout);
        resizeObserverRef.current.observe(containerRef.current);
        [0, 80, 240, 520].forEach((delay) => {
          window.setTimeout(refreshLayout, delay);
        });
        const iw = new g.maps.InfoWindow();
        infoWindowRef.current = iw;
        // Create a persistent DOM node that React will portal into
        const portalDiv = document.createElement("div");
        portalDiv.className = "gmp-infowindow-portal";
        iw.setContent(portalDiv);
        if (!cancelled) setInfoPortalContainer(portalDiv);

        if (onMapClick) {
          map.addListener("click", (e: any) => {
            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            onMapClick({ lat, lng });
          });
        }
        if (onBoundsChanged) {
          const emitBounds = () => {
            const bounds = map.getBounds?.();
            if (!bounds) return;
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const north = Number(ne.lat());
            const east = Number(ne.lng());
            const south = Number(sw.lat());
            const west = Number(sw.lng());
            onBoundsChanged({
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
          };
          map.addListener("idle", emitBounds);
          window.setTimeout(emitBounds, 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(String(err?.message || "Map failed to load"));
          onLoadError?.();
        }
      });
    return () => {
      cancelled = true;
      Array.from(markersRef.current.values()).forEach((marker) => {
        removeGoogleMarker(marker);
      });
      markersRef.current.clear();
      Array.from(trafficCircleRefs.current.values()).forEach((circle) => {
        circle.setMap?.(null);
      });
      trafficCircleRefs.current.clear();
      if (circleRef.current) {
        circleRef.current.setMap?.(null);
        circleRef.current = null;
      }
      routePolylineRef.current?.setMap?.(null);
      routePolylineRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      infoWindowRef.current?.close?.();
      mapIdAppliedRef.current = false;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Re-centre map when center/zoom props change
  useEffect(() => {
    if (!mapRef.current) return;
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps) return;
    mapRef.current.panTo({ lat: center.lat, lng: center.lng });
    mapRef.current.setZoom(zoom ?? 13);
  }, [center.lat, center.lng, mapReadyVersion, zoom]);

  // Sync pins
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    const existing = markersRef.current;

    // Remove stale markers
    const incomingKeys = new Set(pins.map((p) => p.key));
    for (const [key, marker] of existing) {
      if (!incomingKeys.has(key)) {
        removeGoogleMarker(marker);
        existing.delete(key);
      }
    }

    // Add / update markers
    for (const pin of pins) {
      if (existing.has(pin.key)) {
        updateGoogleMarkerPosition(existing.get(pin.key), {
          lat: pin.position.lat,
          lng: pin.position.lng,
        });
      } else {
        const AdvancedMarkerElement = g.maps.marker?.AdvancedMarkerElement;
        const useAdvanced = Boolean(
          AdvancedMarkerElement && mapIdAppliedRef.current,
        );
        let marker: any;
        if (useAdvanced) {
          const img = document.createElement("img");
          img.src = mealScoutIcon;
          img.style.width = "36px";
          img.style.height = "36px";
          img.style.display = "block";
          marker = new AdvancedMarkerElement({
            position: { lat: pin.position.lat, lng: pin.position.lng },
            map,
            content: img,
            gmpDraggable: pin.draggable ?? false,
          });
        } else {
          marker = new g.maps.Marker({
            position: { lat: pin.position.lat, lng: pin.position.lng },
            map,
            draggable: pin.draggable ?? false,
            icon: {
              url: mealScoutIcon,
              scaledSize: new g.maps.Size(36, 36),
              anchor: new g.maps.Point(18, 36),
            },
          });
        }
        marker.addListener("click", () => {
          if (onPinClick) onPinClick(pin.key);
          if (infoWindow) {
            // Render the React popup node into the persistent portal container,
            // then open the InfoWindow anchored to this marker.
            setInfoPortalContent(pin.popup ?? null);
            infoWindow.open(map, marker);
          }
        });
        if (pin.draggable && onPinDrag) {
          if (useAdvanced) {
            // AdvancedMarkerElement uses 'gmp-dragend' and exposes position directly
            marker.addListener("gmp-dragend", () => {
              const pos = marker.position;
              if (pos) onPinDrag(pin.key, { lat: pos.lat, lng: pos.lng });
            });
          } else {
            marker.addListener("dragend", (e: any) => {
              onPinDrag(pin.key, { lat: e.latLng.lat(), lng: e.latLng.lng() });
            });
          }
        }
        existing.set(pin.key, marker);
      }
    }
  }, [mapReadyVersion, pins, onPinDrag]);

  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    const map = mapRef.current;
    if (!fitPins || !g?.maps || !map || pins.length === 0) return;
    const validPins = pins.filter(
      (pin) => Number.isFinite(pin.position.lat) && Number.isFinite(pin.position.lng),
    );
    if (validPins.length === 0) return;
    if (validPins.length === 1) {
      map.setCenter(validPins[0].position);
      if (Number(map.getZoom?.() || 0) < 15) map.setZoom(15);
      return;
    }
    const bounds = new g.maps.LatLngBounds();
    validPins.forEach((pin) => bounds.extend(pin.position));
    map.fitBounds(bounds, 72);
    // Pin popup/content changes must not refit the viewport. Refit only when
    // the actual pin geometry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitPins, fitPinsKey, mapReadyVersion]);

  useEffect(() => {
    routePolylineRef.current?.setMap?.(null);
    routePolylineRef.current = null;
    const g = (window as GoogleMapsWindow).google;
    const map = mapRef.current;
    const validPath = routePath.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    );
    if (!g?.maps || !map || validPath.length < 2) return;
    routePolylineRef.current = new g.maps.Polyline({
      map,
      path: validPath,
      geodesic: true,
      strokeColor: "#f97316",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      zIndex: 20,
    });
    return () => {
      routePolylineRef.current?.setMap?.(null);
      routePolylineRef.current = null;
    };
  }, [mapReadyVersion, routePath]);

  // Circle overlay
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
    if (circleRadiusMetres && circleRadiusMetres > 0) {
      circleRef.current = new g.maps.Circle({
        map: mapRef.current,
        center: { lat: center.lat, lng: center.lng },
        radius: circleRadiusMetres,
        strokeColor: "#f97316",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#f97316",
        fillOpacity: 0.15,
      });
    }
  }, [center.lat, center.lng, circleRadiusMetres, mapReadyVersion]);

  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;

    const trafficCellColor = (cell: MapTrafficCell) =>
      cell.color ||
      (cell.source === "google_places"
        ? "#60a5fa"
        : cell.source === "supply_signal"
          ? "#ef4444"
          : "#f97316");

    const usedIds = new Set<string>();
    trafficCells.forEach((cell) => {
      usedIds.add(cell.id);
      const existing = trafficCircleRefs.current.get(cell.id);
      const radius = Math.max(110, Math.min(1200, (cell.weight || 1) * 10));
      const style = {
        clickable: false,
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: trafficCellColor(cell),
        fillOpacity:
          cell.source === "google_places"
            ? 0.1
            : cell.source === "supply_signal"
              ? 0.14
              : 0.12,
      };
      if (existing) {
        existing.setCenter({ lat: cell.lat, lng: cell.lng });
        existing.setRadius(radius);
        existing.setOptions(style);
        return;
      }
      const circle = new g.maps.Circle({
        map: mapRef.current,
        center: { lat: cell.lat, lng: cell.lng },
        radius,
        ...style,
      });
      trafficCircleRefs.current.set(cell.id, circle);
    });

    Array.from(trafficCircleRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      instance.setMap(null);
      trafficCircleRefs.current.delete(id);
    });
  }, [mapReadyVersion, trafficCells]);

  if (loadError) return null;

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {/* Portal: renders the React popup node into the Google Maps InfoWindow DOM node */}
      {infoPortalContainer && infoPortalContent
        ? createPortal(infoPortalContent, infoPortalContainer)
        : null}
    </>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

type MapRuntimeResponse = {
  hasGoogleMapsKey: boolean;
  googleMapsApiKey?: string | null;
  hasGoogleMapsMapId?: boolean;
  googleMapsMapId?: string | null;
};

export function GoogleMapPicker({
  center,
  zoom = 13,
  onMapClick,
  onPinDrag,
  onPinClick,
  pins = [],
  trafficCells = [],
  onBoundsChanged,
  circleRadiusMetres,
  className = "",
  interactionsEnabled = true,
  mapId: mapIdProp,
  fitPins = false,
  routePath = [],
}: GoogleMapPickerProps) {
  const { data: mapRuntime, isLoading: mapRuntimeLoading } =
    useQuery<MapRuntimeResponse>({
    queryKey: ["/api/map/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/map/runtime");
      if (!res.ok) return { hasGoogleMapsKey: false, googleMapsApiKey: null };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    });

  // Build-time key takes priority; runtime key is a fallback for server-injected keys
  const buildTimeKey = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
      (import.meta as any).env?.VITE_GOOGLE_API_KEY ||
      "",
  ).trim();
  const runtimeKey = String(mapRuntime?.googleMapsApiKey || "").trim();
  const apiKey = buildTimeKey || runtimeKey;

  // Map ID: caller-provided prop takes priority, then build-time env var
  const envMapId = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID ||
      (import.meta as any).env?.GOOGLE_MAPS_MAP_ID ||
      "",
  ).trim();
  const runtimeMapId = String(mapRuntime?.googleMapsMapId || "").trim();
  const mapId = mapIdProp || envMapId || runtimeMapId || undefined;

  const [googleFailed, setGoogleFailed] = useState(false);
  const useGoogle = apiKey.length > 0 && !googleFailed;
  return (
    <div className={`relative h-full w-full ${className}`}>
      {useGoogle ? (
        <GoogleMapRenderer
          apiKey={apiKey}
          mapId={mapId}
          center={center}
          zoom={zoom}
          pins={pins}
          trafficCells={trafficCells}
          circleRadiusMetres={circleRadiusMetres}
          onMapClick={onMapClick}
          onPinDrag={onPinDrag}
          onPinClick={onPinClick}
          onBoundsChanged={onBoundsChanged}
          fitPins={fitPins}
          routePath={routePath}
          interactionsEnabled={interactionsEnabled}
          onLoadError={() => setGoogleFailed(true)}
        />
      ) : mapRuntimeLoading && !googleFailed ? (
        <div className="flex h-full items-center justify-center bg-[var(--bg-surface-muted)] text-sm text-[color:var(--text-muted)]">
          Loading Google map...
        </div>
      ) : (
        <div className="flex h-full items-center justify-center bg-[var(--bg-surface-muted)] px-6 text-center text-sm text-[color:var(--text-muted)]">
          Google Maps is temporarily unavailable.
        </div>
      )}
    </div>
  );
}
