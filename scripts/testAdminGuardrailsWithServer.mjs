import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function log(...args) {
  console.log("[admin-guardrails:with-server]", ...args);
}

function spawnCmd(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
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

async function isHttpAlive(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return Boolean(res && res.status >= 100);
  } catch {
    return false;
  }
}

async function waitForHttp(url, { timeoutMs = 45_000, intervalMs = 300 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isHttpAlive(url)) {
      return true;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function buildOrigin(baseUrl) {
  const parsed = new URL(baseUrl);
  const portPart = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//localhost${portPart}`;
}

async function runScript(scriptName, env) {
  const child = spawnCmd("npm", ["run", scriptName], { env });
  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`${scriptName} failed with exit code ${code}`);
  }
}

async function main() {
  const baseUrl = String(
    process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5200",
  )
    .trim()
    .replace(/\/$/, "");
  const origin = String(process.env.ADMIN_SMOKE_ORIGIN || buildOrigin(baseUrl)).trim();
  const healthUrl = `${baseUrl}/api/health`;

  const runEnv = {
    ...process.env,
    ADMIN_SMOKE_BASE_URL: baseUrl,
    ADMIN_SMOKE_ORIGIN: origin,
  };

  let server = null;
  let startedServer = false;
  let serverExited = false;

  if (await isHttpAlive(healthUrl)) {
    log(`Reusing existing backend at ${baseUrl}`);
  } else {
    const parsed = new URL(baseUrl);
    const resolvedPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");

    log(`Starting backend on port ${resolvedPort} for guardrail tests...`);
    const serverEnv = {
      ...process.env,
      PORT: resolvedPort,
      CLIENT_ORIGIN: origin,
      ALLOWED_ORIGINS: (() => {
        const existing = String(process.env.ALLOWED_ORIGINS || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        const required = [origin, baseUrl, `http://127.0.0.1:${resolvedPort}`, `http://localhost:${resolvedPort}`];
        return Array.from(new Set([...existing, ...required])).join(",");
      })(),
    };

    server = spawnCmd("npm", ["run", "dev:server"], { env: serverEnv });
    startedServer = true;

    server.on("exit", () => {
      serverExited = true;
    });

    await waitForHttp(healthUrl, { timeoutMs: 60_000 });
    log(`Backend reachable at ${baseUrl}`);
  }

  try {
    await runScript("test:admin-manual-provisioning", runEnv);
    await runScript("test:event-guardrails", runEnv);
    log("All admin guardrail checks passed.");
  } finally {
    if (startedServer && server) {
      log("Stopping backend...");
      killTree(server);
      await sleep(800);
      if (!serverExited) {
        killTree(server);
      }
    }
  }
}

main().catch((error) => {
  console.error(
    "[admin-guardrails:with-server]",
    error?.stack || error?.message || error,
  );
  process.exit(1);
});
