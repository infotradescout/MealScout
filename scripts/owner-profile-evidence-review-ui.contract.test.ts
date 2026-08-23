import { readFileSync } from "node:fs";

const component = readFileSync(
  "client/src/components/owner-profile-evidence-review.tsx",
  "utf8",
).replace(/\r\n/g, "\n");
const browserSpec = readFileSync(
  "playwright/owner-profile-evidence-review.spec.ts",
  "utf8",
).replace(/\r\n/g, "\n");

for (const snippet of [
  "safeEvidenceImages",
  "safeSourceUrl(String(image?.url || \"\"))",
  "source.reviewable !== false",
  "source.unavailableReason",
  "Evidence images",
  "Evidence is not available to inspect",
  "Confirm and Correct stay unavailable",
  'referrerPolicy="no-referrer"',
  'loading="lazy"',
  "decisionMutation.isPending || !evidenceReviewable",
  'action !== "decline" && !isProposalReviewable(proposal)',
]) {
  if (!component.includes(snippet)) {
    throw new Error(`Owner evidence UI is missing: ${snippet}`);
  }
}

for (const unsafeOptimisticWrite of [
  "onValueApplied",
  "queryClient.setQueryData",
  "setProfileDraft",
]) {
  if (component.includes(unsafeOptimisticWrite)) {
    throw new Error(
      `Owner evidence UI must not perform an optimistic profile write: ${unsafeOptimisticWrite}`,
    );
  }
}

for (const snippet of [
  "evidence-visible.png",
  "profile-evidence-unavailable-phone",
  'button-confirm-evidence-phone\")).toBeDisabled()',
  'button-correct-evidence-phone\")).toBeDisabled()',
  'button-decline-evidence-phone\")).toBeEnabled()',
  'proposalId: PHONE_ID,\n    action: "decline"',
  'getByRole("textbox", { name: /^About your business/ })',
  '"Owner-corrected public description."',
  "profileWrites: () => profileWrites",
  'description: "Owner-corrected public description."',
  'fill("Owner unsaved fusion cuisine")',
  'cuisineType: "Owner unsaved fusion cuisine"',
]) {
  if (!browserSpec.includes(snippet)) {
    throw new Error(`Owner evidence browser coverage is missing: ${snippet}`);
  }
}

console.log("owner-profile-evidence-review-ui.contract: PASS");
