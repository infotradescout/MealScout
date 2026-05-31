import { readFileSync } from "node:fs";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
const rewrites: Array<{ source?: string; destination?: string }> = Array.isArray(
  vercelConfig?.rewrites,
)
  ? vercelConfig.rewrites
  : [];

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

const scoutAdapters = readFileSync("client/src/features/scout/scoutAdapters.ts", "utf8");
if (!scoutAdapters.includes("`/p/truck/${id}`")) {
  throw new Error("Scout truck scene links must target /p/truck canonical paths");
}
if (scoutAdapters.includes("href: truck?.id ? `/truck/${truck.id}` : null")) {
  throw new Error("Legacy truck links (/truck/:id) must not be used in scout adapters");
}

const cityLanding = readFileSync("client/src/pages/city-landing.tsx", "utf8");
if (cityLanding.includes("href={`/restaurant/${truck.id}`}")) {
  throw new Error("City landing truck cards must not link to /restaurant/:id");
}
if (!cityLanding.includes("truckPublicProfilePath(truck)")) {
  throw new Error("City landing truck cards must use canonical /p/truck path helper");
}

console.log("public-profile-route-and-assets.contract: PASS");
