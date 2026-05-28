import { readFileSync } from "node:fs";

const script = readFileSync("scripts/bulkProfileEvidenceIngest.ts", "utf8");

const requiredSnippets = [
  "normalize every record",
  "--input",
  "--apply-safe",
  "--only",
  "/api/admin/profile-evidence/apply",
  "update_existing",
  "create_draft",
  "needs_review",
  "reject",
  "no name-only",
  "hasStrongIdentifier",
  "fieldsApplied",
  "fieldsSkipped",
  "menuStatus",
  "scheduleStatus",
  "logoStatus",
  "conflictsReport",
  "missingInfoReport",
  "sourceEvidenceLinks",
  "bulk_profile_evidence_report_",
];

for (const snippet of requiredSnippets) {
  if (!script.includes(snippet)) {
    throw new Error(
      `bulkProfileEvidenceIngest contract missing snippet: ${snippet}`,
    );
  }
}

console.log("bulk-profile-evidence-ingest.contract: PASS");
