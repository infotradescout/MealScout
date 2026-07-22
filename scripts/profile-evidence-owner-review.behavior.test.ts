import assert from "node:assert/strict";

import {
  PROFILE_EVIDENCE_FIELD_REGISTRY,
  PROFILE_EVIDENCE_REVIEW_FIELDS,
  PROFILE_EVIDENCE_REVIEW_LIMITS,
  normalizeProfileEvidenceReviewValue,
  resolveProfileEvidenceReviewField,
  type ProfileEvidenceReviewDecision,
  type ProfileEvidenceReviewLedger,
} from "../shared/profileEvidenceReview";
import {
  appendProfileEvidenceReviewProposals,
  bindProfileEvidenceProposalImageReferences,
  buildProfileEvidenceOwnerReviewDto,
  compactProfileEvidenceIntakeRequests,
  countActiveProfileEvidenceIntakeRequests,
  createProfileEvidenceIntakeRequestFingerprint,
  createProfileEvidenceProposalId,
  createProfileEvidenceValueFingerprint,
  isDirectProfileEvidenceApplyDisabledMode,
  isProfileEvidenceDecisionSourceInspectable,
  mergeProfileEvidenceApplySettings,
  mergeProfileEvidenceQueueContainer,
  mergeProfileEvidenceQueueContainerWithReport,
  normalizeLegacyProfileEvidenceProposals,
  normalizeProfileEvidenceProposalBatch,
  normalizeProfileEvidenceReviewLedger,
  normalizeQueuedProfileEvidenceMenuItems,
  normalizeQueuedProfileEvidenceScheduleItems,
  normalizeQueuedProfileEvidenceTextItems,
  parseDirectApplyMenuPriceCents,
  planProfileEvidenceReviewDecision,
} from "../server/services/profileEvidenceReview";
import {
  hasProfileEvidenceReviewAccess,
  hasProfileEvidenceReviewDecisionAccess,
} from "../server/services/profileEvidenceReviewAccess";

const RESTAURANT_ID = "restaurant-1";
const ACTOR_ID = "owner-1";
const RECEIVED_AT = "2026-07-22T12:00:00.000Z";
const DECIDED_AT = "2026-07-22T13:00:00.000Z";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_UPLOAD_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMAGE_UPLOAD_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMAGE_UPLOAD_ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MISSING_IMAGE_UPLOAD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

assert.equal(isDirectProfileEvidenceApplyDisabledMode("apply"), true);
assert.equal(isDirectProfileEvidenceApplyDisabledMode(" APPLY "), true);
assert.equal(
  isDirectProfileEvidenceApplyDisabledMode("queue_owner_review"),
  false,
);
assert.equal(isDirectProfileEvidenceApplyDisabledMode("dry_run"), false);

assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "owner-1",
    userType: "restaurant_owner",
    restaurantId: "restaurant-1",
    ownerId: "owner-1",
  }),
  true,
);
assert.equal(
  hasProfileEvidenceReviewDecisionAccess({
    userId: "staff-1",
    userType: "staff",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
  }),
  false,
  "staff may inspect evidence but must not publish a decision",
);
assert.equal(
  hasProfileEvidenceReviewDecisionAccess({
    userId: "admin-1",
    userType: "admin",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
  }),
  true,
  "true admins may make a profile evidence decision",
);
assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "owner-1",
    userType: "restaurant_owner",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
  }),
  false,
  "an account-wide owner role must not grant a different business",
);
assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "collaborator-1",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
    membership: {
      userId: "collaborator-1",
      restaurantId: "restaurant-2",
      status: "active",
      permissions: { manageProfile: true },
    },
  }),
  true,
);
assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "collaborator-1",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
    membership: {
      userId: "collaborator-1",
      restaurantId: "restaurant-1",
      status: "active",
      permissions: { manageProfile: true },
    },
  }),
  false,
  "manageProfile on one business must not cross into another",
);
assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "collaborator-1",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
    membership: {
      userId: "collaborator-1",
      restaurantId: "restaurant-2",
      status: "invited",
      permissions: { manageProfile: true },
    },
  }),
  false,
);
assert.equal(
  hasProfileEvidenceReviewAccess({
    userId: "staff-1",
    userType: "staff",
    restaurantId: "restaurant-2",
    ownerId: "owner-2",
  }),
  true,
);

assert.deepEqual(Object.keys(PROFILE_EVIDENCE_FIELD_REGISTRY), [
  ...PROFILE_EVIDENCE_REVIEW_FIELDS,
]);
assert.equal(resolveProfileEvidenceReviewField("category"), "cuisineType");
assert.equal(resolveProfileEvidenceReviewField("facebook_page_url"), "facebookPageUrl");
assert.equal(resolveProfileEvidenceReviewField("onlineOrderingUrl"), "onlineOrderingUrl");
for (const protectedField of [
  "name",
  "address",
  "ownerId",
  "businessType",
  "isFoodTruck",
  "isActive",
  "isVerified",
  "latitude",
  "longitude",
  "menuUrl",
  "logoUrl",
  "schedule",
]) {
  assert.equal(
    resolveProfileEvidenceReviewField(protectedField),
    null,
    `${protectedField} must never resolve into the owner-review allowlist`,
  );
}

assert.equal(
  normalizeProfileEvidenceReviewValue("cuisineType", "  Southern   food  "),
  "Southern food",
);
assert.equal(
  normalizeProfileEvidenceReviewValue("description", " Line one. \r\nLine two.  "),
  "Line one.\nLine two.",
);
assert.equal(
  normalizeProfileEvidenceReviewValue("websiteUrl", "https://Example.com/menu"),
  "https://example.com/menu",
);
assert.equal(
  normalizeProfileEvidenceReviewValue("phone", "+1 (850) 555-0100"),
  "+1 (850) 555-0100",
);
assert.throws(
  () => normalizeProfileEvidenceReviewValue("websiteUrl", "javascript:alert(1)"),
  /HTTP or HTTPS/,
);
assert.throws(
  () =>
    normalizeProfileEvidenceReviewValue(
      "websiteUrl",
      "https://user:password@example.com/",
    ),
  /embedded credentials/,
);
assert.throws(
  () =>
    normalizeProfileEvidenceReviewValue(
      "instagramUrl",
      "https://example.com/not-instagram",
    ),
  /expected Instagram host/,
);
assert.throws(
  () => normalizeProfileEvidenceReviewValue("phone", "call-me-maybe"),
  /unsupported characters/,
);

const idInput = {
  restaurantId: RESTAURANT_ID,
  field: "phone" as const,
  proposedValue: "+1 (850) 555-0100",
  sourceIdentity: "screenshot:contact-card-1",
};
const proposalId = createProfileEvidenceProposalId(idInput);
assert.match(proposalId, /^[a-f0-9]{64}$/);
assert.equal(createProfileEvidenceProposalId(idInput), proposalId);
assert.notEqual(
  createProfileEvidenceProposalId({
    ...idInput,
    sourceIdentity: "screenshot:contact-card-2",
  }),
  proposalId,
);
assert.equal(
  createProfileEvidenceValueFingerprint("phone", "+1 (850) 555-0100"),
  createProfileEvidenceValueFingerprint("phone", "+1 (850) 555-0100"),
);
assert.notEqual(
  createProfileEvidenceValueFingerprint("phone", "+1 (850) 555-0100"),
  createProfileEvidenceValueFingerprint("phone", "+1 (850) 555-0101"),
);

const intakeFingerprint = createProfileEvidenceIntakeRequestFingerprint({
  requestBody: {
    mode: "queue_owner_review",
    intakeRequestId: "intake-1234",
    approvals: { menuOverwrite: false },
  },
  files: [],
});
assert.notEqual(
  intakeFingerprint,
  createProfileEvidenceIntakeRequestFingerprint({
    requestBody: {
      mode: "queue_owner_review",
      intakeRequestId: "intake-1234",
      approvals: { menuOverwrite: true },
    },
    files: [],
  }),
  "the same intake key with changed persistence semantics must conflict",
);
assert.equal(
  intakeFingerprint,
  createProfileEvidenceIntakeRequestFingerprint({
    requestBody: {
      approvals: { menuOverwrite: false },
      intakeRequestId: "intake-1234",
      mode: "queue_owner_review",
    },
    files: [],
  }),
  "request fingerprinting must be stable across object key order",
);

const legacyRows = [
  {
    field: "phone",
    proposedValue: "+1 (850) 555-0100",
    confidence: "high",
    source: "screenshot",
    evidenceText: "Call +1 (850) 555-0100",
    imageRef: "contact-card-1",
  },
  {
    field: "phone",
    proposedValue: "+1 (850) 555-0100",
    confidence: "high",
    source: "screenshot",
    evidenceText: "Call +1 (850) 555-0100",
    imageRef: "contact-card-1",
  },
  {
    field: "ownerId",
    proposedValue: "attacker",
    confidence: "high",
  },
  {
    field: "instagram",
    proposedValue: "javascript:alert(1)",
    confidence: "high",
  },
];
const normalizationOptions = {
  restaurantId: RESTAURANT_ID,
  fallbackReceivedAt: RECEIVED_AT,
  defaultBatchId: "batch-1",
  currentValues: { phone: null },
};
const normalizedLegacy = normalizeLegacyProfileEvidenceProposals(
  legacyRows,
  normalizationOptions,
);
assert.equal(normalizedLegacy.length, 1);
assert.equal(normalizedLegacy[0].field, "phone");
assert.equal(normalizedLegacy[0].sourceKind, "screenshot");
assert.deepEqual(
  normalizedLegacy[0].imageEvidenceIds,
  [],
  "legacy filename aliases must not survive normalization",
);
assert.equal(normalizedLegacy[0].currentValueAtIntake, null);

const boundFilenameProposal = bindProfileEvidenceProposalImageReferences(
  [
    {
      field: "phone",
      proposedValue: "850-555-0100",
      imageRef: "contact-card.png",
    },
  ],
  [
    {
      imageUploadId: IMAGE_UPLOAD_ID_A,
      sha256: "a".repeat(64),
      normalizedFilename: "contact-card.png",
      originalFilename: "contact-card.png",
    },
  ],
);
assert.deepEqual((boundFilenameProposal[0] as any).imageEvidenceIds, [
  IMAGE_UPLOAD_ID_A,
]);
assert.equal("imageRef" in (boundFilenameProposal[0] as any), false);
const reboundAfterFilenameReuse = bindProfileEvidenceProposalImageReferences(
  boundFilenameProposal,
  [
    {
      imageUploadId: IMAGE_UPLOAD_ID_B,
      sha256: "b".repeat(64),
      normalizedFilename: "contact-card.png",
      originalFilename: "contact-card.png",
    },
  ],
);
assert.deepEqual(
  (reboundAfterFilenameReuse[0] as any).imageEvidenceIds,
  [IMAGE_UPLOAD_ID_A],
  "a later upload reusing the filename must not rebind persisted evidence",
);
const ambiguousFilenameProposal = bindProfileEvidenceProposalImageReferences(
  [{ field: "phone", proposedValue: "850-555-0100", imageRef: "same.png" }],
  [
    { imageUploadId: IMAGE_UPLOAD_ID_A, normalizedFilename: "same.png" },
    { imageUploadId: IMAGE_UPLOAD_ID_B, normalizedFilename: "same.png" },
  ],
);
assert.deepEqual(
  (ambiguousFilenameProposal[0] as any).imageEvidenceIds,
  [],
  "ambiguous filename aliases must fail closed",
);

const canonicalIntakeValue = normalizeLegacyProfileEvidenceProposals(
  [
    {
      field: "description",
      proposedValue: "Suggested description",
      currentValueAtIntake: "attacker supplied".repeat(10_000),
    },
  ],
  {
    ...normalizationOptions,
    currentValues: { description: "Canonical database value" },
  },
)[0];
assert.equal(
  canonicalIntakeValue.currentValueAtIntake,
  "Canonical database value",
  "caller-supplied currentValueAtIntake must never enter the ledger",
);

const proposalBatch = normalizeProfileEvidenceProposalBatch(
  legacyRows,
  normalizationOptions,
);
assert.equal(proposalBatch.proposals.length, 1);
assert.equal(proposalBatch.acceptedIds.length, 1);
assert.equal(proposalBatch.duplicateIds.length, 1);
assert.deepEqual(
  proposalBatch.rejected.map((item) => item.code),
  ["unsupported_field", "invalid_value"],
);

const boundedRows = Array.from(
  { length: PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch + 10 },
  (_, index) => ({
    field: "description",
    proposedValue: `Description ${index}`,
    source: "website",
    imageRef: `source-${index}`,
  }),
);
assert.equal(
  normalizeLegacyProfileEvidenceProposals(boundedRows, normalizationOptions)
    .length,
  PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
);

let ledger = normalizeProfileEvidenceReviewLedger(
  { evidenceFieldProposals: legacyRows },
  normalizationOptions,
);
assert.equal(ledger.schemaVersion, 2);
assert.equal(ledger.proposals.length, 1);
assert.deepEqual(ledger.decisions, {});

const existingDecision: ProfileEvidenceReviewDecision = {
  action: "declined",
  appliedValue: null,
  previousValue: null,
  previousValueFingerprint: createProfileEvidenceValueFingerprint("phone", null),
  decidedAt: DECIDED_AT,
  decidedByUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
};
const ledgerWithDecision: ProfileEvidenceReviewLedger = {
  ...ledger,
  decisions: { [ledger.proposals[0].id]: existingDecision },
};
const descriptionProposal = normalizeLegacyProfileEvidenceProposals(
  [
    {
      field: "description",
      proposedValue: "Family recipes served daily.",
      source: "website",
      sourceUrl: "https://example.com/about",
    },
  ],
  { ...normalizationOptions, defaultBatchId: "batch-2" },
)[0];
const appended = appendProfileEvidenceReviewProposals(
  ledgerWithDecision,
  [ledger.proposals[0], descriptionProposal],
  normalizationOptions,
);
assert.equal(appended.addedIds.length, 1);
assert.equal(appended.duplicateIds.length, 1);
assert.equal(appended.rejectedCount, 0);
const {
  requestFingerprint: normalizedLegacyRequestFingerprint,
  ...normalizedLegacyDecision
} = appended.ledger.decisions[ledger.proposals[0].id];
assert.deepEqual(
  normalizedLegacyDecision,
  existingDecision,
  "append must preserve the legacy decision semantics",
);
assert.match(
  normalizedLegacyRequestFingerprint || "",
  /^[a-f0-9]{64}$/,
  "normalization must backfill a deterministic request fingerprint",
);
assert.equal(appended.ledger.proposals.length, 2);

const boundedLegacyDecisionLedger = normalizeProfileEvidenceReviewLedger(
  {
    ownerReview: {
      proposals: [descriptionProposal],
      decisions: {
        [descriptionProposal.id]: {
          action: "declined",
          appliedValue: null,
          previousValue: "p".repeat(20_000),
          decidedAt: DECIDED_AT,
          decidedByUserId: ACTOR_ID,
          clientRequestId: REQUEST_ID,
        },
      },
    },
  },
  normalizationOptions,
);
assert.equal(
  boundedLegacyDecisionLedger.decisions[descriptionProposal.id].previousValue
    ?.length,
  PROFILE_EVIDENCE_FIELD_REGISTRY.description.maxLength,
  "legacy decision previousValue must remain field-bounded",
);

const dto = buildProfileEvidenceOwnerReviewDto({
  restaurantId: RESTAURANT_ID,
  ledger: appended.ledger,
  currentValues: {
    phone: null,
    description: "Current description",
  },
});
assert.equal(dto.pendingCount, 1);
assert.equal(dto.proposals[0].field, "description");
assert.equal(dto.proposals[0].currentValue, "Current description");
assert.equal(dto.proposals[0].source.url, "https://example.com/about");
assert.deepEqual(Object.keys(dto.proposals[0]).sort(), [
  "confidence",
  "currentValue",
  "currentValueFingerprint",
  "field",
  "id",
  "label",
  "proposedValue",
  "receivedAt",
  "source",
  "valueKind",
]);
assert.equal("sourceIdentity" in dto.proposals[0], false);
assert.equal("batchId" in dto.proposals[0], false);

const screenshotProposal = normalizeLegacyProfileEvidenceProposals(
  [
    {
      field: "phone",
      proposedValue: "850-555-0199",
      sourceKind: "screenshot",
      sourceLabel: "Owner-provided contact card",
      imageEvidenceIds: [IMAGE_UPLOAD_ID_A],
    },
  ],
  { ...normalizationOptions, defaultBatchId: "screenshot-batch" },
)[0];
const screenshotIdentityVariants = [
  ...[
    {
      field: "phone",
      proposedValue: "850-555-0199",
      sourceKind: "screenshot",
      sourceUrl: "https://business.example/contact",
      imageEvidenceIds: [IMAGE_UPLOAD_ID_B, IMAGE_UPLOAD_ID_A],
    },
    {
      field: "phone",
      proposedValue: "850-555-0199",
      sourceKind: "screenshot",
      sourceUrl: "https://business.example/contact",
      imageEvidenceIds: [IMAGE_UPLOAD_ID_A, IMAGE_UPLOAD_ID_B],
    },
    {
      field: "phone",
      proposedValue: "850-555-0199",
      sourceKind: "screenshot",
      sourceUrl: "https://business.example/contact",
      imageEvidenceIds: [IMAGE_UPLOAD_ID_C],
    },
  ].map(
    (proposal) =>
      normalizeLegacyProfileEvidenceProposals([proposal], {
        ...normalizationOptions,
        defaultBatchId: "screenshot-identity-batch",
      })[0],
  ),
];
assert.equal(screenshotIdentityVariants[0].id, screenshotIdentityVariants[1].id);
assert.notEqual(
  screenshotIdentityVariants[0].id,
  screenshotIdentityVariants[2].id,
);
const screenshotLedger: ProfileEvidenceReviewLedger = {
  schemaVersion: 2,
  proposals: [screenshotProposal],
  decisions: {},
};
const visibleScreenshotDto = buildProfileEvidenceOwnerReviewDto({
  restaurantId: RESTAURANT_ID,
  ledger: screenshotLedger,
  currentValues: { phone: null },
  evidenceImagesById: {
    [IMAGE_UPLOAD_ID_A]: "https://cdn.example/evidence/contact-card.jpg",
  },
});
assert.equal(visibleScreenshotDto.proposals[0].source.reviewable, true);
assert.deepEqual(visibleScreenshotDto.proposals[0].source.images, [
  {
    id: IMAGE_UPLOAD_ID_A,
    url: "https://cdn.example/evidence/contact-card.jpg",
  },
]);
assert.equal(
  visibleScreenshotDto.proposals[0].source.unavailableReason,
  null,
);

const opaqueScreenshotDto = buildProfileEvidenceOwnerReviewDto({
  restaurantId: RESTAURANT_ID,
  ledger: screenshotLedger,
  currentValues: { phone: null },
  evidenceImagesById: {
    [IMAGE_UPLOAD_ID_A]: "javascript:alert(1)",
  },
});
assert.equal(opaqueScreenshotDto.proposals[0].source.reviewable, false);
assert.deepEqual(opaqueScreenshotDto.proposals[0].source.images, []);
assert.match(
  String(opaqueScreenshotDto.proposals[0].source.unavailableReason),
  /not available/i,
);

const unresolvedScreenshotWithText = normalizeLegacyProfileEvidenceProposals(
  [
    {
      field: "phone",
      proposedValue: "850-555-0198",
      sourceKind: "screenshot",
      sourceLabel: "Unresolved contact screenshot",
      sourceUrl: "https://business.example/contact",
      evidenceExcerpt: "Call 850-555-0198",
      imageEvidenceIds: [MISSING_IMAGE_UPLOAD_ID],
    },
  ],
  { ...normalizationOptions, defaultBatchId: "unresolved-screenshot-batch" },
)[0];
const unresolvedScreenshotDto = buildProfileEvidenceOwnerReviewDto({
  restaurantId: RESTAURANT_ID,
  ledger: {
    schemaVersion: 2,
    proposals: [unresolvedScreenshotWithText],
    decisions: {},
  },
  currentValues: { phone: null },
  evidenceImagesById: {},
});
const unresolvedScreenshotReview = unresolvedScreenshotDto.proposals[0];
assert.equal(
  unresolvedScreenshotReview.source.reviewable,
  false,
  "a screenshot URL or OCR excerpt must not replace the exact-profile image",
);
assert.equal(
  isProfileEvidenceDecisionSourceInspectable({
    action: "confirm",
    proposal: unresolvedScreenshotReview,
  }),
  false,
);
assert.equal(
  isProfileEvidenceDecisionSourceInspectable({
    action: "correct",
    proposal: unresolvedScreenshotReview,
  }),
  false,
);
assert.equal(
  isProfileEvidenceDecisionSourceInspectable({
    action: "decline",
    proposal: unresolvedScreenshotReview,
  }),
  true,
);

ledger = normalizeProfileEvidenceReviewLedger(
  {
    ownerReview: {
      schemaVersion: 2,
      proposals: [descriptionProposal],
      decisions: {},
    },
  },
  normalizationOptions,
);
const currentDescription = "Current description";
const expectedFingerprint = createProfileEvidenceValueFingerprint(
  "description",
  currentDescription,
);
const confirmed = planProfileEvidenceReviewDecision({
  ledger,
  proposalId: descriptionProposal.id,
  action: "confirm",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(confirmed.status, "planned");
if (confirmed.status !== "planned") throw new Error("confirm plan failed");
assert.equal(confirmed.decision.action, "confirmed");
assert.equal(confirmed.mutation?.field, "description");
assert.equal(confirmed.mutation?.nextValue, "Family recipes served daily.");

const repeated = planProfileEvidenceReviewDecision({
  ledger: confirmed.ledger,
  proposalId: descriptionProposal.id,
  action: "confirm",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(repeated.status, "idempotent");

const sameKeyDifferentAction = planProfileEvidenceReviewDecision({
  ledger: confirmed.ledger,
  proposalId: descriptionProposal.id,
  action: "decline",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(
  sameKeyDifferentAction.status,
  "conflict",
  "confirm followed by decline with the same idempotency key must conflict",
);

const legacyExactReplay = planProfileEvidenceReviewDecision({
  ledger: ledgerWithDecision,
  proposalId: ledgerWithDecision.proposals[0].id,
  action: "decline",
  currentValue: null,
  expectedCurrentValueFingerprint: createProfileEvidenceValueFingerprint(
    "phone",
    null,
  ),
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(
  legacyExactReplay.status,
  "idempotent",
  "legacy decisions without a stored request fingerprint must replay safely",
);

const conflicting = planProfileEvidenceReviewDecision({
  ledger: confirmed.ledger,
  proposalId: descriptionProposal.id,
  action: "decline",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: "22222222-2222-4222-8222-222222222222",
  decidedAt: DECIDED_AT,
});
assert.equal(conflicting.status, "conflict");

const stale = planProfileEvidenceReviewDecision({
  ledger,
  proposalId: descriptionProposal.id,
  action: "confirm",
  currentValue: "A newer owner edit",
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(stale.status, "stale");
assert.deepEqual(ledger.decisions, {}, "a stale plan must not alter the input ledger");

const corrected = planProfileEvidenceReviewDecision({
  ledger,
  proposalId: descriptionProposal.id,
  action: "correct",
  correctedValue: "  Owner-corrected description.  ",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(corrected.status, "planned");
if (corrected.status !== "planned") throw new Error("correction plan failed");
assert.equal(corrected.decision.action, "corrected");
assert.equal(corrected.decision.appliedValue, "Owner-corrected description.");

const declined = planProfileEvidenceReviewDecision({
  ledger,
  proposalId: descriptionProposal.id,
  action: "decline",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(declined.status, "planned");
if (declined.status !== "planned") throw new Error("decline plan failed");
assert.equal(declined.decision.action, "declined");
assert.equal(declined.mutation, null);

const invalidCorrection = planProfileEvidenceReviewDecision({
  ledger,
  proposalId: descriptionProposal.id,
  action: "correct",
  correctedValue: "",
  currentValue: currentDescription,
  expectedCurrentValueFingerprint: expectedFingerprint,
  actorUserId: ACTOR_ID,
  clientRequestId: REQUEST_ID,
  decidedAt: DECIDED_AT,
});
assert.equal(invalidCorrection.status, "invalid");
assert.deepEqual(
  ledger.decisions,
  {},
  "an invalid correction must not alter the input ledger",
);

const oversizedCurrentDescription = "x".repeat(
  PROFILE_EVIDENCE_FIELD_REGISTRY.description.maxLength + 25,
);
const oversizedDto = buildProfileEvidenceOwnerReviewDto({
  restaurantId: RESTAURANT_ID,
  ledger,
  currentValues: { description: oversizedCurrentDescription },
});
assert.equal(
  oversizedDto.proposals[0].currentValue?.length,
  PROFILE_EVIDENCE_FIELD_REGISTRY.description.maxLength,
  "owner display remains bounded",
);
assert.equal(
  oversizedDto.proposals[0].currentValueFingerprint,
  createProfileEvidenceValueFingerprint(
    "description",
    oversizedCurrentDescription,
  ),
  "fingerprint must bind the untruncated canonical DB value",
);
assert.equal(
  planProfileEvidenceReviewDecision({
    ledger,
    proposalId: descriptionProposal.id,
    action: "decline",
    currentValue: oversizedCurrentDescription,
    expectedCurrentValueFingerprint:
      oversizedDto.proposals[0].currentValueFingerprint,
    actorUserId: ACTOR_ID,
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    decidedAt: DECIDED_AT,
  }).status,
  "planned",
  "an over-limit legacy value must not become permanently stale",
);

const boundedMenuBatch = normalizeQueuedProfileEvidenceMenuItems(
  Array.from(
    { length: PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems + 1 },
    (_, index) => ({
      item_name: ` Item ${index} `,
      description: "  Fresh food  ",
      price: "$12.00",
      category_name: "Mains",
      ignoredAttackerKey: { nested: "must not persist" },
    }),
  ),
);
assert.equal(
  boundedMenuBatch.items.length,
  PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems,
);
assert.equal(boundedMenuBatch.droppedIds.length, 1);
assert.deepEqual(Object.keys(boundedMenuBatch.items[0]).sort(), [
  "category",
  "description",
  "name",
  "price",
]);
assert.equal(boundedMenuBatch.items[0].name, "Item 0");
const malformedMenuBatch = normalizeQueuedProfileEvidenceMenuItems([
  { name: "x".repeat(PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuName + 1) },
  { name: "Safe\u0000unsafe" },
  "not-an-object",
]);
assert.equal(malformedMenuBatch.items.length, 0);
assert.equal(malformedMenuBatch.rejected.length, 3);
assert.equal(parseDirectApplyMenuPriceCents("$12"), 1200);
assert.equal(parseDirectApplyMenuPriceCents("12.50"), 1250);
assert.equal(parseDirectApplyMenuPriceCents(""), null);
assert.equal(parseDirectApplyMenuPriceCents("market price"), null);
assert.equal(parseDirectApplyMenuPriceCents("12.5.0"), null);

const boundedTextBatch = normalizeQueuedProfileEvidenceTextItems(
  [
    "Valid source note",
    { attacker: true },
    "x".repeat(1001),
    "unsafe\u0000text",
  ],
  "source-note",
);
assert.deepEqual(boundedTextBatch.items, ["Valid source note"]);
assert.equal(boundedTextBatch.rejected.length, 3);

const boundedScheduleBatch = normalizeQueuedProfileEvidenceScheduleItems([
  {
    date: "2026-07-23",
    location_name: "  Market Square  ",
    start_time: "09:30:00",
    end_time: "14:00",
    address: "  1 Main St  ",
    notes: "Lunch service",
    unknown: "not persisted",
  },
  {
    date: "2026-02-30",
    locationName: "Impossible date",
    startTime: "09:00",
    endTime: "10:00",
  },
]);
assert.deepEqual(boundedScheduleBatch.items, [
  {
    date: "2026-07-23",
    locationName: "Market Square",
    startTime: "09:30",
    endTime: "14:00",
    address: "1 Main St",
    notes: "Lunch service",
  },
]);
assert.equal(boundedScheduleBatch.rejected.length, 1);

const concurrentDecisionLedger = {
  ...ledgerWithDecision,
  proposals: [...ledgerWithDecision.proposals, descriptionProposal],
};
const queueMerge = mergeProfileEvidenceQueueContainer({
  freshContainer: {
    unrelatedSetting: { preserved: true },
    publicGalleryImages: [{ id: "existing-image", url: "https://example.com/a" }],
    evidenceApply: {
      ownerReview: concurrentDecisionLedger,
      reviewQueue: [{ id: "existing-review" }],
      sourceNotes: ["prior source"],
      queuedMenuItems: [{ name: "Prior item", price: "$8" }],
      queuedScheduleItems: [
        {
          date: "2026-07-24",
          locationName: "Prior stop",
          startTime: "10:00",
          endTime: "12:00",
        },
      ],
    },
  },
  queuedEvidenceApply: {
    ownerReview: {
      schemaVersion: 2,
      proposals: [descriptionProposal],
      decisions: {},
    },
    sourceNotes: ["new evidence"],
    queuedMenuItems: [{ name: "New item", price: "$9" }],
    queuedScheduleItems: [
      {
        date: "2026-07-25",
        locationName: "New stop",
        startTime: "11:00",
        endTime: "13:00",
      },
    ],
  },
  galleryEntries: [{ id: "new-image", url: "https://example.com/b" }],
  reviewQueueItems: [{ id: "new-review" }],
});
assert.deepEqual(queueMerge.unrelatedSetting, { preserved: true });
assert.deepEqual(
  (queueMerge.evidenceApply as any).ownerReview.decisions,
  concurrentDecisionLedger.decisions,
  "a queue merge from the freshly locked state must preserve owner decisions",
);
assert.deepEqual(
  ((queueMerge.evidenceApply as any).reviewQueue as any[]).map((item) => item.id),
  ["existing-review", "new-review"],
);
assert.deepEqual(
  (queueMerge.publicGalleryImages as any[]).map((item) => item.id),
  ["existing-image", "new-image"],
);
assert.deepEqual((queueMerge.evidenceApply as any).sourceNotes, [
  "prior source",
  "new evidence",
]);
assert.deepEqual(
  ((queueMerge.evidenceApply as any).queuedMenuItems as any[]).map(
    (item) => item.name,
  ),
  ["Prior item", "New item"],
  "a fresh queue merge must retain prior pending menu evidence",
);
assert.deepEqual(
  ((queueMerge.evidenceApply as any).queuedScheduleItems as any[]).map(
    (item) => item.locationName,
  ),
  ["Prior stop", "New stop"],
  "a fresh queue merge must retain prior pending schedule evidence",
);

const fullMenu = Array.from(
  { length: PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems },
  (_, index) => ({ name: `Existing menu ${index}` }),
);
const fullSchedule = Array.from(
  { length: PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleItems },
  (_, index) => ({
    date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    locationName: `Existing stop ${index}`,
    startTime: "09:00",
    endTime: "10:00",
  }),
);
const fullGallery = Array.from(
  { length: PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals },
  (_, index) => ({
    id: `approved-${index}`,
    url: `https://example.com/approved-${index}.jpg`,
    publicApproved: true,
  }),
);
const capacityMerge = mergeProfileEvidenceQueueContainerWithReport({
  freshContainer: {
    publicGalleryImages: fullGallery,
    evidenceApply: {
      sourceNotes: Array.from({ length: 100 }, (_, index) => `Source ${index}`),
      queuedMenuItems: fullMenu,
      queuedScheduleItems: fullSchedule,
      reviewQueue: Array.from(
        { length: PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals },
        (_, index) => ({ id: `review-${index}` }),
      ),
      uploadedEvidence: Array.from(
        { length: PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals },
        (_, index) => ({ imageUploadId: `upload-${index}` }),
      ),
    },
  },
  queuedEvidenceApply: {
    sourceNotes: ["Incoming source"],
    queuedMenuItems: [{ name: "Incoming menu" }],
    queuedScheduleItems: [
      {
        date: "2026-09-01",
        locationName: "Incoming stop",
        startTime: "11:00",
        endTime: "12:00",
      },
    ],
  },
  galleryEntries: [
    {
      id: "pending-gallery",
      url: "https://example.com/pending.jpg",
      publicApproved: false,
    },
  ],
  reviewQueueItems: [{ id: "incoming-review" }],
  uploadedEvidence: [{ imageUploadId: "incoming-upload" }],
});
assert.deepEqual(
  (capacityMerge.container.publicGalleryImages as any[]).map((item) => item.id),
  fullGallery.map((item) => item.id),
  "queue capacity must never evict an existing approved gallery image",
);
assert.equal(capacityMerge.results.galleryEntries.acceptedIds.length, 0);
assert.deepEqual(capacityMerge.results.galleryEntries.droppedIds, [
  "pending-gallery",
]);
assert.deepEqual(
  ((capacityMerge.container.evidenceApply as any).queuedMenuItems as any[]).map(
    (item) => item.name,
  ),
  fullMenu.map((item) => item.name),
);
assert.equal(capacityMerge.results.menuItems.droppedCount, 1);
assert.equal(capacityMerge.results.scheduleItems.droppedCount, 1);
assert.equal(capacityMerge.results.sourceNotes.droppedCount, 1);
assert.equal(capacityMerge.results.reviewQueue.droppedCount, 1);
assert.equal(capacityMerge.results.uploadedEvidence.droppedCount, 1);

const mixedGallery = [
  "https://example.com/legacy-public.jpg",
  {
    id: "approved-object",
    url: "https://example.com/approved-object.jpg",
    publicApproved: true,
  },
  "https://example.com/legacy-public.jpg",
];
const mixedGalleryMerge = mergeProfileEvidenceQueueContainerWithReport({
  freshContainer: { publicGalleryImages: mixedGallery },
  queuedEvidenceApply: {},
  galleryEntries: [
    {
      id: "pending-object",
      url: "https://example.com/pending-object.jpg",
      publicApproved: false,
    },
  ],
});
assert.deepEqual(
  (mixedGalleryMerge.container.publicGalleryImages as any[]).slice(
    0,
    mixedGallery.length,
  ),
  mixedGallery,
  "queue merge must preserve legacy public gallery strings, duplicates, and order verbatim",
);

const staleApplySettings = {
  staleTopLevel: "must-not-win",
  publicGalleryImages: [
    { id: "owner-removed", url: "https://example.com/owner-removed.jpg" },
    { id: "apply-new", url: "https://example.com/apply-new.jpg" },
  ],
  publicActionLinks: {
    onlineOrderingUrl: "https://stale.example/order",
  },
  evidenceApply: {
    ownerReview: { schemaVersion: 2, proposals: [descriptionProposal], decisions: {} },
    staleUnknownAuditKey: "must-not-win",
  },
};
const freshApplySettings = {
  unrelatedConcurrentSetting: { preserved: true },
  staleTopLevel: "fresh-wins",
  publicActionLinks: {
    onlineOrderingUrl: "https://owner.example/order",
    deliveryUrl: "https://owner.example/delivery",
  },
  publicGalleryImages: [
    { id: "fresh-existing", url: "https://example.com/fresh-existing.jpg" },
  ],
  evidenceApply: {
    ownerReview: concurrentDecisionLedger,
    concurrentAuditKey: { preserved: true },
  },
};
const mergedApplySettings = mergeProfileEvidenceApplySettings({
  freshSettings: freshApplySettings,
  plannedSettings: staleApplySettings,
  galleryEntries: [
    { id: "apply-new", url: "https://example.com/apply-new.jpg" },
  ],
});
assert.equal(mergedApplySettings.staleTopLevel, "fresh-wins");
assert.deepEqual(mergedApplySettings.unrelatedConcurrentSetting, {
  preserved: true,
});
assert.deepEqual(
  (mergedApplySettings.evidenceApply as any).ownerReview.decisions,
  concurrentDecisionLedger.decisions,
  "fresh owner decisions must win over a stale direct-apply settings plan",
);
assert.deepEqual(mergedApplySettings.publicActionLinks, {
  onlineOrderingUrl: "https://owner.example/order",
  deliveryUrl: "https://owner.example/delivery",
});
assert.deepEqual((mergedApplySettings.evidenceApply as any).concurrentAuditKey, {
  preserved: true,
});
assert.equal(
  "staleUnknownAuditKey" in (mergedApplySettings.evidenceApply as any),
  false,
);
assert.deepEqual(
  (mergedApplySettings.publicGalleryImages as any[]).map((item) => item.id),
  ["fresh-existing", "apply-new"],
  "an owner-removed stale gallery entry must not be resurrected",
);

const metadataOnlyMerge = mergeProfileEvidenceQueueContainerWithReport({
  freshContainer: {},
  queuedEvidenceApply: {
    sourceNotes: ["Source-only intake"],
    missingInfo: ["Owner must confirm hours"],
  },
  reviewQueueItems: [{ id: "review-only", type: "manual_review" }],
  uploadedEvidence: [
    { imageUploadId: "upload-only", sha256: "a".repeat(64) },
  ],
});
assert.equal(metadataOnlyMerge.results.sourceNotes.acceptedIds.length, 1);
assert.equal(metadataOnlyMerge.results.missingInfo.acceptedIds.length, 1);
assert.deepEqual(metadataOnlyMerge.results.reviewQueue.acceptedIds, [
  "review-only",
]);
assert.deepEqual(metadataOnlyMerge.results.uploadedEvidence.acceptedIds, [
  "upload-only",
]);
const metadataReplayMerge = mergeProfileEvidenceQueueContainerWithReport({
  freshContainer: metadataOnlyMerge.container,
  queuedEvidenceApply: {
    sourceNotes: ["Source-only intake"],
    missingInfo: ["Owner must confirm hours"],
  },
  reviewQueueItems: [{ id: "review-only", type: "manual_review" }],
  uploadedEvidence: [
    { imageUploadId: "upload-only", sha256: "a".repeat(64) },
  ],
});
assert.equal(metadataReplayMerge.results.sourceNotes.acceptedIds.length, 0);
assert.deepEqual(metadataReplayMerge.results.reviewQueue.duplicateIds, [
  "review-only",
]);
assert.deepEqual(metadataReplayMerge.results.uploadedEvidence.duplicateIds, [
  "upload-only",
]);

const saturatedLedger: ProfileEvidenceReviewLedger = {
  schemaVersion: 2,
  proposals: Array.from(
    { length: PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals },
    (_, index) =>
      normalizeLegacyProfileEvidenceProposals(
        [
          {
            field: "description",
            proposedValue: `Historic ${index}`,
            sourceIdentity: `historic-${index}`,
          },
        ],
        {
          ...normalizationOptions,
          defaultBatchId: "historic-batch",
        },
      )[0],
  ),
  decisions: {},
};
const capacityAttempt = appendProfileEvidenceReviewProposals(
  saturatedLedger,
  [descriptionProposal],
  normalizationOptions,
);
assert.equal(capacityAttempt.addedIds.length, 0);
assert.deepEqual(capacityAttempt.droppedIds, [descriptionProposal.id]);

const decidedProposals = saturatedLedger.proposals;
const terminalLedger: ProfileEvidenceReviewLedger = {
  schemaVersion: 2,
  proposals: decidedProposals,
  decisions: Object.fromEntries(
    decidedProposals.map((proposal, index) => [
      proposal.id,
      {
        action: "declined" as const,
        appliedValue: null,
        previousValue: null,
        previousValueFingerprint: createProfileEvidenceValueFingerprint(
          proposal.field,
          null,
        ),
        decidedAt: new Date(
          Date.parse("2026-01-01T00:00:00.000Z") + index * 1_000,
        ).toISOString(),
        decidedByUserId: ACTOR_ID,
        clientRequestId: REQUEST_ID,
      },
    ]),
  ),
};
const terminalCapacityAttempt = appendProfileEvidenceReviewProposals(
  terminalLedger,
  [descriptionProposal],
  normalizationOptions,
);
assert.deepEqual(terminalCapacityAttempt.addedIds, [descriptionProposal.id]);
assert.equal(
  terminalCapacityAttempt.ledger.proposals.filter(
    (proposal) => !terminalCapacityAttempt.ledger.decisions[proposal.id],
  ).length,
  1,
  "decided history must not consume active proposal capacity",
);
assert.equal(
  Object.keys(terminalCapacityAttempt.ledger.decisions).length,
  PROFILE_EVIDENCE_REVIEW_LIMITS.terminalDecisionHistory,
);

const historicalIntakeRequests = Object.fromEntries([
  ...Array.from({ length: 120 }, (_, index) => [
    `completed-${index}`,
    {
      status: "completed",
      completedAt: new Date(
        Date.parse("2026-01-01T00:00:00.000Z") + index * 1_000,
      ).toISOString(),
    },
  ]),
  ...Array.from({ length: 3 }, (_, index) => [
    `active-${index}`,
    { status: "in_progress", startedAt: RECEIVED_AT },
  ]),
  ["malformed-status", { status: "unknown" }],
]);
const compactedIntakeRequests = compactProfileEvidenceIntakeRequests(
  historicalIntakeRequests,
);
assert.equal(
  Object.keys(compactedIntakeRequests).length,
  PROFILE_EVIDENCE_REVIEW_LIMITS.terminalIntakeHistory + 3,
);
assert.equal(countActiveProfileEvidenceIntakeRequests(compactedIntakeRequests), 3);
assert.equal("malformed-status" in compactedIntakeRequests, false);
assert.equal("completed-119" in compactedIntakeRequests, true);
assert.equal("completed-0" in compactedIntakeRequests, false);

console.log("profile-evidence-owner-review.behavior: PASS");
