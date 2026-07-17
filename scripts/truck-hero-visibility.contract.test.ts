import { readFileSync } from "node:fs";

const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");
const elevatedTruckHero = readFileSync("client/src/components/public-profile/ElevatedTruckHero.tsx", "utf8");
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
  'import { ElevatedTruckHero } from "@/components/public-profile/ElevatedTruckHero";',
  "Public profile page must use the elevated truck hero component.",
);
requireIncludes(
  publicProfile,
  'restaurantProfile.profileType === "truck" ? (',
  "Truck hero must render only for truck public profiles.",
);
requireIncludes(
  publicProfile,
  "<ElevatedTruckHero",
  "Truck branch must render ElevatedTruckHero.",
);
requireIncludes(
  publicProfile,
  "<HeroBlock profile={data} />",
  "Restaurant and non-truck profile rendering must keep the existing HeroBlock path.",
);
requireIncludes(
  publicProfile,
  "<PublicProfileMenu",
  "Restaurant menu rendering must remain present after the hero branch.",
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

const truckHeroIndex = publicProfile.indexOf("<ElevatedTruckHero");
const menuIndex = publicProfile.indexOf("<PublicProfileMenu");
const aboutIndex = publicProfile.indexOf("<AboutFoodStyle profile={restaurantProfile} />");
const galleryIndex = publicProfile.indexOf("<GalleryStrip profile={restaurantProfile} />");
if (truckHeroIndex < 0 || menuIndex < 0 || aboutIndex < 0 || galleryIndex < 0) {
  throw new Error("Public profile source must include truck hero and downstream profile sections.");
}
if (truckHeroIndex > menuIndex || truckHeroIndex > aboutIndex || truckHeroIndex > galleryIndex) {
  throw new Error("Truck hero must promote status/next stop above menu, about, and gallery sections.");
}

requireIncludes(
  elevatedTruckHero,
  "getTruckSchedulePrimaryStop(profile.truckSchedule)",
  "ElevatedTruckHero must promote current/next stop information.",
);
requireIncludes(
  heroMedia,
  'data-testid="public-profile-hero-cover-fallback"',
  "TruckHero must use a branded fallback when no cover image is available.",
);
requireIncludes(
  elevatedTruckHero,
  "const description = isGenericTruckDescription(profile.description, profile)",
  "ElevatedTruckHero must show direct descriptive business content when it exists.",
);
requireIncludes(
  elevatedTruckHero,
  "ProfileRecommendButton",
  "ElevatedTruckHero must expose the current direct recommendation action.",
);
requireIncludes(
  elevatedTruckHero,
  "Food truck",
  "ElevatedTruckHero must honestly label truck identity.",
);
requireExcludes(
  elevatedTruckHero,
  "Community/evidence-based profile",
  "ElevatedTruckHero must not lead with community-profile explainer copy.",
);
requireExcludes(
  elevatedTruckHero,
  "Profile snapshot",
  "ElevatedTruckHero must remove snapshot narration in favor of direct facts.",
);
requireExcludes(
  elevatedTruckHero,
  "Public links",
  "ElevatedTruckHero must not replace direct links with a links-count explainer.",
);

requireIncludes(
  truckHero,
  'data-testid="truck-profile-hero"',
  "Quarantined TruckHero must retain its stable marker while it remains in the repo.",
);

console.log("truck-hero-visibility.contract: PASS");
