import { readFileSync } from "node:fs";

const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const publicBusinessSlugOwnership = readFileSync(
  "server/publicProfiles/publicBusinessSlugOwnership.ts",
  "utf8",
);
const appRoutes = readFileSync("client/src/App.tsx", "utf8");

const requiredClientSnippets = [
  "const normalizePublicProfileEntity = (value: string | null | undefined) => {",
  'normalized === "food_truck" ||',
  'normalized === "food-truck" ||',
  'normalized === "foodtruck"',
  'return "truck";',
  'const resolvedProfileId = extractUuidFromSlug(rawProfileId) || rawProfileId;',
  'queryKey: [',
  '"/api/public/profiles",',
  'normalizedProfileType,',
  'resolvedProfileId,',
  'locationSearch,',
  '`/api/public/profiles/${encodeURIComponent(String(normalizedProfileType || ""))}/${encodeURIComponent(String(resolvedProfileId || ""))}${locationSearch || ""}`',
];

for (const snippet of requiredClientSnippets) {
  if (!publicProfilePage.includes(snippet)) {
    throw new Error(`Missing public profile client entity normalization snippet: ${snippet}`);
  }
}

const requiredServerSnippets = [
  "const normalizePublicProfileEntity = (value: string | null | undefined) => {",
  'normalized === "food_truck" ||',
  'normalized === "food-truck" ||',
  'normalized === "foodtruck"',
  'if (normalized === "food_trucks") return "truck";',
  'app.get("/api/public/profiles/:entity/:id", async (req, res) => {',
  "const entity = normalizePublicProfileEntity(req.params.entity);",
  "profilePath: mapped.seo.canonicalUrl.replace(baseUrl, \"\"),",
];

for (const snippet of requiredServerSnippets) {
  if (!publicDiscoveryRoutes.includes(snippet)) {
    throw new Error(`Missing public profile server truck route snippet: ${snippet}`);
  }
}

const requiredSlugOwnershipSnippets = [
  "const isMissingSlugOwnershipTable = (error: unknown) => {",
  'err?.code === "42P01"',
  'String(err?.message || "").includes("public_business_slug_ownerships")',
  "if (isMissingSlugOwnershipTable(error)) return null;",
  "if (isMissingSlugOwnershipTable(error)) return [];",
];

for (const snippet of requiredSlugOwnershipSnippets) {
  if (!publicBusinessSlugOwnership.includes(snippet)) {
    throw new Error(`Missing public slug ownership fallback snippet: ${snippet}`);
  }
}

const requiredAppSnippets = [
  'path="/p/:profileType/:profileId/:profileSlug"',
  'path="/truck/:slug/:refTag"',
  'path="/truck/:slug"',
  'path="/restaurant/:id/:profileSlug"',
  'path="/restaurant/:id"',
];

for (const snippet of requiredAppSnippets) {
  if (!appRoutes.includes(snippet)) {
    throw new Error(`Public profile route alias missing from app routes: ${snippet}`);
  }
}

console.log("public-truck-profile-route-resolution.contract: PASS");
