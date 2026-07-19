/**
 * GoogleMapPicker
 *
 * A reusable map component that renders Google Maps when a key is available
 * and automatically falls back to Leaflet/OpenStreetMap when no key is present.
 *
 * Supports:
 *  - Click-to-place a draggable pin
 *  - Optional circle overlay (for geo-ad radius visualisation)
 *  - Read-only multi-pin view (for parking-pass browse maps)
 *  - Controlled center + zoom
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import type { MapBoundsLike, MapTrafficCell } from "./map-adapter.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeoPoint = { lat: number; lng: number };

export interface MapPickerPin {
  key: string;
  position: GeoPoint;
  /** If provided the pin is draggable and calls onPinDrag when released */
  draggable?: boolean;
  /** Popup content rendered inside a Leaflet Popup / Google InfoWindow */
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
  /** Fit the viewport whenever the rendered pin set changes */
  fitToPins?: boolean;
  /** Fan out markers that would otherwise occupy the same screen pixels */
  separateOverlappingPins?: boolean;
  /** Optional owner planning heat cells rendered above the map */
  trafficCells?: MapTrafficCell[];
  /** Optional route geometry rendered as a connected path */
  routePath?: GeoPoint[];
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
}

// ─── Shared assets ────────────────────────────────────────────────────────────

const pinIcon = new L.Icon({
  iconUrl: mealScoutIcon,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
});

const pinIconOccupied = new L.DivIcon({
  className: "pp-pin",
  html: `<div class="pp-pin__wrap"><img class="pp-pin__img" src="${mealScoutIcon}" alt="" /><span class="pp-pin__dot" aria-hidden="true"></span></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
});

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

const detachGoogleMarker = (marker: any) => {
  if (!marker) return;
  if (typeof marker.setMap === "function") {
    marker.setMap(null);
    return;
  }
  marker.map = null;
};

const updateGoogleMarkerPosition = (marker: any, position: GeoPoint) => {
  if (!marker) return;
  if (typeof marker.setPosition === "function") {
    marker.setPosition(position);
    return;
  }
  marker.position = position;
};

function LeafletCenterer({
  center,
  zoom,
}: {
  center: GeoPoint;
  zoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom(), {
      animate: true,
    });
  }, [center.lat, center.lng, map, zoom]);
  return null;
}

function LeafletClickHandler({
  onMapClick,
}: {
  onMapClick: (p: GeoPoint) => void;
}) {
  useMapEvents({
    click: (e) => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

function LeafletBoundsWatcher({
  onBoundsChanged,
}: {
  onBoundsChanged: (bounds: MapBoundsLike) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const emitBounds = () => {
      const bounds = map.getBounds();
      const north = bounds.getNorth();
      const south = bounds.getSouth();
      const east = bounds.getEast();
      const west = bounds.getWest();
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
    emitBounds();
    map.on("moveend zoomend", emitBounds);
    return () => {
      map.off("moveend zoomend", emitBounds);
    };
  }, [map, onBoundsChanged]);
  return null;
}

function LeafletPinFitter({
  enabled,
  pins,
  zoom,
}: {
  enabled: boolean;
  pins: MapPickerPin[];
  zoom?: number;
}) {
  const map = useMap();
  const lastSignatureRef = useRef("");

  useEffect(() => {
    if (!enabled) {
      lastSignatureRef.current = "";
      return;
    }

    const validPins = pins.filter(
      (pin) =>
        Number.isFinite(pin.position.lat) && Number.isFinite(pin.position.lng),
    );
    if (validPins.length === 0) return;

    const signature = validPins
      .map(
        (pin) =>
          `${pin.key}:${pin.position.lat.toFixed(6)}:${pin.position.lng.toFixed(6)}`,
      )
      .sort()
      .join("|");
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    if (validPins.length === 1) {
      map.setView(
        [validPins[0].position.lat, validPins[0].position.lng],
        Math.min(zoom ?? 13, 14),
        { animate: true },
      );
      return;
    }

    map.fitBounds(
      L.latLngBounds(
        validPins.map((pin) => [pin.position.lat, pin.position.lng]),
      ),
      { animate: true, maxZoom: 14, padding: [28, 28] },
    );
  }, [enabled, map, pins, zoom]);

  return null;
}

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
  fitToPins = false,
  separateOverlappingPins = false,
  trafficCells = [],
  routePath = [],
  circleRadiusMetres,
  onMapClick,
  onPinDrag,
  onPinClick,
  onBoundsChanged,
  interactionsEnabled = true,
  onLoadError,
}: {
  apiKey: string;
  mapId?: string;
  center: GeoPoint;
  zoom?: number;
  pins?: MapPickerPin[];
  fitToPins?: boolean;
  separateOverlappingPins?: boolean;
  trafficCells?: MapTrafficCell[];
  routePath?: GeoPoint[];
  circleRadiusMetres?: number;
  onMapClick?: (p: GeoPoint) => void;
  onPinDrag?: (key: string, p: GeoPoint) => void;
  onPinClick?: (key: string) => void;
  onBoundsChanged?: (bounds: MapBoundsLike) => void;
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
  const lastFittedPinSignatureRef = useRef("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapInstanceVersion, setMapInstanceVersion] = useState(0);
  // Portal state: the DOM node injected into the InfoWindow + the ReactNode to render there
  const [infoPortalContainer, setInfoPortalContainer] =
    useState<HTMLDivElement | null>(null);
  const [infoPortalContent, setInfoPortalContent] =
    useState<React.ReactNode>(null);

  // Load SDK + initialise map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const g = (window as GoogleMapsWindow).google;
        if (!g?.maps) return;
        const map = new g.maps.Map(containerRef.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: interactionsEnabled ? "auto" : "none",
          mapTypeId: "roadmap",
          ...(mapId ? { mapId } : {}),
        });
        mapRef.current = map;
        setMapInstanceVersion((version) => version + 1);
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
        detachGoogleMarker(marker);
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
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap?.(null);
        routePolylineRef.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      infoWindowRef.current?.close?.();
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
  }, [center.lat, center.lng, mapInstanceVersion, zoom]);

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
        detachGoogleMarker(marker);
        existing.delete(key);
      }
    }

    // Add / update markers
    for (const pin of pins) {
      if (existing.has(pin.key)) {
        updateGoogleMarkerPosition(existing.get(pin.key), pin.position);
      } else {
        const AdvancedMarkerElement = g.maps.marker?.AdvancedMarkerElement;
        const useAdvanced = Boolean(AdvancedMarkerElement && mapId);
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
  }, [mapInstanceVersion, onPinDrag, pins]);

  // A statewide fit can place several distinct addresses within the same
  // 36px marker footprint. Keep their real coordinates for bounds and data,
  // but fan the rendered markers into a compact ring so every host remains
  // visible and clickable. Recalculate after pan/zoom so markers return to
  // their true positions as soon as there is enough screen space.
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    const map = mapRef.current;
    if (!(separateOverlappingPins || fitToPins) || !g?.maps || !map) return;

    const layoutMarkers = () => {
      const projection = map.getProjection?.();
      const zoomLevel = Number(map.getZoom?.());
      if (!projection || !Number.isFinite(zoomLevel)) return;

      const scale = 2 ** zoomLevel;
      const positioned = pins
        .map((pin) => {
          const marker = markersRef.current.get(pin.key);
          const worldPoint = projection.fromLatLngToPoint(
            new g.maps.LatLng(pin.position.lat, pin.position.lng),
          );
          if (!marker || !worldPoint) return null;
          return {
            pin,
            marker,
            x: worldPoint.x * scale,
            y: worldPoint.y * scale,
          };
        })
        .filter(Boolean) as Array<{
          pin: MapPickerPin;
          marker: any;
          x: number;
          y: number;
        }>;

      const remaining = new Set(positioned.map((_, index) => index));
      const groups: number[][] = [];
      while (remaining.size > 0) {
        const seed = remaining.values().next().value as number;
        remaining.delete(seed);
        const group = [seed];
        const queue = [seed];
        while (queue.length > 0) {
          const current = positioned[queue.shift()!];
          for (const candidateIndex of Array.from(remaining)) {
            const candidate = positioned[candidateIndex];
            if (Math.hypot(current.x - candidate.x, current.y - candidate.y) < 42) {
              remaining.delete(candidateIndex);
              group.push(candidateIndex);
              queue.push(candidateIndex);
            }
          }
        }
        groups.push(group);
      }

      groups.forEach((group) => {
        if (group.length === 1) {
          const item = positioned[group[0]];
          updateGoogleMarkerPosition(item.marker, item.pin.position);
          return;
        }
        const centerX =
          group.reduce((sum, index) => sum + positioned[index].x, 0) /
          group.length;
        const centerY =
          group.reduce((sum, index) => sum + positioned[index].y, 0) /
          group.length;
        const radius = Math.max(28, Math.min(76, group.length * 7));
        group.forEach((positionedIndex, ringIndex) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * ringIndex) / group.length;
          const worldPoint = new g.maps.Point(
            (centerX + Math.cos(angle) * radius) / scale,
            (centerY + Math.sin(angle) * radius) / scale,
          );
          const latLng = projection.fromPointToLatLng(worldPoint);
          if (!latLng) return;
          updateGoogleMarkerPosition(positioned[positionedIndex].marker, {
            lat: latLng.lat(),
            lng: latLng.lng(),
          });
        });
      });
    };

    const listener = map.addListener("idle", layoutMarkers);
    window.setTimeout(layoutMarkers, 0);
    return () => listener.remove?.();
  }, [fitToPins, mapInstanceVersion, pins, separateOverlappingPins]);

  useEffect(() => {
    if (!fitToPins) {
      lastFittedPinSignatureRef.current = "";
      return;
    }

    const g = (window as GoogleMapsWindow).google;
    const map = mapRef.current;
    if (!g?.maps || !map) return;

    const validPins = pins.filter(
      (pin) =>
        Number.isFinite(pin.position.lat) && Number.isFinite(pin.position.lng),
    );
    if (validPins.length === 0) return;

    const signature = validPins
      .map(
        (pin) =>
          `${pin.key}:${pin.position.lat.toFixed(6)}:${pin.position.lng.toFixed(6)}`,
      )
      .sort()
      .join("|");
    if (signature === lastFittedPinSignatureRef.current) return;
    lastFittedPinSignatureRef.current = signature;

    if (validPins.length === 1) {
      map.panTo(validPins[0].position);
      map.setZoom(Math.min(zoom ?? 13, 14));
      return;
    }

    const bounds = new g.maps.LatLngBounds();
    validPins.forEach((pin) => bounds.extend(pin.position));
    map.fitBounds(bounds, 48);
  }, [fitToPins, mapInstanceVersion, pins, zoom]);

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
  }, [center.lat, center.lng, circleRadiusMetres, mapInstanceVersion]);

  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }
    const validPath = routePath.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    );
    if (validPath.length < 2) return;
    routePolylineRef.current = new g.maps.Polyline({
      map: mapRef.current,
      path: validPath,
      clickable: false,
      geodesic: true,
      strokeColor: "#ea580c",
      strokeOpacity: 0.92,
      strokeWeight: 5,
      zIndex: 2,
    });
  }, [mapInstanceVersion, routePath]);

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

    Array.from(trafficCircleRefs.current.entries()).forEach(
      ([id, instance]) => {
      if (usedIds.has(id)) return;
      instance.setMap(null);
      trafficCircleRefs.current.delete(id);
      },
    );
  }, [mapInstanceVersion, trafficCells]);

  if (loadError) return null; // caller falls back to Leaflet

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

// ─── Leaflet fallback renderer ────────────────────────────────────────────────

function LeafletPins({
  pins,
  separateOverlappingPins,
  onPinClick,
  onPinDrag,
}: {
  pins: MapPickerPin[];
  separateOverlappingPins: boolean;
  onPinClick?: (key: string) => void;
  onPinDrag?: (key: string, point: GeoPoint) => void;
}) {
  const map = useMap();
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    if (!separateOverlappingPins) return;
    const refresh = () => setLayoutVersion((version) => version + 1);
    map.on("moveend zoomend", refresh);
    return () => {
      map.off("moveend zoomend", refresh);
    };
  }, [map, separateOverlappingPins]);

  const displayedPins = (() => {
    if (!separateOverlappingPins) return pins;
    const zoomLevel = map.getZoom();
    const positioned = pins.map((pin) => {
      const point = map.project([pin.position.lat, pin.position.lng], zoomLevel);
      return { pin, x: point.x, y: point.y };
    });
    const remaining = new Set(positioned.map((_, index) => index));
    const displayPositions = new Map<string, GeoPoint>();

    while (remaining.size > 0) {
      const seed = remaining.values().next().value as number;
      remaining.delete(seed);
      const group = [seed];
      const queue = [seed];
      while (queue.length > 0) {
        const current = positioned[queue.shift()!];
        for (const candidateIndex of Array.from(remaining)) {
          const candidate = positioned[candidateIndex];
          if (Math.hypot(current.x - candidate.x, current.y - candidate.y) < 42) {
            remaining.delete(candidateIndex);
            group.push(candidateIndex);
            queue.push(candidateIndex);
          }
        }
      }

      if (group.length === 1) continue;
      const centerX =
        group.reduce((sum, index) => sum + positioned[index].x, 0) /
        group.length;
      const centerY =
        group.reduce((sum, index) => sum + positioned[index].y, 0) /
        group.length;
      const radius = Math.max(28, Math.min(76, group.length * 7));
      group.forEach((positionedIndex, ringIndex) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * ringIndex) / group.length;
        const latLng = map.unproject(
          L.point(
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius,
          ),
          zoomLevel,
        );
        displayPositions.set(positioned[positionedIndex].pin.key, {
          lat: latLng.lat,
          lng: latLng.lng,
        });
      });
    }

    return pins.map((pin) => ({
      ...pin,
      position: displayPositions.get(pin.key) || pin.position,
    }));
  })();
  void layoutVersion;

  return (
    <>
      {displayedPins.map((pin) => (
        <Marker
          key={pin.key}
          position={[pin.position.lat, pin.position.lng]}
          icon={pin.occupied ? pinIconOccupied : pinIcon}
          draggable={pin.draggable ?? false}
          eventHandlers={{
            click: () => onPinClick?.(pin.key),
            ...(pin.draggable && onPinDrag
              ? {
                  dragend: (e: any) => {
                    const marker = e.target as L.Marker;
                    const latLng = marker.getLatLng();
                    onPinDrag(pin.key, { lat: latLng.lat, lng: latLng.lng });
                  },
                }
              : {}),
          }}
        >
          {pin.popup && (
            <Popup maxWidth={320} minWidth={240} keepInView autoPan autoPanPadding={[16, 16]}>
              {pin.popup}
            </Popup>
          )}
        </Marker>
      ))}
    </>
  );
}

function LeafletRenderer({
  center,
  zoom = 13,
  pins = [],
  fitToPins = false,
  separateOverlappingPins = false,
  trafficCells = [],
  routePath = [],
  circleRadiusMetres,
  onMapClick,
  onPinDrag,
  onPinClick,
  onBoundsChanged,
  interactionsEnabled = true,
}: {
  center: GeoPoint;
  zoom?: number;
  pins?: MapPickerPin[];
  fitToPins?: boolean;
  separateOverlappingPins?: boolean;
  trafficCells?: MapTrafficCell[];
  routePath?: GeoPoint[];
  circleRadiusMetres?: number;
  onMapClick?: (p: GeoPoint) => void;
  onPinDrag?: (key: string, p: GeoPoint) => void;
  onPinClick?: (key: string) => void;
  onBoundsChanged?: (bounds: MapBoundsLike) => void;
  interactionsEnabled?: boolean;
}) {
  const isNightTheme =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-night");
  const tileUrl = isNightTheme
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      zoomControl={false}
      scrollWheelZoom={interactionsEnabled}
      dragging={interactionsEnabled}
      touchZoom={interactionsEnabled}
      doubleClickZoom={interactionsEnabled}
      boxZoom={interactionsEnabled}
      keyboard={interactionsEnabled}
      className="h-full w-full"
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      <LeafletCenterer center={center} zoom={zoom} />
      <LeafletPinFitter enabled={fitToPins} pins={pins} zoom={zoom} />
      {onMapClick && <LeafletClickHandler onMapClick={onMapClick} />}
      {onBoundsChanged && (
        <LeafletBoundsWatcher onBoundsChanged={onBoundsChanged} />
      )}
      {routePath.length >= 2 && (
        <Polyline
          positions={routePath.map((point) => [point.lat, point.lng])}
          interactive={false}
          pathOptions={{ color: "#ea580c", opacity: 0.92, weight: 5 }}
        />
      )}
      {trafficCells.map((cell) => (
        <Circle
          key={cell.id}
          center={[cell.lat, cell.lng]}
          radius={Math.max(110, Math.min(1200, (cell.weight || 1) * 10))}
          interactive={false}
          pathOptions={{
            stroke: false,
            fillColor:
              cell.color ||
              (cell.source === "google_places"
                ? "#60a5fa"
                : cell.source === "supply_signal"
                  ? "#ef4444"
                  : "#f97316"),
            fillOpacity:
              cell.source === "google_places"
                ? 0.1
                : cell.source === "supply_signal"
                  ? 0.14
                  : 0.12,
          }}
        />
      ))}
      <LeafletPins
        pins={pins}
        separateOverlappingPins={separateOverlappingPins || fitToPins}
        onPinClick={onPinClick}
        onPinDrag={onPinDrag}
      />
      {circleRadiusMetres && circleRadiusMetres > 0 && (
        <Circle
          center={[center.lat, center.lng]}
          radius={circleRadiusMetres}
          pathOptions={{
            color: "#f97316",
            fillColor: "#f97316",
            fillOpacity: 0.15,
          }}
        />
      )}
    </MapContainer>
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
  fitToPins = false,
  separateOverlappingPins = false,
  trafficCells = [],
  routePath = [],
  onBoundsChanged,
  circleRadiusMetres,
  className = "",
  interactionsEnabled = true,
  mapId: mapIdProp,
}: GoogleMapPickerProps) {
  const { data: mapRuntime } = useQuery<MapRuntimeResponse>({
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
          fitToPins={fitToPins}
          separateOverlappingPins={separateOverlappingPins}
          trafficCells={trafficCells}
          routePath={routePath}
          circleRadiusMetres={circleRadiusMetres}
          onMapClick={onMapClick}
          onPinDrag={onPinDrag}
          onPinClick={onPinClick}
          onBoundsChanged={onBoundsChanged}
          interactionsEnabled={interactionsEnabled}
          onLoadError={() => setGoogleFailed(true)}
        />
      ) : (
        <LeafletRenderer
          center={center}
          zoom={zoom}
          pins={pins}
          fitToPins={fitToPins}
          separateOverlappingPins={separateOverlappingPins}
          trafficCells={trafficCells}
          routePath={routePath}
          circleRadiusMetres={circleRadiusMetres}
          onMapClick={onMapClick}
          onPinDrag={onPinDrag}
          onPinClick={onPinClick}
          onBoundsChanged={onBoundsChanged}
          interactionsEnabled={interactionsEnabled}
        />
      )}
    </div>
  );
}
