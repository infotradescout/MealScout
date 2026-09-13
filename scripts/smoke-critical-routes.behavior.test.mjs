import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const smokeScript = fileURLToPath(new URL("./smokeCriticalRoutes.mjs", import.meta.url));

const healthySnapshot = () => ({
  status: "ok",
  watchdog: { ok: true, ts: new Date().toISOString(), checks: [{ ok: true }] },
});
for (const scenario of [
  { name: "passes healthy service", status: 200, payload: healthySnapshot, expectedExit: 0 },
  { name: "rejects degraded service", status: 503, payload: () => ({ status: "degraded" }), expectedExit: 1 },
  { name: "rejects SPA fallback", status: 200, html: true, expectedExit: 1 },
  { name: "rejects an uninitialized watchdog", status: 200, payload: () => ({ status: "ok", watchdog: { ok: true, ts: new Date(0).toISOString(), checks: [] } }), expectedExit: 1 },
  { name: "rejects stale checks", status: 200, payload: () => { const body = healthySnapshot(); body.watchdog.ts = new Date(Date.now() - 11 * 60_000).toISOString(); return body; }, expectedExit: 1 },
  { name: "rejects failed checks behind HTTP 200", status: 200, payload: () => { const body = healthySnapshot(); body.watchdog.checks[0].ok = false; return body; }, expectedExit: 1 },
]) {
  test(`critical smoke ${scenario.name}`, async (t) => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      res.statusCode = req.url === "/health/critical-endpoints"
        ? scenario.status
        : req.url === "/api/admin/dashboard-totals" ? 401 : 200;
      if (req.url === "/health/critical-endpoints" && scenario.html) {
        res.setHeader("Content-Type", "text/html");
        res.end("<!DOCTYPE html><title>MealScout</title>");
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(req.url === "/health/critical-endpoints" ? scenario.payload() : { status: "ok" }));
      }
    });
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const child = spawn(process.execPath, [smokeScript], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
        SMOKE_HEALTH_BASE_URL: `http://127.0.0.1:${address.port}`,
        SMOKE_API_ONLY: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const [exitCode] = await once(child, "close");
    assert.ok(requests.includes("/health/critical-endpoints"));
    assert.equal(exitCode, scenario.expectedExit, output);
    if (scenario.expectedExit === 1) {
      assert.match(output, /\[FAIL\] Critical endpoint health/);
      assert.doesNotMatch(output, /Smoke checks passed/);
    }
  });
}

test("watchdog starts unavailable, records probes, expires evidence, and keeps scheduled refreshes read-only", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.MEALSCOUT_DISPOSABLE_POSTGRES = "1";
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.BREVO_API_KEY = "";
  const { db, pool } = await import("../server/db.ts");
  t.after(() => pool.end());
  const { emailService } = await import("../server/emailService.ts");
  const { getMapEndpointWatchdogSnapshot, runMapEndpointWatchdog } = await import("../server/mapEndpointWatchdog.ts");
  assert.equal(getMapEndpointWatchdogSnapshot().ok, false);
  assert.equal(getMapEndpointWatchdogSnapshot().reason, "init");
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ total: 0, error4xx: 0, error5xx: 0, p95Ms: 0 }] }) }));
  const email = t.mock.method(emailService, "sendBasicEmail", async () => { throw new Error("Unexpected email side effect"); });
  let degraded = false;
  const requestedPaths = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(String(input)).pathname;
    requestedPaths.push(path);
    const body = path === "/api/map/locations" ? { hostLocations: [{ id: "fixture-host" }] }
      : path === "/api/parking-pass" ? []
      : path === "/api/parking-pass/host-ids" ? { hostIds: [] }
      : path === "/api/parking-pass/host-status" ? { hosts: [] } : { status: "ok" };
    return new Response(JSON.stringify(body), { status: degraded ? 503 : 200 });
  });
  const healthy = await runMapEndpointWatchdog("fixture", { sendAlerts: false });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.checks.length, 6);
  assert.equal(new Set(requestedPaths).size, 6);
  const clock = t.mock.method(Date, "now", () => Date.parse(healthy.ts) + 11 * 60_000);
  assert.equal(getMapEndpointWatchdogSnapshot().ok, false);
  assert.equal(getMapEndpointWatchdogSnapshot().reason, "stale");
  clock.mock.restore();
  degraded = true;
  const failed = await runMapEndpointWatchdog("scheduled", { sendAlerts: false });
  assert.equal(failed.ok, false);
  assert.ok(failed.checks.every((check) => check.ok === false));
  assert.equal(email.mock.callCount(), 0);
});
