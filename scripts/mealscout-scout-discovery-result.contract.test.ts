import assert from "node:assert/strict";
import {
  dedupeScoutDiscoveryResults,
  rankScoutDiscoveryResults,
  selectScoutDiscoveryResults,
  toScoutDiscoveryResult,
} from "../shared/scoutDiscoveryResult";
import { normalizeScoutBusinessKind } from "../client/src/features/scout/scoutDiscoveryModel";

const localTaco = toScoutDiscoveryResult(
  {
    id: "local-taco",
    name: "Neighborhood Tacos",
    cuisineType: "Mexican",
    businessType: "restaurant",
    city: "Hammond",
    state: "LA",
    distanceMiles: 2.4,
    recommendationCount: 2,
  },
  {
    kind: "business",
    scope: "nearby",
    source: "local_inventory",
    queryTerms: ["taco", "mexican"],
  },
);

assert.equal(localTaco.key, "business:local-taco");
assert.equal(localTaco.businessKey, "business:local-taco");
assert.equal(localTaco.businessType, "restaurant");
assert.equal(localTaco.location.label, "Hammond, LA");
assert.equal(localTaco.location.scope, "nearby");
assert.ok(localTaco.relevance.matchedTerms.includes("taco"));
assert.ok(localTaco.activity.reasons.includes("community"));

const networkTaco = toScoutDiscoveryResult(
  {
    id: "network-taco",
    name: "Most Active Taqueria",
    cuisineType: "Mexican",
    businessType: "restaurant",
    city: "Houston",
    state: "TX",
    homeRankingScore: 10000,
  },
  {
    kind: "business",
    scope: "network",
    source: "network_search",
    queryTerms: ["taco", "mexican"],
  },
);

assert.equal(
  rankScoutDiscoveryResults([networkTaco, localTaco])[0]?.entityId,
  "local-taco",
  "Nearby results must always rank before network results",
);

const duplicateLocalTaco = toScoutDiscoveryResult(
  {
    id: "local-taco",
    name: "Neighborhood Tacos duplicate",
    businessType: "restaurant",
  },
  {
    kind: "business",
    scope: "nearby",
    source: "trending",
  },
);
assert.equal(
  dedupeScoutDiscoveryResults([localTaco, duplicateLocalTaco]).length,
  1,
);

const selected = selectScoutDiscoveryResults(
  [
    {
      id: "quiet",
      name: "Quiet Pizza",
      businessType: "restaurant",
      trendScore: 1,
    },
    {
      id: "active",
      name: "Active Pizza",
      businessType: "restaurant",
      trendScore: 10,
    },
  ],
  {
    kind: "business",
    scope: "network",
    source: "trending",
    queryTerms: ["pizza"],
    limit: 1,
  },
);
assert.equal(selected[0]?.entityId, "active");

assert.equal(normalizeScoutBusinessKind({ businessType: "brewery" }), "restaurant");
assert.equal(normalizeScoutBusinessKind({ businessType: "private_chef" }), "restaurant");
assert.equal(normalizeScoutBusinessKind({ businessType: "food-truck" }), "food_truck");

console.log("MealScout canonical Scout discovery result contract: PASS");
