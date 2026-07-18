import { readFileSync } from "node:fs";

const routes = readFileSync("server/routes/publicMapRoutes.ts", "utf8");
const autocomplete = readFileSync(
  "client/src/components/maps/place-autocomplete-input.tsx",
  "utf8",
);
const parkingPass = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const serverKeyBlock = routes.slice(
  routes.indexOf("const getGoogleMapsApiKey"),
  routes.indexOf("const getGoogleMapsWebApiKey"),
);
if (serverKeyBlock.includes("VITE_")) {
  throw new Error("Server Google key resolver must not fall back to a browser key");
}

const requiredRouteSnippets = [
  "const getGoogleMapsWebApiKey",
  "const googleMapsApiKey = getGoogleMapsWebApiKey()",
  'app.get("/api/map/place-intelligence"',
  'app.get("/api/map/operator-support"',
  "fuelOptions",
  "parkingOptions",
  "accessibilityOptions",
  "routingSummaries",
  'textQuery: "propane supplier"',
  'textQuery: "restaurant supply store"',
  'textQuery: "commercial kitchen equipment repair"',
  'label: "area_activity"',
  "measuredFootTraffic",
];

for (const snippet of requiredRouteSnippets) {
  if (!routes.includes(snippet)) {
    throw new Error(`Google API capability route missing snippet: ${snippet}`);
  }
}

for (const snippet of [
  'intent?: "destination" | "food"',
  'intent = "destination"',
  'url.searchParams.set("intent", intent)',
]) {
  if (!autocomplete.includes(snippet)) {
    throw new Error(`Intent-aware autocomplete missing snippet: ${snippet}`);
  }
}

for (const snippet of [
  "/api/map/place-intelligence",
  "/api/map/operator-support",
  "Provider-backed place details",
  "No current provider prices were found for this spot.",
]) {
  if (!parkingPass.includes(snippet)) {
    throw new Error(`Parking Pass API capability UI missing snippet: ${snippet}`);
  }
}

console.log("Parking Pass Google API capabilities contract OK");
