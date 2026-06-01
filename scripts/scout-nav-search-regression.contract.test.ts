import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navComponent = readFileSync("client/src/components/navigation.tsx", "utf8");

const requiredScoutSnippets = [
  "const GLOBAL_NAV_HEIGHT = 58;",
  "const SCOUT_SCENE_RAIL_HEIGHT = 50;",
  "const SCOUT_SEARCH_DOCK_HEIGHT = 46;",
  "const SCOUT_DOCK_GAP = 0;",
  "const scoutDockBottom = `calc(env(safe-area-inset-bottom) + ${GLOBAL_NAV_HEIGHT}px)`;",
  "const feedBottomClearance = `calc(env(safe-area-inset-bottom) + ${GLOBAL_NAV_HEIGHT + SCOUT_SCENE_RAIL_HEIGHT + SCOUT_SEARCH_DOCK_HEIGHT + SCOUT_DOCK_GAP + 18}px)`;",
  'className="fixed inset-x-0 z-[1000] pointer-events-none"',
];

const forbiddenScoutSnippets = [
  "MOBILE_SAFE_BOTTOM",
  "GLOBAL_NAV_OVERHANG",
  "SCOUT_DOCK_FRAME_HEIGHT",
  "scoutBottomStackBase",
  '"--scout-bottom-stack-base"',
  '"--scout-bottom-stack-clearance"',
  'className="fixed inset-x-0 z-[1200] pointer-events-none"',
];

const requiredNavSnippets = [
  "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]",
];

const forbiddenNavSnippets = [
  "const isScoutRoute =",
  "bottom: isScoutRoute",
  "11.5rem",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing scout nav/search regression snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenScoutSnippets) {
  if (scoutPage.includes(snippet)) {
    throw new Error(`Found forbidden scout nav/search drift snippet: ${snippet}`);
  }
}

for (const snippet of requiredNavSnippets) {
  if (!navComponent.includes(snippet)) {
    throw new Error(`Missing navigation baseline snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenNavSnippets) {
  if (navComponent.includes(snippet)) {
    throw new Error(`Found forbidden navigation drift snippet: ${snippet}`);
  }
}

console.log("scout-nav-search-regression.contract: PASS");
