import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert.match(
  publicSearch,
  /publicRestaurantActivityScore/,
  "Network-wide matches must be ranked by real MealScout activity",
);
assert.match(publicSearch, /city: restaurant\.city \|\| null/);
assert.match(publicSearch, /state: restaurant\.state \|\| null/);

assert.match(
  navigation,
  /useScoutNavSearch/,
  "Navigation must consume the single Scout search state",
);
const mobileSearchIndex = navigation.indexOf("{scoutNavSearch}");
const mobileNavIndex = navigation.indexOf('className="relative flex items-end');
assert.ok(
  mobileSearchIndex >= 0 && mobileNavIndex > mobileSearchIndex,
  "On mobile, Scout search must be stacked directly above the bottom navigation",
);

console.log("MealScout Scout fallback and stacked navigation contract: PASS");
