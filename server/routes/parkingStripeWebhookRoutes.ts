import type { Express } from "express";
import Stripe from "stripe";
import { registerStripeWebhookRoutes as registerLegacyWebhookRoutes } from "./stripeWebhookRoutes";
import { decideStripeWebhookVerificationMode } from "../utils/stripeWebhookVerification";
import { hasDurableParkingPayment, settleDurableParkingPayment, type ParkingSettlement } from "../services/parkingWebhookSettlement";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { dateKeyFromUnknown } from "../services/dateKeys";
type Dependencies = Parameters<typeof registerLegacyWebhookRoutes>[1];
const configuredStripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/** Keep legacy event, subscription, pickup, supplier and refund handling intact.
 * Only request-bound Parking Pass success events use the reservation-first path.
 */
export function registerStripeWebhookRoutes(app: Express, dependencies: Dependencies) {
  const stripe = Object.prototype.hasOwnProperty.call(dependencies,"stripeClient") ? dependencies.stripeClient || null : configuredStripe;
  app.post("/api/stripe/webhook", async (req, res, next) => {
    let candidate: any;
    try { candidate = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body; }
    catch { return next(); }
    const metadata = candidate?.data?.object?.metadata;
    if (candidate?.type !== "payment_intent.succeeded" || !metadata || (!metadata.bookingRequestKey && !(metadata.passId && metadata.truckId))) return next();
    let event: Stripe.Event;
    try {
      const mode = decideStripeWebhookVerificationMode({nodeEnv:process.env.NODE_ENV,forceVerify:String(process.env.STRIPE_WEBHOOK_FORCE_VERIFY || "").trim().toLowerCase()==="true",allowUnsignedDev:String(process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED || "").trim().toLowerCase()==="true"});
      if (mode === "accept_unsigned_dev") event = candidate;
      else {
        if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Webhook signature verification unavailable");
        if (!Buffer.isBuffer(req.body)) throw new Error("Raw webhook body required");
        event = stripe.webhooks.constructEvent(req.body,req.headers["stripe-signature"] as string,process.env.STRIPE_WEBHOOK_SECRET);
      }
    } catch { return res.status(400).send("Webhook Error: signature verification failed"); }
    try {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (!intent.metadata?.bookingRequestKey && !(await hasDurableParkingPayment(intent.id))) return next();
      if (event.account || intent.metadata?.pickupOrderId || intent.metadata?.orderId || intent.metadata?.bookingId) throw new Error("parking_settlement_ambiguous_payment_family");
      const configuredMode=String(process.env.STRIPE_SECRET_KEY || "").match(/^[sr]k_(live|test)_/)?.[1];
      if (configuredMode && event.livemode !== (configuredMode === "live")) throw new Error("parking_settlement_provider_mode_mismatch");
      const outcome = await settleDurableParkingPayment(intent);
      if (outcome.changed && outcome.outcome === "confirmed") await notifyConfirmedParking(outcome,dependencies);
      return res.json({received:true,parkingOutcome:outcome.outcome});
    } catch (error) {
      console.error("[parking-webhook] Reconciliation required; no fallback booking will be created", {reason:error instanceof Error ? error.message : "unknown_failure"});
      return res.status(503).json({code:"parking_webhook_reconciliation_required",message:"Parking payment reconciliation could not be completed."});
    }
  });
  registerLegacyWebhookRoutes(app,dependencies);
}

async function notifyConfirmedParking(outcome: ParkingSettlement, dependencies: Dependencies) {
  // Best-effort existing notifications stay outside the financial transaction.
  // Only the delivery that changes the state sends them; replays do not repeat them.
  const dates=outcome.events.map(e=>dateKeyFromUnknown(e.date,"UTC")).filter((d):d is string=>Boolean(d)).sort();
  const startDate=dates[0],endDate=dates.at(-1) || startDate;
  try {
    const truck=await storage.getRestaurant(outcome.truckId),host=await storage.getHost(outcome.hostId);
    const owner=truck?await storage.getUser(truck.ownerId):null;
    const hostUser=host?await storage.getUser(host.userId):null;
    const shared={hostName:host?.businessName || "Host location",startDate,endDate,slotSummary:String(outcome.bookings[0]?.slotType || "").split(",").join(", "),totalCents:outcome.setup.totalCents};
    if(owner?.email)await emailService.sendBookingConfirmationEmail({to:owner.email,...shared});
    if(hostUser?.email)await emailService.sendHostBookingNotification({to:hostUser.email,truckName:truck?.name || "A food truck",...shared});
  } catch { console.error("[parking-webhook] Booking notification delivery was not verified."); }
  try {
    const truck=await storage.getRestaurant(outcome.truckId),host=await storage.getHost(outcome.hostId);
    if(truck?.ownerId && host?.userId) {
      const {createAffiliateCommissionsForBooking}=await import("../affiliateCommissionService");
      await createAffiliateCommissionsForBooking({hostOwnerId:host.userId,truckOwnerId:truck.ownerId,platformFeeCents:outcome.setup.breakdown.platformFee,paymentIntentId:outcome.paymentIntentId,truckRestaurantId:outcome.truckId});
    }
  } catch { console.error("[parking-webhook] Booking affiliate reconciliation was not verified."); }
  // Preserve capacity notifications without turning notification failure into a
  // second financial operation. Existing notifier deduplication remains in force.
  for(const e of outcome.events) {
    try {
      const {db}=await import("../db"),{eventBookings}=await import("@shared/schema"),{and,eq,sql}=await import("drizzle-orm");
      const [row]=await db.select({n:sql<number>`count(*)`}).from(eventBookings).where(and(eq(eventBookings.eventId,e.id),eq(eventBookings.status,"confirmed")));
      const count=Number(row?.n || 0),max=Math.max(1,e.maxTrucks || 1);
      if(count/max>=0.8)await dependencies.notifyHostCapacityWarning({hostId:e.hostId,eventId:e.id,eventStartDate:e.date || null,confirmedCount:count,maxTrucks:max});
    } catch { console.error("[parking-webhook] Capacity notification delivery was not verified."); }
  }
}
