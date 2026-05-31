import { readFileSync } from "node:fs";

const routeSource = readFileSync("server/routes/admin/truckImportAdminRoutes.ts", "utf8");

const requiredSnippets = [
  '"/api/admin/profile-evidence/apply"',
  'existingTruckId: matchedRestaurant?.id || "",',
  'matchStrength: "strongest" | "strong" | "medium" | "weak" | "none"',
  'reason: "weak_name_only_review_required"',
  'if (matchEmail && normalize(row.email) === matchEmail)',
  'if (\n              matchPhone &&',
  'normalizeUrlIdentity(row.websiteUrl) === matchWebsite',
  'normalizeUrlIdentity(row.facebookPageUrl) === matchFacebook',
  'normalizeUrlIdentity(row.instagramUrl) === matchInstagram',
  'evidenceFieldProposals,',
  'if (mode === "apply") {',
];

for (const snippet of requiredSnippets) {
  if (!routeSource.includes(snippet)) {
    throw new Error(`Missing screenshot-intake merge contract snippet: ${snippet}`);
  }
}

const draftEvidenceSnippets = [
  'queuedMenuItems: incomingMenuItems',
  'queuedScheduleItems: incomingScheduleItems',
  'sourceNotes,',
  'missingInfo,',
];

for (const snippet of draftEvidenceSnippets) {
  if (!routeSource.includes(snippet)) {
    throw new Error(`Missing evidence preservation snippet: ${snippet}`);
  }
}

console.log("screenshot-intake-existing-truck-merge.contract: PASS");
