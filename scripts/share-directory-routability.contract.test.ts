import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generateShareableUrl, resolveCanonicalShareOrigin } from "../server/shareMiddleware";

const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const appRoutes = readFileSync("client/src/App.tsx", "utf8");
const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const systemRoutes = readFileSync("server/routes/systemUtilityRoutes.ts", "utf8");

const hrefs = Array.from(shareHub.matchAll(/href:\s*(["'`])([^"'`]+)\1/g))
  .map((match) => match[2])
  .filter((href) => href.startsWith("/"));

assert(hrefs.length > 0, "Share Hub href extraction must find public hrefs.");

const registeredRouteSnippets = [
  ...Array.from(appRoutes.matchAll(/<Route[\s\S]*?path="([^"]+)"/g)).map((match) => match[1]),
  "/ref/:tag",
];

function stripQuery(path: string): string {
  return path.split("?")[0].replace(/\/+$/, "") || "/";
}

function routeMatches(href: string): boolean {
  const path = stripQuery(href.replace("${affiliateTag}", "sample-tag"));
  return registeredRouteSnippets.some((route) => {
    const routePath = stripQuery(route);
    if (routePath === path) return true;
    if (!routePath.includes(":")) return false;
    const routeParts = routePath.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    return (
      routeParts.length === pathParts.length &&
      routeParts.every((part, index) => part.startsWith(":") || part === pathParts[index])
    );
  });
}

for (const href of hrefs) {
  assert.equal(routeMatches(href), true, `Share Hub href must be routable: ${href}`);
}

assert(appRoutes.includes('"/ref/"'), "App public route prefix must include /ref/.");
assert(appRoutes.includes('path="/ref/:tag"'), "App must register /ref/:tag.");
assert(
  systemRoutes.includes("res.redirect(`/scout?ref=${safeTag}`)"),
  "Server /ref/:tag redirect must land on Scout with the ref.",
);

const previous = {
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  VITE_APP_URL: process.env.VITE_APP_URL,
};
process.env.PUBLIC_APP_URL = "https://www.mealscout.us";
delete process.env.CLIENT_ORIGIN;
delete process.env.APP_PUBLIC_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.VITE_APP_URL;

const origin = resolveCanonicalShareOrigin({
  protocol: "https",
  get: (name: string) =>
    name.toLowerCase() === "host" ? "mealscout.onrender.com" : undefined,
});
assert.equal(origin, "https://www.mealscout.us");
const shareLink = generateShareableUrl("/scout", origin, "sample-tag");
assert.equal(shareLink.startsWith("https://www.mealscout.us/scout"), true);
assert.equal(shareLink.includes("mealscout.onrender.com"), false);
assert(
  shareRoutes.includes("resolveCanonicalShareOrigin(req)"),
  "/api/share/generate must use canonical public origin resolver.",
);

for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

console.log("share-directory-routability.contract: PASS");
