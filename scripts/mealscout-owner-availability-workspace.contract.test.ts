import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const owner = read("client/src/pages/restaurant-owner-dashboard.tsx");
const shell = read("client/src/components/business-workspace-shell.tsx");
const navigation = read("client/src/components/navigation.tsx");

// The business shell owns mobile navigation on workspace routes. Four daily
// destinations stay visible; secondary tools live behind one More control.
assert.match(shell, /const mobilePrimaryModuleIds = new Set/);
for (const moduleId of ["overview", "profile", "menu", "availability"]) {
  assert.match(shell, new RegExp(`"${moduleId}"`));
}
assert.match(shell, /data-workspace-mobile-switcher="true"/);
assert.match(shell, /data-testid="workspace-mobile-nav-more"/);
assert.match(shell, /More business tools/);
assert.match(shell, /mobileSecondaryModules\.map/);
assert.match(
  navigation,
  /isBusinessWorkspaceRoute \? "hidden" : "fixed"/,
);
assert.match(
  navigation,
  /moreOpen && !isBusinessWorkspaceRoute/,
);

// Schedule URLs remain compatible, but the route renders the actual workflow
// immediately instead of onboarding copy, analytics cards, and a jump button.
assert.match(owner, /setupMode === "schedule"[\s\S]*"availability"/);
assert.match(owner, /setupMode === "bookings"[\s\S]*"availability"/);
assert.match(
  owner,
  /!\["schedule", "bookings"\]\.includes\(setupMode\)/,
);
assert.match(owner, /data-testid="owner-availability-workspace"/);
assert.match(owner, /data-testid="owner-live-location-panel"/);
assert.match(owner, /data-testid="owner-saved-location-panel"/);
assert.match(owner, /data-testid="owner-weekly-hours-panel"/);
assert.match(owner, /data-testid="owner-booked-stops-workspace"/);
assert.doesNotMatch(owner, /Jump to schedule and live tools|Jump to hours/);

// Restaurant and truck differences share one pattern without exposing truck
// implementation details to operators.
for (const copy of [
  "Schedule & live",
  "Hours & location",
  "Weekly service hours",
  "Weekly hours",
  "Go live",
  "Stop sharing",
  "Saved location",
  "Restaurant location",
  "Manage booked stops",
]) {
  assert.ok(owner.includes(copy), `Missing availability copy: ${copy}`);
}
assert.doesNotMatch(
  owner,
  /"WS:|"Broadcasting Tips"|"Updates Sent"|"Latitude:"|"Longitude:"|"Start Broadcasting"/,
);
assert.match(owner, /autoConnect: false/);
assert.match(
  owner,
  /const liveShareUrl = currentPublicProfileHref/,
);

// Existing contracts, mutation paths, and premium permission gates remain in
// place. This slice changes presentation and navigation, not business rules.
for (const endpoint of [
  "/api/restaurants/${selectedRestaurant}/truck-session/start",
  "/api/restaurants/${selectedRestaurant}/truck-session/end",
  "/api/restaurants/${selectedRestaurant}/location",
  "/api/restaurants/${selectedRestaurant}/operating-hours",
]) {
  assert.ok(owner.includes(endpoint), `Missing preserved endpoint: ${endpoint}`);
}
assert.match(owner, /if \(!hasPremiumLocationTools\)/);
assert.match(owner, /setLocation\("\/subscribe"\)/);
assert.match(owner, /navigator\.geolocation\.watchPosition/);
assert.match(owner, /stopFoodTruckSessionMutation\.mutate\(\)/);
assert.match(owner, /operatingHoursForm\.handleSubmit/);
assert.match(owner, /shouldDirty: true/);

console.log("mealscout-owner-availability-workspace.contract: PASS");
