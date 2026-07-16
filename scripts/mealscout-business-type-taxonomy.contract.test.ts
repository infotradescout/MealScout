import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isBarBusinessType,
  isRestaurantLikeBusinessType,
  isTruckBusinessType,
  toCanonicalFoodBusinessType,
} from "../shared/businessTypes";

assert.equal(toCanonicalFoodBusinessType(" FOOD-TRUCK "), "food_truck");
assert.equal(toCanonicalFoodBusinessType("brewery"), "bar");
assert.equal(toCanonicalFoodBusinessType("brewery_taproom"), "bar");
assert.equal(toCanonicalFoodBusinessType("venue"), "bar");
assert.equal(toCanonicalFoodBusinessType("mobile_food_vendor"), "food_truck");
assert.equal(isTruckBusinessType("truck"), true);
assert.equal(isBarBusinessType("taproom"), true);
assert.equal(isRestaurantLikeBusinessType("nightlife"), true);
assert.equal(isRestaurantLikeBusinessType("food_truck"), false);

const boundaryFiles = [
  "client/src/pages/explore-preview-v2.tsx",
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "server/publicProfiles/toPublicRestaurantProfile.ts",
  "server/publicProfiles/publicBusinessSlugResolver.ts",
  "server/utils/truckLocationSemantics.ts",
  "server/routes/publicDiscoveryRoutes.ts",
];

for (const path of boundaryFiles) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(
    source,
    /@shared\/businessTypes/,
    `${path} must use the shared business taxonomy`,
  );
}

for (const path of boundaryFiles.slice(2)) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  assert.doesNotMatch(
    source,
    /businessType\s*===\s*["'](?:food_truck|bar)["']/,
    `${path} must not restore direct public-boundary business type checks`,
  );
}

console.log("MealScout business type taxonomy contract: PASS");
