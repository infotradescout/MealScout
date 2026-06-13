import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proposalPath = "docs/evidence/live-scout-truck-hygiene-apply-proposal-2026-06-13.json";
const evidenceBatchPath = "docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json";
const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
const evidenceBatch = JSON.parse(readFileSync(evidenceBatchPath, "utf8"));
const manualRunbook = readFileSync("docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md", "utf8");
const cleanUrlContract = readFileSync("scripts/mealscout-clean-url-doctrine.contract.test.ts", "utf8");
const publicTruckRouteContract = readFileSync(
  "scripts/public-truck-profile-route-resolution.contract.test.ts",
  "utf8",
);
const quarantineContract = readFileSync("scripts/public-profile-quarantine.contract.test.ts", "utf8");

assert.equal(proposal.repo, "MealScout");
assert.equal(proposal.baselineSha, "16b2b34bc843d6ad175f10034b00f6b1be49abfd");
assert.equal(proposal.workflowMode, "review_only_apply_proposal");
assert.equal(proposal.productionMutationAllowed, false);
assert.equal(proposal.productionApplied, false);
assert.equal(proposal.sourceEvidenceBatch, evidenceBatchPath);
assert(Array.isArray(proposal.proposals));
assert.equal(proposal.proposals.length, 3);

assert(
  manualRunbook.includes("Use `mode = apply` only after reviewing dry-run output.") &&
    manualRunbook.includes("Never perform production apply without explicit approval and `--allow-production`."),
  "Hygiene proposal must remain aligned with explicit-review apply doctrine.",
);
assert(cleanUrlContract.includes("/truck/{slug}--{id}"));
assert(publicTruckRouteContract.includes("if (isMissingSlugOwnershipTable(error)) return null;"));
assert(quarantineContract.includes('customerFacingLocationSource: "owner_confirmed_operating_location"'));

const evidenceByTruck = new Map(evidenceBatch.entries.map((entry: any) => [entry.truckName, entry]));

for (const item of proposal.proposals) {
  assert.equal(item.productionApplied, false);
  assert.equal(item.ownerApprovalNeeded, true);
  assert.match(item.publicProfilePath, /^\/truck\/[a-z0-9-]+--[0-9a-f-]{36}$/);
  assert.equal(item.publicProfilePath, evidenceByTruck.get(item.truckName)?.publicProfilePath);
  assert(Array.isArray(item.sourceUrls));
  assert(item.sourceUrls[0].includes(`/api/public/profiles/truck/${item.truckId}`));
  assert.deepEqual(item.sourceArtifactPaths, [evidenceBatchPath]);
  assert(["medium", "high"].includes(item.confidence));
}

const jays = proposal.proposals.find((item: any) => item.proposalId === "jays-display-name-whitespace-trim");
assert(jays);
assert.equal(jays.field, "restaurants.name");
assert.equal(jays.currentProductionValue, "Jays Southern Cuisine ");
assert.equal(jays.proposedValue, "Jays Southern Cuisine");
assert.equal(jays.classification, "whitespace_only_hygiene_correction");
assert.equal(jays.confidence, "high");

const blessedInstagram = proposal.proposals.find(
  (item: any) => item.proposalId === "blessed-instagram-url-cleanup",
);
assert(blessedInstagram);
assert.equal(blessedInstagram.field, "restaurants.instagramUrl");
assert.equal(blessedInstagram.currentProductionValue, "https://@blessed.berrybowls");
assert.equal(blessedInstagram.proposedValue, "https://www.instagram.com/blessedberrybowls/");
assert.equal(blessedInstagram.classification, "malformed_url_to_source_backed_candidate");

const blessedFacebook = proposal.proposals.find(
  (item: any) => item.proposalId === "blessed-facebook-url-cleanup",
);
assert(blessedFacebook);
assert.equal(blessedFacebook.field, "restaurants.facebookPageUrl");
assert.equal(blessedFacebook.currentProductionValue, "https://facebook.com/Blessed Berry Bowls");
assert.equal(
  blessedFacebook.proposedValue,
  "https://www.facebook.com/p/Blessed-Berry-Bowls-61561713173410/",
);
assert.equal(blessedFacebook.classification, "malformed_url_to_source_backed_candidate");

const serialized = JSON.stringify(proposal);
for (const forbidden of [
  "logoUrl",
  "coverImageUrl",
  "menuUrl",
  "truckManualSchedules",
  "Big-Jays-Southern-Cuisine-100095382883103",
]) {
  assert.equal(
    serialized.includes(forbidden),
    false,
    `Hygiene proposal must not include forbidden apply target: ${forbidden}`,
  );
}

assert(
  proposal.explicitNonActions.some((entry: any) =>
    String(entry.item || "").includes("Jays external Big Jay"),
  ),
  "Jays external candidate must be explicitly excluded.",
);
assert(
  proposal.explicitNonActions.some((entry: any) =>
    String(entry.item || "").includes("Toast"),
  ),
  "Toast menu evidence must be explicitly excluded from apply.",
);

console.log("live-scout-truck-hygiene-apply-proposal.contract: PASS");
