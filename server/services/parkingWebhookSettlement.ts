import type Stripe from "stripe";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { eventBookings, events, creditLedger, hostEarningsLedger, users } from "@shared/schema";
import { parkingBookingProviderKey } from "../middleware/durableIdempotency";
import { dateKeyFromUnknown } from "./dateKeys";
import { isSlotWithinHours, PARKING_PASS_SLOT_TYPES } from "@shared/parkingPassSlots";

type Booking = typeof eventBookings.$inferSelect;
type Event = typeof events.$inferSelect;
type Setup = { totalCents: number; hostPaymentsReady: boolean; breakdown: { hostPrice: number; platformFee: number; creditsApplied: number; promoDiscount: number; promoCode?: string } };
export type ParkingSettlement = { outcome: "confirmed" | "credited"; changed: boolean; bookings: Booking[]; events: Event[]; setup: Setup; userId: string; truckId: string; hostId: string; paymentIntentId: string };
const requireTruth = (condition: unknown, reason: string): void => { if (!condition) throw new Error(`parking_settlement_${reason}`); };
const money = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const sum = (rows: Booking[], key: "hostPriceCents" | "platformFeeCents" | "totalCents") => rows.reduce((n, r) => n + Number(r[key]), 0);

/** A durable operation is looked up by its saved provider response or immutable
 * in-progress checkpoint, never by reconstructing a range from payment metadata.
 * Missing/expired evidence is a retry/manual-reconciliation case, not a new booking.
 */
export async function hasDurableParkingPayment(intentId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM idempotency_keys
    WHERE split_part(scope, ':', 1) = 'parking_pass_booking'
      AND response_body->>'paymentIntentId' = ${intentId} LIMIT 1`);
  return result.rows.length > 0;
}

export async function settleDurableParkingPayment(intent: Stripe.PaymentIntent): Promise<ParkingSettlement> {
  const m = intent.metadata || {};
  requireTruth(intent.status === "succeeded" && intent.currency === "usd" && money(intent.amount) && intent.amount > 0 && intent.amount_received === intent.amount, "paid_amount_invalid");
  requireTruth(/^parking-pass:[a-f0-9]{64}$/.test(m.bookingRequestKey || ""), "request_identity_invalid");
  requireTruth([m.userId, m.truckId, m.passId, m.hostId].every(v => typeof v === "string" && v.length > 0), "identity_missing");
  return db.transaction(async (tx: any) => {
    // Share the historical credit lock namespace; repeated deliveries cannot
    // race confirmation against the legacy credit path during a rolling deploy.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment_intent_credit:${intent.id}`}))`);
    const claims = await tx.execute(sql`SELECT scope, identity_key, idem_key, response_body
      FROM idempotency_keys WHERE split_part(scope, ':', 1) = 'parking_pass_booking'
        AND identity_key = ${m.userId}
        AND (response_body->>'paymentIntentId' = ${intent.id}
          OR (response_body->>'kind' = 'parking_booking_holds_v1' AND response_body->>'providerKey' = ${m.bookingRequestKey}))
      LIMIT 2`);
    requireTruth(claims.rows.length === 1, "request_evidence_missing_or_ambiguous");
    const claim = claims.rows[0], saved = claim.response_body;
    const route = String(claim.scope).slice("parking_pass_booking:".length);
    requireTruth(/^\/api\/parking-pass\/[^/]+\/book$/.test(route) && parkingBookingProviderKey(claim.identity_key, route, claim.idem_key) === m.bookingRequestKey, "request_identity_mismatch");
    const checkpoint = saved?.kind === "parking_booking_holds_v1" ? saved : null;
    let candidates: Booking[];
    if (checkpoint) {
      requireTruth(checkpoint.userId === m.userId && checkpoint.truckId === m.truckId && checkpoint.hostId === m.hostId && checkpoint.passId === m.passId && checkpoint.route === route && Array.isArray(checkpoint.holds), "checkpoint_identity_mismatch");
      requireTruth(checkpoint.holds.length > 0 && checkpoint.holds.length <= 366 && new Set(checkpoint.holds.map((h: any) => h.id)).size === checkpoint.holds.length, "checkpoint_group_invalid");
      candidates = await tx.select().from(eventBookings).where(inArray(eventBookings.id, checkpoint.holds.map((h: any) => h.id)));
    } else {
      candidates = await tx.select().from(eventBookings).where(eq(eventBookings.stripePaymentIntentId, intent.id));
    }
    requireTruth(candidates.length > 0 && candidates.length <= 366, "holds_missing");
    const ids = candidates.map(r => r.id).sort(), eventIds = [...new Set(candidates.map(r => r.eventId))].sort();
    requireTruth(ids.length === eventIds.length, "duplicate_group_event");
    // Admission takes event locks before booking locks. Match that order.
    const selectedEvents: Event[] = await tx.select().from(events).where(inArray(events.id, eventIds)).orderBy(asc(events.id)).for("update");
    const rows: Booking[] = await tx.select().from(eventBookings).where(inArray(eventBookings.id, ids)).orderBy(asc(eventBookings.id)).for("update");
    requireTruth(rows.length === ids.length && selectedEvents.length === eventIds.length, "group_changed");
    requireTruth(rows.every(r => r.truckId === m.truckId && r.hostId === m.hostId && (!r.stripePaymentIntentId || r.stripePaymentIntentId === intent.id)), "hold_identity_mismatch");
    requireTruth(selectedEvents.every(e => e.hostId === m.hostId && e.requiresPayment) && eventIds.includes(m.passId), "event_identity_mismatch");
    if (checkpoint) {
      requireTruth(rows.length === checkpoint.holds.length && checkpoint.holds.every((h: any) => {
        const row: any = rows.find(r => r.id === h.id);
        return row && ["id", "eventId", "hostId", "truckId", "hostPriceCents", "platformFeeCents", "totalCents", "slotType"].every(k => row[k] === h[k]);
      }), "checkpoint_holds_mismatch");
    }
    requireTruth(rows.every(r => [r.hostPriceCents, r.platformFeeCents, r.totalCents].every(money) && r.totalCents === r.hostPriceCents + r.platformFeeCents), "hold_amount_invalid");
    const dates = selectedEvents.map(e => dateKeyFromUnknown(e.date, "UTC")).sort();
    requireTruth(dates.every(Boolean) && dates[0] === m.bookingStartDate && m.bookingDays === String(rows.length), "selected_dates_mismatch");
    const slots = String(rows[0].slotType || "").split(",");
    requireTruth(rows.every(r => r.slotType === rows[0].slotType) && m.slotTypes === rows[0].slotType && slots.every(s => PARKING_PASS_SLOT_TYPES.includes(s as any)), "slot_identity_mismatch");
    const destination = rows[0].stripeTransferDestination || null;
    const intentDestination = typeof intent.transfer_data?.destination === "string" ? intent.transfer_data.destination : intent.transfer_data?.destination?.id || null;
    requireTruth(rows.every(r => (r.stripeTransferDestination || null) === destination) && intentDestination === destination, "destination_mismatch");
    requireTruth((intent.application_fee_amount ?? null) === (destination ? sum(rows,"platformFeeCents") : null), "application_fee_mismatch");
    requireTruth(intent.amount === sum(rows,"totalCents") && m.totalCents === String(intent.amount) && m.hostPriceCents === String(sum(rows,"hostPriceCents")) && m.platformFeeCents === String(sum(rows,"platformFeeCents")), "amount_mismatch");
    const setup: Setup = checkpoint?.setup || saved?.bookingSetup || saved;
    requireTruth(setup && money(setup.totalCents) && setup.totalCents === intent.amount && setup.hostPaymentsReady === Boolean(destination), "saved_setup_missing_or_mismatched");
    const b = setup.breakdown;
    requireTruth(b && [b.hostPrice,b.platformFee,b.creditsApplied,b.promoDiscount].every(money) && b.hostPrice === sum(rows,"hostPriceCents") && b.platformFee === sum(rows,"platformFeeCents") && m.creditAppliedCents === String(b.creditsApplied) && m.bookingPromoDiscountCents === String(b.promoDiscount) && (m.bookingPromoCode || "") === (b.promoCode || ""), "discount_snapshot_mismatch");
    const result = (outcome: "confirmed" | "credited", changed: boolean, bookings = rows): ParkingSettlement => ({ outcome,changed,bookings,events:selectedEvents,setup,userId:m.userId,truckId:m.truckId,hostId:m.hostId,paymentIntentId:intent.id });
    requireTruth(rows.every(r => ["pending","confirmed","cancelled"].includes(r.status)), "unsupported_terminal_state");
    requireTruth(rows.every(r => !r.refundStatus || ["none","credit"].includes(r.refundStatus)), "refund_already_recorded");
    if (rows.every(r => r.status === "cancelled" && r.refundStatus === "credit")) {
      const existing = await tx.select().from(creditLedger).where(and(eq(creditLedger.userId,m.userId),eq(creditLedger.sourceId,intent.id),sql`${creditLedger.amount} > 0`));
      requireTruth(existing.length === 1 && Math.round(Number(existing[0].amount)*100) === intent.amount,"credited_ledger_mismatch");
      return result("credited",false);
    }
    requireTruth(!rows.some(r => r.refundStatus === "credit"), "mixed_credit_state");
    const pending = rows.filter(r => r.status === "pending"), confirmed = rows.filter(r => r.status === "confirmed");
    requireTruth(confirmed.every(r => r.stripePaymentIntentId === intent.id && r.stripePaymentStatus === "succeeded" && r.paidAt && !r.cancelledAt), "confirmed_evidence_mismatch");
    let creditReason: string | null = rows.some(r => r.status === "cancelled") ? "parking_pass_hold_expired" : null;
    const occupied: Booking[] = await tx.select().from(eventBookings).where(and(inArray(eventBookings.eventId,eventIds),inArray(eventBookings.status,["pending","confirmed"])));
    if (pending.length || creditReason) for (const e of selectedEvents) {
      if (!["open","filled"].includes(String(e.status)) || slots.some(s => !isSlotWithinHours(s as any,e.startTime,e.endTime)) || (e.hardCapEnabled && occupied.filter(r => r.eventId === e.id).length > Math.max(1,e.maxTrucks || 1))) creditReason ||= "parking_pass_overbook";
    }
    if (creditReason) {
      requireTruth(confirmed.length === 0, "cannot_revoke_confirmed_group");
      const existing = await tx.select().from(creditLedger).where(and(eq(creditLedger.userId,m.userId),eq(creditLedger.sourceId,intent.id),sql`${creditLedger.amount} > 0`));
      requireTruth(existing.length <= 1 && (!existing.length || Math.round(Number(existing[0].amount)*100) === intent.amount),"credit_ledger_conflict");
      if (!existing.length) await tx.insert(creditLedger).values({userId:m.userId,amount:(intent.amount/100).toFixed(2),sourceType:creditReason,sourceId:intent.id});
      const now = new Date();
      for (const r of rows) await tx.update(eventBookings).set({status:"cancelled",stripePaymentIntentId:intent.id,stripePaymentStatus:"succeeded",paidAt:r.paidAt || now,refundStatus:"credit",refundAmountCents:r.totalCents,refundedAt:now,refundReason:"Credit issued",cancelledAt:r.cancelledAt || now,cancellationReason:r.cancellationReason || "Overbooked - credit issued",updatedAt:now}).where(eq(eventBookings.id,r.id));
      return result("credited",true);
    }
    requireTruth(pending.length + confirmed.length === rows.length, "group_state_invalid");
    const now = new Date();
    for (const r of pending) {
      requireTruth(!r.cancelledAt && !r.paidAt && (!r.stripePaymentStatus || r.stripePaymentStatus === "pending"),"pending_state_conflict");
      const used = new Set(occupied.filter(o=>o.eventId===r.eventId && o.status==="confirmed").map(o=>o.spotNumber));
      let spot=1;while(used.has(spot))spot++;
      const e=selectedEvents.find(e=>e.id===r.eventId)!;
      requireTruth(!e.hardCapEnabled || spot <= Math.max(1,e.maxTrucks || 1),"spot_capacity_changed");
      const updated = await tx.update(eventBookings).set({status:"confirmed",stripePaymentIntentId:intent.id,stripePaymentStatus:"succeeded",paidAt:now,bookingConfirmedAt:now,spotNumber:spot,updatedAt:now}).where(and(eq(eventBookings.id,r.id),eq(eventBookings.status,"pending"))).returning();
      requireTruth(updated.length === 1,"confirmation_raced");
    }
    // Booking state and earnings commit together. Migration 074 supplies the
    // per-booking uniqueness constraint; conflicting financial evidence is fatal.
    for (const r of rows.filter(r=>r.hostPriceCents>0)) {
      await tx.insert(hostEarningsLedger).values({hostId:r.hostId,bookingId:r.id,stripePaymentIntentId:intent.id,entryType:"booking_earned",sourceType:"parking_pass_booking",amountCents:r.hostPriceCents,description:"Parking pass booking earnings"}).onConflictDoNothing();
      const earned = await tx.select().from(hostEarningsLedger).where(and(eq(hostEarningsLedger.bookingId,r.id),eq(hostEarningsLedger.entryType,"booking_earned")));
      requireTruth(earned.length===1 && earned[0].hostId===r.hostId && earned[0].stripePaymentIntentId===intent.id && earned[0].amountCents===r.hostPriceCents,"earnings_conflict");
    }
    if (b.creditsApplied>0) {
      // Same user lock/reference contract as debitCredit(...,
      // {externalValueAlreadyCommitted:true}), inside the settlement transaction.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`credit_balance:${m.userId}`}))`);
      const debit = await tx.select().from(creditLedger).where(and(eq(creditLedger.userId,m.userId),eq(creditLedger.sourceType,"booking_credit"),eq(creditLedger.sourceId,intent.id),sql`${creditLedger.amount} < 0`));
      requireTruth(debit.length<=1 && (!debit.length || Math.round(-Number(debit[0].amount)*100)===b.creditsApplied),"credit_debit_conflict");
      if (!debit.length) await tx.insert(creditLedger).values({userId:m.userId,amount:(-b.creditsApplied/100).toFixed(2),sourceType:"booking_credit",sourceId:intent.id,redeemedAt:now,redeemedFor:"booking"});
    }
    if (b.promoCode === "BOOKFEE10") {
      const [user] = await tx.select().from(users).where(eq(users.id,m.userId)).for("update");
      requireTruth(user,"promo_user_missing");
      const settings=user.accountSettings || {}, promos=settings.promos || {}, promo=promos.bookingFee10 || {};
      requireTruth(!promo.redeemedPaymentIntentId || promo.redeemedPaymentIntentId===intent.id,"promo_redemption_conflict");
      if (promo.redeemedPaymentIntentId!==intent.id) await tx.update(users).set({accountSettings:{...settings,promos:{...promos,bookingFee10:{...promo,redeemedAt:now.toISOString(),redeemedPaymentIntentId:intent.id,discountCents:b.promoDiscount,pendingPaymentIntentId:null,pendingAt:null}}}}).where(eq(users.id,m.userId));
    }
    if (pending.length) for (const e of selectedEvents) {
      const [n]=await tx.select({n:sql<number>`count(*)`}).from(eventBookings).where(and(eq(eventBookings.eventId,e.id),eq(eventBookings.status,"confirmed")));
      await tx.update(events).set({status:e.hardCapEnabled && Number(n.n)>=Math.max(1,e.maxTrucks || 1)?"filled":"open",lastConfirmedAt:now,updatedAt:now}).where(eq(events.id,e.id));
    }
    return result("confirmed",pending.length>0);
  });
}
