import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifactPath = "docs/evidence/live-scout-truck-evidence-batch-2-2026-06-13.json";
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const parentTracker = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-content-completion-2026-06-13.json", "utf8"),
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
  ["3D Eats & Tea", "95c4e656-f3cc-46ab-ae18-53f549cecfd1"],
  ["Sweet Love", "f3b76054-f355-43b0-a2d3-901277748557"],
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
assert.equal(artifact.baselineSha, "c9e67ee62688d9a01ec1830f428463eaebaeac15");
assert.equal(artifact.parentTracker, "docs/evidence/live-scout-truck-content-completion-2026-06-13.json");
assert(Array.isArray(artifact.rules));
assert(
  artifact.rules.some((rule: string) =>
    rule.includes("Do not treat an external menu URL as full owner-approved structured menu data"),
  ),
);
assert(
  artifact.rules.some((rule: string) =>
    rule.includes("Do not treat old social posts as current schedules"),
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
  "Batch 2 must preserve the prior Jays trimmed display-name apply lane.",
);
const blessedBatchOne = batchOne.entries.find(
  (entry: any) => entry.truckName === "Blessed Berry Bowls",
);
assert.equal(blessedBatchOne.productionApplied, false);
assert.equal(blessedBatchOne.ownerApprovalNeeded, true);

assert(
  manualRunbook.includes("Default mode is dry run (`mode = dry_run`).") &&
    manualRunbook.includes("Dry run does not mutate profile/menu rows.") &&
    manualRunbook.includes("existing menu is not replaced unless `approvals.menuOverwrite = true`") &&
    manualRunbook.includes("Never perform production apply without explicit approval and `--allow-production`."),
  "Batch 2 evidence must stay aligned with manual intake dry-run and no-overwrite safety.",
);

assert(
  publicProfileMapper.includes('const menuUrl = String(row.menuUrl || "").trim() || null;') &&
    publicProfileMapper.includes("menuSectionsRaw") &&
    publicProfileMapper.includes("buildPublicCta({ label: \"Menu\", href: menuUrl"),
  "Public profile mapper must keep menu URL and structured menu evidence distinct.",
);

assert(
  locationSemantics.includes("CUSTOMER_FACING_TRUCK_LOCATION_SOURCES") &&
    locationSemantics.includes("shouldExposeStaticTruckProfileLocation") &&
    locationSemantics.includes("THREE_D_EATS_STATIC_ADMIN_ADDRESS"),
  "Batch 2 must preserve food-truck location privacy and 3D static-address safeguards.",
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
}

const threeD = artifact.entries.find((entry: any) => entry.truckName === "3D Eats & Tea");
assert(threeD);
assert.equal(threeD.currentCoverStatus, "applied");
assert.equal(threeD.currentCoverUrl, "/business-assets/3d-eats-and-tea/cover-photo.png");
assert.equal(threeD.currentStructuredMenuStatus, "one_live_structured_item");
assert.equal(threeD.currentStructuredMenuSummary.menuSectionsCount, 1);
assert.equal(threeD.currentStructuredMenuSummary.observedItems[0].name, "Classic Burger");
assert.equal(threeD.currentStructuredMenuSummary.observedItems[0].ownerApprovalNeeded, true);
assert.equal(threeD.logoEvidenceStatus, "missing");
assert.equal(threeD.menuEvidenceStatus, "needs_owner_confirmation");
assert.equal(threeD.scheduleEvidenceStatus, "needs_owner_confirmation");
assert(
  threeD.sourceArtifactPaths.includes("docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json"),
);
assert(
  threeD.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("not current schedule evidence"),
  ),
);

const sweet = artifact.entries.find((entry: any) => entry.truckName === "Sweet Love");
assert(sweet);
assert.equal(sweet.currentCoverStatus, "applied");
assert.match(sweet.currentCoverUrl, /^https:\/\/ursweetlove\.square\.site\//);
assert.equal(sweet.currentStructuredMenuStatus, "none");
assert.equal(sweet.currentStructuredMenuSummary.menuSectionsCount, 0);
assert.match(sweet.currentExternalMenuUrl, /^https:\/\/ursweetlove\.square\.site\//);
assert.equal(sweet.logoEvidenceStatus, "missing");
assert.equal(sweet.menuEvidenceStatus, "sourced");
assert.equal(sweet.scheduleEvidenceStatus, "missing");
assert(
  sweet.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("not owner-approved structured menu rows"),
  ),
);
assert(
  sweet.externalEvidenceCandidates.some((item: any) =>
    String(item.notes || "").includes("no public events"),
  ),
);

const serialized = JSON.stringify(artifact);
assert.doesNotMatch(serialized, /productionApplied":true/);
assert.doesNotMatch(serialized, /"scheduleEvidenceStatus":"recurring"/);
assert.doesNotMatch(serialized, /"scheduleEvidenceStatus":"current_week_only"/);

console.log("live-scout-truck-evidence-batch-2.contract: PASS");
