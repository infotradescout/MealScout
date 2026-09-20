import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type Stripe from "stripe";
import { eventBookings } from "@shared/schema";
import { db } from "../db";

type IntentReader = Pick<Stripe["paymentIntents"], "retrieve" | "cancel">;
type Hold = typeof eventBookings.$inferSelect;
export type HoldExpiryResult = {
  scanned: number; expired: number; deferred: number; errors: number;
  nextCursor: string | null;
};

function matchesBooking(intent: Stripe.PaymentIntent, id: string, rows: Hold[]): boolean {
  const first = rows[0];
  const total = rows.reduce((sum, row) => sum + row.totalCents, 0);
  return Boolean(first && intent.id === id && intent.currency === "usd" &&
    Number.isSafeInteger(total) && total > 0 && intent.amount === total &&
    intent.metadata?.truckId === first.truckId && intent.metadata?.hostId === first.hostId &&
    intent.metadata?.totalCents === String(total) &&
    rows.every(row => row.truckId === first.truckId && row.hostId === first.hostId &&
      Number.isSafeInteger(row.totalCents) && row.totalCents >= 0));
}
function unpaid(intent: Stripe.PaymentIntent): boolean {
  return intent.amount_received === 0 && intent.amount_capturable === 0;
}
const cancelableUnpaid = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/** Expire only positively cancelled, unpaid intents. Missing links, paid states,
 * provider failures and concurrent changes retain both capacity and evidence.
 * Cursor pagination prevents unresolved older holds from starving later work.
 */
export async function expireParkingPassHolds(provider: IntentReader | null, options: {
  now?: Date; ttlMs: number; limit?: number; afterIntentId?: string | null;
  truckId?: string;
}): Promise<HoldExpiryResult> {
  const now = options.now || new Date();
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error("A valid hold expiry deadline is required");
  }
  const truckId = options.truckId?.trim();
  if (options.truckId !== undefined && !truckId) {
    throw new Error("A scoped hold expiry requires a valid truck identity");
  }
  const result: HoldExpiryResult = { scanned: 0, expired: 0, deferred: 0, errors: 0, nextCursor: null };
  if (!provider) return result;
  const cutoff = new Date(now.getTime() - options.ttlMs);
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 50)));
  const candidates: Array<{ intentId: string }> = await db
    .select({ intentId: eventBookings.stripePaymentIntentId }).from(eventBookings)
    .where(and(eq(eventBookings.status, "pending"), lt(eventBookings.createdAt, cutoff),
      isNotNull(eventBookings.stripePaymentIntentId),
      gt(eventBookings.stripePaymentIntentId, options.afterIntentId || ""),
      ...(truckId ? [eq(eventBookings.truckId, truckId)] : [])))
    .groupBy(eventBookings.stripePaymentIntentId)
    .orderBy(asc(eventBookings.stripePaymentIntentId)).limit(limit);
  for (const candidate of candidates) {
    result.scanned++;
    result.nextCursor = candidate.intentId;
    try {
      const released = await db.transaction(async (tx: any): Promise<number> => {
        // Lock the WHOLE intent group, not just the expired subset. Never
        // cancel an intent that also backs a fresh or confirmed reservation.
        const rows: Hold[] = await tx.select().from(eventBookings)
          .where(eq(eventBookings.stripePaymentIntentId, candidate.intentId))
          .orderBy(asc(eventBookings.id)).for("update");
        if (!rows.length || rows.some(row => row.status !== "pending" ||
          !row.createdAt || new Date(row.createdAt).getTime() >= cutoff.getTime() ||
          row.paidAt || row.bookingConfirmedAt ||
          ["succeeded", "processing", "requires_capture", "bypassed"].includes(row.stripePaymentStatus || ""))) return 0;
        let intent = await provider.retrieve(candidate.intentId);
        if (!matchesBooking(intent, candidate.intentId, rows) || !unpaid(intent)) return 0;
        if (intent.status !== "canceled") {
          if (!cancelableUnpaid.has(intent.status)) return 0;
          try {
            intent = await provider.cancel(candidate.intentId, { cancellation_reason: "abandoned" }, {
              idempotencyKey: `parking-pass-expiry:${createHash("sha256").update(candidate.intentId).digest("hex")}`,
            });
          } catch {
            // A lost cancellation acknowledgement is not a failed payment.
            // Only a fresh positive cancellation read allows release.
            intent = await provider.retrieve(candidate.intentId);
          }
        }
        if (intent.status !== "canceled" || !unpaid(intent) ||
          !matchesBooking(intent, candidate.intentId, rows)) return 0;
        const updated = await tx.update(eventBookings).set({
          status: "cancelled", stripePaymentStatus: "canceled", cancelledAt: now,
          cancellationReason: "checkout_hold_expired", updatedAt: now,
        }).where(and(inArray(eventBookings.id, rows.map(row => row.id)),
          eq(eventBookings.status, "pending"), eq(eventBookings.stripePaymentIntentId, candidate.intentId),
          isNull(eventBookings.paidAt), isNull(eventBookings.bookingConfirmedAt)))
          .returning({ id: eventBookings.id });
        if (updated.length !== rows.length) throw new Error("Hold changed during expiry");
        return updated.length;
      });
      if (released) result.expired += released;
      else result.deferred++;
    } catch {
      // Keep rows unchanged on uncertain provider or database outcomes. The
      // next sweep can observe an already-cancelled intent and finish safely.
      result.errors++;
    }
  }
  return result;
}
