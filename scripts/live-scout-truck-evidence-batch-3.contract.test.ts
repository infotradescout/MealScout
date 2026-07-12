import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifactPath = "docs/evidence/live-scout-truck-evidence-batch-3-2026-06-13.json";
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const parentTracker = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-content-completion-2026-06-13.json", "utf8"),
);
const batchTwo = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-evidence-batch-2-2026-06-13.json", "utf8"),
);
const batchOne = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json", "utf8"),
);
const hygieneApplyLane = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-hygiene-apply-lane-1-2026-06-13.json", "utf8"),
);
const manualRunbook = readFileSync("docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md", "utf8");
const publicProfileMapper = readFileSync("server/publicProfiles/toPublicRestaurantProfile.ts", "utf8");
const locationSemantics = readFileSync("server/utils/truckLocationSemantics.ts", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const cleanUrlContract = readFileSync("scripts/mealscout-clean-url-doctrine.contract.test.ts", "utf8");

const expectedEntries = new Map([
  ["All Gas No Brakes Reloaded", "6ca08365-f8af-4c1d-9754-6c998c803869"],
  ["CREATIVBOWLS", "75dd470e-2692-4579-bde0-a64dcc3f6fcb"],
]);

const evidenceStatuses = new Set([
  "missing",
  "sourced",
  "applied",
  "needs_owner_confirmation",
  "current_week_only",
  "recurring",
]);

assert.equal(artifact.repo, "MealScout");
assert.equal(artifact.workflowMode, "review_only");
assert.equal(artifact.productionMutationAllowed, false);
assert.equal(artifact.productionApplied, false);
assert.equal(artifact.baselineSha, "9ac57d226cc8ddd8d362ba65790704d3d7caa417");
assert.equal(artifact.parentTracker, "docs/evidence/live-scout-truck-content-completion-2026-06-13.json");
assert(
  artifact.rules.some((rule: string) =>
    rule.includes("Do not treat third-party listings or social snippets as owner-approved menu data"),
  ),
);
assert(
  artifact.rules.some((rule: string) =>
    rule.includes("current_week_only") &&
    rule.includes("recurring") &&
    rule.includes("needs_owner_confirmation"),
  ),
);

for (const preserved of [
  "/truck/{slug}--{uuid} compatibility paths",
  "invalid UUID safe 404",
  "missing logo/menu/schedule no-500 behavior",
  "clean affiliate / clean URL doctrine",
  "food-truck location privacy rules",
  "Blessed Berry Bowls social URL owner-confirmation gate",
  "Jays Southern Cuisine trimmed display name",
]) {
  assert(artifact.preserve.includes(preserved), `Missing preserved contract: ${preserved}`);
}

assert.equal(
  hygieneApplyLane.appliedChanges[0].after,
  "Jays Southern Cuisine",
  "Batch 3 must preserve the prior Jays trimmed display-name apply lane.",
);
const blessedBatchOne = batchOne.entries.find(
  (entry: any) => entry.truckName === "Blessed Berry Bowls",
);
assert.equal(blessedBatchOne.productionApplied, false);
assert.equal(blessedBatchOne.ownerApprovalNeeded, true);
assert.equal(batchTwo.productionApplied, false);

assert(
  manualRunbook.includes("Default mode is dry run (`mode = dry_run`).") &&
    manualRunbook.includes("Dry run does not mutate profile/menu rows.") &&
    manualRunbook.includes("existing menu is not replaced unless `approvals.menuOverwrite = true`") &&
    manualRunbook.includes("Never perform production apply without explicit approval and `--allow-production`."),
  "Batch 3 evidence must stay aligned with manual intake dry-run and no-overwrite safety.",
);

assert(
  publicProfileMapper.includes('const menuUrl = String(row.menuUrl || "").trim() || null;') &&
    publicProfileMapper.includes("menuSectionsRaw") &&
    // publicMenuUrl now gates menuUrl behind moderation status
    // (rejected -> null) but is still derived directly from the same raw
    // menuUrl, and the Menu CTA still uses it as a distinct href from the
    // structured menuSections/menuSectionsRaw evidence.
    publicProfileMapper.includes(
      'const publicMenuUrl = menuApproval.status === "rejected" ? null : menuUrl;',
    ) &&
    publicProfileMapper.includes('label: "Menu"') &&
    publicProfileMapper.includes("href: publicMenuUrl"),
  "Public profile mapper must keep menu URL and structured menu evidence distinct.",
);

assert(
  locationSemantics.includes("CUSTOMER_FACING_TRUCK_LOCATION_SOURCES") &&
    locationSemantics.includes("shouldExposeStaticTruckProfileLocation"),
  "Batch 3 must preserve food-truck location privacy safeguards.",
);

assert(
  publicDiscoveryRoutes.includes("No schedule posted") &&
    publicDiscoveryRoutes.includes("menuSections: listingMenuSections") &&
    publicDiscoveryRoutes.includes("return res.status(404).json({ message: \"Profile not found\" });"),
  "Public truck profile API must preserve safe 404 and incomplete profile behavior.",
);
assert(cleanUrlContract.includes("/truck/{slug}--{id}"));

assert(Array.isArray(artifact.entries));
assert.equal(artifact.entries.length, expectedEntries.size);

const parentByName = new Map(parentTracker.trucks.map((truck: any) => [truck.truckName, truck]));

for (const entry of artifact.entries) {
  assert.equal(entry.truckId, expectedEntries.get(entry.truckName));
  assert.equal(entry.profileId, entry.truckId);
  assert.equal(entry.currentApiStatus, 200);
  assert.match(entry.publicProfilePath, /^\/truck\/[a-z0-9-]+--[0-9a-f-]{36}$/);
  assert.equal(entry.publicProfilePath, parentByName.get(entry.truckName)?.publicProfilePath);
  assert.equal(entry.ownerApprovalNeeded, true);
  assert.equal(entry.productionApplied, false);
  assert(Array.isArray(entry.sourceUrls));
  assert(entry.sourceUrls[0].includes(`/api/public/profiles/truck/${entry.truckId}`));
  assert(Array.isArray(entry.sourceArtifactPaths));
  assert(Array.isArray(entry.externalEvidenceCandidates));
  assert(["low", "medium", "high"].includes(entry.confidence));
  assert(evidenceStatuses.has(entry.logoEvidenceStatus));
  assert(evidenceStatuses.has(entry.coverEvidenceStatus));
  assert(evidenceStatuses.has(entry.menuEvidenceStatus));
  assert(evidenceStatuses.has(entry.scheduleEvidenceStatus));
  assert.equal(entry.currentScheduleStatusLabel, "No schedule posted");
  assert.equal(entry.currentLogoUrl, null);
  assert.equal(entry.currentCoverUrl, null);
  assert.equal(entry.currentMenuUrl, null);
  assert.equal(entry.currentStructuredMenuSummary.menuSectionsCount, 0);
}

const allGas = artifact.entries.find(
  (entry: any) => entry.truckName === "All Gas No Brakes Reloaded",
);
assert(allGas);
assert.equal(allGas.currentProductionDisplayName, "All gas no brakes reloaded");
assert.equal(allGas.currentProductionWebsiteUrl, null);
assert.equal(allGas.currentCoverStatus, "missing");
assert.equal(allGas.currentLogoStatus, "missing");
assert.equal(allGas.currentMenuStatus, "missing");
assert.equal(allGas.currentScheduleStatus, "missing");
assert.equal(allGas.logoEvidenceStatus, "missing");
assert.equal(allGas.coverEvidenceStatus, "missing");
assert.equal(allGas.menuEvidenceStatus, "needs_owner_confirmation");
assert.equal(allGas.scheduleEvidenceStatus, "needs_owner_confirmation");
assert(
  allGas.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("snippets do not prove a current recurring schedule"),
  ),
);

const creativ = artifact.entries.find((entry: any) => entry.truckName === "CREATIVBOWLS");
assert(creativ);
assert.equal(creativ.currentProductionWebsiteUrl, "https://creativbowls.company.site/");
assert.match(creativ.currentProductionSocialUrls.instagramUrl, /^https:\/\/www\.instagram\.com\/creativbowls/);
assert.equal(creativ.currentCoverStatus, "missing");
assert.equal(creativ.currentLogoStatus, "missing");
assert.equal(creativ.currentMenuStatus, "missing");
assert.equal(creativ.currentScheduleStatus, "missing");
assert.equal(creativ.logoEvidenceStatus, "sourced");
assert.equal(creativ.coverEvidenceStatus, "sourced");
assert.equal(creativ.menuEvidenceStatus, "sourced");
assert.equal(creativ.scheduleEvidenceStatus, "needs_owner_confirmation");
assert(
  creativ.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("weekly schedules are posted on Facebook"),
  ),
);
assert(
  creativ.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("not a current posted schedule in MealScout"),
  ),
);

const serialized = JSON.stringify(artifact);
assert.doesNotMatch(serialized, /productionApplied":true/);
assert.doesNotMatch(serialized, /"scheduleEvidenceStatus":"recurring"/);
assert.doesNotMatch(serialized, /"scheduleEvidenceStatus":"current_week_only"/);

console.log("live-scout-truck-evidence-batch-3.contract: PASS");
