import { readFileSync } from "node:fs";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
const rewrites: Array<{ source?: string; destination?: string }> = Array.isArray(
  vercelConfig?.rewrites,
)
  ? vercelConfig.rewrites
  : [];
const routes: Array<{ src?: string; dest?: string; status?: number; handle?: string }> =
  Array.isArray(vercelConfig?.routes) ? vercelConfig.routes : [];

const hasAssetsPassThrough = rewrites.some(
  (rule) => rule.source === "/assets/:path*" && rule.destination === "/assets/:path*",
);
if (!hasAssetsPassThrough) {
  throw new Error("vercel.json must preserve /assets/* as static assets before SPA fallback");
}

const hasStaticPassThrough = rewrites.some(
  (rule) => rule.source === "/static/:path*" && rule.destination === "/static/:path*",
);
if (!hasStaticPassThrough) {
  throw new Error("vercel.json must preserve /static/* as static assets before SPA fallback");
}

const spaFallbackRule = rewrites.find((rule) => rule.destination === "/index.html");
if (!spaFallbackRule?.source || !spaFallbackRule.source.includes("(?!assets/|static/)")) {
  throw new Error("SPA fallback must explicitly exclude /assets and /static paths");
}

const filesystemHandleIndex = routes.findIndex((rule) => rule.handle === "filesystem");
if (filesystemHandleIndex < 0) {
  throw new Error("vercel.json routes must include handle=filesystem before SPA route fallback");
}

const assetJsCss404RuleIndex = routes.findIndex(
  (rule) => rule.src === "/assets/(.*\\.(?:js|css))" && rule.status === 404,
);
if (assetJsCss404RuleIndex < 0) {
  throw new Error("vercel.json routes must return 404 for missing /assets/*.js and /assets/*.css");
}
if (assetJsCss404RuleIndex <= filesystemHandleIndex) {
  throw new Error("Asset 404 guard must be evaluated after filesystem static lookup");
}

const staticJsCss404RuleIndex = routes.findIndex(
  (rule) => rule.src === "/static/(.*\\.(?:js|css))" && rule.status === 404,
);
if (staticJsCss404RuleIndex < 0) {
  throw new Error("vercel.json routes must return 404 for missing /static/*.js and /static/*.css");
}
if (staticJsCss404RuleIndex <= filesystemHandleIndex) {
  throw new Error("Static 404 guard must be evaluated after filesystem static lookup");
}

const routesSpaFallbackRuleIndex = routes.findIndex(
  (rule) => rule.src === "/(.*)" && rule.dest === "/index.html",
);
if (routesSpaFallbackRuleIndex < 0) {
  throw new Error("vercel.json routes must include SPA fallback to /index.html");
}
if (
  routesSpaFallbackRuleIndex <= assetJsCss404RuleIndex ||
  routesSpaFallbackRuleIndex <= staticJsCss404RuleIndex
) {
  throw new Error("SPA fallback must be evaluated after JS/CSS asset 404 guards");
}

const scoutAdapters = readFileSync("client/src/features/scout/scoutAdapters.ts", "utf8");
if (!scoutAdapters.includes("buildPublicProfilePath({")) {
  throw new Error("Scout truck scene links must use clean public profile path helper");
}
if (scoutAdapters.includes("`/p/truck/${id}`")) {
  throw new Error("Scout truck scene links must not emit legacy /p/truck canonical paths");
}

const cityLanding = readFileSync("client/src/pages/city-landing.tsx", "utf8");
if (cityLanding.includes("href={`/restaurant/${truck.id}`}")) {
  throw new Error("City landing truck cards must not link to /restaurant/:id");
}
if (!cityLanding.includes("truckPublicProfilePath(truck)")) {
  throw new Error("City landing truck cards must use clean public profile path helper");
}
if (cityLanding.includes("`/p/truck/${id}`")) {
  throw new Error("City landing truck cards must not emit legacy /p/truck paths");
}

console.log("public-profile-route-and-assets.contract: PASS");
