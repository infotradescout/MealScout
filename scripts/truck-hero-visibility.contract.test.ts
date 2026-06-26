import { readFileSync } from "node:fs";

const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");
const heroMedia = readFileSync("client/src/components/public-profile/ProfileHeroMedia.tsx", "utf8");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) {
    throw new Error(message);
  }
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) {
    throw new Error(message);
  }
};

requireIncludes(
  publicProfile,
  'import { TruckHero } from "@/components/public-profile/TruckHero";',
  "Public profile page must use the isolated truck hero component.",
);
requireIncludes(
  publicProfile,
  'restaurantProfile?.profileType === "truck" ? (',
  "Truck hero must render only for truck public profiles.",
);
requireIncludes(
  publicProfile,
  "<TruckHero profile={restaurantProfile} safeCtas={safeCtas} />",
  "Truck branch must pass existing profile and CTA data into TruckHero.",
);
requireIncludes(
  publicProfile,
  "<HeroBlock profile={data} />",
  "Restaurant and non-truck profile rendering must keep the existing HeroBlock path.",
);
requireIncludes(
  publicProfile,
  "<MenuSection profile={restaurantProfile} safeCtas={safeCtas} />",
  "Restaurant menu rendering must remain present after the hero branch.",
);
requireIncludes(
  publicProfile,
  "<RestaurantSchedule profile={restaurantProfile} />",
  "Restaurant schedule rendering must remain present after the hero branch.",
);
requireIncludes(
  publicProfile,
  "No upcoming stops posted.",
  "Truck schedule empty state must be useful instead of blank or database-like.",
);
requireExcludes(
  publicProfile,
  "Schedule: none found.",
  "Truck schedule empty state must not use the old database-like copy.",
);

const truckHeroIndex = publicProfile.indexOf("<TruckHero profile={restaurantProfile} safeCtas={safeCtas} />");
const menuIndex = publicProfile.indexOf("<MenuSection profile={restaurantProfile} safeCtas={safeCtas} />");
const aboutIndex = publicProfile.indexOf("<AboutFoodStyle profile={restaurantProfile} />");
const galleryIndex = publicProfile.indexOf("<GalleryStrip profile={restaurantProfile} />");
if (truckHeroIndex < 0 || menuIndex < 0 || aboutIndex < 0 || galleryIndex < 0) {
  throw new Error("Public profile source must include truck hero and downstream profile sections.");
}
if (truckHeroIndex > menuIndex || truckHeroIndex > aboutIndex || truckHeroIndex > galleryIndex) {
  throw new Error("Truck hero must promote status/next stop above menu, about, and gallery sections.");
}

requireIncludes(
  truckHero,
  'data-testid="truck-profile-hero"',
  "TruckHero must expose a stable hero marker.",
);
requireIncludes(
  truckHero,
  'data-testid="truck-profile-next-stop"',
  "TruckHero must promote current/next stop information.",
);
requireIncludes(
  heroMedia,
  'data-testid="public-profile-hero-cover-fallback"',
  "TruckHero must use a branded fallback when no cover image is available.",
);
requireIncludes(
  truckHero,
  "profile.description ? (",
  "TruckHero must show direct descriptive business content when it exists.",
);
requireIncludes(
  truckHero,
  "Limited menu info",
  "TruckHero must keep partial menu messaging compact.",
);
requireIncludes(
  truckHero,
  "Menu available",
  "TruckHero must honestly label available menu evidence.",
);
requireIncludes(
  truckHero,
  'href="/claim-truck"',
  "TruckHero must expose only the existing claim/update route for owner updates.",
);
requireExcludes(
  truckHero,
  "Community/evidence-based profile",
  "TruckHero must not lead with community-profile explainer copy.",
);
requireExcludes(
  truckHero,
  "Profile snapshot",
  "TruckHero must remove snapshot narration in favor of direct facts.",
);
requireExcludes(
  truckHero,
  "Public links",
  "TruckHero must not replace direct links with a links-count explainer.",
);

console.log("truck-hero-visibility.contract: PASS");
