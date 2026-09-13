import "dotenv/config";
import { and, isNull, or, isNotNull, eq } from "drizzle-orm";
import { db } from "../server/db";
import { forwardGeocode } from "../server/utils/geocoding";
import { restaurants } from "../shared/schema";

/**
 * Backfill map coordinates for `restaurants` rows that are missing lat/long.
 *
 * The existing scripts/backfillMapCoordinates.ts covers hosts, user_addresses,
 * and location_requests, but NOT the restaurants table — so imported food-truck
 * lead profiles never receive coordinates and cannot appear on the map.
 *
 * SAFETY:
 * - Default mode is DRY-RUN: no database writes and no geocoding API calls.
 *   It only reports how many rows are candidates and shows a sample.
 * - Pass --apply to actually call the geocoder and write coordinates.
 * - Pass --limit=N to cap how many rows are processed in --apply mode.
 * - Pass --active-only to restrict to active/claimed profiles.
 *
 * Examples:
 *   node --import tsx scripts/backfillRestaurantCoordinates.ts                 # dry-run report
 *   node --import tsx scripts/backfillRestaurantCoordinates.ts --apply --limit=50
 */

type GeoPoint = { lat: number; lng: number };

const buildAddress = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  [address, city, state, "USA"]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");

const parseLimit = (args: string[]): number | null => {
  const flag = args.find((arg) => arg.startsWith("--limit="));
  if (!flag) return null;
  const raw = Number(flag.split("=")[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
};

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const activeOnly = args.includes("--active-only");
  const limit = parseLimit(args);

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      address: restaurants.address,
      city: restaurants.city,
      state: restaurants.state,
      isActive: restaurants.isActive,
      isFoodTruck: restaurants.isFoodTruck,
      businessType: restaurants.businessType,
    })
    .from(restaurants)
    .where(
      and(
        or(isNull(restaurants.latitude), isNull(restaurants.longitude)),
        isNotNull(restaurants.address),
      ),
    );

  const candidates = rows
    .filter((r) => (activeOnly ? r.isActive === true : true))
    .filter((r) => buildAddress(r.address, r.city, r.state).trim().length > "USA".length + 1);

  const withCityState = candidates.filter(
    (r) => String(r.city || "").trim() && String(r.state || "").trim(),
  );
  const activeCount = candidates.filter((r) => r.isActive === true).length;

  console.log(`Mode: ${apply ? "APPLY (writes + geocoding API)" : "DRY-RUN (no writes, no API)"}`);
  console.log(`Restaurants missing coordinates with an address: ${candidates.length}`);
  console.log(`  active/claimed: ${activeCount}`);
  console.log(`  inactive (imports): ${candidates.length - activeCount}`);
  console.log(`  with city+state (higher geocode confidence): ${withCityState.length}`);

  if (!apply) {
    console.log("\nSample (first 15):");
    for (const r of candidates.slice(0, 15)) {
      console.log(
        `  - ${r.id} [${r.isActive ? "active" : "inactive"}] ${r.name} :: ${buildAddress(
          r.address,
          r.city,
          r.state,
        )}`,
      );
    }
    console.log(
      "\nDRY-RUN only: no rows changed and no geocoding API calls were made. Re-run with --apply to geocode + write.",
    );
    return;
  }

  const target = limit ? candidates.slice(0, limit) : candidates;
  console.log(`\nGeocoding + writing ${target.length} row(s)...`);

  let updated = 0;
  let skipped = 0;
  const addrCache = new Map<string, GeoPoint | null>();

  for (const row of target) {
    const fullAddress = buildAddress(row.address, row.city, row.state);
    const key = fullAddress.toLowerCase();
    let coords = addrCache.get(key);
    if (coords === undefined) {
      coords = await forwardGeocode(fullAddress);
      addrCache.set(key, coords ?? null);
    }
    if (!coords) {
      skipped += 1;
      console.log(`Skipped ${row.id} (${row.name}) -> no geocode match`);
      continue;
    }
    await db
      .update(restaurants)
      .set({
        latitude: coords.lat.toString(),
        longitude: coords.lng.toString(),
        geoEnrichedAt: new Date(),
      })
      .where(eq(restaurants.id, row.id));
    updated += 1;
    console.log(
      `Updated ${row.id} (${row.name}) -> ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
    );
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
}

run().catch((error) => {
  console.error("Restaurant coordinate backfill failed:", error);
  process.exit(1);
});
