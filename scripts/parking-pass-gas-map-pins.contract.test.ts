import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  "const gasPricePins = useMemo(() =>",
  "showFuelPrices !== true",
  "fuelPrices",
  "⛽",
  "Regular",
  "Midgrade",
  "Premium",
  "Diesel",
  "...(showGasLayer ? gasPricePins : []).map((pin) => ({",
  "operationalSupportPins.length",
  "showGasLayer ? gasPricePins.length : 0",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Gas map pins behavior missing snippet: ${snippet}`);
  }
}

console.log("Parking pass gas map pins contract OK");
