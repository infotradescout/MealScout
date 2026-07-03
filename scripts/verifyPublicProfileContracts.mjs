import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const targets = [
  "client/src/pages/public-profile.tsx",
  "client/src/pages/location-detail.tsx",
];

const forbiddenClientPatterns = [
  "/api/parking-pass",
  "/api/restaurants",
  "profileSettings.featuredLinks",
  "ctaUrl",
];

let failed = false;

for (const file of targets) {
  const text = read(file);
  for (const pattern of forbiddenClientPatterns) {
    if (text.includes(pattern)) {
      console.error(`[verify:public-profiles] forbidden pattern "${pattern}" in ${file}`);
      failed = true;
    }
  }
}

const routeFile = "server/routes/publicDiscoveryRoutes.ts";
const routeText = read(routeFile);
const requiredRouteSnippets = [
  '"/api/public/resolve/:entity/:slug"',
  '"/api/public/profiles/:entity/:id"',
];
for (const snippet of requiredRouteSnippets) {
  if (!routeText.includes(snippet)) {
    console.error(`[verify:public-profiles] missing required route ${snippet} in ${routeFile}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("verify:public-profiles passed");
