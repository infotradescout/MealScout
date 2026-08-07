import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUniqueViolation } from "../server/utils/isUniqueViolation";

// Drizzle wraps Postgres unique_violation as DrizzleQueryError with cause.code.
assert.equal(
  isUniqueViolation({ code: "23505" }),
  true,
  "top-level 23505 must count as already-followed",
);
assert.equal(
  isUniqueViolation({
    name: "DrizzleQueryError",
    message:
      'duplicate key value violates unique constraint "IDX_restaurant_follows_unique"',
    cause: { code: "23505" },
  }),
  true,
  "Drizzle-wrapped cause.code 23505 must count as already-followed",
);
assert.equal(
  isUniqueViolation({ code: "23503", cause: { code: "23503" } }),
  false,
  "non-unique violations must not be treated as already-followed",
);
assert.equal(
  isUniqueViolation(new Error("network")),
  false,
  "unrelated errors must not be treated as already-followed",
);

const route = readFileSync("server/routes/restaurantCoreRoutes.ts", "utf8");
assert.match(
  route,
  /import \{ isUniqueViolation \} from "\.\.\/utils\/isUniqueViolation"/,
  "restaurant follow/favorite routes must use the shared helper",
);

const autoFollow = route.slice(
  route.indexOf("async function autoFollowRestaurant"),
  route.indexOf('"/api/restaurants/:restaurantId/favorite"'),
);
assert.match(
  autoFollow,
  /if \(!isUniqueViolation\(error\)\)/,
  "autoFollowRestaurant must gate console.error with isUniqueViolation",
);
assert.doesNotMatch(
  autoFollow,
  /error\?\.code !== "23505"/,
  "autoFollowRestaurant must not use the fragile top-level-only 23505 check",
);

const followHandler = route.slice(
  route.indexOf('"/api/restaurants/:restaurantId/follow"'),
  route.indexOf('"/api/restaurants/:restaurantId/follow"') + 2800,
);
assert.match(
  followHandler,
  /if \(isUniqueViolation\(error\)\) \{[\s\S]*?console\.error\("Error adding restaurant follow:"/,
  "follow duplicate path must treat unique violation as success before logging",
);

const favoriteHandler = route.slice(
  route.indexOf('"/api/restaurants/:restaurantId/favorite"'),
  route.indexOf('"/api/restaurants/:restaurantId/follow"'),
);
assert.match(
  favoriteHandler,
  /if \(isUniqueViolation\(error\)\) \{[\s\S]*?console\.error\("Error adding restaurant favorite:"/,
  "favorite duplicate path must treat unique violation as success before logging",
);

console.log("restaurant-follow-unique-violation: PASS");
