import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  'const setupRefParam = dashboardParams.get("ref");',
  "const buildSetupHref = (",
  'if (setupRefParam) params.set("ref", setupRefParam);',
  'if (setupMode === "menu") {',
  'setLocation(`/menu-builder?${menuParams.toString()}`);',
  'href={buildSetupHref("profile")}',
  'href={buildSetupHref("menu")}',
  'href={buildSetupHref("profile-media")}',
  'setupMode === "profile" || setupMode === "profile-media"',
  'setupMode === "schedule" ? (',
  "setupPanelRef.current.scrollIntoView",
];

for (const snippet of requiredSnippets) {
  if (!page.includes(snippet)) {
    throw new Error(`Missing setup routing snippet: ${snippet}`);
  }
}

console.log("owner-dashboard-setup-routing.contract: PASS");
