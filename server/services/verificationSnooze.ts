import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { telemetryEvents } from "@shared/schema";

export const VERIFICATION_SNOOZE_EVENT = "verification_snoozed";

export type VerificationSnoozeState = {
  snoozed: boolean;
  snoozedAt: string | null;
  snoozedUntil: string | null;
};

export async function getVerificationSnooze(
  restaurantId: string,
): Promise<VerificationSnoozeState> {
  const [event] = await db
    .select({
      properties: telemetryEvents.properties,
      createdAt: telemetryEvents.createdAt,
    })
    .from(telemetryEvents)
    .where(
      and(
        eq(telemetryEvents.eventName, VERIFICATION_SNOOZE_EVENT),
        sql`${telemetryEvents.properties}->>'restaurantId' = ${restaurantId}`,
      ),
    )
    .orderBy(desc(telemetryEvents.createdAt))
    .limit(1);

  const properties =
    event?.properties && typeof event.properties === "object"
      ? (event.properties as Record<string, unknown>)
      : {};
  const snoozedUntil = String(properties.snoozedUntil || "").trim();
  const snoozedAt =
    String(properties.snoozedAt || "").trim() ||
    (event?.createdAt ? new Date(event.createdAt).toISOString() : "");
  const snoozedUntilMs = snoozedUntil ? new Date(snoozedUntil).getTime() : 0;

  return {
    snoozed: Number.isFinite(snoozedUntilMs) && snoozedUntilMs > Date.now(),
    snoozedAt: snoozedAt || null,
    snoozedUntil: snoozedUntil || null,
  };
}

export async function createVerificationSnooze({
  restaurantId,
  userId,
  source,
}: {
  restaurantId: string;
  userId: string;
  source?: string | null;
}): Promise<VerificationSnoozeState> {
  const now = new Date();
  const snoozedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await db.insert(telemetryEvents).values({
    eventName: VERIFICATION_SNOOZE_EVENT,
    userId,
    properties: {
      restaurantId,
      source: source || "owner",
      snoozedAt: now.toISOString(),
      snoozedUntil: snoozedUntil.toISOString(),
    },
  });

  return {
    snoozed: true,
    snoozedAt: now.toISOString(),
    snoozedUntil: snoozedUntil.toISOString(),
  };
}
