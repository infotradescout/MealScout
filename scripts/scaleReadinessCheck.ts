import "dotenv/config";

const baseUrl = String(process.env.API_BASE || "http://localhost:5000").replace(/\/+$/, "");
const healthToken = String(process.env.HEALTH_METRICS_TOKEN || "").trim();
const skipLocalEnvChecks = String(process.env.SKIP_LOCAL_ENV_CHECKS || "").toLowerCase() === "true";

const requiredEnv = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
];

async function checkEndpoint(path: string, headers?: Record<string, string>) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const ok = res.ok;
    const body = await res.text();
    return { ok, status: res.status, body: body.slice(0, 200) };
  } catch (error: any) {
    return { ok: false, status: 0, body: error?.message || "request_failed" };
  }
}

async function main() {
  let failed = 0;

  console.log("Scale readiness check");
  console.log(`API_BASE=${baseUrl}`);

  if (!skipLocalEnvChecks) {
    for (const key of requiredEnv) {
      const present = Boolean(String(process.env[key] || "").trim());
      if (!present) {
        console.log(`FAIL env missing: ${key}`);
        failed += 1;
      } else {
        console.log(`PASS env present: ${key}`);
      }
    }
  } else {
    console.log("SKIP local env presence checks");
  }

  const health = await checkEndpoint("/health");
  console.log(`${health.ok ? "PASS" : "FAIL"} /health status=${health.status}`);
  if (!health.ok) failed += 1;

  const ready = await checkEndpoint("/health/ready");
  console.log(`${ready.ok ? "PASS" : "FAIL"} /health/ready status=${ready.status}`);
  if (!ready.ok) failed += 1;

  const metricsHeaders: Record<string, string> = {};
  if (healthToken) metricsHeaders["X-Health-Token"] = healthToken;
  const metrics = await checkEndpoint("/health/metrics", metricsHeaders);
  if (!healthToken && metrics.status === 401) {
    console.log("SKIP /health/metrics status=401 (set HEALTH_METRICS_TOKEN to verify protected metrics)");
  } else {
    console.log(`${metrics.ok ? "PASS" : "FAIL"} /health/metrics status=${metrics.status}`);
    if (!metrics.ok) failed += 1;
  }

  if (failed > 0) {
    console.log(`Readiness check FAILED (${failed} issue(s))`);
    process.exit(1);
  }

  console.log("Readiness check PASSED");
}

main().catch((error) => {
  console.error("Readiness script failed:", error);
  process.exit(1);
});
