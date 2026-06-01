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

if (!page.includes('Boolean(String(schedule?.statusLabel || "").trim())')) {
  throw new Error("Truck schedule section must render honest status text like 'No schedule posted'");
}

console.log("public-profile-menu-logo-schedule.contract: PASS");
