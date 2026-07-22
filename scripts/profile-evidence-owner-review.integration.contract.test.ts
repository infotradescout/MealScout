import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes/profileEvidenceReviewRoutes.ts");
const access = read("server/services/profileEvidenceReviewAccess.ts");
const operations = read("server/routes/restaurantOperationsRoutes.ts");
const intake = read("server/routes/admin/truckImportAdminRoutes.ts");
const registry = read("shared/profileEvidenceReview.ts");
const rootRoutes = read("server/routes.ts");

function requireAll(source: string, snippets: string[], label: string) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${label} is missing required behavior: ${snippet}`);
    }
  }
}

requireAll(
  rootRoutes,
  [
    'import { registerProfileEvidenceReviewRoutes } from "./routes/profileEvidenceReviewRoutes"',
    "registerProfileEvidenceReviewRoutes(app)",
  ],
  "route registration",
);

requireAll(
  routes,
  [
    '"/api/restaurants/:restaurantId/profile-evidence-review"',
    '"/api/restaurants/:restaurantId/profile-evidence-review/:proposalId"',
    "eq(businessStaffMemberships.restaurantId, restaurantId)",
    "hasProfileEvidenceReviewAccess",
    "db.transaction(async (tx: any)",
    "pg_advisory_xact_lock",
    '.for("update")',
    '.for("share")',
    "const review = buildReviewDto(restaurant)",
    "ownerEvidenceImagesById(restaurant)",
    "isProfileEvidenceDecisionSourceInspectable",
    "action: parsed.data.action",
    "proposal: proposalDto",
    'code: "evidence_not_inspectable"',
    "expectedCurrentValueFingerprint",
    "getProfileEvidenceFieldDefinition(field).destination",
    "planProfileEvidenceReviewDecision",
  ],
  "resource-scoped evidence route",
);

if (!routes.includes("getTableColumns(restaurants)") || !routes.includes(".leftJoin(")) {
  throw new Error(
    "Sensitive evidence GET must fetch the profile and exact membership grant in one statement.",
  );
}

requireAll(
  access,
  [
    "String(membership.userId || \"\").trim() === userId",
    "String(membership.restaurantId || \"\").trim() === restaurantId",
    'String(membership.status || "").trim() === "active"',
    "permissions.manageProfile === true",
  ],
  "exact selected-business authorization",
);

requireAll(
  operations,
  [
    "const { rawData: _rawData, ...safeRestaurant } = restaurant",
    "sanitizeOwnerWorkspaceSettings",
    "includePendingMedia: canManageProfileIds.has",
    "const existingSettings = asRecord(",
    "mergeOwnerProfileActionLinks(",
    "mergeOwnerSocialSettings(",
    "withLockedRestaurantSettings(",
    "profileCompletionTruth: completionEvidence?.truth || null",
    "truckOperatingPlan:",
  ],
  "owner workspace boundary",
);

const sanitizerStart = operations.indexOf("const sanitizeOwnerWorkspaceSettings");
const sanitizerEnd = operations.indexOf("const sanitizeOwnerWorkspaceRestaurant", sanitizerStart);
const sanitizer = operations.slice(sanitizerStart, sanitizerEnd);
if (sanitizer.includes("evidenceApply") || sanitizer.includes("ownerReview")) {
  throw new Error("General owner restaurant payload must not expose evidence ledgers.");
}

requireAll(
  intake,
  [
    "isDirectProfileEvidenceApplyDisabledMode",
    'code: "direct_apply_disabled_use_owner_review"',
    'requiredMode: "queue_owner_review"',
    'requestedMode === "queue_owner_review"',
    "PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch",
    "normalizeQueuedProfileEvidenceMenuItems",
    "normalizeQueuedProfileEvidenceScheduleItems",
    "normalizeProfileEvidenceProposalBatch",
    "if (queuesOwnerReview && !explicitProfileId)",
    'code: "owner_review_requires_explicit_profile_id"',
    "if (queuesOwnerReview && !matchedRestaurant)",
    'code: "owner_review_requires_existing_profile"',
    'code: "owner_review_requires_intake_request_id"',
    'code: "intake_request_id_conflict"',
    'status: "owner_review_replayed"',
    "queueRequestFingerprint",
    "requestBody,",
    "deterministicCloudinaryPublicId",
    "pg_advisory_xact_lock(hashtext(${deterministicCloudinaryPublicId}))",
    "ensureEvidenceUpload(tx)",
    "db.transaction(async (tx: any)",
    "pg_advisory_xact_lock(hashtext(${restaurantId}))",
    '.for("update")',
    "mergeProfileEvidenceQueueContainerWithReport",
    ".set({ socialAutopostSettings: completedSettings } as any)",
    "fieldsApplied: queuesOwnerReview",
    "proposalResults:",
    "acceptedIds: ownerReviewProposalResult.acceptedIds",
    "rejectedIds: ownerReviewProposalResult.rejected.map",
    "droppedIds: ownerReviewProposalResult.droppedIds",
    '"owner_review_unchanged"',
    '"queue_owner_review_mode"',
    "sourceNoteResults:",
    "missingInfoResults:",
    "reviewQueueResults:",
    "uploadedEvidenceResults:",
    "galleryEntryResults:",
    "evidenceBacklogStatus:",
    '"queued_admin_evidence_backlog"',
    "ownerReviewAcceptedCount",
    "if (explicitRestaurant)",
    "explicitRestaurant.claimedFromImportId",
    "mergeProfileEvidenceApplySettings",
  ],
  "queue-only intake",
);

const evidenceApplyRouteStart = intake.indexOf(
  '"/api/admin/profile-evidence/apply"',
);
const evidenceApplyRouteEnd = intake.indexOf(
  "\n  app.post(",
  evidenceApplyRouteStart + 1,
);
const evidenceApplyRoute = intake.slice(
  evidenceApplyRouteStart,
  evidenceApplyRouteEnd,
);
const directApplyDisabledGate = evidenceApplyRoute.indexOf(
  "if (isDirectProfileEvidenceApplyDisabledMode(requestedMode))",
);
if (directApplyDisabledGate < 0) {
  throw new Error("Profile evidence direct apply must be disabled at route entry.");
}
for (const laterOperation of [
  "await ensureTruckImportTables()",
  "let explicitRestaurant",
  "uploadToCloudinary(",
  ".update(restaurants)",
  ".update(truckImportListings)",
]) {
  const operationIndex = evidenceApplyRoute.indexOf(laterOperation);
  if (operationIndex < 0 || operationIndex < directApplyDisabledGate) {
    throw new Error(
      `Direct apply disablement must precede ${laterOperation} in the evidence route.`,
    );
  }
}

const explicitListingBranch = intake.indexOf("if (explicitRestaurant) {");
const heuristicListingQuery = intake.indexOf(
  "const listingWhere = or(",
  explicitListingBranch,
);
const explicitListingElse = intake.indexOf("} else {", explicitListingBranch);
if (
  explicitListingBranch < 0 ||
  explicitListingElse < 0 ||
  heuristicListingQuery < explicitListingElse
) {
  throw new Error(
    "Explicit profile targeting must bypass heuristic import-listing matching.",
  );
}

requireAll(
  intake,
  [
    'const address = String(item.address || "").trim() || null',
    "mapEligible: Boolean(address)",
  ],
  "truthful direct schedule address",
);
if (intake.includes('"Unknown location"')) {
  throw new Error("Schedule intake must never invent an address from a venue name.");
}

const reviewArtifactHashStart = intake.indexOf(
  '"profile-evidence-review-artifact"',
);
const reviewArtifactHashEnd = intake.indexOf('.digest("hex")', reviewArtifactHashStart);
if (
  reviewArtifactHashStart < 0 ||
  reviewArtifactHashEnd < 0 ||
  intake
    .slice(reviewArtifactHashStart, reviewArtifactHashEnd)
    .includes("intakeRequestId")
) {
  throw new Error(
    "Review artifacts must dedupe by semantic content across intake request IDs.",
  );
}

requireAll(
  intake,
  [
    "freshRestaurant.claimedFromImportId",
    ".from(truckImportListings)",
    'if (field === "rawData") continue',
    "mergeProfileEvidenceApplySettings({",
  ],
  "atomic explicit-profile apply",
);

const queuePersistenceStart = intake.indexOf(
  "if (queuesOwnerReview && matchedRestaurant)",
);
const queuePersistenceEnd = intake.indexOf(
  '} else if (mode === "apply")',
  queuePersistenceStart,
);
const queuePersistence = intake.slice(queuePersistenceStart, queuePersistenceEnd);
for (const protectedMutation of [
  "description:",
  "operatingHours:",
  "logoUrl:",
]) {
  if (queuePersistence.includes(protectedMutation)) {
    throw new Error(
      `Queue-only persistence unexpectedly includes protected mutation ${protectedMutation}`,
    );
  }
}

if (queuePersistence.includes("updatedAt: new Date()") &&
    queuePersistence.indexOf("updatedAt: new Date()") <
      queuePersistence.indexOf("truckImportListings")) {
  throw new Error("Queue metadata must not bump restaurant public freshness.");
}

if (intake.includes('console.error("Error applying profile evidence:", error)')) {
  throw new Error("Evidence write errors must never log raw DB error payloads.");
}

for (const protectedField of [
  '"name"',
  '"ownerId"',
  '"address"',
  '"latitude"',
  '"longitude"',
  '"logoUrl"',
  '"operatingHours"',
  '"menuItems"',
  '"isActive"',
  '"isVerified"',
]) {
  const allowlistStart = registry.indexOf(
    "export const PROFILE_EVIDENCE_REVIEW_FIELDS",
  );
  const allowlistEnd = registry.indexOf("] as const", allowlistStart);
  if (registry.slice(allowlistStart, allowlistEnd).includes(protectedField)) {
    throw new Error(`Protected field entered owner evidence allowlist: ${protectedField}`);
  }
}

console.log("profile-evidence-owner-review.integration.contract: PASS");
