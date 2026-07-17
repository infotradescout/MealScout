import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  expandScoutSearchTerms,
  tokenizeScoutSearchIntent,
} from "../shared/scoutSearchIntent";

const scout = readFileSync(
  new URL("../client/src/pages/explore-preview-v2.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("../client/src/components/navigation.tsx", import.meta.url),
  "utf8",
);
const publicSearch = readFileSync(
  new URL("../server/routes/publicSearchRoutes.ts", import.meta.url),
  "utf8",
);
const sharedIntent = readFileSync(
  new URL("../shared/scoutSearchIntent.ts", import.meta.url),
  "utf8",
);
const publicMap = readFileSync(
  new URL("../server/routes/publicMapRoutes.ts", import.meta.url),
  "utf8",
);

assert.match(
  scout,
  /\/api\/search\?q=\$\{encodeURIComponent\(query\)\}/,
  "Scout fallback must query the network-wide public search",
);
assert.doesNotMatch(
  scout,
  /pensacola-fallback/,
  "Consumer fallback must never be locked to the Pensacola preview market",
);
assert.doesNotMatch(
  scout,
  /fallbackMarketLabel|SCOUT_ACTIVITY_FALLBACK_LABEL/,
  "Network fallback must not masquerade as a fixed market label",
);
assert.doesNotMatch(
  scout,
  /related\.length\s*>\s*0\s*\?\s*related\s*:/,
  "A failed related search must never substitute unrelated popular inventory",
);
assert.match(
  scout,
  /globalSearchLoading/,
  "Fallback must wait for network-wide search before declaring no results",
);
assert.match(
  scout,
  /Showing related picks from active areas/,
  "Fallback copy must describe network activity without naming a fixed city",
);

assert.match(scout, /from "@shared\/scoutSearchIntent"/);
assert.match(publicSearch, /from "@shared\/scoutSearchIntent"/);
assert.doesNotMatch(scout, /SCOUT_FALLBACK_QUERY_ALIASES/);
assert.doesNotMatch(publicSearch, /PUBLIC_SEARCH_ALIASES/);
assert.match(
  sharedIntent,
  /tacos:[\s\S]*mexican[\s\S]*tex-mex/,
  "Taco search must include clearly related Mexican and Tex-Mex inventory",
);
assert.deepEqual(tokenizeScoutSearchIntent("find tacos near me"), ["tacos"]);
assert.ok(expandScoutSearchTerms("find tacos near me").includes("mexican"));
assert.ok(!expandScoutSearchTerms("find tacos near me").includes("me"));
assert.match(
  publicSearch,
  /publicRestaurantActivityScore/,
  "Network-wide matches must be ranked by real MealScout activity",
);
assert.match(publicSearch, /city: restaurant\.city \|\| null/);
assert.match(publicSearch, /state: restaurant\.state \|\| null/);
assert.match(
  publicMap,
  /const county = extractAddressComponent\([\s\S]*administrative_area_level_2/,
  "Place details must preserve county for the request workflow",
);
assert.match(
  scout,
  /selectedPlaceRequest\.county \|\|[\s\S]*selectedPlaceRequest\.city/,
  "Place requests must prefer the real county over a city fallback",
);
assert.match(
  scout,
  /const showActivitySupplement =[\s\S]*localSearchContentCount <= 1[\s\S]*supplementHasResults/,
  "A one-result market must supplement the first screen with active-market discovery",
);
assert.match(
  scout,
  /Your nearby result stays first\. The picks below are popular in other active MealScout areas\./,
  "Thin-market supplements must explain that farther-away picks are not nearby",
);
assert.match(
  scout,
  /restaurantRailCards\([\s\S]*showActivitySupplement \? activitySupplementRestaurants : \[\][\s\S]*"network"/,
  "Supplemental business cards must preserve network scope labels",
);
assert.match(
  scout,
  /menuItemRailCards\(supplementalDishCards, "network"\)/,
  "Supplemental dish cards must preserve network scope labels",
);
assert.match(
  scout,
  /data-scout-first-screen-layout=[\s\S]*local-plus-network/,
  "Thin markets must pair the nearby result with the network explanation",
);
assert.match(
  scout,
  /activitySupplementPriority[\s\S]*popular_dishes: -2[\s\S]*trending_this_week: -1/,
  "Thin-market food and place supplements must render before unrelated rails",
);
assert.match(
  scout,
  /lg:grid lg:w-full lg:grid-cols-4/,
  "Desktop Scout rails must fill the available width with a four-card grid",
);

assert.match(
  navigation,
  /useScoutNavSearch|\{scoutNavSearch\}/,
  "Global navigation must own Scout search so search and navigation remain one surface",
);
assert.match(
  navigation,
  /data-scout-mobile-nav-shell=\{[\s\S]*isScoutRoute \? "search-and-navigation" : undefined[\s\S]*\}/,
  "Mobile Scout navigation must stack search with the consumer navigation shell",
);
assert.doesNotMatch(
  scout,
  /data-scout-search-surface="top"[\s\S]*<ScoutSearchDock[\s\S]*placement="inline"/,
  "Scout must not render a second search slab above the map",
);

console.log("MealScout Scout fallback and owned search contract: PASS");
