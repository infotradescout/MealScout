import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registryPath =
  "scripts/data/onboarding/curated-profile-cohort.json";
const capturePath =
  "scripts/captureCuratedProfileCohortBaseline.ts";
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as any;
const capture = readFileSync(capturePath, "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as any;
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const status = readFileSync("scripts/data/onboarding/STATUS.md", "utf8");

assert.equal(registry.canonicalTargetCount, 11);
assert.equal(registry.targets.length, 11);
assert.equal(
  new Set(registry.targets.map((target: any) => target.restaurantId)).size,
  11,
  "canonical target IDs must be unique",
);
assert.deepEqual(
  new Set(registry.targets.map((target: any) => target.restaurantId)),
  new Set([
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
    "6ca08365-f8af-4c1d-9754-6c998c803869",
    "0a5ef5b8-852a-4bfd-8626-f06218d83b31",
    "75dd470e-2692-4579-bde0-a64dcc3f6fcb",
    "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2",
    "d0fd61f5-4181-4216-a000-3dc08bd9a348",
    "f3b76054-f355-43b0-a2d3-901277748557",
    "bfe24073-7362-4975-83ba-43c096f782e3",
    "e77ac77a-c432-42d0-ac0f-22c48b6306c9",
    "60475d81-2ef7-4de9-bfbc-a009f097cbd6",
    "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0",
  ]),
  "the read-only query must remain locked to the exact curated cohort",
);

const spot = registry.targets.find(
  (target: any) => target.name === "The Spot Tavern",
);
const around = registry.targets.find(
  (target: any) => target.name === "Around The Table Catrring",
);
assert.equal(spot?.classificationExpectation, "bar");
assert.equal(around?.classificationExpectation, "unresolved");

const duplicateLinks = registry.duplicateCandidates.map(
  (candidate: any) =>
    `${candidate.canonicalRestaurantId}:${candidate.candidateRestaurantId}`,
);
assert.deepEqual(
  new Set(duplicateLinks),
  new Set([
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1:271878aa-082c-4990-a0ae-4da1d665ca0a",
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1:7ff7ba14-8e0a-48cf-b20a-e663e8d9d9e1",
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1:4c39db22-6c2f-4312-820f-45ad79aa9998",
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1:53de3f22-ebb6-4726-81c3-b2eba7c4ebc8",
    "75dd470e-2692-4579-bde0-a64dcc3f6fcb:c07e668e-63a9-4c1f-8a10-95bd15978df3",
    "75dd470e-2692-4579-bde0-a64dcc3f6fcb:16f4f038-6e85-4448-a03d-0669cc6e2876",
    "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0:7e36413b-6396-454e-a3c2-e93c00bad2bf",
  ]),
  "known duplicate candidates must remain explicitly linked to canonical profiles",
);
assert.deepEqual(registry.explicitExclusions, [
  {
    restaurantId: "ea23bd89-c674-4fe2-b581-e13a6d130752",
    name: "Tropiq Fuel LLC",
    reason:
      "public imported record outside the July 14 curated real-account cohort; reconcile under issue 303 rather than issue 302",
  },
]);
assert.equal(
  registry.duplicateCandidates.some((candidate: any) =>
    registry.targets.some(
      (target: any) => target.restaurantId === candidate.candidateRestaurantId,
    ),
  ),
  false,
  "no duplicate candidate may be promoted into the canonical cohort",
);

assert.match(
  capture,
  /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
);
assert.match(capture, /SET LOCAL statement_timeout = '10s'/);
assert.match(capture, /SET LOCAL lock_timeout = '2s'/);
assert.match(capture, /current_setting\('transaction_read_only'\)/);
assert.match(capture, /current_setting\('transaction_isolation'\)/);
assert.match(capture, /where r\.id = any\(\$1::text\[\]\)/i);
assert.match(capture, /mi\.restaurant_id = m\.restaurant_id/);
assert.match(
  capture,
  /mi\.restaurant_id is distinct from m\.restaurant_id/,
);
assert.match(capture, /crossOwnerMenuItemCount/);
assert.match(capture, /left join users u on u\.id = r\.owner_id/i);
assert.match(capture, /duplicateRows\.length > 100/);
assert.match(capture, /const duplicateInventoryIds/);
assert.match(capture, /where entity_id = any\(\$1::text\[\]\)/i);
assert.match(
  capture,
  /525b0cd6f12d8c53cbcd07450687c3625e42c74d/,
);
assert.match(capture, /--deployed-commit/);
assert.match(capture, /RENDER_GIT_COMMIT/);
assert.match(capture, /RENDER_GIT_REPO_SLUG/);
assert.match(capture, /RENDER_EXTERNAL_HOSTNAME/);
assert.match(capture, /mealscout\.onrender\.com/);
assert.match(capture, /information_schema\.columns/);
assert.match(capture, /return "missing_table" as const/);
  assert.match(capture, /return "missing_column" as const/);
assert.match(capture, /scope: "recent_365d"/);
assert.match(capture, /ANALYTICS_LOOKBACK_DAYS = 365/);
assert.match(
  capture,
  /where created_at >= current_timestamp[\s\S]*?ANALYTICS_LOOKBACK_DAYS/,
);
assert.match(capture, /historicalCoverage: "not_evaluated"/);
assert.match(capture, /captureScript/);
assert.match(capture, /missingExplicitDuplicateCandidateIds/);
assert.match(capture, /duplicateDependencyAudit/);
assert.match(
  capture,
  /table:\s*"request_logs",\s*column:\s*"entity_id"/,
);
assert.match(capture, /createHash\("sha256"\)/);
assert.match(capture, /ownerSubjectHash/);
assert.match(capture, /ownerClass/);
assert.match(capture, /orphaned_owner_reference/);
assert.match(capture, /manualSchedules/);
assert.match(capture, /confirmedBookings/);
assert.match(capture, /publicApprovedGalleryCount/);
assert.match(capture, /scoutEligibilityEvaluation/);
assert.match(capture, /state: "not_evaluated"/);
assert.match(capture, /floridaKitchenIdentityPair/);
assert.match(capture, /dependencyCounts/);
assert.match(capture, /security_audit_log/);
assert.match(capture, /affiliate_share_events/);
assert.match(capture, /lisa_claim/);
assert.match(capture, /path_contains_restaurant_id/);
assert.match(
  capture,
  /properties\.restaurantId\|truckId\|businessId\|entityId/,
);
assert.match(capture, /blocked_pending_review/);
assert.match(capture, /--output backups\/<file>\.json/);

assert.doesNotMatch(
  capture,
  /\b(?:insert\s+into|update\s+restaurants|delete\s+from|alter\s+table|drop\s+table|truncate\s+table|create\s+table)\b/i,
  "capture script must not contain database mutation SQL",
);
assert.doesNotMatch(
  capture,
  /\b(?:db|client)\.(?:insert|update|delete)\s*\(/,
  "capture script must not use ORM mutation methods",
);
assert.doesNotMatch(
  capture,
  /\bownerEmail\s*:/,
  "baseline output must not expose an owner email",
);
assert.doesNotMatch(
  capture,
  /\bownerId\s*:/,
  "baseline output must not expose a raw owner ID",
);
assert(
  !JSON.stringify(registry).includes("@"),
  "registry must not contain owner contact information",
);

assert.equal(
  packageJson.scripts["capture:curated-profile-cohort-baseline"],
  "tsx scripts/captureCuratedProfileCohortBaseline.ts",
);
assert.equal(
  packageJson.scripts["test:curated-profile-cohort-baseline"],
  "node --import tsx scripts/curated-profile-cohort-baseline.contract.test.ts",
);
assert.match(ci, /npm run test:curated-profile-cohort-baseline/);
assert.match(status, /historical working notes/i);
assert.match(status, /current production proof/i);
assert.match(status, /production baseline capture remains blocked/i);
assert.match(status, /24 public menu items/i);
assert.match(status, /7e36413b-6396-454e-a3c2-e93c00bad2bf/);

console.log("curated-profile-cohort-baseline.contract: PASS");
