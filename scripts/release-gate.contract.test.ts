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
    "node scripts/releaseGate.mjs --browser --live",
  );
  assert.equal(
    packageJson.scripts?.["gate:release:browser"],
    "node scripts/releaseGate.mjs --browser",
  );

  for (const requiredScript of [
    "test:dependency-policy",
    "test:repository-hygiene",
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
    "test:consumer-entity-foundation",
    "test:scout-fallback",
    "test:scout-discovery-result",
    "test:scout-result-view-model",
    "test:map-truth",
    "test:profile-action-policy",
    "test:business-type-taxonomy",
    "test:business-signup-attachment",
    "test:food-truck-signup-funnel",
    "test:truck-availability-truth",
    "test:profile-completion-truth",
    "test:profile-evidence-owner-review",
    "test:public-data-boundary",
    "test:public-seo-landing",
    "test:frozen-cleanup-safety",
    "test:quick-review-score-validation",
    "test:quick-review-idempotency",
    "test:recommend-photo-only-proof",
    "test:manual-asset-intake",
    "test:leaflet-removal",
    "test:event-date-normalization",
    "test:action-availability",
    "test:post-merge-safety",
    "test:about-explainer",
    "test:3d-eats-frui-tea-sauce",
    "test:3d-eats-admin-verified-profile",
    "test:curated-profile-cohort-baseline",
    "test:runtime-safety-contracts",
    "test:ordering-truth",
    "test:flows:e2e:no-creds",
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
