import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { getPrivateBehaviorScoresForRestaurants } from "../server/services/privateBehaviorScoreService";

const source = readFileSync(
  "server/services/privateBehaviorScoreService.ts",
  "utf8",
);

const forbiddenSnippets = [
  "any(${normalizedIds}::text[])",
  "unnest(${normalizedIds}::text[])",
];

for (const snippet of forbiddenSnippets) {
  assert.equal(
    source.includes(snippet),
    false,
    `private behavior query must not reintroduce unsafe array cast: ${snippet}`,
  );
}

const requiredSnippets = [
  "const restaurantIdList = sql.join(",
  "const restaurantIdValues = sql.join(",
  "mapped.restaurant_id in (${restaurantIdList})",
  "from (values ${restaurantIdValues}) as ids(restaurant_id)",
  "if (!hasPrivateBehaviorSignals) continue;",
];

for (const snippet of requiredSnippets) {
  assert.equal(
    source.includes(snippet),
    true,
    `private behavior query missing safe query guard: ${snippet}`,
  );
}

const absentId = `absent-${randomUUID()}`;
const absentScores = await getPrivateBehaviorScoresForRestaurants([absentId]);
assert.equal(
  absentScores.size,
  0,
  "absent private behavior data should return an empty score map",
);

const presentCandidateScores = await getPrivateBehaviorScoresForRestaurants([
  "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0",
]);
assert.ok(
  presentCandidateScores instanceof Map,
  "present candidate lookup should complete without throwing",
);

console.log("private-behavior-score-query.contract: PASS");
