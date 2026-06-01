import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navComponent = readFileSync("client/src/components/navigation.tsx", "utf8");

const scoutRequired = [
  'const MOBILE_SAFE_BOTTOM = "env(safe-area-inset-bottom)";',
  "const GLOBAL_NAV_HEIGHT = 58;",
  "const GLOBAL_NAV_OVERHANG = 14;",
  "const SCOUT_SCENE_RAIL_HEIGHT = 50;",
  "const SCOUT_SEARCH_DOCK_HEIGHT = 46;",
  "const SCOUT_DOCK_FRAME_HEIGHT = 14;",
  "const SCOUT_DOCK_GAP = 6;",
  "const scoutBottomStackBase = `calc(${MOBILE_SAFE_BOTTOM} + ${GLOBAL_NAV_HEIGHT + GLOBAL_NAV_OVERHANG}px)`;",
  "const scoutDockBottom = `calc(${scoutBottomStackBase} + ${SCOUT_DOCK_GAP}px)`;",
  "const feedBottomClearance = `calc(${scoutBottomStackBase} + ${SCOUT_SCENE_RAIL_HEIGHT + SCOUT_SEARCH_DOCK_HEIGHT + SCOUT_DOCK_FRAME_HEIGHT + SCOUT_DOCK_GAP + 28}px)`;",
  '"--scout-bottom-stack-base": scoutBottomStackBase,',
  '"--scout-bottom-stack-clearance": feedBottomClearance,',
  'className="fixed inset-x-0 z-[1200] pointer-events-none"',
  "style={{ paddingBottom: feedBottomClearance }}",
];

for (const snippet of scoutRequired) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing scout mobile spacing contract snippet: ${snippet}`);
  }
}

const navRequired = [
  "const isScoutRoute =",
  "currentPath === \"/scout\" || currentPath.startsWith(\"/scout/\")",
  "bottom: isScoutRoute",
  '"calc(env(safe-area-inset-bottom) + 11.5rem)"',
  '"calc(env(safe-area-inset-bottom) + 5.5rem)"',
];

for (const snippet of navRequired) {
  if (!navComponent.includes(snippet)) {
    throw new Error(`Missing navigation bottom overlay safety snippet: ${snippet}`);
  }
}

console.log("scout-mobile-nav-layout.contract: PASS");
