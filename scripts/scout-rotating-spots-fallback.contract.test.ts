import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rotateScoutSpots } from "../client/src/features/scout/scoutDiscoveryModel";

const spots = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
  { id: "d", name: "Delta" },
];
const originalOrder = spots.map((spot) => spot.id);
const getKey = (spot: (typeof spots)[number]) => spot.id;
const firstRotation = rotateScoutSpots(spots, "deals:100", getKey, 3);

assert.equal(firstRotation.length, 3);
assert.equal(new Set(firstRotation.map(getKey)).size, 3);
assert.deepEqual(
  spots.map((spot) => spot.id),
  originalOrder,
  "Rotation must not mutate the ranked source pool.",
);
assert.deepEqual(
  rotateScoutSpots(spots, "deals:100", getKey, 3),
  firstRotation,
  "The same lane and time bucket must produce a stable card order.",
);
assert.ok(
  Array.from({ length: 16 }, (_, index) =>
    rotateScoutSpots(spots, `deals:${101 + index}`, getKey, 3),
  ).some(
    (rotation) =>
      rotation.map(getKey).join(",") !== firstRotation.map(getKey).join(","),
  ),
  "Later rotation buckets must eventually expose a different lead spot.",
);
assert.deepEqual(
  rotateScoutSpots(
    [spots[0], spots[0], spots[1]],
    "events:100",
    getKey,
    8,
  ).map(getKey).sort(),
  ["a", "b"],
  "A business must not occupy multiple rotating slots.",
);

const scoutPage = readFileSync(
  new URL("../client/src/pages/explore-preview-v2.tsx", import.meta.url),
  "utf8",
);
const emptyState = readFileSync(
  new URL(
    "../client/src/components/scout/ScoutEmptyState.tsx",
    import.meta.url,
  ),
  "utf8",
);

for (const requiredSnippet of [
  "SCOUT_ROTATING_SPOT_INTERVAL_MS = 30 * 60 * 1000",
  "localRotatingSpotCandidatesForFeed",
  "networkRotatingSpotCandidates={activityFallbackRestaurants}",
  "rotateScoutSpots(",
  'title: "Scout These Spots"',
  'data-scout-row-fallback={',
  "scoutRotatingRowFallbackCopy",
  "emptyRowsEligibleForRotation",
  "rowsWithRotatingFallback",
  '`fallback-spots:${row.id}:${spotRotationBucket}`',
  "row.rotatingFallbackFor",
  'scope: "nearby" as const',
  'scope: "network" as const',
]) {
  assert.ok(
    scoutPage.includes(requiredSnippet),
    `Scout rotating fallback is missing: ${requiredSnippet}`,
  );
}

assert.match(
  scoutPage,
  /if \(laneId === "food_trucks"\) return \[\];/,
  "The live-truck lane must never prepare rotating fallback spots.",
);
assert.match(
  scoutPage,
  /activeSceneLaneId === "food_trucks"[\s\S]*?filter\(\(item\) => item\.kind === "Truck"\)\.slice\(0, 7\)/,
  "The truck scene must contain live truck items only.",
);
assert.match(
  scoutPage,
  /const emptyRowsEligibleForRotation = new Set\([\s\S]*?baseScoutRows[\s\S]*?\.filter\([\s\S]*?row\.cards\.length === 0[\s\S]*?\.map\(\(row\) => row\.id\)/,
  "Every empty discovery category with fallback candidates must be selected.",
);
assert.match(
  scoutPage,
  /const rowsWithRotatingFallback = baseScoutRows\.map\(\(row\) => \{[\s\S]*?if \(!emptyRowsEligibleForRotation\.has\(row\.id\)\)/,
  "Every selected quiet category must receive its rotating fallback.",
);
assert.doesNotMatch(
  scoutPage,
  /selectedRotatingFallbackRow/,
  "Rotating fallbacks must not be limited to one arbitrary quiet category.",
);
const rowFallbackCopyStart = scoutPage.indexOf(
  "const scoutRotatingRowFallbackCopy",
);
const rowFallbackCopyEnd = scoutPage.indexOf(
  "function getScoutRailCardKey",
  rowFallbackCopyStart,
);
assert.ok(rowFallbackCopyStart >= 0 && rowFallbackCopyEnd > rowFallbackCopyStart);
assert.doesNotMatch(
  scoutPage.slice(rowFallbackCopyStart, rowFallbackCopyEnd),
  /live_trucks_now/,
  "Now Serving Trucks must remain live-only and never accept a rotating fallback.",
);
assert.ok(emptyState.includes('"No live trucks right now."'));
assert.ok(
  emptyState.includes(
    '"Live trucks appear only while they are actively serving."',
  ),
);

console.log("scout-rotating-spots-fallback.contract: PASS");
