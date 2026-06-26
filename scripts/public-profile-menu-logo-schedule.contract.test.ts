import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");
const heroMedia = readFileSync("client/src/components/public-profile/ProfileHeroMedia.tsx", "utf8");
const truckScheduleTruth = readFileSync(
  "client/src/components/public-profile/truckScheduleTruth.ts",
  "utf8",
);

if (!page.includes('entity === "restaurant" || entity === "truck"')) {
  throw new Error("Public profile must treat truck entity as restaurant-like for render routing");
}

if (!page.includes(") : restaurantProfile ? (")) {
  throw new Error("Public profile restaurant render branch must include truck entity");
}

if (
  !page.includes("buildPublicProfileHeroAssets({") ||
  !truckHero.includes("buildPublicProfileHeroAssets({") ||
  !heroMedia.includes("profile.profileImageUrl") ||
  !heroMedia.includes("profile.truckPhotoLogo")
) {
  throw new Error("Hero asset mapping must preserve dedicated cover fields and legacy logo fallbacks");
}

if (
  !heroMedia.includes('data-testid="public-profile-hero-cover-fallback"') ||
  !heroMedia.includes('data-testid={showLogoImage ? "public-profile-hero-avatar" : "public-profile-hero-avatar-fallback"}')
) {
  throw new Error("Hero must fall back to clean cover and avatar placeholders when image data is missing or broken.");
}

if (
  !page.includes("getTruckScheduleRows(schedule)") ||
  !page.includes("getTruckScheduleEmptyStateLabel()") ||
  !truckHero.includes("getTruckScheduleAvailabilityLabel(schedule)") ||
  !truckHero.includes("hasTruckScheduleCta(schedule)") ||
  !truckScheduleTruth.includes('const EMPTY_SCHEDULE_LABEL = "No schedule posted"')
) {
  throw new Error("Truck schedule section must render honest status text or a none-found placeholder.");
}

if (
  !page.includes('Menu unavailable right now.') ||
  !page.includes("No menu posted yet.") ||
  !page.includes('profile.profileType === "truck"')
) {
  throw new Error("Menu section must render an honest unavailable/none-found state.");
}

if (!page.includes("No upcoming stops posted.")) {
  throw new Error("Truck schedule empty states must read as compact public-facing no-upcoming-stops copy.");
}

if (!page.includes('Map coordinates are not available yet.')) {
  throw new Error("Location map section must render an honest missing-coordinates state.");
}

if (
  !page.includes('No trucks listed right now. Check back soon.') ||
  !page.includes('Check back soon or explore nearby food.')
) {
  throw new Error("Host profiles must render honest no-trucks empty states instead of invented availability.");
}

if (!page.includes("if (dealItems.length === 0) return null;")) {
  throw new Error("Deals must remain optional on public profiles and not render a broken section when absent.");
}

console.log("public-profile-menu-logo-schedule.contract: PASS");
