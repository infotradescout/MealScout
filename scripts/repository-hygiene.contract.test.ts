import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const gitignore = readFileSync(".gitignore", "utf8");

const prohibitedTrackedPathPatterns = [
  /^\.local\//,
  /^logs\//,
  /^attached_assets\//,
  /^audit_snapshot\//,
  /^evidence\//,
  /^test-results\//,
  /^tmp[-_]/,
  /^ts-out\.txt$/,
  /^batch\.json$/,
  /^decisions\.json$/,
  /^mealscout_bulk_truck_ingest_report_.*\.json$/,
  /^mealscout_conflict_resolver_report_.*\.json$/,
  /^mealscout_needs_review_.*\.json$/,
  /^MealScout_businesses_needing_review_.*\.txt$/,
  /^api_raw_call_.*\.(json|txt)$/,
  /^scripts\/tmp-/,
  /\.(err|out)\.log$/,
];

test("machine-local and operator data are not versioned", () => {
  const prohibited = trackedFiles.filter((path) =>
    prohibitedTrackedPathPatterns.some((pattern) => pattern.test(path)),
  );
  assert.deepEqual(prohibited, []);
});

test("large generated blobs cannot silently return", () => {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--format=%(objectsize)\t%(path)"],
    { encoding: "utf8" },
  );
  const oversized = output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [size, ...pathParts] = entry.split("\t");
      return { size: Number(size), path: pathParts.join("\t") };
    })
    .filter(({ size }) => size > 5 * 1024 * 1024);

  assert.deepEqual(oversized, []);
});

test("ignore rules protect local state and operator outputs", () => {
  for (const requiredRule of [
    ".local/",
    "/attached_assets/",
    "/batch.json",
    "/decisions.json",
    "/mealscout_bulk_truck_ingest_report_*.json",
    "/mealscout_conflict_resolver_report_*.json",
    "/scripts/tmp-*",
  ]) {
    assert.ok(gitignore.includes(requiredRule), `Missing ignore rule: ${requiredRule}`);
  }
});

test("tracked text files contain no credential-shaped values", () => {
  const secretPattern = [
    "sk_(live|test)_[[:alnum:]]{16,}",
    "pk_(live|test)_[[:alnum:]]{16,}",
    "AKIA[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "-----BEGIN ([A-Z ]+)?PRIVATE KEY-----",
  ].join("|");
  const result = spawnSync(
    "git",
    [
      "grep",
      "-IlE",
      secretPattern,
      "--",
      ":!*.png",
      ":!*.jpg",
      ":!*.jpeg",
      ":!*.webp",
      ":!*.bin",
    ],
    { encoding: "utf8" },
  );

  assert.ok(
    result.status === 0 || result.status === 1,
    result.stderr || "git grep failed unexpectedly",
  );
  assert.deepEqual(
    String(result.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean),
    [],
    "Tracked files must not contain credential-shaped values",
  );
});
