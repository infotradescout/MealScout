import { desc } from "drizzle-orm";
import { hosts, restaurants } from "@shared/schema";
import { db } from "../db";
import {
  shouldAttemptGoogleHostAutoLink,
  shouldAttemptGoogleRestaurantAutoLink,
} from "./googleBusinessAutoLink";
import {
  populateHostProfile,
  populateRestaurantProfile,
} from "./googleProfileService";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const boundedLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(Math.floor(parsed), max));
};

export async function runGoogleBusinessAutoLinkBackfill(options: {
  restaurantLimit?: number;
  hostLimit?: number;
  delayMs?: number;
  context?: string;
} = {}) {
  const restaurantLimit = boundedLimit(
    options.restaurantLimit ?? process.env.GOOGLE_AUTOLINK_RESTAURANT_LIMIT,
    12,
    60,
  );
  const hostLimit = boundedLimit(
    options.hostLimit ?? process.env.GOOGLE_AUTOLINK_HOST_LIMIT,
    8,
    40,
  );
  const delayMs = boundedLimit(
    options.delayMs ?? process.env.GOOGLE_AUTOLINK_DELAY_MS,
    350,
    5000,
  );

  const [restaurantRows, hostRows] = await Promise.all([
    restaurantLimit > 0
      ? db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            businessType: restaurants.businessType,
            claimedFromImportId: restaurants.claimedFromImportId,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            isFoodTruck: restaurants.isFoodTruck,
            description: restaurants.description,
            websiteUrl: restaurants.websiteUrl,
            googlePlaceId: restaurants.googlePlaceId,
            googlePhotos: restaurants.googlePhotos,
            profileSource: restaurants.profileSource,
            createdAt: restaurants.createdAt,
          })
          .from(restaurants)
          .orderBy(desc(restaurants.createdAt))
          .limit(Math.max(restaurantLimit * 4, restaurantLimit))
      : Promise.resolve([]),
    hostLimit > 0
      ? db
          .select({
            id: hosts.id,
            businessName: hosts.businessName,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            contactPhone: hosts.contactPhone,
            description: hosts.description,
            businessWebsite: hosts.businessWebsite,
            googlePlaceId: hosts.googlePlaceId,
            googlePhotos: hosts.googlePhotos,
            profileSource: hosts.profileSource,
            createdAt: hosts.createdAt,
          })
          .from(hosts)
          .orderBy(desc(hosts.createdAt))
          .limit(Math.max(hostLimit * 4, hostLimit))
      : Promise.resolve([]),
  ]);

  const restaurantTargets = (restaurantRows as any[])
    .filter(shouldAttemptGoogleRestaurantAutoLink)
    .slice(0, restaurantLimit);
  const hostTargets = (hostRows as any[])
    .filter(shouldAttemptGoogleHostAutoLink)
    .slice(0, hostLimit);

  const result = {
    ok: true,
    context: options.context || "google-autolink",
    evaluated: {
      restaurants: restaurantRows.length,
      hosts: hostRows.length,
    },
    attempted: {
      restaurants: restaurantTargets.length,
      hosts: hostTargets.length,
    },
    linked: {
      restaurants: 0,
      hosts: 0,
    },
    failed: {
      restaurants: 0,
      hosts: 0,
    },
  };

  for (const row of restaurantTargets) {
    try {
      const populated = await populateRestaurantProfile(String(row.id));
      if (populated.success) result.linked.restaurants += 1;
      else result.failed.restaurants += 1;
    } catch (error) {
      result.failed.restaurants += 1;
      console.warn("[google-autolink] restaurant backfill failed", {
        restaurantId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (delayMs > 0) await delay(delayMs);
  }

  for (const row of hostTargets) {
    try {
      const populated = await populateHostProfile(String(row.id));
      if (populated.success) result.linked.hosts += 1;
      else result.failed.hosts += 1;
    } catch (error) {
      result.failed.hosts += 1;
      console.warn("[google-autolink] host backfill failed", {
        hostId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (delayMs > 0) await delay(delayMs);
  }

  return result;
}
