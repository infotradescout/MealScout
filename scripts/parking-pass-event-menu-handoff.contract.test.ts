import { readFileSync } from "node:fs";

const scoutSurfaceService = readFileSync(
  "server/services/scoutSurfaceService.ts",
  "utf8",
);
const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredScoutSnippets = [
  "metadata.eventMenuId || metadata.menuId",
  'params.set("eventMenuId", eventMenuId)',
  'if (card.entityType === "event")',
  "parkingPassBookable",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutSurfaceService.includes(snippet)) {
    throw new Error(`Event menu handoff missing in scout surface: ${snippet}`);
  }
}

const requiredParkingPassSnippets = [
  'params.get("eventMenuId") || params.get("menuId")',
  "?eventMenuId=",
];

for (const snippet of requiredParkingPassSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Event menu handoff missing in parking-pass: ${snippet}`);
  }
}

console.log("Parking-pass event menu handoff contract OK");
