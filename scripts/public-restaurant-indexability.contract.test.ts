import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluatePublicRestaurantIndexability,
  isPublicRestaurantIndexable,
  PUBLIC_RESTAURANT_INDEXABLE_ROBOTS,
  PUBLIC_RESTAURANT_NOINDEX_ROBOTS,
  SITEMAP_MEMBERSHIP_VERSION,
} from "../server/seo/publicRestaurantIndexability";

const claimedBase = {
  name: "3D Eats",
  isActive: true,
  ownerId: "owner-claimed-1",
  ownerEmail: "owner@example.com",
  address: "100 Main St",
  cuisineType: "Tea",
  description: "Local tea and eats truck",
  city: "Pensacola",
  state: "FL",
  rawData: {},
};

test("offline counterexamples: claimed/indexable stays indexable", () => {
  const result = evaluatePublicRestaurantIndexability(claimedBase);
  assert.equal(result.indexable, true);
  assert.equal(result.robots, PUBLIC_RESTAURANT_INDEXABLE_ROBOTS);
  assert.deepEqual(result.reasons, []);
});

test("offline counterexamples: unclaimed import-system owner is noindex", () => {
  const result = evaluatePublicRestaurantIndexability({
    ...claimedBase,
    name: "16 Monkeys Concession",
    ownerEmail: "system-import@mealscout.us",
  });
  assert.equal(result.indexable, false);
  assert.equal(result.robots, PUBLIC_RESTAURANT_NOINDEX_ROBOTS);
  assert.ok(result.reasons.includes("unclaimed"));
});

test("offline counterexamples: synthetic/test name is noindex", () => {
  const result = evaluatePublicRestaurantIndexability({
    ...claimedBase,
    name: "Test Truck 1771607433376",
  });
  assert.equal(result.indexable, false);
  assert.ok(result.reasons.includes("synthetic"));
});

test("offline counterexamples: inactive is noindex", () => {
  const result = evaluatePublicRestaurantIndexability({
    ...claimedBase,
    isActive: false,
  });
  assert.equal(result.indexable, false);
  assert.ok(result.reasons.includes("inactive"));
});

test("offline counterexamples: explicit quarantine is noindex", () => {
  const result = evaluatePublicRestaurantIndexability({
    ...claimedBase,
    rawData: { evidenceQuarantine: { active: true } },
  });
  assert.equal(result.indexable, false);
  assert.ok(result.reasons.includes("quarantined"));
});

test("offline counterexamples: missing owner email fails closed", () => {
  assert.equal(
    isPublicRestaurantIndexable({
      name: "Claimed Looking Truck",
      isActive: true,
      ownerId: "owner-1",
      // ownerEmail omitted on purpose
    }),
    false,
  );
});

test("sitemap and prerender share the canonical indexability module", () => {
  const sitemap = readFileSync("server/routes/seoRoutes.ts", "utf8");
  const prerender = readFileSync(
    "server/seo/publicProfilePrerender.ts",
    "utf8",
  );
  const moduleSrc = readFileSync(
    "server/seo/publicRestaurantIndexability.ts",
    "utf8",
  );

  assert.match(moduleSrc, /SITEMAP_MEMBERSHIP_VERSION/);
  assert.match(sitemap, /isPublicRestaurantIndexable|isIndexableRestaurantRow/);
  assert.match(sitemap, /applySitemapMembershipCacheHeaders/);
  assert.match(sitemap, /innerJoin\(users/);
  assert.match(prerender, /publicRestaurantRobotsDirective/);
  assert.ok(SITEMAP_MEMBERSHIP_VERSION.length > 0);
});
