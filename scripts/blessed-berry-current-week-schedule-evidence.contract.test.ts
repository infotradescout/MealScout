import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifactPath =
  "docs/evidence/live-scout-truck-blessed-berry-schedule-current-week-2026-06-14.json";
const trackerPath = "docs/evidence/live-scout-truck-content-completion-2026-06-13.json";

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const tracker = JSON.parse(readFileSync(trackerPath, "utf8"));
const entry = artifact.entry;
const trackerBlessed = tracker.trucks.find(
  (truck: any) => truck.truckName === "Blessed Berry Bowls",
);

assert.equal(artifact.repo, "MealScout");
assert.equal(artifact.workflowMode, "review_only");
assert.equal(artifact.productionMutationAllowed, false);
assert.equal(artifact.productionApplied, false);
assert.equal(artifact.parentTracker, trackerPath);
assert.equal(artifact.source.sourceType, "uploaded_schedule_image");
assert.equal(
  artifact.source.sourceArtifact,
  "719523676_2163800804470829_7581408798811548725_n.jpg",
);
assert.equal(artifact.source.sourceArtifactPresentInRepo, false);
assert(
  artifact.source.notes.some((note: string) =>
    note.includes("Do not treat this weekly schedule as recurring"),
  ),
);

assert.equal(entry.truckName, "Blessed Berry Bowls");
assert.equal(entry.truckId, "e77ac77a-c432-42d0-ac0f-22c48b6306c9");
assert.equal(entry.profileId, entry.truckId);
assert.equal(
  entry.publicProfilePath,
  "/truck/blessed-berry-bowls--e77ac77a-c432-42d0-ac0f-22c48b6306c9",
);
assert.equal(entry.scheduleStatus, "current_week_only");
assert.equal(entry.scheduleEvidenceStatus, "current_week_only");
assert.equal(entry.logoEvidenceStatus, "sourced");
assert.equal(entry.coverEvidenceStatus, "applied");
assert.equal(entry.menuEvidenceStatus, "needs_owner_confirmation");
assert.equal(entry.scheduleTranscriptionOwnerApprovalNeeded, false);
assert.equal(entry.recurringReuseOwnerApprovalNeeded, true);
assert.equal(entry.ownerApprovalNeeded, true);
assert.equal(entry.productionApplied, false);
assert.equal(entry.weekOf, "2026-06-15");
assert.equal(entry.confidence, "high");

assert.equal(entry.events.length, 8);
assert.deepEqual(
  entry.events.map((event: any) => event.date),
  [
    "2026-06-15",
    "2026-06-16",
    "2026-06-17",
    "2026-06-18",
    "2026-06-19",
    "2026-06-19",
    "2026-06-20",
    "2026-06-21",
  ],
);
assert(
  entry.events.some(
    (event: any) =>
      event.locationName === "The Tristan Apartments" &&
      event.address === "1559 W Nine Mile Rd." &&
      event.time === "4 PM - 7 PM",
  ),
);
assert(
  entry.events.some(
    (event: any) =>
      event.locationName === "Molino Ballpark" &&
      event.address === "2340 Crabtree Church Rd." &&
      event.time === "4 PM - 9 PM",
  ),
);
assert.equal(
  entry.events.find((event: any) => event.date === "2026-06-20")?.status,
  "closed",
);
assert.equal(
  entry.events.find((event: any) => event.date === "2026-06-21")?.note,
  "Happy Father's Day",
);

assert.equal(entry.contact.phone, "256-479-6490");
assert.equal(entry.contact.website, "blessedberrybowls.com");
assert.equal(entry.social.facebook, "@blessedberrybowls");
assert.equal(entry.social.tiktok, "@blessedberrybowls");
assert.equal(entry.social.instagram, "@blessedberrybowls");
assert.match(entry.productionApplyRecommendation, /current_week_only/);
assert.doesNotMatch(JSON.stringify(artifact), /"scheduleStatus":"recurring"/);
assert.doesNotMatch(JSON.stringify(artifact), /"productionApplied":true/);

assert(trackerBlessed, "Tracker must include Blessed Berry Bowls");
assert.equal(trackerBlessed.logoStatus, "sourced");
assert.equal(trackerBlessed.scheduleStatus, "current_week_only");
assert.equal(trackerBlessed.productionApplied, false);
assert.equal(trackerBlessed.ownerApprovalNeeded, true);
assert(
  trackerBlessed.sourceArtifactPaths.includes(artifactPath),
  "Tracker must reference Blessed current-week schedule evidence artifact",
);
assert(
  trackerBlessed.sourceArtifactPaths.includes(
    "operator-upload:719523676_2163800804470829_7581408798811548725_n.jpg",
  ),
  "Tracker must retain operator uploaded image source reference",
);

console.log("blessed-berry-current-week-schedule-evidence.contract: PASS");
