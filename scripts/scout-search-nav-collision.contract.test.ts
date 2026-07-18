import { readFileSync } from "node:fs";

const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
const liveScout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");

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

if (liveScout.includes("data-scout-search-dock")) {
  throw new Error("Live Scout must not own a second mobile search dock.");
}

console.log("scout-search-nav-collision.contract: PASS");
