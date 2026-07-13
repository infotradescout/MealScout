import assert from "node:assert/strict";
import { toScoutDiscoveryResult } from "../shared/scoutDiscoveryResult";
import { buildScoutResultViewModel } from "../client/src/features/scout/scoutResultViewModel";

const nearbyTruck = toScoutDiscoveryResult(
  {
    id: "truck-1",
    name: "Taco Motion",
    businessType: "food_truck",
    city: "Hammond",
    state: "LA",
    distanceMiles: 2.25,
    logoUrl: "https://img.example/logo.jpg",
    coverImageUrl: "https://img.example/cover.jpg",
  },
  {
    kind: "food_truck",
    scope: "nearby",
    source: "live_presence",
    href: "/truck/taco-motion",
  },
);
const truckView = buildScoutResultViewModel(nearbyTruck);
assert.equal(truckView.title, "Taco Motion");
assert.equal(truckView.href, "/truck/taco-motion");
assert.equal(truckView.primaryActionLabel, "View truck");
assert.equal(truckView.variant, "truck");
assert.equal(truckView.imageUrl, "https://img.example/cover.jpg");
assert.equal(truckView.locationLabel, "2.3 mi away");
assert.equal(truckView.scopeLabel, null);

const networkDish = toScoutDiscoveryResult(
  {
    id: "dish-1",
    name: "Birria Tacos",
    city: "Austin",
    state: "TX",
    imageUrl: "https://img.example/dish.jpg",
    restaurantCoverImageUrl: "https://img.example/restaurant.jpg",
  },
  {
    kind: "dish",
    scope: "network",
    source: "network_search",
    href: "/restaurant/1?dish=dish-1",
  },
);
const dishView = buildScoutResultViewModel(networkDish);
assert.equal(dishView.imageUrl, "https://img.example/dish.jpg");
assert.equal(dishView.primaryActionLabel, "View dish");
assert.equal(dishView.variant, "dish");
assert.equal(dishView.locationLabel, "Austin, TX");
assert.equal(dishView.scopeLabel, "Popular in Austin, TX");

const networkWithoutLocation = toScoutDiscoveryResult(
  { id: "deal-1", title: "Late Night Special" },
  {
    kind: "deal",
    scope: "network",
    source: "network_search",
  },
);
assert.equal(
  buildScoutResultViewModel(networkWithoutLocation).scopeLabel,
  "Popular on MealScout",
);

console.log("MealScout Scout result view-model contract: PASS");
