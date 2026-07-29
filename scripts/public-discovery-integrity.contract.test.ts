import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPublicDiscoveryEligibleEntity,
  isSyntheticPublicEntityName,
} from "../shared/publicDiscoveryIntegrity";

test("confirmed synthetic production records are not discovery eligible", () => {
  for (const name of [
    "asdf",
    "asdfasdfasdf",
    "discoverability-flow-1777479688781-295625",
    "test-supplier-1771607433376-s17ept",
    "Test Truck 1771607433376",
  ]) {
    assert.equal(isSyntheticPublicEntityName(name), true, name);
    assert.equal(
      isPublicDiscoveryEligibleEntity({ name, isActive: true }),
      false,
      name,
    );
  }
});

test("the narrow guard preserves legitimate public business names", () => {
  for (const name of [
    "Test Kitchen",
    "The Testing Grounds",
    "ASDF Coffee Roasters",
    "Discoverability Cafe",
    "Supplier Test Labs",
  ]) {
    assert.equal(isSyntheticPublicEntityName(name), false, name);
    assert.equal(
      isPublicDiscoveryEligibleEntity({ name, isActive: true }),
      true,
      name,
    );
  }
  assert.equal(
    isPublicDiscoveryEligibleEntity({
      name: "Legitimate Restaurant",
      isActive: false,
    }),
    false,
  );
});

test("sitemap and prerender paths consume the shared integrity policy", () => {
  const sitemap = readFileSync("server/routes/seoRoutes.ts", "utf8");
  const prerender = readFileSync(
    "server/seo/publicProfilePrerender.ts",
    "utf8",
  );

  assert.match(sitemap, /isPublicDiscoveryEligibleEntity/);
  assert.match(sitemap, /const restaurantRows = allRestaurantRows\.filter/);
  assert.match(sitemap, /const supplierRows = allSupplierRows\.filter/);
  assert.match(prerender, /isSyntheticPublicEntityName\(name\)/);
  assert.match(
    prerender,
    /some\(\(segment\) => isSyntheticPublicEntityName\(segment\)\)/,
  );
  assert.match(
    prerender,
    /robots: isSyntheticTestEntity \? noindexRobots : indexableRobots/,
  );
});
