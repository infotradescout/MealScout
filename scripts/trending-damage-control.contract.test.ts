import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const trendingPage = readFileSync("client/src/pages/trending.tsx", "utf8");

[
  "Local pulse",
  "Actual local food momentum",
  "What the city is hungry for",
  "catching fire across MealScout",
  "Flavors gaining gravity",
  "Businesses creating motion",
  "Not delivery charts",
  "WHAT THE CITY IS HUNGRY FOR",
].forEach((phrase) => {
  assert.ok(!trendingPage.includes(phrase), `Trending route must not include banned copy: ${phrase}`);
});

[
  "Trending",
  "What's hot near you",
  "Real menu items, trucks, restaurants, and food signals from MealScout.",
  "Open Scout",
  "View Map",
  "Browse nearby",
  "Trending is still warming up here.",
  "Popular dishes",
  "Trending places",
  "Food trucks getting attention",
].forEach((phrase) => {
  assert.ok(trendingPage.includes(phrase), `Trending route is missing required copy: ${phrase}`);
});

assert.ok(
  !trendingPage.includes("text-7xl") && !trendingPage.includes("tracking-[-0.06em]"),
  "Trending route must not use giant display headline treatment.",
);

console.log("trending-damage-control.contract: PASS");
