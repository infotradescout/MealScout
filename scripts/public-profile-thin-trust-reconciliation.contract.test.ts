import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");

assert(
  !truckHero.includes("Community/evidence-based profile"),
  "Truck hero should stop leading with community-profile narration in the primary badge row",
);

assert(
  truckHero.includes('Own this truck? Add menu, schedule, logo, or hours.'),
  "Truck hero must surface the owner update CTA copy for thin public profiles",
);

assert(
  !truckHero.includes("Profile snapshot"),
  "Truck hero should show direct business facts instead of a snapshot explainer heading",
);

assert(
  page.includes("Limited menu info"),
  "Thin partial truck menus must keep a compact limited-info label",
);

assert(
  !page.includes("Limited menu info from available source. Full menu still needs owner confirmation."),
  "Thin partial truck menus should not lead with a long owner-confirmation disclaimer",
);

assert(
  page.includes('const shouldCompactThinMenu =') &&
    page.includes('pricedItemCount <= 2') &&
    page.includes('!fallbackMenuLink'),
  "Public profile menu section must detect thin partial truck menus before rendering a full detailed list",
);

const mainRender = page.slice(page.indexOf("<main"), page.indexOf("<RelatedLocalDiscovery"));
const quickActionIndex = mainRender.indexOf("<QuickActionRow profile={data} safeCtas={safeCtas} />");
const shareControlsIndex = mainRender.indexOf("<PublicProfileShareControls");
assert(quickActionIndex >= 0, "Quick action row must still render in the public profile main column");
assert(shareControlsIndex >= 0, "Share controls must still render in the public profile main column");
assert(
  quickActionIndex < shareControlsIndex,
  "Share controls must render after quick actions so thin profiles lead with utility before share chrome",
);

console.log("public-profile-thin-trust-reconciliation.contract: PASS");
