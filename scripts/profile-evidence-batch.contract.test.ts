import { readFileSync } from "node:fs";

const batchRunner = readFileSync(
  "scripts/applyProfileEvidenceBatch.ts",
  "utf8",
);

const requiredSnippets = [
  "--input",
  "--apply",
  "--dry-run",
  "--only",
  "--continue-on-review",
  "/api/admin/profile-evidence/apply",
  "\"dry_run\"",
  "\"apply\"",
  "needs_review",
  "multiple_strong_matches",
  "logoPath",
  "logoFilePath",
  "fieldsApplied",
  "fieldsSkipped",
  "menuStatus",
  "scheduleStatus",
  "logoStatus",
  "conflicts",
  "missingInfo",
  "profile_evidence_batch_report_",
];

for (const snippet of requiredSnippets) {
  if (!batchRunner.includes(snippet)) {
    throw new Error(
      `Profile evidence batch runner missing required snippet: ${snippet}`,
    );
  }
}

console.log("profile-evidence-batch.contract: PASS");
