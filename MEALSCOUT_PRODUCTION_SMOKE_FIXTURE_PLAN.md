# MealScout Production Smoke Fixture Plan

Status: C10 complete. Docs/contracts only.

This plan defines the minimum approved fixture envelope for future stateful production or staging smoke tests. It maps current code behavior only. It does not create users, businesses, bookings, payments, webhooks, secrets, telemetry, or runtime feature flags.

## Scope

Current production-safe coverage is mostly read-only:

- `npm run gate:production` runs `scripts/productionReadinessGate.mjs`, validates env presence, validates static routing/config snippets, and keeps live probes GET-only.
- `scripts/preLaunchGate.mjs` checks key env vars, GETs critical public/auth-guarded routes, and reminds operators to manually verify Stripe webhook registration.
- Existing authenticated/stateful smokes require real cookies or credentials and are not safe to run against production until this fixture boundary is approved.

The fixture plan is for future work only. Runtime code and live production data are out of scope for C10.

## Current Smoke Inventory

- Public/read-only smoke: `scripts/productionReadinessGate.mjs`, `scripts/preLaunchGate.mjs`, `scripts/smokeCriticalRoutes.mjs`, `scripts/smokeScoutSurface.mjs`, and mobile deep-link smokes use GET probes or local server checks.
- Owner ordering smoke: `scripts/smokeOrderingSubscriptionAccess.mjs` uses `ORDERING_OWNER_COOKIE` or owner login env vars, then GETs owner ordering endpoints.
- Parking Pass payment smoke: `scripts/smokeParkingPassStripeFlow.ts` posts to `/api/parking-pass/:passId/book`, reads `/api/bookings/payment-intent/:paymentIntentId`, attempts a duplicate booking, and optionally posts to `/api/bookings/payment-intent/:paymentIntentId/cancel`.
- Parking Pass webhook replay: `scripts/testParkingPassWebhookReplay.ts` signs test webhook payloads and posts to `/api/stripe/webhook` after finding an existing confirmed booking intent.
- Admin provisioning smoke: `scripts/testAdminManualProvisioning.ts` logs in as an admin and creates smoke host users with `smoke-host-*` emails.
- Supplier/order smokes exist and can create orders or payment intents when supplied authenticated cookies and fixture ids.

## Customer Smoke

Future customer smoke may validate login, session persistence, public discovery, saved/navigation surfaces, claim/redeem reads, and booking request forms only if the account is explicitly designated as a smoke account.

Required fixture properties:

- Dedicated smoke customer account with a smoke-only email address and no real customer identity.
- Notification preferences set to the most restrictive available state before any write path is exercised.
- No live public user-facing content created by the customer smoke.
- Evidence must record route, account id, timestamp, HTTP status, and whether any write endpoint was intentionally skipped.

Blocked until follow-up: customer flows that submit public booking requests can call `emailService.sendBasicEmail` to real owner emails, so they must stay out of production smoke until notification isolation is approved.

## Owner/Business Smoke

Future owner/business smoke may validate dashboard access, profile read paths, ordering subscription access, and business visibility expectations for a designated smoke business.

Required fixture properties:

- Dedicated owner account and business profile marked with durable smoke identifiers such as `_smoke_`, `smoke-`, or a smoke-only email domain.
- Business name/address/city values must be filtered by current public visibility protections or explicitly excluded from public discovery before production use.
- Owner smoke should prefer read-only dashboard and subscription access checks. Profile, menu, schedule, image upload, and ordering writes require an approved reset step.
- Ordering smoke may use `ORDERING_OWNER_COOKIE`, `ORDERING_OWNER_EMAIL`, `ORDERING_OWNER_PASSWORD`, `ORDERING_SUBSCRIBED_RESTAURANT_ID`, and `ORDERING_UNSUBSCRIBED_RESTAURANT_ID`, but it must not auto-create restaurants in production.

Current visibility reality: `server/utils/publicBusinessVisibility.ts` filters obvious test/demo/fake placeholder tokens and `PUBLIC_TEST_BUSINESS_TOKENS`; public search and map paths use visibility filtering in several places. That is not a full smoke fixture quarantine model.

## Admin/Staff/Superadmin Smoke

Future admin/staff/superadmin smoke may validate auth boundaries, staff/admin route access, list/read screens, and negative checks against missing ids.

Allowed without new fixture mutation:

- Login with dedicated smoke admin/staff accounts.
- GET admin dashboards, verification queues, launch-board, user detail reads, and guarded endpoints.
- Negative POST checks against nonexistent ids only when the endpoint does not create or mutate real rows.

Blocked until follow-up:

- Production admin provisioning through `/api/admin/users/create`, because the current smoke creates users and host/business shells.
- Insurance verification approval/rejection of real requests.
- Staff/admin outbound messaging, password reset, verification resend, subscription link, Parking Pass reminders, drip sends, import ingestion, profile evidence application, or map geocode retries.

## Muted Notification Isolation Boundary

No authenticated production smoke may dispatch external notifications unless a first-class isolation boundary exists and is enabled for the fixture run.

Current notification surfaces include:

- Brevo transactional email through `server/emailService.ts`.
- Brevo SMS through `server/smsService.ts`.
- Booking, subscription, pickup order, verification, admin message, reminder, lead magnet, drip, digest, event notification, supplier request, and webhook-triggered email paths.
- Browser notifications in the client, which are not server sends but can still affect user-visible smoke evidence.
- Social queue processing through scheduled workers and services.

Minimum approved isolation behavior:

- Smoke accounts must use smoke-only email addresses and phone numbers that cannot reach real users.
- `EMAIL_NOTIFICATIONS_MODE=off` or an equivalent provider sink must be set for fixture runs that touch send-capable paths, unless the test explicitly verifies provider delivery in a non-production environment.
- SMS must be disabled or routed to a verified sink number before any SMS-capable route is exercised.
- Scheduler/drip/social processors must be disabled or proven excluded from smoke fixture records before stateful smoke data is inserted.
- Evidence must record notification mode, SMS provider state, scheduler state, and the expected number of external sends, which should be zero for production smoke.

Follow-up C10-F1: create a central notification sink/allowlist contract before any production smoke uses routes that can call email, SMS, social publishing, or webhook-triggered notification code.

## Payment Transaction No-Op Enclosure

Production smoke must not create real charges, withdrawable balances, payouts, transfers, subscriptions, or live Stripe customer/payment state. Parking Pass and supplier payment tests are currently stateful and must be enclosed before production use.

Current payment mutation surfaces include:

- `/api/parking-pass/:passId/book`, which creates pending booking holds and, when Stripe is active, creates a PaymentIntent.
- `/api/bookings/payment-intent/:paymentIntentId/cancel`, which releases holds and can cancel a Stripe PaymentIntent.
- `/api/stripe/webhook`, which verifies signatures outside development and mutates bookings, subscriptions, pickup orders, supplier orders, commissions, and notifications based on event type.
- Supplier payment intent routes and pickup order payment routes.
- Host Stripe Connect onboarding/status and payout visibility routes.

Minimum approved no-op behavior:

- Production fixture runs must not use live Stripe mode.
- Test-mode Stripe credentials are acceptable only when clearly separated from production data and webhook secrets.
- `MEALSCOUT_BYPASS_STRIPE` and `MEALSCOUT_TEST_MODE` are disallowed in production launch mode; they can be used only in local/staging smoke contexts where the deployment is explicitly not accepting real users.
- Payment smoke evidence may verify route guards, missing-fixture skips, Stripe config readiness, and read-only status endpoints in production.
- Stateful payment tests must target staging or a dedicated test-mode environment with fixture payment methods, fixture Stripe accounts, and zero live payout/transfer exposure.

Follow-up C10-F2: define a dedicated Stripe test-mode fixture set and webhook replay environment before stateful payment smoke is approved outside local development.

## Idempotent Reset Blueprint

Every future stateful smoke must have a reset that can run before and after the smoke without damaging real data.

Required reset inputs:

- Run id, timestamp, operator, environment, base URL, git commit, and smoke suite name.
- Fixture account ids, fixture business ids, fixture host ids, fixture restaurant ids, fixture order ids, fixture booking ids, and Stripe test object ids where relevant.
- Durable smoke markers in email, name, raw metadata, idempotency keys, and evidence files.

Required reset behavior:

- Reset must select only rows with durable smoke markers and the expected fixture owner ids.
- Reset must support dry-run mode and print the rows it would touch.
- Reset must be idempotent: re-running after success should produce no changes and no failures.
- Reset must release pending booking holds, cancel pending test PaymentIntents in test mode, clear test order rows, restore fixture subscription/access state, and remove or deactivate smoke-only public profiles as explicitly approved.
- Reset must not delete or alter rows that lack smoke markers, belong to real users, or include live Stripe object ids.

Follow-up C10-F3: implement a reset runner only after fixture markers, notification isolation, and payment no-op boundaries are approved.

## Env Vars/Secrets

Existing smoke and gate env requirements:

- Production gate: `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `SITEMAP_SITE_URL`, `CLIENT_ORIGIN`, `INDEXNOW_ENABLED`, `INDEXNOW_KEY`, `INDEXNOW_HOST`, `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`, and `BREVO_API_KEY`.
- Read-only live probe controls: `SKIP_LIVE_PROBES`, `PROD_GATE_STRICT_ENV`, `PROD_GATE_PUBLIC_BASE_URL`, and `PROD_GATE_API_BASE_URL`.
- Ordering smoke: `SMOKE_BASE_URL`, `SMOKE_ORIGIN`, `ORDERING_OWNER_COOKIE`, `ORDERING_OWNER_EMAIL`, `ORDERING_OWNER_PASSWORD`, `ORDERING_SUBSCRIBED_RESTAURANT_ID`, and `ORDERING_UNSUBSCRIBED_RESTAURANT_ID`.
- Admin smoke: `ADMIN_SMOKE_BASE_URL`, `ADMIN_SMOKE_ORIGIN`, `ADMIN_SMOKE_EMAIL`, and `ADMIN_SMOKE_PASSWORD`.
- Parking Pass smoke: `API_BASE`, `TEST_PARKING_PASS_ID`, `TEST_TRUCK_ID`, `TEST_TRUCK_AUTH_COOKIE`, `TEST_HOST_AUTH_COOKIE`, `TEST_SLOT_TYPES`, `TEST_APPLY_CREDITS_CENTS`, and `CANCEL_PENDING_AFTER_CHECK`.
- Webhook replay: `API_BASE`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
- Notification controls: `EMAIL_NOTIFICATIONS_MODE`, `BREVO_API_KEY`, `BREVO_SMS_SENDER`, scheduler flags, and provider-specific sink settings if added later.

Secrets must remain outside the repository. C10 does not add env files or placeholder credentials.

## Evidence Artifacts

Future production smoke evidence should be written outside source-controlled docs unless the artifact is intentionally summarized.

Minimum evidence fields:

- Suite name, run id, environment, base URL, git commit, operator, and timestamp.
- Fixture ids used and fixture marker checks.
- Routes exercised, HTTP methods, status codes, and whether each route was read-only or stateful.
- Notification isolation state and actual external send count.
- Payment no-op state and confirmation that no live charges, transfers, payouts, or subscriptions were created.
- Reset dry-run output and post-reset verification.
- Links to CI logs, screenshots, or JSON reports when produced.

Evidence must not include session cookies, passwords, Stripe secrets, webhook secrets, Brevo keys, or raw PII beyond dedicated smoke fixture identifiers.

## Cleanup/Reset Expectations

Production smoke is not approved unless cleanup/reset expectations are explicit before the run starts.

- Read-only suite: no reset required, but evidence must show only GET/read paths or expected auth failures.
- Authenticated read suite: no reset required if it only reads fixture accounts and does not trigger sends.
- Stateful suite: reset required before and after the run.
- Payment suite: test-mode or staging reset required; production live-mode mutation is blocked.
- Admin suite: reset required for any created user, host, restaurant, verification, import, evidence, or message row.

## Follow-Up Tickets

- C10-F1: Add a central notification sink/allowlist contract for email, SMS, social queue, and webhook-triggered notifications before stateful production smoke.
- C10-F2: Define dedicated Stripe test-mode fixtures, Connect account expectations, webhook secrets, and evidence before stateful payment smoke.
- C10-F3: Build an idempotent reset runner with dry-run output and smoke-marker enforcement.
- C10-F4: Add an explicit production smoke fixture quarantine flag or metadata convention that public discovery, search, map, and Scout surfaces can reliably exclude.
- C10-F5: Split admin/staff/superadmin smoke into read-only, negative-write, and stateful suites so production can run the safe portion without fixture mutation.

## Completion Rule

C10 closes the initial cleanup/audit queue. No queued cleanup items remain in `CLEANUP_MAP.md`; any next phase must be intentionally added as a new map section with its own scope, allowed changes, disallowed changes, validation, and handoff value.
