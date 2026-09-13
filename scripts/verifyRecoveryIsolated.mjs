import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRecoveryBrowserLibraries } from "./recoveryBrowserLibraries.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(root);
const reportDir = resolve("test-results/recovery-isolated-report");
mkdirSync(reportDir, { recursive: true });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const report = {
  schemaVersion: 1,
  commit: git("rev-parse", "HEAD"),
  tree: git("rev-parse", "HEAD^{tree}"),
  scope: "Disposable PostgreSQL 16, intercepted provider fixture, credential-free browser matrix; no production acceptance",
  result: "running",
  startedAt: new Date().toISOString(),
  steps: [],
};
let server;
// Child processes receive only platform tooling variables and explicitly synthetic test values.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(key)));
Object.assign(env, { CI: "true", TZ: "UTC", MEALSCOUT_ISOLATED_RECOVERY_PROOF: "1", VITE_STRIPE_PUBLIC_KEY: "pk_test_ordering_truth_fixture" });
async function run(name, command, args, extraEnv = {}, workingDirectory = root) {
  const step = { name, result: "running", startedAt: new Date().toISOString() };
  report.steps.push(step);
  console.log(`RECOVERY_STEP_START ${name}`);
  try {
    await new Promise((done, reject) => {
      const child = spawn(command, args, { cwd: workingDirectory, env: { ...env, ...extraEnv }, stdio: "inherit", timeout: 1_800_000 });
      child.once("error", reject);
      child.once("close", code => code === 0 ? done() : reject(new Error(`${name} exited ${code}`)));
    });
    step.result = "pass";
  } catch (error) {
    step.result = "fail";
    throw error;
  } finally {
    step.finishedAt = new Date().toISOString();
    console.log(`RECOVERY_STEP_END ${name} ${step.result}`);
  }
}
try {
  assert.equal(process.env.MEALSCOUT_ISOLATED_RECOVERY_PROOF, "1", "Explicit isolated-proof mode is required");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.notEqual(process.getuid?.(), 0, "Native PostgreSQL requires a non-root build runtime");
  assert.match(process.env.RENDER_GIT_COMMIT || "", /^[a-f0-9]{40}$/, "Expected deployed source SHA is required");
  assert.equal(report.commit, process.env.RENDER_GIT_COMMIT, "Deployed source must match exact HEAD");
  assert.equal(git("status", "--porcelain"), "", "Proof starts from a clean committed source");
  for (const [key, value] of Object.entries(process.env)) {
    if (/DATABASE_URL|^PG|STRIPE.*(KEY|SECRET)|BREVO|SENDGRID|SMTP|RESEND|TWILIO|OPENAI_API_KEY|ANTHROPIC_API_KEY|SESSION_SECRET|OWNER_PASSWORD/.test(key)) {
      assert.ok(!value, `Forbidden ambient service credential/configuration: ${key}`);
    }
  }
  for (const directory of [root, resolve("client"), resolve("server")]) {
    const inertTemplates = directory === root ? [".env.example", ".env.production.example"] : [];
    assert.ok(!readdirSync(directory).some(name => /^\.env(?:\.|$)/.test(name) && !inertTemplates.includes(name)), `No loadable environment files may exist in ${directory}`);
  }
  const tooling = mkdtempSync(join(tmpdir(), "mealscout-proof-tools-"));
  env.PLAYWRIGHT_BROWSERS_PATH = join(tooling, "browsers");
  await run("canonical-npm-ci", "npm", ["ci", "--include=dev", "--no-audit", "--no-fund"]);
  await run("typecheck", "npm", ["run", "check"]);
  await run("production-build", "npm", ["run", "build:platform"]);
  for (const script of ["test:parking-schedule-calendar", "test:critical-smoke", "test:ordering-truth", "test:integrated-marketplace", "test:stripe-webhook-safety", "test:menu-lisa"]) {
    await run(script, "npm", ["run", script]);
  }
  // The npm server-only distribution omits psql and dump/restore. Build the
  // complete upstream release in an owned prefix; never install system packages.
  const archive = join(tooling, "postgresql-16.14.tar.gz");
  await run("postgres16-source-download", "curl", ["--fail", "--location", "--retry", "2", "--max-time", "120", "--output", archive, "https://ftp.postgresql.org/pub/source/v16.14/postgresql-16.14.tar.gz"]);
  const sourceSha256 = "ca18d43510bbb09a271383e1aa705b05b76bc8e9400f9857178ba8ec54cf461a";
  assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), sourceSha256, "Upstream PostgreSQL source checksum must match");
  report.postgresTooling = { version: "16.14", sourceSha256 };
  await run("postgres16-source-unpack", "tar", ["--no-same-owner", "-xzf", archive, "-C", tooling]);
  const postgresSource = join(tooling, "postgresql-16.14");
  const postgresPrefix = join(tooling, "postgres16-install");
  await run("postgres16-configure", join(postgresSource, "configure"), [`--prefix=${postgresPrefix}`, "--without-readline", "--without-zlib", "--without-icu", "--with-openssl"], {}, postgresSource);
  await run("postgres16-build", "make", ["-j2"], {}, postgresSource);
  await run("postgres16-owned-install", "make", ["install"], {}, postgresSource);
  await run("postgres16-pgcrypto-install", "make", ["-C", "contrib/pgcrypto", "install"], {}, postgresSource);
  const nativeBin = join(postgresPrefix, "bin");
  const historicalWriter = "6128fbc9539c27d70f937a7ffa1d619bf819c7b3";
  await run("historical-writer-source", "git", ["fetch", "--no-tags", "--depth=1", "https://github.com/infotradescout/MealScout.git", historicalWriter]);
  await run("migration142-native-postgres16", process.execPath, ["--import", "tsx", "scripts/proveMigration142Postgres16.ts", `--native-pg-bin=${nativeBin}`]);
  await run("stateful-marketplace-native-postgres16", process.execPath, ["--import", "tsx", "scripts/recoveryNativePostgres16.mjs", nativeBin]);
  await run("browser-tooling", process.execPath, ["node_modules/playwright/cli.js", "install", "chromium", "firefox", "webkit"]);
  const browserLibraries = await prepareRecoveryBrowserLibraries(tooling, run);
  report.browserLibraries = { packages: browserLibraries.packages, downloaded: browserLibraries.downloaded, systemPackageInstall: false };
  const express = (await import("express")).default;
  const app = express();
  app.use("/api", (_request, response) => response.status(404).json({ error: "Static proof has no application API" }));
  app.use(express.static(resolve("dist/public")));
  app.get("*", (_request, response) => response.sendFile(resolve("dist/public/index.html")));
  server = await new Promise((done, reject) => {
    const owned = app.listen(0, "127.0.0.1", () => done(owned));
    owned.once("error", reject);
  });
  const browserJson = resolve("test-results/recovery-browser.json");
  await run("credential-free-browser-matrix", "npm", ["run", "test:flows:e2e:no-creds", "--", "--reporter=line,json"], {
    FRONTEND_URL: `http://127.0.0.1:${server.address().port}`,
    PLAYWRIGHT_JSON_OUTPUT_FILE: browserJson,
    ...browserLibraries.env,
  });
  const browser = JSON.parse(readFileSync(browserJson, "utf8"));
  assert.equal(browser.stats.unexpected, 0);
  assert.equal(browser.stats.flaky, 0);
  assert.equal(browser.stats.skipped, 0);
  assert.ok(browser.stats.expected > 0);
  report.browser = browser.stats;
  assert.equal(git("rev-parse", "HEAD"), report.commit);
  assert.equal(git("status", "--porcelain"), "", "Checks must preserve the exact committed source");
  report.finalSourceClean = true;
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (server) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  // Playwright clears its test-results directory at startup, including our
  // earlier empty report directory. Recreate it for both pass and fail receipts.
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "summary.json"), `${json}\n`);
  writeFileSync(join(reportDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>MealScout isolated recovery proof</title><h1>MealScout isolated recovery proof</h1><pre>${json.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`);
  console.log(`RECOVERY_PROOF_REPORT ${JSON.stringify(report)}`);
}
