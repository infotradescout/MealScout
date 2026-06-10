import { readFileSync } from "node:fs";

const routeFile = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const dashboardFile = readFileSync(
  "client/src/pages/admin-dashboard.tsx",
  "utf8",
);

const requiredRouteSnippets = [
  '"/api/admin/profile-evidence/apply"',
  "upload.fields([",
  '{ name: "profileImages", maxCount: 20 }',
  '{ name: "menuImages", maxCount: 20 }',
  '{ name: "hoursImages", maxCount: 20 }',
  '{ name: "contactImages", maxCount: 20 }',
  "allowMenuOverwrite",
  "allowLogoReplace",
  "existingMenuCount > 0 && !allowMenuOverwrite",
  "explicit_overwrite_approval",
  'imageType: "restaurant_gallery_menu"',
  'imageType: "restaurant_gallery_hours"',
  'imageType: "restaurant_gallery_contact"',
  'imageType: "restaurant_gallery_truck"',
  'entityType: "restaurant"',
  "reviewQueueItems",
  "field_conflicts",
  "menu_evidence_review",
  "logo_conflict",
  "menuEvidenceStatus",
  "evidenceStatus",
  "uploadedEvidence",
];

for (const snippet of requiredRouteSnippets) {
  if (!routeFile.includes(snippet)) {
    throw new Error(
      `Manual intake evidence route missing required snippet: ${snippet}`,
    );
  }
}

const requiredUiSnippets = [
  'formData.append("profileImages"',
  'formData.append("menuImages"',
  'formData.append("hoursImages"',
  'formData.append("contactImages"',
  "setProfileEvidenceFiles",
  "setMenuEvidenceFiles",
  "setHoursEvidenceFiles",
  "setContactEvidenceFiles",
  "result.evidenceStatus",
  "result.menuEvidenceStatus",
  "result.reviewQueueItems",
  "result.uploadedEvidence",
  '"menuOverwrite": false',
  '"logoOverwrite": false',
];

for (const snippet of requiredUiSnippets) {
  if (!dashboardFile.includes(snippet)) {
    throw new Error(
      `Manual intake evidence UI missing required snippet: ${snippet}`,
    );
  }
}

if (/stripe|payout/i.test(routeFile)) {
  throw new Error(
    "Manual intake evidence route unexpectedly references payment or payout logic.",
  );
}

console.log("manual-truck-intake-evidence.contract: PASS");
