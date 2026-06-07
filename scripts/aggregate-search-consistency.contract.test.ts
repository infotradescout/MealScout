import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { storage } from "../server/storage.ts";
import { isPublicBusinessVisible } from "../server/utils/publicBusinessVisibility.ts";

const aggregateSource = readFileSync(
  "server/routes/publicSearchRoutes.ts",
  "utf8",
);
const restaurantSearchSource = readFileSync(
  "server/routes/restaurantCoreRoutes.ts",
  "utf8",
);

assert.match(
  aggregateSource,
  /import \{ isPublicBusinessVisible \} from "\.\.\/utils\/publicBusinessVisibility";/,
  "aggregate search must use the shared public business visibility guard",
);
assert.doesNotMatch(
  aggregateSource,
  /isTruckDiscoverableForScout/,
  "aggregate restaurant/profile bucket must not use the Scout-only truck listing gate",
);
assert.match(
  aggregateSource,
  /if \(!isPublicBusinessVisible\(restaurant\)\) return false;/,
  "aggregate search must suppress hidden/test/quarantined-style public profile data",
);
assert.match(
  restaurantSearchSource,
  /\.filter\(\s*\(\s*restaurant: any\s*\) => isPublicBusinessVisible\(restaurant\),\s*\)/,
  "restaurant search must continue to use the same public visibility guard",
);
assert.match(
  aggregateSource,
  /restaurants:\s*\[\]/,
  "short or empty aggregate search must keep an honest empty restaurant bucket",
);

const searchTerm = "tacos";
const knownRestaurantName = "MOROCCO'S TACO'S";
const restaurantRows = await storage.getAllRestaurants();

const restaurantSearchMatches = restaurantRows.filter((restaurant: any) => {
  if (!isPublicBusinessVisible(restaurant)) return false;
  if (!restaurant?.isActive) return false;
  const name = String(restaurant.name || "").toLowerCase();
  const cuisine = String(restaurant.cuisineType || "").toLowerCase();
  const address = String(restaurant.address || "").toLowerCase();
  return (
    name.includes(searchTerm) ||
    cuisine.includes(searchTerm) ||
    address.includes(searchTerm)
  );
});

const aggregateMatches = restaurantRows.filter((restaurant: any) => {
  if (!restaurant?.isActive) return false;
  if (!isPublicBusinessVisible(restaurant)) return false;
  const name = String(restaurant.name || "").toLowerCase();
  const cuisine = String(restaurant.cuisineType || "").toLowerCase();
  const address = String(restaurant.address || "").toLowerCase();
  return (
    name.includes(searchTerm) ||
    cuisine.includes(searchTerm) ||
    address.includes(searchTerm)
  );
});

const knownRestaurantSearchMatch = restaurantSearchMatches.find(
  (restaurant: any) =>
    String(restaurant.name || "").toUpperCase() === knownRestaurantName,
);
assert.ok(
  knownRestaurantSearchMatch,
  "restaurant search eligibility should include the known tacos profile",
);

const knownAggregateMatch = aggregateMatches.find(
  (restaurant: any) =>
    String(restaurant.name || "").toUpperCase() === knownRestaurantName,
);
assert.ok(
  knownAggregateMatch,
  "aggregate search eligibility should include the same known tacos profile",
);

assert.equal(
  aggregateMatches.some(
    (restaurant: any) => !restaurant?.isActive || !isPublicBusinessVisible(restaurant),
  ),
  false,
  "aggregate search must not include inactive or public-hidden restaurant profiles",
);

console.log("aggregate-search-consistency.contract: PASS");
