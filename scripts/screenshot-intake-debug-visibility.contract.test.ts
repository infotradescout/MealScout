import { readFileSync } from "node:fs";

const routeSource = readFileSync("server/routes/admin/truckImportAdminRoutes.ts", "utf8");

const requiredSnippets = [
  'debug: buildDebug({',
  'ocrTextSnippet,',
  'ocrConfidence:',
  'classification:',
  'classificationReasons:',
  'identitySignals,',
  'menuSignals,',
  'matchStrength,',
  'matchedBy,',
  'existingTruckId: matchedRestaurant?.id || "",',
  'missingFields: missingInfo,',
  'whyUnknown:',
  'missing_hard_identity_anchors',
  'classificationReasons: ["multiple_strong_matches"]',
  'classificationReasons: ["weak_name_only_review_required"]',
];

for (const snippet of requiredSnippets) {
  if (!routeSource.includes(snippet)) {
    throw new Error(`Missing screenshot debug visibility snippet: ${snippet}`);
  }
}

console.log("screenshot-intake-debug-visibility.contract: PASS");
