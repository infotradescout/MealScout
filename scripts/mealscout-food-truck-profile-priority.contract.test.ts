import { readFileSync } from "node:fs";

const hero = readFileSync(
  "client/src/components/public-profile/ElevatedTruckHero.tsx",
  "utf8",
);
const profile = readFileSync("client/src/pages/public-profile.tsx", "utf8");

for (const required of [
  'data-testid="truck-hero-primary-stop"',
  "primaryStop.label",
  "stop?.locationName",
  "stop?.timeWindowLabel",
  'data-analytics-action="directions_click"',
  'href="#truck-schedule"',
  "Full schedule",
  'href="#menu"',
  "See what they serve",
  "Schedule not posted yet",
]) {
  if (!hero.includes(required)) {
    throw new Error(`Food-truck hero priority contract missing: ${required}`);
  }
}

if (
  !profile.includes(
    'restaurantProfile.profileType === "truck" ? (\n                <ElevatedTruckHero',
  )
) {
  throw new Error(
    "Food-truck profiles must keep their distinct truck-first hero",
  );
}

if (!profile.includes("<TruckSchedulePanel profile={restaurantProfile} />")) {
  throw new Error("Food-truck profiles must keep the full schedule panel");
}

console.log("mealscout-food-truck-profile-priority.contract: PASS");
