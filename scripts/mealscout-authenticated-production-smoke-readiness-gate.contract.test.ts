import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_READINESS_GATE.md",
  "MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md",
  "MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md",
  "MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md",
  "docs/PROD_ROLLOUT_CHECKLIST.md",
  "scripts/productionReadinessGate.mjs",
  "scripts/preLaunchGate.mjs",
  "scripts/smokeOrderingProfileAccess.mjs",
  "scripts/smokeParkingPassStripeFlow.ts",
  "scripts/testParkingPassWebhookReplay.ts",
  "scripts/testAdminManualProvisioning.ts",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`P1 authenticated production smoke readiness gate missing required file: ${file}`);
  }
}

const read = (path: string) => readFileSync(path, "utf8");
const artifact = read("MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_READINESS_GATE.md");
const rolloutChecklist = read("docs/PROD_ROLLOUT_CHECKLIST.md");
const productionGate = read("scripts/productionReadinessGate.mjs");
const ownerSmoke = read("scripts/smokeOrderingProfileAccess.mjs");
const parkingPassSmoke = read("scripts/smokeParkingPassStripeFlow.ts");
const adminSmoke = read("scripts/testAdminManualProvisioning.ts");

function requireIncludes(source: string, snippet: string, label: string) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing P1 readiness snippet (${label}): ${snippet}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing P1 readiness pattern: ${label}`);
  }
}

[
  "# MealScout Authenticated Production Smoke Readiness Gate",
  "Status: `BLOCKED`",
  "## Production Smoke Account Requirements",
  "## Required Env Vars/Secrets",
  "## Current Blockers",
  "## Safe Fixture Naming/Isolation Rules",
  "## Customer Smoke Evidence Requirements",
  "## Owner/Business Smoke Evidence Requirements",
  "## Admin/Staff Smoke Evidence Requirements",
  "## Notification Isolation Requirements",
  "## Payment No-Op Requirements",
  "## Reset/Cleanup Dry-Run Requirements",
  "## Gate Decision",
].forEach((snippet) => requireIncludes(artifact, snippet, `required section ${snippet}`));

[
  "No approved production smoke account set confirmed.",
  "No first-class fixture quarantine that reliably excludes smoke businesses from public discovery/maps/search.",
  "No central notification sink/allowlist for email, SMS, social, drip, or webhook-triggered sends.",
  "No approved payment no-op enclosure for live production.",
  "No idempotent reset runner with dry-run and smoke-marker enforcement.",
  "Existing admin provisioning smoke creates users, so it is not production-safe as-is.",
].forEach((snippet) => requireIncludes(artifact, snippet, `known blocker ${snippet}`));

[
  "Live authenticated production smoke is forbidden without approved smoke accounts.",
  "External notifications are forbidden during authenticated production smoke",
  "No live customer emails are sent.",
  "Real payment, payout, and banking impact is forbidden during authenticated production smoke.",
  "No real merchant payout impact occurs.",
  "No real banking rails are touched.",
  "Reset has a dry-run mode.",
  "dry-run output lists every row or provider object it would touch",
  "No successful authenticated production smoke evidence is claimed or fabricated",
  "contains no successful smoke result, no fabricated smoke evidence",
].forEach((snippet) => requireIncludes(artifact, snippet, `safety rule ${snippet}`));

[
  "MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md",
  "MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md",
  "MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md",
  "scripts/productionReadinessGate.mjs",
  "scripts/smokeOrderingProfileAccess.mjs",
  "scripts/smokeParkingPassStripeFlow.ts",
  "scripts/testParkingPassWebhookReplay.ts",
  "scripts/testAdminManualProvisioning.ts",
  "docs/PROD_ROLLOUT_CHECKLIST.md",
].forEach((snippet) => requireIncludes(artifact, snippet, `review input ${snippet}`));

[
  "ORDERING_OWNER_COOKIE",
  "ORDERING_OWNER_EMAIL",
  "ORDERING_OWNER_PASSWORD",
  "ORDERING_OWNED_RESTAURANT_ID",
  "ORDERING_UNOWNED_RESTAURANT_ID",
  "ADMIN_SMOKE_EMAIL",
  "ADMIN_SMOKE_PASSWORD",
  "TEST_PARKING_PASS_ID",
  "TEST_TRUCK_AUTH_COOKIE",
  "STRIPE_WEBHOOK_SECRET",
  "BREVO_API_KEY",
].forEach((snippet) => requireIncludes(artifact, snippet, `env var ${snippet}`));

requireMatch(
  artifact,
  /Decision: `BLOCKED`[\s\S]*must not run until all six known blockers are cleared/,
  "blocked gate decision",
);

requireIncludes(rolloutChecklist, "Authenticated production smoke is blocked", "rollout checklist P1 block");
requireIncludes(
  rolloutChecklist,
  "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_READINESS_GATE.md",
  "rollout checklist P1 artifact",
);

[
  "live probe is read-only",
  "mutableMethods",
  "STRIPE_WEBHOOK_SECRET",
  "BREVO_API_KEY",
].forEach((snippet) => requireIncludes(productionGate, snippet, `production gate ${snippet}`));

[
  "ORDERING_OWNER_COOKIE",
  "ORDERING_OWNER_EMAIL",
  "ORDERING_OWNER_PASSWORD",
].forEach((snippet) => requireIncludes(ownerSmoke, snippet, `owner smoke ${snippet}`));

[
  "TEST_PARKING_PASS_ID",
  "TEST_TRUCK_AUTH_COOKIE",
  "/api/parking-pass/",
  "CANCEL_PENDING_AFTER_CHECK",
].forEach((snippet) => requireIncludes(parkingPassSmoke, snippet, `payment smoke ${snippet}`));

[
  "ADMIN_SMOKE_EMAIL",
  "ADMIN_SMOKE_PASSWORD",
  "/api/admin/users/create",
  "smoke-host-created",
].forEach((snippet) => requireIncludes(adminSmoke, snippet, `admin smoke ${snippet}`));

const forbiddenSuccessfulEvidencePatterns = [
  /Authenticated production smoke passed/i,
  /Customer smoke passed/i,
  /Owner\/business smoke passed/i,
  /Admin\/staff smoke passed/i,
  /external send count is [1-9]/i,
  /live charge created/i,
  /real payout created/i,
];

for (const pattern of forbiddenSuccessfulEvidencePatterns) {
  if (pattern.test(artifact)) {
    throw new Error(`P1 artifact appears to fabricate successful smoke evidence: ${pattern}`);
  }
}

console.log("mealscout-authenticated-production-smoke-readiness-gate.contract: PASS");
