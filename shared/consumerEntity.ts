export type Coordinates = {
  latitude: number;
  longitude: number;
};

export const DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS = 4 * 60 * 60 * 1000;

export type TruckPresence = {
  broadcastState: "offline" | "live" | "stale" | "unknown";
  location: (Coordinates & {
    accuracyMeters: number | null;
    capturedAt: string;
    source: "owner_gps" | "manual" | "imported" | "unknown";
  }) | null;
  liveUntilAt: string | null;
  reason:
    | "fresh_broadcast"
    | "broadcast_expired"
    | "missing_timestamp"
    | "missing_coordinates"
    | "disabled"
    | "unavailable";
};

export type LegacyTruckPresenceInput = {
  mobileOnline?: boolean | null;
  liveBroadcasting?: boolean | null;
  currentLatitude?: unknown;
  currentLongitude?: unknown;
  lastBroadcastAt?: string | Date | null;
  liveUntilAt?: string | Date | null;
  locationSource?: unknown;
  gpsAccuracy?: unknown;
};

export type TruckCoordinateInput = LegacyTruckPresenceInput & {
  latitude?: unknown;
  longitude?: unknown;
  lat?: unknown;
  lng?: unknown;
};

export type VisitStatus = {
  state:
    | "live_now"
    | "scheduled"
    | "open"
    | "closed"
    | "unavailable"
    | "unknown";
  label: string;
  evidence:
    | { kind: "live_broadcast"; capturedAt: string }
    | { kind: "scheduled_stop"; stopId: string | null }
    | { kind: "operating_hours"; evaluatedAt: string }
    | { kind: "none" };
  directionsTarget: Coordinates | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const parsed =
    typeof normalized === "number" ? normalized : Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoordinates(
  latitude: number | null,
  longitude: number | null,
): latitude is number {
  return (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function resolveCoordinatePair(
  latitudeValue: unknown,
  longitudeValue: unknown,
): Coordinates | null {
  const latitude = finiteNumber(latitudeValue);
  const longitude = finiteNumber(longitudeValue);
  if (!validCoordinates(latitude, longitude)) return null;
  return { latitude, longitude: longitude as number };
}

function isoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeSource(
  value: unknown,
): "owner_gps" | "manual" | "imported" | "unknown" {
  const source = String(value || "").trim().toLowerCase();
  if (
    source === "owner_gps" ||
    source === "gps" ||
    source === "mobile" ||
    source === "live"
  ) {
    return "owner_gps";
  }
  if (source === "manual") return "manual";
  if (source === "imported" || source === "import") return "imported";
  return "unknown";
}

export function deriveTruckPresence(
  input: LegacyTruckPresenceInput | null | undefined,
  options: { now?: Date; freshnessMs: number },
): TruckPresence {
  if (!input) {
    return {
      broadcastState: "unknown",
      location: null,
      liveUntilAt: null,
      reason: "unavailable",
    };
  }

  const enabled = input.mobileOnline === true || input.liveBroadcasting === true;
  if (!enabled) {
    return {
      broadcastState: "offline",
      location: null,
      liveUntilAt: isoDate(input.liveUntilAt),
      reason: "disabled",
    };
  }

  const latitude = finiteNumber(input.currentLatitude);
  const longitude = finiteNumber(input.currentLongitude);
  if (!validCoordinates(latitude, longitude)) {
    return {
      broadcastState: "stale",
      location: null,
      liveUntilAt: isoDate(input.liveUntilAt),
      reason: "missing_coordinates",
    };
  }

  const capturedAt = isoDate(input.lastBroadcastAt);
  if (!capturedAt) {
    return {
      broadcastState: "stale",
      location: null,
      liveUntilAt: isoDate(input.liveUntilAt),
      reason: "missing_timestamp",
    };
  }

  const now = options.now ?? new Date();
  const liveUntilAt = isoDate(input.liveUntilAt);
  const capturedTime = new Date(capturedAt).getTime();
  const expiredByDeadline =
    liveUntilAt !== null && new Date(liveUntilAt).getTime() <= now.getTime();
  const expiredByFreshness =
    options.freshnessMs <= 0 ||
    now.getTime() - capturedTime > options.freshnessMs ||
    capturedTime > now.getTime() + 60_000;

  const location = {
    latitude,
    longitude: longitude as number,
    accuracyMeters: finiteNumber(input.gpsAccuracy),
    capturedAt,
    source: normalizeSource(input.locationSource),
  };

  if (expiredByDeadline || expiredByFreshness) {
    return {
      broadcastState: "stale",
      location,
      liveUntilAt,
      reason: "broadcast_expired",
    };
  }

  return {
    broadcastState: "live",
    location,
    liveUntilAt,
    reason: "fresh_broadcast",
  };
}

/**
 * Resolves one trustworthy coordinate pair for a truck without ever mixing
 * live and static axes. Fresh live coordinates win; otherwise a complete,
 * valid static profile pair is used.
 */
export function resolveTruckCoordinates(
  input: TruckCoordinateInput | null | undefined,
  options: { now?: Date; freshnessMs: number },
): Coordinates | null {
  if (!input) return null;

  const presence = deriveTruckPresence(
    {
      mobileOnline: input.mobileOnline,
      liveBroadcasting: input.liveBroadcasting,
      currentLatitude: input.currentLatitude,
      currentLongitude: input.currentLongitude,
      lastBroadcastAt: input.lastBroadcastAt,
      liveUntilAt: input.liveUntilAt,
      locationSource: input.locationSource,
      gpsAccuracy: input.gpsAccuracy,
    },
    options,
  );
  if (presence.broadcastState === "live" && presence.location) {
    return {
      latitude: presence.location.latitude,
      longitude: presence.location.longitude,
    };
  }

  return (
    resolveCoordinatePair(input.latitude, input.longitude) ??
    resolveCoordinatePair(input.lat, input.lng)
  );
}

export function visitStatusFromPresence(
  presence: TruckPresence,
): VisitStatus | null {
  if (presence.broadcastState !== "live" || !presence.location) return null;
  return {
    state: "live_now",
    label: "Live now",
    evidence: {
      kind: "live_broadcast",
      capturedAt: presence.location.capturedAt,
    },
    directionsTarget: {
      latitude: presence.location.latitude,
      longitude: presence.location.longitude,
    },
  };
}
