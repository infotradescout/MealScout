import { createHash } from "node:crypto";

export type ParkingPassAllocationInput = {
  eventId: string;
  hostPriceCents: number;
  platformFeeCents: number;
  slotType: string;
};

export type ParkingPassAllocatedLine = ParkingPassAllocationInput & {
  creditAppliedCents: number;
};

export type SelectedLineFinancialFacts = {
  id: string;
  hostPriceCents: number;
  platformFeeCents: number;
  creditAppliedCents: number;
  totalCents: number;
};

export type ParkingPassRemedy =
  | "release"
  | "restricted_credit"
  | "cash_refund"
  | "none";

export type CancellationAuthority =
  | "system"
  | "staff"
  | "host_owner"
  | "coordinator"
  | "truck_team";

export type CancellationPolicyDecision =
  | {
      ok: true;
      remedy: ParkingPassRemedy;
      policyTrigger: string;
      allBeforeStart: boolean;
      allAfterStart: boolean;
    }
  | {
      ok: false;
      code:
        | "technical_refund_forbidden"
        | "operator_cancellation_after_start"
        | "mixed_cancellation_policy";
      allBeforeStart: boolean;
      allAfterStart: boolean;
    };

export type ProviderCreateRecoveryDecision =
  | { action: "retrieve_bound" }
  | { action: "use_recovered" }
  | { action: "create_with_same_idempotency_key" }
  | { action: "action_required"; code: "provider_create_ambiguous" };

export type PreCaptureProviderDecision =
  | { action: "retrieve" }
  | { action: "request_cancel" }
  | { action: "release"; providerFinalState: "canceled" | "not_created" }
  | { action: "captured_refund_policy" }
  | {
      action: "action_required";
      code:
        | "payment_create_ambiguous"
        | "stripe_not_configured"
        | "provider_cancel_unconfirmed";
    };

export type RefundWebhookIdentity = {
  operationId: string;
  providerOperationId: string;
  providerStepId: string;
  purchaseId: string;
  requestDigest: string;
  allocationDigest: string;
  sortedLineDigest: string;
  policyTrigger: string;
  paymentIntentId: string;
  chargeId: string;
  currency: string;
  amountCents: number;
  refundId?: string | null;
};

export function evaluatePaidLineReservation(input: {
  duplicateBookingId?: string | null;
  hardCapEnabled: boolean;
  reservedCount: number;
  maxTrucks: number;
}) {
  const duplicateBookingId = String(input.duplicateBookingId || "").trim();
  if (duplicateBookingId) {
    return {
      allowed: false as const,
      code: "booking_already_exists" as const,
      bookingId: duplicateBookingId,
    };
  }
  const capacity = Math.max(1, Math.trunc(input.maxTrucks || 1));
  if (input.hardCapEnabled && input.reservedCount >= capacity) {
    return {
      allowed: false as const,
      code: "parking_pass_full" as const,
      bookingId: null,
    };
  }
  return { allowed: true as const, code: null, bookingId: null };
}

function assertCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer.`);
  }
}

export function stableParkingPassLineIds(lineIds: string[]) {
  return Array.from(
    new Set(lineIds.map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort();
}

export function parkingPassFinancialDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Credits are restricted to Parking Pass platform fees. The caller supplies
 * canonical line order, so replay allocates the same cents to the same lines.
 */
export function allocateRestrictedPlatformCredit(
  lines: ParkingPassAllocationInput[],
  requestedCreditCents: number,
): ParkingPassAllocatedLine[] {
  assertCents(requestedCreditCents, "requestedCreditCents");
  for (const line of lines) {
    assertCents(line.hostPriceCents, "hostPriceCents");
    assertCents(line.platformFeeCents, "platformFeeCents");
  }
  const availableFeeCents = lines.reduce(
    (total, line) => total + line.platformFeeCents,
    0,
  );
  let remaining = Math.min(requestedCreditCents, availableFeeCents);
  return lines.map((line) => {
    const creditAppliedCents = Math.min(line.platformFeeCents, remaining);
    remaining -= creditAppliedCents;
    return {
      ...line,
      platformFeeCents: line.platformFeeCents - creditAppliedCents,
      creditAppliedCents,
    };
  });
}

/** Exact selected-line values for the three independent provider money steps. */
export function summarizeSelectedLineRemedy(
  lines: SelectedLineFinancialFacts[],
  remedy: ParkingPassRemedy,
) {
  const sortedLines = [...lines].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const line of sortedLines) {
    assertCents(line.hostPriceCents, "hostPriceCents");
    assertCents(line.platformFeeCents, "platformFeeCents");
    assertCents(line.creditAppliedCents, "creditAppliedCents");
    assertCents(line.totalCents, "totalCents");
    if (line.totalCents !== line.hostPriceCents + line.platformFeeCents) {
      throw new RangeError(
        `Selected line ${line.id} cash total must equal host plus cash platform fee.`,
      );
    }
  }
  const cashLineValueCents = sortedLines.reduce(
    (total, line) => total + line.totalCents,
    0,
  );
  const hostLineValueCents = sortedLines.reduce(
    (total, line) => total + line.hostPriceCents,
    0,
  );
  const cashPlatformFeeCents = sortedLines.reduce(
    (total, line) => total + line.platformFeeCents,
    0,
  );
  const appliedCreditCents = sortedLines.reduce(
    (total, line) => total + line.creditAppliedCents,
    0,
  );
  return {
    sortedLineIds: sortedLines.map((line) => line.id),
    cashRefundCents: remedy === "cash_refund" ? cashLineValueCents : 0,
    hostTransferReversalCents:
      remedy === "cash_refund" ? hostLineValueCents : 0,
    applicationFeeRefundCents:
      remedy === "cash_refund" ? cashPlatformFeeCents : 0,
    restoredCreditCents:
      remedy === "cash_refund" ? appliedCreditCents : 0,
    restrictedFutureFeeCreditCents:
      remedy === "restricted_credit"
        ? cashLineValueCents + appliedCreditCents
        : 0,
  };
}

export function evaluateCancellationPolicy(input: {
  authority: CancellationAuthority;
  pending: boolean;
  technicalNonService: boolean;
  evaluatedAt: Date;
  startsAt: Array<Date | null>;
}): CancellationPolicyDecision {
  const evaluatedAtMs = input.evaluatedAt.getTime();
  const allBeforeStart = input.startsAt.every(
    (start) => start !== null && start.getTime() > evaluatedAtMs,
  );
  const allAfterStart = input.startsAt.every(
    (start) => start === null || start.getTime() <= evaluatedAtMs,
  );
  const operator = ["system", "staff", "host_owner", "coordinator"].includes(
    input.authority,
  );

  if (
    input.technicalNonService &&
    !["system", "staff"].includes(input.authority)
  ) {
    return {
      ok: false,
      code: "technical_refund_forbidden",
      allBeforeStart,
      allAfterStart,
    };
  }
  if (input.technicalNonService) {
    return {
      ok: true,
      remedy: "cash_refund",
      policyTrigger: "technical_non_service",
      allBeforeStart,
      allAfterStart,
    };
  }
  if (input.pending) {
    return {
      ok: true,
      remedy: "release",
      policyTrigger: "pre_capture_release",
      allBeforeStart,
      allAfterStart,
    };
  }
  if (operator) {
    if (input.authority !== "system" && !allBeforeStart) {
      return {
        ok: false,
        code: "operator_cancellation_after_start",
        allBeforeStart,
        allAfterStart,
      };
    }
    return {
      ok: true,
      remedy: "cash_refund",
      policyTrigger:
        input.authority === "system"
          ? "arrival_acknowledgement_deadline"
          : input.authority === "coordinator"
            ? "coordinator_future_cancellation"
            : input.authority === "host_owner"
              ? "host_future_cancellation"
              : "admin_future_cancellation",
      allBeforeStart,
      allAfterStart,
    };
  }
  if (!allBeforeStart && !allAfterStart) {
    return {
      ok: false,
      code: "mixed_cancellation_policy",
      allBeforeStart,
      allAfterStart,
    };
  }
  return {
    ok: true,
    remedy: allBeforeStart ? "restricted_credit" : "none",
    policyTrigger: allBeforeStart
      ? "truck_voluntary_pre_start"
      : "truck_voluntary_after_start",
    allBeforeStart,
    allAfterStart,
  };
}

export function decideProviderCreateRecovery(input: {
  hasBoundPaymentIntentId: boolean;
  exactSearchResultCount?: number;
  searchFailed?: boolean;
  withinIdempotencyRetention: boolean;
}): ProviderCreateRecoveryDecision {
  if (input.hasBoundPaymentIntentId) return { action: "retrieve_bound" };
  const resultCount = input.exactSearchResultCount;
  if (Number.isInteger(resultCount) && Number(resultCount) > 1) {
    return { action: "action_required", code: "provider_create_ambiguous" };
  }
  if (resultCount === 1) return { action: "use_recovered" };
  if (!input.withinIdempotencyRetention) {
    return { action: "action_required", code: "provider_create_ambiguous" };
  }
  return { action: "create_with_same_idempotency_key" };
}

export function decidePreCaptureProviderAction(input: {
  paymentIntentId?: string | null;
  providerConfigured: boolean;
  createOperation?: {
    status: string;
    attemptCount: number;
    providerPaymentIntentId?: string | null;
  } | null;
  providerIntentStatus?: string | null;
  afterCancelAttempt?: boolean;
}): PreCaptureProviderDecision {
  if (!String(input.paymentIntentId || "").trim()) {
    const operation = input.createOperation;
    if (
      operation?.status === "prepared" &&
      operation.attemptCount === 0 &&
      !String(operation.providerPaymentIntentId || "").trim()
    ) {
      return { action: "release", providerFinalState: "not_created" };
    }
    return { action: "action_required", code: "payment_create_ambiguous" };
  }
  if (!input.providerConfigured) {
    return { action: "action_required", code: "stripe_not_configured" };
  }
  const status = String(input.providerIntentStatus || "").trim();
  if (!status) return { action: "retrieve" };
  if (status === "succeeded") return { action: "captured_refund_policy" };
  if (status === "canceled") {
    return { action: "release", providerFinalState: "canceled" };
  }
  if (input.afterCancelAttempt) {
    return { action: "action_required", code: "provider_cancel_unconfirmed" };
  }
  return { action: "request_cancel" };
}

export function validateRefundWebhookIdentity(
  expected: RefundWebhookIdentity,
  actual: RefundWebhookIdentity,
) {
  const fields = Object.keys(expected) as Array<keyof RefundWebhookIdentity>;
  const mismatches = fields.filter((field) => {
    const expectedValue = expected[field] ?? null;
    const actualValue = actual[field] ?? null;
    return expectedValue !== actualValue;
  });
  return { valid: mismatches.length === 0, mismatches };
}

export function resolveDisputeConvergence(input: {
  providerStatus: string;
  chargedAmountCents: number;
  refundedAmountCents: number;
  lineStates?: Array<{
    status: string;
    cashRefundedCents?: number | null;
    hostTransferReversedCents?: number | null;
    applicationFeeRefundedCents?: number | null;
    cancellationCreditIssuedCents?: number | null;
    restoredCreditCents?: number | null;
    cancellationPolicy?: string | null;
  }>;
}) {
  const won = input.providerStatus === "won";
  const lost = input.providerStatus === "lost";
  const lines = input.lineStates || [];
  const cashRefundedFromLines = lines.reduce(
    (total, line) => total + Math.max(0, Number(line.cashRefundedCents || 0)),
    0,
  );
  const cashRefundedCents = lines.length
    ? cashRefundedFromLines
    : input.refundedAmountCents;
  const fullyRefunded = cashRefundedCents >= input.chargedAmountCents;
  const partiallyRefunded = cashRefundedCents > 0 && !fullyRefunded;
  const refundedLineCount = lines.filter(
    (line) =>
      line.status === "refunded" || Number(line.cashRefundedCents || 0) > 0,
  ).length;
  const cancelledLineCount = lines.filter(
    (line) =>
      line.status === "cancelled" &&
      (Number(line.cancellationCreditIssuedCents || 0) > 0 ||
        Boolean(String(line.cancellationPolicy || "").trim())),
  ).length;
  const closedLineCount = lines.filter((line) =>
    ["cancelled", "refunded"].includes(line.status),
  ).length;
  const underlyingPurchaseStatus = lines.length
    ? refundedLineCount === lines.length
      ? "refunded"
      : refundedLineCount > 0
        ? "partially_refunded"
        : cancelledLineCount === lines.length || closedLineCount === lines.length
          ? "cancelled"
          : cancelledLineCount > 0 || closedLineCount > 0
            ? "partially_cancelled"
            : "confirmed"
    : fullyRefunded
      ? "refunded"
      : partiallyRefunded
        ? "partially_refunded"
        : "confirmed";
  const underlyingSettlementStatus = fullyRefunded
    ? "reversed"
    : partiallyRefunded
      ? "partially_reversed"
      : "transferred_to_connect";
  return {
    disputeState: won ? "won" : lost ? "lost" : "open",
    outcome: won ? "won" : lost ? "lost" : null,
    // Dispute state is orthogonal to the immutable cancellation/refund
    // lifecycle. Open/lost disputes affect settlement exposure, not whether a
    // line was already cancelled, credited, or provider-refunded.
    purchaseStatus: underlyingPurchaseStatus,
    settlementStatus: won ? underlyingSettlementStatus : "disputed",
    lineSettlementState: won ? "destination_settled" : "disputed",
  } as const;
}
