import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "scripts/import-merlin-profile-seeds.ts",
  "scripts/mealscout-bulk-truck-ingest.ts",
  "server/routes/admin/truckImportAdminRoutes.ts",
];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /reconcileBusinessIdentity/);
  assert.match(source, /identity_conflict_review_required|identityDecision\.disposition/);
}

const bulk = readFileSync("scripts/mealscout-bulk-truck-ingest.ts", "utf8");
assert.match(
  bulk,
  /regexp_replace\(lower\(\$\{restaurants\.name\}\), '\[\^a-z0-9\]', '', 'g'\)/,
  "bulk matching must normalize punctuation before deciding a business is new",
);

console.log("seed-identity-guard-wiring.contract: PASS");

