import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const gate = readFileSync("scripts/releaseGate.mjs", "utf8");
const render = readFileSync("render.yaml", "utf8");

test("release commands have one canonical orchestrator", () => {
  assert.equal(
    packageJson.scripts?.["gate:release:local"],
    "node scripts/releaseGate.mjs",
  );
  assert.equal(
    packageJson.scripts?.["gate:release"],
    "node scripts/releaseGate.mjs --live",
  );

  for (const requiredScript of [
    "test:dependency-policy",
    "test:route-ownership",
    "test:request-log-privacy",
    "test:tradescout-sso-policy",
    "test:affiliate-redirect-policy",
    "test:verification-status-privacy",
    "test:website-import-ssrf",
    "test:story-upload-ingress",
    "test:email-html-safety",
    "test:render-migration-gate",
    "test:stripe-webhook-safety",
    "test:staff-rbac-guardrails",
    "test:public-data-boundary",
    "test:ordering-truth",
    "check",
    "lint",
    "build",
    "check:mobile-readiness",
    "check:store-readiness",
    "gate:production",
  ]) {
    assert.match(gate, new RegExp(`["]${requiredScript.replaceAll(":", "\\:")}["]`));
  }
});

test("Render blocks promotion on the local gate and database readiness", () => {
  assert.match(
    render,
    /buildCommand: npm ci --include=dev && npm run gate:release:local/,
  );
  assert.match(render, /preDeployCommand: npm run migrate:deploy/);
  assert.match(render, /healthCheckPath: \/health\/ready/);
});

test("GitHub Actions is not a competing release authority", () => {
  assert.equal(existsSync(".github/workflows/ci.yml"), false);
});
