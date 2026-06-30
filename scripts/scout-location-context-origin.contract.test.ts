import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/lib/api.ts", "utf8");

assert.match(
  source,
  /normalizedPath\.startsWith\("\/api\/location\/context"\)/,
  "MealScout API routing must keep /api/location/context same-origin on MealScout hosts",
);

console.log("scout-location-context-origin.contract: PASS");
