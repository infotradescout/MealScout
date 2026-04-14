import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

function log(...args) {
  console.log("[mobile-deeplinks:with-server]", ...args);
}

function spawnCmd(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
}

async function getFreePort(preferred = 5002) {
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

async function waitForHttp(url, { timeoutMs = 45_000, intervalMs = 300 } = {}) {
  const started = Date.now();
  let lastErr = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      return { ok: true, status: res.status };
    } catch (e) {
      lastErr = e;
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

async function main() {
  const port = await getFreePort(5002);
  const baseUrl = `http://localhost:${port}`;
  const livenessUrl = `${baseUrl}/api/auth/user`;

  log(`Using PORT=${port}`);
  log("Starting backend (dev:server)...");

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:5174",
  };

  const server = spawnCmd("npm", ["run", "dev:server"], { env: serverEnv });
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  try {
    const live = await waitForHttp(livenessUrl);
    log(`Backend reachable at ${livenessUrl} (status ${live.status})`);

    log(`Running deep-link smoke against SMOKE_BASE_URL=${baseUrl}...`);
    const smoke = spawnCmd("npm", ["run", "smoke:mobile-deeplinks"], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: baseUrl,
      },
    });

    const exitCode = await new Promise((resolve) => {
      smoke.on("exit", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      throw new Error(`smoke:mobile-deeplinks failed with exit code ${exitCode}`);
    }

    log("✅ mobile deep-link smoke passed.");
  } finally {
    log("Stopping backend...");
    killTree(server);
    await sleep(800);
    if (!serverExited) killTree(server);
  }
}

main().catch((err) => {
  console.error(
    "[mobile-deeplinks:with-server] ❌",
    err?.stack || err?.message || err,
  );
  process.exit(1);
});
