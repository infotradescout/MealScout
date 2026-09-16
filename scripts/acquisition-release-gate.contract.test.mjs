/**
 * Executes the real release runner against isolated child-command fixtures.
 * This proves gate order/failure propagation, not full application readiness.
 * Run: node --test scripts/acquisition-release-gate.contract.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gatePath = process.env.ACQUISITION_RELEASE_GATE_SOURCE ||
  fileURLToPath(new URL("./releaseReadinessCheck.mjs", import.meta.url));
const gateSource = readFileSync(gatePath, "utf8");
const expectedCommands = [
  "run check", "run check:mobile-readiness", "run check:store-readiness",
  "run cap:prepare", "run smoke:mobile-deeplinks:with-server",
];

function exercise({ routingExit = 0, npmExit = 0, omitRouting = false, omitBootstrap = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mealscout-release-gate-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "bin"));
    writeFileSync(path.join(root, "scripts/releaseReadinessCheck.mjs"), gateSource);
    const logPath = path.join(root, "commands.jsonl");
    if (!omitBootstrap) {
      writeFileSync(path.join(root, "scripts/request-logging-degraded-mode.contract.test.mjs"),
        'import { test } from "node:test"; test("isolated request logging fixture", () => {});\n');
    }
    if (!omitRouting) {
      writeFileSync(path.join(root, "scripts/acquisition-edge-routing.contract.test.mjs"), `
import { appendFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
appendFileSync(process.env.GATE_TEST_LOG, JSON.stringify({ kind: "routing" }) + "\\n");
test("isolated routing fixture", () => assert.equal(${routingExit}, 0));
`);
    }
    const npmSource = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.GATE_TEST_LOG, JSON.stringify({
  kind: "npm", args: process.argv.slice(2), strict: process.env.STRICT_STORE_METADATA || null,
}) + "\\n");
process.exit(${npmExit});
`;
    const npmCli = path.join(root, "npm-stub.mjs");
    writeFileSync(npmCli, npmSource);
    const npmBin = path.join(root, "bin/npm");
    writeFileSync(npmBin, `#!${process.execPath}\n${npmSource}`);
    chmodSync(npmBin, 0o755);
    writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (["path", "node_options", "strict_store_metadata"].includes(key.toLowerCase()) ||
          key.toLowerCase().startsWith("node_test_")) delete env[key];
    }
    env.PATH = `${path.join(root, "bin")}${path.delimiter}${process.env.PATH || process.env.Path || ""}`;
    env.npm_execpath = npmCli;
    env.GATE_TEST_LOG = logPath;
    const result = spawnSync(process.execPath, ["scripts/releaseReadinessCheck.mjs"], {
      cwd: root, env, encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      commands: existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a failing acquisition contract stops release before any existing command", () => {
  const result = exercise({ routingExit: 17 });
  assert.equal(result.status, 1);
  assert.deepEqual(result.commands, [{ kind: "routing" }]);
  assert.match(result.output, /FAILED: Acquisition crawler edge routing/);
  assert.doesNotMatch(result.output, /All checks passed/);
});

test("a missing acquisition contract cannot silently pass", () => {
  const result = exercise({ omitRouting: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.commands, []);
  assert.match(result.output, /FAILED: Acquisition crawler edge routing/);
});

test("existing release failures still stop execution and retain their exit code", () => {
  const result = exercise({ npmExit: 23 });
  assert.equal(result.status, 23);
  assert.deepEqual(result.commands, [
    { kind: "routing" }, { kind: "npm", args: ["run", "check"], strict: null },
  ]);
  assert.match(result.output, /FAILED: Typecheck \(exit 23\)/);
});

test("routing runs first and all five existing steps and strict metadata are preserved", () => {
  const result = exercise();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.commands[0], { kind: "routing" });
  const npm = result.commands.slice(1);
  assert.deepEqual(npm.map((entry) => entry.args.join(" ")), expectedCommands);
  assert.equal(npm[2].strict, "true");
  assert.ok(npm.filter((_, index) => index !== 2).every((entry) => entry.strict === null));
  assert.match(result.output, /All checks passed/);
});


test("a missing request-logging contract cannot silently pass release readiness", () => {
  const result = exercise({ omitBootstrap: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.commands.filter((entry) => entry.kind === "npm").length, 0);
  assert.match(result.output, /FAILED: Acquisition crawler edge routing/);
  assert.doesNotMatch(result.output, /All checks passed/);
});
