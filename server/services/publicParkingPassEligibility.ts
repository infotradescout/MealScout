import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  eventBookings,
  events,
  parkingPassPurchases,
} from "@shared/schema";

export type PublicPaidParticipationEligibility = {
  eventStatus?: unknown;
  eventType?: unknown;
  eventParticipationSuppressedAt?: unknown;
  seriesId?: unknown;
  seriesStatus?: unknown;
  seriesType?: unknown;
  seriesParticipationSuppressedAt?: unknown;
  purchaseId?: unknown;
  purchaseStatus?: unknown;
  purchaseSettlementStatus?: unknown;
  settlementTopology?: unknown;
  bookingStatus?: unknown;
  arrivalState?: unknown;
  publicLocationConsentSnapshot?: unknown;
  addressVisible?: unknown;
  eventActiveMutationId?: unknown;
  seriesActiveMutationId?: unknown;
  bookingActiveMutationId?: unknown;
  participationVisibilityState?: unknown;
  eventParticipationVersion?: unknown;
  bookingParticipationVersion?: unknown;
  currentArrivalVersionId?: unknown;
  currentArrivalVersionState?: unknown;
  currentArrivalAcknowledgedAt?: unknown;
};

const normalizeStatus = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();

/**
 * Public stop/map/order/pickup truth for every paid event participation. Event
 * type is intentionally irrelevant: all requiresPayment=true rows must use the
 * destination-safe purchase, current version, acknowledgment, and consent
 * primitive. Free events are handled by their caller's explicit free branch.
 */
export function isPublicPaidParticipationEligible(
  input: PublicPaidParticipationEligibility,
) {
  const seriesId = String(input.seriesId || "").trim();
  const eventIsParkingPass = normalizeStatus(input.eventType) === "parking_pass";
  const seriesIsParkingPass =
    normalizeStatus(input.seriesType) === "parking_pass";
  return (
    normalizeStatus(input.eventStatus) === "open" &&
    !input.eventParticipationSuppressedAt &&
    (!seriesId ||
      (normalizeStatus(input.seriesStatus) === "published" &&
        !input.seriesParticipationSuppressedAt &&
        eventIsParkingPass === seriesIsParkingPass)) &&
    Boolean(String(input.purchaseId || "").trim()) &&
    normalizeStatus(input.bookingStatus) === "confirmed" &&
    ["confirmed", "partially_cancelled", "partially_refunded"].includes(
      normalizeStatus(input.purchaseStatus),
    ) &&
    ["transferred_to_connect", "partially_reversed"].includes(
      normalizeStatus(input.purchaseSettlementStatus),
    ) &&
    normalizeStatus(input.settlementTopology) === "destination_charge" &&
    normalizeStatus(input.arrivalState) === "acknowledged" &&
    input.publicLocationConsentSnapshot === true &&
    input.addressVisible === true &&
    !String(input.eventActiveMutationId || "").trim() &&
    !String(input.seriesActiveMutationId || "").trim() &&
    !String(input.bookingActiveMutationId || "").trim() &&
    normalizeStatus(input.participationVisibilityState) === "eligible" &&
    Number(input.eventParticipationVersion) ===
      Number(input.bookingParticipationVersion) &&
    Boolean(String(input.currentArrivalVersionId || "").trim()) &&
    normalizeStatus(input.currentArrivalVersionState) === "current" &&
    Boolean(input.currentArrivalAcknowledgedAt)
  );
}

/**
 * Reusable SQL boundary for every booking-backed public surface. The only
 * exception is an explicitly free event; non-Parking-Pass paid events do not
 * bypass destination settlement or mutation/version barriers.
 */
export const publicPaidParticipationSqlCondition = and(
  eq(events.status, "open"),
  isNull(events.activeParticipationMutationId),
  isNull(events.participationSuppressedAt),
  isNull(eventBookings.activeEventMutationId),
  eq(eventBookings.status, "confirmed"),
  eq(eventBookings.participationVisibilityState, "eligible"),
  sql`${eventBookings.eventParticipationVersion} = ${events.participationVersion}`,
  sql`(
    ${events.seriesId} is null
    or exists (
      select 1
      from event_series participation_series
      where participation_series.id = ${events.seriesId}
        and participation_series.status = 'published'
        and participation_series.active_participation_mutation_id is null
        and participation_series.participation_suppressed_at is null
        and (
          (coalesce(${events.eventType}, '') = 'parking_pass')
          = (coalesce(participation_series.series_type, '') = 'parking_pass')
        )
    )
  )`,
  or(
    sql`coalesce(${events.requiresPayment}, false) = false`,
    and(
      eq(events.requiresPayment, true),
      isNotNull(eventBookings.purchaseId),
      inArray(parkingPassPurchases.status, [
        "confirmed",
        "partially_cancelled",
        "partially_refunded",
      ]),
      inArray(parkingPassPurchases.settlementStatus, [
        "transferred_to_connect",
        "partially_reversed",
      ]),
      eq(eventBookings.settlementTopology, "destination_charge"),
      eq(eventBookings.arrivalState, "acknowledged"),
      eq(eventBookings.publicLocationConsentSnapshot, true),
      isNotNull(eventBookings.currentArrivalVersionId),
      sql`exists (
        select 1
        from parking_pass_arrival_versions paid_participation_arrival
        where paid_participation_arrival.id = ${eventBookings.currentArrivalVersionId}
          and paid_participation_arrival.booking_id = ${eventBookings.id}
          and paid_participation_arrival.state = 'current'
          and paid_participation_arrival.acknowledged_at is not null
      )`,
    ),
  ),
);

/** Correlated event-level form for public surfaces that do not join bookings. */
export const publicEventParticipationSqlCondition = and(
  eq(events.status, "open"),
  isNull(events.activeParticipationMutationId),
  isNull(events.participationSuppressedAt),
  sql`(
    ${events.seriesId} is null
    or exists (
      select 1
      from event_series public_event_series
      where public_event_series.id = ${events.seriesId}
        and public_event_series.status = 'published'
        and public_event_series.active_participation_mutation_id is null
        and public_event_series.participation_suppressed_at is null
        and (
          (coalesce(${events.eventType}, '') = 'parking_pass')
          = (coalesce(public_event_series.series_type, '') = 'parking_pass')
        )
    )
  )`,
  or(
    sql`coalesce(${events.requiresPayment}, false) = false`,
    and(
      eq(events.requiresPayment, true),
      sql`exists (
        select 1
        from event_bookings public_booking
        join parking_pass_purchases public_purchase
          on public_purchase.id = public_booking.purchase_id
        join parking_pass_arrival_versions public_arrival
          on public_arrival.id = public_booking.current_arrival_version_id
         and public_arrival.booking_id = public_booking.id
        where public_booking.event_id = ${events.id}
          and public_booking.status = 'confirmed'
          and public_booking.active_event_mutation_id is null
          and public_booking.participation_visibility_state = 'eligible'
          and public_booking.event_participation_version = ${events.participationVersion}
          and public_booking.settlement_topology = 'destination_charge'
          and public_booking.arrival_state = 'acknowledged'
          and public_booking.public_location_consent_snapshot = true
          and public_purchase.status in (
            'confirmed', 'partially_cancelled', 'partially_refunded'
          )
          and public_purchase.settlement_status in (
            'transferred_to_connect', 'partially_reversed'
          )
          and public_arrival.state = 'current'
          and public_arrival.acknowledged_at is not null
      )`,
    ),
  ),
);

// Compatibility names remain while all callers migrate to paid-participation
// terminology; both aliases enforce the exact same destination-safe predicate.
export const isPublicPaidParkingPassEligible =
  isPublicPaidParticipationEligible;
