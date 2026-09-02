#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const live = process.argv.includes("--live");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  ["Repository structure", "doctor"],
  ["Dependency and package-manager policy", "test:dependency-policy"],
  ["Repository hygiene", "test:repository-hygiene"],
  ["Canonical route ownership", "test:route-ownership"],
  ["Release-gate wiring", "test:release-gate"],
  ["Request-log privacy", "test:request-log-privacy"],
  ["TradeScout SSO policy", "test:tradescout-sso-policy"],
  ["Affiliate redirect policy", "test:affiliate-redirect-policy"],
  ["Verification enumeration boundary", "test:verification-status-privacy"],
  ["Website-import SSRF boundary", "test:website-import-ssrf"],
  ["Story-upload ingress policy", "test:story-upload-ingress"],
  ["Email HTML safety", "test:email-html-safety"],
  ["Migration deploy contract", "test:render-migration-gate"],
  ["Stripe webhook safety", "test:stripe-webhook-safety"],
  ["Staff authorization guardrails", "test:staff-rbac-guardrails"],
  ["Public-data boundary", "test:public-data-boundary"],
  ["Ordering truth contracts", "test:ordering-truth"],
  ["TypeScript", "check"],
  ["Lint", "lint"],
  ["Production build", "build"],
  ["Mobile readiness", "check:mobile-readiness"],
  ["Store readiness", "check:store-readiness", { STRICT_STORE_METADATA: "true" }],
];

if (live) {
  steps.push([
    "Strict read-only production probes",
    "gate:production",
    {
      NODE_ENV: "production",
      PROD_GATE_STRICT_ENV: "true",
      SKIP_LIVE_PROBES: "false",
    },
  ]);
}

const startedAt = Date.now();

for (const [label, script, extraEnv = {}] of steps) {
  console.log(`\n[release-gate] ${label}`);
  const result = spawnSync(npmCommand, ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`[release-gate] Unable to run ${script}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[release-gate] FAILED at ${label} (exit ${result.status ?? 1}).`);
    process.exit(result.status ?? 1);
  }
}

const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
const scope = live ? "deterministic checks and production probes" : "deterministic checks";
console.log(`\n[release-gate] PASS: ${scope} completed in ${elapsedSeconds}s.`);
