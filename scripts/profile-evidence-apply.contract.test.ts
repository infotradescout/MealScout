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
  "upload.single(\"image\")",
  "mode === \"apply\" ? \"applied\" : \"dry_run\"",
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
  "Profile Evidence Apply",
  "/api/admin/profile-evidence/apply",
  "Dry Run",
  "Apply",
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

console.log("profile-evidence-apply.contract: PASS");
