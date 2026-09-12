import { and, gte, like, sql } from "drizzle-orm";
import { db } from "./db";
import { requestLogs } from "@shared/schema";
import { emailService, getEmailConfigSummary } from "./emailService";

type EndpointId =
  | "health"
  | "map_locations"
  | "parking_pass_feed"
  | "hosts_me"
  | "parking_pass_host_ids"
  | "parking_pass_host_status";

type EndpointStatus = "ok" | "degraded" | "critical";

type CriticalEndpointSpec = {
  id: EndpointId;
  path: string;
  expectedStatusCodes?: number[];
  emptyPayloadCritical: boolean;
  payloadCountMode?: "none" | "array" | "hostLocations" | "hostIds" | "hosts";
};

type EndpointCheckResult = {
  id: EndpointId;
  path: string;
  status: EndpointStatus;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  timedOut: boolean;
  parseError: boolean;
  dataCount: number | null;
  windowTotal: number;
  window4xx: number;
  window5xx: number;
  window5xxRatePct: number;
  windowP95Ms: number;
  reasons: string[];
};

type WatchdogSnapshot = {
  ts: string;
  reason: string;
  ok: boolean;
  checks: EndpointCheckResult[];
  alertsSent: number;
  alertFailures: number;
};

const CRITICAL_ENDPOINTS: CriticalEndpointSpec[] = [
  {
    id: "health",
    path: "/api/health",
    expectedStatusCodes: [200],
    emptyPayloadCritical: false,
    payloadCountMode: "none",
  },
  {
    id: "map_locations",
    path: "/api/map/locations",
    expectedStatusCodes: [200],
    emptyPayloadCritical: true,
    payloadCountMode: "hostLocations",
  },
  {
    id: "parking_pass_feed",
    path: "/api/parking-pass",
    expectedStatusCodes: [200],
    // Empty parking-pass feeds can happen when no paid slots are live; alert on 5xx spikes instead.
    emptyPayloadCritical: false,
    payloadCountMode: "array",
  },
  {
    id: "hosts_me",
    path: "/api/hosts/me",
    // Guest probes are expected to return 401; this still catches 5xx and latency regressions.
    expectedStatusCodes: [200, 401],
    emptyPayloadCritical: false,
    payloadCountMode: "none",
  },
  {
    id: "parking_pass_host_ids",
    path: "/api/parking-pass/host-ids",
    expectedStatusCodes: [200],
    emptyPayloadCritical: false,
    payloadCountMode: "hostIds",
  },
  {
    id: "parking_pass_host_status",
    path: "/api/parking-pass/host-status",
    expectedStatusCodes: [200],
    emptyPayloadCritical: false,
    payloadCountMode: "hosts",
  },
];

const lastAlertAtByKey = new Map<string, number>();

let lastSnapshot: WatchdogSnapshot = {
  ts: new Date(0).toISOString(),
  reason: "init",
  ok: false,
  checks: [],
  alertsSent: 0,
  alertFailures: 0,
};

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseIntEnv = (key: string, fallback: number) => {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) ? raw : fallback;
};

const MAP_ALERT_WINDOW_MINUTES = parseIntEnv(
  "MAP_ENDPOINT_ALERT_WINDOW_MINUTES",
  15,
);
const MAP_ALERT_MIN_SAMPLES = Math.max(
  1,
  parseIntEnv("MAP_ENDPOINT_ALERT_MIN_SAMPLES", 8),
);
const MAP_ALERT_MAX_5XX_RATE = Math.max(
  0,
  parseIntEnv("MAP_ENDPOINT_ALERT_MAX_5XX_RATE_PCT", 5),
);
const MAP_ALERT_MAX_P95_MS = Math.max(
  250,
  parseIntEnv("MAP_ENDPOINT_ALERT_MAX_P95_MS", 2500),
);
const MAP_ALERT_COOLDOWN_MINUTES = Math.max(
  1,
  parseIntEnv("MAP_ENDPOINT_ALERT_COOLDOWN_MINUTES", 30),
);
const MAP_PROBE_TIMEOUT_MS = Math.max(
  1000,
  parseIntEnv("MAP_ENDPOINT_PROBE_TIMEOUT_MS", 8000),
);

function resolveProbeBaseUrl() {
  const raw =
    process.env.PUBLIC_BASE_URL ||
    process.env.SERVICE_URL ||
    `http://127.0.0.1:${process.env.PORT || 5000}`;
  const withScheme =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function getAlertRecipients() {
  const explicit = String(process.env.MAP_ENDPOINT_ALERT_RECIPIENTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  const incidentRecipients = String(process.env.INCIDENT_EMAIL_RECIPIENTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (incidentRecipients.length > 0) return incidentRecipients;

  const fallback = [
    String(process.env.ADMIN_ALERT_EMAIL || "").trim(),
    String(process.env.ADMIN_EMAIL || "").trim(),
  ].filter(Boolean);
  return fallback;
}

async function getWindowMetrics(pathPrefix: string, since: Date) {
  try {
    const [row] = await db
      .select({
        total: sql<number>`count(*)`,
        error4xx: sql<number>`count(*) filter (where ${requestLogs.statusCode} >= 400 and ${requestLogs.statusCode} < 500)`,
        error5xx: sql<number>`count(*) filter (where ${requestLogs.statusCode} >= 500)`,
        p95Ms: sql<number>`percentile_cont(0.95) within group (order by ${requestLogs.durationMs})`,
      })
      .from(requestLogs)
      .where(
        and(
          gte(requestLogs.createdAt, since),
          like(requestLogs.path, `${pathPrefix}%`),
        ),
      );

    return {
      total: asNumber(row?.total, 0),
      error4xx: asNumber(row?.error4xx, 0),
      error5xx: asNumber(row?.error5xx, 0),
      p95Ms: asNumber(row?.p95Ms, 0),
    };
  } catch (error: any) {
    // Older DB snapshots can miss duration_ms, so we keep alerting active without latency data.
    if (String(error?.code || "") !== "42703") throw error;
    const [row] = await db
      .select({
        total: sql<number>`count(*)`,
        error4xx: sql<number>`count(*) filter (where ${requestLogs.statusCode} >= 400 and ${requestLogs.statusCode} < 500)`,
        error5xx: sql<number>`count(*) filter (where ${requestLogs.statusCode} >= 500)`,
      })
      .from(requestLogs)
      .where(
        and(
          gte(requestLogs.createdAt, since),
          like(requestLogs.path, `${pathPrefix}%`),
        ),
      );

    return {
      total: asNumber(row?.total, 0),
      error4xx: asNumber(row?.error4xx, 0),
      error5xx: asNumber(row?.error5xx, 0),
      p95Ms: 0,
    };
  }
}

async function probeEndpoint(spec: CriticalEndpointSpec): Promise<{
  httpStatus: number | null;
  responseTimeMs: number | null;
  timedOut: boolean;
  parseError: boolean;
  dataCount: number | null;
}> {
  const baseUrl = resolveProbeBaseUrl();
  const suffix =
    spec.id === "parking_pass_host_status"
      ? `?date=${new Date().toISOString().slice(0, 10)}`
      : "";
  const url = `${baseUrl}${spec.path}${suffix}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - started;
    const raw = await response.text();
    let payload: any = null;
    let parseError = false;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        parseError = true;
      }
    }

    let dataCount: number | null = null;
    if (!parseError && payload) {
      if (spec.payloadCountMode === "array") {
        dataCount = Array.isArray(payload) ? payload.length : null;
      } else if (spec.payloadCountMode === "hostLocations") {
        dataCount = Array.isArray(payload.hostLocations)
          ? payload.hostLocations.length
          : null;
      } else if (spec.payloadCountMode === "hostIds") {
        dataCount = Array.isArray(payload.hostIds) ? payload.hostIds.length : null;
      } else if (spec.payloadCountMode === "hosts") {
        dataCount = Array.isArray(payload.hosts) ? payload.hosts.length : null;
      }
    }

    return {
      httpStatus: response.status,
      responseTimeMs,
      timedOut: false,
      parseError,
      dataCount,
    };
  } catch (error: any) {
    const timedOut = error?.name === "AbortError";
    return {
      httpStatus: null,
      responseTimeMs: Date.now() - started,
      timedOut,
      parseError: false,
      dataCount: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldSendAlert(alertKey: string) {
  const now = Date.now();
  const cooldownMs = MAP_ALERT_COOLDOWN_MINUTES * 60 * 1000;
  const last = lastAlertAtByKey.get(alertKey) || 0;
  if (now - last < cooldownMs) return false;
  lastAlertAtByKey.set(alertKey, now);
  return true;
}

async function sendAlertEmail(check: EndpointCheckResult) {
  const recipients = getAlertRecipients();
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const emailConfig = getEmailConfigSummary();
  if (!emailConfig.configured || emailConfig.disabled) {
    return { sent: 0, failed: recipients.length };
  }

  const subject = `[MealScout] Map Endpoint Alert: ${check.path} (${check.status.toUpperCase()})`;
  const details = `
<h2>Map Endpoint Watchdog Alert</h2>
<p><strong>Endpoint:</strong> ${check.path}</p>
<p><strong>Status:</strong> ${check.status}</p>
<p><strong>HTTP Status:</strong> ${check.httpStatus ?? "n/a"}</p>
<p><strong>Response Time:</strong> ${check.responseTimeMs ?? "n/a"} ms</p>
<p><strong>Window Total:</strong> ${check.windowTotal}</p>
<p><strong>Window 5xx Rate:</strong> ${check.window5xxRatePct.toFixed(2)}%</p>
<p><strong>Window P95:</strong> ${check.windowP95Ms.toFixed(0)} ms</p>
<p><strong>Data Count:</strong> ${
    check.dataCount === null ? "n/a" : check.dataCount
  }</p>
<p><strong>Reasons:</strong> ${check.reasons.join(", ")}</p>
<p><strong>Generated:</strong> ${new Date().toISOString()}</p>
  `.trim();

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const ok = await emailService.sendBasicEmail(recipient, subject, details);
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export async function runMapEndpointWatchdog(
  reason = "scheduled",
  options: { sendAlerts?: boolean } = {},
) {
  const since = new Date(Date.now() - MAP_ALERT_WINDOW_MINUTES * 60 * 1000);
  const checks: EndpointCheckResult[] = [];
  let alertsSent = 0;
  let alertFailures = 0;

  for (const spec of CRITICAL_ENDPOINTS) {
    const [probe, window] = await Promise.all([
      probeEndpoint(spec),
      getWindowMetrics(spec.path, since),
    ]);

    const reasons: string[] = [];
    const expectedStatusCodes =
      Array.isArray(spec.expectedStatusCodes) && spec.expectedStatusCodes.length > 0
        ? spec.expectedStatusCodes
        : [200];
    const okHttp =
      probe.httpStatus !== null && expectedStatusCodes.includes(probe.httpStatus);
    if (!okHttp) reasons.push("unavailable");
    if (probe.timedOut) reasons.push("timeout");
    if (probe.parseError) reasons.push("invalid_json");

    const window5xxRatePct =
      window.total > 0 ? (window.error5xx / window.total) * 100 : 0;
    if (window.total >= MAP_ALERT_MIN_SAMPLES && window5xxRatePct > MAP_ALERT_MAX_5XX_RATE) {
      reasons.push("high_5xx_rate");
    }
    if (window.total >= MAP_ALERT_MIN_SAMPLES && window.p95Ms > MAP_ALERT_MAX_P95_MS) {
      reasons.push("high_p95");
    }
    if (
      spec.emptyPayloadCritical &&
      probe.dataCount !== null &&
      probe.dataCount <= 0
    ) {
      reasons.push("empty_payload");
    }

    const status: EndpointStatus = reasons.includes("unavailable") ||
      reasons.includes("empty_payload")
      ? "critical"
      : reasons.length > 0
        ? "degraded"
        : "ok";

    const check: EndpointCheckResult = {
      id: spec.id,
      path: spec.path,
      status,
      ok: status === "ok",
      httpStatus: probe.httpStatus,
      responseTimeMs: probe.responseTimeMs,
      timedOut: probe.timedOut,
      parseError: probe.parseError,
      dataCount: probe.dataCount,
      windowTotal: window.total,
      window4xx: window.error4xx,
      window5xx: window.error5xx,
      window5xxRatePct,
      windowP95Ms: window.p95Ms,
      reasons,
    };

    checks.push(check);

    if (status !== "ok" && options.sendAlerts !== false) {
      const alertKey = `${spec.id}:${reasons.sort().join("|")}`;
      if (shouldSendAlert(alertKey)) {
        const alertResult = await sendAlertEmail(check);
        alertsSent += alertResult.sent;
        alertFailures += alertResult.failed;
      }
    }
  }

  lastSnapshot = {
    ts: new Date().toISOString(),
    reason,
    ok: checks.every((item) => item.ok),
    checks,
    alertsSent,
    alertFailures,
  };

  return lastSnapshot;
}

export function getMapEndpointWatchdogSnapshot() {
  if (lastSnapshot.checks.length === 0) return lastSnapshot;
  if (Date.now() - Date.parse(lastSnapshot.ts) > 10 * 60 * 1000) {
    return { ...lastSnapshot, ok: false, reason: "stale" };
  }
  return lastSnapshot;
}

let watchdogStarted = false;
let watchdogRunning = false;

export function startMapEndpointWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  const refresh = async () => {
    if (watchdogRunning) return;
    watchdogRunning = true;
    try {
      // Scheduled health snapshots only read endpoints and request metrics.
      // Explicit admin runs retain the existing alert-email behavior.
      await runMapEndpointWatchdog("scheduled", { sendAlerts: false });
    } catch (error) {
      lastSnapshot = {
        ...lastSnapshot,
        ok: false,
        reason: "refresh_failed",
      };
      console.warn("[endpoint-watchdog] refresh failed:", error instanceof Error ? error.message : String(error));
    } finally {
      watchdogRunning = false;
    }
  };
  setTimeout(() => { void refresh(); }, 15_000).unref();
  setInterval(() => { void refresh(); }, 5 * 60 * 1000).unref();
}
