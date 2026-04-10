import type { Express } from "express";
import Stripe from "stripe";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  PARKING_PASS_BOOKING_DAYS,
  PARKING_PASS_SLOT_TYPES,
  isSlotWithinHours,
} from "@shared/parkingPassSlots";
import { hosts, suppliers } from "@shared/schema";
import { db } from "../db";
import { emailService } from "../emailService";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import {
  addDaysToDateKey,
  dateKeyInZone,
  utcDateFromDateKey,
} from "../services/dateKeys";
import { storage } from "../storage";
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
type NotifyHostCapacityWarningParams = {
  hostId: string;
  eventId: string;
  eventStartDate: Date | null;
  confirmedCount: number;
  maxTrucks: number;
};
type StripeWebhookRouteDependencies = {
  notifyHostCapacityWarning: (
    params: NotifyHostCapacityWarningParams,
  ) => Promise<void>;
};
export function registerStripeWebhookRoutes(
  app: Express,
  { notifyHostCapacityWarning }: StripeWebhookRouteDependencies,
) {
  // Stripe Webhook Handler
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event;

    try {
      const payload = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : req.body;
      const forceVerify =
        String(process.env.STRIPE_WEBHOOK_FORCE_VERIFY || "").toLowerCase() ===
        "true";

      // Default behavior:
      // - development: accept JSON payloads without signature verification (fast local iteration)
      // - non-development: require Stripe signature verification
      // Optional hardening: set STRIPE_WEBHOOK_FORCE_VERIFY=true to require signatures in development too.
      if (process.env.NODE_ENV === "development" && !forceVerify) {
        event = typeof payload === "string" ? JSON.parse(payload) : payload;
      } else {
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !endpointSecret) {
          return res.status(400).send("Webhook secret not configured");
        }
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      }
    } catch (err: any) {
      console.error(`Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`[WEBHOOK] Received event: ${event.type}`);

    try {
      switch (event.type) {
        case "invoice.payment_succeeded":
          const invoice = event.data.object;
          console.log(`[WEBHOOK] Invoice ${invoice.id} payment succeeded`);

          if (invoice.subscription && stripe) {
            // Retrieve the subscription to get full details
            const subscription = await stripe.subscriptions.retrieve(
              invoice.subscription as string,
            );
            if (subscription && subscription.status === "active") {
              console.log(
                `[WEBHOOK] Subscription ${subscription.id} is now active for customer ${subscription.customer}`,
              );

              // Find user by subscription ID (more reliable than customer ID)
              const user = await storage.getUserByStripeSubscriptionId(
                subscription.id,
              );

              if (user) {
                try {
                  const { createAffiliateCommissionsForSubscription } =
                    await import("../affiliateCommissionService");
                  await createAffiliateCommissionsForSubscription(
                    user.id,
                    invoice.total,
                    invoice.id,
                  );
                } catch (commissionError) {
                  console.error(
                    "[WEBHOOK] Error processing affiliate commissions:",
                    commissionError,
                  );
                }
              }

              if (user) {
                console.log(
                  `[WEBHOOK] Found user ${user.id} (${user.email}) - ensuring subscription is active`,
                );

                // Make sure the user has the subscription ID stored
                // (it should already be there from initialization, but this ensures consistency)
                if (
                  !user.stripeSubscriptionId ||
                  user.stripeSubscriptionId !== subscription.id
                ) {
                  await storage.updateUser(user.id, {
                    stripeSubscriptionId: subscription.id,
                    stripeCustomerId: subscription.customer as string,
                  });
                  console.log(
                    `[WEBHOOK] Updated user ${user.id} with subscription ID ${subscription.id}`,
                  );
                } else {
                  console.log(
                    `[WEBHOOK] User ${user.id} subscription already properly configured`,
                  );
                }
              } else {
                console.log(
                  `[WEBHOOK] Warning: No user found for subscription ${subscription.id}`,
                );
              }
            }
          }
          break;
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${paymentIntent.id} succeeded`);

          try {
            const { eventBookings, events, restaurants, hosts } =
              await import("@shared/schema");
            const metadata = paymentIntent.metadata || {};

            // Supplier marketplace order payment
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                const [order] = await db
                  .select()
                  .from(supplierOrders)
                  .where(eq(supplierOrders.id, String(supplierOrderId)))
                  .limit(1);
                if (order) {
                  // Idempotent: only mark paid if not already.
                  if (String((order as any).paymentStatus || "") !== "paid") {
                    await db
                      .update(supplierOrders)
                      .set({
                        paymentStatus: "paid",
                        updatedAt: new Date(),
                      } as any)
                      .where(eq(supplierOrders.id, String(supplierOrderId)));
                  }
                }
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order update failed:",
                  supplierError,
                );
              }
              break;
            }

            // ── Single-event booking payment (bookingId metadata) ──────────
            const bookingId = String(metadata.bookingId || "").trim();
            if (bookingId && !metadata.passId) {
              try {
                const [booking] = await db
                  .select()
                  .from(eventBookings)
                  .where(eq(eventBookings.id, bookingId))
                  .limit(1);

                if (!booking) {
                  console.warn(`[WEBHOOK] Booking ${bookingId} not found`);
                  break;
                }

                // Idempotent
                if (booking.status === "confirmed") {
                  console.log(
                    `[WEBHOOK] Booking ${bookingId} already confirmed`,
                  );
                  break;
                }

                const now = new Date();
                await db
                  .update(eventBookings)
                  .set({
                    status: "confirmed",
                    stripePaymentStatus: "succeeded",
                    paidAt: now,
                    bookingConfirmedAt: now,
                    updatedAt: now,
                  })
                  .where(eq(eventBookings.id, bookingId));

                // Update event fill status
                const [countRow] = await db
                  .select({ count: sql<number>`count(*)` })
                  .from(eventBookings)
                  .where(
                    and(
                      eq(eventBookings.eventId, booking.eventId),
                      eq(eventBookings.status, "confirmed"),
                    ),
                  );
                const confirmedCount = Number(countRow?.count ?? 0);

                const [eventRow] = await db
                  .select()
                  .from(events)
                  .where(eq(events.id, booking.eventId))
                  .limit(1);

                if (eventRow) {
                  const newStatus =
                    confirmedCount >= (eventRow.maxTrucks ?? 1)
                      ? "filled"
                      : "open";
                  await db
                    .update(events)
                    .set({ status: newStatus, updatedAt: now })
                    .where(eq(events.id, booking.eventId));

                  // Capacity warning notification
                  try {
                    if (
                      confirmedCount >= (eventRow.maxTrucks ?? 1) ||
                      confirmedCount / (eventRow.maxTrucks ?? 1) >= 0.8
                    ) {
                      await notifyHostCapacityWarning({
                        hostId: eventRow.hostId,
                        eventId: booking.eventId,
                        eventStartDate: eventRow.date ?? null,
                        confirmedCount,
                        maxTrucks: eventRow.maxTrucks ?? 1,
                      });
                    }
                  } catch (notifyErr) {
                    console.error(
                      "[WEBHOOK] Capacity notify error:",
                      notifyErr,
                    );
                  }
                }

                // Record host earnings
                try {
                  const { recordHostBookingEarnings } =
                    await import("../hostEarningsService");
                  if (Number(booking.hostPriceCents || 0) > 0) {
                    await recordHostBookingEarnings([
                      {
                        hostId: booking.hostId,
                        bookingId: booking.id,
                        amountCents: Number(booking.hostPriceCents),
                        stripePaymentIntentId: paymentIntent.id,
                      },
                    ]);
                  }
                } catch (ledgerErr) {
                  console.error("[WEBHOOK] Host earnings error:", ledgerErr);
                }

                // Send confirmation email to truck owner
                try {
                  const [truck] = await db
                    .select({ ownerId: restaurants.ownerId })
                    .from(restaurants)
                    .where(eq(restaurants.id, booking.truckId));
                  const owner = truck
                    ? await storage.getUser(truck.ownerId)
                    : null;
                  const [hostRow] = await db
                    .select({ businessName: hosts.businessName })
                    .from(hosts)
                    .where(eq(hosts.id, booking.hostId))
                    .limit(1);
                  if (owner?.email && eventRow) {
                    const dateKey = eventRow.date
                      ? new Date(eventRow.date).toISOString().slice(0, 10)
                      : "";
                    await emailService.sendBookingConfirmationEmail({
                      to: owner.email,
                      hostName: hostRow?.businessName || "Host location",
                      startDate: dateKey,
                      endDate: dateKey,
                      slotSummary: eventRow.name || "Event",
                      totalCents: booking.totalCents,
                    });
                  }
                } catch (emailErr) {
                  console.error(
                    "[WEBHOOK] Booking confirmation email error:",
                    emailErr,
                  );
                }
              } catch (bookingError) {
                console.error(
                  "[WEBHOOK] Error confirming event booking:",
                  bookingError,
                );
              }
              break;
            }
            // ─────────────────────────────────────────────────────────────

            const passId = metadata.passId;
            const truckId = metadata.truckId;

            if (!passId || !truckId) {
              break;
            }

            const amountCents =
              Number(metadata.totalCents) || Number(paymentIntent.amount || 0);

            const intentRows = await db
              .select()
              .from(eventBookings)
              .where(
                and(
                  eq(eventBookings.stripePaymentIntentId, paymentIntent.id),
                  eq(eventBookings.truckId, truckId),
                ),
              );
            const pendingHolds = intentRows.filter(
              (row: (typeof intentRows)[number]) => row.status === "pending",
            );
            const alreadyProcessed = intentRows.some(
              (row: (typeof intentRows)[number]) =>
                row.status === "confirmed" ||
                (row.status === "cancelled" && row.refundStatus === "credit"),
            );
            if (alreadyProcessed) {
              break;
            }

            const [eventRow] = await db
              .select()
              .from(events)
              .where(eq(events.id, passId));

            if (!eventRow || !eventRow.requiresPayment) {
              break;
            }

            const [host] = await db
              .select()
              .from(hosts)
              .where(eq(hosts.id, eventRow.hostId));
            const bookingTimeZone = resolveCityTimeZoneSync({
              city: host?.city,
              state: host?.state,
            });

            const slotTypes = String(
              metadata.slotTypes || metadata.slotType || "",
            )
              .split(",")
              .map((value) => value.trim().toLowerCase())
              .filter((value) => value.length > 0)
              .filter((value) =>
                PARKING_PASS_SLOT_TYPES.includes(value as any),
              );
            const normalizedSlotTypes =
              slotTypes.length > 0 ? slotTypes : ["daily"];

            const hasMonthly = normalizedSlotTypes.includes("monthly");
            const hasWeekly = normalizedSlotTypes.includes("weekly");
            const hasDaily = normalizedSlotTypes.includes("daily");
            const bookingDays = Math.max(
              1,
              Number(
                metadata.bookingDays ||
                  (hasMonthly
                    ? PARKING_PASS_BOOKING_DAYS.monthly
                    : hasWeekly
                      ? PARKING_PASS_BOOKING_DAYS.weekly
                      : hasDaily
                        ? PARKING_PASS_BOOKING_DAYS.daily
                        : 1),
              ),
            );

            const startDateKey = metadata.bookingStartDate
              ? String(metadata.bookingStartDate)
              : dateKeyInZone(new Date(eventRow.date), bookingTimeZone);
            const rangeStart = utcDateFromDateKey(startDateKey);
            const rangeEnd = new Date(rangeStart);
            rangeEnd.setDate(rangeEnd.getDate() + bookingDays);

            const bookingEvents: Array<typeof events.$inferSelect> = await db
              .select()
              .from(events)
              .where(
                and(
                  eq(events.hostId, eventRow.hostId),
                  eq(events.requiresPayment, true),
                  gte(events.date, rangeStart),
                  lt(events.date, rangeEnd),
                ),
              )
              .orderBy(asc(events.date));

            const eventsByDate = new Map<
              string,
              (typeof bookingEvents)[number]
            >();
            for (const row of bookingEvents) {
              const dateKey = dateKeyInZone(
                new Date(row.date),
                bookingTimeZone,
              );
              eventsByDate.set(dateKey, row);
            }

            const expectedDateKeys: string[] = [];
            for (let offset = 0; offset < bookingDays; offset += 1) {
              expectedDateKeys.push(addDaysToDateKey(startDateKey, offset));
            }

            const metadataHostPriceCents = Number(metadata.hostPriceCents || 0);
            const metadataPlatformFeeCents = Number(
              metadata.platformFeeCents || 0,
            );
            let cancelled = false;
            const cancelWithCredit = async (reason: string) => {
              if (cancelled) return;
              cancelled = true;
              const [truck] = await db
                .select({ ownerId: restaurants.ownerId })
                .from(restaurants)
                .where(eq(restaurants.id, truckId));

              if (truck?.ownerId) {
                const { addCredit } = await import("../creditService");
                await addCredit(
                  truck.ownerId,
                  amountCents / 100,
                  reason,
                  paymentIntent.id,
                );
              }

              // If we created pending holds ahead of payment, update them instead of inserting,
              // otherwise the unique constraint (event_id, truck_id) can fail.
              if (intentRows.length > 0) {
                const now = new Date();
                for (const row of intentRows) {
                  await db
                    .update(eventBookings)
                    .set({
                      status: "cancelled",
                      stripePaymentStatus: "succeeded",
                      refundStatus: "credit",
                      refundAmountCents: row.totalCents,
                      refundedAt: now,
                      refundReason: "Credit issued",
                      cancelledAt: now,
                      cancellationReason: "Overbooked - credit issued",
                      updatedAt: now,
                    })
                    .where(eq(eventBookings.id, row.id));
                }
                return;
              }

              try {
                await db
                  .insert(eventBookings)
                  .values({
                    eventId: passId,
                    truckId,
                    hostId: eventRow.hostId,
                    hostPriceCents: metadataHostPriceCents,
                    platformFeeCents: metadataPlatformFeeCents,
                    totalCents: amountCents,
                    status: "cancelled",
                    stripePaymentIntentId: paymentIntent.id,
                    stripePaymentStatus: "succeeded",
                    stripeApplicationFeeAmount: metadataPlatformFeeCents,
                    stripeTransferDestination:
                      host?.stripeConnectAccountId || null,
                    slotType: normalizedSlotTypes.join(","),
                    refundStatus: "credit",
                    refundAmountCents: amountCents,
                    refundedAt: new Date(),
                    refundReason: "Overbooked",
                    cancelledAt: new Date(),
                    cancellationReason: "Overbooked - credit issued",
                  })
                  .onConflictDoNothing();
              } catch (error) {
                console.warn(
                  "[WEBHOOK] Unable to insert cancelled booking row after credit:",
                  error,
                );
              }
            };

            const missingDates = expectedDateKeys.filter(
              (dateKey) => !eventsByDate.has(dateKey),
            );
            if (missingDates.length > 0) {
              await cancelWithCredit("parking_pass_overbook");
              break;
            }

            for (const dateKey of expectedDateKeys) {
              const row = eventsByDate.get(dateKey);
              if (!row) continue;
              if (row.status !== "open") {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              for (const slotType of normalizedSlotTypes) {
                if (
                  !isSlotWithinHours(
                    slotType as any,
                    row.startTime,
                    row.endTime,
                  )
                ) {
                  await cancelWithCredit("parking_pass_overbook");
                  break;
                }
              }
              if (cancelled) {
                break;
              }
            }
            if (cancelled) {
              break;
            }

            const eventIds = bookingEvents.map((row) => row.id);
            const counts =
              eventIds.length > 0
                ? await db
                    .select({
                      eventId: eventBookings.eventId,
                      count: sql<number>`count(*)`,
                    })
                    .from(eventBookings)
                    .where(inArray(eventBookings.eventId, eventIds))
                    .where(inArray(eventBookings.status, ["confirmed"]))
                    .groupBy(eventBookings.eventId)
                : [];

            const countsByEvent = new Map<string, number>();
            for (const row of counts) {
              countsByEvent.set(row.eventId, Number(row.count || 0));
            }

            for (const dateKey of expectedDateKeys) {
              const row = eventsByDate.get(dateKey);
              if (!row) continue;
              const count = countsByEvent.get(row.id) ?? 0;
              if (count >= (row.maxTrucks ?? 1)) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }
            }
            if (cancelled) {
              break;
            }

            const existingTruckBooking = await db
              .select({ id: eventBookings.id })
              .from(eventBookings)
              .where(inArray(eventBookings.eventId, eventIds))
              .where(eq(eventBookings.truckId, truckId))
              .where(inArray(eventBookings.status, ["confirmed"]))
              .limit(1);

            if (existingTruckBooking.length > 0) {
              await cancelWithCredit("parking_pass_duplicate");
              break;
            }

            const splitAmount = (total: number, days: number) => {
              if (days <= 1) return [total];
              const base = Math.floor(total / days);
              const remainder = total - base * days;
              return Array.from({ length: days }, (_, index) =>
                index === 0 ? base + remainder : base,
              );
            };

            const hostPriceCents = Number(metadata.hostPriceCents || 0);
            const platformFeeCents = Number(metadata.platformFeeCents || 0);
            const hostSplit = splitAmount(hostPriceCents, bookingDays);
            const platformSplit = splitAmount(platformFeeCents, bookingDays);

            const confirmedBookings = await db
              .select({
                eventId: eventBookings.eventId,
                spotNumber: eventBookings.spotNumber,
                bookingConfirmedAt: eventBookings.bookingConfirmedAt,
              })
              .from(eventBookings)
              .where(inArray(eventBookings.eventId, eventIds))
              .where(inArray(eventBookings.status, ["confirmed"]))
              .orderBy(asc(eventBookings.bookingConfirmedAt));

            const bookingsByEvent = new Map<
              string,
              (typeof confirmedBookings)[number][]
            >();
            for (const row of confirmedBookings) {
              const list = bookingsByEvent.get(row.eventId) ?? [];
              list.push(row);
              bookingsByEvent.set(row.eventId, list);
            }

            const now = new Date();
            // If the PaymentIntent succeeded but we no longer have pending holds
            // (e.g. hold expired or was cancelled), do NOT confirm a booking.
            // Instead, issue credits and mark the rows cancelled so we don't create ghost bookings.
            if (intentRows.length > 0 && pendingHolds.length === 0) {
              await cancelWithCredit("parking_pass_hold_expired");
              break;
            }

            const usesHolds = pendingHolds.length > 0;
            let bookingConfirmed = false;
            const newlyConfirmedByEventId = new Map<string, number>();
            const incrementNewlyConfirmed = (eventId: string) => {
              newlyConfirmedByEventId.set(
                eventId,
                (newlyConfirmedByEventId.get(eventId) ?? 0) + 1,
              );
            };
            const earnedEntries: Array<{
              hostId: string;
              bookingId: string;
              amountCents: number;
            }> = [];

            if (usesHolds) {
              const holdsByEventId = new Map<
                string,
                (typeof pendingHolds)[number]
              >();
              for (const row of pendingHolds) {
                holdsByEventId.set(row.eventId, row);
              }

              const plannedUpdates = expectedDateKeys.map((dateKey, index) => {
                const row = eventsByDate.get(dateKey);
                if (!row) return null;
                const hold = holdsByEventId.get(row.id);
                if (!hold) return null;

                const bookedRows = bookingsByEvent.get(row.id) ?? [];
                const usedSpotNumbers = new Set<number>();
                for (const booked of bookedRows) {
                  if (booked.spotNumber && booked.spotNumber > 0) {
                    usedSpotNumbers.add(booked.spotNumber);
                  }
                }
                let spotNumber = 1;
                while (usedSpotNumbers.has(spotNumber)) {
                  spotNumber += 1;
                }
                if (spotNumber > row.maxTrucks) {
                  return null;
                }

                // Ensure deterministic assignment for subsequent days in this loop.
                bookedRows.push({
                  eventId: row.id,
                  spotNumber,
                  bookingConfirmedAt: now,
                });
                bookingsByEvent.set(row.id, bookedRows);

                const hostCents = hostSplit[index] ?? 0;
                const feeCents = platformSplit[index] ?? 0;

                return {
                  id: hold.id,
                  eventId: row.id,
                  hostId: row.hostId,
                  hostCents,
                  feeCents,
                  spotNumber,
                };
              });

              const filtered = plannedUpdates.filter(
                (row): row is NonNullable<(typeof plannedUpdates)[number]> =>
                  Boolean(row),
              );

              if (filtered.length !== expectedDateKeys.length) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              for (const update of filtered) {
                await db
                  .update(eventBookings)
                  .set({
                    eventId: update.eventId,
                    truckId,
                    hostId: eventRow.hostId,
                    hostPriceCents: update.hostCents,
                    platformFeeCents: update.feeCents,
                    totalCents: update.hostCents + update.feeCents,
                    status: "confirmed",
                    stripePaymentIntentId: paymentIntent.id,
                    stripePaymentStatus: "succeeded",
                    stripeApplicationFeeAmount: update.feeCents,
                    stripeTransferDestination:
                      host?.stripeConnectAccountId || null,
                    slotType: normalizedSlotTypes.join(","),
                    paidAt: now,
                    bookingConfirmedAt: now,
                    spotNumber: update.spotNumber,
                    updatedAt: now,
                  })
                  .where(eq(eventBookings.id, update.id));

                incrementNewlyConfirmed(update.eventId);

                if (update.hostCents > 0) {
                  earnedEntries.push({
                    hostId: update.hostId,
                    bookingId: update.id,
                    amountCents: update.hostCents,
                  });
                }
              }
              bookingConfirmed = true;
            } else {
              const bookingRows = expectedDateKeys.map((dateKey, index) => {
                const row = eventsByDate.get(dateKey);
                if (!row) return null;

                const bookedRows = bookingsByEvent.get(row.id) ?? [];
                const usedSpotNumbers = new Set<number>();
                for (const booked of bookedRows) {
                  if (booked.spotNumber && booked.spotNumber > 0) {
                    usedSpotNumbers.add(booked.spotNumber);
                  }
                }
                let spotNumber = 1;
                while (usedSpotNumbers.has(spotNumber)) {
                  spotNumber += 1;
                }
                if (spotNumber > row.maxTrucks) {
                  return null;
                }

                const hostCents = hostSplit[index] ?? 0;
                const feeCents = platformSplit[index] ?? 0;

                return {
                  eventId: row.id,
                  truckId,
                  hostId: row.hostId,
                  hostPriceCents: hostCents,
                  platformFeeCents: feeCents,
                  totalCents: hostCents + feeCents,
                  status: "confirmed",
                  stripePaymentIntentId: paymentIntent.id,
                  stripePaymentStatus: "succeeded",
                  stripeApplicationFeeAmount: feeCents,
                  stripeTransferDestination:
                    host?.stripeConnectAccountId || null,
                  slotType: normalizedSlotTypes.join(","),
                  paidAt: now,
                  bookingConfirmedAt: now,
                  spotNumber,
                };
              });

              const filteredRows = bookingRows.filter(
                (row): row is NonNullable<(typeof bookingRows)[number]> =>
                  Boolean(row),
              );

              if (filteredRows.length !== expectedDateKeys.length) {
                await cancelWithCredit("parking_pass_overbook");
                break;
              }

              const insertedRows = await db
                .insert(eventBookings)
                .values(filteredRows)
                .onConflictDoNothing()
                .returning({
                  id: eventBookings.id,
                  hostId: eventBookings.hostId,
                  hostPriceCents: eventBookings.hostPriceCents,
                });

              if (insertedRows.length === 0) {
                const existingRows = await db
                  .select({
                    id: eventBookings.id,
                    eventId: eventBookings.eventId,
                    hostId: eventBookings.hostId,
                    hostPriceCents: eventBookings.hostPriceCents,
                  })
                  .from(eventBookings)
                  .where(inArray(eventBookings.eventId, eventIds))
                  .where(eq(eventBookings.truckId, truckId))
                  .where(
                    eq(eventBookings.stripePaymentIntentId, paymentIntent.id),
                  )
                  .where(eq(eventBookings.status, "confirmed"));

                if (existingRows.length === expectedDateKeys.length) {
                  bookingConfirmed = true;
                  for (const row of existingRows) {
                    incrementNewlyConfirmed(row.eventId);
                  }
                } else {
                  await cancelWithCredit("parking_pass_duplicate");
                  break;
                }
              }

              if (insertedRows.length > 0) {
                for (const row of filteredRows) {
                  incrementNewlyConfirmed(row.eventId);
                }
              }

              for (const row of insertedRows) {
                if (Number(row.hostPriceCents || 0) > 0) {
                  earnedEntries.push({
                    hostId: row.hostId,
                    bookingId: row.id,
                    amountCents: Number(row.hostPriceCents || 0),
                  });
                }
              }

              bookingConfirmed = true;
            }

            if (bookingConfirmed) {
              try {
                const { recordHostBookingEarnings } =
                  await import("../hostEarningsService");
                await recordHostBookingEarnings(
                  earnedEntries.map((entry) => ({
                    ...entry,
                    stripePaymentIntentId: paymentIntent.id,
                  })),
                );
              } catch (ledgerError) {
                console.error(
                  "[WEBHOOK] Error recording host earnings ledger entries:",
                  ledgerError,
                );
              }

              try {
                const truck = await storage.getRestaurant(truckId);
                const owner = truck
                  ? await storage.getUser(truck.ownerId)
                  : null;
                if (owner?.email) {
                  const endDateKey =
                    expectedDateKeys[expectedDateKeys.length - 1] ||
                    startDateKey;
                  await emailService.sendBookingConfirmationEmail({
                    to: owner.email,
                    hostName: host?.businessName || "Host location",
                    startDate: startDateKey,
                    endDate: endDateKey,
                    slotSummary: normalizedSlotTypes.join(", "),
                    totalCents: amountCents,
                  });
                }

                // Best-effort: mark one-time booking-fee promo as redeemed.
                try {
                  const promoCode = String(metadata.bookingPromoCode || "")
                    .trim()
                    .toUpperCase();
                  if (promoCode === "BOOKFEE10") {
                    const explicitUserId = String(metadata.userId || "").trim();
                    const promoUserId = explicitUserId || owner?.id || "";
                    if (promoUserId) {
                      const userRecord = await storage.getUser(promoUserId);
                      const settings =
                        (userRecord?.accountSettings as any) || {};
                      const promos = settings.promos || {};
                      const bookingFee10 = promos.bookingFee10 || {};
                      promos.bookingFee10 = {
                        ...bookingFee10,
                        redeemedAt: now.toISOString(),
                        redeemedPaymentIntentId: paymentIntent.id,
                        discountCents: Number(
                          metadata.bookingPromoDiscountCents || 0,
                        ),
                        pendingPaymentIntentId: null,
                        pendingAt: null,
                      };
                      await storage.updateUser(promoUserId, {
                        accountSettings: { ...settings, promos } as any,
                      });
                    }
                  }
                } catch (promoError) {
                  console.error(
                    "[WEBHOOK] Error persisting booking promo redemption:",
                    promoError,
                  );
                }
              } catch (emailError) {
                console.error(
                  "[WEBHOOK] Error sending booking confirmation:",
                  emailError,
                );
              }
            }

            try {
              const creditAppliedCents = Number(
                metadata.creditAppliedCents || 0,
              );
              if (creditAppliedCents > 0) {
                const [truck] = await db
                  .select({ ownerId: restaurants.ownerId })
                  .from(restaurants)
                  .where(eq(restaurants.id, truckId));

                if (truck?.ownerId) {
                  const { debitCredit, getUserCreditBalance } =
                    await import("../creditService");
                  const balance = await getUserCreditBalance(truck.ownerId);
                  const availableCents = Math.max(0, Math.floor(balance * 100));
                  const debitCents = Math.min(
                    creditAppliedCents,
                    availableCents,
                  );
                  if (debitCents > 0) {
                    await debitCredit(
                      truck.ownerId,
                      debitCents / 100,
                      "booking_credit",
                      paymentIntent.id,
                      "booking",
                    );
                  }
                }
              }
            } catch (creditError) {
              console.error(
                "[WEBHOOK] Error debiting booking credits:",
                creditError,
              );
            }

            try {
              const [truckOwner] = await db
                .select({ ownerId: restaurants.ownerId })
                .from(restaurants)
                .where(eq(restaurants.id, truckId));

              if (host?.userId && truckOwner?.ownerId) {
                const { createAffiliateCommissionsForBooking } =
                  await import("../affiliateCommissionService");
                await createAffiliateCommissionsForBooking({
                  hostOwnerId: host.userId,
                  truckOwnerId: truckOwner.ownerId,
                  platformFeeCents,
                  paymentIntentId: paymentIntent.id,
                  truckRestaurantId: truckId,
                });
              }
            } catch (commissionError) {
              console.error(
                "[WEBHOOK] Error processing booking affiliate commissions:",
                commissionError,
              );
            }

            const affectedEventIds = Array.from(
              new Set(
                expectedDateKeys
                  .map((dateKey) => eventsByDate.get(dateKey)?.id)
                  .filter((id): id is string => Boolean(id)),
              ),
            );
            if (affectedEventIds.length === 0) {
              affectedEventIds.push(passId);
            }

            const maxTrucksByEventId = new Map<string, number>();
            const bookingEventsById = new Map<
              string,
              (typeof bookingEvents)[number]
            >();
            for (const row of bookingEvents) {
              maxTrucksByEventId.set(row.id, row.maxTrucks ?? 1);
              bookingEventsById.set(row.id, row);
            }

            const countRows =
              affectedEventIds.length > 0
                ? await db
                    .select({
                      eventId: eventBookings.eventId,
                      count: sql<number>`count(*)`,
                    })
                    .from(eventBookings)
                    .where(inArray(eventBookings.eventId, affectedEventIds))
                    .where(inArray(eventBookings.status, ["confirmed"]))
                    .groupBy(eventBookings.eventId)
                : [];

            const confirmedByEventId = new Map<string, number>();
            for (const row of countRows) {
              confirmedByEventId.set(row.eventId, Number(row.count || 0));
            }

            for (const eventId of affectedEventIds) {
              const confirmedCount = confirmedByEventId.get(eventId) ?? 0;
              const maxTrucks = maxTrucksByEventId.get(eventId) ?? 1;
              const newlyConfirmed = newlyConfirmedByEventId.get(eventId) ?? 0;
              const previousCount = Math.max(
                0,
                confirmedCount - newlyConfirmed,
              );
              const previousFillRate =
                maxTrucks > 0 ? previousCount / maxTrucks : 0;
              const currentFillRate =
                maxTrucks > 0 ? confirmedCount / maxTrucks : 0;
              const crossedWarningThreshold =
                previousFillRate < 0.8 && currentFillRate >= 0.8;
              const crossedFullThreshold =
                previousCount < maxTrucks && confirmedCount >= maxTrucks;
              const newStatus = confirmedCount >= maxTrucks ? "filled" : "open";

              if (crossedWarningThreshold || crossedFullThreshold) {
                const eventRowForNotify = bookingEventsById.get(eventId);
                if (eventRowForNotify) {
                  try {
                    await notifyHostCapacityWarning({
                      hostId: eventRowForNotify.hostId,
                      eventId,
                      eventStartDate: eventRowForNotify.date ?? null,
                      confirmedCount,
                      maxTrucks,
                    });
                  } catch (notifyError) {
                    console.error(
                      "[WEBHOOK] Error sending host capacity warning:",
                      notifyError,
                    );
                  }
                }
              }

              await db
                .update(events)
                .set({
                  status: newStatus,
                  bookedRestaurantId: null,
                })
                .where(eq(events.id, eventId));
            }
          } catch (error) {
            console.error("[WEBHOOK] Error confirming booking:", error);
          }
          break;

        case "payment_intent.payment_failed":
          const failedIntent = event.data.object;
          console.log(`[WEBHOOK] PaymentIntent ${failedIntent.id} failed`);

          try {
            const { eventBookings } = await import("@shared/schema");
            const metadata = (failedIntent as any).metadata || {};

            // Supplier marketplace order payment failure
            const supplierOrderId = metadata.supplierOrderId;
            if (supplierOrderId) {
              try {
                const { supplierOrders } = await import("@shared/schema");
                await db
                  .update(supplierOrders)
                  .set({
                    paymentStatus: "unpaid",
                    updatedAt: new Date(),
                  } as any)
                  .where(eq(supplierOrders.id, String(supplierOrderId)));
              } catch (supplierError) {
                console.error(
                  "[WEBHOOK] Supplier order failure update failed:",
                  supplierError,
                );
              }
              break;
            }

            await db
              .update(eventBookings)
              .set({
                status: "cancelled",
                stripePaymentStatus: "failed",
                cancellationReason: "Payment failed",
                cancelledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(eventBookings.stripePaymentIntentId, failedIntent.id));
          } catch (error) {
            console.error("[WEBHOOK] Error updating failed booking:", error);
          }
          break;

        case "customer.subscription.updated":
          const subscriptionUpdated = event.data.object;
          console.log(
            `[WEBHOOK] Subscription ${subscriptionUpdated.id} updated to status: ${subscriptionUpdated.status}`,
          );

          // Find user by subscription ID
          const userForUpdate = await storage.getUserByStripeSubscriptionId(
            subscriptionUpdated.id,
          );

          if (userForUpdate) {
            console.log(
              `[WEBHOOK] Found user ${userForUpdate.id} for subscription ${subscriptionUpdated.id}`,
            );

            // If subscription becomes inactive or canceled, we might want to handle it
            // For now, we rely on real-time checks in validateSubscriptionLimits
            if (
              subscriptionUpdated.status === "canceled" ||
              subscriptionUpdated.status === "incomplete_expired"
            ) {
              console.log(
                `[WEBHOOK] Subscription ${subscriptionUpdated.id} is now ${subscriptionUpdated.status} for user ${userForUpdate.id}`,
              );
              // The validateSubscriptionLimits function will catch this on next deal creation attempt
            } else if (subscriptionUpdated.status === "active") {
              console.log(
                `[WEBHOOK] Subscription ${subscriptionUpdated.id} is active for user ${userForUpdate.id}`,
              );
            }
          } else {
            console.log(
              `[WEBHOOK] Warning: No user found for subscription ${subscriptionUpdated.id}`,
            );
          }
          break;

        case "customer.subscription.deleted":
          const subscriptionDeleted = event.data.object;
          console.log(
            `[WEBHOOK] Subscription ${subscriptionDeleted.id} was deleted`,
          );

          // Find user and clear their subscription
          const userForDeletion = await storage.getUserByStripeSubscriptionId(
            subscriptionDeleted.id,
          );

          if (userForDeletion) {
            console.log(
              `[WEBHOOK] Clearing subscription for user ${userForDeletion.id}`,
            );
            await storage.updateUser(userForDeletion.id, {
              stripeSubscriptionId: null,
            });
            console.log(
              `[WEBHOOK] Subscription cleared for user ${userForDeletion.id} (${userForDeletion.email})`,
            );
          } else {
            console.log(
              `[WEBHOOK] Warning: No user found for deleted subscription ${subscriptionDeleted.id}`,
            );
          }
          break;

        case "account.updated": {
          const account = event.data.object as Stripe.Account;
          const accountId = String(account.id || "").trim();
          if (!accountId) break;

          const status =
            account.charges_enabled && account.payouts_enabled
              ? "active"
              : "pending";
          const updateValues = {
            stripeChargesEnabled: Boolean(account.charges_enabled),
            stripePayoutsEnabled: Boolean(account.payouts_enabled),
            stripeOnboardingCompleted: Boolean(account.details_submitted),
            stripeConnectStatus: status,
            updatedAt: new Date(),
          } as any;

          const hostUpdate = await db
            .update(hosts)
            .set(updateValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(updateValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const hostRows = Number((hostUpdate as any)?.rowCount || 0);
          const supplierRows = Number((supplierUpdate as any)?.rowCount || 0);
          console.log(
            `[WEBHOOK] Synced Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows})`,
          );
          break;
        }

        case "account.application.deauthorized": {
          const deauth = event.data.object as any;
          const accountId = String(deauth?.account || "").trim();
          if (!accountId) break;

          const revokedValues = {
            stripeConnectStatus: "revoked",
            stripeOnboardingCompleted: false,
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            updatedAt: new Date(),
          } as any;

          const hostUpdate = await db
            .update(hosts)
            .set(revokedValues)
            .where(eq(hosts.stripeConnectAccountId, accountId));

          const supplierUpdate = await db
            .update(suppliers)
            .set(revokedValues)
            .where(eq(suppliers.stripeConnectAccountId, accountId));

          const hostRows = Number((hostUpdate as any)?.rowCount || 0);
          const supplierRows = Number((supplierUpdate as any)?.rowCount || 0);
          console.log(
            `[WEBHOOK] Deauthorized Stripe account ${accountId} (hosts: ${hostRows}, suppliers: ${supplierRows})`,
          );
          break;
        }

        default:
          console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("[WEBHOOK] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}
