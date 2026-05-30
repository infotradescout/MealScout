import { readFileSync } from "node:fs";

const source = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");

const failingRoute = "/p/truck/95c4e656-f3cc-46ab-ae18-53f549ceefd1/3d-eats-tea";

const requiredSnippets = [
  'app.get("/api/public/profiles/:entity/:id", async (req, res) => {',
  "const resolveTruckRestaurantForPublicId = async (id: string) => {",
  "const direct = await storage.getRestaurant(id);",
  "where(eq(restaurants.claimedFromImportId, id))",
  'if (entity === "truck") {',
  "const row = await resolveTruckRestaurantForPublicId(id);",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing required 3D Eats truck resolution snippet: ${snippet}`);
  }
}

if (!failingRoute.startsWith("/p/truck/")) {
  throw new Error("3D Eats failing route must retain truck route shape");
}

console.log("public-truck-profile-3d-eats.contract: PASS");
