import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  "function canonicalScoutEntityKey(",
  "canonicalBusinessId",
  "function getBestBusinessImage(",
  "r.logoUrl ||",
  "r.profileImageUrl ||",
  "r.coverImageUrl ||",
  "r.truckPhotoLogo ||",
  "r.heroImageUrl ||",
  "r.imageUrl ||",
  "const trucksById = new Map<string, Truck>();",
  "const key = canonicalScoutEntityKey(truck);",
  "const existing = trucksById.get(key);",
  "liveNow: Boolean(existing.liveNow || truck.liveNow),",
  "const truckCanonicalKeys = new Set(",
  "if (isTruckType && truckCanonicalKeys.has(restaurantKey)) return false;",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing scout canonical dedupe/image snippet: ${snippet}`);
  }
}

console.log("scout-canonical-dedupe-image.contract: PASS");
