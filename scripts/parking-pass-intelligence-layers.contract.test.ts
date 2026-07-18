import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  "partnerSupportPins",
  "discoveredSupportPins",
  "operationalSupportPins",
  "/api/map/operator-support",
  "supplierLocations",
  "showGasLayer",
  "showPropaneLayer",
  "showSupplyLayer",
  "showSupportLayer",
  'Propane',
  'Supply',
  'Support',
  "propane_dealer",
  "equipment_supplier",
  "Operator support",
  "parkingPassHostPinCount +",
  "operationalSupportPins.length",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Parking pass intelligence layer missing expected snippet: ${snippet}`);
  }
}

console.log("Parking pass intelligence layers contract OK");
