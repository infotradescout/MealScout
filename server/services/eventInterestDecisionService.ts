import { and, count, eq } from "drizzle-orm";

import { eventInterests, events, hosts } from "@shared/schema";
import { db } from "../db";

export type EventInterestDecisionStatus = "accepted" | "declined";

const STAFF_ROLES = new Set([
  "staff",
  "admin",
  "duper_admin",
  "super_admin",
]);

export class EventInterestDecisionError extends Error {
  constructor(
    readonly code:
      | "interest_not_found"
      | "event_not_found"
      | "not_authorized"
      | "event_not_open"
      | "capacity_reached"
      | "concurrent_update",
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventInterestDecisionError";
  }
}

export type EventInterestDecisionResult = {
  interest: typeof eventInterests.$inferSelect;
  event: typeof events.$inferSelect;
  host: typeof hosts.$inferSelect;
  acceptedCount: number;
  replayed: boolean;
};

/**
 * Canonical event-interest decision boundary.
 *
 * The event row is locked before the target interest so acceptance decisions
 * for different trucks serialize on one capacity authority. Host ownership,
 * explicit non-Parking-Pass coordinator authority, event status, and capacity
 * are all re-read inside that same transaction.
 */
export async function decideEventInterest(input: {
  interestId: string;
  status: EventInterestDecisionStatus;
  actorUserId: string;
  actorRole?: string | null;
  database?: any;
}): Promise<EventInterestDecisionResult> {
  const database = input.database || db;
  const interestId = String(input.interestId || "").trim();
  const actorUserId = String(input.actorUserId || "").trim();
  const actorRole = String(input.actorRole || "")
    .trim()
    .toLowerCase();

  return database.transaction(async (tx: any) => {
    const [identity] = await tx
      .select({ eventId: eventInterests.eventId })
      .from(eventInterests)
      .where(eq(eventInterests.id, interestId))
      .limit(1);
    if (!identity) {
      throw new EventInterestDecisionError(
        "interest_not_found",
        "Interest not found",
        404,
      );
    }

    const [lockedSupply] = await tx
      .select({ event: events, host: hosts })
      .from(events)
      .innerJoin(hosts, eq(events.hostId, hosts.id))
      .where(eq(events.id, identity.eventId))
      .limit(1)
      .for("update");
    if (!lockedSupply) {
      throw new EventInterestDecisionError(
        "event_not_found",
        "Event not found",
        404,
      );
    }

    const [interest] = await tx
      .select()
      .from(eventInterests)
      .where(
        and(
          eq(eventInterests.id, interestId),
          eq(eventInterests.eventId, lockedSupply.event.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!interest) {
      throw new EventInterestDecisionError(
        "interest_not_found",
        "Interest not found",
        404,
      );
    }

    const isHostOwner =
      actorUserId.length > 0 && lockedSupply.host.userId === actorUserId;
    const isExplicitCoordinator =
      lockedSupply.event.eventType !== "parking_pass" &&
      actorUserId.length > 0 &&
      lockedSupply.event.coordinatorUserId === actorUserId;
    if (
      !isHostOwner &&
      !isExplicitCoordinator &&
      !STAFF_ROLES.has(actorRole)
    ) {
      throw new EventInterestDecisionError(
        "not_authorized",
        "Not authorized to manage this event",
        403,
      );
    }

    const [acceptedTotal] = await tx
      .select({ value: count() })
      .from(eventInterests)
      .where(
        and(
          eq(eventInterests.eventId, lockedSupply.event.id),
          eq(eventInterests.status, "accepted"),
        ),
      );
    const acceptedCount = Number(acceptedTotal?.value || 0);

    if (interest.status === input.status) {
      return {
        interest,
        event: lockedSupply.event,
        host: lockedSupply.host,
        acceptedCount,
        replayed: true,
      };
    }

    if (input.status === "accepted") {
      if (lockedSupply.event.status !== "open") {
        throw new EventInterestDecisionError(
          "event_not_open",
          "This event is no longer accepting trucks",
          409,
          { eventStatus: lockedSupply.event.status },
        );
      }
      const maxTrucks = Number(lockedSupply.event.maxTrucks || 0);
      if (
        lockedSupply.event.hardCapEnabled &&
        (!Number.isInteger(maxTrucks) ||
          maxTrucks < 1 ||
          acceptedCount >= maxTrucks)
      ) {
        throw new EventInterestDecisionError(
          "capacity_reached",
          "This event has reached its truck capacity",
          409,
          {
            eventId: lockedSupply.event.id,
            truckId: interest.truckId,
            acceptedCount,
            maxTrucks,
          },
        );
      }
    }

    const [updated] = await tx
      .update(eventInterests)
      .set({ status: input.status })
      .where(
        and(
          eq(eventInterests.id, interest.id),
          eq(eventInterests.eventId, lockedSupply.event.id),
          eq(eventInterests.status, interest.status),
        ),
      )
      .returning();
    if (!updated) {
      throw new EventInterestDecisionError(
        "concurrent_update",
        "Interest status changed concurrently; reload before retrying",
        409,
      );
    }

    const acceptedAfter =
      input.status === "accepted"
        ? acceptedCount + 1
        : interest.status === "accepted"
          ? Math.max(0, acceptedCount - 1)
          : acceptedCount;
    return {
      interest: updated,
      event: lockedSupply.event,
      host: lockedSupply.host,
      acceptedCount: acceptedAfter,
      replayed: false,
    };
  });
}
