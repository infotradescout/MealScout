import { readFileSync } from "node:fs";

const navComponent = readFileSync("client/src/components/navigation.tsx", "utf8");
const routeSurface = readFileSync(
  "client/src/lib/app-route-surface.ts",
  "utf8",
);

const navRequired = [
  "const isScoutRoute = isScoutRoutePath(currentPath);",
  "const disableScoutHelpBubbles = isScoutRoute;",
  "disabled={disableScoutHelpBubbles}",
  'isScoutRoute ? "search-and-navigation" : undefined',
];

for (const snippet of navRequired) {
  if (!navComponent.includes(snippet)) {
    throw new Error(`Missing navigation bottom overlay safety snippet: ${snippet}`);
  }
}

for (const snippet of [
  'pathname === "/scout"',
  'pathname.startsWith("/scout/")',
  'pathname === "/scout-v2"',
  'pathname === "/directory"',
  'pathname.startsWith("/directory/")',
]) {
  if (!routeSurface.includes(snippet)) {
    throw new Error(`Missing shared Scout route snippet: ${snippet}`);
  }
}

console.log("scout-mobile-nav-layout.contract: PASS");
