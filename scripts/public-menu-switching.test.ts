import { readFileSync } from "fs";

const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicDiscoveryRoutes = readFileSync(
  "server/routes/publicDiscoveryRoutes.ts",
  "utf8",
);
const publicProfilesType = readFileSync("shared/publicProfiles.ts", "utf8");

const requiredClientSnippets = [
  "menuVariants.length > 1",
  "Select menu",
  "profile.menuContextNote",
];

for (const snippet of requiredClientSnippets) {
  if (!publicProfilePage.includes(snippet)) {
    throw new Error(`public-profile.tsx missing required snippet: ${snippet}`);
  }
}

const requiredServerSnippets = [
  "preferredMenuId",
  "eventMenuId",
  "menuId",
  "menuVariants",
  "activeMenuId",
  "Event menu prices are shown for this event.",
];

for (const snippet of requiredServerSnippets) {
  if (!publicDiscoveryRoutes.includes(snippet)) {
    throw new Error(`publicDiscoveryRoutes.ts missing required snippet: ${snippet}`);
  }
}

const requiredTypeSnippets = [
  "export type PublicMenuVariant",
  "menuVariants: PublicMenuVariant[]",
  "activeMenuId: string | null",
  "menuContextNote: string | null",
];

for (const snippet of requiredTypeSnippets) {
  if (!publicProfilesType.includes(snippet)) {
    throw new Error(`shared/publicProfiles.ts missing required snippet: ${snippet}`);
  }
}

console.log("public-menu-switching.contract: PASS");
