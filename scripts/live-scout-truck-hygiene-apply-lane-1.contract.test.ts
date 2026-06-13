import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const artifactPath = path.resolve(
  process.cwd(),
  "docs/evidence/live-scout-truck-hygiene-apply-lane-1-2026-06-13.json",
);
const applyScriptPath = path.resolve(
  process.cwd(),
  "scripts/applyLiveScoutTruckHygieneLane1.ts",
);

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const applyScript = readFileSync(applyScriptPath, "utf8");

assert.equal(artifact.repo, "MealScout");
assert.equal(artifact.workflowMode, "approved_tiny_production_hygiene_apply");
assert.equal(artifact.productionMutationAllowed, true);
assert.equal(artifact.productionApplied, true);
assert.equal(artifact.applyScript, "scripts/applyLiveScoutTruckHygieneLane1.ts");

assert.deepEqual(
  artifact.sourceArtifacts,
  [
    "docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json",
    "docs/evidence/live-scout-truck-hygiene-apply-proposal-2026-06-13.json",
  ],
);

assert.equal(artifact.appliedChanges.length, 1);
const [jays] = artifact.appliedChanges;
assert.equal(jays.changeId, "jays-display-name-whitespace-trim");
assert.equal(jays.truckName, "Jays Southern Cuisine");
assert.equal(jays.truckId, "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2");
assert.equal(jays.publicProfilePath, "/truck/jays-southern-cuisine--96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2");
assert.equal(jays.field, "restaurants.name");
assert.equal(jays.before, "Jays Southern Cuisine ");
assert.equal(jays.after, "Jays Southern Cuisine");
assert.equal(jays.classification, "whitespace_only_hygiene_correction");
assert.equal(jays.ownerApprovalNeeded, false);
assert.equal(jays.productionApplied, true);
assert.equal(jays.liveApiVerification.status, 200);
assert.equal(jays.liveApiVerification.displayName, "Jays Southern Cuisine");
assert.equal(jays.liveApiVerification.profilePath, jays.publicProfilePath);

assert.equal(artifact.gatedChanges.length, 1);
const [blessed] = artifact.gatedChanges;
assert.equal(blessed.changeId, "blessed-social-url-cleanup-gated");
assert.equal(blessed.truckName, "Blessed Berry Bowls");
assert.equal(blessed.truckId, "e77ac77a-c432-42d0-ac0f-22c48b6306c9");
assert.deepEqual(blessed.fields, [
  "restaurants.instagramUrl",
  "restaurants.facebookPageUrl",
]);
assert.equal(blessed.currentProductionValues.instagramUrl, "https://@blessed.berrybowls");
assert.equal(blessed.currentProductionValues.facebookPageUrl, "https://facebook.com/Blessed Berry Bowls");
assert.equal(blessed.ownerApprovalNeeded, true);
assert.equal(blessed.productionApplied, false);
assert.match(blessed.gateReason, /owner approval/i);
assert.match(blessed.gateReason, /non-blank social URL changes/i);
assert.equal(blessed.liveApiVerification.status, 200);
assert.equal(
  blessed.liveApiVerification.socialLinks.instagramUrl,
  blessed.currentProductionValues.instagramUrl,
);
assert.equal(
  blessed.liveApiVerification.socialLinks.facebookPageUrl,
  blessed.currentProductionValues.facebookPageUrl,
);

for (const forbidden of [
  "logoUrl",
  "coverImageUrl",
  "menuSections",
  "truckSchedule",
  "toasttab.com",
  "Big Jay",
]) {
  assert.doesNotMatch(
    JSON.stringify(artifact.appliedChanges),
    new RegExp(forbidden, "i"),
    `Applied changes must not include ${forbidden}.`,
  );
}
assert.deepEqual(Object.keys(jays).sort(), [
  "after",
  "before",
  "changeId",
  "classification",
  "field",
  "liveApiVerification",
  "notes",
  "ownerApprovalNeeded",
  "productionApplied",
  "productionApplyResult",
  "publicProfilePath",
  "truckId",
  "truckName",
].sort());

for (const required of [
  "No Blessed Berry Bowls social URL fields were mutated.",
  "No logo, cover, menu, schedule, description, Toast, or Big Jay's candidate data was applied.",
  "No clean URL, affiliate URL, public truck profile routing, invalid UUID, or missing-content behavior was changed.",
]) {
  assert.ok(artifact.explicitNonActions.includes(required));
}

assert.match(applyScript, /--allow-production/);
assert.match(applyScript, /Jays Southern Cuisine /);
assert.match(applyScript, /Jays Southern Cuisine/);
assert.match(applyScript, /BLESSED_TRUCK_ID/);
assert.doesNotMatch(applyScript, /instagramUrl:\s*["']/);
assert.doesNotMatch(applyScript, /facebookPageUrl:\s*["']/);

console.log("Live Scout truck hygiene apply lane 1 contract passed.");
