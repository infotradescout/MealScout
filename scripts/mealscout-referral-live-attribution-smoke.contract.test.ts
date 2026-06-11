import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(
  "scripts/mealscout-referral-live-attribution-smoke.ts",
  "utf8",
);

for (const snippet of [
  '"live_referral_smoke_complete"',
  '"live_referral_smoke_blocked"',
  '"live_referral_smoke_failed"',
]) {
  assert(runner.includes(snippet), `Runner must include status ${snippet}`);
}

for (const required of [
  "REFERRAL_LIVE_SMOKE_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_EMAIL",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_PASSWORD",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_TAG",
  "REFERRAL_LIVE_SMOKE_TARGET_EMAIL",
  "REFERRAL_LIVE_SMOKE_TARGET_PASSWORD",
  "REFERRAL_LIVE_SMOKE_ADMIN_EMAIL",
  "REFERRAL_LIVE_SMOKE_ADMIN_PASSWORD",
]) {
  assert(runner.includes(`"${required}"`), `Missing required env gate: ${required}`);
}

for (const optional of [
  "REFERRAL_LIVE_SMOKE_ALLOW_ATTRIBUTION_WRITE",
  "REFERRAL_LIVE_SMOKE_SIGNUP_EMAIL",
  "REFERRAL_LIVE_SMOKE_SIGNUP_FIRST_NAME",
  "REFERRAL_LIVE_SMOKE_SIGNUP_LAST_NAME",
  "REFERRAL_LIVE_SMOKE_SIGNUP_PHONE",
  "REFERRAL_LIVE_SMOKE_SIGNUP_PASSWORD",
  "REFERRAL_LIVE_SMOKE_SIGNUP_OTP_CODE",
  "REFERRAL_LIVE_SMOKE_TARGET_PATH",
  "REFERRAL_LIVE_SMOKE_EVIDENCE_DIR",
  "REFERRAL_LIVE_SMOKE_RUN_ID",
]) {
  assert(runner.includes(`"${optional}"`), `Missing optional env support: ${optional}`);
}

assert(
  runner.includes("function requirePreflight") &&
    runner.includes("set REFERRAL_LIVE_SMOKE_ENABLED=true") &&
    runner.includes("missing required env vars"),
  "Runner must fail-closed with explicit enable + required env validation.",
);

assert(
  runner.includes("const ALLOWED_POST_ENDPOINTS =") &&
    runner.includes('"/api/auth/login"') &&
    runner.includes('"/api/share/generate"') &&
    runner.includes('"/api/auth/customer/register"') &&
    runner.includes("FORBIDDEN_MUTATION_METHODS") &&
    runner.includes("Unexpected live smoke POST endpoint"),
  "Runner must enforce strict endpoint/method allowlist.",
);

assert(
  runner.includes("parseCanonicalGeneratedLink") &&
    runner.includes('const forbidden = ["role=business", "to=", "%2F", "/ref/"]') &&
    runner.includes("Generated referral link contains forbidden fragment"),
  "Runner must reject forbidden generated fragments.",
);

for (const flowSnippet of [
  '"/api/share/generate"',
  "clickLegacyCapture",
  'const legacyUrl = `${baseUrl}/ref/${encodeURIComponent(tag)}?to=${encodeURIComponent(targetPath)}`',
  'new URL(capture.location, "https://www.mealscout.us")',
  '"/api/auth/login"',
  '"/api/auth/user"',
  '"/api/admin/affiliates/users"',
  "customerSignup",
  '"/api/auth/customer/register"',
]) {
  assert(
    runner.includes(flowSnippet),
    `Runner must include runtime attribution flow step: ${flowSnippet}`,
  );
}

assert(
  runner.includes("target session established after referral handoff") &&
    runner.includes("signup attribution handoff path") &&
    runner.includes("persistence-layer affiliate attribution"),
  "Runner must check handoff and persistence outcomes.",
);

assert(
  !runner.includes('method: "PUT"') &&
    !runner.includes('method: "PATCH"') &&
    !runner.includes('method: "DELETE"'),
  "Runner must not send broad mutation methods.",
);

console.log("mealscout-referral-live-attribution-smoke.contract: PASS");
