import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/map.tsx", "utf8");

const requiredPhrases = [
  "Nearby Food Map",
  "Use my location",
  "Scout",
  "Browse nearby",
  "No nearby food is pinned in this part of the map yet",
  "Pan or zoom out to check another area, or scout for more food options.",
  "Worth discovering",
];

for (const phrase of requiredPhrases) {
  assert(
    source.includes(phrase),
    `Map surface must include customer-facing map UX copy: ${phrase}`,
  );
}

const prohibitedPhrases = [
  "Truck-First Map",
  "See nearby trucks, places, and local food stops.",
  "List a Food Truck",
  "Claim a Truck",
  "Browse truck-first early access coverage",
  "No trucks, events, hosts, or suppliers in this area",
];

for (const phrase of prohibitedPhrases) {
  assert(
    !source.includes(phrase),
    `Map surface must not keep outdated or non-customer-facing map copy: ${phrase}`,
  );
}

assert(
  source.includes('data-testid="button-use-my-location"'),
  "Map surface must expose a direct location recovery CTA.",
);

assert(
  source.includes('data-testid="empty-state-no-pins"'),
  "Map surface must keep the no-pins empty state test hook.",
);

console.log("map-surface-ux-rescue.contract: PASS");
