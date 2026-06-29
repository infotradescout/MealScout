import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCOUT_HORIZONTAL_ROW_REGISTRY,
  assignScoutBusinessCardsBySection,
  getScoutBusinessKey,
  normalizeScoutBusinessKind,
} from "../client/src/features/scout/scoutDiscoveryModel";

const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const searchDock = readFileSync("client/src/components/scout/ScoutSearchDock.tsx", "utf8");

const expectedRowIds = [
  "live_trucks_now",
  "food_trucks_today",
  "open_now_near_you",
  "saved_favorites",
  "following",
  "order_again",
  "community_picks",
  "trending_this_week",
  "new_to_mealscout",
  "popular_dishes",
  "hot_deals",
  "happy_hours",
  "events_popups",
  "nearby_restaurants",
  "worth_discovering",
];

assert.deepEqual(
  SCOUT_HORIZONTAL_ROW_REGISTRY.map((row) => row.id),
  expectedRowIds,
  "Scout horizontal row registry must preserve the founder-spec row order plus real personalization slots.",
);

for (const row of SCOUT_HORIZONTAL_ROW_REGISTRY) {
  assert.equal(row.hideWhenEmpty, true, `${row.id} must hide instead of rendering fake empty shelves.`);
  assert.ok(row.acceptedCardKinds.length > 0, `${row.id} must declare accepted card kinds.`);
  assert.ok(row.maxCards > 0, `${row.id} must cap rendered cards.`);
}

const rowById = new Map(SCOUT_HORIZONTAL_ROW_REGISTRY.map((row) => [row.id, row]));
assert.deepEqual(rowById.get("live_trucks_now")?.acceptedCardKinds, ["food_truck"]);
assert.deepEqual(rowById.get("food_trucks_today")?.acceptedCardKinds, ["food_truck", "truck_stop"]);
assert.deepEqual(rowById.get("nearby_restaurants")?.acceptedCardKinds, ["restaurant"]);
assert.deepEqual(rowById.get("popular_dishes")?.acceptedCardKinds, ["menu_item"]);
assert.deepEqual(rowById.get("hot_deals")?.acceptedCardKinds, ["deal"]);
assert.deepEqual(rowById.get("happy_hours")?.acceptedCardKinds, ["happy_hour"]);
assert.deepEqual(rowById.get("events_popups")?.acceptedCardKinds, ["event"]);
assert.ok(rowById.get("saved_favorites")?.acceptedCardKinds.includes("restaurant"));
assert.ok(rowById.get("following")?.acceptedCardKinds.includes("restaurant"));
assert.ok(rowById.get("order_again")?.acceptedCardKinds.includes("menu_item"));
assert.ok(
  (rowById.get("community_picks")?.priority ?? 99) < (rowById.get("nearby_restaurants")?.priority ?? 0),
  "Community picks must outrank generic nearby restaurants.",
);
assert.ok(
  (rowById.get("trending_this_week")?.priority ?? 99) < (rowById.get("nearby_restaurants")?.priority ?? 0),
  "What's Hot/trending must outrank generic nearby restaurants.",
);
assert.ok(
  (rowById.get("new_to_mealscout")?.priority ?? 99) < (rowById.get("nearby_restaurants")?.priority ?? 0),
  "Newest listings must outrank generic nearby restaurants.",
);

for (const snippet of [
  "SCOUT_HORIZONTAL_ROW_REGISTRY",
  "function ScoutHorizontalCategoryRail(",
  'data-scout-row-id={row.id}',
  'data-scout-horizontal-rail="true"',
  'data-scout-card-kind={card.cardKind}',
  "overscroll-x-contain",
  "snap-x snap-mandatory",
  'id: "live_trucks_now"',
  'id: "open_now_near_you"',
  'id: "saved_favorites"',
  'id: "following"',
  'id: "order_again"',
  'title: "Now Serving Trucks"',
  'title: "Open Now Near You"',
  'title: "Your Favorites"',
  'title: "Following"',
  'title: "Order Again"',
  "favoriteRestaurantCandidates",
  "followedRestaurantCandidates",
  "const orderAgainCandidates: ScoutBusinessSectionCard[] = [];",
  "businessSectionRailCards",
  "menuItemRailCards(popularDishCards)",
  "dealRailCards(hotDealCandidates)",
  'dealRailCards(happyHourDeals, "happy_hour")',
  "eventRailCards(visibleSceneEvents)",
  "function ScoutFirstScreenDecisionStack(",
  'data-scout-first-screen-decision-stack="true"',
  'data-scout-immediate-compact-card="true"',
  "const highPriorityDecisionItems: ScoutImmediateDecisionItem[] = [",
  'sourceRowId: "live_trucks_now" as const',
  'sourceRowId: "food_trucks_today" as const',
  'sourceRowId: "open_now_near_you" as const',
  'sourceRowId: "community_picks" as const',
  'sourceRowId: "trending_this_week" as const',
  'sourceRowId: "new_to_mealscout" as const',
  'sourceRowId: "popular_dishes" as const',
  'sourceRowId: "hot_deals" as const',
  'sourceRowId: "happy_hours" as const',
  'sourceRowId: "events_popups" as const',
  'sourceRowId: "nearby_restaurants" as const',
  "highPriorityDecisionItems.length > 0",
  "firstScreenSuppressedBusinessKey",
  "suppressFirstScreenBusiness",
  'placement="inline"',
  "overflow-x-hidden",
  'data-scout-mobile-thirds-map="true"',
  'const compactMapHeight = "clamp(250px, 32dvh, 310px)";',
  "scoutSearchMode",
  "scoutSearchIntent",
  "restaurantSearchPriority",
]) {
  assert.ok(scoutPage.includes(snippet), `Scout horizontal rails runtime missing snippet: ${snippet}`);
}

const immediateStackStart = scoutPage.indexOf("function ScoutFirstScreenDecisionStack(");
const activeSceneStart = scoutPage.indexOf("function ActiveSceneContent(");
assert.ok(
  immediateStackStart >= 0 && activeSceneStart > immediateStackStart,
  "Scout first-screen decision stack must be defined before the full rail runtime.",
);
const immediateStackSource = scoutPage.slice(immediateStackStart, activeSceneStart);
assert.ok(
  !immediateStackSource.includes("NearbyRestaurantCard"),
  "Immediate decision stack must use compact cards instead of the full NearbyRestaurantCard rail layout.",
);
assert.ok(
  scoutPage.includes(
    "<ScoutFirstScreenDecisionStack items={firstScreenDecisionItems} />\n        {renderSearchDock?.()}\n        {scoutRows.map",
  ),
  "Scout default flow must render compact decision stack, then inline search, then full rails.",
);
assert.ok(
  scoutPage.includes(
    "highPriorityDecisionItems.length > 0\n        ? []\n        : nearbyRestaurantCards.map",
  ),
  "Nearby Restaurants may only seed the immediate stack when stronger real signals are empty.",
);

for (const staleSnippet of [
  "<OpenNowSection",
  "<ScoutSceneOptionsBar",
  "<ScoutActiveSceneIntro",
  "<FilterNearbyChips",
  'events={[]}',
  'deals={[]}',
]) {
  assert.ok(!scoutPage.includes(staleSnippet), `Scout For You runtime must not keep stale snippet: ${staleSnippet}`);
}

for (const snippet of [
  'data-scout-search-mode={searchMode ? "active" : "default"}',
  'data-scout-search-filters="true"',
  'data-scout-search-close="true"',
  "onFocus={onOpen}",
  "event.preventDefault();",
  "onQueryChange(event.target.value)",
  "SEARCH_FILTERS",
  'placement?: "fixed" | "inline";',
  'data-scout-search-placement={placement}',
  'placement === "inline"',
]) {
  assert.ok(searchDock.includes(snippet), `Scout search dock missing persistent search-mode snippet: ${snippet}`);
}

assert.ok(!searchDock.includes('href="/search"'), "Scout search dock must not leave Scout for a one-off /search route.");

const truck = { id: "truck-1", businessType: "food_truck", isFoodTruck: true };
const restaurant = { id: "restaurant-1", businessType: "restaurant", isFoodTruck: false };
const assignments = assignScoutBusinessCardsBySection([
  { id: "live_trucks_now", items: [truck], getBusinessKey: (item) => getScoutBusinessKey(item) },
  { id: "food_trucks_today", items: [truck], getBusinessKey: (item) => getScoutBusinessKey(item) },
  { id: "open_now_near_you", items: [truck, restaurant], getBusinessKey: (item) => getScoutBusinessKey(item) },
  { id: "nearby_restaurants", items: [restaurant], getBusinessKey: (item) => getScoutBusinessKey(item) },
  { id: "worth_discovering", items: [truck, restaurant], getBusinessKey: (item) => getScoutBusinessKey(item) },
]);

assert.deepEqual(assignments.live_trucks_now?.map((item) => item.id), ["truck-1"]);
assert.deepEqual(assignments.food_trucks_today, []);
assert.deepEqual(assignments.open_now_near_you?.map((item) => item.id), ["restaurant-1"]);
assert.deepEqual(assignments.nearby_restaurants, []);
assert.deepEqual(assignments.worth_discovering, []);

assert.equal(normalizeScoutBusinessKind({ businessType: "food_cart_collective" }, "restaurant"), "local_activity");

console.log("scout-horizontal-rails-ux.contract: PASS");
