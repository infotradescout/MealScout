import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

function log(...args) {
  console.log("[launch-week]", ...args);
}

function spawnCmd(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
}

async function getFreePort(preferred = 5200) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(port, "127.0.0.1", () => {
        const address = srv.address();
        const actual = typeof address === "string" ? preferred : address.port;
        srv.close(() => resolve(actual));
      });
    });

  try {
    return await tryPort(preferred);
  } catch {
    return await tryPort(0);
  }
}

async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 350 } = {}) {
  const started = Date.now();
  let lastErr = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      return { ok: true, status: res.status };
    } catch (error) {
      lastErr = error;
      await sleep(intervalMs);
    }
  }

  throw new Error(
    lastErr?.message || `Timed out waiting for server at ${url} after ${timeoutMs}ms`,
  );
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

async function runStep(name, cmd, args, env = process.env) {
  log(`Running ${name}...`);
  const child = spawnCmd(cmd, args, { env });
  const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  if (code !== 0) {
    throw new Error(`${name} failed with exit code ${code}`);
  }
  log(`PASS ${name}`);
}

function printEnvStatus() {
  const required = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "STRIPE_SECRET_KEY",
    "VITE_STRIPE_PUBLIC_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ];
  const recommended = [
    "BREVO_API_KEY",
    "INCIDENT_EMAIL_RECIPIENTS",
    "GOOGLE_MAPS_API_KEY",
    "VITE_GOOGLE_MAPS_WEB_API_KEY",
  ];

  const missingRequired = required.filter((key) => !String(process.env[key] || "").trim());
  const missingRecommended = recommended.filter(
    (key) => !String(process.env[key] || "").trim(),
  );

  log("Environment check");
  if (!missingRequired.length) {
    log("PASS required env vars present");
  } else {
    log(`FAIL missing required env vars: ${missingRequired.join(", ")}`);
  }

  if (!missingRecommended.length) {
    log("PASS recommended env vars present");
  } else {
    log(`WARN missing recommended env vars: ${missingRecommended.join(", ")}`);
  }

  return { missingRequired, missingRecommended };
}

async function main() {
  const strictEnv = String(process.env.LAUNCH_STRICT_ENV || "false").toLowerCase() === "true";
  const { missingRequired } = printEnvStatus();

  await runStep("Typecheck", "npm", ["run", "check"]);
  await runStep("Release readiness", "npm", ["run", "check:release-readiness"]);

  const port = await getFreePort(5200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthUrl = `${baseUrl}/api/health`;

  log(`Starting backend on PORT=${port} for smoke/load tests...`);
  const serverEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: String(port),
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:5174",
  };

  const server = spawnCmd("npm", ["run", "dev:server"], { env: serverEnv });
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  try {
    const health = await waitForHttp(healthUrl);
    log(`Backend reachable at ${healthUrl} (status ${health.status})`);

    const smokeEnv = {
      ...process.env,
      SMOKE_BASE_URL: baseUrl,
    };

    await runStep("Critical smoke", "npm", ["run", "smoke:critical"], smokeEnv);
    await runStep("Launch spike smoke", "npm", ["run", "smoke:launch-spike"], smokeEnv);
  } finally {
    log("Stopping backend...");
    killTree(server);
    await sleep(800);
    if (!serverExited) killTree(server);
  }

  if (strictEnv && missingRequired.length > 0) {
    throw new Error(
      `Strict env mode is enabled and required env vars are missing: ${missingRequired.join(", ")}`,
    );
  }

  log("SUCCESS launch-week readiness checks completed.");
  if (!strictEnv && missingRequired.length > 0) {
    log("NOTE run with LAUNCH_STRICT_ENV=true in staging/prod to enforce required env vars.");
  }
}

main().catch((error) => {
  console.error("[launch-week] FAIL", error?.stack || error?.message || error);
  process.exit(1);
});
