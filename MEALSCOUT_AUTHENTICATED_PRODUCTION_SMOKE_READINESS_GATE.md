# MealScout Authenticated Production Smoke Readiness Gate

Status: `BLOCKED`

P1 defines the non-mutating readiness gate for authenticated production smoke. It does not run live authenticated smoke, create users, change secrets, send notifications, touch payment rails, mutate production data, alter runtime auth/admin/owner/customer behavior, or claim successful smoke evidence.

Authenticated production smoke is BLOCKED until every high-risk blocker in this artifact is cleared with explicit evidence.

## Review Inputs

- `MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md`
- `MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md`
- `MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md`
- `scripts/productionReadinessGate.mjs`
- `scripts/preLaunchGate.mjs`
- `scripts/smokeOrderingSubscriptionAccess.mjs`
- `scripts/smokeParkingPassStripeFlow.ts`
- `scripts/testParkingPassWebhookReplay.ts`
- `scripts/testAdminManualProvisioning.ts`
- `docs/PROD_ROLLOUT_CHECKLIST.md`

## Production Smoke Account Requirements

Approved accounts must exist before any authenticated production smoke is run:

- Customer/user smoke account: dedicated user, smoke-only email, no real customer identity, restrictive notification preferences, and no live customer-facing content creation.
- Owner/business smoke account: dedicated owner plus dedicated smoke business/profile records, known owner credentials or cookie, and known fixture business ids for dashboard/read-only checks.
- Admin or staff smoke account: dedicated staff/admin user for read-only admin/staff route checks only.
- All accounts: credentials remain outside the repo, are approved by an operator, and are never created ad hoc by smoke scripts in production.

Live authenticated production smoke is forbidden without approved smoke accounts.

## Required Env Vars/Secrets

Baseline read-only production gate:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL`
- `SITEMAP_SITE_URL`
- `CLIENT_ORIGIN`
- `INDEXNOW_ENABLED`
- `INDEXNOW_KEY`
- `INDEXNOW_HOST`
- `STRIPE_SECRET_KEY`
- `VITE_STRIPE_PUBLIC_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `BREVO_API_KEY`

Read-only gate controls:

- `SKIP_LIVE_PROBES`
- `PROD_GATE_STRICT_ENV`
- `PROD_GATE_PUBLIC_BASE_URL`
- `PROD_GATE_API_BASE_URL`

Authenticated owner/business readiness inputs:

- `SMOKE_BASE_URL`
- `SMOKE_ORIGIN`
- `ORDERING_OWNER_COOKIE` or `ORDERING_OWNER_EMAIL` and `ORDERING_OWNER_PASSWORD`
- `ORDERING_SUBSCRIBED_RESTAURANT_ID`
- `ORDERING_UNSUBSCRIBED_RESTAURANT_ID`

Admin/staff readiness inputs:

- `ADMIN_SMOKE_BASE_URL`
- `ADMIN_SMOKE_ORIGIN`
- `ADMIN_SMOKE_EMAIL`
- `ADMIN_SMOKE_PASSWORD`

Payment-related smoke inputs remain blocked for live production until the payment no-op requirements are satisfied:

- `API_BASE`
- `TEST_PARKING_PASS_ID`
- `TEST_TRUCK_ID`
- `TEST_TRUCK_AUTH_COOKIE`
- `TEST_HOST_AUTH_COOKIE`
- `TEST_SLOT_TYPES`
- `CANCEL_PENDING_AFTER_CHECK`
- Stripe test-mode-only secrets for any payment replay or PaymentIntent smoke.

Secrets must not be committed, echoed into evidence artifacts, or copied into docs.

## Current Blockers

Authenticated production smoke remains BLOCKED for these known blockers:

1. No approved production smoke account set confirmed.
2. No first-class fixture quarantine that reliably excludes smoke businesses from public discovery/maps/search.
3. No central notification sink/allowlist for email, SMS, social, drip, or webhook-triggered sends.
4. No approved payment no-op enclosure for live production.
5. No idempotent reset runner with dry-run and smoke-marker enforcement.
6. Existing admin provisioning smoke creates users, so it is not production-safe as-is.

## Safe Fixture Naming/Isolation Rules

Smoke fixtures must be structurally isolated:

- Use durable markers in every relevant identity surface: `_smoke_`, `smoke-`, `smoke_`, smoke-only email local parts, and smoke-only metadata.
- Use smoke-only emails, phone numbers, names, business names, profile names, slugs, idempotency keys, and raw metadata.
- Smoke businesses/profiles must be excluded from public discovery, maps, search, Scout, SEO, public profile recommendations, and public aggregate feeds.
- Smoke records must not point to real merchant payout accounts, real customer identities, real supplier orders, real pickup orders, or live banking instruments.
- Fixture ids must be known before the run and recorded in the readiness evidence without exposing credentials or sensitive PII.

## Customer Smoke Evidence Requirements

Customer smoke readiness evidence must prove:

- Approved smoke customer account id and smoke email are present.
- Authentication/session check uses only the approved account.
- Exercised routes and HTTP statuses are listed.
- All customer checks are read-only or explicitly skipped when a route can trigger writes or external sends.
- Booking request forms, claim/redeem writes, public content creation, and notification-capable customer actions are blocked until notification isolation and reset are approved.
- External send count is zero.

No successful authenticated production smoke evidence is claimed or fabricated by this P1 gate.

## Owner/Business Smoke Evidence Requirements

Owner/business smoke readiness evidence must prove:

- Approved smoke owner account id, smoke business/profile ids, and smoke markers are present.
- Smoke business/profile is excluded from public discovery/maps/search before any owner smoke runs.
- Ordering access checks use known fixture ids for subscribed and unsubscribed states.
- Owner dashboard/profile/menu/schedule checks are read-only unless an approved reset/cleanup dry-run exists.
- No profile, menu, schedule, image upload, order, payout, or subscription state is mutated.
- External send count is zero.

No successful authenticated production smoke evidence is claimed or fabricated by this P1 gate.

## Admin/Staff Smoke Evidence Requirements

Admin/staff smoke readiness evidence must prove:

- Approved smoke admin or staff account id and smoke email are present.
- Admin/staff checks are read-only route access checks or safe negative checks against nonexistent ids.
- Production admin provisioning through `/api/admin/users/create` is not used.
- Insurance verification approval/rejection, password reset, verification resend, subscription link, staff/admin messaging, Parking Pass reminders, drip sends, import ingestion, profile evidence application, map geocode retries, and payout actions are not used.
- External send count is zero.

No successful authenticated production smoke evidence is claimed or fabricated by this P1 gate.

## Notification Isolation Requirements

External notifications are forbidden during authenticated production smoke unless a specific later gate approves a sink/allowlist.

Readiness evidence must prove:

- No live customer emails are sent.
- No live merchant emails are sent.
- No SMS is sent to real numbers.
- No social publishing, drip, digest, reminder, webhook-triggered notification, or admin message send is triggered.
- `EMAIL_NOTIFICATIONS_MODE=off` or an equivalent sink/allowlist is active for any send-capable route, or the route is skipped.
- Scheduler/drip/social processors are disabled or proven unable to touch smoke fixtures.

## Payment No-Op Requirements

Real payment, payout, and banking impact is forbidden during authenticated production smoke.

Readiness evidence must prove:

- No live Stripe mode is used for stateful payment tests.
- No real charges, PaymentIntents, subscriptions, transfers, payouts, withdrawable balances, credits, commissions, supplier payments, pickup payments, or host payout ledger mutations are created.
- No real merchant payout impact occurs.
- No real banking rails are touched.
- `MEALSCOUT_BYPASS_STRIPE` and `MEALSCOUT_TEST_MODE` remain disabled for production launch mode.
- Any future stateful payment smoke runs only in staging or a dedicated test-mode environment with fixture Stripe accounts and webhook secrets.

## Reset/Cleanup Dry-Run Requirements

Stateful authenticated production smoke remains blocked until reset/cleanup dry-run evidence exists.

Readiness evidence must prove:

- Reset has a dry-run mode.
- Reset dry-run output lists every row or provider object it would touch.
- Reset selectors require smoke markers and expected fixture owner ids.
- Reset is idempotent and can run before and after the smoke.
- Reset does not touch rows lacking smoke markers, real users, real merchant accounts, real orders, live Stripe ids, or non-smoke businesses.
- Post-reset verification proves no smoke-created public discovery, payment, notification, or admin side effects remain.

## Gate Decision

Decision: `BLOCKED`

Authenticated production smoke must not run until all six known blockers are cleared and evidence exists for approved accounts, fixture isolation, notification isolation, payment no-op behavior, and reset/cleanup dry-run safety.

This P1 artifact is a readiness gate/report only. It contains no successful smoke result, no fabricated smoke evidence, and no authorization to run live authenticated production smoke.
