import { and, asc, eq, inArray } from "drizzle-orm";
import {
  eventBookings,
  events,
  hosts,
  parkingPassArrivalVersions,
  parkingPassPurchases,
  users,
} from "@shared/schema";
import { db } from "../db";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { publicPaidParticipationSqlCondition } from "./publicParkingPassEligibility";

export type PublicParkingPassProjection = {
  bookingId: string;
  eventId: string;
  truckId: string;
  hostId: string;
  locationName: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date;
  endsAt: Date;
  addressPublicLabel: string | null;
};

const roundCoordinate = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const floorHalfHour = (date: Date) => {
  const value = new Date(date);
  value.setUTCMinutes(value.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return value;
};

const ceilHalfHour = (date: Date) => {
  const value = new Date(date);
  const minute = value.getUTCMinutes();
  if (minute === 0 || minute === 30) {
    value.setUTCSeconds(0, 0);
    return value;
  }
  value.setUTCMinutes(minute < 30 ? 30 : 60, 0, 0);
  return value;
};

/**
 * Anonymous paid-booking projection. It is rebuilt from the currently
 * acknowledged version and current host consent, then coarse-grains place and
 * time. Street address, exact coordinates, access, and safety facts never
 * leave the protected arrival aggregate.
 */
export async function loadPublicParkingPassProjections(input: {
  eventIds: string[];
  database?: any;
}) {
  const eventIds = Array.from(
    new Set(input.eventIds.map(String).map((id) => id.trim()).filter(Boolean)),
  );
  const byEventId = new Map<string, PublicParkingPassProjection>();
  if (eventIds.length === 0) return byEventId;
  const database = input.database || db;
  const rows = await database
    .select({
      bookingId: eventBookings.id,
      eventId: eventBookings.eventId,
      truckId: eventBookings.truckId,
      hostId: eventBookings.hostId,
      locationName: hosts.businessName,
      ownerDisabled: users.isDisabled,
      publicProfileSettings: users.publicProfileSettings,
      city: parkingPassArrivalVersions.city,
      state: parkingPassArrivalVersions.stateCode,
      latitude: parkingPassArrivalVersions.latitude,
      longitude: parkingPassArrivalVersions.longitude,
      startsAt: parkingPassArrivalVersions.startAt,
      endsAt: parkingPassArrivalVersions.endAt,
    })
    .from(eventBookings)
    .innerJoin(events, eq(events.id, eventBookings.eventId))
    .innerJoin(
      parkingPassPurchases,
      eq(parkingPassPurchases.id, eventBookings.purchaseId),
    )
    .innerJoin(
      parkingPassArrivalVersions,
      and(
        eq(
          parkingPassArrivalVersions.id,
          eventBookings.currentArrivalVersionId,
        ),
        eq(parkingPassArrivalVersions.bookingId, eventBookings.id),
      ),
    )
    .innerJoin(hosts, eq(hosts.id, eventBookings.hostId))
    .innerJoin(users, eq(users.id, hosts.userId))
    .where(
      and(
        inArray(eventBookings.eventId, eventIds),
        eq(events.requiresPayment, true),
        publicPaidParticipationSqlCondition,
        eq(users.isDisabled, false),
      ),
    )
    .orderBy(asc(eventBookings.eventId), asc(eventBookings.id));

  for (const row of rows) {
    const eventId = String(row.eventId);
    if (byEventId.has(eventId)) continue;
    if (
      !resolvePublicProfileVisibility(row.publicProfileSettings).showAddress
    ) {
      continue;
    }
    const start = row.startsAt instanceof Date
      ? row.startsAt
      : new Date(String(row.startsAt));
    const end = row.endsAt instanceof Date
      ? row.endsAt
      : new Date(String(row.endsAt));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      continue;
    }
    const city = String(row.city || "").trim() || null;
    const state = String(row.state || "").trim() || null;
    byEventId.set(eventId, {
      bookingId: String(row.bookingId),
      eventId,
      truckId: String(row.truckId),
      hostId: String(row.hostId),
      locationName: String(row.locationName || "").trim() || null,
      city,
      state,
      latitude: roundCoordinate(row.latitude),
      longitude: roundCoordinate(row.longitude),
      startsAt: floorHalfHour(start),
      endsAt: ceilHalfHour(end),
      addressPublicLabel: [city, state].filter(Boolean).join(", ") || null,
    });
  }
  return byEventId;
}
