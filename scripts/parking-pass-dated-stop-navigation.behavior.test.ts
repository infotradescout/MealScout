import assert from "node:assert/strict";

import {
  parseParkingPassOwnerNavigation,
  reconcileParkingPassTopTab,
  selectRequestedAccessibleTruck,
} from "../client/src/lib/parkingPassOwnerNavigation";

const navigation = parseParkingPassOwnerNavigation(
  "?setup=schedule&truckId=truck-two",
);
assert.equal(navigation.topTab, "schedule");
assert.equal(navigation.requestedTruckId, "truck-two");

const tabWhileBusinessesLoad = reconcileParkingPassTopTab({
  currentTab: navigation.topTab,
  accessIsLoading: true,
  availableTabs: ["book"],
  canUseTruckSide: false,
  canUseHostSide: false,
});
assert.equal(
  tabWhileBusinessesLoad,
  "schedule",
  "URL schedule intent must survive the initial render before owned trucks load",
);

const accessibleTrucks = [
  { id: "truck-one", name: "First accessible truck" },
  { id: "truck-two", name: "Requested accessible truck" },
];
const selectedTruck = selectRequestedAccessibleTruck(
  accessibleTrucks,
  navigation.requestedTruckId,
);
assert.equal(selectedTruck?.id, "truck-two");

const tabAfterBusinessesLoad = reconcileParkingPassTopTab({
  currentTab: tabWhileBusinessesLoad,
  accessIsLoading: false,
  availableTabs: ["book", "schedule"],
  canUseTruckSide: true,
  canUseHostSide: false,
});
assert.equal(
  tabAfterBusinessesLoad,
  "schedule",
  "an accessible requested truck must land on the dated-stop schedule editor",
);

assert.equal(
  selectRequestedAccessibleTruck(accessibleTrucks, "not-accessible")?.id,
  "truck-one",
  "an inaccessible requested id must fall back to the first accessible truck",
);

assert.equal(
  reconcileParkingPassTopTab({
    currentTab: "schedule",
    accessIsLoading: false,
    availableTabs: ["book"],
    canUseTruckSide: false,
    canUseHostSide: false,
  }),
  "book",
  "schedule intent must fall back only after access resolves without a truck",
);

console.log("parking-pass-dated-stop-navigation.behavior: PASS");
