import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/lib/api.ts", "utf8");

assert.match(
  source,
  /return normalizedPath\.startsWith\("\/api\/"\);/,
  "MealScout API routing must keep every /api/* request same-origin on MealScout hosts",
);

console.log("scout-location-context-origin.contract: PASS");
