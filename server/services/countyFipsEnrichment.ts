import { sql } from "drizzle-orm";

import { db } from "../db";
import { forwardGeocode } from "../utils/geocoding";
import { getCached, setCached } from "../utils/googleApiCache";

export type CountyFipsResult = {
  countyFips: string;
  countyName: string;
  stateCode: string;
};

const normalizeState = (value: unknown) =>
  String(value || "").trim().toUpperCase().slice(0, 2);

const normalizeCountyName = (value: unknown) =>
  String(value || "")
    .replace(/\s+County$/i, "")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const coordKey = (lat: number, lng: number) =>
  `${lat.toFixed(5)}:${lng.toFixed(5)}`;
const sqlString = (value: unknown) =>
  `'${String(value || "").replace(/'/g, "''")}'`;

async function lookupCountyByCoords(
  lat: number,
  lng: number,
): Promise<CountyFipsResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `coords:${coordKey(lat, lng)}`;
  const cached = await getCached<CountyFipsResult>("county_lookup", key);
  if (cached?.countyFips) return cached;

  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${encodeURIComponent(
    String(lng),
  )}&y=${encodeURIComponent(
    String(lat),
  )}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;

  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null);
  const county = data?.result?.geographies?.Counties?.[0];
  const state = data?.result?.geographies?.States?.[0];
  const countyCode = String(county?.COUNTY || "").padStart(3, "0");
  const stateCode = String(county?.STATE || state?.STATE || "").padStart(2, "0");
  if (!countyCode || !stateCode || countyCode === "000" || stateCode === "00") {
    return null;
  }

  const result = {
    countyFips: `${stateCode}${countyCode}`,
    countyName: normalizeCountyName(county?.NAME || county?.BASENAME),
    stateCode: normalizeState(state?.STUSAB || ""),
  };
  await setCached("county_lookup", key, result, null);
  return result;
}

export async function resolveCountyFips(input: {
  lat?: unknown;
  lng?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
}): Promise<CountyFipsResult | null> {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const byCoords = await lookupCountyByCoords(lat, lng);
    if (byCoords?.countyFips) return byCoords;
  }

  const address = [input.address, input.city, input.state, "USA"]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  if (!address) return null;

  const key = `address:${address.toLowerCase()}`;
  const cached = await getCached<CountyFipsResult>("county_lookup", key);
  if (cached?.countyFips) return cached;

  const coords = await forwardGeocode(address).catch(() => null);
  if (!coords) return null;
  const county = await lookupCountyByCoords(coords.lat, coords.lng);
  if (county?.countyFips) {
    await setCached("county_lookup", key, county, null);
    return county;
  }
  return null;
}

const TABLES = [
  {
    table: "restaurants",
    address: "address",
    city: "city",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
  {
    table: "truck_import_listings",
    address: "address",
    city: "city",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
  {
    table: "suppliers",
    address: "address",
    city: "city",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
  {
    table: "supply_store_locations",
    address: "address",
    city: "city",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
  {
    table: "user_addresses",
    address: "address",
    city: "city",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
  {
    table: "restaurant_submissions",
    address: "address",
    city: "county",
    state: "state",
    lat: "latitude",
    lng: "longitude",
  },
] as const;

export async function backfillCountyFips(limitPerTable = 100) {
  const results: Array<{ table: string; checked: number; enriched: number }> = [];
  const concurrency = 8;
  for (const config of TABLES) {
    const rows = await db.execute(
      sql.raw(`
        select id, ${config.address} as address, ${config.city} as city,
               ${config.state} as state, ${config.lat} as lat, ${config.lng} as lng
        from ${config.table}
        where county_fips is null or county_fips = ''
        limit ${Math.max(1, Math.min(1000, Math.floor(limitPerTable)))}
      `),
    );
    const list = (rows as any).rows || rows || [];
    let enriched = 0;
    for (let index = 0; index < list.length; index += concurrency) {
      const chunk = list.slice(index, index + concurrency);
      const updates = await Promise.all(
        chunk.map(async (row: any) => {
          const county = await resolveCountyFips(row);
          if (!county) return false;
          await db.execute(
            sql.raw(`
              update ${config.table}
              set county_fips = ${sqlString(county.countyFips)},
                  county_name = ${sqlString(county.countyName)},
                  geo_enriched_at = now()
              where id = ${sqlString(row.id)}
            `),
          );
          return true;
        }),
      );
      enriched += updates.filter(Boolean).length;
    }
    results.push({ table: config.table, checked: list.length, enriched });
  }
  return results;
}
