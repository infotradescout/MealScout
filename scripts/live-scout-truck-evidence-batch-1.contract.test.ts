import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifactPath = "docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json";
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const parentTracker = JSON.parse(
  readFileSync("docs/evidence/live-scout-truck-content-completion-2026-06-13.json", "utf8"),
);
const manualRunbook = readFileSync("docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md", "utf8");
const truckImportRoutes = readFileSync("server/routes/admin/truckImportAdminRoutes.ts", "utf8");
const publicProfileMapper = readFileSync("server/publicProfiles/toPublicRestaurantProfile.ts", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const cleanUrlContract = readFileSync("scripts/mealscout-clean-url-doctrine.contract.test.ts", "utf8");

const expectedEntries = new Map([
  ["Jays Southern Cuisine", "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2"],
  ["Blessed Berry Bowls", "e77ac77a-c432-42d0-ac0f-22c48b6306c9"],
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
assert.equal(artifact.parentTracker, "docs/evidence/live-scout-truck-content-completion-2026-06-13.json");
assert(Array.isArray(artifact.preserve));
assert(artifact.preserve.includes("/truck/{slug}--{uuid} compatibility paths"));
assert(artifact.preserve.includes("invalid UUID safe 404"));
assert(artifact.preserve.includes("missing logo/menu/schedule no-500 behavior"));
assert(artifact.preserve.includes("clean affiliate / clean URL doctrine"));

assert(
  manualRunbook.includes("Default mode is dry run (`mode = dry_run`).") &&
    manualRunbook.includes("Dry run does not mutate profile/menu rows.") &&
    manualRunbook.includes("Never perform production apply without explicit approval and `--allow-production`."),
  "Batch 1 evidence must stay aligned with manual intake dry-run safety.",
);

assert(
  truckImportRoutes.includes('const toUrl = (value: unknown, domainHint?: string) => {') &&
    truckImportRoutes.includes('return `https://${domainHint}/${raw.replace(/^@/, "")}`;') &&
    truckImportRoutes.includes("normalizeComparable(existing) !== normalizeComparable(incoming)") &&
    truckImportRoutes.includes("conflicts.push({"),
  "Batch 1 must preserve social URL normalization and conflict-review behavior.",
);

assert(
  publicProfileMapper.includes('const displayName = String(row.name || "MealScout business");') &&
    publicProfileMapper.includes('const instagramUrl =') &&
    publicProfileMapper.includes('const facebookPageUrl =') &&
    publicProfileMapper.includes('String(row.instagramUrl || "").trim() || null') &&
    publicProfileMapper.includes('String(row.facebookPageUrl || "").trim() || null'),
  "Public profile mapper must expose current production name/social values for review.",
);

assert(
  publicDiscoveryRoutes.includes('app.get("/api/public/profiles/:entity/:id", async (req, res) => {') &&
    publicDiscoveryRoutes.includes("return res.status(404).json({ message: \"Profile not found\" });") &&
    publicDiscoveryRoutes.includes("menuSections: listingMenuSections") &&
    publicDiscoveryRoutes.includes("No schedule posted"),
  "Public profile API must keep safe 404 and incomplete profile behavior.",
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
  assert.equal(typeof entry.currentProductionDisplayName, "string");
  assert("correctedDisplayNameProposal" in entry);
  assert("currentProductionSocialUrls" in entry);
  assert("suspectedMalformedSocialValues" in entry);
  assert("correctedSocialUrlProposals" in entry);
}

const jays = artifact.entries.find((entry: any) => entry.truckName === "Jays Southern Cuisine");
assert(jays);
assert.equal(jays.currentProductionDisplayName, "Jays Southern Cuisine ");
assert.equal(jays.correctedDisplayNameProposal, "Jays Southern Cuisine");
assert.equal(jays.displayNameCorrectionType, "whitespace_only");
assert.equal(jays.isWhitespaceOnlyHygieneCorrection, true);
assert.equal(jays.logoEvidenceStatus, "missing");
assert.equal(jays.coverEvidenceStatus, "missing");
assert.equal(jays.menuEvidenceStatus, "missing");

const blessed = artifact.entries.find((entry: any) => entry.truckName === "Blessed Berry Bowls");
assert(blessed);
assert.equal(blessed.currentProductionSocialUrls.instagramUrl, "https://@blessed.berrybowls");
assert.equal(blessed.currentProductionSocialUrls.facebookPageUrl, "https://facebook.com/Blessed Berry Bowls");
assert(
  blessed.suspectedMalformedSocialValues.some((item: any) => item.field === "instagramUrl") &&
    blessed.suspectedMalformedSocialValues.some((item: any) => item.field === "facebookPageUrl"),
);
assert(
  blessed.correctedSocialUrlProposals.some(
    (item: any) =>
      item.field === "instagramUrl" &&
      item.proposedValue === "https://www.instagram.com/blessedberrybowls/" &&
      item.ownerApprovalNeeded === true,
  ),
);
assert(
  blessed.correctedSocialUrlProposals.some(
    (item: any) =>
      item.field === "facebookPageUrl" &&
      item.proposedValue === "https://www.facebook.com/p/Blessed-Berry-Bowls-61561713173410/" &&
      item.ownerApprovalNeeded === true,
  ),
);
assert.equal(blessed.logoEvidenceStatus, "missing");
assert.equal(blessed.coverEvidenceStatus, "applied");
assert.equal(blessed.menuEvidenceStatus, "needs_owner_confirmation");
assert.equal(blessed.scheduleEvidenceStatus, "needs_owner_confirmation");

console.log("live-scout-truck-evidence-batch-1.contract: PASS");
