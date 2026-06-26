import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");

assert(
  page.includes('"social"') &&
    page.includes('const actionPool = pickActionCtas(profile, safeCtas, 16).filter(') &&
    page.includes('(cta) => cta.type !== "share"'),
  "Quick actions must be able to surface social links while keeping share controls separate",
);

assert(
  truckHero.includes("profile.description ? ("),
  "Truck hero must show existing confirmed description text directly when available",
);

assert(
  !truckHero.includes("Public links"),
  "Truck hero should not replace real links with a links-count explainer card",
);

assert(
  !truckHero.includes("Profile snapshot"),
  "Truck hero should remove snapshot narration from the top of thin profiles",
);

assert(
  page.includes('No upcoming stops posted.'),
  "Truck schedule empty state must use compact no-upcoming-stops copy",
);

assert(
  !page.includes("Partial menu from available source. More items may be available from this business directly."),
  "Menu sections should stop leading with long audit-style partial-menu explanations",
);

assert(
  page.includes("No menu posted yet."),
  "Truck menu empty states must stay honest while reading like a public-facing food page",
);

assert(
  page.includes("More items listed"),
  "Unpriced menu rows should be framed as more listed items instead of evidence narration",
);

console.log("public-profile-show-dont-tell.contract: PASS");
