import { readFileSync } from "node:fs";

const app = readFileSync("client/src/App.tsx", "utf8");
const mobileReadiness = readFileSync("scripts/mobileReadinessCheck.ts", "utf8");
const deepLinkSmoke = readFileSync("scripts/mobileDeepLinkSmoke.ts", "utf8");
const docs = readFileSync("docs/mobile/PHASE6_MOBILE_TRACK.md", "utf8");
const capacitorConfig = readFileSync("capacitor.config.ts", "utf8");

const requiredAppSnippets = [
  'appId: "us.mealscout.app"',
  'webDir: "dist/public"',
  'path="/scout"',
  'path="/p/:profileType/:profileId/:profileSlug"',
  'path="/parking-pass"',
  '"/parking-pass"',
  '"/p/"',
];

for (const snippet of requiredAppSnippets) {
  const source = snippet.startsWith("app") || snippet.startsWith("webDir") ? capacitorConfig : app;
  if (!source.includes(snippet)) {
    throw new Error(`Capacitor release shell missing required app/config snippet: ${snippet}`);
  }
}

const requiredReadinessSnippets = [
  '"/scout"',
  '"/p/:profileType/:profileId/:profileSlug"',
  '"/parking-pass"',
  'navigator.geolocation',
  'permissions.query',
  'Mobile smoke excludes admin-only surfaces',
];

for (const snippet of requiredReadinessSnippets) {
  if (!mobileReadiness.includes(snippet)) {
    throw new Error(`Mobile readiness check missing release shell snippet: ${snippet}`);
  }
}

const requiredSmokePaths = [
  '"/scout"',
  '"/p/food-truck/test-profile-id/test-profile-slug"',
  '"/parking-pass"',
  '"/map"',
  '"/menu/test-restaurant-id"',
  '"/restaurant-owner-dashboard"',
];

for (const snippet of requiredSmokePaths) {
  if (!deepLinkSmoke.includes(snippet)) {
    throw new Error(`Mobile deep-link smoke missing release shell route: ${snippet}`);
  }
}

const forbiddenSmokeSnippets = [
  '"/admin',
  "launch-board",
  "truck-import",
  "/api/admin",
];

for (const snippet of forbiddenSmokeSnippets) {
  if (deepLinkSmoke.includes(snippet)) {
    throw new Error(`Mobile deep-link smoke must not include admin/import surface: ${snippet}`);
  }
}

const requiredDocSnippets = [
  "Capacitor is a deployment shell, not a product rewrite.",
  "Do not add full admin dashboard, Launch Board, import tooling, or Merlin workflows",
  "`/scout`",
  "`/p/:profileType/:profileId/:profileSlug`",
  "`/parking-pass`",
];

for (const snippet of requiredDocSnippets) {
  if (!docs.includes(snippet)) {
    throw new Error(`Mobile track doc missing release shell rule: ${snippet}`);
  }
}

console.log("mealscout-capacitor-release-shell.contract: PASS");
