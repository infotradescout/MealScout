import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const gitignore = readFileSync(".gitignore", "utf8");

assert.match(
  String(packageJson.packageManager || ""),
  /^npm@/,
  "MealScout must declare npm as its one package manager.",
);
assert.equal(
  existsSync("pnpm-lock.yaml"),
  false,
  "A stale secondary lockfile can restore dependencies removed from the npm build.",
);

for (const generatedHistoryPath of [
  "api_raw_call_categorized.json",
  "api_raw_call_drift_report.json",
  "api_raw_call_scan.txt",
  "api_raw_fetch_calls.txt",
  "audit_snapshot",
  "artifacts/scout-mobile-thirds-hotfix",
]) {
  assert.equal(
    existsSync(generatedHistoryPath),
    false,
    `Stale generated history must not remain in the working source tree: ${generatedHistoryPath}`,
  );
}

for (const ignoreRule of [
  "api_raw_call_*.json",
  "api_raw_call_*.txt",
  "api_raw_fetch_calls.txt",
  "audit_snapshot/",
  "artifacts/scout-mobile-thirds-hotfix/",
]) {
  assert.ok(
    gitignore.includes(ignoreRule),
    `Generated-history ignore rule missing: ${ignoreRule}`,
  );
}

console.log("repository-regression-history-guard.contract: PASS");
