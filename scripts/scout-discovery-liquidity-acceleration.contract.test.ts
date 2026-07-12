import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  'queryKey: ["/api/scout/surface", location.lat, location.lng],',
  'apiUrl(`/api/scout/surface?lat=${location.lat}&lng=${location.lng}&radiusMiles=20&limit=30`)',
  "const routeScene = useMemo(() => {",
  "setActiveScene(routeScene);",
  'navigate(`/scout?scene=${encodeURIComponent(tile.id)}`);',
  "const communitySurfaceCards = useMemo(",
  "const nearbyNowSurfaceCards = useMemo(",
  "const worthDiscoveringSurfaceCards = useMemo(",
  "const sceneSurfaceCards = useMemo(() => {",
  "const fallbackSurfaceCards = useMemo(",
  // A copy simplification pass ("clean up public copy while preserving
  // protected language") reworded these per-scene subtitles; the fallback
  // intent (show nearby options instead of a blank lane, without
  // overclaiming coverage) is preserved, just phrased more plainly.
  "Restaurants, trucks, deals, and events near",
  "Explore nearby food and local favorites around",
  "Late-night food options near",
  "More nearby spots worth checking around",
  "const coverageBadgeLabel =",
  "Local matches use nearby, live, and community-backed discovery signals when available.",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing Scout discovery liquidity snippet: ${snippet}`);
  }
}

const sceneSurfaceIndex = scoutPage.indexOf("const sceneSurfaceCards = useMemo(() => {");
const feedItemsIndex = scoutPage.indexOf("const feedItems = useMemo(() => {");
if (sceneSurfaceIndex < 0 || feedItemsIndex < 0 || feedItemsIndex < sceneSurfaceIndex) {
  throw new Error("Expected sceneSurfaceCards grouping to be defined before feedItems composition.");
}

if (!scoutPage.includes('if (items.length < 10) addSurfaceCards(fallbackSurfaceCards, 12);')) {
  throw new Error("Expected low-coverage Scout fallback to reuse nearby surface cards.");
}

console.log("scout-discovery-liquidity-acceleration.contract: PASS");
