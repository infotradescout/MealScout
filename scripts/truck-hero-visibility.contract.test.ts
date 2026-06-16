import { readFileSync } from "node:fs";

const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");

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
  "No upcoming stops listed",
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
  truckHero,
  'data-testid="truck-profile-hero-fallback"',
  "TruckHero must use a branded fallback when no cover image is available.",
);
requireIncludes(
  truckHero,
  "No upcoming stops listed",
  "TruckHero must show a clear empty schedule state.",
);
requireIncludes(
  truckHero,
  "Community/evidence-based profile",
  "TruckHero must use neutral trust language when ownership/currentness is not proven.",
);
requireIncludes(
  truckHero,
  "Menu partial",
  "TruckHero must honestly label partial menu evidence.",
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
  "Verified",
  "TruckHero must not show generic Verified copy for imported or incomplete truck profiles.",
);
requireExcludes(
  truckHero,
  "Owner verified",
  "TruckHero must not claim owner verification without a dedicated data-backed field.",
);
requireExcludes(
  truckHero,
  "updated 2 hours ago",
  "TruckHero must not invent fake freshness.",
);

console.log("truck-hero-visibility.contract: PASS");
