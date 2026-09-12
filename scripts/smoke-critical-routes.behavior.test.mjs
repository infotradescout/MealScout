import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const smokeScript = fileURLToPath(new URL("./smokeCriticalRoutes.mjs", import.meta.url));

for (const criticalStatus of [200, 503]) {
  test(`critical smoke ${criticalStatus === 200 ? "passes healthy" : "rejects degraded"} service`, async (t) => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      res.statusCode = req.url === "/health/critical-endpoints"
        ? criticalStatus
        : req.url === "/api/admin/dashboard-totals" ? 401 : 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: res.statusCode === 200 ? "ok" : "unavailable" }));
    });
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const child = spawn(process.execPath, [smokeScript], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
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
    assert.equal(exitCode, criticalStatus === 200 ? 0 : 1, output);
    if (criticalStatus === 503) {
      assert.match(output, /\[FAIL\] Critical endpoint health -> 503/);
      assert.doesNotMatch(output, /Smoke checks passed/);
    }
  });
}
