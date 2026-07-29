import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "scripts/quarantineConfirmedPublicTestRecords.ts",
  "utf8",
);

test("production quarantine is exact, soft, and confirmation gated", () => {
  for (const id of [
    "ac10d98b-61a5-4e88-b072-4ef87c853524",
    "a39791fa-6d77-4a65-82b7-2e61f161d556",
    "e0c8f6c8-841a-4464-8063-11c6d44de42e",
    "d48fb6af-997f-4b93-ad15-084cd83c336d",
    "8fa06e2c-21b1-4a3f-b12b-d1eed9ab3baa",
  ]) {
    assert.match(source, new RegExp(id));
  }
  assert.match(source, /--allow-production/);
  assert.match(
    source,
    /MEALSCOUT_QUARANTINE_CONFIRMED_PUBLIC_TEST_RECORDS_2026_07_29/,
  );
  assert.match(source, /set\(\{ isActive: false, updatedAt: new Date\(\) \}\)/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(
    source,
    /\.(?:update|delete)\((?:users|orders|payments)\)/,
  );
});
