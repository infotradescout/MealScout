import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { eventBookings, restaurants } from "@shared/schema";
import { db } from "../db";

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
};

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
      truckId: restaurants.id,
      name: restaurants.name,
      cuisineType: restaurants.cuisineType,
      city: restaurants.city,
      state: restaurants.state,
      logoUrl: restaurants.logoUrl,
      coverImageUrl: restaurants.coverImageUrl,
      bookingConfirmedAt: eventBookings.bookingConfirmedAt,
    })
    .from(eventBookings)
    .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
    .where(
      and(
        inArray(eventBookings.eventId, ids),
        eq(eventBookings.status, "confirmed"),
        isNotNull(eventBookings.bookingConfirmedAt),
        eq(restaurants.isActive, true),
        or(
          eq(restaurants.isFoodTruck, true),
          inArray(restaurants.businessType, [
            "food_truck",
            "truck",
            "food-truck",
            "foodtruck",
            "mobile_food_vendor",
          ]),
        ),
      ),
    )
    .orderBy(
      asc(eventBookings.eventId),
      asc(eventBookings.bookingConfirmedAt),
      asc(eventBookings.id),
    );

  for (const row of rows) {
    const eventId = String(row.eventId);
    const existing = byEvent.get(eventId) || [];
    if (existing.some((truck) => truck.truckId === String(row.truckId))) {
      continue;
    }
    existing.push({
      bookingId: String(row.bookingId),
      eventId,
      truckId: String(row.truckId),
      name: String(row.name || "Food truck"),
      cuisineType: row.cuisineType ? String(row.cuisineType) : null,
      city: row.city ? String(row.city) : null,
      state: row.state ? String(row.state) : null,
      logoUrl: row.logoUrl ? String(row.logoUrl) : null,
      coverImageUrl: row.coverImageUrl ? String(row.coverImageUrl) : null,
      bookingConfirmedAt: row.bookingConfirmedAt || null,
    });
    byEvent.set(eventId, existing);
  }

  return byEvent;
}
