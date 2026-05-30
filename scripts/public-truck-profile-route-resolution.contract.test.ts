import { readFileSync } from "node:fs";

const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const appRoutes = readFileSync("client/src/App.tsx", "utf8");

const requiredClientSnippets = [
  "const normalizePublicProfileEntity = (value: string | null | undefined) => {",
  'if (normalized === "food_truck" || normalized === "food-truck" || normalized === "foodtruck") {',
  'return "truck";',
  'queryKey: ["/api/public/profiles", normalizedProfileType, profileId, locationSearch],',
  '`/api/public/profiles/${encodeURIComponent(String(normalizedProfileType || ""))}/${encodeURIComponent(String(profileId || ""))}${locationSearch || ""}`',
];

for (const snippet of requiredClientSnippets) {
  if (!publicProfilePage.includes(snippet)) {
    throw new Error(`Missing public profile client entity normalization snippet: ${snippet}`);
  }
}

const requiredServerSnippets = [
  "const normalizePublicProfileEntity = (value: string | null | undefined) => {",
  'if (normalized === "food_truck" || normalized === "food-truck" || normalized === "foodtruck") {',
  'if (normalized === "food_trucks") return "truck";',
  'app.get("/api/public/profiles/:entity/:id", async (req, res) => {',
  "const entity = normalizePublicProfileEntity(req.params.entity);",
  "profilePath: `/p/truck/${mapped.id}/${mapped.slug}`,",
];

for (const snippet of requiredServerSnippets) {
  if (!publicDiscoveryRoutes.includes(snippet)) {
    throw new Error(`Missing public profile server truck route snippet: ${snippet}`);
  }
}

if (!appRoutes.includes('path="/p/:profileType/:profileId/:profileSlug"')) {
  throw new Error("Public profile slug route shape is missing from app routes");
}

console.log("public-truck-profile-route-resolution.contract: PASS");
