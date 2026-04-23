#!/usr/bin/env node

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000")
  .trim()
  .replace(/\/$/, "")
  .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1");

const durationSec = Math.max(
  5,
  Number(process.env.SPIKE_DURATION_SEC || process.argv[2] || 20) || 20,
);
const concurrency = Math.max(
  1,
  Number(process.env.SPIKE_CONCURRENCY || process.argv[3] || 12) || 12,
);

const endpoints = [
  "/api/health",
  "/api/map/locations",
  "/api/parking-pass",
  "/api/map/foot-traffic?north=30.44&south=30.32&east=-87.18&west=-87.33&windowMinutes=720&mode=avg&includeGoogle=false",
];

const accepted = new Map([
  ["/api/health", new Set([200])],
  ["/api/map/locations", new Set([200])],
  ["/api/parking-pass", new Set([200])],
  ["/api/map/foot-traffic?north=30.44&south=30.32&east=-87.18&west=-87.33&windowMinutes=720&mode=avg&includeGoogle=false", new Set([200])],
]);

const latency = [];
let total = 0;
let failures = 0;
const statusCounts = new Map();

const started = Date.now();
const deadline = started + durationSec * 1000;

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
};

const worker = async () => {
  while (Date.now() < deadline) {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const url = `${baseUrl}${endpoint}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
      });
      const ms = Date.now() - t0;
      latency.push(ms);
      total += 1;
      const statusKey = `${endpoint}:${res.status}`;
      statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
      const okSet = accepted.get(endpoint) || new Set([200]);
      if (!okSet.has(res.status)) {
        failures += 1;
      }
      await res.arrayBuffer().catch(() => null);
    } catch {
      total += 1;
      failures += 1;
      const ms = Date.now() - t0;
      latency.push(ms);
      const statusKey = `${endpoint}:network_error`;
      statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
    }
  }
};

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const p50 = percentile(latency, 50);
const p95 = percentile(latency, 95);
const p99 = percentile(latency, 99);
const failRate = total > 0 ? (failures / total) * 100 : 0;

console.log("Launch spike smoke:");
console.log(`- baseUrl: ${baseUrl}`);
console.log(`- durationSec: ${durationSec}`);
console.log(`- concurrency: ${concurrency}`);
console.log(`- totalRequests: ${total}`);
console.log(`- failures: ${failures} (${failRate.toFixed(2)}%)`);
console.log(`- latency p50/p95/p99: ${p50}ms / ${p95}ms / ${p99}ms`);
console.log("- status breakdown:");
for (const [key, count] of [...statusCounts.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  console.log(`  ${key} => ${count}`);
}

const fail = failRate > 5 || p95 > 3000;
if (fail) {
  console.error(
    `Spike smoke failed thresholds (failRate<=5%, p95<=3000ms): got failRate=${failRate.toFixed(
      2,
    )}%, p95=${p95}ms`,
  );
  process.exit(1);
}

console.log("Spike smoke passed thresholds.");

