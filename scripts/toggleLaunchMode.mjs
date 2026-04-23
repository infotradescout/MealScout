#!/usr/bin/env node

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000")
  .trim()
  .replace(/\/$/, "");
const token = String(process.env.HEALTH_METRICS_TOKEN || "").trim();
const mode = String(process.argv[2] || "").trim().toLowerCase();
const reason = String(process.argv.slice(3).join(" ") || "").trim();

const printUsage = () => {
  console.log(
    "Usage: node scripts/toggleLaunchMode.mjs <on|off|reset> [reason...]",
  );
  console.log(
    "Env: SMOKE_BASE_URL (optional), HEALTH_METRICS_TOKEN (required for writes)",
  );
};

if (!["on", "off", "reset"].includes(mode)) {
  printUsage();
  process.exit(1);
}

if (!token) {
  console.error(
    "Missing HEALTH_METRICS_TOKEN. Refusing to call /health/launch-mode.",
  );
  process.exit(1);
}

const params = new URLSearchParams();
if (mode === "on") params.set("enabled", "true");
if (mode === "off") params.set("enabled", "false");
if (mode === "reset") params.set("reset", "true");
if (reason) params.set("reason", reason);

const url = `${baseUrl}/health/launch-mode?${params.toString()}`;

const res = await fetch(url, {
  method: "POST",
  headers: {
    "x-health-token": token,
    accept: "application/json",
  },
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Launch mode toggle failed", res.status, body);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode,
      launchMode: body?.launchMode || null,
      ts: new Date().toISOString(),
    },
    null,
    2,
  ),
);

