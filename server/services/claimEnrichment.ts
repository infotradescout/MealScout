import { eq } from "drizzle-orm";
import { db } from "../db";
import { restaurants } from "@shared/schema";
import { forwardGeocode } from "../utils/geocoding";

/**
 * Claim-time Google enrichment.
 *
 * Runs when a business is CLAIMED (ownership transferred to a real user), so the
 * cost of paid Google calls scales with real adoption, not the unclaimed lead pool.
 *
 * Currently fills MISSING map coordinates via Google geocoding so the claimed
 * profile can appear on the map. It never overwrites owner-provided data.
 * (Photos are intentionally NOT fetched — category placeholders cover visuals.)
 *
 * Safe by design: graceful no-op if the address is missing or geocoding is
 * unavailable; never throws into the claim request path.
 */
export async function enrichClaimedRestaurant(restaurantId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: restaurants.id,
        address: restaurants.address,
        city: restaurants.city,
        state: restaurants.state,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!row) return;

    // Only geocode when coordinates are missing (never overwrite existing).
    if (row.latitude && row.longitude) return;

    const fullAddress = [row.address, row.city, row.state, "USA"]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", ");
    if (fullAddress.length <= "USA".length + 1) return;

    const coords = await forwardGeocode(fullAddress);
    if (!coords) return;

    await db
      .update(restaurants)
      .set({
        latitude: coords.lat.toString(),
        longitude: coords.lng.toString(),
        geoEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(restaurants.id, restaurantId));

    console.info(
      `[claim-enrichment] geocoded ${restaurantId} -> ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
    );
  } catch (error) {
    // Never let enrichment break the claim flow.
    console.error("[claim-enrichment] failed", error);
  }
}
