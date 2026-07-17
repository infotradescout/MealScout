import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const page = read("client/src/pages/public-profile.tsx");
const styles = read("client/src/index.css");
const decisionBar = read(
  "client/src/components/public-profile/PublicProfileDecisionBar.tsx",
);
const truckHero = read(
  "client/src/components/public-profile/ElevatedTruckHero.tsx",
);
const publicMenu = read(
  "client/src/components/public-profile/PublicProfileMenu.tsx",
);
const relatedRail = read(
  "client/src/components/public-profile/PersonalizedRelatedRail.tsx",
);
const gallerySlice = page.slice(
  page.indexOf("function PublicProfileGalleryTile"),
  page.indexOf("function RestaurantSchedule"),
);

test("public profiles use the bright shared MealScout shell", () => {
  assert.match(page, /data-public-profile-shell="warm-food-led"/);
  assert.match(styles, /\.mealscout-public-profile \{/);
  assert.match(styles, /--profile-page: #fff8ef/);
  assert.doesNotMatch(page, /<div className="min-h-screen bg=\[#070605\]"/);
});

test("restaurants, bars, and food trucks share the canonical profile flow", () => {
  assert.match(
    page,
    /normalized === "restaurant"\s*\|\|\s*normalized === "truck"\s*\|\|\s*normalized === "bar"/,
  );
  assert.match(page, /<ElevatedTruckHero/);
  assert.match(page, /<ElevatedProfileHero/);
  assert.match(page, /<PublicProfileDecisionBar/);
  assert.match(page, /<TruckSchedulePanel profile=\{restaurantProfile\}/);
  assert.match(page, /<RestaurantHoursPanel profile=\{restaurantProfile\}/);
  assert.match(page, /data-public-profile-details-grid="menu-and-visit"/);
  assert.match(page, /data-public-profile-details-grid="visit-only"/);
  assert.doesNotMatch(page, /<TruckVisitStrip/);
  assert.doesNotMatch(page, /<WhyGoNowPanel/);
});

test("mobile and desktop expose one primary action layer each", () => {
  assert.match(
    decisionBar,
    /profile-action-primary hidden[^\n]+md:inline-flex/,
  );
  assert.match(page, /<MobileActionDock/);
  assert.doesNotMatch(page, /Open Scout|Scout nearby|Keep scouting|Back to Scout/);
  assert.match(relatedRail, />\s*Scout\s*</);
});

test("food imagery and failed gallery assets remain decision-safe", () => {
  assert.match(publicMenu, /getDishCategoryPhoto\(item\.name, item\.description\)/);
  assert.match(publicMenu, /categoryPhotoImage/);
  assert.match(truckHero, /<ProfileFavoriteButton/);
  assert.match(gallerySlice, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(gallerySlice, /Photo unavailable/);
});

test("published menus connect the public profile to the public menu route", () => {
  assert.match(
    page,
    /`\/menu\/\$\{encodeURIComponent\(profile\.id\)\}`/,
  );
  assert.match(publicMenu, />\s*View full menu\s*<MenuSquare/);
});

test("the organized menu stays constrained inside the mobile profile grid", () => {
  assert.match(page, /className="grid min-w-0 gap-6/);
  assert.match(page, /className=\{`min-w-0 \$\{/);
  assert.match(publicMenu, /className="min-w-0 scroll-mt-24 space-y-3"/);
  assert.match(page, /className=\{`min-w-0 space-y-6 lg:sticky/);
});

test("fixed-location heroes do not append locality to a display-ready address", () => {
  const hero = read(
    "client/src/components/public-profile/ElevatedProfileHero.tsx",
  );
  assert.match(hero, /String\(profile\.addressPublicLabel \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(
    hero,
    /\[profile\.addressPublicLabel, profile\.city, profile\.state\]/,
  );
});

console.log("mealscout-public-profile-shell.contract: PASS");
