import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifactPath =
  "docs/evidence/live-scout-truck-blessed-berry-schedule-current-week-apply-2026-06-14.json";

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const script = readFileSync("scripts/applyBlessedBerryCurrentWeekSchedule.ts", "utf8");
const publicDiscovery = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const publicMap = readFileSync("server/routes/publicMapRoutes.ts", "utf8");
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const schema = readFileSync("shared/schema/legacy.ts", "utf8");
const migration = readFileSync(
  "migrations/109_truck_manual_schedule_current_week_metadata.sql",
  "utf8",
);

assert.equal(artifact.repo, "MealScout");
assert.equal(artifact.workflowMode, "operator_apply");
assert.equal(artifact.productionMutationAllowed, true);
assert.equal(artifact.productionApplied, true);
assert.equal(artifact.entry.truckName, "Blessed Berry Bowls");
assert.equal(artifact.entry.truckId, "e77ac77a-c432-42d0-ac0f-22c48b6306c9");
assert.equal(artifact.entry.scheduleType, "current_week_only");
assert.equal(artifact.entry.timezone, "America/Chicago");
assert.equal(artifact.entry.ownerSubmittedEquivalent, true);
assert.equal(artifact.entry.recurring, false);
assert.equal(artifact.entry.needsOwnerConfirmationBeforeRecurringReuse, true);
assert.equal(artifact.entry.productionApplied, true);
assert.equal(artifact.entry.events.length, 8);
assert.equal(
  artifact.entry.events.filter((event: any) => event.status === "open").length,
  6,
);
assert.equal(
  artifact.entry.events.filter((event: any) => event.status === "closed").length,
  2,
);

for (const event of artifact.entry.events) {
  assert.notEqual(event.status, "recurring");
  if (event.status === "open") {
    assert.equal(event.mapEligible, true);
    assert.equal(event.liveFeedEligible, true);
    assert.equal(event.geocodeStatus, "needs_geocode");
    assert.match(event.startTimeLocal, /^\d{2}:\d{2}$/);
    assert.match(event.endTimeLocal, /^\d{2}:\d{2}$/);
  } else {
    assert.equal(event.mapEligible, false);
    assert.equal(event.liveFeedEligible, false);
    assert.equal(event.addressLine1, undefined);
    assert.equal(event.startTimeLocal, undefined);
    assert.equal(event.endTimeLocal, undefined);
  }
}

assert(script.includes("Production apply requires --allow-production."));
assert(script.includes("Refusing to overwrite"));
assert(script.includes('recurring: false'));
assert(script.includes('status: "closed"'));
assert(script.includes('mapEligible: event.mapEligible'));
assert(script.includes('liveFeedEligible: event.liveFeedEligible'));
assert(script.includes('geocodeStatus: event.geocodeStatus || null'));

assert(schema.includes('status: varchar("status").default("open")'));
assert(schema.includes('scheduleType: varchar("schedule_type")'));
assert(schema.includes('ownerSubmittedEquivalent: boolean("owner_submitted_equivalent").default(false)'));
assert(schema.includes('recurring: boolean("recurring").default(false)'));
assert(schema.includes('mapEligible: boolean("map_eligible").default(true)'));
assert(schema.includes('liveFeedEligible: boolean("live_feed_eligible").default(true)'));
assert(migration.includes("ALTER COLUMN start_time DROP NOT NULL"));
assert(migration.includes("ALTER COLUMN address DROP NOT NULL"));

assert(publicDiscovery.includes('if (sourceStatus === "closed") return "closed" as const;'));
assert(publicDiscovery.includes('closed: "Closed"'));
assert(publicDiscovery.includes("isClosedDay || row.mapEligible === false"));
assert(publicMap.includes('status !== "open"'));
assert(publicMap.includes("schedule.mapEligible === false"));
assert(publicMap.includes("schedule.liveFeedEligible === false"));
assert(publicProfile.includes('stop.status === "closed" ? "Closed"'));

console.log("blessed-berry-current-week-schedule-apply.contract: PASS");
