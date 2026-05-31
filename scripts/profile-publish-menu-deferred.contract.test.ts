import { readFileSync } from "node:fs";

const source = readFileSync("scripts/publishSafeIngestRecord.ts", "utf8");

const requiredSnippets = [
  "hasMenuOrDeferred: hasMenu || menuDeferred",
  "const menuDeferredOverrideActive = Boolean(!hasMenu && menuDeferred);",
  "publishWarnings.push(\"Menu deferred by admin approval.\")",
  "publishAuditNotes.push(\"publish_gate.menu_deferred_override=true\")",
  "hasName: !isBlank(restaurant.name || listing.name)",
  "hasCityOrArea: !isBlank(restaurant.city || listing.city)",
  "hasCuisine: !isBlank(restaurant.cuisineType || listing.cuisineType)",
  "hasPhoneOrEmail",
  "const publishable = Object.values(publishGate).every(Boolean);",
  "menuDeferredOverrideActive,",
  "publishWarnings,",
  "publishAuditNotes,",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing publish gate snippet: ${snippet}`);
  }
}

console.log("profile-publish-menu-deferred.contract: PASS");
