import { readFileSync } from "node:fs";

const scoutPrototype = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");

const requiredScoutSnippets = [
  "const GLOBAL_NAV_HEIGHT = 58;",
  "const SCOUT_DOCK_GAP = 12;",
  "scoutDockBottom = `calc(env(safe-area-inset-bottom) + ${GLOBAL_NAV_HEIGHT + SCOUT_DOCK_GAP}px)`",
  "feedBottomClearance = `calc(env(safe-area-inset-bottom) + ${GLOBAL_NAV_HEIGHT + SCOUT_SCENE_RAIL_HEIGHT + SCOUT_SEARCH_DOCK_HEIGHT + SCOUT_DOCK_GAP + 28}px)`",
  "data-scout-search-dock=\"true\"",
  "data-scout-feed=\"true\"",
  "className=\"fixed inset-x-0 z-[1000] pointer-events-none\"",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutPrototype.includes(snippet)) {
    throw new Error(`Missing Scout nav/search collision guard snippet: ${snippet}`);
  }
}

if (!navigation.includes("className=\"fixed left-0 right-0 z-[1100] lg:hidden\"")) {
  throw new Error("Global mobile nav z-index contract missing (expected z-[1100]).");
}

if (!navigation.includes("style={{ bottom: 0 }}")) {
  throw new Error("Global mobile nav bottom anchor missing (expected bottom: 0).");
}

console.log("scout-search-nav-collision.contract: PASS");
