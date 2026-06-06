import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { __testables } from "./import-merlin-profile-seeds";

const {
  MERLIN_EVIDENCE_SEED_MAX_BATCH_SIZE,
  normalizeSeed,
  validateSeed,
  classifyMerlinSeedBatch,
  mergeSeedRawData,
  assertBatchCanApply,
} = __testables;

const baseRow = {
  brand_lane: "MEALSCOUT",
  target_profile_type: "food_truck",
  seeded_from_evidence: true,
  profile_origin: "evidence_seed",
  import_decision: "clean",
  onboarding_source: "screenshot_seed",
  claim_status: "unclaimed",
  email_verified: false,
  insurance_verified: false,
  owner_user_id: null,
  invited_user_id: null,
  city: "Pensacola",
  state: "FL",
  phone: "850-555-0199",
  source_export_id: "merlin-export-2026-06-06",
};

const acceptedRow = {
  ...baseRow,
  target_profile_id: "batch-truck-001",
  row_id: "row-001",
  profile_name: "Batch Pupusa Truck",
  profile_email: "batch-pupusa@example.org",
};

const duplicateRow = {
  ...baseRow,
  target_profile_id: "batch-truck-001",
  row_id: "row-002",
  profile_name: "Batch Pupusa Truck Duplicate",
  profile_email: "batch-pupusa-duplicate@example.org",
};

const quarantinedRow = {
  ...baseRow,
  target_profile_id: "batch-truck-002",
  row_id: "row-003",
  profile_name: "Batch Review Truck",
  profile_email: "batch-review@example.org",
  import_decision: "review_required",
};

const rejectedRow = {
  ...baseRow,
  target_profile_id: "batch-truck-003",
  row_id: "row-004",
  profile_name: "Batch Claimed Truck",
  profile_email: "batch-claimed@example.org",
  claim_status: "claimed",
};

assert.equal(
  MERLIN_EVIDENCE_SEED_MAX_BATCH_SIZE,
  500,
  "safe max batch size must stay explicit and conservative",
);

const partial = classifyMerlinSeedBatch(
  [acceptedRow, duplicateRow, quarantinedRow, rejectedRow],
  { batchId: "merlin-readiness-contract" },
);

assert.equal(partial.batchId, "merlin-readiness-contract");
assert.equal(partial.sourceExportId, "merlin-export-2026-06-06");
assert.equal(partial.outcome, "partial_classified");
assert.equal(partial.shouldMutate, false);
assert.equal(partial.noPartialSuccessAsFullSuccess, true);
assert.deepEqual(partial.counts, {
  accepted: 1,
  quarantined: 1,
  rejected: 1,
  duplicatesSuppressed: 1,
});

for (const outcome of partial.outcomes) {
  assert.equal(outcome.sourceExportId, "merlin-export-2026-06-06");
  assert.equal(typeof outcome.index, "number");
  assert.equal(Boolean(outcome.rowId), true);
  assert.match(
    outcome.action,
    /^(accepted|quarantined|rejected|duplicate_suppressed)$/,
  );
  assert.equal(Boolean(outcome.reason), true);
}

assert.equal(partial.outcomes[1].action, "duplicate_suppressed");
assert.equal(partial.outcomes[1].reason, "duplicate_idempotency_lock");
assert.equal(partial.outcomes[2].action, "quarantined");
assert.equal(partial.outcomes[2].reason, "review_required");
assert.equal(partial.outcomes[3].action, "rejected");
assert.equal(partial.outcomes[3].reason, "invalid_safety_flags");
assert.throws(
  () => assertBatchCanApply(partial),
  /partial success cannot be reported as full success/,
);

const oversized = classifyMerlinSeedBatch(
  Array.from({ length: MERLIN_EVIDENCE_SEED_MAX_BATCH_SIZE + 1 }, (_, index) => ({
    ...acceptedRow,
    target_profile_id: `oversized-${index}`,
    row_id: `oversized-row-${index}`,
    profile_name: `Oversized Batch Truck ${index}`,
    profile_email: `oversized-${index}@example.org`,
  })),
);
assert.equal(oversized.outcome, "rejected_before_mutation");
assert.equal(oversized.shouldMutate, false);
assert.equal(oversized.counts.rejected, MERLIN_EVIDENCE_SEED_MAX_BATCH_SIZE + 1);
assert.equal(
  oversized.outcomes.every((outcome) => outcome.reason === "batch_size_exceeds_limit"),
  true,
  "oversized batch must reject every row before mutation",
);

const accepted = classifyMerlinSeedBatch(
  [
    acceptedRow,
    {
      ...baseRow,
      target_profile_id: "batch-truck-004",
      row_id: "row-005",
      profile_name: "Batch Arepa Truck",
      profile_email: "batch-arepa@example.org",
    },
  ],
  { batchId: "merlin-accepted-contract" },
);
assert.equal(accepted.outcome, "accepted");
assert.equal(accepted.shouldMutate, true);
assert.doesNotThrow(() => assertBatchCanApply(accepted));

const safeSeed = normalizeSeed(acceptedRow);
assert.equal(validateSeed(safeSeed).ok, true);
const rawData = mergeSeedRawData({}, safeSeed, {
  ...accepted.outcomes[0],
  batchId: accepted.batchId,
}) as any;
assert.equal(rawData.merlinSeed.profile_origin, "evidence_seed");
assert.equal(rawData.merlinSeed.claim_status, "unclaimed");
assert.equal(rawData.merlinSeed.email_verified, false);
assert.equal(rawData.merlinSeed.insurance_verified, false);
assert.equal(rawData.merlinSeed.owner_user_id, null);
assert.equal(rawData.merlinSeed.invited_user_id, null);
assert.equal(rawData.merlinSeed.affiliate_user_id, null);
assert.equal(rawData.merlinSeed.affiliate_tag, null);
assert.equal(rawData.merlinSeed.referral_code, null);
assert.equal(rawData.merlinSeed.import_batch.batch_id, accepted.batchId);
assert.equal(rawData.merlinSeed.import_batch.source_export_id, "merlin-export-2026-06-06");
assert.equal(rawData.merlinSeed.import_batch.row_index, 1);
assert.equal(rawData.merlinSeed.import_batch.row_id, "row-001");
assert.equal(rawData.merlinSeed.import_batch.classification, "accepted");
assert.equal(rawData.merlinSeed.import_batch.reason_code, "safe_evidence_seed");
assert.equal(rawData.merlinSeed.import_batch.manual_review_required, false);
assert.equal(rawData.merlinSeed.import_batch.trusted_public_state_created, false);

const importer = readFileSync("scripts/import-merlin-profile-seeds.ts", "utf8");
const requiredSnippets = [
  "MERLIN_EVIDENCE_SEED_MAX_BATCH_SIZE",
  "classifyMerlinSeedBatch",
  "noPartialSuccessAsFullSuccess",
  "assertBatchCanApply(classification)",
  "db.transaction(async (tx)",
  "createBatchAuditLedger",
  "finalizeBatchAuditLedger",
  "manual_review_required",
  "trusted_public_state_created: false",
  "admin_quarantine_visibility:",
  "row_outcome_ledger:",
  "rollback_noop_behavior:",
];

for (const snippet of requiredSnippets) {
  assert.equal(
    importer.includes(snippet),
    true,
    `batch readiness guardrail missing snippet: ${snippet}`,
  );
}

console.log("mealscout-merlin-batch-readiness.contract: PASS");
