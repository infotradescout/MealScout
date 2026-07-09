import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/map.tsx", "utf8");

const requiredSnippets = [
  "const mapDiscoverySummary = [",
  'aria-label="Nearby discovery summary"',
  'data-testid="map-discovery-summary"',
  'label: "Food trucks"',
  'label: "Deals"',
  'label: "Events"',
  'label: "Host stops"',
  "visibleDeals.length",
  "liveTruckPins",
  "eventPins",
  "hostPins",
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
