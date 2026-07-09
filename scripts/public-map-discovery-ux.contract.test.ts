import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");

const requiredSnippets = [
  'aria-label="Nearby discovery summary"',
  'data-testid="map-discovery-summary"',
  'label: "Food trucks"',
  'label: "Open places"',
  'label: "Deals"',
  'label: "Events"',
  "truckCount > 0",
  "restaurantCount > 0",
  "dealCount > 0",
  "eventCount > 0",
];

for (const snippet of requiredSnippets) {
  assert(
    source.includes(snippet),
    `Map discovery UX summary missing required snippet: ${snippet}`,
  );
}

const prohibitedSnippets = [
  "Local food dashboard",
  "Truck-First Map",
  "Open the truck-first map",
];

for (const snippet of prohibitedSnippets) {
  assert(
    !source.includes(snippet),
    `Map discovery UX summary must not reintroduce stale copy: ${snippet}`,
  );
}

console.log("public-map-discovery-ux.contract: PASS");
