import { readFileSync } from "node:fs";

const truckImportRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync(
  "client/src/pages/admin-dashboard.tsx",
  "utf8",
);

const routeSnippets = [
  '"/api/admin/profile-evidence/apply"',
  "upload.fields([",
  '"queue_owner_review"',
  '"queued_owner_review"',
  '"owner_review_unchanged"',
  "proposalResults:",
  "queuedMenuItemResults:",
  "queuedScheduleItemResults:",
  'code: "owner_review_requires_explicit_profile_id"',
  'code: "direct_apply_disabled_use_owner_review"',
  'requiredMode: "queue_owner_review"',
  "isDirectProfileEvidenceApplyDisabledMode(requestedMode)",
  "mergeProfileEvidenceApplySettings",
  "mergeProfileEvidenceQueueContainer",
  "fieldsApplied: queuesOwnerReview",
  "menuStatus",
  "scheduleStatus",
  "logoStatus",
  "multiple_strong_matches",
  "descriptionOnlyIfBlank",
  "queued_review",
  "skipped_existing_logo",
];

for (const snippet of routeSnippets) {
  if (!truckImportRoutes.includes(snippet)) {
    throw new Error(
      `Profile evidence apply route missing required snippet: ${snippet}`,
    );
  }
}

const uiSnippets = [
  "Profile Evidence Review Intake",
  "/api/admin/profile-evidence/apply",
  "Dry Run",
  "Queue for Owner Review",
  'submit("queue_owner_review")',
  '"existingProfileId": ""',
  '"evidenceFieldProposals": []',
  "createProfileEvidenceIntakeRequestId",
  "? { intakeRequestId }",
  "setIntakeRequestId(createProfileEvidenceIntakeRequestId())",
  "Admin evidence backlog saved",
  "Evidence intake completed with no new owner task",
  "matchedImportListingId",
  "matchedRestaurantId",
  "fieldsApplied",
  "fieldsSkipped",
  "conflicts",
];

for (const snippet of uiSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(
      `Profile evidence apply UI missing required snippet: ${snippet}`,
    );
  }
}

for (const disabledDirectApplyUi of [
  'submit("apply")',
  "confirmDirectApply",
  "directApplyConfirmation",
  "Apply Now",
]) {
  if (adminDashboard.includes(disabledDirectApplyUi)) {
    throw new Error(
      `Disabled direct apply remains exposed in the admin UI: ${disabledDirectApplyUi}`,
    );
  }
}

console.log("profile-evidence-apply.contract: PASS");
