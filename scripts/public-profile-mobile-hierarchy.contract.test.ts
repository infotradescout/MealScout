import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/public-profile.tsx", "utf8").replace(/\r\n/g, "\n");
const heroMedia = readFileSync(
  "client/src/components/public-profile/ProfileHeroMedia.tsx",
  "utf8",
).replace(/\r\n/g, "\n");
const elevatedTruckHero = readFileSync(
  "client/src/components/public-profile/ElevatedTruckHero.tsx",
  "utf8",
).replace(/\r\n/g, "\n");
const elevatedProfileHero = readFileSync(
  "client/src/components/public-profile/ElevatedProfileHero.tsx",
  "utf8",
).replace(/\r\n/g, "\n");

const requireIncludes = (source_: string, snippet: string, message: string) => {
  if (!source_.includes(snippet)) {
    throw new Error(message);
  }
};

const requireExcludes = (snippet: string, message: string) => {
  if (source.includes(snippet)) {
    throw new Error(message);
  }
};

const requireMatch = (source_: string, pattern: RegExp, message: string) => {
  if (!pattern.test(source_)) {
    throw new Error(message);
  }
};

// The hero moved from an inline bg-cover/bg-center div to the shared
// ProfileHeroMedia component (an <img> with object-cover), but the same
// "compact on mobile, taller on desktop" responsive height contract must
// hold — verified via each hero's heightClassName rather than one literal
// className string.
requireMatch(
  heroMedia,
  /heightClassName = "h-\d+ md:h-\d+"/,
  "ProfileHeroMedia default hero height must stay compact on mobile and expand on desktop.",
);
requireMatch(
  elevatedTruckHero,
  /heightClassName="h-\d+ md:h-\d+"/,
  "Elevated truck hero image must stay compact on mobile.",
);
requireMatch(
  elevatedProfileHero,
  /heightClassName="h-\d+ md:h-\d+"/,
  "Elevated restaurant/bar hero image must stay compact on mobile.",
);

requireIncludes(
  source,
  "decisionLocationLine(profile)",
  "Hero must surface decision-useful location above secondary content.",
);
requireIncludes(
  source,
  "Get food",
  "Public profile must expose a single business-critical action rail.",
);
requireIncludes(
  source,
  'const preferredOrder: PublicCta["type"][] = [\n    "menu",\n    "map",\n    "order",\n    "external",\n    "social",\n    "phone",\n    "catering",\n    "booking",\n  ];',
  "Action rail must prioritize menu, directions, order, and other CTAs before secondary ones.",
);
requireIncludes(
  source,
  '<CardTitle className="text-xl text-white">Social links</CardTitle>',
  "Social links must be separated below business-critical actions.",
);
requireIncludes(
  source,
  "Explore more food in {data.city}",
  "Related discovery must be redesigned as consumer-facing nearby exploration.",
);

// Real current render-order anchors, confirmed present in
// client/src/pages/public-profile.tsx: hero -> menu -> gallery -> social
// links -> related discovery -> sticky mobile action dock. Restaurant/bar
// and food-truck profiles render different (but each internally ordered)
// subsets of sections; these tags are common enough to anchor the overall
// page hierarchy using first-occurrence position in the source text.
const mainOrder = [
  "<ElevatedTruckHero",
  "<FullMenuSection",
  "<GalleryStrip",
  "<RestaurantSocial",
  "<RelatedScoutRail",
  "<MobileActionDock",
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
