import { createHash, randomUUID } from "node:crypto";
import { eventNotificationDeliveries } from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { emailService, type EmailDeliveryReceipt } from "../emailService";
import { dateKeyFromUnknown, formatDateKeyForDisplay } from "./dateKeys";
import { loadPersistedEventServiceTimeZone } from "./persistedServiceTimeZone";
import { normalizePersistedIanaTimeZone } from "./persistedServiceTimeZoneRules";

const clean = (value: unknown) => String(value || "").trim();
const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
};
const digest = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

export class EventNotificationDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EventNotificationDeliveryError";
  }
}

export type DurableEventNotificationInput = {
  notificationKind: string;
  subjectId: string;
  recipientUserId?: string | null;
  recipientEmail: string;
  serviceTimeZone: string;
  serviceDateKey: string;
  payload: Record<string, unknown>;
  send: (idempotencyKey: string) => Promise<EmailDeliveryReceipt>;
};

export async function deliverEventNotificationOnce(
  input: DurableEventNotificationInput,
) {
  const notificationKind = clean(input.notificationKind);
  const subjectId = clean(input.subjectId);
  const recipientUserId = clean(input.recipientUserId) || null;
  const recipientEmail = clean(input.recipientEmail).toLowerCase();
  const recipientKey = recipientUserId || recipientEmail;
  const serviceTimeZone = normalizePersistedIanaTimeZone(input.serviceTimeZone);
  const serviceDateKey = dateKeyFromUnknown(input.serviceDateKey, "UTC");
  if (
    !notificationKind ||
    !subjectId ||
    !recipientEmail ||
    !recipientKey ||
    !serviceTimeZone ||
    !serviceDateKey
  ) {
    throw new EventNotificationDeliveryError(
      "event_notification_identity_invalid",
      "A durable event notice requires exact subject, recipient, timezone, and calendar date identity.",
    );
  }
  const payloadDigest = digest(input.payload);
  const idempotencyKey = `event-notice:${digest({
    version: "event-notification-v1",
    notificationKind,
    subjectId,
    recipientKey,
    payloadDigest,
  })}`;
  const claimToken = randomUUID();

  const claim = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_notification:${notificationKind}:${subjectId}:${recipientKey}`}))`,
    );
    await tx
      .insert(eventNotificationDeliveries)
      .values({
        notificationKind,
        subjectId,
        recipientKey,
        recipientUserId,
        recipientEmail,
        payloadDigest,
        idempotencyKey,
        serviceTimeZone,
        serviceDateKey,
        status: "prepared",
      })
      .onConflictDoNothing({
        target: [
          eventNotificationDeliveries.notificationKind,
          eventNotificationDeliveries.subjectId,
          eventNotificationDeliveries.recipientKey,
        ],
      });
    const [row] = await tx
      .select()
      .from(eventNotificationDeliveries)
      .where(
        and(
          eq(eventNotificationDeliveries.notificationKind, notificationKind),
          eq(eventNotificationDeliveries.subjectId, subjectId),
          eq(eventNotificationDeliveries.recipientKey, recipientKey),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new Error("Durable event notification was not prepared.");
    if (
      row.payloadDigest !== payloadDigest ||
      row.recipientEmail !== recipientEmail ||
      row.serviceTimeZone !== serviceTimeZone ||
      row.serviceDateKey !== serviceDateKey ||
      clean(row.recipientUserId) !== clean(recipientUserId)
    ) {
      throw new EventNotificationDeliveryError(
        "event_notification_idempotency_mismatch",
        "That recipient notice identity is already bound to different facts.",
      );
    }
    if (["provider_confirmed", "ambiguous", "not_required"].includes(row.status)) {
      return { row, shouldSend: false };
    }
    if (row.status === "submitted") {
      return { row, shouldSend: false };
    }
    const [claimed] = await tx
      .update(eventNotificationDeliveries)
      .set({
        status: "submitted",
        claimToken,
        claimedAt: new Date(),
        attemptCount: sql`${eventNotificationDeliveries.attemptCount} + 1` as any,
        providerStatus: null,
        failureMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(eventNotificationDeliveries.id, row.id))
      .returning();
    return { row: claimed, shouldSend: true };
  });

  if (!claim.shouldSend) return claim.row;

  let receipt: EmailDeliveryReceipt;
  try {
    receipt = await input.send(idempotencyKey);
  } catch (error) {
    receipt = {
      sent: false,
      providerStatus: "provider_ambiguous",
      retrySafe: false,
    };
  }
  const providerMessageId = clean(receipt.providerMessageId) || null;
  const status =
    receipt.sent && providerMessageId
      ? "provider_confirmed"
      : receipt.retrySafe === true
        ? "retry_safe"
        : "ambiguous";
  const [completed] = await db
    .update(eventNotificationDeliveries)
    .set({
      status,
      providerStatus: clean(receipt.providerStatus) || null,
      providerMessageId,
      failureMessage:
        status === "provider_confirmed"
          ? null
          : status === "retry_safe"
            ? "Provider was not attempted; the exact notice may be retried."
            : "Provider acceptance is ambiguous; do not resend without exact provider reconciliation.",
      completedAt:
        status === "provider_confirmed" || status === "ambiguous"
          ? new Date()
          : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventNotificationDeliveries.id, claim.row.id),
        eq(eventNotificationDeliveries.claimToken, claimToken),
        eq(eventNotificationDeliveries.status, "submitted"),
      ),
    )
    .returning();
  return completed || claim.row;
}

/**
 * A process can stop after the provider call and before binding its receipt.
 * With no provider retrieval API, stale submitted deliveries become ambiguous
 * and are quarantined rather than resent.
 */
export async function quarantineStaleSubmittedEventNotifications(input?: {
  olderThanMs?: number;
}) {
  const cutoff = new Date(
    Date.now() - Math.max(60_000, input?.olderThanMs || 5 * 60_000),
  );
  const rows = await db
    .update(eventNotificationDeliveries)
    .set({
      status: "ambiguous",
      providerStatus: "receipt_binding_timeout",
      failureMessage:
        "Provider acceptance may have occurred before receipt binding; blind resend is disabled.",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventNotificationDeliveries.status, "submitted"),
        lt(eventNotificationDeliveries.claimedAt, cutoff),
      ),
    )
    .returning({ id: eventNotificationDeliveries.id });
  return { quarantined: rows.length };
}

export async function deliverInterestStatusEventNotification(input: {
  interestId: string;
  eventId: string;
  eventDate: unknown;
  seriesId?: string | null;
  hostCity?: string | null;
  hostState?: string | null;
  recipientUserId: string;
  recipientEmail: string;
  truckName: string;
  hostName: string;
  status: "accepted" | "declined";
}) {
  const timeZone = await loadPersistedEventServiceTimeZone({
    seriesId: input.seriesId,
    city: input.hostCity,
    state: input.hostState,
  });
  const dateKey = dateKeyFromUnknown(input.eventDate, "UTC");
  if (!timeZone || !dateKey) {
    throw new EventNotificationDeliveryError(
      "event_notification_time_authority_unavailable",
      "The event notice is suppressed until its persisted service timezone and date are available.",
    );
  }
  const dateLabel = formatDateKeyForDisplay(dateKey);
  const accepted = input.status === "accepted";
  const subject = accepted
    ? `${input.hostName} accepted your event request`
    : `Update on your request for ${input.hostName}`;
  const text = accepted
    ? `Hi ${input.truckName}, ${input.hostName} accepted your request for ${dateLabel}.`
    : `Hi ${input.truckName}, ${input.hostName} declined your request for ${dateLabel}.`;
  const html = `<p>Hi ${input.truckName},</p><p>${input.hostName} has <strong>${input.status}</strong> your event request for <strong>${dateLabel}</strong>.</p><p>View current event details in MealScout before traveling.</p>`;
  return deliverEventNotificationOnce({
    notificationKind: `interest_status_${input.status}`,
    subjectId: `${clean(input.interestId)}:${clean(input.eventId)}`,
    recipientUserId: input.recipientUserId,
    recipientEmail: input.recipientEmail,
    serviceTimeZone: timeZone,
    serviceDateKey: dateKey,
    payload: {
      version: "interest-status-notice-v1",
      interestId: clean(input.interestId),
      eventId: clean(input.eventId),
      status: input.status,
      truckName: clean(input.truckName),
      hostName: clean(input.hostName),
      dateKey,
      timeZone,
    },
    send: (idempotencyKey) =>
      emailService.sendBasicEmailWithReceipt(
        input.recipientEmail,
        subject,
        html,
        text,
        "general",
        idempotencyKey,
      ),
  });
}
