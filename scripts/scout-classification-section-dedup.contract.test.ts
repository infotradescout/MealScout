import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assignScoutBusinessCardsBySection,
  getScoutBusinessKey,
  normalizeScoutBusinessKind,
} from "../client/src/features/scout/scoutDiscoveryModel";

const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const scoutTypes = readFileSync("client/src/features/scout/scoutTypes.ts", "utf8");

const knownTruck = {
  id: "blessed-berry-bowls",
  name: "Blessed Berry Bowls",
  businessType: "food_truck",
  isFoodTruck: true,
};
const knownRestaurant = {
  id: "garden-table",
  businessName: "Garden Table",
  businessType: "restaurant",
  isFoodTruck: false,
};
const unknownFoodEntity = {
  id: "mystery-local-food",
  businessName: "Mystery Local Food",
  businessType: "food_cart_collective",
};

assert.equal(
  normalizeScoutBusinessKind(knownTruck, "restaurant"),
  "food_truck",
  "A known food truck must never normalize to Restaurant.",
);
assert.equal(
  normalizeScoutBusinessKind(knownRestaurant, "restaurant"),
  "restaurant",
  "A known restaurant must never normalize to Food truck.",
);
assert.equal(
  normalizeScoutBusinessKind(unknownFoodEntity, "restaurant"),
  "local_activity",
  "Unknown explicit business types must not fall back to Restaurant.",
);

const sectionAssignments = assignScoutBusinessCardsBySection([
  {
    id: "live_trucks_now",
    items: [knownTruck],
    getBusinessKey: (item) => getScoutBusinessKey(item),
  },
  {
    id: "food_trucks_today",
    items: [knownTruck],
    getBusinessKey: (item) => getScoutBusinessKey(item),
  },
  {
    id: "nearby_restaurants",
    items: [knownTruck, knownRestaurant],
    getBusinessKey: (item) => getScoutBusinessKey(item),
  },
  {
    id: "worth_discovering",
    items: [knownRestaurant],
    getBusinessKey: (item) => getScoutBusinessKey(item),
  },
]);

assert.deepEqual(
  sectionAssignments.live_trucks_now?.map((item) => item.id),
  ["blessed-berry-bowls"],
  "The strongest section should keep the truck business card.",
);
assert.deepEqual(
  sectionAssignments.food_trucks_today,
  [],
  "The same truck business card must not repeat in Food Trucks Today after Open Now claims it.",
);
assert.deepEqual(
  sectionAssignments.nearby_restaurants?.map((item) => item.id),
  ["garden-table"],
  "Nearby Restaurants must not receive a truck business card.",
);
assert.deepEqual(
  sectionAssignments.worth_discovering,
  [],
  "Worth Discovering must not duplicate cards already shown in stronger sections.",
);

const requiredKinds = [
  "food_truck",
  "restaurant",
  "truck_stop",
  "menu_item",
  "deal",
  "happy_hour",
  "event",
  "community_pick",
  "map_place",
  "local_activity",
];
for (const kind of requiredKinds) {
  assert.ok(
    scoutTypes.includes(`| "${kind}"`) || scoutTypes.includes(`  "${kind}"`),
    `Scout card type is missing normalized kind: ${kind}`,
  );
}

const requiredScoutRuntimeSnippets = [
  'import {\n  SCOUT_HORIZONTAL_ROW_REGISTRY,',
  "assignScoutBusinessCardsBySection,",
  "SCOUT_HORIZONTAL_ROW_REGISTRY",
  'normalizeScoutBusinessKind(source, "restaurant")',
  'const nearbyFoodBusinesses = useMemo<RestaurantSummary[]>(() => {',
  'getScoutRestaurantLikeKind(restaurant) === "restaurant"',
  'getScoutRestaurantLikeKind(restaurant) === "food_truck"',
  'id: "live_trucks_now"',
  'id: "food_trucks_today"',
  'id: "open_now_near_you"',
  'id: "saved_favorites"',
  'id: "following"',
  'id: "order_again"',
  'id: "nearby_restaurants"',
  'id: "trending_this_week"',
  'id: "new_to_mealscout"',
  'id: "community_picks"',
  'id: "worth_discovering"',
  "ScoutHorizontalCategoryRail",
  "data-scout-horizontal-rail",
  'Food truck',
  'Restaurant',
  'getMenuItemProfilePath(item)',
  'function getTrendingPlaceProfilePath(place: TrendingPlaceSummary): string {',
];

for (const snippet of requiredScoutRuntimeSnippets) {
  assert.ok(scoutPage.includes(snippet), `Canonical Scout runtime missing snippet: ${snippet}`);
}

const forbiddenScoutRuntimeSnippets = [
  'readBooleanField(restaurant, ["isFoodTruck", "foodTruck", "isTruck"]) === true',
  'return filtered.length > 0 ? filtered : restaurantsOpenNow;',
  'return filtered.length > 0 ? filtered : allDeals;',
  'return filtered.length > 0 ? filtered : visibleEvents;',
  'return trucksNearByStatus;',
];

for (const snippet of forbiddenScoutRuntimeSnippets) {
  assert.ok(
    !scoutPage.includes(snippet),
    `Canonical Scout runtime must not keep stale fallback snippet: ${snippet}`,
  );
}

console.log("scout-classification-section-dedup.contract: PASS");
