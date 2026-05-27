import "dotenv/config";
import net from "node:net";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function getFreePort(preferred = 0): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
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

async function waitForHttp(url: string, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if ([200, 401, 403].includes(res.status)) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function stopServer(server: ChildProcess) {
  if (!server || server.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.once("close", () => resolve());
    }),
    sleep(10_000).then(() => undefined),
  ]);
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const allowedActionOrigin = "https://chatgpt-actions.test";
  const disallowedOrigin = "https://evil-origin.test";
  const importApiKey = "mim1-test-key";

  const server = spawn("npm", ["run", "dev:server"], {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      ALLOWED_ORIGINS: `${baseUrl},http://127.0.0.1:5174`,
      MEALSCOUT_ALLOWED_ACTION_ORIGINS: allowedActionOrigin,
      MEALSCOUT_IMPORT_API_KEY: importApiKey,
    },
  });

  try {
    await waitForHttp(`${baseUrl}/api/auth/user`);

    const allowedRes = await fetch(`${baseUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: allowedActionOrigin,
        Referer: `${allowedActionOrigin}/`,
        "X-API-Key": importApiKey,
      },
      body: JSON.stringify({
        truckName: "Allowlist Probe Truck",
        cityArea: "Pensacola, FL",
      }),
    });
    assert(
      allowedRes.status === 202,
      `Allowed action origin should reach preview endpoint with 202, got ${allowedRes.status}`,
    );
    const allowedBody: any = await allowedRes.json();
    assert(allowedBody?.draft, "Preview response should include draft");

    const draftRes = await fetch(`${baseUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: allowedActionOrigin,
        Referer: `${allowedActionOrigin}/`,
        "X-API-Key": importApiKey,
      },
      body: JSON.stringify({
        truckName: "Test Truck",
        cityArea: "Pensacola, FL",
        cuisine: "Tacos",
        evidenceFieldProposals: [
          {
            field: "phone",
            proposedValue: "(850) 686-1978",
            confidence: "high",
            source: "screenshot",
            evidenceText: "Call (850) 686-1978",
            imageRef: "screenshot_2",
          },
        ],
      }),
    });
    assert(draftRes.status === 202, `Draft preview should return 202, got ${draftRes.status}`);
    const draftBody: any = await draftRes.json();
    assert(draftBody?.draft?.truckName === "Test Truck", "Draft truckName mismatch");
    assert(draftBody?.draft?.cityArea === "Pensacola, FL", "Draft cityArea mismatch");
    assert(draftBody?.draft?.cuisine === "Tacos", "Draft cuisine mismatch");
    assert(Array.isArray(draftBody?.draft?.menu), "Draft menu should be an array");
    assert(draftBody.draft.menu.length === 0, "Draft menu should stay empty when not provided");
    assert(
      Array.isArray(draftBody?.draft?.reviewStatus?.deferred) &&
        draftBody.draft.reviewStatus.deferred.includes("menu"),
      "Draft reviewStatus should defer menu when missing",
    );
    assert(
      draftBody?.draft?.reviewStatus?.publishBlocked === false,
      "Draft publishBlocked should be false",
    );
    assert(
      Array.isArray(draftBody?.evidenceFieldProposals) &&
        draftBody.evidenceFieldProposals.length === 1,
      "Evidence field proposals should be preserved",
    );
    assert(
      draftBody.evidenceFieldProposals[0].field === "phone",
      "Evidence proposal field mismatch",
    );
    assert(
      draftBody.evidenceFieldProposals[0].proposedValue === "(850) 686-1978",
      "Evidence proposal value mismatch",
    );

    const blockedRes = await fetch(`${baseUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: disallowedOrigin,
        Referer: `${disallowedOrigin}/`,
        "X-API-Key": importApiKey,
      },
      body: JSON.stringify({ test: true }),
    });
    assert(
      blockedRes.status === 403,
      `Disallowed origin should be rejected with 403, got ${blockedRes.status}`,
    );
    const blockedBody = await blockedRes.json().catch(() => ({}));
    assert(
      String(blockedBody?.message || "").toLowerCase().includes("invalid origin"),
      "Disallowed origin should return Invalid origin message",
    );

    const commitAllowedRes = await fetch(`${baseUrl}/api/import/commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: allowedActionOrigin,
        Referer: `${allowedActionOrigin}/`,
        "X-API-Key": importApiKey,
      },
      body: JSON.stringify({ commit: true }),
    });
    assert(
      commitAllowedRes.status === 501,
      `Allowed action origin should reach commit endpoint and return 501, got ${commitAllowedRes.status}`,
    );

    console.log("import-origin-allowlist.contract: PASS");
  } finally {
    await stopServer(server);
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "import-origin-allowlist.contract: FAIL",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
