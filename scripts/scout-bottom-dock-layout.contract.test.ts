import { readFileSync } from "node:fs";

const scoutPrototype = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");

const requiredScoutLayoutSnippets = [
  "data-scout-layout-contract=\"true\"",
  "\"--scout-safe-bottom\": \"env(safe-area-inset-bottom, 0px)\"",
  "\"--scout-nav-height\": \"58px\"",
  "\"--scout-search-height\": \"46px\"",
  "\"--scout-chip-height\": \"50px\"",
  "\"--scout-bottom-dock-height\":",
  "\"--scout-help-bottom-clearance\":",
  "const scoutDockBottom = \"calc(var(--scout-safe-bottom) + var(--scout-nav-height) + var(--scout-dock-gap))\"",
  "const feedBottomClearance = \"calc(var(--scout-bottom-dock-height) + 28px)\"",
  "overflow-x-auto no-scrollbar",
];

for (const snippet of requiredScoutLayoutSnippets) {
  if (!scoutPrototype.includes(snippet)) {
    throw new Error(`Missing Scout bottom dock contract snippet: ${snippet}`);
  }
}

if (!navigation.includes("height: \"var(--scout-nav-height, 58px)\"")) {
  throw new Error("Navigation must read shared Scout nav height variable.");
}

console.log("scout-bottom-dock-layout.contract: PASS");
