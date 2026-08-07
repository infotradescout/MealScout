import { readFileSync } from "node:fs";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));

const routes: Array<Record<string, any>> = Array.isArray(vercelConfig?.routes)
  ? vercelConfig.routes
  : [];
const rewrites: Array<Record<string, any>> = Array.isArray(vercelConfig?.rewrites)
  ? vercelConfig.rewrites
  : [];

const profileSrc =
  "/(restaurant|truck|bar|chef|location|event|events|deal|supplier|suppliers|p|video)/(.*)";
const profileDest = "https://mealscout.onrender.com/$1/$2";
const profileRewriteSource =
  "/:kind(restaurant|truck|bar|chef|location|event|events|deal|supplier|suppliers|p|video)/:path*";
const profileRewriteDest = "https://mealscout.onrender.com/:kind/:path*";

const routeIndex = (matcher: (rule: Record<string, any>) => boolean) =>
  routes.findIndex(matcher);

const rewriteIndex = (matcher: (rule: Record<string, any>) => boolean) =>
  rewrites.findIndex(matcher);

const filesystemIndex = routeIndex((rule) => rule.handle === "filesystem");
if (filesystemIndex < 0) {
  throw new Error("vercel routes must include filesystem handling");
}

const spaFallbackIndex = routeIndex(
  (rule) => rule.src === "/(.*)" && rule.dest === "/index.html",
);
if (spaFallbackIndex < 0) {
  throw new Error("vercel routes must include SPA fallback");
}

const profileRouteIndex = routeIndex(
  (rule) =>
    rule.src === profileSrc &&
    rule.dest === profileDest &&
    !Array.isArray(rule.has),
);
if (profileRouteIndex < 0) {
  throw new Error(
    "vercel routes must proxy public profile traffic to Render for all UAs before filesystem fallback",
  );
}

if (profileRouteIndex > filesystemIndex || profileRouteIndex > spaFallbackIndex) {
  throw new Error(
    "public profile proxy must be evaluated before filesystem/SPA fallback",
  );
}

const profileRewriteIndex = rewriteIndex(
  (rule) =>
    rule.source === profileRewriteSource &&
    rule.destination === profileRewriteDest &&
    !Array.isArray(rule.has),
);
if (profileRewriteIndex < 0) {
  throw new Error(
    "vercel rewrites must forward public profile paths to Render for all UAs",
  );
}

const botGatedProfileProxy = [...routes, ...rewrites].some((rule) => {
  const isProfile =
    rule.src === profileSrc ||
    rule.source === profileRewriteSource ||
    (typeof rule.dest === "string" &&
      rule.dest.includes("mealscout.onrender.com") &&
      /\$1\/\$2|:kind\//.test(String(rule.dest || rule.destination || "")));
  if (!isProfile || !Array.isArray(rule.has)) return false;
  return rule.has.some(
    (entry: Record<string, any>) =>
      entry.type === "header" &&
      String(entry.key || "").toLowerCase() === "user-agent",
  );
});
if (botGatedProfileProxy) {
  throw new Error(
    "public profile proxy must not be gated on user-agent (SSR for all UAs)",
  );
}

console.log("mealscout-data-factory-intake-routing.contract: PASS");
