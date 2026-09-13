import {
  events,
  eventInterests,
  eventSeries,
  type Event,
  type InsertEvent,
  type EventInterest,
  type InsertEventInterest,
  type EventSeries,
  type InsertEventSeries,
} from "@shared/schema";
import { db as applicationDb } from "../db";
import { buildCapacityFullError, shouldBlockAcceptance } from "../services/interestDecision";
import { eq, and, or, isNull, asc, desc, sql } from "drizzle-orm";

export function createHostsEventsRepository(db = applicationDb) {
  return {
    async createEvent(event: InsertEvent): Promise<Event> {
      const [newEvent] = await db.insert(events).values(event).returning();
      return newEvent;
    },

    async getEvent(id: string): Promise<Event | undefined> {
      const [event] = await db.select().from(events).where(eq(events.id, id));
      return event;
    },

    async getEventsByHost(
      hostId: string,
    ): Promise<(Event & { interests: EventInterest[] })[]> {
      return await db.query.events.findMany({
        where: eq(events.hostId, hostId),
        orderBy: asc(events.date),
        with: {
          interests: true,
        },
      });
    },

    async getEventsOwnedByUser(
      userId: string,
    ): Promise<(Event & { interests: EventInterest[] })[]> {
      return await db.query.events.findMany({
        where: or(
          eq(events.coordinatorUserId, userId),
          and(
            isNull(events.coordinatorUserId),
            sql<boolean>`exists (select 1 from hosts h where h.id = ${events.hostId} and h.user_id = ${userId})`,
          ),
        ),
        orderBy: asc(events.date),
        with: {
          interests: true,
        },
      });
    },

    async createEventInterest(
      interest: InsertEventInterest,
    ): Promise<EventInterest> {
      if (interest.status && interest.status !== "pending") {
        throw Object.assign(new Error("New event interests must be pending"), { status: 400 });
      }
      const [newInterest] = await db
        .insert(eventInterests)
        .values(interest)
        .returning();
      return newInterest;
    },

    async updateEventInterestStatus(
      id: string,
      status: string,
    ): Promise<EventInterest> {
      return db.transaction(async (tx: any) => {
        const [interest] = await tx.select().from(eventInterests).where(eq(eventInterests.id, id));
        if (!interest) throw Object.assign(new Error("Interest not found"), { status: 404 });
        // All decisions for an event share this lock, including declines that
        // release capacity. Re-read the decision after acquiring it.
        const [event] = await tx.select().from(events).where(eq(events.id, interest.eventId)).for("update");
        if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });
        const [current] = await tx.select().from(eventInterests).where(eq(eventInterests.id, id)).for("update");
        if (current.status === status) return current;
        if (status === "accepted") {
          const [count] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(eventInterests)
            .where(and(eq(eventInterests.eventId, event.id), eq(eventInterests.status, "accepted")));
          if (shouldBlockAcceptance({ hardCapEnabled: event.hardCapEnabled, maxTrucks: event.maxTrucks, acceptedCount: count.value })) {
            const error = buildCapacityFullError();
            throw Object.assign(new Error(error.message), { status: 409, code: error.code });
          }
        }
        const [updated] = await tx.update(eventInterests).set({ status }).where(eq(eventInterests.id, id)).returning();
        return updated;
      });
    },

    async getEventInterest(id: string): Promise<EventInterest | undefined> {
      const [interest] = await db
        .select()
        .from(eventInterests)
        .where(eq(eventInterests.id, id));
      return interest;
    },

    async getEventInterestByTruckId(
      eventId: string,
      truckId: string,
    ): Promise<EventInterest | undefined> {
      const [interest] = await db
        .select()
        .from(eventInterests)
        .where(
          and(
            eq(eventInterests.eventId, eventId),
            eq(eventInterests.truckId, truckId),
          ),
        );
      return interest;
    },

    async getEventInterestsByEventId(
      eventId: string,
    ): Promise<(EventInterest & { truck: any })[]> {
      return await db.query.eventInterests.findMany({
        where: eq(eventInterests.eventId, eventId),
        with: {
          truck: true,
        },
        orderBy: desc(eventInterests.createdAt),
      });
    },

    async createEventSeries(series: InsertEventSeries): Promise<EventSeries> {
      const [newSeries] = await db.insert(eventSeries).values(series).returning();
      return newSeries;
    },

    async getEventSeries(id: string): Promise<EventSeries | undefined> {
      const [series] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, id));
      return series;
    },

    async getEventSeriesByHost(hostId: string): Promise<EventSeries[]> {
      return await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.hostId, hostId))
        .orderBy(desc(eventSeries.createdAt));
    },

    async getEventSeriesOwnedByUser(userId: string): Promise<EventSeries[]> {
      return await db
        .select()
        .from(eventSeries)
        .where(
          or(
            eq(eventSeries.coordinatorUserId, userId),
            and(
              isNull(eventSeries.coordinatorUserId),
              sql<boolean>`exists (select 1 from hosts h where h.id = ${eventSeries.hostId} and h.user_id = ${userId})`,
            ),
          ),
        )
        .orderBy(desc(eventSeries.createdAt));
    },

    async updateEventSeries(
      id: string,
      updates: Partial<InsertEventSeries>,
    ): Promise<EventSeries> {
      const [updated] = await db
        .update(eventSeries)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(eventSeries.id, id))
        .returning();
      return updated;
    },

    async publishEventSeries(id: string): Promise<EventSeries> {
      const [published] = await db
        .update(eventSeries)
        .set({
          status: "published",
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(eventSeries.id, id))
        .returning();
      return published;
    },

    async getEventsBySeriesId(seriesId: string): Promise<Event[]> {
      return await db
        .select()
        .from(events)
        .where(eq(events.seriesId, seriesId))
        .orderBy(asc(events.date));
    },
  };
}
