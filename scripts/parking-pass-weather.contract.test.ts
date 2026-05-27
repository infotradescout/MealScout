import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const publicMapRoutes = readFileSync("server/routes/publicMapRoutes.ts", "utf8");

const requiredPageSnippets = [
  "/api/parking-pass/weather",
  "Booking-date weather",
  "activeListingForDate",
  "activeListing",
  "activeLocation?.host",
];

for (const snippet of requiredPageSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Parking pass weather UI missing expected snippet: ${snippet}`);
  }
}

const requiredRouteSnippets = [
  '"/api/parking-pass/weather"',
  "open-meteo.com",
];

for (const snippet of requiredRouteSnippets) {
  if (!publicMapRoutes.includes(snippet)) {
    throw new Error(`Parking pass weather route missing expected snippet: ${snippet}`);
  }
}

console.log("Parking pass weather contract OK");
