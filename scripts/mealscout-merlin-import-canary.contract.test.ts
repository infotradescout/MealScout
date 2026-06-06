import { readFileSync } from "node:fs";

const canary = readFileSync("scripts/runMealScoutMerlinImportCanary.ts", "utf8");

const requiredSnippets = [
  'profile_origin: "evidence_seed"',
  'import_decision: "blocked"',
  'import_decision: "review_required"',
  'source_actor: "admin_unattributed"',
  'affiliate_user_id: "affiliate-should-not-attach"',
  'action: "duplicate_suppressed"',
  'reason: "duplicate_target_profile_id"',
  "assertSafeAcceptedMetadata",
  "claim_escalations",
  "verification_escalations",
  "owner_escalations",
  "affiliate_escalations",
  "no MealScout -> Merlin writes",
  "mealscout-merlin-import-canary.json",
  "mealscout-merlin-import-canary.md",
];

for (const snippet of requiredSnippets) {
  if (!canary.includes(snippet)) {
    throw new Error(`Missing Merlin canary behavior snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "db.insert",
  "db.update",
  "fetch(",
  "createUser",
  "sendEmail",
  "affiliateCommissions",
  "affiliateWallet",
];

for (const snippet of forbiddenSnippets) {
  if (canary.includes(snippet)) {
    throw new Error(`Canary must not perform live connector side effect: ${snippet}`);
  }
}

console.log("mealscout-merlin-import-canary.contract: PASS");
