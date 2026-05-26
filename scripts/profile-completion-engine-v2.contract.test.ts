import { readFileSync } from "node:fs";

const adminRoutes = readFileSync("server/routes/adminManagementRoutes.ts", "utf8");
const adminControlCenter = readFileSync("client/src/pages/AdminControlCenter.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/business-profiles/completion"',
  "primaryStatus",
  "publicReady",
  "handoffReady",
  "adminFixable",
  "blockedOwnerInput",
  "testOrQa",
  "actionabilityScore",
  "completionScore",
  "confidenceScore",
  "fixabilityScore",
  "rankReason",
  "identityNeedsReviewFinal",
  "hideAsTestQa",
  "identityReviewNeeded",
  "identityReviewed",
  "blockerReason",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminRoutes.includes(snippet)) {
    throw new Error(`PCE2 route contract missing required snippet: ${snippet}`);
  }
}

const requiredUiSnippets = [
  "Next 20 actionable",
  "Public-ready",
  "Handoff-ready",
  "Admin-fixable",
  "Blocked owner input",
  "Identity review",
  "Test / QA",
  "Needs menu",
  "Needs photo",
  "Needs schedule",
  "Needs contact/action",
  "Has analytics activity",
  "Bulk actions",
  "Hide as test/QA",
  "Mark identity review needed",
  "Mark identity reviewed",
  "Assign blocker reason",
  "actionabilityScore",
  "rankReason",
];

for (const snippet of requiredUiSnippets) {
  if (!adminControlCenter.includes(snippet)) {
    throw new Error(`PCE2 UI contract missing required snippet: ${snippet}`);
  }
}

const safetySnippets = [
  "completionView === \"next_20_actionable\"",
  "!item.testOrQa",
  "!item.blockedOwnerInput",
  "!item.identityNeedsReview",
  "slice(0, completionView === \"next_20_actionable\" ? 20 : 60)",
];

for (const snippet of safetySnippets) {
  if (!adminControlCenter.includes(snippet)) {
    throw new Error(`PCE2 safety contract missing required snippet: ${snippet}`);
  }
}

console.log("profile-completion-engine-v2.contract: PASS");
