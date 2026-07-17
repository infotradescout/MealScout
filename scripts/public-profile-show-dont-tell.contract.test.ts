import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/ElevatedTruckHero.tsx", "utf8");
const actionPolicy = readFileSync(
  "client/src/components/public-profile/profileActionPolicy.ts",
  "utf8",
);
const mobileDock = readFileSync(
  "client/src/components/public-profile/MobileActionDock.tsx",
  "utf8",
);

assert(
  actionPolicy.includes('"social"') &&
    page.includes('(cta) => cta.type === "social"') &&
    mobileDock.includes('cta.type !== "share"') &&
    mobileDock.includes('cta.type !== "social"'),
  "Social links must remain available while profile sharing and primary actions stay separate",
);

assert(
  truckHero.includes("isGenericTruckDescription") &&
    truckHero.includes("description ? (") &&
    truckHero.includes("{description}"),
  "Truck hero must show useful confirmed description text while suppressing taxonomy placeholders",
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
