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
import { db } from "../db";
import { eq, and, or, isNull, asc, desc, sql } from "drizzle-orm";

const coerceEventDate = (value: unknown) => {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) {
    const date = new Date(`${value.trim()}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return value;
};

const normalizeEventCreatePayload = (event: InsertEvent): InsertEvent => {
  const payload: any = {
    ...(event as any),
    date: coerceEventDate((event as any).date),
  };

  const eventType = String(payload.eventType || "").toLowerCase();
  const currentStatus = String(payload.status || "").trim();
  if (!currentStatus) {
    if (eventType === "private_event") {
      payload.status = "open";
    } else if (eventType === "event") {
      payload.status = "published";
    }
  }

  return payload as InsertEvent;
};

export function createHostsEventsRepository() {
  return {
    async createEvent(event: InsertEvent): Promise<Event> {
      const payload = normalizeEventCreatePayload(event);
      const [newEvent] = await db.insert(events).values(payload).returning();
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
      const [updated] = await db
        .update(eventInterests)
        .set({ status })
        .where(eq(eventInterests.id, id))
        .returning();
      return updated;
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
