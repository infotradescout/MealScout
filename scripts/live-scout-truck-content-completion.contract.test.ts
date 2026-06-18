import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const trackerPath = "docs/evidence/live-scout-truck-content-completion-2026-06-13.json";
const tracker = JSON.parse(readFileSync(trackerPath, "utf8"));
const manualTruckIntakeRunbook = readFileSync("docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md", "utf8");
const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const scoutSurfaceService = readFileSync("server/services/scoutSurfaceService.ts", "utf8");

const expectedTruckIds = new Map([
  ["3D Eats & Tea", "95c4e656-f3cc-46ab-ae18-53f549cecfd1"],
  ["Blessed Berry Bowls", "e77ac77a-c432-42d0-ac0f-22c48b6306c9"],
  ["Sweet Love", "f3b76054-f355-43b0-a2d3-901277748557"],
  ["All Gas No Brakes Reloaded", "6ca08365-f8af-4c1d-9754-6c998c803869"],
  ["CREATIVBOWLS", "75dd470e-2692-4579-bde0-a64dcc3f6fcb"],
  ["Jays Southern Cuisine", "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2"],
]);

const logoStatuses = new Set(["missing", "sourced", "applied", "needs_owner_confirmation"]);
const coverStatuses = new Set(["missing", "sourced", "applied", "needs_owner_confirmation"]);
const menuStatuses = new Set(["missing", "sourced", "applied", "needs_owner_confirmation"]);
const scheduleStatuses = new Set([
  "missing",
  "current_week_only",
  "recurring",
  "needs_owner_confirmation",
  "applied",
]);

assert.equal(tracker.repo, "MealScout");
assert.equal(tracker.scope?.workflowMode, "review_only");
assert.equal(tracker.scope?.productionMutationAllowed, false);
assert.equal(tracker.completionWorkflow?.existingRunbook, "docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md");
assert.equal(tracker.completionWorkflow?.dryRunEndpoint, "POST /api/admin/profile-evidence/apply");
assert.equal(tracker.completionWorkflow?.publicProfileCompatibility, "/truck/{slug}--{uuid}");

assert(
  manualTruckIntakeRunbook.includes("Default mode is dry run (`mode = dry_run`).") &&
    manualTruckIntakeRunbook.includes("Dry run does not mutate profile/menu rows.") &&
    manualTruckIntakeRunbook.includes("existing menu is not replaced unless `approvals.menuOverwrite = true`") &&
    manualTruckIntakeRunbook.includes("existing logo is not replaced unless `approvals.logoOverwrite = true`"),
  "Manual truck intake workflow must preserve review-first, no-silent-overwrite behavior.",
);

assert(
  publicProfilePage.includes("getTruckScheduleEmptyStateLabel()") &&
    publicProfilePage.includes("profile.profileType === \"truck\" && !hasTruckSchedule"),
  "Public truck profiles must keep rendering a safe schedule empty state.",
);

assert(
  publicDiscoveryRoutes.includes("const menuRows = await db") &&
    publicDiscoveryRoutes.includes("if (!menuRows.length)") &&
    publicDiscoveryRoutes.includes("menuSections: listingMenuSections") &&
    publicDiscoveryRoutes.includes("statusLabelMap") &&
    publicDiscoveryRoutes.includes("No schedule posted"),
  "Public profile API must represent incomplete menu/schedule payloads without failing.",
);

assert(
  scoutPage.includes('buildPublicProfilePath({') &&
    scoutPage.includes('entityType: "truck"') &&
    scoutPage.includes("\"Menu: none found\"") &&
    scoutPage.includes("\"Not live now\""),
  "Scout cards must keep clean truck profile links and honest incomplete-state labels.",
);

const scoutSurfaceCompact = scoutSurfaceService.replace(/\s+/g, " ");
assert(
  scoutSurfaceCompact.includes('href: buildPublicProfilePath( "truck", truckId') &&
    scoutSurfaceCompact.includes('entityType === "truck" ? "truck" : "restaurant"') &&
    !scoutSurfaceService.includes('href: `/truck/${encodeURIComponent(truckId)}`') &&
    !scoutSurfaceService.includes('? `/truck/${encodeURIComponent(restaurantId)}`') &&
    !scoutSurfaceService.includes(': `/restaurant/${encodeURIComponent(restaurantId)}`'),
  "Scout surface truck CTAs must emit clean /truck/{slug}--{uuid} paths, not /truck/:id or /restaurant/:id.",
);

for (const [name, id] of expectedTruckIds) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const expectedPath = `/truck/${slug}--${id}`;
  assert.match(expectedPath, /^\/truck\/[a-z0-9-]+--[a-f0-9-]{36}$/);
  assert(!expectedPath.includes("/restaurant/"));
  assert(!/^\/truck\/[a-f0-9-]{36}$/.test(expectedPath));
}

assert(Array.isArray(tracker.trucks), "Tracker must expose a trucks array.");
assert.equal(tracker.trucks.length, expectedTruckIds.size);

for (const row of tracker.trucks) {
  assert.equal(typeof row.truckName, "string");
  assert.equal(row.truckId, expectedTruckIds.get(row.truckName));
  assert.equal(row.profileId, row.truckId);
  assert.match(row.publicProfilePath, /^\/truck\/[a-z0-9-]+--[0-9a-f-]{36}$/);
  assert(logoStatuses.has(row.logoStatus), `${row.truckName} has invalid logoStatus`);
  assert(coverStatuses.has(row.coverStatus), `${row.truckName} has invalid coverStatus`);
  assert(menuStatuses.has(row.menuStatus), `${row.truckName} has invalid menuStatus`);
  assert(scheduleStatuses.has(row.scheduleStatus), `${row.truckName} has invalid scheduleStatus`);
  assert(Array.isArray(row.sourceUrls), `${row.truckName} sourceUrls must be an array`);
  assert(row.sourceUrls[0].includes(`/api/public/profiles/truck/${row.truckId}`));
  assert(Array.isArray(row.sourceArtifactPaths), `${row.truckName} sourceArtifactPaths must be an array`);
  assert(["low", "medium", "high"].includes(row.confidence), `${row.truckName} confidence must be low/medium/high`);
  assert.equal(row.ownerApprovalNeeded, true, `${row.truckName} should remain owner-review gated`);
  assert.equal(row.productionApplied, false, `${row.truckName} tracker must not claim production mutation`);
  assert.equal(typeof row.notes, "string");
  assert(row.notes.length > 0, `${row.truckName} notes are required`);
}

console.log("live-scout-truck-content-completion.contract: PASS");
