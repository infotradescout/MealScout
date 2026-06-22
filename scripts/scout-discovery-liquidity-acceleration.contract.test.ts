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
  "Showing restaurants, trucks, deals, and events near",
  "Community-backed picks are light here, so nearby food options stay visible.",
  "Late-night coverage is light here, so Scout is keeping nearby food options visible instead of showing a blank lane.",
  "Worth Discovering is quiet here, so Scout is falling back to the nearest honest local options.",
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
