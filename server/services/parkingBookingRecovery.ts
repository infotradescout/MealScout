import type { Request } from "express";
import type Stripe from "stripe";
import { and, eq, inArray, sql } from "drizzle-orm";
import { eventBookings } from "@shared/schema";
import { db } from "../db";
import { parkingBookingProviderKey } from "../middleware/durableIdempotency";

type Hold = { id: string; eventId: string; hostId: string; truckId: string;
  hostPriceCents: number; platformFeeCents: number; totalCents: number; slotType: string };
type Setup = { totalCents: number; hostPaymentsReady: boolean;
  breakdown: { hostPrice: number; platformFee: number; creditsApplied: number;
    promoDiscount: number; promoCode?: string } };
export type ParkingBookingCheckpoint = {
  kind: "parking_booking_holds_v1"; userId: string; route: string; providerKey: string;
  passId: string; truckId: string; hostId: string; bookingStartDate: string;
  slotTypes: string; destination: string | null; holds: Hold[]; setup: Setup;
};
type Seed = Omit<ParkingBookingCheckpoint, "kind" | "providerKey" | "holds"> & { holds: Hold[] };
type Provider = Pick<Stripe["paymentIntents"], "retrieve" | "search">;
export type RecoveredBookingResponse = { statusCode: number; body: Record<string, unknown> };

/** Must run in the SAME transaction as hold insertion. Failure rolls back holds.
 * Never persist a client secret or a provider credential in this checkpoint.
 */
export async function recordParkingBookingHolds(tx: any, requestId: string, seed: Seed) {
  const checkpoint: ParkingBookingCheckpoint = { ...seed, kind: "parking_booking_holds_v1",
    providerKey: parkingBookingProviderKey(seed.userId, seed.route, requestId),
    holds: seed.holds.map(({ id, eventId, hostId, truckId, hostPriceCents, platformFeeCents, totalCents, slotType }) =>
      ({ id, eventId, hostId, truckId, hostPriceCents, platformFeeCents, totalCents, slotType })) };
  if (!validCheckpoint(checkpoint)) throw new Error("Invalid booking recovery checkpoint");
  const result = await tx.execute(sql`
    UPDATE idempotency_keys SET response_body = CAST(${JSON.stringify(checkpoint)} AS jsonb), updated_at = now()
    WHERE scope = ${`parking_pass_booking:${seed.route}`} AND identity_key = ${seed.userId}
      AND idem_key = ${requestId} AND state = 'processing' AND response_body IS NULL
      AND expires_at > now() RETURNING id;
  `);
  if (result?.rows?.length !== 1) throw new Error("Booking holds could not be linked to their request");
}
const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function validCheckpoint(value: any): value is ParkingBookingCheckpoint {
  if (!value || value.kind !== "parking_booking_holds_v1" ||
      ![value.userId, value.route, value.providerKey, value.passId, value.truckId, value.hostId].every(v => typeof v === "string" && v) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.bookingStartDate) || typeof value.slotTypes !== "string" ||
      !(value.destination === null || typeof value.destination === "string") ||
      !Array.isArray(value.holds) || value.holds.length < 1 || value.holds.length > 366) return false;
  const setup = value.setup, b = setup?.breakdown;
  if (!setup || typeof setup.hostPaymentsReady !== "boolean" || !b ||
      ![setup.totalCents, b.hostPrice, b.platformFee, b.creditsApplied, b.promoDiscount].every(money) ||
      setup.totalCents !== b.hostPrice + b.platformFee || setup.hostPaymentsReady !== Boolean(value.destination)) return false;
  if (new Set(value.holds.map((h: Hold) => h?.id)).size !== value.holds.length) return false;
  return value.holds.every((h: Hold) => h && [h.id, h.eventId, h.hostId, h.truckId, h.slotType].every(v => typeof v === "string" && v) &&
    h.truckId === value.truckId && h.hostId === value.hostId && h.slotType === value.slotTypes &&
    [h.hostPriceCents, h.platformFeeCents, h.totalCents].every(money) && h.totalCents === h.hostPriceCents + h.platformFeeCents) &&
    value.holds.reduce((n: number, h: Hold) => n + h.totalCents, 0) === setup.totalCents &&
    value.holds.reduce((n: number, h: Hold) => n + h.hostPriceCents, 0) === b.hostPrice &&
    value.holds.reduce((n: number, h: Hold) => n + h.platformFeeCents, 0) === b.platformFee;
}
function matchingHolds(checkpoint: ParkingBookingCheckpoint, rows: any[]): boolean {
  if (rows.length !== checkpoint.holds.length) return false;
  return checkpoint.holds.every(hold => {
    const row = rows.find(candidate => candidate.id === hold.id);
    return row && Object.entries(hold).every(([key, value]) => row[key] === value);
  });
}
function matchingIntent(c: ParkingBookingCheckpoint, intent: Stripe.PaymentIntent): boolean {
  const m = intent.metadata || {}, destination = intent.transfer_data?.destination;
  const destinationId = typeof destination === "string" ? destination : destination?.id || null;
  return intent.amount === c.setup.totalCents && intent.currency === "usd" &&
    m.bookingRequestKey === c.providerKey && m.userId === c.userId && m.truckId === c.truckId &&
    m.passId === c.passId && m.hostId === c.hostId && m.slotTypes === c.slotTypes &&
    m.bookingDays === String(c.holds.length) && m.bookingStartDate === c.bookingStartDate &&
    m.totalCents === String(c.setup.totalCents) && m.hostPriceCents === String(c.setup.breakdown.hostPrice) &&
    m.platformFeeCents === String(c.setup.breakdown.platformFee) &&
    m.creditAppliedCents === String(c.setup.breakdown.creditsApplied) &&
    m.bookingPromoDiscountCents === String(c.setup.breakdown.promoDiscount) &&
    m.bookingPromoCode === (c.setup.breakdown.promoCode || "") && destinationId === c.destination &&
    (intent.application_fee_amount ?? null) === (c.destination ? c.setup.breakdown.platformFee : null);
}
function pendingHoldsAreFresh(rows: any[]): boolean {
  const raw = Number(process.env.PARKING_PASS_HOLD_TTL_MINUTES ?? 7);
  const ttlMs = (Number.isFinite(raw) ? Math.max(1, Math.min(raw, 60)) : 7) * 60_000;
  const now = Date.now();
  return rows.every(row => row.status === "pending" && row.stripePaymentStatus === "pending" &&
    !row.paidAt && !row.cancelledAt && (!row.refundStatus || row.refundStatus === "none") &&
    new Date(row.createdAt).getTime() <= now && new Date(row.createdAt).getTime() > now - ttlMs);
}

/** Evidence-only reconciliation: no hold insertion, PaymentIntent creation,
 * confirmation, capture, cancellation, or refund. Empty search is never absence proof.
 */
export async function reconcileParkingBooking(req: Request, checkpoint: unknown,
  provider: Provider | null, authorizePayment: () => Promise<boolean>): Promise<RecoveredBookingResponse | null> {
  if (!validCheckpoint(checkpoint) || !provider) return null;
  const c = checkpoint, identity = String((req as any).user?.id || "");
  const key = String(req.get("Idempotency-Key") || "").trim();
  if (identity !== c.userId || req.path !== c.route || req.body?.truckId !== c.truckId ||
      c.providerKey !== parkingBookingProviderKey(identity, req.path, key)) return null;
  const ids = c.holds.map(hold => hold.id);
  const rows = await db.select().from(eventBookings).where(inArray(eventBookings.id, ids));
  if (!matchingHolds(c, rows)) return null;
  const linked = Array.from(new Set(rows.map((row: any) => String(row.stripePaymentIntentId || "")).filter(Boolean))) as string[];
  if (linked.length > 1) return null;
  let intentId = linked[0];
  if (!intentId) {
    // Search is only positive evidence. No match, multiple matches or partial
    // results never authorize another create. Retrieve the candidate afresh.
    const found = await provider.search({ query: `metadata['bookingRequestKey']:'${c.providerKey}'`, limit: 2 });
    if (found.has_more || found.data.length !== 1) return null;
    intentId = found.data[0].id;
  }
  const intent = await provider.retrieve(intentId);
  if (!matchingIntent(c, intent)) return null;
  return db.transaction(async (tx: any) => {
    const current = await tx.select().from(eventBookings).where(inArray(eventBookings.id, ids)).for("update");
    if (!matchingHolds(c, current) || current.some((row: any) => row.stripePaymentIntentId && row.stripePaymentIntentId !== intent.id)) return null;
    const allConfirmed = current.every((row: any) => row.status === "confirmed");
    const allCredited = current.every((row: any) => row.status === "cancelled" && row.refundStatus === "credit");
    const paid = ["succeeded", "processing", "requires_capture"].includes(intent.status);
    const resumable = ["requires_payment_method", "requires_confirmation"].includes(intent.status) &&
      pendingHoldsAreFresh(current) && typeof intent.client_secret === "string" && Boolean(intent.client_secret);
    if (resumable && !(await authorizePayment())) return null;
    const allPending = current.every((row: any) => row.status === "pending");
    if (!resumable && !(paid && (allPending || allConfirmed || allCredited))) return null;
    // Restore only the missing provider reference under row locks. Never
    // resurrect deleted/cancelled holds or change financial/fulfillment states.
    await tx.update(eventBookings).set({ stripePaymentIntentId: intent.id })
      .where(and(inArray(eventBookings.id, ids), eq(eventBookings.truckId, c.truckId)));
    if (!resumable) return { statusCode: 200, body: {
      bookingRecovery: true, paymentIntentId: intent.id, bookingStartDate: c.bookingStartDate,
      bookingSetup: c.setup,
      outcome: allConfirmed ? "confirmed" : allCredited ? "credited" : "pending",
    } };
    const b = c.setup.breakdown;
    return { statusCode: 200, body: {
      paymentIntentId: intent.id, clientSecret: intent.client_secret,
      totalCents: c.setup.totalCents, hostPaymentsReady: c.setup.hostPaymentsReady,
      breakdown: { hostPrice: b.hostPrice, platformFee: b.platformFee,
        creditsApplied: b.creditsApplied, promoDiscount: b.promoDiscount, promoCode: b.promoCode },
    } };
  });
}
