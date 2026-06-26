import { readFileSync } from "node:fs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const scoutCopy = readFileSync("client/src/features/scout/scoutSceneCopy.ts", "utf8");
const scoutSearchDock = readFileSync("client/src/components/scout/ScoutSearchDock.tsx", "utf8");
const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");

if (!appSource.includes('const ScoutPage = lazy(() => import("@/pages/explore-preview"));')) {
  throw new Error("Canonical /scout route must lazy-load explore-preview.");
}

for (const routeSnippet of [
  '<Route path="/scout" component={ScoutPage} />',
  '<Route path="/directory" component={ScoutPage} />',
  '<Route path="/scout-prototype" component={ScoutPrototype} />',
]) {
  if (!appSource.includes(routeSnippet)) {
    throw new Error(`Missing Scout route snippet: ${routeSnippet}`);
  }
}

for (const requiredScoutSnippet of [
  'title="Open Now"',
  'title={DISCOVERY_LAYERS.foodTrucks.title}',
  'title={DISCOVERY_LAYERS.restaurants.title}',
  'title={DISCOVERY_LAYERS.trending.title}',
  'title="New to MealScout"',
  'title={DISCOVERY_LAYERS.menuItems.title}',
  'title={DISCOVERY_LAYERS.deals.title}',
  'title={DISCOVERY_LAYERS.events.title}',
  'const { data: trendingData } = useQuery<ScoutTrendingResponse>({',
  '"/api/public/trending?limit=12&days=7"',
  'function getRestaurantProfilePath(restaurant: RestaurantSummary): string {',
  'function getTruckProfilePath(truck: LiveTruckSummary): string {',
  'function getMenuItemProfilePath(item: LocalMenuItemFeedItem): string {',
  'What is worth eating in ${shortLocation}?',
  'Search dishes, trucks, places, or events',
]) {
  if (!scoutPage.includes(requiredScoutSnippet)) {
    throw new Error(`Canonical Scout page missing snippet: ${requiredScoutSnippet}`);
  }
}

for (const forbiddenScoutSnippet of [
  "Scout • Customer discovery",
  "Community activity is still building here.",
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

for (const publicProfileSnippet of [
  "const invalidRestaurantRoute =",
  "!UUID_LIKE_RE.test(resolvedProfileId)",
  "enabled: !!normalizedProfileType && !!resolvedProfileId && !invalidRestaurantRoute",
  "retry: false,",
]) {
  if (!publicProfilePage.includes(publicProfileSnippet)) {
    throw new Error(`Public profile route hardening missing snippet: ${publicProfileSnippet}`);
  }
}

console.log("scout-canonical-runtime-build.contract: PASS");
