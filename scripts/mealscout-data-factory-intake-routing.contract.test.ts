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
const botUserAgentPattern =
  ".*(bot|Bot|crawler|Crawler|spider|Spider|preview|Preview|fetcher|Fetcher|facebookexternalhit|Facebot|facebot|WhatsApp|whatsapp|TelegramBot|telegrambot|Slackbot|slackbot|Discordbot|discordbot|LinkedInBot|linkedinbot|Twitterbot|twitterbot|Applebot|applebot|GPTBot|gptbot|ClaudeBot|claudebot|PerplexityBot|perplexitybot|Bytespider|bytespider|CCBot|ccbot).*";

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

const prerenderRouteIndex = routeIndex(
  (rule) =>
    rule.src === profileSrc &&
    rule.dest === profileDest &&
    Array.isArray(rule.has) &&
    rule.has.some(
      (entry: Record<string, any>) =>
        entry.type === "query" && entry.key === "prerender",
    ),
);
if (prerenderRouteIndex < 0) {
  throw new Error(
    "vercel routes must proxy prerender profile traffic to Render before filesystem fallback",
  );
}

const botRouteIndex = routeIndex(
  (rule) =>
    rule.src === profileSrc &&
    rule.dest === profileDest &&
    Array.isArray(rule.has) &&
    rule.has.some(
      (entry: Record<string, any>) =>
        entry.type === "header" &&
        entry.key === "user-agent" &&
        entry.value === botUserAgentPattern,
    ),
);
if (botRouteIndex < 0) {
  throw new Error(
    "vercel routes must proxy bot profile traffic to Render before filesystem fallback",
  );
}

if (prerenderRouteIndex > filesystemIndex || prerenderRouteIndex > spaFallbackIndex) {
  throw new Error(
    "prerender profile proxy must be evaluated before filesystem/SPA fallback",
  );
}

if (botRouteIndex > filesystemIndex || botRouteIndex > spaFallbackIndex) {
  throw new Error(
    "bot profile proxy must be evaluated before filesystem/SPA fallback",
  );
}

const prerenderRewriteIndex = rewriteIndex(
  (rule) =>
    rule.source ===
      "/:kind(restaurant|truck|bar|chef|location|event|events|deal|supplier|suppliers|p|video)/:path*" &&
    rule.destination === "https://mealscout.onrender.com/:kind/:path*" &&
    Array.isArray(rule.has) &&
    rule.has.some(
      (entry: Record<string, any>) =>
        entry.type === "query" && entry.key === "prerender",
    ),
);
if (prerenderRewriteIndex < 0) {
  throw new Error("vercel rewrites must preserve prerender profile forwarding");
}

const botRewriteIndex = rewriteIndex(
  (rule) =>
    rule.source ===
      "/:kind(restaurant|truck|bar|chef|location|event|events|deal|supplier|suppliers|p|video)/:path*" &&
    rule.destination === "https://mealscout.onrender.com/:kind/:path*" &&
    Array.isArray(rule.has) &&
    rule.has.some(
      (entry: Record<string, any>) =>
        entry.type === "header" &&
        entry.key === "user-agent" &&
        entry.value === botUserAgentPattern,
    ),
);
if (botRewriteIndex < 0) {
  throw new Error("vercel rewrites must preserve bot profile forwarding");
}

console.log("mealscout-data-factory-intake-routing.contract: PASS");
