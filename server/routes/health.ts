import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getApiMetricsSnapshot } from "../observability";
import { getOpsCleanupSnapshot, runOpsDataCleanup } from "../opsCleanup";
import { getJobQueueStats } from "../jobs/jobQueue";
import { getMapEndpointWatchdogSnapshot } from "../mapEndpointWatchdog";
import { getPaymentHealthSnapshot } from "../services/paymentHealth";

export const healthRouter = Router();
const serverStartedAt = new Date().toISOString();
type DeploymentPlatform = "vercel" | "render" | "unknown";

type BuildMetadataValue = {
  source: string | null;
  value: string | null;
};

function envPresent(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

function detectDeploymentPlatform(): DeploymentPlatform {
  if (
    envPresent("VERCEL") ||
    envPresent("VERCEL_ENV") ||
    envPresent("VERCEL_URL") ||
    envPresent("VERCEL_GIT_COMMIT_SHA")
  ) {
    return "vercel";
  }

  if (
    envPresent("RENDER") ||
    envPresent("RENDER_SERVICE_ID") ||
    envPresent("RENDER_SERVICE_NAME") ||
    envPresent("RENDER_GIT_COMMIT")
  ) {
    return "render";
  }

  return "unknown";
}

function selectBuildMetadataValue(
  candidates: Array<[string, string | undefined]>,
): BuildMetadataValue {
  for (const [source, rawValue] of candidates) {
    const value = String(rawValue || "").trim();
    if (value) {
      return { source, value };
    }
  }

  return { source: null, value: null };
}

function getCommitMetadata() {
  const platform = detectDeploymentPlatform();
  if (platform === "vercel") {
    return selectBuildMetadataValue([
      ["VERCEL_GIT_COMMIT_SHA", process.env.VERCEL_GIT_COMMIT_SHA],
      ["GIT_COMMIT", process.env.GIT_COMMIT],
      ["COMMIT_SHA", process.env.COMMIT_SHA],
      ["SOURCE_VERSION", process.env.SOURCE_VERSION],
      ["RENDER_GIT_COMMIT", process.env.RENDER_GIT_COMMIT],
    ]);
  }

  if (platform === "render") {
    return selectBuildMetadataValue([
      ["RENDER_GIT_COMMIT", process.env.RENDER_GIT_COMMIT],
      ["GIT_COMMIT", process.env.GIT_COMMIT],
      ["COMMIT_SHA", process.env.COMMIT_SHA],
      ["SOURCE_VERSION", process.env.SOURCE_VERSION],
      ["VERCEL_GIT_COMMIT_SHA", process.env.VERCEL_GIT_COMMIT_SHA],
    ]);
  }

  return selectBuildMetadataValue([
    ["GIT_COMMIT", process.env.GIT_COMMIT],
    ["COMMIT_SHA", process.env.COMMIT_SHA],
    ["SOURCE_VERSION", process.env.SOURCE_VERSION],
    ["VERCEL_GIT_COMMIT_SHA", process.env.VERCEL_GIT_COMMIT_SHA],
    ["RENDER_GIT_COMMIT", process.env.RENDER_GIT_COMMIT],
  ]);
}

function getBuildTimeMetadata() {
  const platform = detectDeploymentPlatform();
  if (platform === "vercel") {
    return (
      selectBuildMetadataValue([
        ["BUILD_TIME", process.env.BUILD_TIME],
        ["VERCEL_DEPLOYMENT_CREATED_AT", process.env.VERCEL_DEPLOYMENT_CREATED_AT],
        ["RENDER_DEPLOY_CREATED_AT", process.env.RENDER_DEPLOY_CREATED_AT],
      ]) || { source: null, value: null }
    );
  }

  if (platform === "render") {
    return (
      selectBuildMetadataValue([
        ["BUILD_TIME", process.env.BUILD_TIME],
        ["RENDER_DEPLOY_CREATED_AT", process.env.RENDER_DEPLOY_CREATED_AT],
        ["VERCEL_DEPLOYMENT_CREATED_AT", process.env.VERCEL_DEPLOYMENT_CREATED_AT],
      ]) || { source: null, value: null }
    );
  }

  return (
    selectBuildMetadataValue([
      ["BUILD_TIME", process.env.BUILD_TIME],
      ["VERCEL_DEPLOYMENT_CREATED_AT", process.env.VERCEL_DEPLOYMENT_CREATED_AT],
      ["RENDER_DEPLOY_CREATED_AT", process.env.RENDER_DEPLOY_CREATED_AT],
    ]) || { source: null, value: null }
  );
}

function parseDatabaseHostHint(rawUrl: string | undefined) {
  const value = String(rawUrl || "").trim();
  if (!value) return null;
  // Support both URL-ish and "host=...;..." formats.
  const atMatch = value.match(/@([^:/?#]+)/);
  if (atMatch?.[1]) return atMatch[1];
  const hostMatch = value.match(/\bhost=([^\s;]+)/i);
  if (hostMatch?.[1]) return hostMatch[1];
  return null;
}

function getConfigSnapshot() {
  return {
    nodeEnv: String(process.env.NODE_ENV || "development"),
    required: {
      databaseUrl: envPresent("DATABASE_URL"),
      sessionSecret: envPresent("SESSION_SECRET"),
      clientOrigin: envPresent("CLIENT_ORIGIN"),
    },
    payments: {
      stripeSecretKey: envPresent("STRIPE_SECRET_KEY"),
      mealscoutBypassStripe: String(process.env.MEALSCOUT_BYPASS_STRIPE || "").toLowerCase() === "true",
      mealscoutTestMode: String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true",
    },
    observability: {
      healthMetricsToken: envPresent("HEALTH_METRICS_TOKEN"),
      sentryDsn: envPresent("SENTRY_DSN"),
    },
    queue: {
      concurrency: Number(process.env.JOB_QUEUE_CONCURRENCY || 2) || 2,
      maxSize: Number(process.env.JOB_QUEUE_MAX_SIZE || 5000) || 5000,
      maxAttempts: Number(process.env.JOB_QUEUE_MAX_ATTEMPTS || 3) || 3,
      timeoutMs: Number(process.env.JOB_QUEUE_TIMEOUT_MS || 30000) || 30000,
    },
  };
}

function getBuildSnapshot() {
  const commit = getCommitMetadata();

  return {
    gitCommit: commit.value,
    gitCommitSource: commit.source,
    dbHost: parseDatabaseHostHint(process.env.DATABASE_URL),
    service: String(process.env.RENDER_SERVICE_NAME || "").trim() || null,
    environment: String(process.env.RENDER_SERVICE_ID || "").trim() || null,
  };
}

function getBuildCommit() {
  return getCommitMetadata().value;
}

function getBuildTime() {
  return getBuildTimeMetadata().value || serverStartedAt;
}

function hasFrontendAssetManifest() {
  const candidates = [
    path.join(process.cwd(), "dist", "client", "assets"),
    path.join(process.cwd(), "dist", "public", "assets"),
    path.join(process.cwd(), "server", "public", "assets"),
    path.join(process.cwd(), "client", "dist", "assets"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

function getVersionSnapshot() {
  const platform = detectDeploymentPlatform();
  const commit = getCommitMetadata();
  const buildTime = getBuildTimeMetadata();

  return {
    commit: commit.value,
    commitSource: commit.source,
    buildTime: buildTime.value || serverStartedAt,
    buildTimeSource: buildTime.source || "serverStartedAt",
    platform,
    environment: String(process.env.NODE_ENV || "development"),
    frontendAssetManifest: hasFrontendAssetManifest(),
    commitEnvVars: [
      "RENDER_GIT_COMMIT",
      "VERCEL_GIT_COMMIT_SHA",
      "GIT_COMMIT",
      "COMMIT_SHA",
      "SOURCE_VERSION",
    ],
    buildTimeEnvVars: [
      "BUILD_TIME",
      "RENDER_DEPLOY_CREATED_AT",
      "VERCEL_DEPLOYMENT_CREATED_AT",
    ],
  };
}

healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

healthRouter.get("/health/build", (_req, res) => {
  res.json({ status: "ok", ts: Date.now(), build: getBuildSnapshot() });
});

healthRouter.get(["/api/version", "/health/version"], (_req, res) => {
  res.json({ status: "ok", ts: Date.now(), version: getVersionSnapshot() });
});

healthRouter.get("/health/realtime", (_req, res) => {
  res.json({ status: "ok", realtime: "ready", ts: Date.now() });
});

healthRouter.get("/health/map-endpoints", (_req, res) => {
  const snapshot = getMapEndpointWatchdogSnapshot();
  const status = snapshot.ok ? "ok" : "degraded";
  res.status(snapshot.ok ? 200 : 503).json({
    status,
    ts: Date.now(),
    watchdog: snapshot,
  });
});

// Backward-compatible alias with a clearer name now that checks include
// map + parking + health + auth-protected host status endpoints.
healthRouter.get("/health/critical-endpoints", (_req, res) => {
  const snapshot = getMapEndpointWatchdogSnapshot();
  const status = snapshot.ok ? "ok" : "degraded";
  res.status(snapshot.ok ? 200 : 503).json({
    status,
    ts: Date.now(),
    watchdog: snapshot,
  });
});

healthRouter.get("/health/payments", async (_req, res) => {
  try {
    const snapshot = await getPaymentHealthSnapshot();
    const degraded =
      snapshot.counts.pendingExpired > 0 ||
      (snapshot.counts.failedLast24h || 0) > 0;
    res.status(degraded ? 503 : 200).json({
      status: degraded ? "degraded" : "ok",
      ts: Date.now(),
      payments: snapshot,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error?.message || "Payment health check failed",
      ts: Date.now(),
    });
  }
});

healthRouter.get("/health/ready", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ready", db: "ok", ts: Date.now() });
  } catch (error: any) {
    res.status(503).json({
      status: "not_ready",
      db: "error",
      message: error?.message || "Database check failed",
      ts: Date.now(),
    });
  }
});

healthRouter.get("/health/metrics", async (req, res) => {
  const expected = String(process.env.HEALTH_METRICS_TOKEN || "").trim();
  const provided = String(req.headers["x-health-token"] || "").trim();
  if (expected && provided !== expected) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const paymentHealth = await getPaymentHealthSnapshot().catch(() => null);
  res.json({
    status: "ok",
    ts: Date.now(),
    metrics: getApiMetricsSnapshot(),
    mapEndpoints: getMapEndpointWatchdogSnapshot(),
    payments: paymentHealth,
    cleanup: getOpsCleanupSnapshot(),
    jobs: getJobQueueStats(),
    config: getConfigSnapshot(),
  });
});

healthRouter.post("/health/maintenance/cleanup", async (req, res) => {
  const expected = String(process.env.HEALTH_METRICS_TOKEN || "").trim();
  const provided = String(req.headers["x-health-token"] || "").trim();
  if (!expected || provided !== expected) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const result = await runOpsDataCleanup();
  if (!result.ok) {
    return res.status(500).json({ status: "error", cleanup: result });
  }
  return res.json({ status: "ok", cleanup: result });
});
