import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  eventBookings,
  events,
  hosts,
  parkingPassPurchases,
  restaurants,
  users,
} from "@shared/schema";
import { db } from "../db";
import { publicTruckClassificationWhere } from "../seo/publicTruckClassification";
import { isPublicRestaurantIndexable } from "../seo/publicRestaurantIndexability";
import { projectPublicRestaurantMedia } from "../publicProfiles/toPublicRestaurantProfile";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { publicParkingPassBookingSqlCondition } from "./truckOperatingPlan";

export type ConfirmedEventTruck = {
  bookingId: string;
  eventId: string;
  truckId: string;
  name: string;
  cuisineType: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  bookingConfirmedAt: Date | null;
  isPublicIndexable: boolean;
};

export const filterPublicConfirmedEventTrucks = (
  rows: ConfirmedEventTruck[],
) => rows.filter((row) => row.isPublicIndexable);

export async function loadConfirmedEventTrucks(eventIds: string[]) {
  const ids = Array.from(
    new Set(eventIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  const byEvent = new Map<string, ConfirmedEventTruck[]>();
  if (ids.length === 0) return byEvent;

  const rows = await db
    .select({
      bookingId: eventBookings.id,
      eventId: eventBookings.eventId,
      hostId: events.hostId,
      truckId: restaurants.id,
      name: restaurants.name,
      cuisineType: restaurants.cuisineType,
      city: restaurants.city,
      state: restaurants.state,
      logoUrl: restaurants.logoUrl,
      coverImageUrl: restaurants.coverImageUrl,
      bookingConfirmedAt: eventBookings.bookingConfirmedAt,
      isActive: restaurants.isActive,
      ownerId: restaurants.ownerId,
      ownerEmail: users.email,
      address: restaurants.address,
      description: restaurants.description,
      rawData: restaurants.rawData,
      phone: restaurants.phone,
      websiteUrl: restaurants.websiteUrl,
    })
    .from(eventBookings)
    .innerJoin(events, eq(eventBookings.eventId, events.id))
    .leftJoin(
      parkingPassPurchases,
      eq(eventBookings.purchaseId, parkingPassPurchases.id),
    )
    .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
    .innerJoin(users, eq(restaurants.ownerId, users.id))
    .where(
      and(
        inArray(eventBookings.eventId, ids),
        eq(eventBookings.status, "confirmed"),
        publicParkingPassBookingSqlCondition,
        isNotNull(eventBookings.bookingConfirmedAt),
        eq(restaurants.isActive, true),
        eq(users.isDisabled, false),
        publicTruckClassificationWhere(
          restaurants.isFoodTruck,
          restaurants.businessType,
        ),
      ),
    )
    .orderBy(
      asc(eventBookings.eventId),
      asc(eventBookings.bookingConfirmedAt),
      asc(eventBookings.id),
    );

  const hostIds: string[] = Array.from(
    new Set<string>(
      rows
        .map((row: { hostId: unknown }) => String(row.hostId || "").trim())
        .filter(Boolean),
    ),
  );
  const hostAuthorityRows = hostIds.length
    ? await db
        .select({
          hostId: hosts.id,
          ownerDisabled: users.isDisabled,
          publicProfileSettings: users.publicProfileSettings,
        })
        .from(hosts)
        .innerJoin(users, eq(hosts.userId, users.id))
        .where(inArray(hosts.id, hostIds))
    : [];
  const publicHostIds = new Set(
    hostAuthorityRows
      .filter(
        (row: {
          ownerDisabled: boolean | null;
          publicProfileSettings: unknown;
        }) =>
          row.ownerDisabled === false &&
          resolvePublicProfileVisibility(row.publicProfileSettings).showAddress,
      )
      .map((row: { hostId: unknown }) => String(row.hostId)),
  );

  for (const row of rows) {
    if (!publicHostIds.has(String(row.hostId))) continue;
    const eventId = String(row.eventId);
    const existing = byEvent.get(eventId) || [];
    if (existing.some((truck) => truck.truckId === String(row.truckId))) {
      continue;
    }
    const publicMedia = projectPublicRestaurantMedia(row);
    const candidate: ConfirmedEventTruck = {
      bookingId: String(row.bookingId),
      eventId,
      truckId: String(row.truckId),
      name: String(row.name || "Food truck"),
      cuisineType: row.cuisineType ? String(row.cuisineType) : null,
      city: row.city ? String(row.city) : null,
      state: row.state ? String(row.state) : null,
      logoUrl: publicMedia.logoUrl,
      coverImageUrl: publicMedia.coverImageUrl,
      bookingConfirmedAt: row.bookingConfirmedAt || null,
      isPublicIndexable: isPublicRestaurantIndexable({
        name: row.name,
        isActive: row.isActive,
        ownerId: row.ownerId,
        ownerEmail: row.ownerEmail,
        address: row.address,
        cuisineType: row.cuisineType,
        description: row.description,
        city: row.city,
        state: row.state,
        rawData: row.rawData,
        phone: row.phone,
        websiteUrl: row.websiteUrl,
      }),
    };
    if (!candidate.isPublicIndexable) continue;
    existing.push(candidate);
    byEvent.set(eventId, existing);
  }

  return byEvent;
}
