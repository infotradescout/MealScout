import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cleanupScripts = [
  "scripts/deleteNaBusinessRecord.ts",
  "scripts/mergeConfirmedDuplicateRestaurants.ts",
];

for (const path of cleanupScripts) {
  const source = readFileSync(path, "utf8");
  const guard = 'if (process.env[FREEZE_OVERRIDE] !== "true")';
  assert.ok(
    source.includes(guard),
    `${path} must require the explicit freeze override before any execution`,
  );

  const guardAt = source.indexOf(guard);
  const firstDeleteAt = source.search(/\b(delete|update)\s*\(/);
  assert.ok(guardAt >= 0, `${path} freeze guard must be present`);
  if (firstDeleteAt >= 0) {
    assert.ok(
      guardAt < firstDeleteAt,
      `${path} freeze guard must run before any destructive query`,
    );
  }

  assert.ok(
    guardAt < source.indexOf("await db"),
    `${path} freeze guard must run before database access`,
  );
}

console.log("Frozen cleanup safety contract: PASS");
