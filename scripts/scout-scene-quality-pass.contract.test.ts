import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  "const surfaceProfileContextById = useMemo(() => {",
  "function getSurfaceProfileSignals(",
  "function getSurfaceQualityScore(",
  "function prioritizeSurfaceCards(",
  'return "Community profile";',
  'signals.unverifiedCommunity ? "Community-submitted profile" : ""',
  ': "Menu not posted yet",',
  "if (signals.verifiedProfile) score += 8;",
  "if (signals.liveConfidence) score += 10;",
  "if (signals.unverifiedCommunity) score -= 6;",
  "if (signals.thinProfile) score -= 2;",
  "const featuredTodayKeys = useMemo(",
  "const featuredCommunityKeys = useMemo(",
  "suppressKeys: featuredTodayKeys,",
  "suppressKeys: new Set([...featuredTodayKeys, ...featuredCommunityKeys]),",
  "return [...preferred, ...suppressed];",
  "buildSurfaceFeedItem(card, sourceOrder, surfaceProfileContextById)",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing Scout scene quality snippet: ${snippet}`);
  }
}

const profileContextIndex = scoutPage.indexOf("const surfaceProfileContextById = useMemo(() => {");
const sceneSurfaceIndex = scoutPage.indexOf("const sceneSurfaceCards = useMemo(() => {");
if (profileContextIndex < 0 || sceneSurfaceIndex < 0 || sceneSurfaceIndex < profileContextIndex) {
  throw new Error("Expected surface profile context to be defined before scene surface composition.");
}

if (!scoutPage.includes("suppressLimit: 2,") || !scoutPage.includes("suppressLimit: 1,")) {
  throw new Error("Expected scene quality pass to cap repeated featured cards across lanes.");
}

console.log("scout-scene-quality-pass.contract: PASS");
