import crypto from "node:crypto";
import Stripe from "stripe";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  hostEarningsLedger,
  hostPayoutRequests,
  hosts,
  legacyPayoutProviderOperations,
  users,
} from "@shared/schema";
import { db } from "../db";
import { getHostEarningsSummary } from "../hostEarningsService";

const configuredStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const clean = (value: unknown) => String(value || "").trim();
const staffRoles = new Set(["staff", "admin", "duper_admin", "super_admin"]);
const retentionDeadline = (from = new Date()) =>
  new Date(from.getTime() + 24 * 60 * 60 * 1000);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};
const digest = (value: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");

export class LegacyPayoutProviderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LegacyPayoutProviderError";
  }
}

type PayoutOperation =
  typeof legacyPayoutProviderOperations.$inferSelect;

export function serializeLegacyPayoutProviderOperation(
  operation: PayoutOperation,
) {
  const terminal = operation.status === "provider_confirmed";
  return {
    id: operation.id,
    requestId: operation.requestId,
    status: operation.status,
    providerStatus: operation.providerStatus,
    providerTransferId: operation.providerTransferId,
    attemptCount: operation.attemptCount,
    errorCode: operation.providerErrorCode,
    errorMessage: operation.providerErrorMessage,
    terminal,
    retryable:
      !terminal &&
      operation.idempotencyExpiresAt.getTime() > Date.now() &&
      operation.status !== "quarantined",
    guidance: terminal
      ? "Stripe confirmed the exact legacy platform-held transfer."
      : operation.status === "quarantined"
        ? "The payout facts no longer match eligible legacy funds. Do not retry a provider transfer."
        : operation.idempotencyExpiresAt.getTime() <= Date.now()
          ? "Provider idempotency retention expired without exact transfer proof. Staff reconciliation is required; do not create another transfer."
          : "Search/retrieve the durable provider operation, then retry with the same request ID. Do not start a second payout.",
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    confirmedAt: operation.confirmedAt,
    recovery: {
      attemptCount: operation.recoveryAttemptCount,
      actorUserId: operation.lastRecoveryActorUserId,
      actorType: operation.lastRecoveryActorType,
      reason: operation.lastRecoveryReason,
      at: operation.lastRecoveryAt,
    },
  };
}

const transferDestination = (transfer: Stripe.Transfer) =>
  typeof transfer.destination === "string"
    ? transfer.destination
    : clean((transfer.destination as Stripe.Account | null)?.id);

function exactTransferMatch(
  transfer: Stripe.Transfer,
  operation: PayoutOperation,
) {
  return (
    transfer.amount === operation.expectedAmountCents &&
    clean(transfer.currency).toLowerCase() === operation.expectedCurrency &&
    transferDestination(transfer) === operation.expectedDestinationAccountId &&
    clean(transfer.metadata?.providerOperationId) === operation.id &&
    clean(transfer.metadata?.payoutRequestId) === operation.payoutRequestId &&
    clean(transfer.metadata?.hostId) === operation.expectedHostId &&
    clean(transfer.metadata?.settlementTopology) ===
      operation.expectedFundingTopology &&
    transfer.reversed !== true
  );
}

async function findOperationTransfers(
  stripe: Stripe,
  operation: PayoutOperation,
) {
  const createdGte = Math.max(
    0,
    Math.floor(operation.createdAt.getTime() / 1000) - 300,
  );
  const transfers = await stripe.transfers
    .list({
      destination: operation.expectedDestinationAccountId,
      created: { gte: createdGte },
      limit: 100,
    })
    .autoPagingToArray({ limit: 10_000 });
  const bound = transfers.filter(
    (transfer) =>
      clean(transfer.metadata?.providerOperationId) === operation.id ||
      clean(transfer.metadata?.payoutRequestId) === operation.payoutRequestId,
  );
  const exact = bound.filter((transfer) => exactTransferMatch(transfer, operation));
  return { bound, exact };
}

async function markActionRequired(input: {
  operationId: string;
  code: string;
  message: string;
}) {
  const now = new Date();
  const [operation] = await db
    .update(legacyPayoutProviderOperations)
    .set({
      status: "action_required",
      providerStatus: "ambiguous",
      providerErrorCode: input.code,
      providerErrorMessage: input.message,
      updatedAt: now,
    })
    .where(
      and(
        eq(legacyPayoutProviderOperations.id, input.operationId),
        inArray(legacyPayoutProviderOperations.status, [
          "prepared",
          "submitted",
          "action_required",
        ]),
      ),
    )
    .returning();
  if (operation) {
    await db
      .update(hostPayoutRequests)
      .set({
        status: "processing",
        notes: input.message,
        paidAt: null,
        updatedAt: now,
      })
      .where(eq(hostPayoutRequests.id, operation.payoutRequestId));
  }
  return operation;
}

async function assertProviderConnectReady(
  stripe: Stripe,
  operation: PayoutOperation,
) {
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(
      operation.expectedDestinationAccountId,
    );
  } catch (error: any) {
    throw new LegacyPayoutProviderError(
      503,
      clean(error?.code) || "connect_status_unavailable",
      "The host Connect account could not be authoritatively rechecked. No new transfer was submitted.",
    );
  }
  if (
    account.details_submitted !== true ||
    account.charges_enabled !== true ||
    account.payouts_enabled !== true
  ) {
    throw new LegacyPayoutProviderError(
      409,
      "connect_not_ready",
      "Stripe no longer reports the host Connect account ready for charges and payouts. No new transfer was submitted.",
    );
  }
}

async function prepareOperation(input: {
  payoutRequestId: string;
  actorUserId: string | null;
  requestId: string;
  recoveryMode: "staff" | "system";
  recoveryReason: string | null;
}) {
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`legacy_payout_provider:${input.payoutRequestId}`}))`,
    );
    const systemRecovery = input.recoveryMode === "system";
    let actor:
      | { userType: string | null; isDisabled: boolean | null }
      | undefined;
    if (!systemRecovery) {
      [actor] = await tx
        .select({ userType: users.userType, isDisabled: users.isDisabled })
        .from(users)
        .where(eq(users.id, clean(input.actorUserId)))
        .limit(1)
        .for("update");
      if (
        !actor ||
        actor.isDisabled !== false ||
        !staffRoles.has(clean(actor.userType).toLowerCase())
      ) {
        throw new LegacyPayoutProviderError(
          403,
          "payout_authority_revoked",
          "Current staff authority is required to initiate or recover a legacy payout.",
        );
      }
    }
    const [request] = await tx
      .select()
      .from(hostPayoutRequests)
      .where(eq(hostPayoutRequests.id, input.payoutRequestId))
      .limit(1)
      .for("update");
    if (!request) {
      throw new LegacyPayoutProviderError(
        404,
        "payout_request_not_found",
        "Payout request not found.",
      );
    }
    const [exactRequestOperation] = await tx
      .select()
      .from(legacyPayoutProviderOperations)
      .where(
        and(
          eq(
            legacyPayoutProviderOperations.payoutRequestId,
            request.id,
          ),
          eq(legacyPayoutProviderOperations.requestId, input.requestId),
        ),
      )
      .limit(1)
      .for("update");
    const [otherOperation] = exactRequestOperation
      ? []
      : await tx
          .select()
          .from(legacyPayoutProviderOperations)
          .where(
            eq(
              legacyPayoutProviderOperations.payoutRequestId,
              request.id,
            ),
          )
          .limit(1)
          .for("update");
    if (otherOperation) {
      throw new LegacyPayoutProviderError(
        409,
        "payout_operation_request_mismatch",
        "This payout already has a durable provider operation. Resume it with the original request ID; do not start another transfer.",
        {
          operationId: otherOperation.id,
          requiredRequestId: otherOperation.requestId,
          status: otherOperation.status,
        },
      );
    }
    if (exactRequestOperation) {
      const requestDigest = digest({
        version: "legacy-payout-provider-v1",
        payoutRequestId: request.id,
        requestId: input.requestId,
        actorUserId: exactRequestOperation.actorUserId,
        hostId: request.hostId,
        amountCents: request.amountCents,
        currency: "usd",
        destinationAccountId:
          exactRequestOperation.expectedDestinationAccountId,
        fundingTopology: request.fundingTopology,
        eligibleAmountSnapshotCents:
          request.eligibleAmountSnapshotCents,
      });
      if (
        exactRequestOperation.requestDigest !== requestDigest ||
        exactRequestOperation.expectedHostId !== request.hostId ||
        exactRequestOperation.expectedAmountCents !== request.amountCents ||
        exactRequestOperation.expectedFundingTopology !==
          request.fundingTopology ||
        exactRequestOperation.expectedEligibleAmountSnapshotCents !==
          request.eligibleAmountSnapshotCents ||
        request.eligibilityState !== "eligible_legacy"
      ) {
        throw new LegacyPayoutProviderError(
          409,
          "payout_operation_idempotency_mismatch",
          "That request ID is bound to different immutable financial facts.",
        );
      }
      const providerSubmissionStarted =
        exactRequestOperation.attemptCount > 0 ||
        exactRequestOperation.submittedAt !== null ||
        exactRequestOperation.providerTransferId !== null;
      const currentActorUserId = clean(input.actorUserId);
      const isOriginalActor =
        !systemRecovery &&
        currentActorUserId === exactRequestOperation.actorUserId;
      const isRecovery = systemRecovery || !isOriginalActor;
      if (isRecovery && !providerSubmissionStarted) {
        throw new LegacyPayoutProviderError(
          409,
          "payout_recovery_before_submission_forbidden",
          "Only the initiating current staff actor may submit an unsubmitted payout operation. Recovery can only retrieve, search, or finalize an already-submitted immutable operation.",
        );
      }
      let operation = exactRequestOperation;
      if (isRecovery) {
        const now = new Date();
        [operation] = await tx
          .update(legacyPayoutProviderOperations)
          .set({
            recoveryAttemptCount: sql`${legacyPayoutProviderOperations.recoveryAttemptCount} + 1`,
            lastRecoveryActorUserId: systemRecovery
              ? null
              : currentActorUserId,
            lastRecoveryActorType: systemRecovery
              ? "system"
              : "current_staff_takeover",
            lastRecoveryReason:
              clean(input.recoveryReason) ||
              (systemRecovery
                ? "system_exact_provider_recovery"
                : "audited_current_staff_takeover"),
            lastRecoveryAt: now,
            updatedAt: now,
          })
          .where(eq(legacyPayoutProviderOperations.id, operation.id))
          .returning();
      }
      return {
        request,
        operation,
        providerMutationAuthorized:
          !providerSubmissionStarted && isOriginalActor,
      };
    }
    if (systemRecovery) {
      throw new LegacyPayoutProviderError(
        409,
        "payout_recovery_operation_missing",
        "System recovery cannot create a payout operation or provider transfer.",
      );
    }
    const [host] = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, request.hostId))
      .limit(1)
      .for("update");
    const destinationAccountId = clean(host?.stripeConnectAccountId);
    if (
      !host ||
      !destinationAccountId ||
      host.stripeOnboardingCompleted !== true ||
      host.stripeChargesEnabled !== true ||
      host.stripePayoutsEnabled !== true
    ) {
      throw new LegacyPayoutProviderError(
        409,
        "connect_not_ready",
        "The host does not have current local Connect readiness. No transfer was submitted.",
      );
    }
    const summary = await getHostEarningsSummary(request.hostId, tx);
    const ownCommitted =
      ["approved", "processing"].includes(request.status) &&
      request.fundingTopology === "legacy_platform_hold" &&
      request.eligibilityState === "eligible_legacy"
        ? request.amountCents
        : 0;
    const eligibleCapacityCents = summary.availableCents + ownCommitted;
    const eligible =
      request.fundingTopology === "legacy_platform_hold" &&
      request.eligibilityState === "eligible_legacy" &&
      request.amountCents > 0 &&
      request.amountCents <= eligibleCapacityCents;

    if (!eligible) {
      const now = new Date();
      await tx
        .update(hostPayoutRequests)
        .set({
          status: "failed",
          eligibilityState: "requires_revalidation",
          eligibleAmountSnapshotCents: eligibleCapacityCents,
          quarantineReason:
            "Current eligible legacy funds do not support this payout request.",
          updatedAt: now,
        })
        .where(eq(hostPayoutRequests.id, request.id));
      throw new LegacyPayoutProviderError(
        409,
        "legacy_payout_ineligible",
        "This request is quarantined until eligible legacy platform-held funds are revalidated.",
      );
    }

    const operationEligibleSnapshotCents = eligibleCapacityCents;
    await tx
      .update(hostPayoutRequests)
      .set({
        eligibleAmountSnapshotCents: operationEligibleSnapshotCents,
        updatedAt: new Date(),
      })
      .where(eq(hostPayoutRequests.id, request.id));
    const requestDigest = digest({
      version: "legacy-payout-provider-v1",
      payoutRequestId: request.id,
      requestId: input.requestId,
      actorUserId: clean(input.actorUserId),
      hostId: request.hostId,
      amountCents: request.amountCents,
      currency: "usd",
      destinationAccountId,
      fundingTopology: request.fundingTopology,
      eligibleAmountSnapshotCents: operationEligibleSnapshotCents,
    });
    if (request.status !== "approved") {
      throw new LegacyPayoutProviderError(
        409,
        "legacy_payout_unbound_processing",
        "A historical processing/failed payout without a durable provider operation cannot be retried blindly. Reconcile or quarantine it first.",
      );
    }
    const now = new Date();
    const [operation] = await tx
      .insert(legacyPayoutProviderOperations)
      .values({
        payoutRequestId: request.id,
        requestId: input.requestId,
        idempotencyKey: `legacy-host-payout:${request.id}`,
        requestDigest,
        actorUserId: clean(input.actorUserId),
        expectedHostId: request.hostId,
        expectedAmountCents: request.amountCents,
        expectedCurrency: "usd",
        expectedDestinationAccountId: destinationAccountId,
        expectedFundingTopology: "legacy_platform_hold",
        expectedEligibleAmountSnapshotCents:
          operationEligibleSnapshotCents,
        status: "prepared",
        idempotencyExpiresAt: retentionDeadline(now),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx
      .update(hostPayoutRequests)
      .set({
        status: "processing",
        reviewedByUserId: clean(input.actorUserId),
        reviewedAt: now,
        paidAt: null,
        updatedAt: now,
      })
      .where(eq(hostPayoutRequests.id, request.id));
    return {
      request: {
        ...request,
        status: "processing",
        eligibleAmountSnapshotCents: operationEligibleSnapshotCents,
      },
      operation,
      providerMutationAuthorized: true,
    };
  });
}

async function claimProviderSubmission(input: {
  operationId: string;
  actorUserId: string;
}) {
  return db.transaction(async (tx: any) => {
    const [identity] = await tx
      .select({
        payoutRequestId: legacyPayoutProviderOperations.payoutRequestId,
      })
      .from(legacyPayoutProviderOperations)
      .where(eq(legacyPayoutProviderOperations.id, input.operationId))
      .limit(1);
    if (!identity) {
      throw new LegacyPayoutProviderError(
        404,
        "payout_operation_not_found",
        "The durable payout operation no longer exists.",
      );
    }
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`legacy_payout_provider:${identity.payoutRequestId}`}))`,
    );
    const [actor] = await tx
      .select({ userType: users.userType, isDisabled: users.isDisabled })
      .from(users)
      .where(eq(users.id, input.actorUserId))
      .limit(1)
      .for("update");
    if (
      !actor ||
      actor.isDisabled !== false ||
      !staffRoles.has(clean(actor.userType).toLowerCase())
    ) {
      throw new LegacyPayoutProviderError(
        403,
        "payout_authority_revoked",
        "Current staff authority is required at provider submission time.",
      );
    }
    const [operation] = await tx
      .select()
      .from(legacyPayoutProviderOperations)
      .where(eq(legacyPayoutProviderOperations.id, input.operationId))
      .limit(1)
      .for("update");
    if (!operation) {
      throw new LegacyPayoutProviderError(
        404,
        "payout_operation_not_found",
        "The durable payout operation no longer exists.",
      );
    }
    if (
      operation.actorUserId !== input.actorUserId ||
      operation.attemptCount > 0 ||
      operation.submittedAt !== null ||
      operation.providerTransferId !== null ||
      operation.status === "provider_confirmed" ||
      operation.status === "quarantined"
    ) {
      return { operation, claimed: false } as const;
    }
    if (operation.idempotencyExpiresAt.getTime() <= Date.now()) {
      throw new LegacyPayoutProviderError(
        409,
        "provider_idempotency_retention_expired",
        "The unsubmitted payout operation expired before provider submission. It cannot create a transfer.",
      );
    }
    const now = new Date();
    const [submitted] = await tx
      .update(legacyPayoutProviderOperations)
      .set({
        status: "submitted",
        attemptCount: 1,
        lastAttemptAt: now,
        submittedAt: now,
        providerErrorCode: null,
        providerErrorMessage: null,
        updatedAt: now,
      })
      .where(eq(legacyPayoutProviderOperations.id, operation.id))
      .returning();
    return { operation: submitted, claimed: true } as const;
  });
}

async function finalizeTransfer(input: {
  operationId: string;
  transfer: Stripe.Transfer;
}) {
  return db.transaction(async (tx: any) => {
    const [operationIdentity] = await tx
      .select({
        payoutRequestId: legacyPayoutProviderOperations.payoutRequestId,
      })
      .from(legacyPayoutProviderOperations)
      .where(eq(legacyPayoutProviderOperations.id, input.operationId))
      .limit(1);
    if (!operationIdentity) {
      throw new Error("Legacy payout provider operation disappeared.");
    }
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`legacy_payout_provider:${operationIdentity.payoutRequestId}`}))`,
    );
    const [request] = await tx
      .select()
      .from(hostPayoutRequests)
      .where(eq(hostPayoutRequests.id, operationIdentity.payoutRequestId))
      .limit(1)
      .for("update");
    if (!request) throw new Error("Legacy payout request disappeared.");
    const [operation] = await tx
      .select()
      .from(legacyPayoutProviderOperations)
      .where(eq(legacyPayoutProviderOperations.id, input.operationId))
      .limit(1)
      .for("update");
    if (
      !operation ||
      operation.payoutRequestId !== operationIdentity.payoutRequestId
    ) {
      throw new Error("Legacy payout provider operation identity changed.");
    }
    if (operation.status === "provider_confirmed") {
      return { request, operation };
    }
    if (!exactTransferMatch(input.transfer, operation)) {
      throw new LegacyPayoutProviderError(
        409,
        "provider_transfer_identity_mismatch",
        "The Stripe transfer does not match the durable payout identity.",
      );
    }
    if (
      request.hostId !== operation.expectedHostId ||
      request.amountCents !== operation.expectedAmountCents ||
      request.fundingTopology !== operation.expectedFundingTopology ||
      request.eligibilityState !== "eligible_legacy" ||
      request.eligibleAmountSnapshotCents !==
        operation.expectedEligibleAmountSnapshotCents
    ) {
      throw new LegacyPayoutProviderError(
        409,
        "payout_request_facts_changed",
        "The payout request facts changed before provider confirmation.",
      );
    }
    const now = new Date();
    const [confirmedOperation] = await tx
      .update(legacyPayoutProviderOperations)
      .set({
        status: "provider_confirmed",
        providerTransferId: input.transfer.id,
        providerStatus: "succeeded",
        providerErrorCode: null,
        providerErrorMessage: null,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(legacyPayoutProviderOperations.id, operation.id))
      .returning();
    const [existingLedger] = await tx
      .select({ id: hostEarningsLedger.id })
      .from(hostEarningsLedger)
      .where(
        and(
          eq(hostEarningsLedger.entryType, "payout"),
          eq(hostEarningsLedger.stripePaymentIntentId, input.transfer.id),
        ),
      )
      .limit(1);
    if (!existingLedger) {
      await tx.insert(hostEarningsLedger).values({
        hostId: request.hostId,
        bookingId: null,
        stripePaymentIntentId: input.transfer.id,
        entryType: "payout",
        sourceType: "host_payout_request",
        settlementTopology: "legacy_platform_hold",
        reconciliationState: "eligible_legacy",
        amountCents: -Math.abs(request.amountCents),
        description: `Legacy platform-held payout transferred to Connect (${request.id})`,
        createdAt: now,
      });
    }
    const [completedRequest] = await tx
      .update(hostPayoutRequests)
      .set({
        status: "transferred_to_connect",
        notes: `stripe_transfer:${input.transfer.id}`,
        providerTransferId: input.transfer.id,
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(hostPayoutRequests.id, request.id))
      .returning();
    return { request: completedRequest, operation: confirmedOperation };
  });
}

export async function executeLegacyPayoutTransfer(input: {
  payoutRequestId: string;
  actorUserId?: string | null;
  requestId: string;
  stripe?: Stripe | null;
  recovery?: { mode: "system"; reason: string };
}) {
  const payoutRequestId = clean(input.payoutRequestId);
  const actorUserId = clean(input.actorUserId);
  const requestId = clean(input.requestId);
  const systemRecovery = input.recovery?.mode === "system";
  const recoveryReason = clean(input.recovery?.reason);
  const stripe = input.stripe === undefined ? configuredStripe : input.stripe;
  if (
    !payoutRequestId ||
    requestId.length < 8 ||
    (systemRecovery ? !recoveryReason : !actorUserId)
  ) {
    throw new LegacyPayoutProviderError(
      400,
      "legacy_payout_identity_required",
      "Payout, stable Idempotency-Key, and either a current staff actor or an explicit system recovery reason are required.",
    );
  }
  const prepared = await prepareOperation({
    payoutRequestId,
    actorUserId: systemRecovery ? null : actorUserId,
    requestId,
    recoveryMode: systemRecovery ? "system" : "staff",
    recoveryReason: recoveryReason || null,
  });
  let operation = prepared.operation;
  if (operation.status === "provider_confirmed" && operation.providerTransferId) {
    return { request: prepared.request, operation };
  }
  if (!stripe) {
    operation = await markActionRequired({
      operationId: operation.id,
      code: "stripe_not_configured",
      message:
        "Stripe is unavailable. The durable payout remains processing and no new transfer was submitted.",
    });
    throw new LegacyPayoutProviderError(
      503,
      "stripe_not_configured",
      operation!.providerErrorMessage!,
      { operation: serializeLegacyPayoutProviderOperation(operation!) },
    );
  }

  let transfer: Stripe.Transfer | null = null;
  try {
    if (operation.providerTransferId) {
      transfer = await stripe.transfers.retrieve(operation.providerTransferId);
    } else if (
      operation.attemptCount > 0 ||
      operation.submittedAt !== null
    ) {
      const recovery = await findOperationTransfers(stripe, operation);
      if (recovery.bound.some((candidate) => !exactTransferMatch(candidate, operation))) {
        throw new LegacyPayoutProviderError(
          409,
          "provider_transfer_identity_mismatch",
          "A provider transfer references this payout but does not match its exact amount, currency, destination, topology, and metadata.",
        );
      }
      if (recovery.exact.length > 1) {
        throw new LegacyPayoutProviderError(
          409,
          "provider_transfer_ambiguous",
          "Multiple exact provider transfers reference this operation. Staff reconciliation is required.",
        );
      }
      transfer = recovery.exact[0] || null;
      if (!transfer && operation.idempotencyExpiresAt.getTime() <= Date.now()) {
        throw new LegacyPayoutProviderError(
          409,
          "provider_idempotency_retention_expired",
          "No exact transfer could be proven after provider idempotency retention. Do not retry the transfer.",
        );
      }
    }
    if (!transfer) {
      if (!prepared.providerMutationAuthorized) {
        throw new LegacyPayoutProviderError(
          409,
          "provider_transfer_unproven",
          "The submitted payout has no exact provider transfer proof yet. Recovery may retrieve, search, or finalize it, but must never create another transfer.",
        );
      }
      // Current Connect readiness gates only a new provider mutation. An
      // already-submitted transfer must remain recoverable by exact provider
      // identity even if onboarding is later revoked.
      await assertProviderConnectReady(stripe, operation);
      const submission = await claimProviderSubmission({
        operationId: operation.id,
        actorUserId,
      });
      operation = submission.operation;
      if (!submission.claimed) {
        if (operation.providerTransferId) {
          transfer = await stripe.transfers.retrieve(
            operation.providerTransferId,
          );
        } else {
          const recovery = await findOperationTransfers(stripe, operation);
          if (
            recovery.bound.some(
              (candidate) => !exactTransferMatch(candidate, operation),
            )
          ) {
            throw new LegacyPayoutProviderError(
              409,
              "provider_transfer_identity_mismatch",
              "A concurrently submitted provider transfer does not match the exact durable payout identity.",
            );
          }
          if (recovery.exact.length !== 1) {
            throw new LegacyPayoutProviderError(
              409,
              recovery.exact.length > 1
                ? "provider_transfer_ambiguous"
                : "provider_submission_in_progress",
              recovery.exact.length > 1
                ? "Multiple exact transfers reference this payout operation. Staff reconciliation is required."
                : "Another worker claimed provider submission. Exact recovery is required; this worker will not create a transfer.",
            );
          }
          transfer = recovery.exact[0];
        }
      }
      if (transfer) {
        return await finalizeTransfer({ operationId: operation.id, transfer });
      }
      transfer = await stripe.transfers.create(
        {
          amount: operation.expectedAmountCents,
          currency: operation.expectedCurrency,
          destination: operation.expectedDestinationAccountId,
          description: `MealScout legacy host payout - request ${operation.payoutRequestId}`,
          metadata: {
            providerOperationId: operation.id,
            payoutRequestId: operation.payoutRequestId,
            hostId: operation.expectedHostId,
            actorUserId: operation.actorUserId,
            settlementTopology: operation.expectedFundingTopology,
          },
        },
        { idempotencyKey: operation.idempotencyKey },
      );
    }
    return await finalizeTransfer({ operationId: operation.id, transfer });
  } catch (error: any) {
    const providerError =
      error instanceof LegacyPayoutProviderError
        ? error
        : new LegacyPayoutProviderError(
            502,
            clean(error?.code) || "provider_transfer_ambiguous",
            clean(error?.message) ||
              "Stripe transfer submission is ambiguous; exact recovery is required before retry.",
          );
    const marked = await markActionRequired({
      operationId: operation.id,
      code: providerError.code,
      message: providerError.message,
    });
    throw new LegacyPayoutProviderError(
      providerError.statusCode,
      providerError.code,
      providerError.message,
      marked
        ? { operation: serializeLegacyPayoutProviderOperation(marked) }
        : undefined,
    );
  }
}

export async function getLegacyPayoutProviderOperation(
  payoutRequestId: string,
) {
  const [operation] = await db
    .select()
    .from(legacyPayoutProviderOperations)
    .where(
      eq(
        legacyPayoutProviderOperations.payoutRequestId,
        clean(payoutRequestId),
      ),
    )
    .limit(1);
  return operation || null;
}
