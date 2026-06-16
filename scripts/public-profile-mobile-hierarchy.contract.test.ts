import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/public-profile.tsx", "utf8");

const requireIncludes = (snippet: string, message: string) => {
  if (!source.includes(snippet)) {
    throw new Error(message);
  }
};

const requireExcludes = (snippet: string, message: string) => {
  if (source.includes(snippet)) {
    throw new Error(message);
  }
};

requireIncludes(
  'className="h-28 w-full bg-cover bg-center md:h-48"',
  "Public profile hero image must stay compact on mobile.",
);
requireIncludes(
  'className="relative h-28 w-full',
  "Public profile fallback hero must stay compact on mobile.",
);
requireIncludes(
  "decisionLocationLine(profile)",
  "Hero must surface decision-useful location above secondary content.",
);
requireIncludes(
  "Get food",
  "Public profile must expose a single business-critical action rail.",
);
const preferredOrderStart = source.indexOf('const preferredOrder: PublicCta["type"][] = [');
const preferredActionOrder = ["menu", "map", "order", "phone"].map((action) => {
  const index = source.indexOf(`"${action}"`, preferredOrderStart);
  if (index < 0) {
    throw new Error(`Action rail missing preferred action: ${action}`);
  }
  return index;
});
for (let index = 1; index < preferredActionOrder.length; index += 1) {
  if (preferredActionOrder[index] <= preferredActionOrder[index - 1]) {
    throw new Error("Action rail must prioritize menu, directions, order, and call before secondary actions.");
  }
}
requireIncludes(
  '<CardTitle className="text-xl text-white">Social links</CardTitle>',
  "Social links must be separated below business-critical actions.",
);
requireIncludes(
  "Keep exploring {data.city}",
  "Related discovery must be redesigned as consumer-facing nearby exploration.",
);

const mainOrder = [
  "<HeroBlock profile={data} />",
  "<QuickActionRow profile={data} safeCtas={safeCtas} />",
  "<PublicProfileShareControls",
  "<MenuSection profile={restaurantProfile} safeCtas={safeCtas} />",
  "<RestaurantSchedule profile={restaurantProfile} />",
  "<GalleryStrip profile={restaurantProfile} />",
  "<RestaurantSocial profile={restaurantProfile} safeCtas={safeCtas} />",
  "<RelatedLocalDiscovery",
].map((snippet) => {
  const index = source.indexOf(snippet);
  if (index < 0) throw new Error(`Missing hierarchy snippet: ${snippet}`);
  return index;
});

for (let index = 1; index < mainOrder.length; index += 1) {
  if (mainOrder[index] <= mainOrder[index - 1]) {
    throw new Error("Public profile mobile hierarchy regressed.");
  }
}

const quickActionIndex = source.indexOf("<QuickActionRow profile={data} safeCtas={safeCtas} />");
const shareControlsIndex = source.indexOf("<PublicProfileShareControls");
if (quickActionIndex < 0 || shareControlsIndex < 0 || quickActionIndex > shareControlsIndex) {
  throw new Error("Primary quick actions must appear before public profile Share/Copy controls.");
}

requireExcludes(
  "<CardTitle className=\"text-base text-white\">Related local discovery</CardTitle>",
  "Old related discovery heading must not appear above profile content.",
);
requireExcludes(
  "More {String(restaurantProfile.cuisineTags[0]",
  "Related discovery must not render database-like 'More american' copy.",
);
requireExcludes(
  'renderCtaButton(primary, "default", "primary")',
  "Hero must not duplicate action buttons already shown in the action rail.",
);
requireExcludes(
  "Verified profile</Badge>",
  "Verified profile badge must not be louder than decision-making information.",
);

console.log("public-profile-mobile-hierarchy.contract: PASS");
