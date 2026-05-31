import { readFileSync } from "node:fs";

const source = readFileSync("scripts/bulkProfileEvidenceIngest.ts", "utf8");

const requiredRunFields = [
  "runId",
  "startedAt",
  "completedAt",
  "sourceFolderId",
  "totalFiles",
  "processedFiles",
  "unknownFiles",
  "draftsCreated",
  "existingProfilesMatched",
  "updatesQueued",
  "weakMatchesNeedingReview",
  "menuDeferredCount",
  "publishBlockedCount",
  "publishEligibleCount",
  "duplicateCandidatesAvoided",
  "errors",
];

const requiredRecordFields = [
  "sourceFileId:",
  "sourceFileName:",
  "classification,",
  "matchStrength:",
  "matchedBy:",
  "existingTruckId:",
  "draftId:",
  "missingFields:",
  "publishEligible:",
  "publishBlockedReasons:",
  "whyUnknown:",
  "ocrConfidence:",
];

for (const field of requiredRunFields) {
  if (!source.includes(field)) {
    throw new Error(`Missing run report field snippet: ${field}`);
  }
}

for (const field of requiredRecordFields) {
  if (!source.includes(field)) {
    throw new Error(`Missing per-record report field snippet: ${field}`);
  }
}

console.log("profile-evidence-batch-run-report.contract: PASS");
