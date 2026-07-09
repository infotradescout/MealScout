import { readFileSync } from "node:fs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const scoutPage = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const quarantinedScoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const scoutCopy = readFileSync("client/src/features/scout/scoutSceneCopy.ts", "utf8");
const scoutSearchDock = readFileSync("client/src/components/scout/ScoutSearchDock.tsx", "utf8");
const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const platformBuild = readFileSync("scripts/platformBuild.mjs", "utf8");

if (!appSource.includes('const ScoutPageV2 = lazy(() => import("@/pages/explore-preview-v2"));')) {
  throw new Error("Canonical /scout route must lazy-load explore-preview-v2.");
}

if (
  !quarantinedScoutPage.includes("DEAD SURFACE") ||
  !quarantinedScoutPage.includes("explore-preview-v2.tsx (ScoutPageV2)")
) {
  throw new Error("Legacy explore-preview.tsx must be explicitly quarantined as a dead surface.");
}

for (const routeSnippet of [
  '<Route path="/scout" component={ScoutPageV2} />',
  '<Route path="/directory" component={ScoutPageV2} />',
  '<Route path="/scout-v2" component={ScoutPageV2} />',
  '<Route path="/scout-prototype" component={ScoutPrototype} />',
]) {
  if (!appSource.includes(routeSnippet)) {
    throw new Error(`Missing Scout route snippet: ${routeSnippet}`);
  }
}

for (const requiredScoutSnippet of [
  'title: "Now Serving Trucks"',
  'title: "Open Now Near You"',
  'title: "Food Trucks Today"',
  'title: DISCOVERY_LAYERS.restaurants.title',
  'title: "Local Activity"',
  'title: "Newest on MealScout"',
  'DISCOVERY_LAYERS.menuItems.title',
  'title: DISCOVERY_LAYERS.deals.title',
  'title: DISCOVERY_LAYERS.events.title',
  'const { data: trendingData } = useQuery<ScoutTrendingResponse>({',
  '"/api/public/trending?limit=12&days=7"',
  'function getRestaurantProfilePath(restaurant: RestaurantSummary): string {',
  'function getTruckProfilePath(truck: LiveTruckSummary): string {',
  'function getMenuItemProfilePath(item: LocalMenuItemFeedItem): string {',
  'data-testid="scout-map-container"',
  "function ScoutFirstScreenDecisionStack(",
  'data-scout-first-screen-decision-stack="true"',
  'data-scout-immediate-compact-card="true"',
  'placement="fixed"',
  "{scoutRows.map((row) => (",
  "No nearby food yet",
  "Search nearby food or move the map",
]) {
  if (!scoutPage.includes(requiredScoutSnippet)) {
    throw new Error(`Canonical Scout page missing snippet: ${requiredScoutSnippet}`);
  }
}

const mainStart = scoutPage.indexOf("<main");
const mapIndex = scoutPage.indexOf('data-testid="scout-map-container"');
const railsIndex = scoutPage.indexOf("<ActiveSceneContent");
if (mainStart < 0 || mapIndex < 0 || railsIndex < 0 || !(mainStart < mapIndex && mapIndex < railsIndex)) {
  throw new Error("Canonical Scout page must render the map as the first main surface before discovery rails.");
}

for (const forbiddenScoutSnippet of [
  "Scout • Customer discovery",
  "Community activity is still building here.",
  "What is worth eating in",
  "Find what is worth eating nearby.",
  "Open now, trending this week, fresh dishes, deals, and food events in one local view.",
  "Search dishes, trucks, places, or events",
  "widen the board",
  "The local board is quiet right now.",
  "Nothing strong here yet.",
]) {
  if (scoutPage.includes(forbiddenScoutSnippet)) {
    throw new Error(`Canonical Scout page must not include stale copy: ${forbiddenScoutSnippet}`);
  }
}

for (const copySnippet of [
  'title: "Open Now"',
  'title: "Food Trucks Today"',
  'title: "Nearby Restaurants"',
  'title: "Hot Deals"',
  'title: "Events & Pop-Ups"',
]) {
  if (!scoutCopy.includes(copySnippet)) {
    throw new Error(`Scout scene copy missing updated label: ${copySnippet}`);
  }
}

if (!scoutSearchDock.includes("Search dishes, cravings, places, trucks, or events")) {
  throw new Error("Scout search dock must guide dish/craving/place/truck/event discovery.");
}

if (
  !scoutSearchDock.includes("bg-[#fff7ed]/94") ||
  scoutSearchDock.includes("bg-[#0f0a07]/94") ||
  scoutSearchDock.includes("Updates live on the map and feed.")
) {
  throw new Error("Scout search dock must use the lighter food-discovery shell and consumer copy.");
}

if (!scoutSearchDock.includes('data-scout-search-placement={placement}')) {
  throw new Error("Scout search dock must expose fixed vs inline placement for the first-screen decision stack.");
}

for (const publicProfileSnippet of [
  "const invalidRestaurantRoute =",
  "!UUID_LIKE_RE.test(resolvedProfileId)",
  "enabled:",
  "!!normalizedProfileType && !!resolvedProfileId && !invalidRestaurantRoute",
  "retry: false,",
]) {
  if (!publicProfilePage.includes(publicProfileSnippet)) {
    throw new Error(`Public profile route hardening missing snippet: ${publicProfileSnippet}`);
  }
}

if (!platformBuild.includes('run("vite", ["build"]);')) {
  throw new Error("Platform build must emit the production client bundle to dist/public.");
}

if (platformBuild.includes('run("npm", ["run", "build:client"]);')) {
  throw new Error("Platform build must not emit only the standalone client/dist bundle.");
}

console.log("scout-canonical-runtime-build.contract: PASS");
