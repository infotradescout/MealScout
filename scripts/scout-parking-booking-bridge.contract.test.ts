import { readFileSync } from "node:fs";

const scoutSurfaceService = readFileSync(
  "server/services/scoutSurfaceService.ts",
  "utf8",
);
const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredScoutSnippets = [
  'if (card.entityType === "event")',
  "parkingPassBookable",
  'label: "Book spot"',
  "source=scout",
  "eventId",
  "locationId",
  'if (card.entityType === "host_spot")',
  'label: "View details"',
  "/p/host/",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutSurfaceService.includes(snippet)) {
    throw new Error(`Scout booking bridge missing expected behavior: ${snippet}`);
  }
}

const forbiddenScoutSnippets = [
  'if (card.entityType === "host_spot") {\n    return { label: "Book spot", href: "/parking-pass" };',
];

for (const snippet of forbiddenScoutSnippets) {
  if (scoutSurfaceService.includes(snippet)) {
    throw new Error(`Host/non-truck booking CTA regression detected: ${snippet}`);
  }
}

const requiredParkingPassSnippets = [
  'params.get("pass") || params.get("eventId")',
  'params.get("hostId") || params.get("locationId")',
];

for (const snippet of requiredParkingPassSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Parking-pass bridge param handling missing: ${snippet}`);
  }
}

console.log("Scout parking booking bridge contract OK");
