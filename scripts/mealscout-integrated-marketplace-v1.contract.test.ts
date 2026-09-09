import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isPublicPaidParkingPassEligible } from "../server/services/publicParkingPassEligibility";

const read = (path: string) => readFileSync(path, "utf8");

const service = read("server/services/parkingPassBookingService.ts");
const financialPolicy = read(
  "server/services/parkingPassFinancialPolicy.ts",
);
const eventPolicy = read("server/services/eventParticipationPolicy.ts");
const eventMutationService = read(
  "server/services/eventParticipationMutationService.ts",
);
const migration = read(
  "migrations/142_integrated_marketplace_purchase_review_arrival.sql",
);
const health = read("server/routes/health.ts");
const render = read("render.yaml");
const orderingSchema = read("shared/schema/ordering.ts");
const parkingSchema = read("shared/schema/parkingPass.ts");
const orderingRoutes = read("server/routes/restaurantPaymentRoutes.ts");
const menuRoutes = read("server/routes/menuRoutes.ts");
const webhookRoutes = read("server/routes/stripeWebhookRoutes.ts");
const bookingRoutes = read("server/routes/bookingRoutes.ts");
const recurringJobs = read("server/bootstrap/registerRecurringJobs.ts");
const operatingPlan = read("server/services/truckOperatingPlan.ts");
const publicParkingPolicy = read(
  "server/services/publicParkingPassEligibility.ts",
);
const confirmedTrucks = read("server/services/confirmedEventTrucks.ts");
const coordinatorRoutes = read("server/routes/eventCoordinatorRoutes.ts");
const hostEventRoutes = read("server/routes/hosts/eventsRoutes.ts");
const adminEventRoutes = read("server/routes/admin/userAdminRoutes.ts");
const openCallSeriesRoutes = read("server/routes/openCallSeriesRoutes.ts");
const hostRoutes = read("server/routes/hostRoutes.ts");
const hostEarnings = read("server/hostEarningsService.ts");
const payoutRoutes = read("server/routes/hostPayoutAdminRoutes.ts");
const legacyPayoutProviderService = read(
  "server/services/legacyPayoutProviderService.ts",
);
const ownerReviewUi = read("client/src/pages/menu-builder.tsx");
const adminUi = read("client/src/pages/admin-dashboard.tsx");
const truckScheduleUi = read("client/src/components/parking-schedule-calendar.tsx");
const hostParkingPassUi = read("client/src/pages/parking-pass.tsx");
const bookingPaymentUi = read("client/src/components/booking-payment-modal.tsx");
const legacyExplore = read("client/src/pages/explore-preview.tsx");
const legacyShare = read("client/src/components/ShareButton.tsx");

// Schema and deploy containment.
for (const tableName of [
  "ordering_review_requests",
  "parking_pass_purchases",
  "parking_pass_provider_operations",
  "parking_pass_provider_operation_steps",
  "parking_pass_cancellation_operations",
  "parking_pass_credit_ledger",
  "parking_pass_arrival_versions",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}`, "i"),
    `migration 142 must create ${tableName} replay-safely`,
  );
}
assert.match(migration, /ADD COLUMN IF NOT EXISTS purchase_id/i);
assert.match(migration, /trigger_guard_paid_parking_pass_booking/i);
assert.match(migration, /paid event booking requires canonical purchase aggregate/i);
assert.match(migration, /cash_refunded_cents <= total_cents/i);
assert.doesNotMatch(
  migration,
  /cash_refunded_cents <= total_cents - credit_applied_cents/i,
);
assert.match(migration, /COALESCE\(sum\(total_cents\), 0\)::INTEGER AS cash_cents/i);
assert.match(migration, /trigger_guard_ordering_approval_request/i);
assert.match(migration, /requester_user_id IS DISTINCT FROM request\.reviewer_user_id/i);
assert.match(migration, /submitted_authority_version = OLD\.ordering_authority_version/i);
assert.match(health, /REQUIRED_RELEASE_MIGRATION_FLOOR = 142/);
assert.match(health, /to_regclass\('public\.parking_pass_purchases'\)/);
assert.match(health, /to_regclass\('public\.ordering_review_requests'\)/);
assert.match(render, /healthCheckPath:\s*\/health\/ready/);

// Canonical destination-charge creation and provider-current readiness.
assert.match(service, /stripe\.accounts\.retrieve\(/);
assert.match(service, /providerAccount\.details_submitted !== true/);
assert.match(service, /providerAccount\.charges_enabled !== true/);
assert.match(service, /providerAccount\.payouts_enabled !== true/);
assert.match(service, /stripe\.paymentIntents\.create\(params/);
assert.match(service, /transfer_data:\s*\{\s*destination:/s);
assert.match(
  service,
  /params\.application_fee_amount\s*=\s*providerOperation\.expectedApplicationFeeCents/,
);
assert.match(service, /settlementTopology:\s*"destination_charge"/);
assert.doesNotMatch(service, /settlementTopology:\s*"platform_hold"/);
for (const adapterPath of [
  "server/routes/hostRoutes.ts",
  "server/routes/eventRoutes.ts",
  "server/routes/actionRoutes.ts",
]) {
  const adapter = read(adapterPath);
  assert.match(
    adapter,
    /createParkingPassPurchase/,
    `${adapterPath} must adapt to the canonical purchase service`,
  );
  assert.doesNotMatch(
    adapter,
    /settlementTopology:\s*"platform_hold"/,
    `${adapterPath} must not create a new platform-held Parking Pass`,
  );
}
assert.match(webhookRoutes, /confirmParkingPassPurchaseFromIntent/);
assert.match(webhookRoutes, /recordParkingPassPaymentFailureFromIntent/);
assert.match(webhookRoutes, /markParkingPassPurchaseDisputed/);

// Cancellation matrix, selected-line concurrency, and provider recovery.
assert.match(service, /parking-pass-cancellation-v1/);
assert.match(service, /stableLineIds\(/);
assert.match(service, /JSON\.stringify\(existingOperation\.bookingLineIds\)/);
assert.match(service, /cancellation_idempotency_mismatch/);
assert.match(service, /parking_pass_cancel:\$\{purchaseId\}/);
assert.match(service, /cancellation_in_progress/);
assert.match(financialPolicy, /truck_voluntary_pre_start/);
assert.match(financialPolicy, /truck_voluntary_after_start/);
assert.match(financialPolicy, /operator_cancellation_after_start/);
assert.match(financialPolicy, /restrictedFutureFeeCreditCents/);
assert.match(financialPolicy, /cashLineValueCents \+ appliedCreditCents/);
assert.match(service, /stripe\.refunds\.create\(/);
assert.match(service, /stripe\.transfers\.createReversal\(/);
assert.match(service, /stripe\.applicationFees\.createRefund\(/);
assert.doesNotMatch(
  service,
  /refunds\.create\([\s\S]{0,500}reverse_transfer:\s*true/,
  "selected-line cash refunds must use an exact separate transfer-reversal step",
);
assert.match(service, /non_service_credit_restoration/);
assert.match(service, /reconcilePendingParkingPassRefunds/);
assert.match(recurringJobs, /runParkingPassRefundReconciliation/);

// Protected arrival authority and public suppression.
assert.match(service, /arrival_change_pending/);
assert.match(service, /earlierStart\.getTime\(\) - 15 \* 60 \* 1000/);
assert.match(
  service,
  /Only the current truck owner or active team member with Parking Pass permission may acknowledge/,
);
assert.match(service, /arrival-deadline:\$\{row\.version\.id\}/);
assert.match(service, /Material arrival change was not acknowledged/);
assert.match(recurringJobs, /runParkingPassArrivalExpiry/);
assert.match(operatingPlan, /publicPaidParticipationSqlCondition/);
assert.match(
  publicParkingPolicy,
  /eq\(eventBookings\.arrivalState, "acknowledged"\)/,
);
assert.match(
  publicParkingPolicy,
  /eq\(eventBookings\.publicLocationConsentSnapshot, true\)/,
);
assert.match(operatingPlan, /isPublicPaidParticipationEligible\(row\)/);
assert.match(publicParkingPolicy, /input\.addressVisible === true/);
assert.match(operatingPlan, /parkingPassArrivalVersions/);
assert.match(operatingPlan, /publicArrivalWindow\(/);
assert.match(operatingPlan, /address:\s*null/);
assert.match(operatingPlan, /roundPublicCoordinate\(row\.currentArrivalLatitude\)/);
assert.match(confirmedTrucks, /publicParkingPassBookingSqlCondition/);
assert.match(confirmedTrucks, /resolvePublicProfileVisibility\(row\.publicProfileSettings\)\.showAddress/);

const publicBoundaryFiles = [
  "server/routes/discoveryRoutes.ts",
  "server/routes/publicMapRoutes.ts",
  "server/routes/publicDiscoveryRoutes.ts",
  "server/routes/seoRoutes.ts",
  "server/routes/restaurantOperationsRoutes.ts",
];
for (const path of publicBoundaryFiles) {
  assert.match(
    read(path),
    /publicParkingPassBookingSqlCondition/,
    `${path} must apply the canonical paid-booking public boundary`,
  );
}

const publicFixture = {
  eventStatus: "open",
  eventType: "parking_pass",
  eventParticipationSuppressedAt: null,
  seriesId: "series-fixture",
  seriesStatus: "published",
  seriesType: "parking_pass",
  seriesParticipationSuppressedAt: null,
  purchaseId: "purchase-fixture",
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
  eventParticipationVersion: 1,
  bookingParticipationVersion: 1,
  currentArrivalVersionId: "arrival-fixture",
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
  "a pending material arrival correction must suppress the public stop",
);
assert.equal(
  isPublicPaidParkingPassEligible({ ...publicFixture, addressVisible: false }),
  false,
  "revoked current public-location consent must suppress the public stop",
);
assert.equal(
  isPublicPaidParkingPassEligible({ ...publicFixture, seriesStatus: "draft" }),
  false,
  "a draft parent series must suppress paid participation everywhere public",
);
assert.equal(
  isPublicPaidParkingPassEligible({
    ...publicFixture,
    purchaseSettlementStatus: "pending",
  }),
  false,
  "an unsettled paid booking must not feed public truck truth",
);

// Explicit coordinator authority is limited to non-Parking-Pass events.
assert.match(coordinatorRoutes, /eq\(events\.coordinatorUserId, req\.user\.id\)/);
assert.match(coordinatorRoutes, /sql`\$\{events\.eventType\} <> 'parking_pass'`/);
assert.match(eventPolicy, /input\.eventType === "parking_pass"/);
assert.match(eventMutationService, /canCoordinateEvent/);
assert.match(service, /canCoordinateEvent/);

// Every owner/coordinator/admin/compatibility alias reaches the same durable
// mutation, cancellation, and stale-expiry services with stable request IDs.
for (const [sourceName, source, required] of [
  [
    "coordinator routes",
    coordinatorRoutes,
    [
      "event_coordinator_event_mutation",
      "event_coordinator_event_cancellation",
      "event_coordinator_series_mutation",
      "event_coordinator_series_cancellation",
      "updateCoordinatedEvent",
      "cancelCoordinatedEvent",
      "updateCoordinatedSeries",
      "cancelCoordinatedSeries",
    ],
  ],
  [
    "host event routes",
    hostEventRoutes,
    [
      "host_parking_pass_configuration",
      "host_parking_pass_mutation",
      "updateCoordinatedEvent",
      "updateCoordinatedSeries",
    ],
  ],
  [
    "admin event routes",
    adminEventRoutes,
    [
      "admin_event_mutation",
      "admin_event_series_mutation",
      "admin_parking_pass_booking_mutation",
      "updateCoordinatedEvent",
      "updateCoordinatedSeries",
      "cancelParkingPassLines",
    ],
  ],
  [
    "open-call series routes",
    openCallSeriesRoutes,
    ["host_event_series_cancellation", "cancelCoordinatedSeries"],
  ],
  [
    "host booking routes",
    hostRoutes,
    ["expireStaleParkingPassHolds"],
  ],
] as const) {
  for (const token of required) {
    assert.match(
      source,
      new RegExp(token),
      `${sourceName} must preserve canonical route parity for ${token}`,
    );
  }
  assert.doesNotMatch(
    source,
    /stripe\.(?:refunds|transfers|applicationFees)\.(?:create|createRefund|createReversal)\(/,
    `${sourceName} must not perform provider money mutations outside the canonical services`,
  );
}
assert.match(adminEventRoutes, /legacy_paid_booking_action_required/);
assert.match(adminEventRoutes, /proven_free_direct_cancel/);

// Ordering review is durable, owner-submitted, and separately admin-decided.
assert.match(orderingSchema, /orderingReviewRequests/);
assert.match(orderingRoutes, /\/api\/restaurants\/:restaurantId\/ordering-review/);
assert.match(orderingRoutes, /\/api\/admin\/ordering-reviews/);
assert.match(orderingRoutes, /ordering_review_separation_required/);
assert.match(orderingRoutes, /submittedAuthorityVersion/);
assert.match(orderingRoutes, /staleAuthority/);
assert.match(orderingRoutes, /reviewMode:\s*true/);
assert.match(ownerReviewUi, /data-testid="owner-ordering-review"/);
assert.match(ownerReviewUi, /Resubmit for review/);
assert.match(adminUi, /data-testid="admin-ordering-review-queue"/);

// Legacy payout accounting cannot claim new destination-charge purchases.
assert.match(hostEarnings, /purchaseId/);
assert.match(hostEarnings, /<> 'destination_charge'/);
assert.match(payoutRoutes, /executeLegacyPayoutTransfer/);
assert.doesNotMatch(payoutRoutes, /stripe!?\.transfers\.create/);
assert.match(legacyPayoutProviderService, /stripe\.transfers\.create/);
assert.doesNotMatch(
  payoutRoutes,
  /status:\s*"paid"/,
  "legacy payout UI state must not claim paid before provider confirmation",
);

// Rendered policy/protected-arrival truth and project-index owner cleanup.
assert.match(
  bookingPaymentUi,
  /full line value as[\s\S]*non-cash credit[\s\S]*future[\s\S]*Parking Pass/i,
);
assert.match(
  bookingPaymentUi,
  /After start, voluntary cancellation has no remedy/i,
);
assert.match(hostParkingPassUi, /Protected booked arrival/);
assert.match(hostParkingPassUi, /Correct arrival/);
assert.match(truckScheduleUi, /onReviewArrivalChange/);
assert.match(bookingRoutes, /\/arrival\/:versionId\/acknowledge/);
assert.match(bookingPaymentUi, /refunded/);
assert.match(legacyExplore, /export default function LegacyExplorePreview/);
assert.match(legacyShare, /export function LegacyShareButton/);
assert.match(parkingSchema, /parkingPassPurchases/);

console.log("mealscout-integrated-marketplace-v1.contract: PASS");
