import assert from "node:assert/strict";

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
  type RefundWebhookIdentity,
} from "../server/services/parkingPassFinancialPolicy";
import {
  canCoordinateEvent,
  eventParticipationMutationKeys,
  isSettledPaidParticipation,
  shouldCorrectPaidParticipation,
} from "../server/services/eventParticipationPolicy";
import { isPublicPaidParkingPassEligible } from "../server/services/publicParkingPassEligibility";

const now = new Date("2026-08-24T17:00:00.000Z");
const before = new Date("2026-08-24T16:00:00.000Z");
const after = new Date("2026-08-24T18:00:00.000Z");

// Uneven fees consume restricted credit deterministically and never touch host value.
const allocated = allocateRestrictedPlatformCredit(
  [
    { eventId: "a", hostPriceCents: 1750, platformFeeCents: 1000, slotType: "daily" },
    { eventId: "b", hostPriceCents: 425, platformFeeCents: 650, slotType: "lunch" },
    { eventId: "c", hostPriceCents: 999, platformFeeCents: 333, slotType: "dinner" },
  ],
  900,
);
assert.deepEqual(
  allocated.map(({ eventId, hostPriceCents, platformFeeCents, creditAppliedCents }) => ({
    eventId,
    hostPriceCents,
    platformFeeCents,
    creditAppliedCents,
  })),
  [
    { eventId: "a", hostPriceCents: 1750, platformFeeCents: 100, creditAppliedCents: 900 },
    { eventId: "b", hostPriceCents: 425, platformFeeCents: 650, creditAppliedCents: 0 },
    { eventId: "c", hostPriceCents: 999, platformFeeCents: 333, creditAppliedCents: 0 },
  ],
);
assert.equal(
  parkingPassFinancialDigest(allocated),
  parkingPassFinancialDigest(structuredClone(allocated)),
  "allocation replay must produce the same digest",
);

const selected = [
  { id: "b", hostPriceCents: 425, platformFeeCents: 650, creditAppliedCents: 0, totalCents: 1075 },
  { id: "a", hostPriceCents: 1750, platformFeeCents: 100, creditAppliedCents: 900, totalCents: 1850 },
];
assert.deepEqual(summarizeSelectedLineRemedy(selected, "cash_refund"), {
  sortedLineIds: ["a", "b"],
  cashRefundCents: 2925,
  hostTransferReversalCents: 2175,
  applicationFeeRefundCents: 750,
  restoredCreditCents: 900,
  restrictedFutureFeeCreditCents: 0,
});
assert.deepEqual(
  summarizeSelectedLineRemedy(selected, "restricted_credit"),
  {
    sortedLineIds: ["a", "b"],
    cashRefundCents: 0,
    hostTransferReversalCents: 0,
    applicationFeeRefundCents: 0,
    restoredCreditCents: 0,
    restrictedFutureFeeCreditCents: 3825,
  },
);
assert.throws(
  () =>
    summarizeSelectedLineRemedy(
      [{ ...selected[0], totalCents: selected[0].totalCents + 1 }],
      "cash_refund",
    ),
  /cash total must equal host plus cash platform fee/,
);

// Actor/time cancellation matrix.
assert.equal(
  evaluateCancellationPolicy({
    authority: "truck_team",
    pending: true,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [after],
  }).ok,
  true,
);
assert.deepEqual(
  evaluateCancellationPolicy({
    authority: "truck_team",
    pending: false,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [after],
  }),
  {
    ok: true,
    remedy: "restricted_credit",
    policyTrigger: "truck_voluntary_pre_start",
    allBeforeStart: true,
    allAfterStart: false,
  },
);
assert.equal(
  evaluateCancellationPolicy({
    authority: "truck_team",
    pending: false,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [before],
  }).ok &&
    (evaluateCancellationPolicy({
      authority: "truck_team",
      pending: false,
      technicalNonService: false,
      evaluatedAt: now,
      startsAt: [before],
    }) as any).remedy,
  "none",
);
assert.equal(
  evaluateCancellationPolicy({
    authority: "truck_team",
    pending: false,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [before, after],
  }).ok,
  false,
);
assert.deepEqual(
  evaluateCancellationPolicy({
    authority: "coordinator",
    pending: false,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [after],
  }),
  {
    ok: true,
    remedy: "cash_refund",
    policyTrigger: "coordinator_future_cancellation",
    allBeforeStart: true,
    allAfterStart: false,
  },
);
assert.equal(
  (evaluateCancellationPolicy({
    authority: "host_owner",
    pending: false,
    technicalNonService: false,
    evaluatedAt: now,
    startsAt: [before],
  }) as any).code,
  "operator_cancellation_after_start",
);
assert.equal(
  (evaluateCancellationPolicy({
    authority: "host_owner",
    pending: false,
    technicalNonService: true,
    evaluatedAt: now,
    startsAt: [after],
  }) as any).code,
  "technical_refund_forbidden",
);
assert.equal(
  (evaluateCancellationPolicy({
    authority: "staff",
    pending: false,
    technicalNonService: true,
    evaluatedAt: now,
    startsAt: [before],
  }) as any).remedy,
  "cash_refund",
);

// Recover create/bind ambiguity only while the exact provider key remains safe.
assert.equal(
  decideProviderCreateRecovery({
    hasBoundPaymentIntentId: true,
    withinIdempotencyRetention: false,
  }).action,
  "retrieve_bound",
);
assert.equal(
  decideProviderCreateRecovery({
    hasBoundPaymentIntentId: false,
    exactSearchResultCount: 1,
    withinIdempotencyRetention: true,
  }).action,
  "use_recovered",
);
assert.equal(
  decideProviderCreateRecovery({
    hasBoundPaymentIntentId: false,
    exactSearchResultCount: 2,
    withinIdempotencyRetention: true,
  }).action,
  "action_required",
);
assert.equal(
  decideProviderCreateRecovery({
    hasBoundPaymentIntentId: false,
    searchFailed: true,
    withinIdempotencyRetention: true,
  }).action,
  "create_with_same_idempotency_key",
);
assert.equal(
  decideProviderCreateRecovery({
    hasBoundPaymentIntentId: false,
    searchFailed: true,
    withinIdempotencyRetention: false,
  }).action,
  "action_required",
);

assert.deepEqual(
  decidePreCaptureProviderAction({
    providerConfigured: false,
    createOperation: { status: "prepared", attemptCount: 0 },
  }),
  { action: "release", providerFinalState: "not_created" },
);
assert.equal(
  decidePreCaptureProviderAction({
    providerConfigured: true,
    createOperation: { status: "submitted", attemptCount: 1 },
  }).action,
  "action_required",
);
assert.equal(
  decidePreCaptureProviderAction({
    paymentIntentId: "pi_1",
    providerConfigured: false,
  }).action,
  "action_required",
);
assert.equal(
  decidePreCaptureProviderAction({
    paymentIntentId: "pi_1",
    providerConfigured: true,
    providerIntentStatus: "succeeded",
  }).action,
  "captured_refund_policy",
);
assert.deepEqual(
  decidePreCaptureProviderAction({
    paymentIntentId: "pi_1",
    providerConfigured: true,
    providerIntentStatus: "canceled",
  }),
  { action: "release", providerFinalState: "canceled" },
);
assert.equal(
  decidePreCaptureProviderAction({
    paymentIntentId: "pi_1",
    providerConfigured: true,
    providerIntentStatus: "requires_payment_method",
  }).action,
  "request_cancel",
);
assert.equal(
  decidePreCaptureProviderAction({
    paymentIntentId: "pi_1",
    providerConfigured: true,
    providerIntentStatus: "processing",
    afterCancelAttempt: true,
  }).action,
  "action_required",
);

// Every persisted identity field participates in refund webhook acceptance.
const exactRefundIdentity: RefundWebhookIdentity = {
  operationId: "cancel_1",
  providerOperationId: "op_1",
  providerStepId: "step_1",
  purchaseId: "purchase_1",
  requestDigest: "request_digest",
  allocationDigest: "allocation_digest",
  sortedLineDigest: "line_digest",
  policyTrigger: "host_future_cancellation",
  paymentIntentId: "pi_1",
  chargeId: "ch_1",
  currency: "usd",
  amountCents: 2925,
};
assert.equal(
  validateRefundWebhookIdentity(exactRefundIdentity, {
    ...exactRefundIdentity,
  }).valid,
  true,
);
for (const [field, forgedValue] of [
  ["operationId", "cancel_forged"],
  ["providerOperationId", "op_forged"],
  ["providerStepId", "step_forged"],
  ["purchaseId", "purchase_forged"],
  ["requestDigest", "request_forged"],
  ["allocationDigest", "allocation_forged"],
  ["sortedLineDigest", "lines_forged"],
  ["policyTrigger", "truck_voluntary_pre_start"],
  ["paymentIntentId", "pi_forged"],
  ["chargeId", "ch_forged"],
  ["currency", "eur"],
  ["amountCents", 2924],
] as const) {
  const forged = { ...exactRefundIdentity, [field]: forgedValue };
  const result = validateRefundWebhookIdentity(exactRefundIdentity, forged);
  assert.equal(result.valid, false, `forged ${field} must fail closed`);
  assert.ok(result.mismatches.includes(field));
}

assert.deepEqual(
  resolveDisputeConvergence({
    providerStatus: "needs_response",
    chargedAmountCents: 5000,
    refundedAmountCents: 0,
  }),
  {
    disputeState: "open",
    outcome: null,
    purchaseStatus: "confirmed",
    settlementStatus: "disputed",
    lineSettlementState: "disputed",
  },
);
assert.equal(
  resolveDisputeConvergence({
    providerStatus: "won",
    chargedAmountCents: 5000,
    refundedAmountCents: 1000,
  }).purchaseStatus,
  "partially_refunded",
);
assert.equal(
  resolveDisputeConvergence({
    providerStatus: "lost",
    chargedAmountCents: 5000,
    refundedAmountCents: 0,
  }).outcome,
  "lost",
);
assert.deepEqual(
  resolveDisputeConvergence({
    providerStatus: "won",
    chargedAmountCents: 5000,
    refundedAmountCents: 0,
    lineStates: [
      {
        status: "cancelled",
        cancellationCreditIssuedCents: 1000,
        cancellationPolicy: "truck_voluntary_pre_start",
      },
    ],
  }),
  {
    disputeState: "won",
    outcome: "won",
    purchaseStatus: "cancelled",
    settlementStatus: "transferred_to_connect",
    lineSettlementState: "destination_settled",
  },
);
assert.equal(
  resolveDisputeConvergence({
    providerStatus: "won",
    chargedAmountCents: 5000,
    refundedAmountCents: 2500,
    lineStates: [
      { status: "refunded", cashRefundedCents: 2500 },
      {
        status: "cancelled",
        cancellationCreditIssuedCents: 500,
        cancellationPolicy: "truck_voluntary_pre_start",
      },
    ],
  }).purchaseStatus,
  "partially_refunded",
);

// Duplicate/capacity and coordinator barriers are deterministic and replay-safe.
assert.equal(
  evaluatePaidLineReservation({
    duplicateBookingId: "booking_existing",
    hardCapEnabled: false,
    reservedCount: 0,
    maxTrucks: 2,
  }).code,
  "booking_already_exists",
);
assert.equal(
  evaluatePaidLineReservation({
    hardCapEnabled: true,
    reservedCount: 2,
    maxTrucks: 2,
  }).code,
  "parking_pass_full",
);
assert.equal(
  evaluatePaidLineReservation({
    hardCapEnabled: false,
    reservedCount: 9,
    maxTrucks: 2,
  }).allowed,
  true,
);
assert.deepEqual(
  stableParkingPassLineIds(["b", "a", "b", " "]),
  ["a", "b"],
);
assert.equal(
  canCoordinateEvent({
    actorUserId: "coordinator",
    eventType: "public_event",
    eventCoordinatorUserId: "coordinator",
  }),
  true,
);
assert.equal(
  canCoordinateEvent({
    actorUserId: "coordinator",
    eventType: "public_event",
    seriesCoordinatorUserId: "coordinator",
  }),
  true,
);
assert.equal(
  canCoordinateEvent({
    actorUserId: "coordinator",
    eventType: "parking_pass",
    eventCoordinatorUserId: "coordinator",
    seriesCoordinatorUserId: "coordinator",
  }),
  false,
);
const mutationKeys = eventParticipationMutationKeys(
  "series-change-123",
  "booking-1",
);
assert.deepEqual(
  eventParticipationMutationKeys("series-change-123", "booking-1"),
  mutationKeys,
);
assert.notDeepEqual(
  eventParticipationMutationKeys("series-change-123", "booking-2"),
  mutationKeys,
);

const settledParticipation = {
  bookingStatus: "confirmed",
  purchaseStatus: "confirmed",
  settlementStatus: "transferred_to_connect",
};
assert.equal(isSettledPaidParticipation(settledParticipation), true);
assert.equal(
  isSettledPaidParticipation({
    ...settledParticipation,
    bookingStatus: "pending",
  }),
  false,
);
assert.equal(
  isSettledPaidParticipation({
    ...settledParticipation,
    settlementStatus: "pending",
  }),
  false,
);
assert.equal(
  shouldCorrectPaidParticipation({
    ...settledParticipation,
    arrivalStartAt: after,
    now,
  }),
  true,
);
assert.equal(
  shouldCorrectPaidParticipation({
    ...settledParticipation,
    arrivalStartAt: before,
    now,
  }),
  false,
);

const publicFixture = {
  eventStatus: "open",
  eventType: "parking_pass",
  eventParticipationSuppressedAt: null,
  seriesId: "series-1",
  seriesStatus: "published",
  seriesType: "parking_pass",
  seriesParticipationSuppressedAt: null,
  purchaseId: "purchase-1",
  purchaseStatus: "confirmed",
  purchaseSettlementStatus: "transferred_to_connect",
  settlementTopology: "destination_charge",
  bookingStatus: "confirmed",
  arrivalState: "acknowledged",
  publicLocationConsentSnapshot: true,
  addressVisible: true,
  eventActiveMutationId: null,
  seriesActiveMutationId: null,
  bookingActiveMutationId: null,
  participationVisibilityState: "eligible",
  eventParticipationVersion: 3,
  bookingParticipationVersion: 3,
  currentArrivalVersionId: "arrival-3",
  currentArrivalVersionState: "current",
  currentArrivalAcknowledgedAt: new Date("2026-08-24T12:00:00Z"),
};
assert.equal(isPublicPaidParkingPassEligible(publicFixture), true);
assert.equal(
  isPublicPaidParkingPassEligible({
    ...publicFixture,
    arrivalState: "arrival_change_pending",
  }),
  false,
);
assert.equal(
  isPublicPaidParkingPassEligible({
    ...publicFixture,
    addressVisible: false,
  }),
  false,
);
for (const override of [
  { purchaseId: null },
  { eventStatus: "cancelled" },
  { eventParticipationSuppressedAt: new Date("2026-08-24T12:00:00Z") },
  { seriesStatus: "draft" },
  { seriesParticipationSuppressedAt: new Date("2026-08-24T12:00:00Z") },
  { seriesType: "event" },
  { bookingStatus: "pending" },
  { purchaseStatus: "pending" },
  { purchaseSettlementStatus: "pending" },
  { settlementTopology: "legacy_platform_hold" },
  { publicLocationConsentSnapshot: false },
  { eventActiveMutationId: "mutation-1" },
  { seriesActiveMutationId: "mutation-1" },
  { bookingActiveMutationId: "mutation-1" },
  { participationVisibilityState: "suppressed" },
  { bookingParticipationVersion: 2 },
  { currentArrivalVersionId: null },
  { currentArrivalVersionState: "proposed" },
  { currentArrivalAcknowledgedAt: null },
]) {
  assert.equal(
    isPublicPaidParkingPassEligible({ ...publicFixture, ...override }),
    false,
    `public paid participation accepted unsafe override ${JSON.stringify(override)}`,
  );
}

console.log("mealscout-integrated-marketplace-v1.behavior: PASS");
