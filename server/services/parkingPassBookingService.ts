import Stripe from "stripe";
import {
  businessStaffMemberships,
  eventBookings,
  eventParticipationMutationChildren,
  eventParticipationMutations,
  eventSeries,
  events,
  hosts,
  parkingPassBlackoutDates,
  parkingPassArrivalVersions,
  parkingPassCancellationOperations,
  parkingPassCreditLedger,
  parkingPassProviderOperations,
  parkingPassProviderOperationSteps,
  parkingPassPurchases,
  restaurants,
  users,
} from "@shared/schema";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { emailService } from "../emailService";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { resolveCityTimeZoneStrict } from "./cityTimeZone";
import { buildSlotDateTimes } from "./timeIntent";
import {
  normalizePersistedIanaTimeZone,
  resolvePersistedEventServiceTimeZone,
} from "./persistedServiceTimeZoneRules";
import {
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
} from "./dateKeys";
import {
  canCoordinateEvent,
  isSettledPaidParticipation,
} from "./eventParticipationPolicy";
import {
  wakeEventParticipationMutationForCancellation,
  wakeEventParticipationMutationsForBookings,
} from "./eventParticipationMutationWake";
import {
  allocateRestrictedPlatformCredit,
  decidePreCaptureProviderAction,
  decideProviderCreateRecovery,
  evaluateCancellationPolicy,
  evaluatePaidLineReservation,
  parkingPassFinancialDigest,
  resolveDisputeConvergence,
  stableParkingPassLineIds,
  summarizeSelectedLineRemedy,
  validateRefundWebhookIdentity,
  type CancellationAuthority,
  type ParkingPassRemedy,
} from "./parkingPassFinancialPolicy";
import { isNormalizedProduction } from "@shared/financialTestSafety";

const configuredStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export class ParkingPassBookingError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ParkingPassBookingError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export type PreparedParkingPassLine = {
  eventId: string;
  hostPriceCents: number;
  platformFeeCents: number;
  slotType: string;
};

export type CreateParkingPassPurchaseInput = {
  purchaserUserId: string;
  truckId: string;
  hostId: string;
  idempotencyKey: string;
  requestedCreditCents?: number;
  lines: PreparedParkingPassLine[];
  stripe?: Stripe | null;
  bypassProvider?: boolean;
  metadata?: Record<string, string>;
};

type PurchaseResult = {
  purchaseId: string;
  bookingIds: string[];
  paymentIntentId: string | null;
  clientSecret: string | null;
  totalCents: number;
  breakdown: {
    hostPrice: number;
    platformFee: number;
    creditsApplied: number;
  };
  hostPaymentsReady: true;
  bypassed?: boolean;
};

/**
 * Canonical zero-event-safe blackout writer. The date advisory lock is shared
 * with purchase reservation and captured confirmation so the winning fact is
 * always rechecked before local financial state can advance.
 */
export async function createParkingPassBlackout(input: {
  hostId: string;
  actorUserId: string;
  dateKey: string;
  now?: Date;
}) {
  const hostId = clean(input.hostId);
  const actorUserId = clean(input.actorUserId);
  const dateKey = dateKeyFromUnknown(input.dateKey, "UTC");
  if (!hostId || !actorUserId || !dateKey) {
    throw new ParkingPassBookingError(
      400,
      "invalid_blackout_request",
      "Host, current owner, and a calendar date are required.",
    );
  }
  const candidates = await db
    .select()
    .from(eventSeries)
    .where(
      and(
        eq(eventSeries.hostId, hostId),
        eq(eventSeries.seriesType, "parking_pass"),
        inArray(eventSeries.status, ["draft", "published"]),
      ),
    )
    .orderBy(asc(eventSeries.id));
  const matching = candidates.filter(
    (series: typeof eventSeries.$inferSelect) => {
    if (!normalizePersistedIanaTimeZone(series.timezone)) return false;
    const startKey = dateKeyFromUnknown(series.startDate, "UTC");
    const endKey = dateKeyFromUnknown(series.endDate, "UTC");
    return Boolean(
      startKey && dateKey >= startKey && (!endKey || dateKey <= endKey),
    );
    },
  );
  if (matching.length !== 1) {
    throw new ParkingPassBookingError(
      409,
      matching.length === 0
        ? "parking_pass_series_unavailable"
        : "parking_pass_series_ambiguous",
      matching.length === 0
        ? "No active Parking Pass covers that calendar date."
        : "More than one Parking Pass covers that date; reconcile the host configuration first.",
    );
  }
  const seriesId = matching[0].id;
  const date = utcDateFromDateKey(dateKey);
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_date:${seriesId}:${dateKey}`}))`,
    );
    await tx.execute(
      sql`SELECT set_config('mealscout.parking_pass_blackout_scope', ${`${seriesId}:${dateKey}`}, true)`,
    );
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .limit(1)
      .for("update");
    const [host] = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1)
      .for("update");
    const timeZone = normalizePersistedIanaTimeZone(series?.timezone);
    const startKey = dateKeyFromUnknown(series?.startDate, "UTC");
    const endKey = dateKeyFromUnknown(series?.endDate, "UTC");
    if (
      !series ||
      !host ||
      host.userId !== actorUserId ||
      series.hostId !== host.id ||
      series.seriesType !== "parking_pass" ||
      !["draft", "published"].includes(series.status) ||
      !timeZone ||
      !startKey ||
      dateKey < startKey ||
      (endKey !== null && dateKey > endKey)
    ) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_blackout_authority_changed",
        "The host, series, or service-calendar authority changed before the blackout could be saved.",
      );
    }
    if (dateKey < dateKeyInZone(input.now || new Date(), timeZone)) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_blackout_in_past",
        "A past Parking Pass date cannot be blocked.",
      );
    }
    const confirmed = await tx
      .select({ id: eventBookings.id })
      .from(eventBookings)
      .innerJoin(events, eq(events.id, eventBookings.eventId))
      .where(
        and(
          eq(events.seriesId, series.id),
          eq(events.date, date),
          eq(eventBookings.status, "confirmed"),
        ),
      )
      .limit(1)
      .for("update");
    if (confirmed.length > 0) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_blackout_conflicts_confirmed_booking",
        "This date already has a confirmed paid booking and cannot be blocked directly.",
      );
    }
    const inserted = await tx
      .insert(parkingPassBlackoutDates)
      .values({ seriesId: series.id, date })
      .onConflictDoNothing({
        target: [parkingPassBlackoutDates.seriesId, parkingPassBlackoutDates.date],
      })
      .returning();
    if (inserted[0]) return inserted[0];
    const [existing] = await tx
      .select()
      .from(parkingPassBlackoutDates)
      .where(
        and(
          eq(parkingPassBlackoutDates.seriesId, series.id),
          eq(parkingPassBlackoutDates.date, date),
        ),
      )
      .limit(1);
    return existing;
  });
}

export async function deleteParkingPassBlackout(input: {
  hostId: string;
  actorUserId: string;
  dateKey: string;
  now?: Date;
}) {
  const hostId = clean(input.hostId);
  const actorUserId = clean(input.actorUserId);
  const dateKey = dateKeyFromUnknown(input.dateKey, "UTC");
  if (!hostId || !actorUserId || !dateKey) {
    throw new ParkingPassBookingError(
      400,
      "invalid_blackout_request",
      "Host, current owner, and a calendar date are required.",
    );
  }
  const date = utcDateFromDateKey(dateKey);
  const candidates = await db
    .select()
    .from(eventSeries)
    .where(
      and(
        eq(eventSeries.hostId, hostId),
        eq(eventSeries.seriesType, "parking_pass"),
        inArray(eventSeries.status, ["draft", "published"]),
      ),
    )
    .orderBy(asc(eventSeries.id));
  const matching = candidates.filter(
    (series: typeof eventSeries.$inferSelect) => {
      const startKey = dateKeyFromUnknown(series.startDate, "UTC");
      const endKey = dateKeyFromUnknown(series.endDate, "UTC");
      return Boolean(
        normalizePersistedIanaTimeZone(series.timezone) &&
          startKey &&
          dateKey >= startKey &&
          (!endKey || dateKey <= endKey),
      );
    },
  );
  if (matching.length !== 1) {
    throw new ParkingPassBookingError(
      409,
      matching.length === 0
        ? "parking_pass_series_unavailable"
        : "parking_pass_series_ambiguous",
      "The Parking Pass series for that date is unavailable or ambiguous.",
    );
  }
  const seriesId = matching[0].id;
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_date:${seriesId}:${dateKey}`}))`,
    );
    await tx.execute(
      sql`SELECT set_config('mealscout.parking_pass_blackout_scope', ${`${seriesId}:${dateKey}`}, true)`,
    );
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .limit(1)
      .for("update");
    const [host] = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1)
      .for("update");
    const timeZone = normalizePersistedIanaTimeZone(series?.timezone);
    const startKey = dateKeyFromUnknown(series?.startDate, "UTC");
    const endKey = dateKeyFromUnknown(series?.endDate, "UTC");
    if (
      !series ||
      !host ||
      host.userId !== actorUserId ||
      series.hostId !== host.id ||
      series.seriesType !== "parking_pass" ||
      !["draft", "published"].includes(series.status) ||
      !timeZone ||
      !startKey ||
      dateKey < startKey ||
      (endKey !== null && dateKey > endKey)
    ) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_blackout_authority_changed",
        "The blackout authority changed before removal.",
      );
    }
    if (dateKey <= dateKeyInZone(input.now || new Date(), timeZone)) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_blackout_removal_closed",
        "Same-day or past Parking Pass blackouts cannot be removed.",
      );
    }
    const removed = await tx
      .delete(parkingPassBlackoutDates)
      .where(
        and(
          eq(parkingPassBlackoutDates.seriesId, series.id),
          eq(parkingPassBlackoutDates.date, date),
        ),
      )
      .returning({ id: parkingPassBlackoutDates.id });
    return { removed: removed.length > 0, seriesId, dateKey };
  });
}

type CancellationOperation =
  typeof parkingPassCancellationOperations.$inferSelect;

export function serializeParkingPassCancellationOperation(
  operation: CancellationOperation,
) {
  const status = clean(operation.status);
  const guidance =
    status === "failed_action_required"
      ? "Provider confirmation is incomplete. Retry with the same request ID or contact support; do not start a second refund."
      : status === "processing" || status === "pending"
        ? "Provider steps are still processing. The cash remedy is not complete until provider-confirmed."
        : status === "provider_confirmed"
          ? "Stripe confirmed the exact cash refund and settlement reversal steps."
          : status === "credit_issued"
            ? "The non-cash credit is posted and restricted to future Parking Pass platform fees."
            : status === "released"
              ? "Stripe confirmed cancellation or the checkout was proven not created, so reserved capacity was released."
              : "This cancellation has no cash or credit remedy under the recorded policy facts.";
  return {
    id: operation.id,
    requestId: operation.requestId,
    status,
    remedy: operation.remedy,
    amountCents: operation.amountCents,
    providerStatus: operation.providerStatus,
    errorCode: operation.providerErrorCode,
    errorMessage: operation.providerErrorMessage,
    retryable: status === "failed_action_required",
    guidance,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt,
  };
}

const clean = (value: unknown) => String(value || "").trim();

function stableSeriesDateFacts(
  eventRows: Array<Pick<typeof events.$inferSelect, "id" | "seriesId" | "date">>,
) {
  const byKey = new Map<
    string,
    { eventId: string; seriesId: string; dateKey: string; date: Date }
  >();
  for (const event of eventRows) {
    const seriesId = clean(event.seriesId);
    const dateKey = dateKeyFromUnknown(event.date, "UTC");
    if (!seriesId || !dateKey) continue;
    byKey.set(`${seriesId}:${dateKey}`, {
      eventId: event.id,
      seriesId,
      dateKey,
      date: utcDateFromDateKey(dateKey),
    });
  }
  return Array.from(byKey.values()).sort((left, right) =>
    `${left.seriesId}:${left.dateKey}`.localeCompare(
      `${right.seriesId}:${right.dateKey}`,
    ),
  );
}

async function lockParkingPassSeriesDates(
  tx: any,
  eventRows: Array<Pick<typeof events.$inferSelect, "id" | "seriesId" | "date">>,
) {
  const facts = stableSeriesDateFacts(eventRows);
  for (const fact of facts) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_date:${fact.seriesId}:${fact.dateKey}`}))`,
    );
  }
  return facts;
}

async function assertNoParkingPassBlackoutLocked(input: {
  tx: any;
  facts: ReturnType<typeof stableSeriesDateFacts>;
  seriesById: Map<string, typeof eventSeries.$inferSelect>;
}) {
  for (const fact of input.facts) {
    const series = input.seriesById.get(fact.seriesId);
    if (series?.seriesType !== "parking_pass") continue;
    const [blackout] = await input.tx
      .select({ id: parkingPassBlackoutDates.id })
      .from(parkingPassBlackoutDates)
      .where(
        and(
          eq(parkingPassBlackoutDates.seriesId, fact.seriesId),
          eq(parkingPassBlackoutDates.date, fact.date),
        ),
      )
      .limit(1)
      .for("update");
    if (blackout) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_date_blocked",
        "One of the selected Parking Pass dates is blocked by the host.",
        {
          eventId: fact.eventId,
          seriesId: fact.seriesId,
          dateKey: fact.dateKey,
        },
      );
    }
  }
}
const escapeHtml = (value: unknown) =>
  clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const cents = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

const stableLineIds = stableParkingPassLineIds;
const stableDigest = parkingPassFinancialDigest;

/**
 * A dated paid occurrence must still belong to the same kind of published
 * supply as its parent. Parking Pass occurrences cannot be smuggled into an
 * ordinary/open-call series (or vice versa) after checkout was prepared.
 */
function eventSeriesTopologyIsServiceable(
  event: typeof events.$inferSelect,
  series: typeof eventSeries.$inferSelect,
) {
  const parkingPassEvent = clean(event.eventType) === "parking_pass";
  const parkingPassSeries = clean(series.seriesType) === "parking_pass";
  return (
    series.status === "published" &&
    parkingPassEvent === parkingPassSeries
  );
}

const providerIdempotencyDeadline = (from = new Date()) =>
  new Date(from.getTime() + 24 * 60 * 60 * 1000);

const hasManageParkingPassPermission = (permissions: unknown) => {
  if (!permissions || typeof permissions !== "object") return false;
  return (permissions as Record<string, unknown>).manageParkingPass === true;
};

async function assertCurrentTruckTeamAuthorityLocked(
  database: any,
  truckId: string,
  actorUserId: string,
) {
  const [actor] = await database
    .select({ isDisabled: users.isDisabled })
    .from(users)
    .where(eq(users.id, clean(actorUserId)))
    .limit(1)
    .for("update");
  const [truck] = await database
    .select({ ownerId: restaurants.ownerId })
    .from(restaurants)
    .where(eq(restaurants.id, clean(truckId)))
    .limit(1)
    .for("update");
  const [membership] = await database
    .select({
      status: businessStaffMemberships.status,
      permissions: businessStaffMemberships.permissions,
    })
    .from(businessStaffMemberships)
    .where(
      and(
        eq(businessStaffMemberships.restaurantId, clean(truckId)),
        eq(businessStaffMemberships.userId, clean(actorUserId)),
      ),
    )
    .limit(1)
    .for("update");
  const authorized =
    actor?.isDisabled === false &&
    (truck?.ownerId === clean(actorUserId) ||
      (membership?.status === "active" &&
        hasManageParkingPassPermission(membership.permissions)));
  if (!truck || !authorized) {
    throw new ParkingPassBookingError(
      403,
      "parking_pass_purchase_forbidden",
      "Your current truck-team authority does not allow Parking Pass checkout.",
    );
  }
  return { actor, truck, membership };
}

const stripeChargeId = (intent: Stripe.PaymentIntent) => {
  const charge = intent.latest_charge;
  return typeof charge === "string" ? charge : clean(charge?.id) || null;
};

const destinationFromIntent = (intent: Stripe.PaymentIntent) => {
  const destination = intent.transfer_data?.destination;
  return typeof destination === "string"
    ? destination
    : clean(destination?.id) || null;
};

async function assertCurrentConnectReady(input: {
  hostId: string;
  expectedDestinationAccountId?: string | null;
  stripe: Stripe | null;
  database?: any;
  lock?: boolean;
}) {
  const database = input.database || db;
  let query: any = database
    .select({
      stripeConnectAccountId: hosts.stripeConnectAccountId,
      stripeOnboardingCompleted: hosts.stripeOnboardingCompleted,
      stripeChargesEnabled: hosts.stripeChargesEnabled,
      stripePayoutsEnabled: hosts.stripePayoutsEnabled,
      ownerDisabled: users.isDisabled,
    })
    .from(hosts)
    .innerJoin(users, eq(users.id, hosts.userId))
    .where(eq(hosts.id, clean(input.hostId)))
    .limit(1);
  if (input.lock) query = query.for("update");
  const [host] = await query;
  const destinationAccountId = clean(host?.stripeConnectAccountId);
  if (
    !host ||
    host.ownerDisabled !== false ||
    !destinationAccountId ||
    (input.expectedDestinationAccountId &&
      destinationAccountId !== clean(input.expectedDestinationAccountId)) ||
    host.stripeOnboardingCompleted !== true ||
    host.stripeChargesEnabled !== true ||
    host.stripePayoutsEnabled !== true
  ) {
    throw new ParkingPassBookingError(
      409,
      "host_connect_not_ready",
      "This host must have current Stripe onboarding, charges, and payouts enabled before checkout can continue.",
    );
  }
  if (!input.stripe) {
    throw new ParkingPassBookingError(
      503,
      "stripe_not_configured",
      "Payments are unavailable right now.",
    );
  }
  let account: Stripe.Account;
  try {
    account = await input.stripe.accounts.retrieve(destinationAccountId);
  } catch (error) {
    console.warn("[parking-pass] current Connect verification unavailable", {
      hostId: input.hostId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ParkingPassBookingError(
      503,
      "host_connect_status_unavailable",
      "The host payment account could not be verified. Try again shortly.",
    );
  }
  if (
    account.details_submitted !== true ||
    account.charges_enabled !== true ||
    account.payouts_enabled !== true
  ) {
    throw new ParkingPassBookingError(
      409,
      "host_connect_not_ready",
      "Stripe does not currently report onboarding, charges, and payouts ready for this host.",
    );
  }
  return { destinationAccountId, account };
}

async function restrictedCreditBalanceCents(
  userId: string,
  database: any = db,
): Promise<number> {
  const [row] = await database
    .select({
      total: sql<number>`coalesce(sum(
        case
          when ${parkingPassCreditLedger.state} = 'posted'
            then ${parkingPassCreditLedger.amountCents}
          when ${parkingPassCreditLedger.state} = 'reserved'
               and ${parkingPassCreditLedger.amountCents} < 0
            then ${parkingPassCreditLedger.amountCents}
          else 0
        end
      ), 0)`,
    })
    .from(parkingPassCreditLedger)
    .where(eq(parkingPassCreditLedger.userId, userId));
  return Math.max(0, Number(row?.total || 0));
}

export async function getParkingPassCreditBalanceCents(userId: string) {
  return restrictedCreditBalanceCents(clean(userId));
}

async function existingPurchaseResult(input: {
  purchase: typeof parkingPassPurchases.$inferSelect;
  stripe: Stripe | null;
}): Promise<PurchaseResult | null> {
  if (!["pending", "confirmed"].includes(input.purchase.status)) {
    throw new ParkingPassBookingError(
      409,
      "purchase_closed",
      "This Parking Pass checkout is closed. Start a new checkout with a new request ID.",
    );
  }
  const lines = await db
    .select({ id: eventBookings.id })
    .from(eventBookings)
    .where(eq(eventBookings.purchaseId, input.purchase.id))
    .orderBy(asc(eventBookings.createdAt));
  if (lines.length === 0) return null;

  if (input.purchase.stripePaymentIntentId && !input.stripe) {
    throw new ParkingPassBookingError(
      503,
      "stripe_not_configured",
      "Payments are unavailable right now.",
    );
  }
  if (input.purchase.stripePaymentIntentId && input.stripe) {
    const providerOperation = await db.transaction(async (tx: any) => {
      const [currentPurchase] = await tx
        .select()
        .from(parkingPassPurchases)
        .where(eq(parkingPassPurchases.id, input.purchase.id))
        .limit(1)
        .for("update");
      if (
        !currentPurchase ||
        currentPurchase.stripePaymentIntentId !==
          input.purchase.stripePaymentIntentId ||
        !["pending", "confirmed"].includes(currentPurchase.status)
      ) {
        throw new ParkingPassBookingError(
          409,
          "purchase_changed",
          "This Parking Pass checkout changed while it was being resumed.",
        );
      }
      await assertCurrentTruckTeamAuthorityLocked(
        tx,
        currentPurchase.truckId,
        currentPurchase.purchaserUserId,
      );
      const [operation] = await tx
        .select()
        .from(parkingPassProviderOperations)
        .where(
          and(
            eq(parkingPassProviderOperations.purchaseId, currentPurchase.id),
            eq(
              parkingPassProviderOperations.operationKind,
              "payment_intent_create",
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) {
        throw new ParkingPassBookingError(
          409,
          "provider_operation_missing",
          "This checkout has no durable provider identity and requires reconciliation.",
        );
      }
      return operation;
    });
    let intent = await input.stripe.paymentIntents.retrieve(
      input.purchase.stripePaymentIntentId,
    );
    if (intent.id !== input.purchase.stripePaymentIntentId) {
      throw new ParkingPassBookingError(
        409,
        "provider_purchase_mismatch",
        "Stripe checkout facts no longer match this Parking Pass purchase.",
      );
    }
    assertIntentMatchesProviderOperation(intent, providerOperation);

    const clientResumableStatuses = new Set<Stripe.PaymentIntent.Status>([
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
    ]);
    if (clientResumableStatuses.has(intent.status)) {
      intent = await db.transaction(async (tx: any) => {
        const [currentPurchase] = await tx
          .select()
          .from(parkingPassPurchases)
          .where(eq(parkingPassPurchases.id, input.purchase.id))
          .limit(1)
          .for("update");
        if (
          !currentPurchase ||
          currentPurchase.status !== "pending" ||
          currentPurchase.stripePaymentIntentId !== intent.id
        ) {
          throw new ParkingPassBookingError(
            409,
            "purchase_changed",
            "This Parking Pass checkout changed while it was being resumed.",
          );
        }
        await assertCurrentTruckTeamAuthorityLocked(
          tx,
          currentPurchase.truckId,
          currentPurchase.purchaserUserId,
        );
        await assertCurrentConnectReady({
          hostId: currentPurchase.hostId,
          expectedDestinationAccountId:
            currentPurchase.stripeDestinationAccountId,
          stripe: input.stripe,
          database: tx,
          lock: true,
        });
        const currentIntent = await input.stripe!.paymentIntents.retrieve(
          currentPurchase.stripePaymentIntentId,
        );
        assertIntentMatchesProviderOperation(currentIntent, providerOperation);
        return currentIntent;
      });
    }

    if (clientResumableStatuses.has(intent.status)) {
      return {
        purchaseId: input.purchase.id,
        bookingIds: lines.map((line: (typeof lines)[number]) => line.id),
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        totalCents: input.purchase.chargedAmountCents,
        breakdown: {
          hostPrice: input.purchase.hostAmountCents,
          platformFee: input.purchase.platformFeeCents,
          creditsApplied: input.purchase.creditAppliedCents,
        },
        hostPaymentsReady: true,
      };
    }

    if (intent.status === "succeeded") {
      await confirmParkingPassPurchaseFromIntent(intent, input.stripe);
      return {
        purchaseId: input.purchase.id,
        bookingIds: lines.map((line: (typeof lines)[number]) => line.id),
        paymentIntentId: intent.id,
        clientSecret: null,
        totalCents: input.purchase.chargedAmountCents,
        breakdown: {
          hostPrice: input.purchase.hostAmountCents,
          platformFee: input.purchase.platformFeeCents,
          creditsApplied: input.purchase.creditAppliedCents,
        },
        hostPaymentsReady: true,
      };
    }

    if (intent.status === "canceled") {
      const operation = await cancelParkingPassLines({
        purchaseId: input.purchase.id,
        requestId: `provider-canceled:${input.purchase.id}`,
        reason: "Stripe reports the checkout canceled",
        actor: { userId: "", userType: "system", system: true },
        stripe: input.stripe,
      });
      throw new ParkingPassBookingError(
        409,
        "provider_checkout_canceled",
        "Stripe canceled this checkout. Reserved capacity is released only after the durable cancellation operation converges.",
        {
          operation: serializeParkingPassCancellationOperation(operation),
        },
      );
    }

    if (intent.status === "processing") {
      const now = new Date();
      await db.transaction(async (tx: any) => {
        const [lockedPurchase] = await tx
          .select()
          .from(parkingPassPurchases)
          .where(eq(parkingPassPurchases.id, input.purchase.id))
          .limit(1)
          .for("update");
        if (
          !lockedPurchase ||
          lockedPurchase.stripePaymentIntentId !== intent.id
        ) {
          throw new ParkingPassBookingError(
            409,
            "purchase_changed",
            "This Parking Pass checkout changed during provider reconciliation.",
          );
        }
        await tx
          .update(parkingPassProviderOperations)
          .set({
            status: "processing",
            providerStatus: intent.status,
            providerPaymentIntentId: intent.id,
            updatedAt: now,
          })
          .where(eq(parkingPassProviderOperations.id, providerOperation.id));
        await tx
          .update(parkingPassPurchases)
          .set({ providerLifecycleState: "intent_processing", updatedAt: now })
          .where(eq(parkingPassPurchases.id, lockedPurchase.id));
      });
      throw new ParkingPassBookingError(
        409,
        "provider_checkout_processing",
        "Stripe is still processing this checkout. No new payment form or checkout was created.",
      );
    }

    await markProviderOperationActionRequired({
      purchaseId: input.purchase.id,
      operationId: providerOperation.id,
      code: `unexpected_payment_intent_${intent.status}`,
      message: `Stripe returned non-resumable PaymentIntent status ${intent.status}.`,
    });
    throw new ParkingPassBookingError(
      409,
      "provider_checkout_action_required",
      "This provider checkout is not client-resumable and requires reconciliation. No secret was returned.",
    );
  }
  return {
    purchaseId: input.purchase.id,
    bookingIds: lines.map((line: (typeof lines)[number]) => line.id),
    paymentIntentId: input.purchase.stripePaymentIntentId,
    clientSecret: null,
    totalCents: input.purchase.chargedAmountCents,
    breakdown: {
      hostPrice: input.purchase.hostAmountCents,
      platformFee: input.purchase.platformFeeCents,
      creditsApplied: input.purchase.creditAppliedCents,
    },
    hostPaymentsReady: true,
  };
}

async function assertPurchaseRequestReplayMatches(
  purchase: typeof parkingPassPurchases.$inferSelect,
  requestedLines: PreparedParkingPassLine[],
  requestDigest: string,
  database: any = db,
) {
  const storedLines = await database
    .select({
      eventId: eventBookings.eventId,
      hostPriceCents: eventBookings.hostPriceCents,
      platformFeeCents: eventBookings.platformFeeCents,
      slotType: eventBookings.slotType,
    })
    .from(eventBookings)
    .where(eq(eventBookings.purchaseId, purchase.id))
    .orderBy(asc(eventBookings.eventId));
  const requested = [...requestedLines].sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  );
  const identityMatches =
    storedLines.length === requested.length &&
    storedLines.every(
      (line: (typeof storedLines)[number], index: number) =>
        line.eventId === requested[index]?.eventId &&
        Number(line.hostPriceCents) ===
          Number(requested[index]?.hostPriceCents) &&
        clean(line.slotType) === clean(requested[index]?.slotType),
    );
  const requestedPlatformFee = requested.reduce(
    (total, line) => total + Number(line.platformFeeCents || 0),
    0,
  );
  if (
    purchase.requestDigest !== requestDigest ||
    !identityMatches ||
    requestedPlatformFee !==
      Number(purchase.platformFeeCents) + Number(purchase.creditAppliedCents)
  ) {
    throw new ParkingPassBookingError(
      409,
      "idempotency_mismatch",
      "That idempotency key belongs to different Parking Pass dates or pricing.",
    );
  }
}

async function assertCurrentPurchaseAuthorityAndConnect(input: {
  purchaseId: string;
  purchaserUserId: string;
  stripe: Stripe | null;
}) {
  return db.transaction(async (tx: any) => {
    const [purchase] = await tx
      .select()
      .from(parkingPassPurchases)
      .where(eq(parkingPassPurchases.id, input.purchaseId))
      .limit(1)
      .for("update");
    if (!purchase || purchase.purchaserUserId !== input.purchaserUserId) {
      throw new ParkingPassBookingError(
        403,
        "parking_pass_purchase_forbidden",
        "This checkout no longer belongs to the current truck team actor.",
      );
    }
    await assertCurrentTruckTeamAuthorityLocked(
      tx,
      purchase.truckId,
      input.purchaserUserId,
    );
    await assertCurrentConnectReady({
      hostId: purchase.hostId,
      expectedDestinationAccountId: purchase.stripeDestinationAccountId,
      stripe: input.stripe,
      database: tx,
      lock: true,
    });
    return purchase;
  });
}

function assertIntentMatchesProviderOperation(
  intent: Stripe.PaymentIntent,
  operation: typeof parkingPassProviderOperations.$inferSelect,
) {
  if (
    intent.amount !== operation.expectedAmountCents ||
    clean(intent.currency) !== operation.expectedCurrency ||
    destinationFromIntent(intent) !==
      operation.expectedDestinationAccountId ||
    Number(intent.application_fee_amount || 0) !==
      operation.expectedApplicationFeeCents ||
    clean(intent.metadata?.providerOperationId) !== operation.id ||
    clean(intent.metadata?.requestDigest) !== operation.requestDigest ||
    clean(intent.metadata?.allocationDigest) !== operation.allocationDigest
  ) {
    throw new ParkingPassBookingError(
      409,
      "provider_purchase_mismatch",
      "Stripe checkout facts do not match the durable Parking Pass operation.",
    );
  }
}

async function markProviderOperationActionRequired(input: {
  purchaseId: string;
  operationId: string;
  code: string;
  message: string;
}) {
  const now = new Date();
  await db.transaction(async (tx: any) => {
    await tx
      .update(parkingPassProviderOperations)
      .set({
        status: "action_required",
        providerErrorCode: input.code,
        providerErrorMessage: input.message,
        updatedAt: now,
      })
      .where(eq(parkingPassProviderOperations.id, input.operationId));
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        status: "action_required",
        providerErrorCode: input.code,
        providerErrorMessage: input.message,
        updatedAt: now,
      })
      .where(
        and(
          eq(parkingPassProviderOperationSteps.operationId, input.operationId),
          eq(
            parkingPassProviderOperationSteps.stepType,
            "payment_intent_create",
          ),
        ),
      );
    await tx
      .update(parkingPassPurchases)
      .set({
        providerLifecycleState: "action_required",
        providerErrorCode: input.code,
        providerErrorMessage: input.message,
        updatedAt: now,
      })
      .where(eq(parkingPassPurchases.id, input.purchaseId));
  });
}

/**
 * Canonical owner of new paid event participation, including Parking Pass.
 * Route adapters may decide which dated/slot lines were requested, but only
 * this service may reserve allocated rows or create a destination-charge PI.
 */
export async function createParkingPassPurchase(
  input: CreateParkingPassPurchaseInput,
): Promise<PurchaseResult> {
  const purchaserUserId = clean(input.purchaserUserId);
  const truckId = clean(input.truckId);
  const hostId = clean(input.hostId);
  const idempotencyKey = clean(input.idempotencyKey);
  const stripe = input.stripe === undefined ? configuredStripe : input.stripe;
  const bypassProvider = input.bypassProvider === true;

  // This must remain before validation, replay lookup, authority reads,
  // persistence, or provider I/O. Production never turns a test bypass into
  // locally confirmed financial state, even for staff or an idempotent retry.
  if (bypassProvider && isNormalizedProduction(process.env.NODE_ENV)) {
    throw new ParkingPassBookingError(
      403,
      "provider_bypass_forbidden",
      "Payment bypass is disabled in production.",
    );
  }

  if (!purchaserUserId || !truckId || !hostId || idempotencyKey.length < 8) {
    throw new ParkingPassBookingError(
      400,
      "invalid_purchase_request",
      "Purchaser, truck, host, and a stable idempotency key are required.",
    );
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ParkingPassBookingError(
      400,
      "missing_booking_lines",
      "Select at least one paid event line.",
    );
  }
  const normalizedLines = input.lines
    .map((line) => ({
      eventId: clean(line.eventId),
      hostPriceCents: cents(line.hostPriceCents),
      platformFeeCents: cents(line.platformFeeCents),
      slotType: clean(line.slotType),
    }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  if (
    normalizedLines.some(
      (line) =>
        !line.eventId ||
        !Number.isInteger(line.hostPriceCents) ||
        line.hostPriceCents < 0 ||
        !Number.isInteger(line.platformFeeCents) ||
        line.platformFeeCents < 0 ||
        !line.slotType,
    ) ||
    new Set(normalizedLines.map((line) => line.eventId)).size !==
      normalizedLines.length
  ) {
    throw new ParkingPassBookingError(
      400,
      "invalid_booking_lines",
      "Paid event allocations must be unique and non-negative.",
    );
  }
  const requestDigest = stableDigest({
    version: "parking-pass-purchase-v1",
    purchaserUserId,
    truckId,
    hostId,
    requestedCreditCents: Math.max(
      0,
      cents(input.requestedCreditCents) || 0,
    ),
    lines: normalizedLines,
  });

  const [prior] = await db
    .select()
    .from(parkingPassPurchases)
    .where(
      and(
        eq(parkingPassPurchases.purchaserUserId, purchaserUserId),
        eq(parkingPassPurchases.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (prior) {
    if (prior.truckId !== truckId || prior.hostId !== hostId) {
      throw new ParkingPassBookingError(
        409,
        "idempotency_mismatch",
        "That idempotency key belongs to a different Parking Pass purchase.",
      );
    }
    await assertPurchaseRequestReplayMatches(
      prior,
      normalizedLines,
      requestDigest,
    );
    const result = await existingPurchaseResult({ purchase: prior, stripe });
    if (result && prior.stripePaymentIntentId) return result;
  }

  let currentDestinationAccountId: string | null = null;
  if (!bypassProvider) {
    const [paymentAuthority] = await db
      .select({
        stripeConnectAccountId: hosts.stripeConnectAccountId,
        stripeOnboardingCompleted: hosts.stripeOnboardingCompleted,
        stripeChargesEnabled: hosts.stripeChargesEnabled,
        stripePayoutsEnabled: hosts.stripePayoutsEnabled,
      })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);
    currentDestinationAccountId = clean(
      paymentAuthority?.stripeConnectAccountId,
    );
    if (
      !paymentAuthority ||
      !currentDestinationAccountId ||
      paymentAuthority.stripeOnboardingCompleted !== true ||
      paymentAuthority.stripeChargesEnabled !== true ||
      paymentAuthority.stripePayoutsEnabled !== true
    ) {
      throw new ParkingPassBookingError(
        409,
        "host_connect_not_ready",
        "This host must finish Stripe onboarding with charges and payouts enabled before paid booking.",
      );
    }
    if (!stripe) {
      throw new ParkingPassBookingError(
        503,
        "stripe_not_configured",
        "Payments are unavailable right now.",
      );
    }
    let providerAccount: Stripe.Account;
    try {
      providerAccount = await stripe.accounts.retrieve(
        currentDestinationAccountId,
      );
    } catch (error) {
      console.warn("[parking-pass] host Connect status verification failed", {
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ParkingPassBookingError(
        503,
        "host_connect_status_unavailable",
        "The host payment account could not be verified. Try again shortly.",
      );
    }
    if (
      providerAccount.details_submitted !== true ||
      providerAccount.charges_enabled !== true ||
      providerAccount.payouts_enabled !== true
    ) {
      throw new ParkingPassBookingError(
        409,
        "host_connect_not_ready",
        "Stripe does not currently report onboarding, charges, and payouts ready for this host.",
      );
    }
  }

  const created = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_purchase:${purchaserUserId}:${idempotencyKey}`}))`,
    );

    const [existing] = await tx
      .select()
      .from(parkingPassPurchases)
      .where(
        and(
          eq(parkingPassPurchases.purchaserUserId, purchaserUserId),
          eq(parkingPassPurchases.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
      .for("update");
    if (existing) {
      await assertCurrentTruckTeamAuthorityLocked(
        tx,
        existing.truckId,
        purchaserUserId,
      );
      await assertPurchaseRequestReplayMatches(
        existing,
        normalizedLines,
        requestDigest,
        tx,
      );
      const lineRows = await tx
        .select({ id: eventBookings.id })
        .from(eventBookings)
        .where(eq(eventBookings.purchaseId, existing.id))
        .orderBy(asc(eventBookings.createdAt));
      const [providerOperation] = await tx
        .select()
        .from(parkingPassProviderOperations)
        .where(
          and(
            eq(parkingPassProviderOperations.purchaseId, existing.id),
            eq(
              parkingPassProviderOperations.operationKind,
              "payment_intent_create",
            ),
          ),
        )
        .limit(1)
        .for("update");
      return {
        purchase: existing,
        bookingIds: lineRows.map((line: (typeof lineRows)[number]) => line.id),
        providerOperation: providerOperation || null,
        createdNow: false,
      };
    }

    await assertCurrentTruckTeamAuthorityLocked(
      tx,
      truckId,
      purchaserUserId,
    );

    const [host] = await tx
      .select({
        id: hosts.id,
        userId: hosts.userId,
        address: hosts.address,
        city: hosts.city,
        state: hosts.state,
        latitude: hosts.latitude,
        longitude: hosts.longitude,
        notes: hosts.notes,
        amenities: hosts.amenities,
        stripeConnectAccountId: hosts.stripeConnectAccountId,
        stripeOnboardingCompleted: hosts.stripeOnboardingCompleted,
        stripeChargesEnabled: hosts.stripeChargesEnabled,
        stripePayoutsEnabled: hosts.stripePayoutsEnabled,
        ownerDisabled: users.isDisabled,
        publicProfileSettings: users.publicProfileSettings,
      })
      .from(hosts)
      .innerJoin(users, eq(users.id, hosts.userId))
      .where(eq(hosts.id, hostId))
      .limit(1)
      .for("update");
    const destinationAccountId = clean(host?.stripeConnectAccountId);
    if (
      !host ||
      host.ownerDisabled !== false ||
      !destinationAccountId ||
      (!bypassProvider && destinationAccountId !== currentDestinationAccountId) ||
      host.stripeOnboardingCompleted !== true ||
      host.stripeChargesEnabled !== true ||
      host.stripePayoutsEnabled !== true
    ) {
      throw new ParkingPassBookingError(
        409,
        "host_connect_not_ready",
        "This host must finish Stripe onboarding with charges and payouts enabled before paid booking.",
      );
    }
    if (!bypassProvider) {
      await assertCurrentConnectReady({
        hostId,
        expectedDestinationAccountId: destinationAccountId,
        stripe,
        database: tx,
        lock: true,
      });
    }

    const selectedEventIds = normalizedLines.map((line) => line.eventId);
    const eventRows: Array<typeof events.$inferSelect> = await tx
      .select()
      .from(events)
      .where(inArray(events.id, selectedEventIds))
      .orderBy(asc(events.id))
      .for("update");
    if (eventRows.length !== selectedEventIds.length) {
      throw new ParkingPassBookingError(
        409,
        "booking_line_not_eligible",
        "One of the selected paid event lines is no longer eligible.",
      );
    }
    const selectedSeriesIds = Array.from(
      new Set(eventRows.map((event) => clean(event.seriesId)).filter(Boolean)),
    ).sort();
    const selectedSeriesDateFacts = await lockParkingPassSeriesDates(
      tx,
      eventRows,
    );
    const seriesRows: Array<typeof eventSeries.$inferSelect> = selectedSeriesIds.length
      ? await tx
          .select()
          .from(eventSeries)
          .where(inArray(eventSeries.id, selectedSeriesIds))
          .orderBy(asc(eventSeries.id))
          .for("update")
      : [];
    const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
    await assertNoParkingPassBlackoutLocked({
      tx,
      facts: selectedSeriesDateFacts,
      seriesById,
    });
    const venueTimeZone = eventRows.some((event) => !clean(event.seriesId))
      ? await resolveCityTimeZoneStrict(
          { city: host.city, state: host.state },
          tx,
        )
      : null;
    const eventTimeZoneById = new Map<string, string>();
    for (const event of eventRows) {
      const series = event.seriesId ? seriesById.get(event.seriesId) : null;
      const eventTimeZone = resolvePersistedEventServiceTimeZone({
        seriesId: event.seriesId,
        seriesTimeZone: series?.timezone,
        venueTimeZone,
      });
      if (!eventTimeZone) {
        throw new ParkingPassBookingError(
          409,
          "venue_timezone_unavailable",
          "One of the selected paid event lines does not have a valid persisted service timezone.",
          { eventId: event.id, seriesId: event.seriesId },
        );
      }
      eventTimeZoneById.set(event.id, eventTimeZone);
      if (
        event.hostId !== hostId ||
        event.requiresPayment !== true ||
        event.status !== "open" ||
        event.activeParticipationMutationId !== null ||
        event.participationSuppressedAt !== null ||
        (event.seriesId !== null &&
          (!series ||
            !eventSeriesTopologyIsServiceable(event, series) ||
            series.activeParticipationMutationId !== null ||
            series.participationSuppressedAt !== null))
      ) {
        throw new ParkingPassBookingError(
          409,
          event.activeParticipationMutationId ||
            (event.seriesId &&
              seriesById.get(event.seriesId)?.activeParticipationMutationId)
            ? "event_participation_mutation_active"
            : "booking_line_not_eligible",
          "One of the selected paid event lines is changing and cannot accept checkout right now.",
          { eventId: event.id },
        );
      }
    }
    const eventById = new Map(eventRows.map((event) => [event.id, event]));

    for (const line of normalizedLines) {
      const event = eventById.get(line.eventId)!;
      const [existingBooking] = await tx
        .select({ id: eventBookings.id, status: eventBookings.status })
        .from(eventBookings)
        .where(
          and(
            eq(eventBookings.eventId, line.eventId),
            eq(eventBookings.truckId, truckId),
          ),
        )
        .limit(1);
      const duplicateDecision = evaluatePaidLineReservation({
        duplicateBookingId: existingBooking?.id,
        hardCapEnabled: Boolean(event.hardCapEnabled),
        reservedCount: 0,
        maxTrucks: Number(event.maxTrucks || 1),
      });
      if (!duplicateDecision.allowed) {
        throw new ParkingPassBookingError(
          409,
          duplicateDecision.code,
          "This truck already has a booking record for one of the selected events.",
          { eventId: line.eventId, bookingId: duplicateDecision.bookingId },
        );
      }
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(eventBookings)
        .where(
          and(
            eq(eventBookings.eventId, line.eventId),
            inArray(eventBookings.status, ["pending", "confirmed"]),
          ),
        );
      const reservedCount = Number(countRow?.count || 0);
      const maxTrucks = Math.max(1, Number(event.maxTrucks || 1));
      const capacityDecision = evaluatePaidLineReservation({
        hardCapEnabled: Boolean(event.hardCapEnabled),
        reservedCount,
        maxTrucks,
      });
      if (!capacityDecision.allowed) {
        throw new ParkingPassBookingError(
          409,
          capacityDecision.code,
          "This paid event line is fully booked.",
          { eventId: line.eventId },
        );
      }
    }

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_credit:${purchaserUserId}`}))`,
    );
    const rawPlatformFee = normalizedLines.reduce(
      (total, line) => total + line.platformFeeCents,
      0,
    );
    const requestedCredit = Math.max(0, cents(input.requestedCreditCents) || 0);
    const availableCredit = await restrictedCreditBalanceCents(
      purchaserUserId,
      tx,
    );
    const creditAppliedCents = Math.min(
      requestedCredit,
      availableCredit,
      rawPlatformFee,
    );
    const allocatedLines = allocateRestrictedPlatformCredit(
      normalizedLines,
      creditAppliedCents,
    );
    const hostAmountCents = allocatedLines.reduce(
      (total, line) => total + line.hostPriceCents,
      0,
    );
    const platformFeeCents = allocatedLines.reduce(
      (total, line) => total + line.platformFeeCents,
      0,
    );
    const chargedAmountCents = hostAmountCents + platformFeeCents;
    const allocationDigest = stableDigest({
      version: "parking-pass-allocation-v1",
      purchaserUserId,
      truckId,
      hostId,
      currency: "usd",
      lines: allocatedLines.map((line) => ({
        eventId: line.eventId,
        hostPriceCents: line.hostPriceCents,
        platformFeeCents: line.platformFeeCents,
        creditAppliedCents: line.creditAppliedCents,
        slotType: line.slotType,
      })),
    });
    if ((hostAmountCents <= 0 && !bypassProvider) || chargedAmountCents <= 0) {
      throw new ParkingPassBookingError(
        409,
        "parking_pass_price_not_ready",
        "This paid event does not have a current host price.",
      );
    }

    const [purchase] = await tx
      .insert(parkingPassPurchases)
      .values({
        purchaserUserId,
        truckId,
        hostId,
        currency: "usd",
        hostAmountCents,
        platformFeeCents,
        chargedAmountCents,
        refundedAmountCents: 0,
        cancellationCreditIssuedCents: 0,
        creditAppliedCents,
        settlementTopology: "destination_charge",
        settlementStatus: "pending",
        status: "pending",
        stripeDestinationAccountId: destinationAccountId,
        idempotencyKey,
        requestDigest,
        allocationDigest,
        allocationLineCount: allocatedLines.length,
        providerLifecycleState: bypassProvider
          ? "closed"
          : "create_prepared",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!purchase) {
      throw new Error("Parking Pass purchase aggregate was not created.");
    }

    if (creditAppliedCents > 0) {
      await tx.insert(parkingPassCreditLedger).values({
        userId: purchaserUserId,
        purchaseId: purchase.id,
        amountCents: -creditAppliedCents,
        entryType: "booking_fee_consumption",
        state: "reserved",
        idempotencyKey: `purchase:${purchase.id}:credit-reservation`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const publicLocationConsent = resolvePublicProfileVisibility(
      host.publicProfileSettings,
    ).showAddress;
    const bookingIds: string[] = [];
    for (const [allocationIndex, line] of allocatedLines.entries()) {
      const event = eventById.get(line.eventId)!;
      const timeZone = eventTimeZoneById.get(event.id)!;
      const interval = buildSlotDateTimes({
        timeZone,
        date: event.date,
        startTime: clean(event.startTime),
        endTime: clean(event.endTime),
      });
      if (!interval || interval.startUtc.getTime() <= Date.now()) {
        throw new ParkingPassBookingError(
          409,
          "parking_pass_started",
          "One of the selected paid event lines has already started.",
          { eventId: event.id },
        );
      }
      const [booking] = await tx
        .insert(eventBookings)
        .values({
          eventId: event.id,
          truckId,
          hostId,
          purchaseId: purchase.id,
          allocationOrdinal: allocationIndex + 1,
          allocationDigest,
          hostPriceCents: line.hostPriceCents,
          platformFeeCents: line.platformFeeCents,
          creditAppliedCents: line.creditAppliedCents,
          totalCents: line.hostPriceCents + line.platformFeeCents,
          status: "pending",
          stripePaymentStatus: "pending",
          stripeApplicationFeeAmount: line.platformFeeCents,
          stripeTransferDestination: destinationAccountId,
          slotType: line.slotType,
          settlementTopology: "destination_charge",
          publicLocationConsentSnapshot: publicLocationConsent,
          arrivalState: "acknowledged",
          eventParticipationVersion: event.participationVersion,
          participationVisibilityState: "eligible",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!booking) throw new Error("Parking Pass allocation was not created.");

      const amenities =
        host.amenities && typeof host.amenities === "object"
          ? (host.amenities as Record<string, unknown>)
          : {};
      const [arrival] = await tx
        .insert(parkingPassArrivalVersions)
        .values({
          bookingId: booking.id,
          version: 1,
          state: "current",
          address: host.address,
          city: host.city,
          stateCode: host.state,
          latitude: host.latitude,
          longitude: host.longitude,
          startAt: interval.startUtc,
          endAt: interval.endUtc,
          accessInstructions: host.notes,
          safetyInstructions: clean(amenities.safetyInstructions) || null,
          actorType: "booking_snapshot",
          actorUserId: purchaserUserId,
          reason: "Arrival facts captured at checkout",
          effectiveAt: new Date(),
          isMaterial: false,
          notificationState: "not_required",
          acknowledgedByUserId: purchaserUserId,
          acknowledgedAt: new Date(),
          createdAt: new Date(),
        })
        .returning();
      await tx
        .update(eventBookings)
        .set({
          currentArrivalVersionId: arrival.id,
          updatedAt: new Date(),
        })
        .where(eq(eventBookings.id, booking.id));
      bookingIds.push(booking.id);
    }

    let providerOperation: typeof parkingPassProviderOperations.$inferSelect | null =
      null;
    if (!bypassProvider) {
      [providerOperation] = await tx
        .insert(parkingPassProviderOperations)
        .values({
          purchaseId: purchase.id,
          operationKind: "payment_intent_create",
          requestId: idempotencyKey,
          idempotencyKey: `parking-pass:purchase:${purchase.id}`,
          requestDigest,
          status: "prepared",
          actorType: "truck_team",
          actorUserId: purchaserUserId,
          sortedLineIds: stableLineIds(bookingIds),
          allocationDigest,
          expectedCurrency: "usd",
          expectedAmountCents: chargedAmountCents,
          expectedHostAmountCents: hostAmountCents,
          expectedApplicationFeeCents: platformFeeCents,
          expectedDestinationAccountId: destinationAccountId,
          idempotencyExpiresAt: providerIdempotencyDeadline(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!providerOperation) {
        throw new Error("Parking Pass provider operation was not created.");
      }
      await tx.insert(parkingPassProviderOperationSteps).values([
        {
          operationId: providerOperation.id,
          stepType: "payment_intent_create",
          stepOrder: 1,
          status: "prepared",
          idempotencyKey: `parking-pass:purchase:${purchase.id}`,
          requestDigest,
          allocationDigest,
          expectedCurrency: "usd",
          expectedAmountCents: chargedAmountCents,
          expectedDestinationAccountId: destinationAccountId,
          expectedApplicationFeeCents: platformFeeCents,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          operationId: providerOperation.id,
          stepType: "payment_intent_bind",
          stepOrder: 2,
          status: "prepared",
          idempotencyKey: `parking-pass:purchase:${purchase.id}:bind`,
          requestDigest,
          allocationDigest,
          expectedCurrency: "usd",
          expectedAmountCents: chargedAmountCents,
          expectedDestinationAccountId: destinationAccountId,
          expectedApplicationFeeCents: platformFeeCents,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }

    return { purchase, bookingIds, providerOperation, createdNow: true };
  });

  if (!created.createdNow && created.purchase.stripePaymentIntentId) {
    const result = await existingPurchaseResult({
      purchase: created.purchase,
      stripe,
    });
    if (result) return result;
  }

  if (bypassProvider) {
    const now = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(eventBookings)
        .set({
          status: "confirmed",
          stripePaymentStatus: "bypassed",
          paidAt: now,
          bookingConfirmedAt: now,
          updatedAt: now,
        })
        .where(eq(eventBookings.purchaseId, created.purchase.id));
      await tx
        .update(parkingPassPurchases)
        .set({ status: "confirmed", paidAt: now, updatedAt: now })
        .where(eq(parkingPassPurchases.id, created.purchase.id));
      await tx
        .update(parkingPassCreditLedger)
        .set({ state: "posted", updatedAt: now })
        .where(
          and(
            eq(parkingPassCreditLedger.purchaseId, created.purchase.id),
            eq(parkingPassCreditLedger.state, "reserved"),
          ),
        );
    });
    return {
      purchaseId: created.purchase.id,
      bookingIds: created.bookingIds,
      paymentIntentId: null,
      clientSecret: null,
      totalCents: created.purchase.chargedAmountCents,
      breakdown: {
        hostPrice: created.purchase.hostAmountCents,
        platformFee: created.purchase.platformFeeCents,
        creditsApplied: created.purchase.creditAppliedCents,
      },
      hostPaymentsReady: true,
      bypassed: true,
    };
  }

  if (!stripe) {
    throw new ParkingPassBookingError(
      503,
      "stripe_not_configured",
      "Payments are unavailable right now.",
    );
  }
  await assertCurrentPurchaseAuthorityAndConnect({
    purchaseId: created.purchase.id,
    purchaserUserId,
    stripe,
  });

  const [currentOperation] = await db
    .select()
    .from(parkingPassProviderOperations)
    .where(
      and(
        eq(parkingPassProviderOperations.purchaseId, created.purchase.id),
        eq(
          parkingPassProviderOperations.operationKind,
          "payment_intent_create",
        ),
      ),
    )
    .limit(1);
  const providerOperation = currentOperation || created.providerOperation;
  if (!providerOperation) {
    throw new ParkingPassBookingError(
      409,
      "provider_operation_missing",
      "This checkout predates recoverable provider operations and requires reconciliation.",
    );
  }

  let intent: Stripe.PaymentIntent | null = null;
  try {
    if (providerOperation.providerPaymentIntentId) {
      intent = await stripe.paymentIntents.retrieve(
        providerOperation.providerPaymentIntentId,
      );
    } else if (
      ["submitted", "processing", "action_required"].includes(
        providerOperation.status,
      ) &&
      typeof stripe.paymentIntents.search === "function"
    ) {
      try {
        const matches = await stripe.paymentIntents.search({
          query: `metadata['providerOperationId']:'${providerOperation.id}'`,
          limit: 10,
        });
        const exact = matches.data.filter(
          (candidate) =>
            clean(candidate.metadata?.providerOperationId) ===
            providerOperation.id,
        );
        const recovery = decideProviderCreateRecovery({
          hasBoundPaymentIntentId: false,
          exactSearchResultCount: exact.length,
          withinIdempotencyRetention:
            providerOperation.idempotencyExpiresAt.getTime() > Date.now(),
        });
        if (recovery.action === "action_required") {
          throw new ParkingPassBookingError(
            409,
            recovery.code,
            "More than one provider checkout matches this durable operation; staff reconciliation is required.",
          );
        }
        intent = recovery.action === "use_recovered" ? exact[0]! : null;
      } catch (error) {
        if (error instanceof ParkingPassBookingError) throw error;
        // Retrying the same provider idempotency key remains safe only inside
        // the recorded provider retention window. Outside it, ambiguity is a
        // staff action state and never a blind second charge.
        const recovery = decideProviderCreateRecovery({
          hasBoundPaymentIntentId: false,
          searchFailed: true,
          withinIdempotencyRetention:
            providerOperation.idempotencyExpiresAt.getTime() > Date.now(),
        });
        if (recovery.action === "action_required") {
          throw new ParkingPassBookingError(
            409,
            recovery.code,
            "The provider result could not be recovered after idempotency retention; staff reconciliation is required.",
          );
        }
      }
    }

    if (!intent) {
      const recovery = decideProviderCreateRecovery({
        hasBoundPaymentIntentId: false,
        exactSearchResultCount: 0,
        withinIdempotencyRetention:
          providerOperation.idempotencyExpiresAt.getTime() > Date.now(),
      });
      if (recovery.action === "action_required") {
        throw new ParkingPassBookingError(
          409,
          recovery.code,
          "This checkout cannot be recreated after provider idempotency retention without reconciliation.",
        );
      }
      const submittedAt = new Date();
      await db.transaction(async (tx: any) => {
        await tx
          .update(parkingPassProviderOperations)
          .set({
            status: "submitted",
            attemptCount: sql`${parkingPassProviderOperations.attemptCount} + 1`,
            lastAttemptAt: submittedAt,
            providerErrorCode: null,
            providerErrorMessage: null,
            updatedAt: submittedAt,
          })
          .where(eq(parkingPassProviderOperations.id, providerOperation.id));
        await tx
          .update(parkingPassProviderOperationSteps)
          .set({
            status: "submitted",
            attemptCount: sql`${parkingPassProviderOperationSteps.attemptCount} + 1`,
            submittedAt,
            providerErrorCode: null,
            providerErrorMessage: null,
            updatedAt: submittedAt,
          })
          .where(
            and(
              eq(
                parkingPassProviderOperationSteps.operationId,
                providerOperation.id,
              ),
              eq(
                parkingPassProviderOperationSteps.stepType,
                "payment_intent_create",
              ),
            ),
          );
        await tx
          .update(parkingPassPurchases)
          .set({
            providerLifecycleState: "create_submitted",
            updatedAt: submittedAt,
          })
          .where(eq(parkingPassPurchases.id, created.purchase.id));
      });
      const params: Stripe.PaymentIntentCreateParams = {
        amount: providerOperation.expectedAmountCents,
        currency: providerOperation.expectedCurrency,
        transfer_data: {
          destination: providerOperation.expectedDestinationAccountId,
        },
        metadata: {
          purchaseId: created.purchase.id,
          providerOperationId: providerOperation.id,
          requestDigest: providerOperation.requestDigest,
          allocationDigest: providerOperation.allocationDigest,
          hostId,
          truckId,
          userId: purchaserUserId,
          settlementTopology: "destination_charge",
          ...input.metadata,
        },
      };
      if (providerOperation.expectedApplicationFeeCents > 0) {
        params.application_fee_amount =
          providerOperation.expectedApplicationFeeCents;
      }
      intent = await stripe.paymentIntents.create(params, {
        idempotencyKey: providerOperation.idempotencyKey,
      });
    }
    assertIntentMatchesProviderOperation(intent, providerOperation);
  } catch (error: any) {
    const code =
      error instanceof ParkingPassBookingError
        ? error.code
        : clean(error?.code) || "provider_create_ambiguous";
    const message =
      clean(error?.message) ||
      "The provider result is uncertain and requires recovery.";
    await markProviderOperationActionRequired({
      purchaseId: created.purchase.id,
      operationId: providerOperation.id,
      code,
      message,
    });
    throw new ParkingPassBookingError(
      error instanceof ParkingPassBookingError ? error.statusCode : 503,
      code,
      "Payment setup is pending provider recovery; no second checkout was created.",
    );
  }

  const providerCreatedAt = new Date();
  await db.transaction(async (tx: any) => {
    await tx
      .update(parkingPassProviderOperations)
      .set({
        status: "processing",
        providerPaymentIntentId: intent!.id,
        providerStatus: intent!.status,
        providerErrorCode: null,
        providerErrorMessage: null,
        updatedAt: providerCreatedAt,
      })
      .where(eq(parkingPassProviderOperations.id, providerOperation.id));
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        status: "provider_confirmed",
        providerObjectId: intent!.id,
        providerPaymentIntentId: intent!.id,
        confirmedAt: providerCreatedAt,
        updatedAt: providerCreatedAt,
      })
      .where(
        and(
          eq(
            parkingPassProviderOperationSteps.operationId,
            providerOperation.id,
          ),
          eq(
            parkingPassProviderOperationSteps.stepType,
            "payment_intent_create",
          ),
        ),
      );
    await tx
      .update(parkingPassPurchases)
      .set({
        providerLifecycleState: "bind_pending",
        updatedAt: providerCreatedAt,
      })
      .where(eq(parkingPassPurchases.id, created.purchase.id));
  });

  try {
    await db.transaction(async (tx: any) => {
      const [lockedPurchase] = await tx
        .select()
        .from(parkingPassPurchases)
        .where(eq(parkingPassPurchases.id, created.purchase.id))
        .limit(1)
        .for("update");
      if (
        !lockedPurchase ||
        (lockedPurchase.stripePaymentIntentId &&
          lockedPurchase.stripePaymentIntentId !== intent!.id)
      ) {
        throw new ParkingPassBookingError(
          409,
          "provider_bind_mismatch",
          "A different provider checkout is already bound to this purchase.",
        );
      }
      await tx
        .update(parkingPassPurchases)
        .set({
          stripePaymentIntentId: intent!.id,
          providerLifecycleState: "bound",
          providerErrorCode: null,
          providerErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(parkingPassPurchases.id, created.purchase.id));
      await tx
        .update(eventBookings)
        .set({ stripePaymentIntentId: intent!.id, updatedAt: new Date() })
        .where(eq(eventBookings.purchaseId, created.purchase.id));
      await tx
        .update(parkingPassProviderOperations)
        .set({
          expectedPaymentIntentId: intent!.id,
          providerPaymentIntentId: intent!.id,
          providerStatus: intent!.status,
          updatedAt: new Date(),
        })
        .where(eq(parkingPassProviderOperations.id, providerOperation.id));
      await tx
        .update(parkingPassProviderOperationSteps)
        .set({
          expectedPaymentIntentId: intent!.id,
          providerPaymentIntentId: intent!.id,
          updatedAt: new Date(),
        })
        .where(eq(parkingPassProviderOperationSteps.operationId, providerOperation.id));
      await tx
        .update(parkingPassProviderOperationSteps)
        .set({
          status: "provider_confirmed",
          providerObjectId: intent!.id,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              parkingPassProviderOperationSteps.operationId,
              providerOperation.id,
            ),
            eq(
              parkingPassProviderOperationSteps.stepType,
              "payment_intent_bind",
            ),
          ),
        );
      await tx
        .update(parkingPassProviderOperations)
        .set({
          status: "provider_confirmed",
          providerStatus: intent!.status,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(parkingPassProviderOperations.id, providerOperation.id));
    });
  } catch (error: any) {
    await markProviderOperationActionRequired({
      purchaseId: created.purchase.id,
      operationId: providerOperation.id,
      code: "provider_bind_failed",
      message: clean(error?.message) || "Provider checkout binding failed.",
    });
    throw new ParkingPassBookingError(
      503,
      "provider_bind_pending",
      "Payment setup succeeded at the provider and is awaiting safe local recovery.",
    );
  }

  const [boundPurchase] = await db
    .select()
    .from(parkingPassPurchases)
    .where(eq(parkingPassPurchases.id, created.purchase.id))
    .limit(1);
  if (!boundPurchase) {
    throw new ParkingPassBookingError(
      409,
      "provider_bind_missing",
      "The provider checkout was bound but the purchase could not be reloaded.",
    );
  }
  // A create call may itself be a recovered provider result. Always drive the
  // authoritative status through the same convergence path as an idempotent
  // replay; only client-resumable states may ever receive a client secret.
  const converged = await existingPurchaseResult({
    purchase: boundPurchase,
    stripe,
  });
  if (!converged) {
    throw new ParkingPassBookingError(
      409,
      "provider_checkout_action_required",
      "The bound provider checkout could not be safely resumed.",
    );
  }
  return converged;
}

async function retrieveDestinationSettlementIdentity(
  intent: Stripe.PaymentIntent,
  stripeClient: Stripe | null,
) {
  const chargeId = stripeChargeId(intent);
  if (!stripeClient || !chargeId) {
    throw new ParkingPassBookingError(
      503,
      "provider_settlement_unavailable",
      "The captured destination settlement cannot yet be bound locally.",
    );
  }
  const charge = await stripeClient.charges.retrieve(chargeId, {
    expand: ["transfer", "application_fee"],
  });
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : clean(charge.payment_intent?.id);
  const transferId =
    typeof charge.transfer === "string"
      ? charge.transfer
      : clean(charge.transfer?.id);
  const applicationFeeId =
    typeof charge.application_fee === "string"
      ? charge.application_fee
      : clean(charge.application_fee?.id);
  if (
    charge.id !== chargeId ||
    paymentIntentId !== intent.id ||
    charge.amount !== intent.amount ||
    clean(charge.currency) !== clean(intent.currency) ||
    !transferId
  ) {
    throw new ParkingPassBookingError(
      409,
      "provider_settlement_mismatch",
      "The provider charge/transfer identity does not match this Parking Pass purchase.",
    );
  }
  const transfer = await stripeClient.transfers.retrieve(transferId);
  const destination =
    typeof transfer.destination === "string"
      ? transfer.destination
      : clean(transfer.destination?.id);
  const applicationFee = applicationFeeId
    ? await stripeClient.applicationFees.retrieve(applicationFeeId)
    : null;
  const feeChargeId = applicationFee
    ? typeof applicationFee.charge === "string"
      ? applicationFee.charge
      : clean(applicationFee.charge?.id)
    : null;
  if (
    destination !== destinationFromIntent(intent) ||
    transfer.amount !== intent.amount - Number(intent.application_fee_amount || 0) ||
    clean(transfer.currency) !== clean(intent.currency) ||
    (Number(intent.application_fee_amount || 0) > 0 &&
      (!applicationFee ||
        applicationFee.amount !== Number(intent.application_fee_amount || 0) ||
        clean(applicationFee.currency) !== clean(intent.currency) ||
        feeChargeId !== charge.id))
  ) {
    throw new ParkingPassBookingError(
      409,
      "provider_settlement_mismatch",
      "The destination transfer or application-fee identity does not match the purchase allocation.",
    );
  }
  return { chargeId, transferId, applicationFeeId: applicationFeeId || null };
}

async function bindCapturedSettlementForTechnicalRecovery(input: {
  intent: Stripe.PaymentIntent;
  settlementIdentity: {
    chargeId: string;
    transferId: string;
    applicationFeeId: string | null;
  };
}) {
  const purchaseId = clean(input.intent.metadata?.purchaseId);
  const providerOperationId = clean(
    input.intent.metadata?.providerOperationId,
  );
  await db.transaction(async (tx: any) => {
    const [purchase] = await tx
      .select()
      .from(parkingPassPurchases)
      .where(eq(parkingPassPurchases.id, purchaseId))
      .limit(1)
      .for("update");
    const [providerOperation] = await tx
      .select()
      .from(parkingPassProviderOperations)
      .where(eq(parkingPassProviderOperations.id, providerOperationId))
      .limit(1)
      .for("update");
    if (
      !purchase ||
      !providerOperation ||
      providerOperation.purchaseId !== purchase.id ||
      providerOperation.operationKind !== "payment_intent_create" ||
      providerOperation.requestDigest !== purchase.requestDigest ||
      providerOperation.allocationDigest !== purchase.allocationDigest ||
      providerOperation.expectedPaymentIntentId !== input.intent.id ||
      providerOperation.expectedAmountCents !== purchase.chargedAmountCents ||
      providerOperation.expectedCurrency !== purchase.currency ||
      providerOperation.expectedDestinationAccountId !==
        purchase.stripeDestinationAccountId ||
      providerOperation.expectedApplicationFeeCents !==
        purchase.platformFeeCents ||
      purchase.stripePaymentIntentId !== input.intent.id ||
      purchase.chargedAmountCents !== input.intent.amount ||
      purchase.currency !== clean(input.intent.currency) ||
      purchase.stripeDestinationAccountId !==
        destinationFromIntent(input.intent) ||
      Number(input.intent.application_fee_amount || 0) !==
        purchase.platformFeeCents ||
      purchase.requestDigest !== clean(input.intent.metadata?.requestDigest) ||
      purchase.allocationDigest !==
        clean(input.intent.metadata?.allocationDigest) ||
      (purchase.stripeChargeId !== null &&
        purchase.stripeChargeId !== input.settlementIdentity.chargeId) ||
      (purchase.stripeTransferId !== null &&
        purchase.stripeTransferId !== input.settlementIdentity.transferId) ||
      (purchase.stripeApplicationFeeId !== null &&
        purchase.stripeApplicationFeeId !==
          input.settlementIdentity.applicationFeeId)
    ) {
      throw new ParkingPassBookingError(
        409,
        "captured_settlement_bind_mismatch",
        "Captured provider settlement could not be bound to the durable purchase for recovery.",
      );
    }
    const capturedAt = purchase.paidAt || new Date();
    await tx
      .update(parkingPassProviderOperations)
      .set({
        providerPaymentIntentId: input.intent.id,
        providerChargeId: input.settlementIdentity.chargeId,
        providerTransferId: input.settlementIdentity.transferId,
        providerApplicationFeeId:
          input.settlementIdentity.applicationFeeId,
        providerStatus: input.intent.status,
        updatedAt: capturedAt,
      })
      .where(eq(parkingPassProviderOperations.id, providerOperation.id));
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        providerPaymentIntentId: input.intent.id,
        providerChargeId: input.settlementIdentity.chargeId,
        providerTransferId: input.settlementIdentity.transferId,
        providerApplicationFeeId:
          input.settlementIdentity.applicationFeeId,
        updatedAt: capturedAt,
      })
      .where(
        eq(
          parkingPassProviderOperationSteps.operationId,
          providerOperation.id,
        ),
      );
    await tx
      .update(parkingPassPurchases)
      .set({
        settlementStatus: "transferred_to_connect",
        stripeChargeId: input.settlementIdentity.chargeId,
        stripeTransferId: input.settlementIdentity.transferId,
        stripeApplicationFeeId:
          input.settlementIdentity.applicationFeeId,
        providerLifecycleState: "closed",
        paidAt: capturedAt,
        updatedAt: capturedAt,
      })
      .where(eq(parkingPassPurchases.id, purchase.id));
  });
}

async function resolveTechnicalCancellationCapture(input: {
  purchaseId: string;
  bookingLineIds?: string[];
  actor: CancelParkingPassLinesInput["actor"];
  stripe: Stripe | null;
}) {
  const authoritySnapshot = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_cancel:${input.purchaseId}`}))`,
    );
    const allLineRows = await tx
      .select({ id: eventBookings.id })
      .from(eventBookings)
      .where(eq(eventBookings.purchaseId, input.purchaseId))
      .orderBy(asc(eventBookings.id));
    const allLineIds = stableLineIds(allLineRows.map((line: any) => line.id));
    let selectedLineIds = stableLineIds(
      input.bookingLineIds?.length ? input.bookingLineIds : allLineIds,
    );
    let authority = await resolveCancellationAuthorityLocked({
      tx,
      purchaseId: input.purchaseId,
      selectedLineIds,
      actor: input.actor,
    });
    if (
      authority.purchase.status === "pending" ||
      authority.lines.some((line) => line.booking.status === "pending")
    ) {
      selectedLineIds = allLineIds;
      authority = await resolveCancellationAuthorityLocked({
        tx,
        purchaseId: input.purchaseId,
        selectedLineIds,
        actor: input.actor,
      });
    }
    return {
      purchase: authority.purchase,
      pending:
        authority.purchase.status === "pending" ||
        authority.lines.some((line) => line.booking.status === "pending"),
    };
  });
  if (!authoritySnapshot.pending) return true;
  const paymentIntentId = clean(
    authoritySnapshot.purchase.stripePaymentIntentId,
  );
  if (!paymentIntentId || !input.stripe) return false;

  let intent: Stripe.PaymentIntent;
  try {
    intent = await input.stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    // The durable pre-capture cancellation path will make the same provider
    // lookup after its operation exists and keep capacity reserved on ambiguity.
    return false;
  }
  if (intent.status !== "succeeded") return false;
  const settlementIdentity = await retrieveDestinationSettlementIdentity(
    intent,
    input.stripe,
  );
  await bindCapturedSettlementForTechnicalRecovery({
    intent,
    settlementIdentity,
  });
  return true;
}

/** Provider-confirmed webhook/return reconciliation at purchase scope. */
export async function confirmParkingPassPurchaseFromIntent(
  intent: Stripe.PaymentIntent,
  stripeClient: Stripe | null = configuredStripe,
) {
  const purchaseId = clean(intent.metadata?.purchaseId);
  if (!purchaseId) return { handled: false as const };
  if (intent.status !== "succeeded") {
    return { handled: true as const, status: intent.status };
  }
  const settlementIdentity = await retrieveDestinationSettlementIdentity(
    intent,
    stripeClient,
  );

  let providerPurchaseValidated = false;
  try {
    const result = await db.transaction(async (tx: any) => {
      const [purchase] = await tx
        .select()
        .from(parkingPassPurchases)
        .where(eq(parkingPassPurchases.id, purchaseId))
        .limit(1)
        .for("update");
      if (!purchase) {
        throw new ParkingPassBookingError(
          404,
          "purchase_not_found",
          "Parking Pass purchase was not found.",
        );
      }
      if (
        purchase.stripePaymentIntentId !== intent.id ||
        purchase.chargedAmountCents !== intent.amount ||
        clean(intent.currency) !== purchase.currency ||
        destinationFromIntent(intent) !== purchase.stripeDestinationAccountId ||
        Number(intent.application_fee_amount || 0) !== purchase.platformFeeCents ||
        clean(intent.metadata?.requestDigest) !== purchase.requestDigest ||
        clean(intent.metadata?.allocationDigest) !== purchase.allocationDigest
      ) {
        throw new ParkingPassBookingError(
          409,
          "provider_purchase_mismatch",
          "Stripe payment facts do not match the stored Parking Pass purchase.",
        );
      }
      const providerOperationId = clean(intent.metadata?.providerOperationId);
      const [providerOperation] = await tx
        .select()
        .from(parkingPassProviderOperations)
        .where(eq(parkingPassProviderOperations.id, providerOperationId))
        .limit(1)
        .for("update");
      if (
        !providerOperation ||
        providerOperation.purchaseId !== purchase.id ||
        providerOperation.operationKind !== "payment_intent_create" ||
        providerOperation.requestDigest !== purchase.requestDigest ||
        providerOperation.allocationDigest !== purchase.allocationDigest ||
        providerOperation.providerPaymentIntentId !== intent.id ||
        providerOperation.expectedAmountCents !== purchase.chargedAmountCents ||
        providerOperation.expectedCurrency !== purchase.currency ||
        providerOperation.expectedDestinationAccountId !==
          purchase.stripeDestinationAccountId ||
        providerOperation.expectedApplicationFeeCents !==
          purchase.platformFeeCents
      ) {
        throw new ParkingPassBookingError(
          409,
          "provider_operation_mismatch",
          "The webhook does not match the durable Parking Pass provider operation.",
        );
      }
      providerPurchaseValidated = true;
      const [technicalRecovery] = await tx
        .select({
          id: parkingPassCancellationOperations.id,
          status: parkingPassCancellationOperations.status,
        })
        .from(parkingPassCancellationOperations)
        .where(
          and(
            eq(
              parkingPassCancellationOperations.purchaseId,
              purchase.id,
            ),
            eq(
              parkingPassCancellationOperations.policyTrigger,
              "technical_non_service",
            ),
          ),
        )
        .limit(1);
      if (technicalRecovery) {
        return {
          status:
            technicalRecovery.status === "provider_confirmed"
              ? "technical_refunded"
              : "technical_refund_processing",
          replay: true,
          operationId: technicalRecovery.id,
        };
      }
      if (
        purchase.paidAt &&
        purchase.status !== "pending" &&
        [
          "transferred_to_connect",
          "reversed",
          "partially_reversed",
          "disputed",
        ].includes(purchase.settlementStatus)
      ) {
        return { status: purchase.status, replay: true };
      }
      const lines = await tx
        .select({ booking: eventBookings, event: events })
        .from(eventBookings)
        .innerJoin(events, eq(events.id, eventBookings.eventId))
        .where(eq(eventBookings.purchaseId, purchase.id))
        .orderBy(asc(eventBookings.createdAt))
        .for("update");
      const selectedSeriesDateFacts = await lockParkingPassSeriesDates(
        tx,
        lines.map((row: (typeof lines)[number]) => row.event),
      );
      const seriesIds: string[] = Array.from(
        new Set<string>(
          lines
            .map((row: (typeof lines)[number]) => clean(row.event.seriesId))
            .filter((seriesId: string) => seriesId.length > 0),
        ),
      ).sort();
      const seriesRows: Array<typeof eventSeries.$inferSelect> = seriesIds.length
        ? await tx
            .select()
            .from(eventSeries)
            .where(inArray(eventSeries.id, seriesIds))
            .orderBy(asc(eventSeries.id))
            .for("update")
        : [];
      const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
      await assertNoParkingPassBlackoutLocked({
        tx,
        facts: selectedSeriesDateFacts,
        seriesById,
      });
      const lineHostAmountCents = lines.reduce(
        (total: number, row: (typeof lines)[number]) =>
          total + Number(row.booking.hostPriceCents || 0),
        0,
      );
      const linePlatformFeeCents = lines.reduce(
        (total: number, row: (typeof lines)[number]) =>
          total + Number(row.booking.platformFeeCents || 0),
        0,
      );
      const lineCreditAppliedCents = lines.reduce(
        (total: number, row: (typeof lines)[number]) =>
          total + Number(row.booking.creditAppliedCents || 0),
        0,
      );
      if (
        lines.length === 0 ||
        lines.length !== purchase.allocationLineCount ||
        lineHostAmountCents !== purchase.hostAmountCents ||
        linePlatformFeeCents !== purchase.platformFeeCents ||
        lineCreditAppliedCents !== purchase.creditAppliedCents ||
        purchase.chargedAmountCents !==
          purchase.hostAmountCents + purchase.platformFeeCents ||
        lines.some(
          (row: (typeof lines)[number]) =>
            row.booking.purchaseId !== purchase.id ||
            row.booking.allocationDigest !== purchase.allocationDigest ||
            row.booking.hostId !== purchase.hostId ||
            row.booking.truckId !== purchase.truckId ||
            row.booking.totalCents !==
              row.booking.hostPriceCents + row.booking.platformFeeCents ||
            row.booking.stripeApplicationFeeAmount !==
              row.booking.platformFeeCents ||
            row.booking.stripeTransferDestination !==
              purchase.stripeDestinationAccountId ||
            row.booking.settlementTopology !== "destination_charge",
        ) ||
        lines.some(
          (row: (typeof lines)[number]) => {
            const series = row.event.seriesId
              ? seriesById.get(row.event.seriesId)
              : null;
            return (
              row.booking.status !== "pending" ||
              row.event.hostId !== purchase.hostId ||
              row.event.requiresPayment !== true ||
              row.event.status !== "open" ||
            row.booking.activeEventMutationId !== null ||
            row.booking.eventParticipationVersion !==
              row.event.participationVersion ||
            row.event.activeParticipationMutationId !== null ||
            row.event.participationSuppressedAt !== null ||
            (row.event.seriesId !== null &&
                (!series ||
                  !eventSeriesTopologyIsServiceable(row.event, series) ||
                  series.activeParticipationMutationId !== null ||
                  series.participationSuppressedAt !== null))
            );
          },
        )
      ) {
        throw new ParkingPassBookingError(
          409,
          "purchase_capacity_missing",
          "Captured payment no longer has every reserved Parking Pass line.",
        );
      }

      const now = new Date();
      for (const row of lines) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_spot:${row.event.id}`}))`,
        );
        const confirmed = await tx
          .select({ spotNumber: eventBookings.spotNumber })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.eventId, row.event.id),
              eq(eventBookings.status, "confirmed"),
            ),
          );
        const used = new Set(
          confirmed
            .map((item: (typeof confirmed)[number]) => Number(item.spotNumber))
            .filter((value: number) => Number.isInteger(value) && value > 0),
        );
        let spotNumber = 1;
        while (used.has(spotNumber)) spotNumber += 1;
        if (spotNumber > Math.max(1, Number(row.event.maxTrucks || 1))) {
          throw new ParkingPassBookingError(
            409,
            "purchase_capacity_lost",
            "Captured payment could not be matched to confirmed capacity.",
          );
        }
        await tx
          .update(eventBookings)
          .set({
            status: "confirmed",
            stripePaymentStatus: "succeeded",
            stripePaymentIntentId: intent.id,
            stripeTransferDestination: purchase.stripeDestinationAccountId,
            settlementTopology: "destination_charge",
            settlementState: "destination_settled",
            paidAt: now,
            bookingConfirmedAt: now,
            spotNumber,
            updatedAt: now,
          })
          .where(eq(eventBookings.id, row.booking.id));
      }
      await tx
        .update(parkingPassPurchases)
        .set({
          status: "confirmed",
          settlementStatus: "transferred_to_connect",
          stripeChargeId: settlementIdentity.chargeId,
          stripeTransferId: settlementIdentity.transferId,
          stripeApplicationFeeId: settlementIdentity.applicationFeeId,
          providerLifecycleState: "closed",
          paidAt: now,
          providerErrorCode: null,
          providerErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(parkingPassPurchases.id, purchase.id));
      await tx
        .update(parkingPassCreditLedger)
        .set({ state: "posted", updatedAt: now })
        .where(
          and(
            eq(parkingPassCreditLedger.purchaseId, purchase.id),
            eq(parkingPassCreditLedger.state, "reserved"),
          ),
        );
      return {
        status: "confirmed",
        replay: false,
        purchaseId: purchase.id,
        bookingIds: lines.map((row: (typeof lines)[number]) => row.booking.id),
      };
    });
    return { handled: true as const, ...result };
  } catch (error) {
    if (providerPurchaseValidated) {
      try {
        await bindCapturedSettlementForTechnicalRecovery({
          intent,
          settlementIdentity,
        });
        await refundTechnicalNonService({
          purchaseId,
          requestId: `technical-confirmation:${intent.id}`,
          reason:
            error instanceof ParkingPassBookingError
              ? error.code
              : "technical_confirmation_failure",
          stripe: stripeClient,
        });
      } catch (refundError) {
        console.error("[parking-pass] technical refund recovery failed", {
          purchaseId,
          paymentIntentId: intent.id,
          error:
            refundError instanceof Error
              ? refundError.message
              : String(refundError),
        });
      }
    }
    throw error;
  }
}

/** Record provider failure without treating a retriable attempt as cancellation. */
export async function recordParkingPassPaymentFailureFromIntent(
  intent: Stripe.PaymentIntent,
  options: { final?: boolean } = {},
) {
  const purchaseId = clean(intent.metadata?.purchaseId);
  if (!purchaseId) return { handled: false as const };
  const now = new Date();
  return db.transaction(async (tx: any) => {
    const [purchase] = await tx
      .select()
      .from(parkingPassPurchases)
      .where(eq(parkingPassPurchases.id, purchaseId))
      .limit(1)
      .for("update");
    if (!purchase) {
      throw new ParkingPassBookingError(
        404,
        "purchase_not_found",
        "Parking Pass purchase was not found.",
      );
    }
    if (
      purchase.stripePaymentIntentId !== intent.id ||
      purchase.chargedAmountCents !== intent.amount ||
      clean(intent.currency) !== purchase.currency ||
      destinationFromIntent(intent) !== purchase.stripeDestinationAccountId ||
      Number(intent.application_fee_amount || 0) !== purchase.platformFeeCents ||
      clean(intent.metadata?.requestDigest) !== purchase.requestDigest ||
      clean(intent.metadata?.allocationDigest) !== purchase.allocationDigest
    ) {
      throw new ParkingPassBookingError(
        409,
        "provider_purchase_mismatch",
        "Stripe payment failure does not match the stored Parking Pass purchase.",
      );
    }
    if (["confirmed", "refunded", "partially_refunded"].includes(purchase.status)) {
      return { handled: true as const, replay: true, status: purchase.status };
    }
    const final = options.final === true;
    if (final && intent.status !== "canceled") {
      throw new ParkingPassBookingError(
        409,
        "provider_cancel_unconfirmed",
        "Local capacity cannot be released until Stripe confirms cancellation.",
      );
    }
    await tx
      .update(parkingPassPurchases)
      .set({
        status: final ? "payment_failed" : purchase.status,
        settlementStatus: final ? "failed" : purchase.settlementStatus,
        providerLifecycleState: final ? "closed" : purchase.providerLifecycleState,
        providerErrorCode:
          clean(intent.last_payment_error?.code) ||
          (final ? "payment_intent_canceled" : "payment_attempt_failed"),
        providerErrorMessage:
          clean(intent.last_payment_error?.message) ||
          (final
            ? "Stripe cancelled the Parking Pass PaymentIntent."
            : "The latest Stripe payment attempt failed and may be retried."),
        updatedAt: now,
      })
      .where(eq(parkingPassPurchases.id, purchase.id));
    await tx
      .update(eventBookings)
      .set({
        status: final ? "cancelled" : "pending",
        stripePaymentStatus: "failed",
        cancelledAt: final ? now : null,
        cancellationReason: final ? "Payment was not completed" : null,
        cancellationPolicy: final ? "pre_capture_release" : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(eventBookings.purchaseId, purchase.id),
          eq(eventBookings.status, "pending"),
        ),
      );
    if (final) {
      await tx
        .update(parkingPassCreditLedger)
        .set({ state: "released", updatedAt: now })
        .where(
          and(
            eq(parkingPassCreditLedger.purchaseId, purchase.id),
            eq(parkingPassCreditLedger.state, "reserved"),
          ),
        );
    }
    return {
      handled: true as const,
      replay: false,
      status: final ? "payment_failed" : purchase.status,
    };
  });
}

type CancellationActor = {
  userId: string;
  userType?: string | null;
  canManageTruck?: boolean;
  system?: boolean;
  eventMutationId?: string;
  eventMutationChildId?: string;
};

export type CancelParkingPassLinesInput = {
  purchaseId: string;
  bookingLineIds?: string[];
  requestId: string;
  reason: string;
  actor: CancellationActor;
  stripe?: Stripe | null;
  technicalNonService?: boolean;
};

type LoadedCancellationLine = {
  booking: typeof eventBookings.$inferSelect;
  event: typeof events.$inferSelect;
  hostOwnerId: string;
  timeZone: string;
};

async function buildLoadedCancellationLines(
  rows: Array<{ booking: any; event: any; host: any }>,
  database: any,
  knownSeriesTimeZones?: Map<string, string | null>,
): Promise<LoadedCancellationLine[]> {
  const seriesIds = Array.from(
    new Set(rows.map((row) => clean(row.event.seriesId)).filter(Boolean)),
  );
  let seriesTimeZones = knownSeriesTimeZones;
  if (!seriesTimeZones) {
    const loadedSeries = seriesIds.length
      ? await database
          .select({ id: eventSeries.id, timezone: eventSeries.timezone })
          .from(eventSeries)
          .where(inArray(eventSeries.id, seriesIds))
      : [];
    seriesTimeZones = new Map(
      loadedSeries.map((series: { id: string; timezone: string | null }) => [
        series.id,
        series.timezone,
      ]),
    );
  }

  const venueTimeZones = new Map<string, string | null>();
  const result: LoadedCancellationLine[] = [];
  for (const row of rows) {
    const seriesId = clean(row.event.seriesId);
    let venueTimeZone: string | null = null;
    if (!seriesId) {
      const venueKey = `${clean(row.host.city).toLowerCase()}|${clean(row.host.state).toUpperCase()}`;
      if (!venueTimeZones.has(venueKey)) {
        venueTimeZones.set(
          venueKey,
          await resolveCityTimeZoneStrict(
            { city: row.host.city, state: row.host.state },
            database,
          ),
        );
      }
      venueTimeZone = venueTimeZones.get(venueKey) ?? null;
    }
    const timeZone = resolvePersistedEventServiceTimeZone({
      seriesId,
      seriesTimeZone: seriesTimeZones.get(seriesId),
      venueTimeZone,
    });
    if (!timeZone) {
      throw new ParkingPassBookingError(
        409,
        "venue_timezone_unavailable",
        "A selected booking line does not have a valid persisted service timezone.",
        { eventId: row.event.id, seriesId: seriesId || null },
      );
    }
    result.push({
      booking: row.booking,
      event: row.event,
      hostOwnerId: row.host.userId,
      timeZone,
    });
  }
  return result;
}

const isStaff = (type: unknown) =>
  ["staff", "admin", "duper_admin", "super_admin"].includes(clean(type));

const lineStartAt = (line: LoadedCancellationLine) =>
  buildSlotDateTimes({
    timeZone: line.timeZone,
    date: line.event.date,
    startTime: line.event.startTime,
    endTime: line.event.endTime,
  })?.startUtc || null;

async function loadCancellationLines(
  purchaseId: string,
  bookingLineIds?: string[],
) {
  const selected = stableLineIds(bookingLineIds || []);
  const [purchase] = await db
    .select()
    .from(parkingPassPurchases)
    .where(eq(parkingPassPurchases.id, purchaseId))
    .limit(1);
  if (!purchase) {
    throw new ParkingPassBookingError(
      404,
      "purchase_not_found",
      "Parking Pass purchase was not found.",
    );
  }
  const rows = await db
    .select({ booking: eventBookings, event: events, host: hosts })
    .from(eventBookings)
    .innerJoin(events, eq(events.id, eventBookings.eventId))
    .innerJoin(hosts, eq(hosts.id, eventBookings.hostId))
    .where(
      and(
        eq(eventBookings.purchaseId, purchase.id),
        selected.length ? inArray(eventBookings.id, selected) : undefined,
      ),
    )
    .orderBy(asc(eventBookings.createdAt));
  if (rows.length === 0 || (selected.length && rows.length !== selected.length)) {
    throw new ParkingPassBookingError(
      404,
      "booking_lines_not_found",
      "One or more selected Parking Pass lines were not found.",
    );
  }
  return {
    purchase,
    lines: await buildLoadedCancellationLines(rows, db),
  };
}

async function resolveCancellationAuthorityLocked(input: {
  tx: any;
  purchaseId: string;
  selectedLineIds: string[];
  actor: CancellationActor;
}) {
  const actorUserId = clean(input.actor.userId);
  const [purchase] = await input.tx
    .select()
    .from(parkingPassPurchases)
    .where(eq(parkingPassPurchases.id, input.purchaseId))
    .limit(1)
    .for("update");
  if (!purchase) {
    throw new ParkingPassBookingError(
      404,
      "purchase_not_found",
      "Parking Pass purchase was not found.",
    );
  }
  const rows = await input.tx
    .select({ booking: eventBookings, event: events, host: hosts })
    .from(eventBookings)
    .innerJoin(events, eq(events.id, eventBookings.eventId))
    .innerJoin(hosts, eq(hosts.id, eventBookings.hostId))
    .where(
      and(
        eq(eventBookings.purchaseId, purchase.id),
        inArray(eventBookings.id, input.selectedLineIds),
      ),
    )
    .orderBy(asc(eventBookings.id))
    .for("update");
  if (rows.length !== input.selectedLineIds.length) {
    throw new ParkingPassBookingError(
      404,
      "booking_lines_not_found",
      "One or more selected Parking Pass lines are not owned by this purchase.",
    );
  }
  const [actorRecord] = actorUserId
    ? await input.tx
        .select({ userType: users.userType, isDisabled: users.isDisabled })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1)
        .for("update")
    : [];
  const [truck] = await input.tx
    .select({ ownerId: restaurants.ownerId })
    .from(restaurants)
    .where(eq(restaurants.id, purchase.truckId))
    .limit(1)
    .for("update");
  const [membership] = actorUserId
    ? await input.tx
        .select({
          status: businessStaffMemberships.status,
          permissions: businessStaffMemberships.permissions,
        })
        .from(businessStaffMemberships)
        .where(
          and(
            eq(businessStaffMemberships.restaurantId, purchase.truckId),
            eq(businessStaffMemberships.userId, actorUserId),
          ),
        )
        .limit(1)
        .for("update")
    : [];
  const seriesIds: string[] = Array.from(
    new Set(rows.map((row: any) => clean(row.event.seriesId)).filter(Boolean)),
  ) as string[];
  const seriesRows = seriesIds.length
    ? await input.tx
        .select({
          id: eventSeries.id,
          coordinatorUserId: eventSeries.coordinatorUserId,
          timezone: eventSeries.timezone,
        })
        .from(eventSeries)
        .where(inArray(eventSeries.id, seriesIds))
        .for("update")
    : [];
  const seriesCoordinatorById = new Map(
    seriesRows.map((row: any) => [row.id, clean(row.coordinatorUserId)]),
  );
  const seriesTimeZoneById = new Map<string, string | null>(
    seriesRows.map((row: any) => [row.id, row.timezone]),
  );
  const system = input.actor.system === true;
  const currentActorActive = system || actorRecord?.isDisabled === false;
  const staff =
    !system &&
    currentActorActive &&
    isStaff(actorRecord?.userType);
  const hostOwner =
    !system &&
    currentActorActive &&
    !!actorUserId &&
    rows.every((row: any) => clean(row.host.userId) === actorUserId);
  const coordinator =
    !system &&
    currentActorActive &&
    !!actorUserId &&
    rows.every(
      (row: any) =>
        row.event.eventType !== "parking_pass" &&
        (clean(row.event.coordinatorUserId) === actorUserId ||
          seriesCoordinatorById.get(clean(row.event.seriesId)) === actorUserId),
    );
  const truckTeam =
    !system &&
    currentActorActive &&
    !!actorUserId &&
    (truck?.ownerId === actorUserId ||
      (membership?.status === "active" &&
        hasManageParkingPassPermission(membership.permissions)));
  const actorType = system
    ? "system"
    : staff
      ? "admin"
      : hostOwner
        ? "host"
        : coordinator
          ? "coordinator"
          : truckTeam
            ? "truck_team"
            : null;
  if (!actorType) {
    throw new ParkingPassBookingError(
      403,
      "cancellation_forbidden",
      "Your current authority does not allow this cancellation.",
    );
  }
  const lines = await buildLoadedCancellationLines(
    rows,
    input.tx,
    seriesTimeZoneById,
  );
  return {
    purchase,
    lines,
    actorUserId,
    actorType,
    system,
    staff,
    hostOwner,
    coordinator,
    truckTeam,
  };
}

export async function cancelParkingPassLines(
  input: CancelParkingPassLinesInput,
): Promise<CancellationOperation> {
  const purchaseId = clean(input.purchaseId);
  const requestId = clean(input.requestId);
  const reason = clean(input.reason);
  const stripe = input.stripe === undefined ? configuredStripe : input.stripe;
  if (!purchaseId || requestId.length < 8 || !reason) {
    throw new ParkingPassBookingError(
      400,
      "invalid_cancellation_request",
      "Purchase, reason, and a stable request ID are required.",
    );
  }
  const effectiveTechnicalNonService = input.technicalNonService
    ? await resolveTechnicalCancellationCapture({
        purchaseId,
        bookingLineIds: input.bookingLineIds,
        actor: input.actor,
        stripe,
      })
    : false;
  const operationResult = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_cancel:${purchaseId}`}))`,
    );
    const allLineRows = await tx
      .select({ id: eventBookings.id })
      .from(eventBookings)
      .where(eq(eventBookings.purchaseId, purchaseId))
      .orderBy(asc(eventBookings.id));
    const allLineIds = stableLineIds(allLineRows.map((line: any) => line.id));
    let lineIds = stableLineIds(
      input.bookingLineIds?.length ? input.bookingLineIds : allLineIds,
    );
    let authority = await resolveCancellationAuthorityLocked({
      tx,
      purchaseId,
      selectedLineIds: lineIds,
      actor: input.actor,
    });
    if (
      authority.purchase.status === "pending" ||
      authority.lines.some((line) => line.booking.status === "pending")
    ) {
      lineIds = allLineIds;
      authority = await resolveCancellationAuthorityLocked({
        tx,
        purchaseId,
        selectedLineIds: lineIds,
        actor: input.actor,
      });
    }
    const [existingOperation] = await tx
      .select()
      .from(parkingPassCancellationOperations)
      .where(
        and(
          eq(parkingPassCancellationOperations.purchaseId, purchaseId),
          eq(parkingPassCancellationOperations.requestId, requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (existingOperation) {
      const storedActor =
        existingOperation.actorSnapshot &&
        typeof existingOperation.actorSnapshot === "object"
          ? (existingOperation.actorSnapshot as Record<string, unknown>)
          : {};
      const allocations = authority.lines
        .map((line) => ({
          id: line.booking.id,
          hostId: line.booking.hostId,
          hostPriceCents: line.booking.hostPriceCents,
          platformFeeCents: line.booking.platformFeeCents,
          creditAppliedCents: line.booking.creditAppliedCents,
          totalCents: line.booking.totalCents,
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const replayFinancials = summarizeSelectedLineRemedy(
        allocations,
        existingOperation.remedy as ParkingPassRemedy,
      );
      const mismatchFields = [
        existingOperation.idempotencyKey !==
        `parking-pass-cancel:${existingOperation.requestDigest}`
          ? "idempotencyKey"
          : null,
        existingOperation.reason !== reason ? "reason" : null,
        existingOperation.allocationDigest !==
        authority.purchase.allocationDigest
          ? "allocationDigest"
          : null,
        clean(storedActor.actorType) !== authority.actorType
          ? "actorType"
          : null,
        clean(storedActor.actorUserId) !== authority.actorUserId
          ? "actorUserId"
          : null,
        JSON.stringify(existingOperation.bookingLineIds) !==
        JSON.stringify(lineIds)
          ? "sortedLineIds"
          : null,
        existingOperation.expectedPaymentIntentId !==
        authority.purchase.stripePaymentIntentId
          ? "paymentIntentId"
          : null,
        existingOperation.expectedChargeId !== authority.purchase.stripeChargeId
          ? "chargeId"
          : null,
        existingOperation.expectedCurrency !== authority.purchase.currency
          ? "currency"
          : null,
        existingOperation.expectedDestinationAccountId !==
        authority.purchase.stripeDestinationAccountId
          ? "destinationAccountId"
          : null,
        existingOperation.expectedCashRefundCents !==
        replayFinancials.cashRefundCents
          ? "cashRefundCents"
          : null,
        existingOperation.expectedHostReversalCents !==
        replayFinancials.hostTransferReversalCents
          ? "hostReversalCents"
          : null,
        existingOperation.expectedApplicationFeeRefundCents !==
        replayFinancials.applicationFeeRefundCents
          ? "applicationFeeRefundCents"
          : null,
      ].filter((field): field is string => field !== null);
      if (mismatchFields.length > 0) {
        throw new ParkingPassBookingError(
          409,
          "cancellation_idempotency_mismatch",
          "That request ID is bound to different actor, policy, reason, or selected-line facts.",
          { mismatchFields },
        );
      }
      return {
        operation: existingOperation,
        purchase: authority.purchase,
        lines: authority.lines,
        remedy: existingOperation.remedy as
          | "release"
          | "restricted_credit"
          | "cash_refund"
          | "none",
        replay: true as const,
      };
    }
    if (
      authority.lines.some(
        (line) => !["pending", "confirmed"].includes(line.booking.status),
      )
    ) {
      throw new ParkingPassBookingError(
        409,
        "booking_line_closed",
        "One or more selected Parking Pass lines are already closed.",
      );
    }
    const evaluatedAt = new Date();
    const starts = authority.lines.map(lineStartAt);
    const cancellationAuthority: CancellationAuthority = authority.system
      ? "system"
      : authority.staff
        ? "staff"
        : authority.hostOwner
          ? "host_owner"
          : authority.coordinator
            ? "coordinator"
            : "truck_team";
    const policy = evaluateCancellationPolicy({
      authority: cancellationAuthority,
      pending:
        authority.purchase.status === "pending" ||
        authority.lines.some((line) => line.booking.status === "pending"),
      technicalNonService: effectiveTechnicalNonService,
      evaluatedAt,
      startsAt: starts,
    });
    if (!policy.ok) {
      const messages = {
        technical_refund_forbidden:
          "Only the recovery system or current staff may declare technical non-service.",
        operator_cancellation_after_start:
          "Operator cancellation with a cash refund is limited to future lines.",
        mixed_cancellation_policy:
          "Cancel future and already-started Parking Pass lines separately.",
      } as const;
      throw new ParkingPassBookingError(
        policy.code === "technical_refund_forbidden" ? 403 : 409,
        policy.code,
        messages[policy.code],
      );
    }
    const remedy: ParkingPassRemedy = policy.remedy;
    const policyTrigger = policy.policyTrigger;
    const financials = summarizeSelectedLineRemedy(
      authority.lines.map((line) => ({
        id: line.booking.id,
        hostPriceCents: Number(line.booking.hostPriceCents || 0),
        platformFeeCents: Number(line.booking.platformFeeCents || 0),
        creditAppliedCents: Number(line.booking.creditAppliedCents || 0),
        totalCents: Number(line.booking.totalCents || 0),
      })),
      remedy,
    );
    const cashRefundCents = financials.cashRefundCents;
    const hostReversalCents = financials.hostTransferReversalCents;
    const applicationFeeRefundCents = financials.applicationFeeRefundCents;
    const restrictedCreditCents =
      financials.restrictedFutureFeeCreditCents;
    const policyFacts = {
      evaluatedAt: evaluatedAt.toISOString(),
      technicalNonService: effectiveTechnicalNonService,
      startsAt: starts.map((start) => start?.toISOString() || null),
      allBeforeStart: policy.allBeforeStart,
      allAfterStart: policy.allAfterStart,
      actorAuthority: authority.actorType,
    };
    const actorSnapshot = {
      actorType: authority.actorType,
      actorUserId: authority.actorUserId || null,
      system: authority.system,
      staff: authority.staff,
      hostOwner: authority.hostOwner,
      coordinator: authority.coordinator,
      truckTeam: authority.truckTeam,
    };
    const requestDigest = stableDigest({
      version: "parking-pass-cancellation-v1",
      requestId,
      purchaseId,
      actor: actorSnapshot,
      policyTrigger,
      policyFacts,
      reason,
      sortedLineIds: lineIds,
      purchaseAllocationDigest: authority.purchase.allocationDigest,
      allocations: authority.lines
        .map((line) => ({
          id: line.booking.id,
          hostId: line.booking.hostId,
          hostPriceCents: line.booking.hostPriceCents,
          platformFeeCents: line.booking.platformFeeCents,
          creditAppliedCents: line.booking.creditAppliedCents,
          totalCents: line.booking.totalCents,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
    const requestFingerprint = `parking-pass-cancel:${requestDigest}`;
    const [replayed] = await tx
      .select()
      .from(parkingPassCancellationOperations)
      .where(
        and(
          eq(
            parkingPassCancellationOperations.purchaseId,
            authority.purchase.id,
          ),
          eq(parkingPassCancellationOperations.requestId, requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (replayed) {
      if (
        replayed.idempotencyKey !== requestFingerprint ||
        replayed.requestDigest !== requestDigest ||
        replayed.allocationDigest !== authority.purchase.allocationDigest ||
        replayed.actorType !== authority.actorType ||
        clean(replayed.actorUserId) !== authority.actorUserId ||
        replayed.policyTrigger !== policyTrigger ||
        JSON.stringify(replayed.bookingLineIds) !== JSON.stringify(lineIds)
      ) {
        throw new ParkingPassBookingError(
          409,
          "cancellation_idempotency_mismatch",
          "That request ID is bound to different actor, policy, or selected-line facts.",
        );
      }
      return {
        operation: replayed,
        purchase: authority.purchase,
        lines: authority.lines,
        remedy,
        replay: true as const,
      };
    }
    const currentLines = await tx
      .select({ id: eventBookings.id, status: eventBookings.status })
      .from(eventBookings)
      .where(inArray(eventBookings.id, lineIds))
      .for("update");
    if (
      currentLines.length !== lineIds.length ||
      currentLines.some(
        (line: (typeof currentLines)[number]) =>
          !["pending", "confirmed"].includes(line.status),
      )
    ) {
      throw new ParkingPassBookingError(
        409,
        "booking_line_closed",
        "One or more selected Parking Pass lines are already closed.",
      );
    }
    const activeOperations = await tx
      .select({
        id: parkingPassCancellationOperations.id,
        bookingLineIds: parkingPassCancellationOperations.bookingLineIds,
        status: parkingPassCancellationOperations.status,
        policyTrigger: parkingPassCancellationOperations.policyTrigger,
        providerStatus: parkingPassCancellationOperations.providerStatus,
      })
      .from(parkingPassCancellationOperations)
      .where(
        and(
          eq(parkingPassCancellationOperations.purchaseId, purchaseId),
          inArray(parkingPassCancellationOperations.status, [
            "pending",
            "processing",
            "failed_action_required",
            "provider_confirmed",
            "credit_issued",
            "released",
            "no_remedy",
          ]),
        ),
      );
    const selectedSet = new Set(lineIds);
    const overlap = activeOperations.find(
      (candidate: (typeof activeOperations)[number]) => {
        const capturedPreCaptureTransition =
          candidate.status === "no_remedy" &&
          candidate.policyTrigger === "pre_capture_release" &&
          candidate.providerStatus === "captured";
        return (
          !capturedPreCaptureTransition &&
          (Array.isArray(candidate.bookingLineIds)
            ? candidate.bookingLineIds
            : []
          ).some((lineId: unknown) => selectedSet.has(clean(lineId)))
        );
      },
    );
    if (overlap) {
      throw new ParkingPassBookingError(
        409,
        "cancellation_in_progress",
        "A selected Parking Pass line already has a cancellation operation.",
        { operationId: overlap.id },
      );
    }
    const [createdOperation] = await tx
      .insert(parkingPassCancellationOperations)
      .values({
        purchaseId,
        requestId,
        idempotencyKey: requestFingerprint,
        bookingLineIds: lineIds,
        requestDigest,
        allocationDigest: authority.purchase.allocationDigest,
        actorSnapshot,
        policyFacts,
        actorType: authority.actorType,
        actorUserId: authority.actorUserId || null,
        reason,
        policyTrigger,
        remedy,
        amountCents:
          remedy === "cash_refund" ? cashRefundCents : restrictedCreditCents,
        expectedPaymentIntentId: authority.purchase.stripePaymentIntentId,
        expectedChargeId: authority.purchase.stripeChargeId,
        expectedCurrency: authority.purchase.currency,
        expectedCashRefundCents: cashRefundCents,
        expectedHostReversalCents: hostReversalCents,
        expectedApplicationFeeRefundCents: applicationFeeRefundCents,
        expectedDestinationAccountId:
          authority.purchase.stripeDestinationAccountId,
        status: remedy === "cash_refund" ? "pending" : "processing",
        createdAt: evaluatedAt,
        updatedAt: evaluatedAt,
      })
      .returning();
    if (!createdOperation) {
      throw new ParkingPassBookingError(
        409,
        "cancellation_in_progress",
        "A matching cancellation is already in progress.",
      );
    }
    if (remedy === "cash_refund" || remedy === "release") {
      const [providerOperation] = await tx
        .insert(parkingPassProviderOperations)
        .values({
          purchaseId,
          cancellationOperationId: createdOperation.id,
          operationKind:
            remedy === "release"
              ? "payment_intent_cancel"
              : "selected_line_refund",
          requestId,
          idempotencyKey: `parking-pass:${remedy}:${createdOperation.id}`,
          requestDigest,
          status: "prepared",
          policyTrigger,
          actorType: authority.actorType,
          actorUserId: authority.actorUserId || null,
          sortedLineIds: lineIds,
          allocationDigest: authority.purchase.allocationDigest,
          expectedPaymentIntentId: authority.purchase.stripePaymentIntentId,
          expectedChargeId: authority.purchase.stripeChargeId,
          expectedCurrency: authority.purchase.currency,
          expectedAmountCents: cashRefundCents,
          expectedHostAmountCents: hostReversalCents,
          expectedApplicationFeeCents: applicationFeeRefundCents,
          expectedDestinationAccountId:
            authority.purchase.stripeDestinationAccountId,
          idempotencyExpiresAt: providerIdempotencyDeadline(evaluatedAt),
          createdAt: evaluatedAt,
          updatedAt: evaluatedAt,
        })
        .returning();
      const stepSpecs =
        remedy === "release"
          ? [
              {
                stepType: "payment_intent_cancel",
                expectedAmountCents: 0,
                expectedApplicationFeeCents: 0,
              },
            ]
          : [
              {
                stepType: "cash_refund",
                expectedAmountCents: cashRefundCents,
                expectedApplicationFeeCents: 0,
              },
              {
                stepType: "transfer_reversal",
                expectedAmountCents: hostReversalCents,
                expectedApplicationFeeCents: 0,
              },
              ...(applicationFeeRefundCents > 0
                ? [
                    {
                      stepType: "application_fee_refund",
                      expectedAmountCents: applicationFeeRefundCents,
                      expectedApplicationFeeCents:
                        applicationFeeRefundCents,
                    },
                  ]
                : []),
            ];
      await tx.insert(parkingPassProviderOperationSteps).values(
        stepSpecs.map((step, index) => ({
          operationId: providerOperation.id,
          stepType: step.stepType,
          stepOrder: index + 1,
          status: "prepared",
          idempotencyKey: `parking-pass:${step.stepType}:${createdOperation.id}`,
          requestDigest,
          allocationDigest: authority.purchase.allocationDigest,
          policyTrigger,
          expectedPaymentIntentId: authority.purchase.stripePaymentIntentId,
          expectedChargeId: authority.purchase.stripeChargeId,
          expectedCurrency: authority.purchase.currency,
          expectedAmountCents: step.expectedAmountCents,
          expectedDestinationAccountId:
            authority.purchase.stripeDestinationAccountId,
          expectedApplicationFeeCents:
            step.expectedApplicationFeeCents,
          createdAt: evaluatedAt,
          updatedAt: evaluatedAt,
        })),
      );
    }
    return {
      operation: createdOperation,
      purchase: authority.purchase,
      lines: authority.lines,
      remedy,
      replay: false as const,
    };
  });
  const operation = operationResult.operation;
  const purchase = operationResult.purchase;
  const selectedLines = operationResult.lines;
  const lineIds = stableLineIds(
    selectedLines.map((line: LoadedCancellationLine) => line.booking.id),
  );
  const remedy = operationResult.remedy;
  if (
    operationResult.replay &&
    ["provider_confirmed", "credit_issued", "released", "no_remedy"].includes(
      operation.status,
    )
  ) {
    await wakeEventParticipationMutationsForBookings(
      lineIds,
      "cancellation_operation_terminal_replay",
    );
    return operation;
  }

  if (remedy === "release") {
    const capturedPolicyResult: CancellationOperation | undefined =
      await executePreCaptureRelease({
      purchase,
      operation,
      stripe,
      reason,
      actor: input.actor,
      });
    if (capturedPolicyResult) return capturedPolicyResult;
  } else if (remedy === "restricted_credit") {
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_credit:${purchase.purchaserUserId}`}))`,
      );
      const completedAt = new Date();
      for (const line of selectedLines) {
        await tx
          .insert(parkingPassCreditLedger)
          .values({
            userId: purchase.purchaserUserId,
            purchaseId: purchase.id,
            bookingId: line.booking.id,
            operationId: operation.id,
            amountCents:
              line.booking.totalCents + line.booking.creditAppliedCents,
            entryType: "cancellation_credit",
            state: "posted",
            idempotencyKey: `parking-pass:credit:${operation.id}:${line.booking.id}`,
            createdAt: completedAt,
            updatedAt: completedAt,
          })
          .onConflictDoNothing();
        await tx
          .update(eventBookings)
          .set({
            status: "cancelled",
            cancelledAt: completedAt,
            cancellationReason: reason,
            cancellationActorType: "truck_team",
            cancellationActorUserId: operation.actorUserId,
            cancellationPolicy: operation.policyTrigger,
            cancellationCreditIssuedCents:
              line.booking.totalCents + line.booking.creditAppliedCents,
            updatedAt: completedAt,
          })
          .where(eq(eventBookings.id, line.booking.id));
      }
      await tx
        .update(parkingPassPurchases)
        .set({
          cancellationCreditIssuedCents: sql`${parkingPassPurchases.cancellationCreditIssuedCents} + ${operation.amountCents}`,
          status:
            Number(
              (await tx
                .select({ count: sql<number>`count(*)` })
                .from(eventBookings)
                .where(
                  and(
                    eq(eventBookings.purchaseId, purchase.id),
                    inArray(eventBookings.status, ["pending", "confirmed"]),
                  ),
                ))[0]?.count || 0,
            ) === 0
              ? "cancelled"
              : "partially_cancelled",
          updatedAt: completedAt,
        })
        .where(eq(parkingPassPurchases.id, purchase.id));
      await tx
        .update(parkingPassCancellationOperations)
        .set({ status: "credit_issued", completedAt, updatedAt: completedAt })
        .where(eq(parkingPassCancellationOperations.id, operation.id));
    });
  } else if (remedy === "none") {
    const completedAt = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(eventBookings)
        .set({
          status: "cancelled",
          cancelledAt: completedAt,
          cancellationReason: reason,
          cancellationActorType: "truck_team",
          cancellationActorUserId: operation.actorUserId,
          cancellationPolicy: operation.policyTrigger,
          updatedAt: completedAt,
        })
        .where(inArray(eventBookings.id, lineIds));
      await tx
        .update(parkingPassPurchases)
        .set({
          status:
            Number(
              (await tx
                .select({ count: sql<number>`count(*)` })
                .from(eventBookings)
                .where(
                  and(
                    eq(eventBookings.purchaseId, purchase.id),
                    inArray(eventBookings.status, ["pending", "confirmed"]),
                  ),
                ))[0]?.count || 0,
            ) === 0
              ? "cancelled"
              : "partially_cancelled",
          updatedAt: completedAt,
        })
        .where(eq(parkingPassPurchases.id, purchase.id));
      await tx
        .update(parkingPassCancellationOperations)
        .set({ status: "no_remedy", completedAt, updatedAt: completedAt })
        .where(eq(parkingPassCancellationOperations.id, operation.id));
    });
  } else {
    await markCashRefundPending({ operation, lines: selectedLines, reason });
    await executeCashRefundSaga({
      purchase,
      operation,
      stripe,
    });
  }

  const [result] = await db
    .select()
    .from(parkingPassCancellationOperations)
    .where(eq(parkingPassCancellationOperations.id, operation.id))
    .limit(1);
  if (!result) {
    throw new ParkingPassBookingError(
      500,
      "cancellation_operation_missing",
      "The durable cancellation operation could not be reloaded.",
    );
  }
  await wakeEventParticipationMutationsForBookings(
    lineIds,
    `cancellation_operation_${result.status}`,
  );
  return result;
}

export type ExpireStaleParkingPassHoldsResult = {
  scanned: number;
  released: number;
  providerPending: number;
  actionRequired: number;
  operations: ReturnType<typeof serializeParkingPassCancellationOperation>[];
};

/**
 * Canonical stale-hold expiry. Purchase-backed holds only release capacity
 * after the durable provider cancellation operation proves cancelled or
 * never-created. Only rows that are positively free and provider-unbound may
 * take the direct compatibility path; ambiguous legacy paid rows fail closed.
 */
export async function expireStaleParkingPassHolds(input: {
  truckId: string;
  before: Date;
  stripe?: Stripe | null;
  limit?: number;
}): Promise<ExpireStaleParkingPassHoldsResult> {
  const truckId = clean(input.truckId);
  const before = input.before;
  const stripe = input.stripe === undefined ? configuredStripe : input.stripe;
  const limit = Math.max(1, Math.min(250, Math.trunc(input.limit || 100)));
  if (!truckId || !(before instanceof Date) || !Number.isFinite(before.getTime())) {
    throw new ParkingPassBookingError(
      400,
      "invalid_hold_expiry_request",
      "Truck and a valid stale-hold cutoff are required.",
    );
  }

  const staleRows: Array<{
    booking: typeof eventBookings.$inferSelect;
    event: typeof events.$inferSelect;
  }> = await db
    .select({ booking: eventBookings, event: events })
    .from(eventBookings)
    .innerJoin(events, eq(events.id, eventBookings.eventId))
    .where(
      and(
        eq(eventBookings.truckId, truckId),
        eq(eventBookings.status, "pending"),
        lt(eventBookings.createdAt, before),
      ),
    )
    .orderBy(asc(eventBookings.createdAt), asc(eventBookings.id))
    .limit(limit);

  const purchaseIds: string[] = Array.from(
    new Set<string>(
      staleRows.map((row) => clean(row.booking.purchaseId)).filter(Boolean),
    ),
  ).sort();
  const operations: ReturnType<
    typeof serializeParkingPassCancellationOperation
  >[] = [];
  let released = 0;
  let providerPending = 0;
  let actionRequired = 0;

  for (const purchaseId of purchaseIds) {
    try {
      const operation = await cancelParkingPassLines({
        purchaseId,
        requestId: `stale-hold-expiry:${purchaseId}`,
        reason: "Payment not completed before the checkout hold expired",
        actor: { userId: "", userType: "system", system: true },
        stripe,
      });
      operations.push(serializeParkingPassCancellationOperation(operation));
      const affected = Array.isArray(operation.bookingLineIds)
        ? operation.bookingLineIds.length
        : 0;
      if (operation.status === "released") released += affected;
      else if (operation.status === "failed_action_required") {
        actionRequired += affected;
      } else {
        providerPending += affected;
      }
    } catch (error) {
      const affected = staleRows.filter(
        (row) => clean(row.booking.purchaseId) === purchaseId,
      ).length;
      if (
        error instanceof ParkingPassBookingError &&
        ["cancellation_in_progress", "booking_line_closed"].includes(error.code)
      ) {
        providerPending += affected;
      } else {
        actionRequired += affected;
      }
    }
  }

  const legacyIds = staleRows
    .filter((row) => !clean(row.booking.purchaseId))
    .map((row) => row.booking.id)
    .sort();
  if (legacyIds.length) {
    const legacyResult = await db.transaction(async (tx: any) => {
      const lockedBookings: Array<typeof eventBookings.$inferSelect> = await tx
        .select()
        .from(eventBookings)
        .where(
          and(
            inArray(eventBookings.id, legacyIds),
            eq(eventBookings.truckId, truckId),
            eq(eventBookings.status, "pending"),
            isNull(eventBookings.purchaseId),
            lt(eventBookings.createdAt, before),
          ),
        )
        .orderBy(asc(eventBookings.id))
        .for("update");
      const eventIds = Array.from(
        new Set(lockedBookings.map((booking) => booking.eventId)),
      ).sort();
      const lockedEvents: Array<typeof events.$inferSelect> = eventIds.length
        ? await tx
            .select()
            .from(events)
            .where(inArray(events.id, eventIds))
            .orderBy(asc(events.id))
            .for("update")
        : [];
      const eventById = new Map(lockedEvents.map((event) => [event.id, event]));
      const directFreeIds = lockedBookings
        .filter((booking) => {
          const event = eventById.get(booking.eventId);
          return (
            event?.requiresPayment === false &&
            booking.stripePaymentIntentId === null &&
            booking.stripeTransferDestination === null &&
            booking.paidAt === null &&
            booking.settlementTopology === null &&
            booking.stripePaymentStatus === null
          );
        })
        .map((booking) => booking.id);
      const directSet = new Set(directFreeIds);
      const ambiguousIds = lockedBookings
        .filter((booking) => !directSet.has(booking.id))
        .map((booking) => booking.id);
      const now = new Date();
      if (directFreeIds.length) {
        await tx
          .update(eventBookings)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancellationReason: "Unpaid free-event hold expired",
            cancellationActorType: "system",
            cancellationPolicy: "proven_free_hold_expiry",
            participationVisibilityState: "suppressed",
            updatedAt: now,
          })
          .where(inArray(eventBookings.id, directFreeIds));
      }
      if (ambiguousIds.length) {
        await tx
          .update(eventBookings)
          .set({
            stripePaymentStatus: "action_required",
            cancellationReason:
              "Stale legacy paid hold requires provider reconciliation",
            participationVisibilityState: "action_required",
            updatedAt: now,
          })
          .where(inArray(eventBookings.id, ambiguousIds));
      }
      return {
        released: directFreeIds.length,
        actionRequired: ambiguousIds.length,
      };
    });
    released += legacyResult.released;
    actionRequired += legacyResult.actionRequired;
  }

  return {
    scanned: staleRows.length,
    released,
    providerPending,
    actionRequired,
    operations,
  };
}

async function markCancellationProviderActionRequired(input: {
  operationId: string;
  code: string;
  message: string;
}) {
  const now = new Date();
  await db.transaction(async (tx: any) => {
    const [cancellationOperation] = await tx
      .select()
      .from(parkingPassCancellationOperations)
      .where(eq(parkingPassCancellationOperations.id, input.operationId))
      .limit(1)
      .for("update");
    if (
      !cancellationOperation ||
      ["provider_confirmed", "credit_issued", "released", "no_remedy"].includes(
        cancellationOperation.status,
      )
    ) {
      return;
    }
    const [providerOperation] = await tx
      .select()
      .from(parkingPassProviderOperations)
      .where(
        eq(
          parkingPassProviderOperations.cancellationOperationId,
          input.operationId,
        ),
      )
      .limit(1)
      .for("update");
    if (providerOperation?.status === "provider_confirmed") return;
    await tx
      .update(parkingPassCancellationOperations)
      .set({
        status: "failed_action_required",
        providerStatus: "action_required",
        providerErrorCode: input.code,
        providerErrorMessage: input.message,
        actionRequiredAt: now,
        updatedAt: now,
      })
      .where(eq(parkingPassCancellationOperations.id, input.operationId));
    if (providerOperation) {
      await tx
        .update(parkingPassProviderOperations)
        .set({
          status: "action_required",
          providerErrorCode: input.code,
          providerErrorMessage: input.message,
          updatedAt: now,
        })
        .where(eq(parkingPassProviderOperations.id, providerOperation.id));
      await tx
        .update(parkingPassProviderOperationSteps)
        .set({
          status: "action_required",
          providerErrorCode: input.code,
          providerErrorMessage: input.message,
          updatedAt: now,
        })
        .where(
          and(
            eq(
              parkingPassProviderOperationSteps.operationId,
              providerOperation.id,
            ),
            sql`${parkingPassProviderOperationSteps.status} <> 'provider_confirmed'`,
          ),
        );
    }
  });
}

async function executePreCaptureRelease(input: {
  purchase: typeof parkingPassPurchases.$inferSelect;
  operation: typeof parkingPassCancellationOperations.$inferSelect;
  stripe: Stripe | null;
  reason: string;
  actor: CancellationActor;
}): Promise<CancellationOperation | undefined> {
  const [providerOperation] = await db
    .select()
    .from(parkingPassProviderOperations)
    .where(
      eq(
        parkingPassProviderOperations.cancellationOperationId,
        input.operation.id,
      ),
    )
    .limit(1);
  if (!providerOperation) {
    await markCancellationProviderActionRequired({
      operationId: input.operation.id,
      code: "legacy_payment_state_unbound",
      message:
        "Legacy PaymentIntent state is not bound to a durable cancellation operation.",
    });
    return;
  }

  let providerFinalState: "canceled" | "not_created" | null = null;
  let intent: Stripe.PaymentIntent | null = null;
  try {
    if (!input.purchase.stripePaymentIntentId) {
      const [createOperation] = await db
        .select()
        .from(parkingPassProviderOperations)
        .where(
          and(
            eq(
              parkingPassProviderOperations.purchaseId,
              input.purchase.id,
            ),
            eq(
              parkingPassProviderOperations.operationKind,
              "payment_intent_create",
            ),
          ),
        )
        .limit(1);
      const createDecision = decidePreCaptureProviderAction({
        paymentIntentId: null,
        providerConfigured: Boolean(input.stripe),
        createOperation: createOperation
          ? {
              status: createOperation.status,
              attemptCount: createOperation.attemptCount,
              providerPaymentIntentId:
                createOperation.providerPaymentIntentId,
            }
          : null,
      });
      if (createDecision.action === "release") {
        providerFinalState = createDecision.providerFinalState;
      } else {
        throw new ParkingPassBookingError(
          409,
          createDecision.action === "action_required"
            ? createDecision.code
            : "payment_create_ambiguous",
          "The checkout creation result is uncertain; capacity remains reserved for reconciliation.",
        );
      }
    } else {
      const availabilityDecision = decidePreCaptureProviderAction({
        paymentIntentId: input.purchase.stripePaymentIntentId,
        providerConfigured: Boolean(input.stripe),
      });
      const stripe = input.stripe;
      if (availabilityDecision.action === "action_required" || !stripe) {
        throw new ParkingPassBookingError(
          503,
          availabilityDecision.action === "action_required"
            ? availabilityDecision.code
            : "stripe_not_configured",
          "Provider cancellation could not be confirmed.",
        );
      }
      const submittedAt = new Date();
      await db.transaction(async (tx: any) => {
        await tx
          .update(parkingPassProviderOperations)
          .set({
            status: "submitted",
            attemptCount: sql`${parkingPassProviderOperations.attemptCount} + 1`,
            lastAttemptAt: submittedAt,
            updatedAt: submittedAt,
          })
          .where(eq(parkingPassProviderOperations.id, providerOperation.id));
        await tx
          .update(parkingPassProviderOperationSteps)
          .set({
            status: "submitted",
            attemptCount: sql`${parkingPassProviderOperationSteps.attemptCount} + 1`,
            submittedAt,
            updatedAt: submittedAt,
          })
          .where(
            and(
              eq(
                parkingPassProviderOperationSteps.operationId,
                providerOperation.id,
              ),
              eq(
                parkingPassProviderOperationSteps.stepType,
                "payment_intent_cancel",
              ),
            ),
          );
        await tx
          .update(parkingPassPurchases)
          .set({
            providerLifecycleState: "cancel_pending",
            updatedAt: submittedAt,
          })
          .where(eq(parkingPassPurchases.id, input.purchase.id));
      });
      intent = await stripe.paymentIntents.retrieve(
        input.purchase.stripePaymentIntentId,
      );
      if (
        intent.id !== providerOperation.expectedPaymentIntentId ||
        intent.amount !== input.purchase.chargedAmountCents ||
        clean(intent.currency) !== input.purchase.currency ||
        destinationFromIntent(intent) !==
          input.purchase.stripeDestinationAccountId ||
        Number(intent.application_fee_amount || 0) !==
          input.purchase.platformFeeCents ||
        clean(intent.metadata?.allocationDigest) !==
          input.purchase.allocationDigest
      ) {
        throw new ParkingPassBookingError(
          409,
          "provider_cancel_mismatch",
          "The provider checkout does not match this cancellation aggregate.",
        );
      }
      const retrievedDecision = decidePreCaptureProviderAction({
        paymentIntentId: input.purchase.stripePaymentIntentId,
        providerConfigured: true,
        providerIntentStatus: intent.status,
      });
      if (retrievedDecision.action === "captured_refund_policy") {
        const settlementIdentity = await retrieveDestinationSettlementIdentity(
          intent,
          stripe,
        );
        await bindCapturedSettlementForTechnicalRecovery({
          intent,
          settlementIdentity,
        });
        await db.transaction(async (tx: any) => {
          const now = new Date();
          await tx
            .update(parkingPassProviderOperationSteps)
            .set({
              status: "provider_confirmed",
              providerObjectId: intent!.id,
              providerPaymentIntentId: intent!.id,
              confirmedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(
                  parkingPassProviderOperationSteps.operationId,
                  providerOperation.id,
                ),
                eq(
                  parkingPassProviderOperationSteps.stepType,
                  "payment_intent_cancel",
                ),
              ),
            );
          await tx
            .update(parkingPassProviderOperations)
            .set({
              status: "provider_confirmed",
              providerStatus: "captured",
              providerPaymentIntentId: intent!.id,
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(parkingPassProviderOperations.id, providerOperation.id));
          await tx
            .update(parkingPassCancellationOperations)
            .set({
              status: "no_remedy",
              providerStatus: "captured",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(parkingPassCancellationOperations.id, input.operation.id));
        });
        return cancelParkingPassLines({
          purchaseId: input.purchase.id,
          requestId: `${input.operation.requestId}:captured`,
          reason: input.reason,
          actor: { ...input.actor, system: true },
          stripe,
          technicalNonService: true,
        });
      }
      if (retrievedDecision.action === "request_cancel") {
        intent = await stripe.paymentIntents.cancel(
          intent.id,
          {},
          { idempotencyKey: providerOperation.idempotencyKey },
        );
      }
      const finalDecision = decidePreCaptureProviderAction({
        paymentIntentId: input.purchase.stripePaymentIntentId,
        providerConfigured: true,
        providerIntentStatus: intent.status,
        afterCancelAttempt: true,
      });
      if (finalDecision.action === "action_required") {
        throw new ParkingPassBookingError(
          409,
          finalDecision.code,
          "The provider has not confirmed cancellation; capacity remains reserved.",
        );
      }
      if (finalDecision.action !== "release") {
        throw new ParkingPassBookingError(
          409,
          "provider_cancel_unconfirmed",
          "The provider cancellation result requires refund-policy recovery.",
        );
      }
      providerFinalState = finalDecision.providerFinalState;
    }
  } catch (error: any) {
    await markCancellationProviderActionRequired({
      operationId: input.operation.id,
      code:
        error instanceof ParkingPassBookingError
          ? error.code
          : clean(error?.code) || "provider_cancel_ambiguous",
      message:
        clean(error?.message) ||
        "Provider cancellation is uncertain; local capacity was not released.",
    });
    return;
  }

  if (!providerFinalState) return;
  await db.transaction(async (tx: any) => {
    const completedAt = new Date();
    const [lockedOperation] = await tx
      .select()
      .from(parkingPassCancellationOperations)
      .where(eq(parkingPassCancellationOperations.id, input.operation.id))
      .limit(1)
      .for("update");
    if (!lockedOperation || lockedOperation.status === "released") return;
    // Provider proof must exist before any purchased line transitions locally;
    // migration 142 intentionally rejects the older best-effort ordering.
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        status: "provider_confirmed",
        providerObjectId: intent?.id || `not_created:${input.purchase.id}`,
        providerPaymentIntentId: intent?.id || null,
        confirmedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(
            parkingPassProviderOperationSteps.operationId,
            providerOperation.id,
          ),
          eq(
            parkingPassProviderOperationSteps.stepType,
            "payment_intent_cancel",
          ),
        ),
      );
    await tx
      .update(parkingPassProviderOperations)
      .set({
        status: "provider_confirmed",
        providerStatus: providerFinalState,
        providerPaymentIntentId: intent?.id || null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(parkingPassProviderOperations.id, providerOperation.id));
    await tx
      .update(parkingPassCancellationOperations)
      .set({
        status: "released",
        providerStatus: providerFinalState,
        providerErrorCode: null,
        providerErrorMessage: null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(parkingPassCancellationOperations.id, input.operation.id));
    await tx
      .update(eventBookings)
      .set({
        status: "cancelled",
        stripePaymentStatus: "cancelled",
        cancelledAt: completedAt,
        cancellationReason: input.reason,
        cancellationActorType: input.operation.actorType,
        cancellationActorUserId: input.operation.actorUserId,
        cancellationPolicy: input.operation.policyTrigger,
        updatedAt: completedAt,
      })
      .where(
        inArray(eventBookings.id, input.operation.bookingLineIds as string[]),
      );
    await tx
      .update(parkingPassPurchases)
      .set({
        status: "cancelled",
        settlementStatus: "failed",
        providerLifecycleState: "closed",
        updatedAt: completedAt,
      })
      .where(eq(parkingPassPurchases.id, input.purchase.id));
    await tx
      .update(parkingPassCreditLedger)
      .set({ state: "released", updatedAt: completedAt })
      .where(
        and(
          eq(parkingPassCreditLedger.purchaseId, input.purchase.id),
          eq(parkingPassCreditLedger.state, "reserved"),
        ),
      );
  });
}

async function markCashRefundPending(input: {
  operation: typeof parkingPassCancellationOperations.$inferSelect;
  lines: LoadedCancellationLine[];
  reason: string;
}) {
  const now = new Date();
  await db.transaction(async (tx: any) => {
    const [lockedOperation] = await tx
      .select({ status: parkingPassCancellationOperations.status })
      .from(parkingPassCancellationOperations)
      .where(eq(parkingPassCancellationOperations.id, input.operation.id))
      .limit(1)
      .for("update");
    if (
      !lockedOperation ||
      ["provider_confirmed", "credit_issued", "released", "no_remedy"].includes(
        lockedOperation.status,
      )
    ) {
      return;
    }
    await tx
      .update(eventBookings)
      .set({
        refundStatus: "pending",
        participationVisibilityState: "suppressed",
        cancelledAt: now,
        cancellationReason: input.reason,
        cancellationActorType: input.operation.actorType,
        cancellationActorUserId: input.operation.actorUserId,
        cancellationPolicy: input.operation.policyTrigger,
        arrivalState:
          input.operation.policyTrigger === "arrival_acknowledgement_deadline"
            ? "operator_cancelled"
            : undefined,
        updatedAt: now,
      })
      .where(
        inArray(
          eventBookings.id,
          input.lines.map((line) => line.booking.id),
        ),
      );
    await tx
      .update(parkingPassCancellationOperations)
      .set({ status: "processing", updatedAt: now })
      .where(eq(parkingPassCancellationOperations.id, input.operation.id));
  });
}

async function waitForCashRefundConvergence(
  cancellationOperationId: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [current] = await db
      .select({ status: parkingPassCancellationOperations.status })
      .from(parkingPassCancellationOperations)
      .where(
        eq(parkingPassCancellationOperations.id, cancellationOperationId),
      )
      .limit(1);
    if (
      !current ||
      [
        "provider_confirmed",
        "failed_action_required",
        "credit_issued",
        "released",
        "no_remedy",
      ].includes(current.status)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const stripeObjectId = (value: unknown) =>
  typeof value === "string"
    ? value
    : clean((value as { id?: string } | null | undefined)?.id);

async function executeCashRefundSaga(input: {
  purchase: typeof parkingPassPurchases.$inferSelect;
  operation: typeof parkingPassCancellationOperations.$inferSelect;
  stripe: Stripe | null;
}) {
  if (!input.stripe) {
    await markCancellationProviderActionRequired({
      operationId: input.operation.id,
      code: "stripe_not_configured",
      message: "Stripe refund recovery is unavailable; no money state was finalized.",
    });
    return;
  }
  const [operation] = await db
    .select()
    .from(parkingPassCancellationOperations)
    .where(eq(parkingPassCancellationOperations.id, input.operation.id))
    .limit(1);
  if (!operation || operation.status === "provider_confirmed") return;
  const [providerOperation] = await db
    .select()
    .from(parkingPassProviderOperations)
    .where(
      eq(parkingPassProviderOperations.cancellationOperationId, operation.id),
    )
    .limit(1);
  if (!providerOperation) {
    await markCancellationProviderActionRequired({
      operationId: operation.id,
      code: "refund_provider_operation_missing",
      message:
        "The durable refund provider operation is missing; no money state was finalized.",
    });
    return;
  }
  const claimTime = new Date();
  const staleClaimBefore = new Date(claimTime.getTime() - 60_000);
  const [claimedOperation] = await db
    .update(parkingPassProviderOperations)
    .set({
      status: "processing",
      lastAttemptAt: claimTime,
      updatedAt: claimTime,
    })
    .where(
      and(
        eq(parkingPassProviderOperations.id, providerOperation.id),
        sql`(
          ${parkingPassProviderOperations.status} IN ('prepared', 'action_required', 'failed')
          OR (
            ${parkingPassProviderOperations.status} = 'processing'
            AND ${parkingPassProviderOperations.updatedAt} < ${staleClaimBefore}
          )
        )`,
      ),
    )
    .returning({ id: parkingPassProviderOperations.id });
  if (!claimedOperation) {
    await waitForCashRefundConvergence(operation.id);
    return;
  }
  const steps: Array<
    typeof parkingPassProviderOperationSteps.$inferSelect
  > = await db
    .select()
    .from(parkingPassProviderOperationSteps)
    .where(
      eq(parkingPassProviderOperationSteps.operationId, providerOperation.id),
    )
    .orderBy(asc(parkingPassProviderOperationSteps.stepOrder));
  const lineIds = stableLineIds(operation.bookingLineIds as string[]);
  const lines: Array<typeof eventBookings.$inferSelect> = await db
    .select()
    .from(eventBookings)
    .where(
      and(
        eq(eventBookings.purchaseId, operation.purchaseId),
        inArray(eventBookings.id, lineIds),
      ),
    )
    .orderBy(asc(eventBookings.id));
  const selectedFinancials = summarizeSelectedLineRemedy(
    lines.map((line) => ({
      id: line.id,
      hostPriceCents: Number(line.hostPriceCents || 0),
      platformFeeCents: Number(line.platformFeeCents || 0),
      creditAppliedCents: Number(line.creditAppliedCents || 0),
      totalCents: Number(line.totalCents || 0),
    })),
    "cash_refund",
  );
  const cashCents = selectedFinancials.cashRefundCents;
  const hostCents = selectedFinancials.hostTransferReversalCents;
  const feeCents = selectedFinancials.applicationFeeRefundCents;
  if (
    lines.length !== lineIds.length ||
    lines.some(
      (line: typeof eventBookings.$inferSelect) =>
        line.allocationDigest !== input.purchase.allocationDigest ||
        line.hostId !== input.purchase.hostId ||
        line.truckId !== input.purchase.truckId,
    ) ||
    operation.requestDigest !== providerOperation.requestDigest ||
    operation.allocationDigest !== input.purchase.allocationDigest ||
    providerOperation.allocationDigest !== input.purchase.allocationDigest ||
    providerOperation.expectedPaymentIntentId !==
      input.purchase.stripePaymentIntentId ||
    providerOperation.expectedChargeId !== input.purchase.stripeChargeId ||
    providerOperation.expectedCurrency !== input.purchase.currency ||
    providerOperation.expectedDestinationAccountId !==
      input.purchase.stripeDestinationAccountId ||
    providerOperation.expectedAmountCents !== cashCents ||
    providerOperation.expectedHostAmountCents !== hostCents ||
    providerOperation.expectedApplicationFeeCents !== feeCents ||
    operation.expectedCashRefundCents !== cashCents ||
    operation.expectedHostReversalCents !== hostCents ||
    operation.expectedApplicationFeeRefundCents !== feeCents ||
    !input.purchase.stripePaymentIntentId ||
    !input.purchase.stripeChargeId ||
    !input.purchase.stripeTransferId ||
    (feeCents > 0 && !input.purchase.stripeApplicationFeeId)
  ) {
    await markCancellationProviderActionRequired({
      operationId: operation.id,
      code: "refund_financial_identity_mismatch",
      message:
        "Refund, charge, destination, fee, or selected-line identity does not match the durable operation.",
    });
    return;
  }
  const stepByType = new Map<
    string,
    typeof parkingPassProviderOperationSteps.$inferSelect
  >(steps.map((step) => [step.stepType, step]));
  const lineDigest = stableDigest(lineIds);
  const metadata = {
    parkingPassPurchaseId: input.purchase.id,
    parkingPassOperationId: operation.id,
    providerOperationId: providerOperation.id,
    requestDigest: operation.requestDigest,
    allocationDigest: operation.allocationDigest,
    sortedLineDigest: lineDigest,
    policyTrigger: operation.policyTrigger,
  };
  const markSubmitted = async (
    step: typeof parkingPassProviderOperationSteps.$inferSelect,
  ) => {
    const now = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(parkingPassProviderOperations)
        .set({
          status: "processing",
          attemptCount: sql`${parkingPassProviderOperations.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(parkingPassProviderOperations.id, providerOperation.id));
      await tx
        .update(parkingPassProviderOperationSteps)
        .set({
          status: "submitted",
          attemptCount: sql`${parkingPassProviderOperationSteps.attemptCount} + 1`,
          submittedAt: now,
          providerErrorCode: null,
          providerErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(parkingPassProviderOperationSteps.id, step.id));
      await tx
        .update(eventBookings)
        .set({ refundStatus: "processing", updatedAt: now })
        .where(inArray(eventBookings.id, lineIds));
    });
  };
  const ensureWithinProviderRetention = () => {
    if (providerOperation.idempotencyExpiresAt.getTime() <= Date.now()) {
      throw new ParkingPassBookingError(
        409,
        "provider_operation_ambiguous",
        "A provider step cannot be recreated after idempotency retention; staff reconciliation is required.",
      );
    }
  };
  try {
    const charge = await input.stripe.charges.retrieve(
      input.purchase.stripeChargeId,
    );
    if (
      charge.id !== input.purchase.stripeChargeId ||
      stripeObjectId(charge.payment_intent) !==
        input.purchase.stripePaymentIntentId ||
      charge.amount !== input.purchase.chargedAmountCents ||
      clean(charge.currency) !== input.purchase.currency ||
      stripeObjectId(charge.transfer) !== input.purchase.stripeTransferId ||
      stripeObjectId(charge.application_fee) !==
        clean(input.purchase.stripeApplicationFeeId)
    ) {
      throw new ParkingPassBookingError(
        409,
        "refund_charge_mismatch",
        "Stripe charge identity does not match the stored purchase.",
      );
    }
    const transfer = await input.stripe.transfers.retrieve(
      input.purchase.stripeTransferId,
    );
    if (
      transfer.amount !== input.purchase.hostAmountCents ||
      clean(transfer.currency) !== input.purchase.currency ||
      stripeObjectId(transfer.destination) !==
        input.purchase.stripeDestinationAccountId
    ) {
      throw new ParkingPassBookingError(
        409,
        "refund_transfer_mismatch",
        "Stripe destination transfer identity does not match the purchase.",
      );
    }
    if (input.purchase.stripeApplicationFeeId) {
      const applicationFee = await input.stripe.applicationFees.retrieve(
        input.purchase.stripeApplicationFeeId,
      );
      if (
        applicationFee.amount !== input.purchase.platformFeeCents ||
        clean(applicationFee.currency) !== input.purchase.currency ||
        stripeObjectId(applicationFee.charge) !== input.purchase.stripeChargeId
      ) {
        throw new ParkingPassBookingError(
          409,
          "refund_application_fee_mismatch",
          "Stripe application-fee identity does not match the purchase.",
        );
      }
    }

    const cashStep = stepByType.get("cash_refund");
    if (!cashStep) throw new Error("Cash refund provider step is missing.");
    let refund: Stripe.Refund | null = cashStep.providerRefundId
      ? await input.stripe.refunds.retrieve(cashStep.providerRefundId)
      : null;
    if (!refund && cashStep.status !== "prepared") {
      const matches = await input.stripe.refunds.list({
        charge: input.purchase.stripeChargeId,
        limit: 100,
      });
      const exact = matches.data.filter(
        (candidate) =>
          clean(candidate.metadata?.providerStepId) === cashStep.id,
      );
      if (exact.length > 1) {
        throw new ParkingPassBookingError(
          409,
          "refund_provider_ambiguous",
          "Multiple Stripe refunds match one durable step.",
        );
      }
      refund = exact[0] || null;
    }
    if (!refund) {
      ensureWithinProviderRetention();
      await markSubmitted(cashStep);
      refund = await input.stripe.refunds.create(
        {
          charge: input.purchase.stripeChargeId,
          amount: cashStep.expectedAmountCents,
          metadata: { ...metadata, providerStepId: cashStep.id },
        },
        { idempotencyKey: cashStep.idempotencyKey },
      );
    }
    if (
      refund.amount !== cashStep.expectedAmountCents ||
      clean(refund.currency) !== cashStep.expectedCurrency ||
      stripeObjectId(refund.charge) !== cashStep.expectedChargeId ||
      stripeObjectId(refund.payment_intent) !==
        cashStep.expectedPaymentIntentId ||
      clean(refund.metadata?.providerStepId) !== cashStep.id ||
      clean(refund.metadata?.requestDigest) !== cashStep.requestDigest ||
      clean(refund.metadata?.allocationDigest) !== cashStep.allocationDigest ||
      clean(refund.metadata?.sortedLineDigest) !== lineDigest ||
      clean(refund.metadata?.policyTrigger) !== clean(cashStep.policyTrigger)
    ) {
      throw new ParkingPassBookingError(
        409,
        "refund_provider_mismatch",
        "Stripe refund identity does not match the selected-line operation.",
      );
    }
    await db.transaction(async (tx: any) => {
      await tx
        .update(parkingPassCancellationOperations)
        .set({
          stripeRefundId: refund!.id,
          providerStatus: clean(refund!.status) || "pending",
          updatedAt: new Date(),
        })
        .where(eq(parkingPassCancellationOperations.id, operation.id));
      await tx
        .update(parkingPassProviderOperationSteps)
        .set({
          status:
            refund!.status === "succeeded" ? "provider_confirmed" : "submitted",
          providerObjectId: refund!.id,
          providerRefundId: refund!.id,
          providerChargeId: input.purchase.stripeChargeId,
          providerPaymentIntentId: input.purchase.stripePaymentIntentId,
          confirmedAt: refund!.status === "succeeded" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(parkingPassProviderOperationSteps.id, cashStep.id));
    });
    if (refund.status !== "succeeded") {
      if (["failed", "canceled"].includes(clean(refund.status))) {
        throw new ParkingPassBookingError(
          409,
          clean(refund.failure_reason) || "refund_failed",
          "Stripe did not confirm the cash refund.",
        );
      }
      return;
    }

    const reversalStep = stepByType.get("transfer_reversal");
    if (!reversalStep) throw new Error("Transfer reversal provider step is missing.");
    let reversal: Stripe.TransferReversal | null =
      reversalStep.providerTransferReversalId
        ? await input.stripe.transfers.retrieveReversal(
            input.purchase.stripeTransferId,
            reversalStep.providerTransferReversalId,
          )
        : null;
    if (!reversal && reversalStep.status !== "prepared") {
      const matches = await input.stripe.transfers.listReversals(
        input.purchase.stripeTransferId,
        { limit: 100 },
      );
      const exact = matches.data.filter(
        (candidate) =>
          clean(candidate.metadata?.providerStepId) === reversalStep.id,
      );
      if (exact.length > 1) {
        throw new ParkingPassBookingError(
          409,
          "transfer_reversal_ambiguous",
          "Multiple transfer reversals match one durable step.",
        );
      }
      reversal = exact[0] || null;
    }
    if (!reversal) {
      ensureWithinProviderRetention();
      await markSubmitted(reversalStep);
      reversal = await input.stripe.transfers.createReversal(
        input.purchase.stripeTransferId,
        {
          amount: reversalStep.expectedAmountCents,
          metadata: { ...metadata, providerStepId: reversalStep.id },
        },
        { idempotencyKey: reversalStep.idempotencyKey },
      );
    }
    if (
      reversal.amount !== reversalStep.expectedAmountCents ||
      clean(reversal.currency) !== reversalStep.expectedCurrency ||
      stripeObjectId(reversal.transfer) !== input.purchase.stripeTransferId ||
      clean(reversal.metadata?.providerStepId) !== reversalStep.id ||
      clean(reversal.metadata?.requestDigest) !== reversalStep.requestDigest ||
      clean(reversal.metadata?.allocationDigest) !==
        reversalStep.allocationDigest ||
      clean(reversal.metadata?.sortedLineDigest) !== lineDigest ||
      clean(reversal.metadata?.policyTrigger) !==
        clean(reversalStep.policyTrigger)
    ) {
      throw new ParkingPassBookingError(
        409,
        "transfer_reversal_mismatch",
        "Stripe transfer reversal does not match the selected host allocation.",
      );
    }
    await db
      .update(parkingPassProviderOperationSteps)
      .set({
        status: "provider_confirmed",
        providerObjectId: reversal.id,
        providerTransferId: input.purchase.stripeTransferId,
        providerTransferReversalId: reversal.id,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(parkingPassProviderOperationSteps.id, reversalStep.id));

    let applicationFeeRefundId: string | null = null;
    const feeStep = stepByType.get("application_fee_refund");
    if (feeStep) {
      let feeRefund: Stripe.FeeRefund | null =
        feeStep.providerApplicationFeeRefundId
          ? await input.stripe.applicationFees.retrieveRefund(
              input.purchase.stripeApplicationFeeId!,
              feeStep.providerApplicationFeeRefundId,
            )
          : null;
      if (!feeRefund && feeStep.status !== "prepared") {
        const matches = await input.stripe.applicationFees.listRefunds(
          input.purchase.stripeApplicationFeeId!,
          { limit: 100 },
        );
        const exact = matches.data.filter(
          (candidate) =>
            clean(candidate.metadata?.providerStepId) === feeStep.id,
        );
        if (exact.length > 1) {
          throw new ParkingPassBookingError(
            409,
            "application_fee_refund_ambiguous",
            "Multiple application-fee refunds match one durable step.",
          );
        }
        feeRefund = exact[0] || null;
      }
      if (!feeRefund) {
        ensureWithinProviderRetention();
        await markSubmitted(feeStep);
        feeRefund = await input.stripe.applicationFees.createRefund(
          input.purchase.stripeApplicationFeeId!,
          {
            amount: feeStep.expectedAmountCents,
            metadata: { ...metadata, providerStepId: feeStep.id },
          },
          { idempotencyKey: feeStep.idempotencyKey },
        );
      }
      if (
        feeRefund.amount !== feeStep.expectedAmountCents ||
        clean(feeRefund.currency) !== feeStep.expectedCurrency ||
        stripeObjectId(feeRefund.fee) !==
          input.purchase.stripeApplicationFeeId ||
        clean(feeRefund.metadata?.providerStepId) !== feeStep.id ||
        clean(feeRefund.metadata?.requestDigest) !== feeStep.requestDigest ||
        clean(feeRefund.metadata?.allocationDigest) !==
          feeStep.allocationDigest ||
        clean(feeRefund.metadata?.sortedLineDigest) !== lineDigest ||
        clean(feeRefund.metadata?.policyTrigger) !== clean(feeStep.policyTrigger)
      ) {
        throw new ParkingPassBookingError(
          409,
          "application_fee_refund_mismatch",
          "Stripe application-fee refund does not match the selected platform allocation.",
        );
      }
      applicationFeeRefundId = feeRefund.id;
      await db
        .update(parkingPassProviderOperationSteps)
        .set({
          status: "provider_confirmed",
          providerObjectId: feeRefund.id,
          providerApplicationFeeId: input.purchase.stripeApplicationFeeId,
          providerApplicationFeeRefundId: feeRefund.id,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(parkingPassProviderOperationSteps.id, feeStep.id));
    }

    await db.transaction(async (tx: any) => {
      const [lockedOperation] = await tx
        .select()
        .from(parkingPassCancellationOperations)
        .where(eq(parkingPassCancellationOperations.id, operation.id))
        .limit(1)
        .for("update");
      if (!lockedOperation || lockedOperation.status === "provider_confirmed") {
        return;
      }
      const confirmedSteps: Array<
        typeof parkingPassProviderOperationSteps.$inferSelect
      > = await tx
        .select()
        .from(parkingPassProviderOperationSteps)
        .where(
          eq(parkingPassProviderOperationSteps.operationId, providerOperation.id),
        )
        .orderBy(asc(parkingPassProviderOperationSteps.stepOrder))
        .for("update");
      const finalStepByType = new Map(
        confirmedSteps.map((step) => [step.stepType, step]),
      );
      const finalCashStep = finalStepByType.get("cash_refund");
      const finalReversalStep = finalStepByType.get("transfer_reversal");
      const finalFeeStep = finalStepByType.get("application_fee_refund");
      if (
        confirmedSteps.length !== (feeCents > 0 ? 3 : 2) ||
        confirmedSteps.some((step) => step.status !== "provider_confirmed") ||
        !finalCashStep ||
        finalCashStep.providerRefundId !== refund!.id ||
        finalCashStep.providerChargeId !== input.purchase.stripeChargeId ||
        finalCashStep.providerPaymentIntentId !==
          input.purchase.stripePaymentIntentId ||
        finalCashStep.expectedAmountCents !== cashCents ||
        finalCashStep.expectedCurrency !== input.purchase.currency ||
        finalCashStep.requestDigest !== operation.requestDigest ||
        finalCashStep.allocationDigest !== operation.allocationDigest ||
        !finalReversalStep ||
        finalReversalStep.providerTransferId !==
          input.purchase.stripeTransferId ||
        finalReversalStep.providerTransferReversalId !== reversal.id ||
        finalReversalStep.expectedAmountCents !== hostCents ||
        finalReversalStep.expectedCurrency !== input.purchase.currency ||
        finalReversalStep.requestDigest !== operation.requestDigest ||
        finalReversalStep.allocationDigest !== operation.allocationDigest ||
        (feeCents > 0 &&
          (!finalFeeStep ||
            finalFeeStep.providerApplicationFeeId !==
              input.purchase.stripeApplicationFeeId ||
            finalFeeStep.providerApplicationFeeRefundId !==
              applicationFeeRefundId ||
            finalFeeStep.expectedAmountCents !== feeCents ||
            finalFeeStep.expectedCurrency !== input.purchase.currency ||
            finalFeeStep.requestDigest !== operation.requestDigest ||
            finalFeeStep.allocationDigest !== operation.allocationDigest))
      ) {
        throw new Error(
          "Provider money steps are not all confirmed against the exact stored financial identity.",
        );
      }
      const [lockedPurchase] = await tx
        .select()
        .from(parkingPassPurchases)
        .where(eq(parkingPassPurchases.id, input.purchase.id))
        .limit(1)
        .for("update");
      const lockedLines = await tx
        .select()
        .from(eventBookings)
        .where(inArray(eventBookings.id, lineIds))
        .orderBy(asc(eventBookings.id))
        .for("update");
      if (!lockedPurchase || lockedLines.length !== lineIds.length) {
        throw new Error("Refund aggregate disappeared before finalization.");
      }
      const completedAt = new Date();
      await tx
        .update(parkingPassProviderOperations)
        .set({
          status: "provider_confirmed",
          providerPaymentIntentId: lockedPurchase.stripePaymentIntentId,
          providerChargeId: lockedPurchase.stripeChargeId,
          providerTransferId: lockedPurchase.stripeTransferId,
          providerApplicationFeeId: lockedPurchase.stripeApplicationFeeId,
          providerStatus: "provider_confirmed",
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(parkingPassProviderOperations.id, providerOperation.id));
      await tx
        .update(parkingPassCancellationOperations)
        .set({
          status: "provider_confirmed",
          stripeRefundId: refund!.id,
          providerStatus: "provider_confirmed",
          providerErrorCode: null,
          providerErrorMessage: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(parkingPassCancellationOperations.id, lockedOperation.id));
      for (const line of lockedLines) {
        if (line.creditAppliedCents > 0) {
          await tx
            .insert(parkingPassCreditLedger)
            .values({
              userId: lockedPurchase.purchaserUserId,
              purchaseId: lockedPurchase.id,
              bookingId: line.id,
              operationId: lockedOperation.id,
              amountCents: line.creditAppliedCents,
              entryType: "non_service_credit_restoration",
              state: "posted",
              idempotencyKey: `parking-pass:non-service-credit:${lockedOperation.id}:${line.id}`,
              createdAt: completedAt,
              updatedAt: completedAt,
            })
            .onConflictDoNothing();
        }
        await tx
          .update(eventBookings)
          .set({
            status: "refunded",
            refundStatus: "refunded",
            refundAmountCents: line.totalCents,
            cashRefundedCents: line.totalCents,
            hostTransferReversedCents: line.hostPriceCents,
            applicationFeeRefundedCents: line.platformFeeCents,
            restoredCreditCents: line.creditAppliedCents,
            settlementState: "provider_confirmed",
            participationVisibilityState: "suppressed",
            refundedAt: completedAt,
            refundReason: lockedOperation.policyTrigger,
            updatedAt: completedAt,
          })
          .where(eq(eventBookings.id, line.id));
      }
      const nextRefunded = Math.min(
        lockedPurchase.chargedAmountCents,
        lockedPurchase.refundedAmountCents +
          lockedOperation.expectedCashRefundCents,
      );
      const fullyRefunded = nextRefunded >= lockedPurchase.chargedAmountCents;
      await tx
        .update(parkingPassPurchases)
        .set({
          refundedAmountCents: nextRefunded,
          status: fullyRefunded ? "refunded" : "partially_refunded",
          settlementStatus: fullyRefunded ? "reversed" : "partially_reversed",
          updatedAt: completedAt,
        })
        .where(eq(parkingPassPurchases.id, lockedPurchase.id));
    });
    void applicationFeeRefundId;
  } catch (error: any) {
    await markCancellationProviderActionRequired({
      operationId: operation.id,
      code:
        error instanceof ParkingPassBookingError
          ? error.code
          : clean(error?.code) || "refund_saga_action_required",
      message:
        clean(error?.message) ||
        "The exact refund/reversal saga requires provider reconciliation.",
    });
  }
}

export async function reconcileParkingPassRefund(refund: Stripe.Refund) {
  const operationId = clean(refund.metadata?.parkingPassOperationId);
  if (!operationId) return { handled: false as const };
  const [row] = await db
    .select({
      operation: parkingPassCancellationOperations,
      purchase: parkingPassPurchases,
      providerOperation: parkingPassProviderOperations,
    })
    .from(parkingPassCancellationOperations)
    .innerJoin(
      parkingPassPurchases,
      eq(
        parkingPassPurchases.id,
        parkingPassCancellationOperations.purchaseId,
      ),
    )
    .innerJoin(
      parkingPassProviderOperations,
      eq(
        parkingPassProviderOperations.cancellationOperationId,
        parkingPassCancellationOperations.id,
      ),
    )
    .where(eq(parkingPassCancellationOperations.id, operationId))
    .limit(1);
  if (!row) {
    throw new ParkingPassBookingError(
      404,
      "refund_operation_not_found",
      "Stripe refund metadata references an unknown Parking Pass operation.",
    );
  }
  const [cashStep] = await db
    .select()
    .from(parkingPassProviderOperationSteps)
    .where(
      and(
        eq(
          parkingPassProviderOperationSteps.operationId,
          row.providerOperation.id,
        ),
        eq(parkingPassProviderOperationSteps.stepType, "cash_refund"),
      ),
    )
    .limit(1);
  const lineIds = stableLineIds(row.operation.bookingLineIds as string[]);
  const refundIdentity = cashStep
    ? validateRefundWebhookIdentity(
        {
          operationId: row.operation.id,
          providerOperationId: row.providerOperation.id,
          providerStepId: cashStep.id,
          purchaseId: row.purchase.id,
          requestDigest: row.operation.requestDigest,
          allocationDigest: row.operation.allocationDigest,
          sortedLineDigest: stableDigest(lineIds),
          policyTrigger: row.operation.policyTrigger,
          paymentIntentId: clean(row.purchase.stripePaymentIntentId),
          chargeId: clean(row.purchase.stripeChargeId),
          currency: row.purchase.currency,
          amountCents: cashStep.expectedAmountCents,
        },
        {
          operationId: clean(refund.metadata?.parkingPassOperationId),
          providerOperationId: clean(
            refund.metadata?.providerOperationId,
          ),
          providerStepId: clean(refund.metadata?.providerStepId),
          purchaseId: clean(refund.metadata?.parkingPassPurchaseId),
          requestDigest: clean(refund.metadata?.requestDigest),
          allocationDigest: clean(refund.metadata?.allocationDigest),
          sortedLineDigest: clean(refund.metadata?.sortedLineDigest),
          policyTrigger: clean(refund.metadata?.policyTrigger),
          paymentIntentId: stripeObjectId(refund.payment_intent),
          chargeId: stripeObjectId(refund.charge),
          currency: clean(refund.currency),
          amountCents: refund.amount,
        },
      )
    : null;
  if (
    !cashStep ||
    row.providerOperation.operationKind !== "selected_line_refund" ||
    cashStep.expectedPaymentIntentId !==
      row.purchase.stripePaymentIntentId ||
    cashStep.expectedChargeId !== row.purchase.stripeChargeId ||
    cashStep.expectedCurrency !== row.purchase.currency ||
    cashStep.requestDigest !== row.operation.requestDigest ||
    cashStep.allocationDigest !== row.operation.allocationDigest ||
    clean(cashStep.policyTrigger) !== row.operation.policyTrigger ||
    !refundIdentity?.valid ||
    (cashStep.providerRefundId && cashStep.providerRefundId !== refund.id) ||
    (row.operation.stripeRefundId &&
      row.operation.stripeRefundId !== refund.id)
  ) {
    throw new ParkingPassBookingError(
      409,
      "refund_webhook_mismatch",
      "Stripe refund webhook identity does not match the durable selected-line operation.",
    );
  }
  const now = new Date();
  await db.transaction(async (tx: any) => {
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        status:
          refund.status === "succeeded"
            ? "provider_confirmed"
            : ["failed", "canceled"].includes(clean(refund.status))
              ? "action_required"
              : "submitted",
        providerObjectId: refund.id,
        providerRefundId: refund.id,
        providerChargeId: row.purchase.stripeChargeId,
        providerPaymentIntentId: row.purchase.stripePaymentIntentId,
        confirmedAt: refund.status === "succeeded" ? now : null,
        providerErrorCode: ["failed", "canceled"].includes(
          clean(refund.status),
        )
          ? clean(refund.failure_reason) || clean(refund.status)
          : null,
        updatedAt: now,
      })
      .where(eq(parkingPassProviderOperationSteps.id, cashStep.id));
    await tx
      .update(parkingPassCancellationOperations)
      .set({
        stripeRefundId: refund.id,
        providerStatus: clean(refund.status) || "pending",
        status: ["failed", "canceled"].includes(clean(refund.status))
          ? "failed_action_required"
          : "processing",
        actionRequiredAt: ["failed", "canceled"].includes(
          clean(refund.status),
        )
          ? now
          : null,
        updatedAt: now,
      })
      .where(eq(parkingPassCancellationOperations.id, operationId));
  });
  if (refund.status === "succeeded") {
    await executeCashRefundSaga({
      purchase: row.purchase,
      operation: row.operation,
      stripe: configuredStripe,
    });
  }
  return { handled: true as const, status: refund.status };
}

/** Retry provider-side refund reconciliation without creating a second refund. */
export async function reconcilePendingParkingPassRefunds(input?: {
  limit?: number;
  stripe?: Stripe | null;
}) {
  const rows = await db
    .select({
      operation: parkingPassCancellationOperations,
      purchase: parkingPassPurchases,
    })
    .from(parkingPassCancellationOperations)
    .innerJoin(
      parkingPassPurchases,
      eq(
        parkingPassPurchases.id,
        parkingPassCancellationOperations.purchaseId,
      ),
    )
    .where(
      and(
        eq(parkingPassCancellationOperations.remedy, "cash_refund"),
        inArray(parkingPassCancellationOperations.status, [
          "pending",
          "processing",
          "failed_action_required",
        ]),
      ),
    )
    .orderBy(asc(parkingPassCancellationOperations.updatedAt))
    .limit(Math.max(1, Math.min(50, Number(input?.limit || 20))));
  let succeeded = 0;
  let pending = 0;
  let failed = 0;
  for (const row of rows) {
    await executeCashRefundSaga({
      purchase: row.purchase,
      operation: row.operation,
      stripe: input?.stripe === undefined ? configuredStripe : input.stripe,
    });
    const [current] = await db
      .select({ status: parkingPassCancellationOperations.status })
      .from(parkingPassCancellationOperations)
      .where(eq(parkingPassCancellationOperations.id, row.operation.id))
      .limit(1);
    if (current?.status === "provider_confirmed") succeeded += 1;
    else if (current?.status === "failed_action_required") failed += 1;
    else pending += 1;
    await wakeEventParticipationMutationForCancellation(
      row.operation.id,
      `refund_reconciliation_${current?.status || "missing"}`,
    );
  }
  return { examined: rows.length, succeeded, pending, failed };
}

async function refundTechnicalNonService(input: {
  purchaseId: string;
  requestId: string;
  reason: string;
  stripe: Stripe | null;
}) {
  return cancelParkingPassLines({
    purchaseId: input.purchaseId,
    requestId: input.requestId,
    reason: input.reason,
    actor: { userId: "", system: true },
    stripe: input.stripe,
    technicalNonService: true,
  });
}

type ArrivalCorrectionPatch = {
  address?: string;
  city?: string | null;
  stateCode?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  startAt?: Date;
  endAt?: Date;
  accessInstructions?: string | null;
  safetyInstructions?: string | null;
};

async function authorizedProtectedArrival(
  bookingId: string,
  actor: CancellationActor,
  database: any = db,
  lock = false,
) {
  let query: any = database
    .select({
      booking: eventBookings,
      event: events,
      hostOwnerId: hosts.userId,
      truckOwnerId: restaurants.ownerId,
      purchaseStatus: parkingPassPurchases.status,
      purchaseSettlementStatus: parkingPassPurchases.settlementStatus,
    })
    .from(eventBookings)
    .innerJoin(events, eq(events.id, eventBookings.eventId))
    .innerJoin(hosts, eq(hosts.id, eventBookings.hostId))
    .innerJoin(restaurants, eq(restaurants.id, eventBookings.truckId))
    .leftJoin(
      parkingPassPurchases,
      eq(parkingPassPurchases.id, eventBookings.purchaseId),
    )
    .where(eq(eventBookings.id, bookingId))
    .limit(1);
  // PostgreSQL cannot apply an unqualified FOR UPDATE to the nullable side of
  // the purchase LEFT JOIN. Lock the booking here, then re-read and lock every
  // mutable authority row below so the returned decision is current.
  if (lock) query = query.for("update", { of: eventBookings });
  const [row] = await query;
  if (!row) {
    throw new ParkingPassBookingError(
      404,
      "booking_not_found",
      "Parking Pass booking was not found.",
    );
  }
  if (lock) {
    const [lockedEvent] = await database
      .select()
      .from(events)
      .where(eq(events.id, row.booking.eventId))
      .limit(1)
      .for("update");
    const [lockedHost] = await database
      .select({ userId: hosts.userId })
      .from(hosts)
      .where(eq(hosts.id, row.booking.hostId))
      .limit(1)
      .for("update");
    const [lockedTruck] = await database
      .select({ ownerId: restaurants.ownerId })
      .from(restaurants)
      .where(eq(restaurants.id, row.booking.truckId))
      .limit(1)
      .for("update");
    const [lockedPurchase] = row.booking.purchaseId
      ? await database
          .select({
            status: parkingPassPurchases.status,
            settlementStatus: parkingPassPurchases.settlementStatus,
          })
          .from(parkingPassPurchases)
          .where(eq(parkingPassPurchases.id, row.booking.purchaseId))
          .limit(1)
          .for("update")
      : [];
    if (!lockedEvent || !lockedHost || !lockedTruck) {
      throw new ParkingPassBookingError(
        409,
        "arrival_authority_changed",
        "Protected arrival authority changed while it was being resolved.",
      );
    }
    row.event = lockedEvent;
    row.hostOwnerId = lockedHost.userId;
    row.truckOwnerId = lockedTruck.ownerId;
    row.purchaseStatus = lockedPurchase?.status || null;
    row.purchaseSettlementStatus = lockedPurchase?.settlementStatus || null;
  }
  const userId = clean(actor.userId);
  let systemMutationRecovery = false;
  if (
    lock &&
    actor.system === true &&
    clean(actor.eventMutationId) &&
    clean(actor.eventMutationChildId)
  ) {
    const [parent] = await database
      .select({
        id: eventParticipationMutations.id,
        status: eventParticipationMutations.status,
      })
      .from(eventParticipationMutations)
      .where(eq(eventParticipationMutations.id, clean(actor.eventMutationId)))
      .limit(1)
      .for("update");
    const [child] = await database
      .select({
        id: eventParticipationMutationChildren.id,
        mutationId: eventParticipationMutationChildren.mutationId,
        bookingId: eventParticipationMutationChildren.bookingId,
        childKind: eventParticipationMutationChildren.childKind,
      })
      .from(eventParticipationMutationChildren)
      .where(
        eq(
          eventParticipationMutationChildren.id,
          clean(actor.eventMutationChildId),
        ),
      )
      .limit(1)
      .for("update");
    systemMutationRecovery = Boolean(
      parent &&
        !["converged", "failed"].includes(parent.status) &&
        child?.mutationId === parent.id &&
        child.bookingId === row.booking.id &&
        child.childKind === "arrival_correct" &&
        clean(row.booking.activeEventMutationId) === parent.id &&
        clean(row.event.activeParticipationMutationId) === parent.id,
    );
  }
  const [membership] = userId
    ? await database
        .select({
          status: businessStaffMemberships.status,
          permissions: businessStaffMemberships.permissions,
        })
        .from(businessStaffMemberships)
        .where(
          and(
            eq(businessStaffMemberships.restaurantId, row.booking.truckId),
            eq(businessStaffMemberships.userId, userId),
          ),
        )
        .limit(1)
        .for(lock ? "update" : "share")
    : [];
  const [currentActor] = userId
    ? await database
        .select({ userType: users.userType, isDisabled: users.isDisabled })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for(lock ? "update" : "share")
    : [];
  const [series] = row.event.seriesId
    ? await database
        .select({ coordinatorUserId: eventSeries.coordinatorUserId })
        .from(eventSeries)
        .where(eq(eventSeries.id, row.event.seriesId))
        .limit(1)
        .for(lock ? "update" : "share")
    : [];
  const actorActive = currentActor?.isDisabled === false;
  const truckTeam =
    actorActive &&
    (row.truckOwnerId === userId ||
      (membership?.status === "active" &&
        hasManageParkingPassPermission(membership.permissions)));
  const hostOwner = actorActive && row.hostOwnerId === userId;
  const coordinator =
    actorActive &&
    canCoordinateEvent({
      actorUserId: userId,
      eventType: row.event.eventType,
      eventCoordinatorUserId: row.event.coordinatorUserId,
      seriesCoordinatorUserId: series?.coordinatorUserId,
    });
  const staff = actorActive && isStaff(currentActor?.userType);
  if (
    !systemMutationRecovery &&
    !truckTeam &&
    !hostOwner &&
    !coordinator &&
    !staff
  ) {
    throw new ParkingPassBookingError(
      403,
      "arrival_forbidden",
      "Protected arrival details are limited to the booked parties and staff.",
    );
  }
  return {
    ...row,
    truckTeam,
    hostOwner,
    coordinator,
    staff,
    systemMutationRecovery,
  };
}

export async function getProtectedParkingPassArrival(
  bookingId: string,
  actor: CancellationActor,
) {
  const authority = await authorizedProtectedArrival(clean(bookingId), actor);
  const paidArrivalReady = isSettledPaidParticipation({
    bookingStatus: authority.booking.status,
    purchaseStatus: authority.purchaseStatus,
    settlementStatus: authority.purchaseSettlementStatus,
  });
  if (!paidArrivalReady) {
    return {
      bookingId: authority.booking.id,
      arrivalState: "withheld_until_settled",
      current: null,
      proposed: null,
      history: [],
      canCorrect: false,
      canAcknowledge: false,
      available: false,
      availabilityReason:
        "Exact arrival details remain withheld until paid participation is confirmed and settled.",
    };
  }
  const versions = await db
    .select()
    .from(parkingPassArrivalVersions)
    .where(eq(parkingPassArrivalVersions.bookingId, authority.booking.id))
    .orderBy(asc(parkingPassArrivalVersions.version));
  return {
    bookingId: authority.booking.id,
    arrivalState: authority.booking.arrivalState,
    current:
      versions.find(
        (version: typeof parkingPassArrivalVersions.$inferSelect) =>
          version.id === authority.booking.currentArrivalVersionId,
      ) ||
      null,
    proposed:
      versions.find(
        (version: typeof parkingPassArrivalVersions.$inferSelect) =>
          version.id === authority.booking.pendingArrivalVersionId,
      ) ||
      null,
    history: versions.filter(
      (version: typeof parkingPassArrivalVersions.$inferSelect) =>
        version.id !== authority.booking.currentArrivalVersionId &&
        version.id !== authority.booking.pendingArrivalVersionId,
    ),
    canCorrect: authority.hostOwner || authority.coordinator || authority.staff,
    canAcknowledge: authority.truckTeam,
    available: true,
    availabilityReason: null,
  };
}

export async function correctProtectedParkingPassArrival(input: {
  bookingId: string;
  actor: CancellationActor;
  idempotencyKey: string;
  reason: string;
  patch: ArrivalCorrectionPatch;
}) {
  const reason = clean(input.reason);
  const idempotencyKey = clean(input.idempotencyKey);
  if (reason.length < 10) {
    throw new ParkingPassBookingError(
      400,
      "arrival_reason_required",
      "Explain the arrival correction in at least 10 characters.",
    );
  }
  if (idempotencyKey.length < 8) {
    throw new ParkingPassBookingError(
      400,
      "arrival_idempotency_required",
      "A stable arrival correction request ID is required.",
    );
  }

  const correction = await db.transaction(async (tx: any) => {
    const authority = await authorizedProtectedArrival(
      clean(input.bookingId),
      input.actor,
      tx,
      true,
    );
    if (
      !authority.systemMutationRecovery &&
      !authority.hostOwner &&
      !authority.coordinator &&
      !authority.staff
    ) {
      throw new ParkingPassBookingError(
        403,
        "arrival_correction_forbidden",
        "Only the current host owner, explicit non-Parking-Pass coordinator, or staff may correct arrival facts.",
      );
    }
    const booking = authority.booking;
    if (
      !isSettledPaidParticipation({
        bookingStatus: booking.status,
        purchaseStatus: authority.purchaseStatus,
        settlementStatus: authority.purchaseSettlementStatus,
      })
    ) {
      throw new ParkingPassBookingError(
        409,
        "arrival_withheld_until_settled",
        "Exact arrival corrections begin only after paid participation is confirmed and settled.",
      );
    }
    if (booking.arrivalState === "arrival_change_pending") {
      const [existing] = await tx
        .select()
        .from(parkingPassArrivalVersions)
        .where(
          and(
            eq(parkingPassArrivalVersions.bookingId, booking.id),
            eq(
              parkingPassArrivalVersions.correctionIdempotencyKey,
              idempotencyKey,
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        const replayDigest = stableDigest({
          version: "parking-pass-arrival-correction-v1",
          bookingId: booking.id,
          supersedesVersionId: existing.supersedesVersionId,
          actorType: existing.actorType,
          actorUserId: existing.actorUserId,
          reason,
          proposed: {
            address:
              input.patch.address === undefined
                ? existing.address
                : clean(input.patch.address),
            city:
              input.patch.city === undefined
                ? existing.city
                : clean(input.patch.city) || null,
            stateCode:
              input.patch.stateCode === undefined
                ? existing.stateCode
                : clean(input.patch.stateCode) || null,
            latitude:
              input.patch.latitude === undefined
                ? existing.latitude
                : input.patch.latitude === null
                  ? null
                  : String(input.patch.latitude),
            longitude:
              input.patch.longitude === undefined
                ? existing.longitude
                : input.patch.longitude === null
                  ? null
                  : String(input.patch.longitude),
            startAt:
              (input.patch.startAt || existing.startAt).toISOString(),
            endAt: (input.patch.endAt || existing.endAt).toISOString(),
            accessInstructions:
              input.patch.accessInstructions === undefined
                ? existing.accessInstructions
                : clean(input.patch.accessInstructions) || null,
            safetyInstructions:
              input.patch.safetyInstructions === undefined
                ? existing.safetyInstructions
                : clean(input.patch.safetyInstructions) || null,
          },
        });
        if (replayDigest !== existing.correctionRequestDigest) {
          throw new ParkingPassBookingError(
            409,
            "arrival_correction_idempotency_mismatch",
            "That correction request ID is bound to different arrival facts.",
          );
        }
        return { version: existing, authority, replay: true };
      }
      throw new ParkingPassBookingError(
        409,
        "arrival_change_already_pending",
        "Resolve the current arrival change before proposing another.",
      );
    }
    const [current] = await tx
      .select()
      .from(parkingPassArrivalVersions)
      .where(eq(parkingPassArrivalVersions.id, booking.currentArrivalVersionId!))
      .limit(1)
      .for("update");
    if (!current || current.bookingId !== booking.id) {
      throw new Error("Current protected arrival version is missing or foreign.");
    }

    const proposed = {
      address: input.patch.address === undefined ? current.address : clean(input.patch.address),
      city: input.patch.city === undefined ? current.city : clean(input.patch.city) || null,
      stateCode:
        input.patch.stateCode === undefined
          ? current.stateCode
          : clean(input.patch.stateCode) || null,
      latitude:
        input.patch.latitude === undefined
          ? current.latitude
          : input.patch.latitude === null
            ? null
            : String(input.patch.latitude),
      longitude:
        input.patch.longitude === undefined
          ? current.longitude
          : input.patch.longitude === null
            ? null
            : String(input.patch.longitude),
      startAt: input.patch.startAt || current.startAt,
      endAt: input.patch.endAt || current.endAt,
      accessInstructions:
        input.patch.accessInstructions === undefined
          ? current.accessInstructions
          : clean(input.patch.accessInstructions) || null,
      safetyInstructions:
        input.patch.safetyInstructions === undefined
          ? current.safetyInstructions
          : clean(input.patch.safetyInstructions) || null,
    };
    if (!proposed.address || proposed.endAt <= proposed.startAt) {
      throw new ParkingPassBookingError(
        400,
        "invalid_arrival_correction",
        "Arrival address and a valid future time window are required.",
      );
    }
    const changed =
      proposed.address !== current.address ||
      proposed.city !== current.city ||
      proposed.stateCode !== current.stateCode ||
      String(proposed.latitude || "") !== String(current.latitude || "") ||
      String(proposed.longitude || "") !== String(current.longitude || "") ||
      proposed.startAt.getTime() !== current.startAt.getTime() ||
      proposed.endAt.getTime() !== current.endAt.getTime() ||
      proposed.accessInstructions !== current.accessInstructions ||
      proposed.safetyInstructions !== current.safetyInstructions;
    if (!changed) {
      throw new ParkingPassBookingError(
        400,
        "arrival_correction_empty",
        "The proposed arrival version does not change any booked fact.",
      );
    }
    const earlierStart = new Date(
      Math.min(current.startAt.getTime(), proposed.startAt.getTime()),
    );
    const acknowledgementDeadlineAt = new Date(
      earlierStart.getTime() - 15 * 60 * 1000,
    );
    if (acknowledgementDeadlineAt.getTime() <= Date.now()) {
      throw new ParkingPassBookingError(
        409,
        "arrival_correction_too_late",
        "This material correction is too late for a safe acknowledgment window.",
      );
    }
    const actorType = authority.systemMutationRecovery
      ? "system"
      : authority.staff
        ? "admin"
        : authority.coordinator
          ? "coordinator"
          : "host";
    const actorUserId = authority.systemMutationRecovery
      ? null
      : clean(input.actor.userId);
    const correctionRequestDigest = stableDigest({
      version: "parking-pass-arrival-correction-v1",
      bookingId: booking.id,
      supersedesVersionId: current.id,
      actorType,
      actorUserId,
      reason,
      proposed: {
        ...proposed,
        startAt: proposed.startAt.toISOString(),
        endAt: proposed.endAt.toISOString(),
      },
    });
    const [version] = await tx
      .insert(parkingPassArrivalVersions)
      .values({
        bookingId: booking.id,
        version: current.version + 1,
        supersedesVersionId: current.id,
        correctionIdempotencyKey: idempotencyKey,
        correctionRequestDigest,
        state: "proposed",
        ...proposed,
        actorType,
        actorUserId,
        reason,
        effectiveAt: new Date(),
        isMaterial: true,
        notificationState: "pending",
        acknowledgementDeadlineAt,
        createdAt: new Date(),
      })
      .returning();
    await tx
      .update(eventBookings)
      .set({
        arrivalState: "arrival_change_pending",
        pendingArrivalVersionId: version.id,
        updatedAt: new Date(),
      })
      .where(eq(eventBookings.id, booking.id));
    return { version, authority, replay: false };
  });
  const { version, authority } = correction;
  if (correction.replay) return version;
  let notificationState = "failed";
  try {
    const [truckOwner] = await db
      .select({ email: users.email, truckName: restaurants.name })
      .from(restaurants)
      .innerJoin(users, eq(users.id, restaurants.ownerId))
      .where(eq(restaurants.id, authority.booking.truckId))
      .limit(1);
    if (truckOwner?.email) {
      const baseUrl = String(
        process.env.PUBLIC_BASE_URL || "https://www.mealscout.us",
      ).replace(/\/+$/, "");
      const subject = `Arrival change needs acknowledgment for ${truckOwner.truckName || "your truck"}`;
      const text = [
        "A material Parking Pass arrival fact changed.",
        `Address: ${version.address}`,
        `Window: ${version.startAt.toISOString()} - ${version.endAt.toISOString()}`,
        `Reason: ${version.reason}`,
        `Acknowledge before: ${version.acknowledgementDeadlineAt?.toISOString() || "the displayed deadline"}`,
        `Review: ${baseUrl}/parking-pass?setup=schedule`,
      ].join("\n");
      const sent = await emailService.sendBasicEmail(
        truckOwner.email,
        subject,
        `<h2>Parking Pass arrival change</h2>
         <p>A material booked arrival fact changed and public stop, map, and pickup eligibility is paused until your truck team acknowledges it.</p>
         <p><strong>Address:</strong> ${escapeHtml(version.address)}</p>
         <p><strong>Window:</strong> ${escapeHtml(version.startAt.toISOString())} - ${escapeHtml(version.endAt.toISOString())}</p>
         <p><strong>Reason:</strong> ${escapeHtml(version.reason)}</p>
         <p><strong>Acknowledge before:</strong> ${escapeHtml(version.acknowledgementDeadlineAt?.toISOString())}</p>
         <p><a href="${escapeHtml(`${baseUrl}/parking-pass?setup=schedule`)}">Review protected arrival change</a></p>`,
        text,
        "account",
      );
      notificationState = sent ? "sent" : "failed";
    }
  } catch (error) {
    console.warn("[parking-pass-arrival] notification failed", {
      bookingId: authority.booking.id,
      versionId: version.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await db
    .update(parkingPassArrivalVersions)
    .set({ notificationState })
    .where(eq(parkingPassArrivalVersions.id, version.id));
  return { ...version, notificationState };
}

export async function acknowledgeProtectedParkingPassArrival(input: {
  bookingId: string;
  versionId: string;
  actor: CancellationActor;
  idempotencyKey: string;
}) {
  const idempotencyKey = clean(input.idempotencyKey);
  if (idempotencyKey.length < 8) {
    throw new ParkingPassBookingError(
      400,
      "arrival_idempotency_required",
      "A stable arrival acknowledgment request ID is required.",
    );
  }
  return db.transaction(async (tx: any) => {
    const authority = await authorizedProtectedArrival(
      clean(input.bookingId),
      input.actor,
      tx,
      true,
    );
    if (!authority.truckTeam) {
      throw new ParkingPassBookingError(
        403,
        "arrival_acknowledgement_forbidden",
        "Only the current truck owner or active team member with Parking Pass permission may acknowledge this change.",
      );
    }
    const booking = authority.booking;
    if (
      !isSettledPaidParticipation({
        bookingStatus: booking.status,
        purchaseStatus: authority.purchaseStatus,
        settlementStatus: authority.purchaseSettlementStatus,
      })
    ) {
      throw new ParkingPassBookingError(
        409,
        "arrival_withheld_until_settled",
        "Exact arrival acknowledgement begins only after paid participation is confirmed and settled.",
      );
    }
    const versionId = clean(input.versionId);
    const acknowledgementRequestDigest = stableDigest({
      version: "parking-pass-arrival-ack-v1",
      bookingId: booking.id,
      versionId,
      actorType: "truck_team",
      actorUserId: clean(input.actor.userId),
    });
    if (
      booking.arrivalState === "acknowledged" &&
      booking.currentArrivalVersionId === versionId
    ) {
      const [existing] = await tx
        .select()
        .from(parkingPassArrivalVersions)
        .where(
          and(
            eq(parkingPassArrivalVersions.id, versionId),
            eq(parkingPassArrivalVersions.bookingId, booking.id),
          ),
        )
        .limit(1)
        .for("update");
      if (
        existing?.acknowledgementIdempotencyKey === idempotencyKey &&
        existing.acknowledgementRequestDigest ===
          acknowledgementRequestDigest &&
        existing.acknowledgedByUserId === clean(input.actor.userId)
      ) {
        return existing;
      }
      throw new ParkingPassBookingError(
        409,
        "arrival_acknowledgement_idempotency_mismatch",
        "That acknowledgment request does not match the completed version.",
      );
    }
    if (
      booking.arrivalState !== "arrival_change_pending" ||
      booking.pendingArrivalVersionId !== versionId
    ) {
      throw new ParkingPassBookingError(
        409,
        "stale_arrival_acknowledgement",
        "This arrival version is no longer awaiting acknowledgment.",
      );
    }
    const [proposed] = await tx
      .select()
      .from(parkingPassArrivalVersions)
      .where(
        and(
          eq(
            parkingPassArrivalVersions.id,
            booking.pendingArrivalVersionId!,
          ),
          eq(parkingPassArrivalVersions.bookingId, booking.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!proposed) throw new Error("Proposed arrival version is missing.");
    if (
      proposed.acknowledgementDeadlineAt &&
      proposed.acknowledgementDeadlineAt.getTime() <= Date.now()
    ) {
      throw new ParkingPassBookingError(
        409,
        "arrival_acknowledgement_expired",
        "The acknowledgment deadline passed; cancellation and refund recovery is required.",
      );
    }
    const acknowledgedAt = new Date();
    if (booking.currentArrivalVersionId) {
      await tx
        .update(parkingPassArrivalVersions)
        .set({ state: "historical" })
        .where(eq(parkingPassArrivalVersions.id, booking.currentArrivalVersionId));
    }
    const [acknowledged] = await tx
      .update(parkingPassArrivalVersions)
      .set({
        state: "current",
        acknowledgementIdempotencyKey: idempotencyKey,
        acknowledgementRequestDigest,
        acknowledgedByUserId: clean(input.actor.userId),
        acknowledgedAt,
      })
      .where(eq(parkingPassArrivalVersions.id, proposed.id))
      .returning();
    await tx
      .update(eventBookings)
      .set({
        arrivalState: "acknowledged",
        currentArrivalVersionId: proposed.id,
        pendingArrivalVersionId: null,
        updatedAt: acknowledgedAt,
      })
      .where(eq(eventBookings.id, booking.id));
    await wakeEventParticipationMutationsForBookings(
      [booking.id],
      "arrival_acknowledged",
      tx,
    );
    return acknowledged;
  });
}

export async function reconcileExpiredParkingPassArrivalChanges(input?: {
  limit?: number;
  stripe?: Stripe | null;
}) {
  const now = new Date();
  const rows = await db
    .select({ version: parkingPassArrivalVersions, booking: eventBookings })
    .from(parkingPassArrivalVersions)
    .innerJoin(
      eventBookings,
      eq(eventBookings.pendingArrivalVersionId, parkingPassArrivalVersions.id),
    )
    .where(
      and(
        eq(parkingPassArrivalVersions.state, "proposed"),
        sql`${parkingPassArrivalVersions.acknowledgementDeadlineAt} <= ${now}`,
      ),
    )
    .orderBy(asc(parkingPassArrivalVersions.acknowledgementDeadlineAt))
    .limit(Math.max(1, Math.min(100, Number(input?.limit || 25))));
  let cancelled = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.booking.purchaseId) continue;
    try {
      const operation = await cancelParkingPassLines({
        purchaseId: row.booking.purchaseId,
        bookingLineIds: [row.booking.id],
        requestId: `arrival-deadline:${row.version.id}`,
        reason: "Material arrival change was not acknowledged before the safe deadline.",
        actor: { userId: "", system: true },
        stripe: input?.stripe === undefined ? configuredStripe : input.stripe,
      });
      await wakeEventParticipationMutationsForBookings(
        [row.booking.id],
        `arrival_deadline_${operation?.status || "unknown"}`,
      );
      if (operation?.status === "provider_confirmed") {
        await db
          .update(parkingPassArrivalVersions)
          .set({ state: "cancelled" })
          .where(eq(parkingPassArrivalVersions.id, row.version.id));
        cancelled += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("[parking-pass-arrival] deadline recovery failed", {
        bookingId: row.booking.id,
        versionId: row.version.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { examined: rows.length, cancelled, failed };
}

export async function markParkingPassPurchaseDisputed(
  dispute: Stripe.Dispute,
  stripeClient: Stripe | null = configuredStripe,
) {
  const paymentIntentId = stripeObjectId(dispute.payment_intent);
  const chargeId = stripeObjectId(dispute.charge);
  if (!paymentIntentId || !chargeId || !stripeClient) {
    throw new ParkingPassBookingError(
      503,
      "dispute_identity_unavailable",
      "The authoritative dispute, charge, and PaymentIntent identity are required.",
    );
  }
  const charge = await stripeClient.charges.retrieve(chargeId);
  if (
    charge.id !== chargeId ||
    stripeObjectId(charge.payment_intent) !== paymentIntentId ||
    clean(charge.currency) !== clean(dispute.currency)
  ) {
    throw new ParkingPassBookingError(
      409,
      "dispute_charge_mismatch",
      "Stripe dispute and charge identities do not converge.",
    );
  }
  return db.transaction(async (tx: any) => {
    const [purchase] = await tx
      .select()
      .from(parkingPassPurchases)
      .where(eq(parkingPassPurchases.stripePaymentIntentId, paymentIntentId))
      .limit(1)
      .for("update");
    if (!purchase) return { handled: false, purchaseId: null };
    const lines = await tx
      .select()
      .from(eventBookings)
      .where(eq(eventBookings.purchaseId, purchase.id))
      .orderBy(asc(eventBookings.id))
      .for("update");
    if (
      purchase.stripeChargeId !== chargeId ||
      purchase.currency !== clean(dispute.currency) ||
      charge.amount !== purchase.chargedAmountCents ||
      (purchase.stripeTransferId !== null &&
        stripeObjectId(charge.transfer) !== purchase.stripeTransferId) ||
      (purchase.stripeApplicationFeeId !== null &&
        stripeObjectId(charge.application_fee) !==
          purchase.stripeApplicationFeeId) ||
      dispute.amount <= 0 ||
      dispute.amount > purchase.chargedAmountCents ||
      lines.length !== purchase.allocationLineCount ||
      lines.some(
        (line: typeof eventBookings.$inferSelect) =>
          line.allocationDigest !== purchase.allocationDigest,
      )
    ) {
      throw new ParkingPassBookingError(
        409,
        "dispute_purchase_mismatch",
        "Stripe dispute amount, currency, charge, or allocation does not match the purchase.",
      );
    }
    const requestDigest = stableDigest({
      version: "parking-pass-dispute-v1",
      disputeId: dispute.id,
      purchaseId: purchase.id,
      paymentIntentId,
      chargeId,
      currency: clean(dispute.currency),
      amountCents: dispute.amount,
      allocationDigest: purchase.allocationDigest,
      sortedLineIds: stableLineIds(lines.map((line: any) => line.id)),
    });
    let [providerOperation] = await tx
      .select()
      .from(parkingPassProviderOperations)
      .where(eq(parkingPassProviderOperations.providerDisputeId, dispute.id))
      .limit(1)
      .for("update");
    if (!providerOperation) {
      [providerOperation] = await tx
        .insert(parkingPassProviderOperations)
        .values({
          purchaseId: purchase.id,
          operationKind: "dispute_reconcile",
          requestId: dispute.id,
          idempotencyKey: `parking-pass:dispute:${dispute.id}`,
          requestDigest,
          status: "prepared",
          actorType: "provider_webhook",
          sortedLineIds: stableLineIds(lines.map((line: any) => line.id)),
          allocationDigest: purchase.allocationDigest,
          expectedPaymentIntentId: paymentIntentId,
          expectedChargeId: chargeId,
          expectedCurrency: purchase.currency,
          expectedAmountCents: dispute.amount,
          expectedHostAmountCents: 0,
          expectedApplicationFeeCents: 0,
          expectedDestinationAccountId:
            purchase.stripeDestinationAccountId,
          providerPaymentIntentId: paymentIntentId,
          providerChargeId: chargeId,
          providerDisputeId: dispute.id,
          idempotencyExpiresAt: providerIdempotencyDeadline(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      await tx.insert(parkingPassProviderOperationSteps).values({
        operationId: providerOperation.id,
        stepType: "dispute_reconcile",
        stepOrder: 1,
        status: "prepared",
        idempotencyKey: `parking-pass:dispute:${dispute.id}:reconcile`,
        requestDigest,
        allocationDigest: purchase.allocationDigest,
        expectedPaymentIntentId: paymentIntentId,
        expectedChargeId: chargeId,
        expectedCurrency: purchase.currency,
        expectedAmountCents: dispute.amount,
        expectedDestinationAccountId:
          purchase.stripeDestinationAccountId,
        expectedApplicationFeeCents: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else if (
      providerOperation.purchaseId !== purchase.id ||
      providerOperation.requestDigest !== requestDigest ||
      providerOperation.expectedPaymentIntentId !== paymentIntentId ||
      providerOperation.expectedChargeId !== chargeId ||
      providerOperation.expectedCurrency !== purchase.currency ||
      providerOperation.expectedAmountCents !== dispute.amount ||
      providerOperation.expectedDestinationAccountId !==
        purchase.stripeDestinationAccountId ||
      providerOperation.providerPaymentIntentId !== paymentIntentId ||
      providerOperation.providerChargeId !== chargeId ||
      providerOperation.providerDisputeId !== dispute.id ||
      providerOperation.allocationDigest !== purchase.allocationDigest
    ) {
      throw new ParkingPassBookingError(
        409,
        "dispute_replay_mismatch",
        "A dispute replay changed its stored financial identity.",
      );
    }
    const convergence = resolveDisputeConvergence({
      providerStatus: dispute.status,
      chargedAmountCents: purchase.chargedAmountCents,
      refundedAmountCents: purchase.refundedAmountCents,
      lineStates: lines.map((line: typeof eventBookings.$inferSelect) => ({
        status: line.status,
        cashRefundedCents: line.cashRefundedCents,
        hostTransferReversedCents: line.hostTransferReversedCents,
        applicationFeeRefundedCents: line.applicationFeeRefundedCents,
        cancellationCreditIssuedCents: line.cancellationCreditIssuedCents,
        restoredCreditCents: line.restoredCreditCents,
        cancellationPolicy: line.cancellationPolicy,
      })),
    });
    const won = convergence.outcome === "won";
    const lost = convergence.outcome === "lost";
    const disputeState = convergence.disputeState;
    const purchaseStatus = convergence.purchaseStatus;
    const settlementStatus = convergence.settlementStatus;
    const now = new Date();
    const [providerStep] = await tx
      .select()
      .from(parkingPassProviderOperationSteps)
      .where(
        and(
          eq(
            parkingPassProviderOperationSteps.operationId,
            providerOperation.id,
          ),
          eq(
            parkingPassProviderOperationSteps.stepType,
            "dispute_reconcile",
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !providerStep ||
      providerStep.requestDigest !== requestDigest ||
      providerStep.allocationDigest !== purchase.allocationDigest ||
      providerStep.expectedPaymentIntentId !== paymentIntentId ||
      providerStep.expectedChargeId !== chargeId ||
      providerStep.expectedCurrency !== purchase.currency ||
      providerStep.expectedAmountCents !== dispute.amount ||
      providerStep.expectedDestinationAccountId !==
        purchase.stripeDestinationAccountId ||
      (providerStep.providerDisputeId !== null &&
        providerStep.providerDisputeId !== dispute.id)
    ) {
      throw new ParkingPassBookingError(
        409,
        "dispute_step_replay_mismatch",
        "The durable dispute step no longer matches the provider event identity.",
      );
    }
    // The provider event is authoritative proof. Bind it before any purchased
    // line settlement transition so the database guard can reject old/direct
    // writers while this transaction remains atomic.
    await tx
      .update(parkingPassProviderOperationSteps)
      .set({
        status: "provider_confirmed",
        providerObjectId: dispute.id,
        providerPaymentIntentId: paymentIntentId,
        providerChargeId: chargeId,
        providerDisputeId: dispute.id,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(parkingPassProviderOperationSteps.id, providerStep.id));
    await tx
      .update(parkingPassProviderOperations)
      .set({
        status: "provider_confirmed",
        providerPaymentIntentId: paymentIntentId,
        providerChargeId: chargeId,
        providerDisputeId: dispute.id,
        providerStatus: dispute.status,
        completedAt: won || lost ? now : null,
        updatedAt: now,
      })
      .where(eq(parkingPassProviderOperations.id, providerOperation.id));
    await tx
      .update(parkingPassPurchases)
      .set({
        status: purchaseStatus,
        settlementStatus,
        disputeState,
        stripeDisputeId: dispute.id,
        disputeOutcome: convergence.outcome,
        updatedAt: now,
      })
      .where(eq(parkingPassPurchases.id, purchase.id));
    for (const line of lines) {
      const hasProviderConfirmedLineRemedy =
        line.status === "refunded" ||
        Number(line.cashRefundedCents || 0) > 0 ||
        Number(line.hostTransferReversedCents || 0) > 0 ||
        Number(line.applicationFeeRefundedCents || 0) > 0;
      await tx
        .update(eventBookings)
        .set({
          settlementState: hasProviderConfirmedLineRemedy
            ? "provider_confirmed"
            : convergence.lineSettlementState,
          updatedAt: now,
        })
        .where(eq(eventBookings.id, line.id));
    }
    return {
      handled: true,
      purchaseId: purchase.id,
      disputeState,
      outcome: convergence.outcome,
    };
  });
}
