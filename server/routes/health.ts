import { Router } from "express";
import { db, getDbPoolSnapshot } from "../db";
import { sql } from "drizzle-orm";
import { getApiMetricsSnapshot, getPerformanceHealthSnapshot } from "../observability";
import { getOpsCleanupSnapshot, runOpsDataCleanup } from "../opsCleanup";
import { getJobQueueStats } from "../jobs/jobQueue";
import { getMapEndpointWatchdogSnapshot } from "../mapEndpointWatchdog";
import { getPaymentHealthSnapshot } from "../services/paymentHealth";
import { getResponseCacheSnapshot } from "../utils/responseCache";
import {
  clearLaunchDegradedModeOverride,
  getLaunchModeState,
  setLaunchDegradedMode,
} from "../launchMode";

export const healthRouter = Router();

function envPresent(name: string) {
  return Boolean(String(process.env[name] || "").trim());
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
      redisUrl: envPresent("REDIS_URL"),
      performanceAlerts: {
        p95Ms: Number(process.env.PERF_ALERT_P95_MS || 1500) || 1500,
        serverErrorRatePct: Number(process.env.PERF_ALERT_5XX_RATE_PCT || 2) || 2,
      },
    },
    database: getDbPoolSnapshot(),
    queue: {
      concurrency: Number(process.env.JOB_QUEUE_CONCURRENCY || 2) || 2,
      maxSize: Number(process.env.JOB_QUEUE_MAX_SIZE || 5000) || 5000,
      maxAttempts: Number(process.env.JOB_QUEUE_MAX_ATTEMPTS || 3) || 3,
      timeoutMs: Number(process.env.JOB_QUEUE_TIMEOUT_MS || 30000) || 30000,
    },
    launchMode: getLaunchModeState(),
  };
}

function getBuildSnapshot() {
  const gitCommit =
    String(
      process.env.RENDER_GIT_COMMIT ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT ||
        "",
    ).trim() || null;

  return {
    gitCommit,
    dbHost: parseDatabaseHostHint(process.env.DATABASE_URL),
    service: String(process.env.RENDER_SERVICE_NAME || "").trim() || null,
    environment: String(process.env.RENDER_SERVICE_ID || "").trim() || null,
  };
}

healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

healthRouter.get("/health/build", (_req, res) => {
  res.json({ status: "ok", ts: Date.now(), build: getBuildSnapshot() });
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
    performance: getPerformanceHealthSnapshot(),
    cache: getResponseCacheSnapshot(),
    database: getDbPoolSnapshot(),
    mapEndpoints: getMapEndpointWatchdogSnapshot(),
    payments: paymentHealth,
    cleanup: getOpsCleanupSnapshot(),
    jobs: getJobQueueStats(),
    config: getConfigSnapshot(),
  });
});

healthRouter.get("/health/launch-mode", (_req, res) => {
  res.json({
    status: "ok",
    ts: Date.now(),
    launchMode: getLaunchModeState(),
  });
});

healthRouter.post("/health/launch-mode", async (req, res) => {
  const expected = String(process.env.HEALTH_METRICS_TOKEN || "").trim();
  const provided = String(req.headers["x-health-token"] || "").trim();
  if (!expected || provided !== expected) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const enabledRaw = String(req.query.enabled || "").trim().toLowerCase();
  const resetRaw = String(req.query.reset || "").trim().toLowerCase();
  const reason = String(req.query.reason || "").trim();

  if (resetRaw === "true" || resetRaw === "1") {
    return res.json({
      status: "ok",
      ts: Date.now(),
      launchMode: clearLaunchDegradedModeOverride(),
    });
  }

  if (!["true", "false", "1", "0"].includes(enabledRaw)) {
    return res.status(400).json({
      message:
        "Missing or invalid `enabled` query parameter. Use true/false (or set reset=true).",
    });
  }

  const enabled = enabledRaw === "true" || enabledRaw === "1";
  return res.json({
    status: "ok",
    ts: Date.now(),
    launchMode: setLaunchDegradedMode(enabled, reason || null),
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
