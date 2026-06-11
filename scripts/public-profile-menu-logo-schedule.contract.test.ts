import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");

if (!page.includes('entity === "restaurant" || entity === "truck"')) {
  throw new Error("Public profile must treat truck entity as restaurant-like for render routing");
}

if (!page.includes(") : restaurantProfile ? (")) {
  throw new Error("Public profile restaurant render branch must include truck entity");
}

if (
  !page.includes("profile.coverImageUrl ||") ||
  !page.includes("(profile as any).profileImageUrl") ||
  !page.includes("(profile as any).truckPhotoLogo")
) {
  throw new Error("Hero logo/image render must include profileImageUrl and truckPhotoLogo fallbacks");
}

if (!page.includes('{heroImage ? (') || !page.includes('{initials}')) {
  throw new Error("Hero must fall back to initials artwork when logo or photo data is missing.");
}

if (!page.includes('Boolean(String(schedule?.statusLabel || "").trim())')) {
  throw new Error("Truck schedule section must render honest status text like 'No schedule posted'");
}

if (!page.includes('Menu unavailable right now.')) {
  throw new Error("Menu section must render an honest unavailable state when menu evidence exists but is not currently usable.");
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
