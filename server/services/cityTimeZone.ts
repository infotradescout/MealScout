import { db } from "../db";
import { cities } from "@shared/schema";
import { and, eq, ilike, or } from "drizzle-orm";

export function usStateToTimeZone(state: string | null | undefined): string {
  const abbr = String(state || "")
    .trim()
    .toUpperCase();
  if (abbr === "AZ") return "America/Phoenix";
  const pacific = new Set(["CA", "OR", "WA", "NV"]);
  const mountain = new Set(["CO", "ID", "MT", "NM", "UT", "WY"]);
  const central = new Set([
    "AL",
    "AR",
    "IL",
    "IA",
    "KS",
    "KY",
    "LA",
    "MN",
    "MS",
    "MO",
    "ND",
    "NE",
    "OK",
    "SD",
    "TN",
    "TX",
    "WI",
  ]);
  const eastern = new Set([
    "CT",
    "DC",
    "DE",
    "FL",
    "GA",
    "IN",
    "MA",
    "MD",
    "ME",
    "MI",
    "NC",
    "NH",
    "NJ",
    "NY",
    "OH",
    "PA",
    "RI",
    "SC",
    "VA",
    "VT",
    "WV",
  ]);

  if (pacific.has(abbr)) return "America/Los_Angeles";
  if (mountain.has(abbr)) return "America/Denver";
  if (central.has(abbr)) return "America/Chicago";
  if (eastern.has(abbr)) return "America/New_York";
  return "America/Chicago";
}

const FL_PANHANDLE_CITY_HINT =
  /\b(pensacola|gulf\s*breeze|navarre|pace|milton|cantonment|crestview|niceville|fort\s*walton|destin|panama\s*city|lynn\s*haven)\b/i;

export function resolveCityTimeZoneSync(params: {
  city?: string | null;
  state?: string | null;
}): string {
  const city = String(params.city || "").trim();
  const state = String(params.state || "")
    .trim()
    .toUpperCase();

  if (state === "FL") {
    // Most of Florida is Eastern. The far-west panhandle is Central.
    return city && FL_PANHANDLE_CITY_HINT.test(city)
      ? "America/Chicago"
      : "America/New_York";
  }

  return usStateToTimeZone(state);
}

export async function resolveCityTimeZone(params: {
  city?: string | null;
  state?: string | null;
}): Promise<string> {
  const city = String(params.city || "").trim();
  const state = String(params.state || "")
    .trim()
    .toUpperCase();
  if (!city) return resolveCityTimeZoneSync({ city, state });

  // Prefer exact slug match where possible, but city pages often store plain names.
  const cityLike = `%${city}%`;
  const rows = await db
    .select({ timezone: cities.timezone, state: cities.state })
    .from(cities)
    .where(
      and(
        or(
          ilike(cities.name, cityLike),
          eq(cities.slug, city.toLowerCase().replace(/[^a-z0-9-]+/g, "-")),
        ),
        state ? eq(cities.state, state) : undefined,
      ),
    )
    .limit(1);

  const tz = String(rows?.[0]?.timezone || "").trim();
  if (tz) return tz;
  return resolveCityTimeZoneSync({ city, state: state || rows?.[0]?.state });
}

function isValidIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function resolveCityTimeZoneStrict(params: {
  city?: string | null;
  state?: string | null;
}): Promise<string | null> {
  const city = String(params.city || "").trim();
  const state = String(params.state || "")
    .trim()
    .toUpperCase();
  if (!city || !state) return null;

  const slug = city.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const rows = await db
    .select({ timezone: cities.timezone })
    .from(cities)
    .where(
      and(
        or(ilike(cities.name, city), eq(cities.slug, slug)),
        eq(cities.state, state),
      ),
    )
    .limit(10);

  const timeZones = new Set<string>(
    (rows as Array<{ timezone: string | null }>)
      .map((row: { timezone: string | null }) =>
        String(row.timezone || "").trim(),
      )
      .filter(
        (timeZone: string) =>
          Boolean(timeZone) && isValidIanaTimeZone(timeZone),
      ),
  );
  return timeZones.size === 1 ? [...timeZones][0] : null;
}
