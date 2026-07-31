import { existsSync, readFileSync } from "node:fs";

const docPath = "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P3_RUNNER.md";
const runnerPath = "scripts/mealscout-authenticated-production-smoke.ts";
const checklistPath = "docs/PROD_ROLLOUT_CHECKLIST.md";

for (const file of [docPath, runnerPath, checklistPath]) {
  if (!existsSync(file)) {
    throw new Error(`Missing P3 authenticated smoke runner file: ${file}`);
  }
}

const doc = readFileSync(docPath, "utf8");
const runner = readFileSync(runnerPath, "utf8");
const checklist = readFileSync(checklistPath, "utf8");

function requireIncludes(source: string, snippet: string, label: string) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing P3 snippet (${label}): ${snippet}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing P3 pattern: ${label}`);
  }
}

[
  "# MealScout Authenticated Production Smoke P3 Runner",
  "Status: `SCAFFOLDED_BLOCKED_UNTIL_EXPLICIT_ENABLE`",
  "## Purpose",
  "## Required Env Vars",
  "## Fail-Closed Execution Rule",
  "## Credential Redaction Rule",
  "## Evidence Output Location",
  "## Customer Smoke Scope",
  "## Owner Smoke Scope",
  "## Staff/Admin Smoke Scope",
  "## Forbidden Mutations",
  "## Pass Evidence Criteria",
  "## Fail Evidence Criteria",
  "## Gate Decision",
].forEach((snippet) => requireIncludes(doc, snippet, `doc section ${snippet}`));

const requiredEnvNames = [
  "PROD_AUTH_SMOKE_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "SMOKE_CUSTOMER_EMAIL",
  "SMOKE_CUSTOMER_PASSWORD",
  "SMOKE_OWNER_EMAIL",
  "SMOKE_OWNER_PASSWORD",
  "SMOKE_OWNER_OWNED_FIXTURE_ID",
  "SMOKE_OWNER_UNOWNED_FIXTURE_ID",
  "SMOKE_ADMIN_EMAIL",
  "SMOKE_ADMIN_PASSWORD",
];

for (const name of requiredEnvNames) {
  requireIncludes(doc, name, `documented env ${name}`);
  requireIncludes(runner, `"${name}"`, `runner checked env ${name}`);
}

for (const name of ["READONLY_DATABASE_URL", "SMOKE_EVIDENCE_DIR", "SMOKE_RUN_ID"]) {
  requireIncludes(doc, name, `documented optional env ${name}`);
  requireIncludes(runner, `"${name}"`, `runner optional env ${name}`);
}

[
  "PROD_AUTH_SMOKE_ENABLED=true",
  "runner must stop before login and before any production network call",
  "must never print or write",
  "Default evidence directory",
  "artifacts/production-smoke/authenticated/",
  "Customer smoke must not create bookings",
  "Owner smoke must not edit profiles",
  "Staff/admin smoke must not create users",
  "must not issue `POST`, `PUT`, `PATCH`, or `DELETE` requests except the approved login/session request",
  "Decision: `SCAFFOLDED_BLOCKED`",
].forEach((snippet) => requireIncludes(doc, snippet, `doc safety rule ${snippet}`));

requireMatch(
  runner,
  /function requirePreflight\(\)[\s\S]*if \(!isEnabled\(\)\)[\s\S]*PROD_AUTH_SMOKE_ENABLED=true[\s\S]*const missing = REQUIRED_ENV\.filter[\s\S]*missing\.length > 0/,
  "runner fail-closed preflight before network",
);
requireMatch(
  runner,
  /async function main\(\)[\s\S]*requirePreflight\(\);[\s\S]*const runId/s,
  "main calls preflight before run setup/network",
);
requireMatch(
  runner,
  /const SECRET_VALUE_PATTERNS = \[[\s\S]*connect\\.sid[\s\S]*Bearer[\s\S]*whsec_[\s\S]*postgres/s,
  "secret value redaction patterns",
);
requireMatch(
  runner,
  /const SENSITIVE_KEY_PATTERN =[\s\S]*password[\s\S]*cookie[\s\S]*token[\s\S]*secret[\s\S]*session/s,
  "sensitive key redaction pattern",
);
requireIncludes(runner, "function redact(value: unknown): unknown", "redact function");
requireIncludes(runner, "JSON.stringify(redact(evidence), null, 2)", "redacted evidence write");
requireIncludes(runner, "safeError(error)", "redacted errors");
requireIncludes(runner, "dryMutationPolicy: \"no_mutation_except_login\"", "no mutation policy");

[
  "role: \"customer\"",
  "role: \"owner\"",
  "role: \"staff_admin\"",
  "customer session read",
  "owner restaurants read",
  "owner owned fixture kitchen queue read",
  "owner unowned fixture kitchen queue negative check",
  "staff/admin launch board read",
].forEach((snippet) => requireIncludes(runner, snippet, `role/check section ${snippet}`));

[
  "/api/auth/login",
  "/api/auth/user",
  "/api/restaurants/my",
  "/api/owner/kitchen-queue/",
  "/api/owner/orders/",
  "/api/admin/launch-board",
].forEach((snippet) => requireIncludes(runner, snippet, `allowed route ${snippet}`));

const forbiddenRunnerSnippets = [
  "method: \"PUT\"",
  "method: \"PATCH\"",
  "method: \"DELETE\"",
  "/api/admin/users/create",
  "/api/staff/users",
  "/api/auth/customer/register",
  "/api/auth/restaurant/register",
  "/api/restaurants/signup",
  "sendEmail",
  "sendAccountSetupInvite",
  "STRIPE_SECRET_KEY",
];

for (const snippet of forbiddenRunnerSnippets) {
  if (runner.includes(snippet)) {
    throw new Error(`P3 runner includes forbidden mutation/secret snippet: ${snippet}`);
  }
}

requireIncludes(
  checklist,
  "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P3_RUNNER.md",
  "rollout checklist references P3 doc",
);
requireIncludes(
  checklist,
  "scripts/mealscout-authenticated-production-smoke.ts",
  "rollout checklist references P3 runner",
);
requireIncludes(
  checklist,
  "Do not run the P3 authenticated smoke runner until",
  "rollout checklist blocks live authenticated smoke before P3",
);
requireIncludes(
  checklist,
  "PROD_AUTH_SMOKE_ENABLED=true",
  "rollout checklist explicit enable",
);

const forbiddenCredentialEvidencePatterns = [
  /PROD_AUTH_SMOKE_ENABLED=true\s+[\w!@#$%^&*()+=-]{8,}/i,
  /SMOKE_(?:CUSTOMER|OWNER|ADMIN)_PASSWORD\s*[:=]\s*[^`\s<>{}]+/i,
  /COOKIE\s*[:=]\s*[^`\s<>{}]+/i,
  /postgres(?:ql)?:\/\/[^`\s<>{}]+/i,
  /\bwhsec_[A-Za-z0-9]{12,}\b/i,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/i,
];

for (const [label, source] of [
  ["P3 doc", doc],
  ["rollout checklist", checklist],
] as const) {
  for (const pattern of forbiddenCredentialEvidencePatterns) {
    if (pattern.test(source)) {
      throw new Error(`${label} appears to contain committed credential material: ${pattern}`);
    }
  }
}

console.log("mealscout-authenticated-production-smoke-runner.contract: PASS");
