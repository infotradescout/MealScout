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
  onMarkerTap: (marker: MapAdapterMarker) => void;
  onFatalError?: (message: string) => void;
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

const mapStyleDark = [
  { elementType: "geometry", stylers: [{ color: "#1f2937" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#e5e7eb" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#374151" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0f172a" }],
  },
];

const markerColor = (kind: MapAdapterMarker["kind"]) => {
  switch (kind) {
    case "user":
      return "#2563EB";
    case "truck":
      return "#F97316";
    case "parking":
      return "#0EA5E9";
    case "event":
      return "#D946EF";
    case "deal":
      return "#22C55E";
    case "geo_ad":
      return "#EAB308";
    default:
      return "#F97316";
  }
};

const trafficCellColor = (source: MapTrafficCell["source"]) =>
  source === "google_places" ? "#60A5FA" : "#F97316";

const buildMarkerIcon = (googleMaps: any, marker: MapAdapterMarker) => {
  if (marker.kind === "parking") {
    return {
      url: mealScoutIcon,
      scaledSize: new googleMaps.Size(34, 34),
      anchor: new googleMaps.Point(17, 34),
    };
  }

  return {
    path: googleMaps.SymbolPath.CIRCLE,
    scale: marker.kind === "user" ? 8 : 7,
    fillColor: markerColor(marker.kind),
    fillOpacity: 0.95,
    strokeColor: "#111827",
    strokeWeight: 1,
  };
};

const buildAdvancedMarkerContent = (googleMaps: any, marker: MapAdapterMarker) => {
  if (marker.kind === "parking") {
    const img = document.createElement("img");
    img.src = mealScoutIcon;
    img.alt = marker.title || "Parking";
    img.width = 34;
    img.height = 34;
    img.style.width = "34px";
    img.style.height = "34px";
    return img;
  }

  const pinElCtor = googleMaps?.marker?.PinElement;
  if (pinElCtor) {
    const pin = new pinElCtor({
      background: markerColor(marker.kind),
      borderColor: "#111827",
      glyphColor: "#ffffff",
      scale: marker.kind === "user" ? 1.2 : 1,
    });
    return pin.element;
  }

  const dot = document.createElement("div");
  const size = marker.kind === "user" ? 16 : 14;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.borderRadius = "50%";
  dot.style.background = markerColor(marker.kind);
  dot.style.border = "1px solid #111827";
  return dot;
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

const loadGoogleMaps = async (apiKey: string) => {
  if (!apiKey) {
    throw new Error("Missing Google Maps API key");
  }
  const w = window as GoogleMapsWindow;
  if (w.google?.maps) return;
  if (w.__mealScoutGoogleMapsPromise) {
    try {
      await w.__mealScoutGoogleMapsPromise;
      if (w.google?.maps) return;
    } catch {
      // Retry from a clean state instead of pinning the app to a rejected promise.
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly&loading=async&libraries=marker`;
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

  const markerIndex = useMemo(
    () => new Map(markers.map((marker) => [marker.id, marker])),
    [markers],
  );

  useEffect(() => {
    hasReportedFatalErrorRef.current = false;
  }, [apiKey]);

  useEffect(() => {
    const w = window as GoogleMapsWindow;
    const previousAuthFailure = w.gm_authFailure;
    const handleAuthFailure = () => {
      if (typeof previousAuthFailure === "function") {
        try {
          previousAuthFailure();
        } catch {
          // ignore downstream handler errors
        }
      }
      const message =
        "Google Maps authorization failed for this domain. Falling back to legacy map.";
      setLoadError(message);
      if (!hasReportedFatalErrorRef.current) {
        hasReportedFatalErrorRef.current = true;
        onFatalError?.(message);
      }
    };

    w.gm_authFailure = handleAuthFailure;
    return () => {
      if (w.gm_authFailure === handleAuthFailure) {
        w.gm_authFailure = previousAuthFailure;
      }
    };
  }, [onFatalError]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (!mounted || !mapContainerRef.current) return;
        const googleMaps = (window as GoogleMapsWindow).google?.maps;
        if (!googleMaps) {
          throw new Error("Google Maps API unavailable after script load");
        }

        if (!mapRef.current) {
          const prefersFinePointer =
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(pointer: fine)").matches;

          mapRef.current = new googleMaps.Map(mapContainerRef.current, {
            center,
            zoom,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: false,
            // Desktop: capture wheel/pan when hovered (no Ctrl prompt).
            // Touch devices: keep native cooperative behavior.
            gestureHandling: prefersFinePointer ? "greedy" : "cooperative",
            styles: isNightTheme ? mapStyleDark : null,
          });

          mapRef.current.addListener("idle", () => {
            const currentBounds = mapRef.current?.getBounds?.();
            const currentZoom = Number(mapRef.current?.getZoom?.() || 0);
            if (Number.isFinite(currentZoom) && currentZoom > 0) {
              onZoomChanged(currentZoom);
            }
            if (!currentBounds) return;
            const ne = currentBounds.getNorthEast();
            const sw = currentBounds.getSouthWest();
            onBoundsChanged(
              createBoundsLike(
                Number(ne.lat()),
                Number(sw.lat()),
                Number(ne.lng()),
                Number(sw.lng()),
              ),
            );
          });

          // Ensure marker sync runs after first map instance initialization.
          setMapReadyVersion((prev) => prev + 1);
        } else {
          mapRef.current.setOptions({
            styles: isNightTheme ? mapStyleDark : null,
          });
        }

        setLoadError(null);
      } catch (error: any) {
        if (!mounted) return;
        const message =
          error?.message || "Unable to load Google Maps. Falling back to legacy map.";
        setLoadError(message);
        if (!hasReportedFatalErrorRef.current) {
          hasReportedFatalErrorRef.current = true;
          onFatalError?.(message);
        }
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [apiKey, center, zoom, isNightTheme, onBoundsChanged, onZoomChanged, onFatalError]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setCenter(center);
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!mapRef.current) return;
    const currentZoom = Number(mapRef.current.getZoom?.() || 0);
    if (!Number.isFinite(currentZoom) || currentZoom !== zoom) {
      mapRef.current.setZoom(zoom);
    }
  }, [zoom]);

  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    const usedIds = new Set<string>();
    markers.forEach((marker) => {
      usedIds.add(marker.id);
      const existing = markerRefs.current.get(marker.id);
      if (existing) {
        if (typeof existing.setPosition === "function") {
          existing.setPosition({ lat: marker.lat, lng: marker.lng });
        } else {
          existing.position = { lat: marker.lat, lng: marker.lng };
        }
        if (typeof existing.setIcon === "function") {
          existing.setIcon(buildMarkerIcon(googleMaps, marker));
        } else if ("content" in existing) {
          existing.content = buildAdvancedMarkerContent(googleMaps, marker);
        }
        return;
      }

      const AdvancedMarkerElement = googleMaps?.marker?.AdvancedMarkerElement;
      const instance = AdvancedMarkerElement
        ? new AdvancedMarkerElement({
            map: mapRef.current,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title || marker.subtitle || marker.kind,
            content: buildAdvancedMarkerContent(googleMaps, marker),
          })
        : new googleMaps.Marker({
            map: mapRef.current,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title || marker.subtitle || marker.kind,
            icon: buildMarkerIcon(googleMaps, marker),
          });
      instance.addListener("click", () => {
        const tapped = markerIndex.get(marker.id);
        if (tapped) onMarkerTap(tapped);
      });
      markerRefs.current.set(marker.id, instance);
    });

    Array.from(markerRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      removeMarkerFromMap(instance);
      markerRefs.current.delete(id);
    });
  }, [markers, markerIndex, onMarkerTap, mapReadyVersion]);

  useEffect(() => {
    const googleMaps = (window as GoogleMapsWindow).google?.maps;
    if (!googleMaps || !mapRef.current || mapReadyVersion === 0) return;

    const usedIds = new Set<string>();
    trafficCells.forEach((cell) => {
      usedIds.add(cell.id);
      const existing = trafficCircleRefs.current.get(cell.id);
      const radius = Math.max(80, Math.min(550, (cell.weight || 1) * 7));
      const style = {
        strokeColor: trafficCellColor(cell.source),
        strokeOpacity: 0.45,
        strokeWeight: 1,
        fillColor: trafficCellColor(cell.source),
        fillOpacity: cell.source === "google_places" ? 0.14 : 0.24,
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

    Array.from(trafficCircleRefs.current.entries()).forEach(([id, instance]) => {
      if (usedIds.has(id)) return;
      instance.setMap(null);
      trafficCircleRefs.current.delete(id);
    });
  }, [trafficCells, mapReadyVersion]);

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
    if (!roadTrafficLayerRef.current) {
      roadTrafficLayerRef.current = new googleMaps.TrafficLayer();
    }
    roadTrafficLayerRef.current.setMap(mapRef.current);
  }, [showRoadTrafficLayer, mapReadyVersion]);

  useEffect(() => {
    return () => {
      Array.from(trafficCircleRefs.current.values()).forEach((instance) => {
        instance.setMap(null);
      });
      trafficCircleRefs.current.clear();
      if (roadTrafficLayerRef.current) {
        roadTrafficLayerRef.current.setMap(null);
        roadTrafficLayerRef.current = null;
      }
    };
  }, []);

  const controlClassName = isNightTheme
    ? "w-11 h-11 p-0 rounded-full bg-[var(--bg-card)]/90 border border-white/20 shadow-clean-lg backdrop-blur text-[color:var(--text-primary)]"
    : "w-11 h-11 p-0 rounded-full bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean text-[color:var(--text-primary)]";

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainerRef} className="h-full w-full rounded-lg overflow-hidden" />
      <div className="absolute top-5 right-5 flex flex-col space-y-2 z-[1000]">
        <Button
          variant="secondary"
          size="sm"
          className={controlClassName}
          onClick={() => mapRef.current?.setZoom?.((mapRef.current?.getZoom?.() || zoom) + 1)}
          title="Zoom in"
        >
          +
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={controlClassName}
          onClick={() => mapRef.current?.setZoom?.((mapRef.current?.getZoom?.() || zoom) - 1)}
          title="Zoom out"
        >
          -
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={controlClassName}
          disabled={!userLocation}
          onClick={() => {
            if (!userLocation) return;
            mapRef.current?.setCenter?.(userLocation);
          }}
          title="Center on location"
        >
          <NavigationIcon className="w-4 h-4" />
        </Button>
      </div>
      {loadError && (
        <div className="absolute left-3 right-3 bottom-3 rounded-lg border border-[color:var(--status-error)]/30 bg-[color:var(--status-error)]/10 px-3 py-2 text-xs text-[color:var(--status-error)]">
          {loadError}
        </div>
      )}
    </div>
  );
}
