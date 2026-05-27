import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const mapPicker = readFileSync("client/src/components/maps/GoogleMapPicker.tsx", "utf8");

const requiredParkingPassSnippets = [
  "Foot traffic",
  "spotFootTrafficCells",
  "showParkingScoutHeat",
  "/api/map/foot-traffic",
  "Green stronger",
  "Yellow moderate",
  "Red weaker",
  "trafficCells={spotFootTrafficCells}",
  "Select a spot to view foot traffic.",
  "Foot traffic data is not available for this spot yet.",
];

for (const snippet of requiredParkingPassSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Parking pass foot traffic overlay missing snippet: ${snippet}`);
  }
}

if (!mapPicker.includes("cell.color ||")) {
  throw new Error("Map renderer does not respect overlay color overrides");
}

console.log("Parking pass foot traffic overlay contract OK");
