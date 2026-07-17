import { readFileSync } from "node:fs";

const scoutPrototype = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
const liveScout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");

const requiredScoutSnippets = [
  "data-scout-layout-contract=\"true\"",
  "\"--scout-safe-bottom\": \"env(safe-area-inset-bottom, 0px)\"",
  "\"--scout-nav-height\": \"58px\"",
  "const scoutDockBottom = \"calc(var(--scout-safe-bottom) + var(--scout-nav-height) + var(--scout-dock-gap))\"",
  "const feedBottomClearance =",
  "\"calc(var(--scout-nav-height) + var(--scout-dock-gap) + var(--scout-bottom-dock-height) + 28px)\"",
  "data-scout-search-dock=\"true\"",
  "data-scout-feed=\"true\"",
  "className=\"fixed inset-x-0 z-[1000] pointer-events-none\"",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutPrototype.includes(snippet)) {
    throw new Error(`Missing Scout nav/search collision guard snippet: ${snippet}`);
  }
}

if (
  !navigation.includes('isBusinessWorkspaceRoute ? "hidden" : "fixed"') ||
  !navigation.includes("inset-x-0 bottom-0 z-[1100]")
) {
  throw new Error("Global mobile nav z-index contract missing (expected z-[1100]).");
}

if (!navigation.includes("style={{ bottom: 0 }}")) {
  throw new Error("Global mobile nav bottom anchor missing (expected bottom: 0).");
}

const requiredNavigationSearchSnippets = [
  "useScoutNavSearch",
  "const scoutNavSearch = isScoutRoute ? (",
  "<ScoutSearchDock",
  'placement="navigation"',
  "data-scout-mobile-nav-shell={",
  'isScoutRoute ? "search-and-navigation" : undefined',
  "{isScoutRoute ? scoutNavSearch : null}",
];

for (const snippet of requiredNavigationSearchSnippets) {
  if (!navigation.includes(snippet)) {
    throw new Error(`Missing navigation-owned Scout search snippet: ${snippet}`);
  }
}

if (liveScout.includes('placement="inline"')) {
  throw new Error("Live Scout must not render a second inline search surface.");
}

console.log("scout-search-nav-collision.contract: PASS");
