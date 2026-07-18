#!/usr/bin/env node
/**
 * preLaunchGate.mjs
 *
 * Pre-launch gate: runs all critical smoke checks in sequence before
 * opening the platform to real users. Exits non-zero if any check fails.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://your-prod-domain.onrender.com npm run gate:prelaunch
 *
 * Optional env vars:
 *   SMOKE_BASE_URL           - Base URL to test against (default: http://127.0.0.1:5000)
 *   STRIPE_SECRET_KEY              - Checked for presence (not used for API calls)
 *   VITE_STRIPE_PUBLIC_KEY         - Checked for presence
 *   STRIPE_WEBHOOK_SECRET          - Checked for presence
 *   BREVO_API_KEY                  - Checked for presence
 *   DATABASE_URL                   - Checked for presence
 *   SESSION_SECRET                 - Checked for presence
 *   GOOGLE_MAPS_API_KEY            - Warned if absent (server-side maps features)
 *   VITE_GOOGLE_MAPS_WEB_API_KEY   - Warned if absent (all in-app map rendering)
 */

import { execSync } from "child_process";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000")
  .trim()
  .replace(/\/$/, "");

let totalFailed = 0;

function section(title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function pass(msg) {
  console.log(`  ✅  ${msg}`);
}

function fail(msg) {
  console.error(`  ❌  ${msg}`);
  totalFailed += 1;
}

function warn(msg) {
  console.warn(`  ⚠️   ${msg}`);
}

// ─────────────────────────────────────────────
// STEP 1: Required environment variables
// ─────────────────────────────────────────────
section("Step 1: Required Environment Variables");

const requiredEnvVars = [
  {
    name: "STRIPE_SECRET_KEY",
    desc: "Backend Stripe API — PaymentIntents and Subscriptions will fail without this.",
  },
  {
    name: "VITE_STRIPE_PUBLIC_KEY",
    desc: "Frontend Stripe Elements — checkout modals will not load without this.",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    desc: "Webhook signature verification — bookings and subscriptions will never activate without this.",
  },
  {
    name: "BREVO_API_KEY",
    desc: "Transactional email — booking confirmations and verification approvals will not send without this.",
  },
  {
    name: "DATABASE_URL",
    desc: "Primary database — application will not start without this.",
  },
  {
    name: "SESSION_SECRET",
    desc: "Session encryption — user logins will fail without this.",
  },
];

for (const { name, desc } of requiredEnvVars) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    fail(`${name} is not set. ${desc}`);
  } else {
    pass(`${name} is set.`);
  }
}

// ─────────────────────────────────────────────
// STEP 1b: Google Maps key warnings (non-blocking)
// ─────────────────────────────────────────────
section("Step 1b: Google Maps API Keys");
const serverMapsKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
const webMapsKey = String(process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || "").trim();
if (!serverMapsKey) {
  warn("GOOGLE_MAPS_API_KEY is not set — geocoding, Places autocomplete, Routes, Address Validation, place intelligence, and area-activity context will be disabled.");
} else {
  pass("GOOGLE_MAPS_API_KEY is set.");
}
if (!webMapsKey) {
  warn("VITE_GOOGLE_MAPS_WEB_API_KEY is not set — all in-app maps will fall back to Leaflet/OpenStreetMap.");
} else {
  pass("VITE_GOOGLE_MAPS_WEB_API_KEY is set.");
}
if (serverMapsKey && webMapsKey && serverMapsKey === webMapsKey) {
  warn("The server and browser Google Maps keys are identical. Use separate API-restricted keys so the server credential is never exposed to clients.");
} else if (serverMapsKey && webMapsKey) {
  pass("Google Maps server and browser keys are separated.");
}

// ─────────────────────────────────────────────
// STEP 2: Bypass flags must be disabled in prod
// ─────────────────────────────────────────────
section("Step 2: Production Safety Flags");

const bypassStripe = String(process.env.MEALSCOUT_BYPASS_STRIPE || "").toLowerCase();
const testMode = String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase();

if (bypassStripe === "true" || bypassStripe === "1") {
  fail("MEALSCOUT_BYPASS_STRIPE is enabled — Stripe payments are bypassed. Disable before launch.");
} else {
  pass("MEALSCOUT_BYPASS_STRIPE is not set (payments active).");
}

if (testMode === "true" || testMode === "1") {
  fail("MEALSCOUT_TEST_MODE is enabled — disable before launch.");
} else {
  pass("MEALSCOUT_TEST_MODE is not set (production mode).");
}

// ─────────────────────────────────────────────
// STEP 3: Critical route smoke test
// ─────────────────────────────────────────────
section("Step 3: Critical Route Smoke Test");
console.log(`  Target: ${baseUrl}\n`);

const criticalChecks = [
  { name: "API health", path: "/api/health", expect: [200] },
  { name: "Readiness", path: "/health/ready", expect: [200] },
  { name: "Auth user (guest)", path: "/api/auth/user", expect: [200, 401] },
  { name: "Parking pass feed", path: "/api/parking-pass", expect: [200] },
  { name: "Map locations", path: "/api/map/locations", expect: [200] },
  { name: "Host profile (guest guarded)", path: "/api/hosts/me", expect: [200, 401] },
  {
    name: "Admin dashboard (guest guarded)",
    path: "/api/admin/dashboard-totals",
    expect: [401, 403],
  },
  {
    name: "Subscription status (guest guarded)",
    path: "/api/subscription/status",
    expect: [200, 401],
  },
];

for (const check of criticalChecks) {
  const url = `${baseUrl}${check.path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
    });
    if (check.expect.includes(res.status)) {
      pass(`${check.name} → ${res.status}`);
    } else {
      fail(`${check.name} → ${res.status} (expected ${check.expect.join("/")})`);
    }
  } catch (err) {
    fail(`${check.name} → network error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// STEP 4: Stripe webhook events reminder
// ─────────────────────────────────────────────
section("Step 4: Stripe Webhook Events (Manual Verification Required)");
console.log(`
  The following Stripe webhook events MUST be registered in your Stripe Dashboard
  pointing to: ${baseUrl}/api/stripe/webhook

  Required events:
    • payment_intent.succeeded
    • invoice.payment_succeeded
    • customer.subscription.updated
    • customer.subscription.deleted

  If these are not registered, bookings and subscriptions will never activate.
  Verify at: https://dashboard.stripe.com/webhooks
`);
warn("Cannot auto-verify Stripe webhook registration — confirm manually in the Stripe Dashboard.");

// ─────────────────────────────────────────────
// STEP 5: Final result
// ─────────────────────────────────────────────
section("Pre-Launch Gate Result");

if (totalFailed === 0) {
  console.log(`
  ✅  All automated checks passed.
  ⚠️   Complete the manual Stripe webhook verification (Step 4) before going live.
  `);
  process.exit(0);
} else {
  console.error(`
  ❌  ${totalFailed} check(s) failed. Resolve all failures before going live.
  `);
  process.exit(1);
}
