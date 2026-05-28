import { readFileSync } from "node:fs";

const truckImportRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);

const requiredSnippets = [
  '"/api/admin/truck-import-listings/:id/fill-missing-from-evidence"',
  "No seeded restaurant is linked to this import listing. Refusing to create a duplicate.",
  "if (isBlankValue(existing))",
  "protectedFieldsNeverOverwritten",
  '"description_unless_blank"',
  '"menu"',
  '"schedule"',
  "logo_unless_blank",
  "missing_upload_required",
  "skipped_existing_logo",
  "remainingMissingInfo",
  "conflicts.push",
  "evidenceUpdate",
  "fieldsFilled",
  "fieldsSkipped",
];

for (const snippet of requiredSnippets) {
  if (!truckImportRoutes.includes(snippet)) {
    throw new Error(
      `Fill-missing evidence contract missing required snippet: ${snippet}`,
    );
  }
}

console.log("truck-import-fill-missing-evidence.contract: PASS");
