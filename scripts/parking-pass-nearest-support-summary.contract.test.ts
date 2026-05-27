import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  "distanceMilesBetween",
  "nearestOperationalSupport",
  "Nearest operational support",
  "Nearest gas:",
  "Nearest propane:",
  "Nearest supply:",
  "Nearest support:",
  "Select a spot",
  "Unavailable",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Nearest support summary missing snippet: ${snippet}`);
  }
}

console.log("Parking pass nearest support summary contract OK");
