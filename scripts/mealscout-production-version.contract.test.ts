import { existsSync, readFileSync } from "node:fs";

const healthRoutePath = "server/routes/health.ts";
const gatePath = "scripts/productionReadinessGate.mjs";

if (!existsSync(healthRoutePath)) {
  throw new Error("Health route file must exist for production version endpoint.");
}

if (!existsSync(gatePath)) {
  throw new Error("Production readiness gate must exist.");
}

const healthRoute = readFileSync(healthRoutePath, "utf8");
const gate = readFileSync(gatePath, "utf8");

const requiredHealthSnippets = [
  'healthRouter.get(["/api/version", "/health/version"]',
  "detectDeploymentPlatform",
  "getCommitMetadata",
  "getBuildTimeMetadata",
  "getVersionSnapshot",
  "commit: commit.value",
  "commitSource: commit.source",
  "buildTime: buildTime.value || serverStartedAt",
  'buildTimeSource: buildTime.source || "serverStartedAt"',
  "platform,",
  'environment: String(process.env.NODE_ENV || "development")',
  "frontendAssetManifest: hasFrontendAssetManifest()",
  "RENDER_GIT_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "GIT_COMMIT",
  "COMMIT_SHA",
  "SOURCE_VERSION",
  "BUILD_TIME",
  "RENDER_DEPLOY_CREATED_AT",
  "VERCEL_DEPLOYMENT_CREATED_AT",
];

for (const snippet of requiredHealthSnippets) {
  if (!healthRoute.includes(snippet)) {
    throw new Error(`Production version endpoint missing required snippet: ${snippet}`);
  }
}

const forbiddenHealthSnippets = [
  "DATABASE_URL: process.env",
  "SESSION_SECRET: process.env",
  "STRIPE_SECRET_KEY: process.env",
  "STRIPE_WEBHOOK_SECRET: process.env",
  "BREVO_API_KEY: process.env",
  "CLOUDINARY_API_SECRET: process.env",
  "db.insert(",
  "db.update(",
  "db.delete(",
];

for (const snippet of forbiddenHealthSnippets) {
  if (healthRoute.includes(snippet)) {
    throw new Error(`Production version endpoint must not expose secrets or mutate data: ${snippet}`);
  }
}

const requiredGateSnippets = [
  "probeJson",
  "production version route",
  "version route exposes commit field",
  "version route exposes buildTime field",
  "version route exposes environment field",
  "version route exposes frontend asset manifest flag",
  "version route documents commit env vars",
  "version route does not expose secrets",
  "/api/version",
];

for (const snippet of requiredGateSnippets) {
  if (!gate.includes(snippet)) {
    throw new Error(`Production readiness gate missing version guard: ${snippet}`);
  }
}

console.log("mealscout-production-version.contract: PASS");
