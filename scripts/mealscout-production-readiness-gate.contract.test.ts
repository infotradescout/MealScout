import { readFileSync, existsSync } from "node:fs";

const gatePath = "scripts/productionReadinessGate.mjs";
if (!existsSync(gatePath)) {
  throw new Error("Production readiness gate script must exist.");
}

const gate = readFileSync(gatePath, "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (packageJson.scripts?.["gate:production"] !== "node scripts/productionReadinessGate.mjs") {
  throw new Error("package.json must expose gate:production.");
}

const requiredSnippets = [
  "IndexNow key URL",
  "resolveIndexNowConfig",
  "canonical public URL host",
  "PUBLIC_CANONICAL_HOST = \"www.mealscout.us\"",
  "API_BACKEND_ORIGIN = \"https://mealscout.onrender.com\"",
  "Vercel rewrite: /api to Render",
  "Vercel route: /api before SPA fallback",
  "health route",
  "ready route",
  "public profile route",
  "Scout route",
  "Parking Pass route",
  "admin launch-board requires auth",
  "DATABASE_URL",
  "SESSION_SECRET",
  "PUBLIC_BASE_URL",
  "SITEMAP_SITE_URL",
  "INDEXNOW_KEY",
  "STRIPE_SECRET_KEY",
  "BREVO_API_KEY",
  "105_restaurant_insurance_verification_expiry.sql",
  "run migrations/${INSURANCE_MIGRATION} before relying on deployed booking eligibility",
  "mutableMethods",
  "submitIndexNowUrls(",
  "GET-only key verification",
  "SKIP_LIVE_PROBES",
];

for (const snippet of requiredSnippets) {
  if (!gate.includes(snippet)) {
    throw new Error(`Production readiness gate missing required snippet: ${snippet}`);
  }
}

const forbiddenMutationSnippets = [
  'method: "POST"',
  'method: "PUT"',
  'method: "PATCH"',
  'method: "DELETE"',
  "db.insert(",
  "db.update(",
  "db.delete(",
  "fetch(INDEXNOW_ENDPOINT",
];

for (const snippet of forbiddenMutationSnippets) {
  if (gate.includes(snippet)) {
    throw new Error(`Production readiness gate must not mutate data/providers: ${snippet}`);
  }
}

console.log("mealscout-production-readiness-gate.contract: PASS");
