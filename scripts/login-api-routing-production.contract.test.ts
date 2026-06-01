import { readFileSync } from "node:fs";

const loginPage = readFileSync("client/src/pages/login.tsx", "utf8");
const telemetryUtil = readFileSync("client/src/utils/uxTelemetry.ts", "utf8");
const authServer = readFileSync("server/unifiedAuth.ts", "utf8");
const telemetryServer = readFileSync("server/routes/geoAdRoutes.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));

if (!loginPage.includes('"/api/auth/login"')) {
  throw new Error("Login page must submit to /api/auth/login");
}
if (!telemetryUtil.includes('"/api/telemetry/track"')) {
  throw new Error("Telemetry client must post to /api/telemetry/track");
}
if (!authServer.includes('app.post("/api/auth/login", async (req, res) => {')) {
  throw new Error("Backend must expose POST /api/auth/login");
}
if (!telemetryServer.includes('app.post("/api/telemetry/track", async (req: any, res) => {')) {
  throw new Error("Backend must expose POST /api/telemetry/track");
}

const routes: Array<{ src?: string; dest?: string }> = Array.isArray(vercelConfig?.routes)
  ? vercelConfig.routes
  : [];
const apiRouteIndex = routes.findIndex(
  (rule) => rule.src === "/api/(.*)" && rule.dest === "https://mealscout.onrender.com/api/$1",
);
if (apiRouteIndex < 0) {
  throw new Error("vercel routes must proxy /api/* to Render before SPA fallback");
}
const spaFallbackIndex = routes.findIndex(
  (rule) => rule.src === "/(.*)" && rule.dest === "/index.html",
);
if (spaFallbackIndex < 0) {
  throw new Error("vercel routes must include SPA fallback");
}
if (apiRouteIndex > spaFallbackIndex) {
  throw new Error("API route proxy must be evaluated before SPA fallback");
}

console.log("login-api-routing-production.contract: PASS");
