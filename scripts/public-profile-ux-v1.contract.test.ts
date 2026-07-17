import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const elevatedTruckHero = readFileSync("client/src/components/public-profile/ElevatedTruckHero.tsx", "utf8");
const elevatedProfileHero = readFileSync("client/src/components/public-profile/ElevatedProfileHero.tsx", "utf8");
const publicMenu = readFileSync("client/src/components/public-profile/PublicProfileMenu.tsx", "utf8");
const truckSchedule = readFileSync("client/src/components/public-profile/TruckSchedulePanel.tsx", "utf8");
const restaurantHours = readFileSync("client/src/components/public-profile/RestaurantHoursPanel.tsx", "utf8");
const planYourVisit = readFileSync("client/src/components/public-profile/PlanYourVisitPanel.tsx", "utf8");
const thinProfile = readFileSync("client/src/components/public-profile/ThinProfileState.tsx", "utf8");
const mobileDock = readFileSync("client/src/components/public-profile/MobileActionDock.tsx", "utf8");
const relatedRail = readFileSync("client/src/components/public-profile/PersonalizedRelatedRail.tsx", "utf8");
const decisionBar = readFileSync("client/src/components/public-profile/PublicProfileDecisionBar.tsx", "utf8");
const relatedScoutRail = readFileSync("client/src/components/public-profile/RelatedScoutRail.tsx", "utf8");

for (const snippet of [
  "ElevatedTruckHero",
  "ElevatedProfileHero",
  "PublicProfileMenu",
  "TruckSchedulePanel",
  "RestaurantHoursPanel",
  "PlanYourVisitPanel",
  "ThinProfileState",
  "PublicProfileDecisionBar",
  "RelatedScoutRail",
  "MobileActionDock",
]) {
  assert.ok(publicProfilePage.includes(snippet), `Public profile page missing elevated UX component: ${snippet}`);
}

assert.ok(
  publicProfilePage.includes("client/src/components/public-profile") ||
    publicProfilePage.includes("@/components/public-profile/PublicProfileDecisionBar"),
  "Public profile runtime must import real public-profile runtime components.",
);

for (const snippet of [
  "where is this truck right now?",
  "Food truck",
  "getTruckSchedulePrimaryStop",
]) {
  assert.ok(elevatedTruckHero.includes(snippet), `Elevated truck hero missing truck decision cue: ${snippet}`);
}

assert.ok(
  decisionBar.includes("pickDecisionAction") &&
    mobileDock.includes("Directions") &&
    mobileDock.includes("Menu"),
  "Truck/restaurant profiles must expose entity-aware actions through the decision bar and mobile dock.",
);

for (const snippet of [
  'data-public-profile-decision-bar="true"',
  'data-profile-kind={profile.profileType}',
  "What to order",
  "At a glance",
  "Schedule not posted yet",
  "Hours not posted yet",
  "Menu not posted yet",
  "getTruckSchedulePrimaryStop",
]) {
  assert.ok(decisionBar.includes(snippet), `Decision bar missing food-decision runtime cue: ${snippet}`);
}

assert.ok(
  publicProfilePage.includes("<PublicProfileDecisionBar") &&
    publicProfilePage.includes("<PublicProfileMenu") &&
    publicProfilePage.includes("<RelatedScoutRail"),
  "Public profile page must render the decision bar, organized menu, and related Scout rail at runtime.",
);

assert.ok(
  publicProfilePage.match(/profile=\{restaurantProfile\}[\s\S]{0,120}safeCtas=\{safeCtas\}/),
  "PublicProfileDecisionBar must receive the real profile payload and safe CTAs.",
);

for (const snippet of [
  "Restaurant",
  "Open",
]) {
  assert.ok(elevatedProfileHero.includes(snippet), `Elevated restaurant hero missing restaurant decision cue: ${snippet}`);
}

assert.ok(
  !publicProfilePage.includes("<WhyGoNowPanel"),
  "Profile flow must not repeat hours, schedule, deals, and events in a second signal panel.",
);
assert.ok(
  publicMenu.includes('data-public-profile-menu="organized"') &&
    publicMenu.includes('data-public-menu-items="true"'),
  "Public profiles must render one organized menu surface.",
);
assert.ok(truckSchedule.includes("Current stop") || truckSchedule.includes("Today"), "Truck schedule panel must answer stop/today context.");
assert.ok(restaurantHours.includes("Hours"), "Restaurant hours panel must preserve hours context.");
assert.ok(planYourVisit.includes("Plan your visit"), "Plan Your Visit panel must preserve action context.");
// Deliberate design (see ThinProfileState.tsx's own docstring): thin
// profiles show only what's actually available and don't announce what's
// missing with "not posted" placeholders, to avoid a discouraging wall
// of empty-state text on the sparsest profiles.
assert.ok(thinProfile.includes("does not announce what's missing"), "Thin profiles must document the intentional no-missing-state design.");
assert.ok(thinProfile.includes("Claim or update this profile"), "Thin profiles must keep claim/update CTA without implying verified ownership.");
assert.ok(mobileDock.includes("fixed") && mobileDock.includes("bottom-0"), "Mobile action dock must be sticky on mobile.");
assert.ok(mobileDock.includes("grid-cols-4") && !mobileDock.includes("`grid-cols-${"), "Mobile dock must use compile-time Tailwind grid classes.");
assert.ok(mobileDock.includes('data-mobile-action-dock="true"'), "Mobile dock must expose a stable browser-smoke marker.");
assert.ok(mobileDock.includes("isSelfProfileAction") && mobileDock.includes('cta.type !== "share"'), "Mobile dock must exclude self-profile, share, and social CTAs.");
assert.ok(relatedRail.includes("overflow-x-auto"), "Related Scout rail must be horizontally scrollable.");
assert.ok(relatedScoutRail.includes("PersonalizedRelatedRail"), "RelatedScoutRail must wrap the existing related discovery runtime.");

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
