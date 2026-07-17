import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCOUT_HORIZONTAL_ROW_REGISTRY,
  SCOUT_MIN_MENU_BUSINESS_DIVERSITY,
  getScoutCanonicalBusinessKey,
  selectDistinctScoutMenuBusinesses,
} from "../client/src/features/scout/scoutDiscoveryModel.ts";

const floridaKitchenPoke = {
  id: "dish-poke",
  restaurantId: "listing-a",
  restaurantName: "The Florida Kitchen Island Cuisine",
  restaurantCity: "Pensacola",
  restaurantState: "FL",
};
const floridaKitchenSandwich = {
  id: "dish-cuban",
  restaurantId: "listing-b",
  restaurantName: "The Florida Kitchen - Island Cuisine",
  restaurantCity: "Pensacola",
  restaurantState: "FL",
};
const gardenTableDish = {
  id: "dish-garden",
  restaurantId: "listing-c",
  restaurantName: "Garden Table",
  restaurantCity: "Pensacola",
  restaurantState: "FL",
};

assert.equal(
  getScoutCanonicalBusinessKey(floridaKitchenPoke),
  getScoutCanonicalBusinessKey(floridaKitchenSandwich),
  "Punctuation-only listing variants must resolve to one business identity.",
);

assert.deepEqual(
  selectDistinctScoutMenuBusinesses(
    [floridaKitchenPoke, floridaKitchenSandwich, gardenTableDish],
    10,
  ).map((item) => item.id),
  ["dish-poke", "dish-garden"],
  "A menu category must feature each canonical business at most once.",
);

assert.deepEqual(
  selectDistinctScoutMenuBusinesses([floridaKitchenSandwich], 10).map(
    (item) => item.id,
  ),
  ["dish-cuban"],
  "A business may appear again when a different category starts a fresh selection.",
);

const claimedBusinessKeys = new Set<string>();
selectDistinctScoutMenuBusinesses(
  [floridaKitchenPoke],
  10,
  claimedBusinessKeys,
);
assert.deepEqual(
  selectDistinctScoutMenuBusinesses(
    [floridaKitchenSandwich, gardenTableDish],
    10,
    claimedBusinessKeys,
  ).map((item) => item.id),
  ["dish-garden"],
  "Supplemental menu data must fill the rail with unseen businesses.",
);

assert.equal(SCOUT_MIN_MENU_BUSINESS_DIVERSITY, 2);
assert.equal(
  SCOUT_HORIZONTAL_ROW_REGISTRY.find((row) => row.id === "popular_dishes")
    ?.dedupPolicy,
  "strict_business",
);

const scoutPage = readFileSync(
  "client/src/pages/explore-preview-v2.tsx",
  "utf8",
).replace(/\r\n/g, "\n");

for (const requiredSnippet of [
  "claimedMenuHighlightBusinessKeys",
  "hasMenuHighlightBusinessDiversity",
  "selectDistinctScoutMenuBusinesses(",
  "getScoutMenuItemBusinessKey(card.item)",
  "hasNewMenuBusinessDiversity",
  'data-scout-row-fallback="new_menus"',
]) {
  assert.ok(
    scoutPage.includes(requiredSnippet),
    `Scout menu diversity runtime is missing: ${requiredSnippet}`,
  );
}

assert.match(
  scoutPage,
  /const popularDishCards = hasMenuHighlightBusinessDiversity\s+\? distinctPrimaryDishCards\s+: \[\]/,
  "An under-diverse Menu Highlights pool must yield to rotating business spots.",
);
assert.match(
  scoutPage,
  /laneId === "new_menus" &&\s+!hasNewMenuBusinessDiversity &&\s+newMenuFallbackSpots\.length > 0/,
  "New Menus must also rotate distinct businesses when menu diversity is too thin.",
);

const firstScreenSuppressionStart = scoutPage.indexOf(
  "const suppressFirstScreenBusiness =",
);
const firstScreenSuppressionEnd = scoutPage.indexOf(
  "const hasForYouSections =",
  firstScreenSuppressionStart,
);
assert.ok(
  firstScreenSuppressionStart >= 0 &&
    firstScreenSuppressionEnd > firstScreenSuppressionStart,
);
assert.doesNotMatch(
  scoutPage.slice(firstScreenSuppressionStart, firstScreenSuppressionEnd),
  /card\.cardType === "menu_item"/,
  "A menu business may remain visible when the same business leads a different category.",
);

console.log("scout-menu-business-diversity.contract: PASS");
