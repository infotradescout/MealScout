import { db } from "../db";
import { cities } from "@shared/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  resolveCityTimeZoneSync,
  usStateToTimeZone,
} from "./cityTimeZoneRules";

export { resolveCityTimeZoneSync, usStateToTimeZone };

export async function resolveCityTimeZone(params: {
  city?: string | null;
  state?: string | null;
}): Promise<string> {
  const timeZone = await resolveCityTimeZoneStrict(params);
  if (!timeZone) {
    throw new Error("persisted_city_timezone_unavailable");
  }
  return timeZone;
}

export function isValidIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveUniquePersistedTimeZoneRows(
  rows: Array<{ timezone: string | null | undefined }>,
): string | null {
  const timeZones = new Set<string>(
    rows
      .map((row) => String(row.timezone || "").trim())
      .filter(
        (timeZone) => Boolean(timeZone) && isValidIanaTimeZone(timeZone),
      ),
  );
  return timeZones.size === 1 ? [...timeZones][0] : null;
}

export async function resolveCityTimeZoneStrict(params: {
  city?: string | null;
  state?: string | null;
}, database: any = db): Promise<string | null> {
  const city = String(params.city || "").trim();
  const state = String(params.state || "")
    .trim()
    .toUpperCase();
  if (!city || !state) return null;

  const slug = city.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const rows = await database
    .select({ timezone: cities.timezone })
    .from(cities)
    .where(
      and(
        or(ilike(cities.name, city), eq(cities.slug, slug)),
        eq(cities.state, state),
      ),
    );

  // Never cap this evidence set. A conflicting persisted row after an
  // arbitrary LIMIT would otherwise make a venue appear unambiguous.
  return resolveUniquePersistedTimeZoneRows(
    rows as Array<{ timezone: string | null }>,
  );
}
