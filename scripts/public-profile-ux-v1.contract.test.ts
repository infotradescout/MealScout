import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const elevatedTruckHero = readFileSync("client/src/components/public-profile/ElevatedTruckHero.tsx", "utf8");
const elevatedProfileHero = readFileSync("client/src/components/public-profile/ElevatedProfileHero.tsx", "utf8");
const whyGoNow = readFileSync("client/src/components/public-profile/WhyGoNowPanel.tsx", "utf8");
const menuHighlights = readFileSync("client/src/components/public-profile/MenuHighlightsRail.tsx", "utf8");
const truckSchedule = readFileSync("client/src/components/public-profile/TruckSchedulePanel.tsx", "utf8");
const restaurantHours = readFileSync("client/src/components/public-profile/RestaurantHoursPanel.tsx", "utf8");
const planYourVisit = readFileSync("client/src/components/public-profile/PlanYourVisitPanel.tsx", "utf8");
const thinProfile = readFileSync("client/src/components/public-profile/ThinProfileState.tsx", "utf8");
const mobileDock = readFileSync("client/src/components/public-profile/MobileActionDock.tsx", "utf8");
const relatedRail = readFileSync("client/src/components/public-profile/PersonalizedRelatedRail.tsx", "utf8");

for (const snippet of [
  "ElevatedTruckHero",
  "ElevatedProfileHero",
  "WhyGoNowPanel",
  "MenuHighlightsRail",
  "TruckSchedulePanel",
  "RestaurantHoursPanel",
  "PlanYourVisitPanel",
  "ThinProfileState",
  "PersonalizedRelatedRail",
  "MobileActionDock",
]) {
  assert.ok(publicProfilePage.includes(snippet), `Public profile page missing elevated UX component: ${snippet}`);
}

for (const snippet of [
  "where is this truck right now?",
  "Food truck",
  "getTruckSchedulePrimaryStop",
  "hasTruckScheduleSignal",
]) {
  assert.ok(elevatedTruckHero.includes(snippet), `Elevated truck hero missing truck decision cue: ${snippet}`);
}

assert.ok(
  publicProfilePage.includes("<QuickActionRow profile={data} safeCtas={safeCtas} />") &&
    mobileDock.includes("Directions") &&
    mobileDock.includes("Menu"),
  "Truck/restaurant profiles must expose Directions/Menu actions through the action row and mobile dock.",
);

for (const snippet of [
  "Restaurant",
  "Open",
]) {
  assert.ok(elevatedProfileHero.includes(snippet), `Elevated restaurant hero missing restaurant decision cue: ${snippet}`);
}

assert.ok(whyGoNow.includes("Why go now"), "Why Go Now panel must keep the decision-oriented section label.");
assert.ok(menuHighlights.includes("overflow-x-auto"), "Menu highlights must render as a horizontal rail.");
assert.ok(truckSchedule.includes("Current stop") || truckSchedule.includes("Today"), "Truck schedule panel must answer stop/today context.");
assert.ok(restaurantHours.includes("Hours"), "Restaurant hours panel must preserve hours context.");
assert.ok(planYourVisit.includes("Plan your visit"), "Plan Your Visit panel must preserve action context.");
assert.ok(thinProfile.includes("Menu not posted yet"), "Thin profiles must show honest compact missing-menu state.");
assert.ok(thinProfile.includes("Claim or update this profile"), "Thin profiles must keep claim/update CTA without implying verified ownership.");
assert.ok(mobileDock.includes("fixed") && mobileDock.includes("bottom-0"), "Mobile action dock must be sticky on mobile.");
assert.ok(relatedRail.includes("overflow-x-auto"), "Related Scout rail must be horizontally scrollable.");

for (const forbidden of [
  "audit",
  "Gemini",
  "fake menu",
  "fake schedule",
  "Community/evidence-based profile",
]) {
  assert.ok(
    !publicProfilePage.toLowerCase().includes(forbidden.toLowerCase()),
    `Public profile runtime must not expose process/fake-content copy: ${forbidden}`,
  );
}

console.log("public-profile-ux-v1.contract: PASS");
