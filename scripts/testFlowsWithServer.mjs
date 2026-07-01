import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

function log(...args) {
  console.log("[flows:with-server]", ...args);
}

function spawnCmd(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  return child;
}

async function getFreePort(preferred = 5001) {
  // Try preferred first, then fall back to ephemeral port.
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
    // 0 = ephemeral
    return await tryPort(0);
  }
}

async function waitForHttp(url, { timeoutMs = 30_000, intervalMs = 300 } = {}) {
  const started = Date.now();
  let lastErr = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      // 200/401/403 are all "server is alive" for our purposes.
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        return { ok: true, status: res.status };
      }
      // If server responds with something else, still alive.
      return { ok: true, status: res.status };
    } catch (e) {
      lastErr = e;
      await sleep(intervalMs);
    }
  }

  const msg =
    lastErr?.message ||
    `Timed out waiting for server at ${url} after ${timeoutMs}ms`;
  throw new Error(msg);
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      // /T kills child tree, /F forces termination
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

async function main() {
  const port = await getFreePort(5001);
  const baseUrl = `http://localhost:${port}`;
  const runIp = `198.51.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

  // Use an endpoint that exists everywhere and returns 401 when not logged in.
  const livenessUrl = `${baseUrl}/api/auth/user`;

  log(`Using PORT=${port}`);
  log(`Using MEALSCOUT_TEST_IP=${runIp}`);
  log(`Starting backend (dev:server)...`);

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:5174",
    MEALSCOUT_BYPASS_STRIPE:
      process.env.MEALSCOUT_BYPASS_STRIPE || "true",
    ALLOWED_ORIGINS: (() => {
      const existing = String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      const required = [baseUrl, "http://localhost:5000", "http://localhost:5174"];
      return Array.from(new Set([...existing, ...required])).join(",");
    })(),
    // Keep NODE_ENV as-is; dev server should already be dev-friendly.
  };

  const server = spawnCmd("npm", ["run", "dev:server"], { env: serverEnv });

  // If server exits early, fail fast.
  let serverExited = false;
  server.on("exit", (code) => {
    serverExited = true;
    log(`Backend exited with code ${code}`);
  });

  try {
    const live = await waitForHttp(livenessUrl, { timeoutMs: 45_000 });
    log(`Backend is reachable at ${livenessUrl} (status ${live.status})`);

    log(`Running flows against BASE_URL=${baseUrl}...`);
    const flowsEnv = {
      ...process.env,
      BASE_URL: baseUrl,
      MEALSCOUT_TEST_IP: process.env.MEALSCOUT_TEST_IP || runIp,
      MEALSCOUT_BYPASS_STRIPE:
        process.env.MEALSCOUT_BYPASS_STRIPE || "true",
    };

    const flows = spawnCmd("npm", ["run", "test:flows"], { env: flowsEnv });

    const exitCode = await new Promise((resolve) => {
      flows.on("exit", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      throw new Error(`test:flows failed with exit code ${exitCode}`);
    }

    log("✅ test:flows passed.");
  } finally {
    log("Stopping backend...");
    killTree(server);

    // Give it a moment to stop cleanly
    await sleep(800);

    if (!serverExited) {
      // Hard kill fallback
      killTree(server);
    }
  }
}

main().catch((err) => {
  console.error("[flows:with-server] ❌", err?.stack || err?.message || err);
  process.exit(1);
});
