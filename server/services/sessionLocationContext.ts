import type { User } from "@shared/schema";

type LocationSource =
  | "admin_override"
  | "session_device"
  | "session_saved"
  | "user_default"
  | "super_admin_default"
  | "platform_default";

export interface LocationContext {
  marketKey: string;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source: LocationSource;
  updatedAt: string;
}

type SessionLocationPayload = {
  marketKey?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  updatedAt?: string | null;
};

const DEFAULT_SUPER_ADMIN_MARKET = "pensacola-fl";
const DEFAULT_PLATFORM_MARKET = String(
  process.env.MEALSCOUT_DEFAULT_MARKET || "us-default",
).trim();

const normalizeMarketKey = (value: unknown): string => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
};

const normalizeSessionLocation = (
  value: SessionLocationPayload | null | undefined,
): SessionLocationPayload | null => {
  if (!value || typeof value !== "object") return null;
  const marketKey = normalizeMarketKey(value.marketKey);
  if (!marketKey) return null;
  return {
    marketKey,
    city: value.city ? String(value.city).trim() : null,
    state: value.state ? String(value.state).trim() : null,
    latitude:
      typeof value.latitude === "number" && Number.isFinite(value.latitude)
        ? value.latitude
        : null,
    longitude:
      typeof value.longitude === "number" && Number.isFinite(value.longitude)
        ? value.longitude
        : null,
    updatedAt: value.updatedAt ? String(value.updatedAt) : null,
  };
};

const normalizeUserDefaultLocation = (
  user: Pick<User, "userType" | "accountSettings"> | null | undefined,
): SessionLocationPayload | null => {
  const settings =
    user?.accountSettings && typeof user.accountSettings === "object"
      ? (user.accountSettings as any)
      : null;
  const territory = settings?.defaultTerritory || settings?.defaultLocation || null;
  return normalizeSessionLocation(territory);
};

const asLocationContext = (
  payload: SessionLocationPayload,
  source: LocationSource,
): LocationContext => ({
  marketKey: String(payload.marketKey || ""),
  city: payload.city ?? null,
  state: payload.state ?? null,
  latitude: payload.latitude ?? null,
  longitude: payload.longitude ?? null,
  source,
  updatedAt: payload.updatedAt || new Date().toISOString(),
});

export function resolveEffectiveLocationContext(
  req: any,
  user?: Pick<User, "userType" | "accountSettings"> | null,
): LocationContext {
  const session = req?.session || {};

  const adminOverride = normalizeSessionLocation(session.adminMarketSelection);
  if (adminOverride) {
    return asLocationContext(adminOverride, "admin_override");
  }

  const deviceLocation = normalizeSessionLocation(session.deviceLocationContext);
  if (deviceLocation) {
    return asLocationContext(deviceLocation, "session_device");
  }

  const savedSessionLocation = normalizeSessionLocation(session.savedLocationContext);
  if (savedSessionLocation) {
    return asLocationContext(savedSessionLocation, "session_saved");
  }

  const userDefault = normalizeUserDefaultLocation(user);
  if (userDefault) {
    return asLocationContext(userDefault, "user_default");
  }

  if (String(user?.userType || "") === "super_admin") {
    return {
      marketKey: DEFAULT_SUPER_ADMIN_MARKET,
      city: "Pensacola",
      state: "FL",
      latitude: null,
      longitude: null,
      source: "super_admin_default",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    marketKey: normalizeMarketKey(DEFAULT_PLATFORM_MARKET) || "us-default",
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    source: "platform_default",
    updatedAt: new Date().toISOString(),
  };
}
