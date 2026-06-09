# Production Rollout Checklist

Use this checklist for each production release.

## 1. Pre-deploy (local)

1. Ensure branch is clean:
   - `git status --short --branch`
2. Run checks:
   - `npm run check`
   - `npm run test:supplier-payments`
3. Ensure migrations are committed and ordered.

## 2. Deploy to Render

1. Deploy latest `main`.
2. Ensure env vars are set:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `STRIPE_SECRET_KEY`
   - `VITE_STRIPE_PUBLIC_KEY`
   - `HEALTH_METRICS_TOKEN`
   - `SENTRY_DSN`
   - `OPS_CLEANUP_ENABLED=true`
   - `OPS_CLEANUP_INTERVAL_MINUTES=30`
   - `IDEMPOTENCY_RETENTION_HOURS_AFTER_EXPIRY=24`
   - `RATE_LIMIT_COUNTER_RETENTION_HOURS=48`
   - `JOB_QUEUE_CONCURRENCY=4`
   - `JOB_QUEUE_MAX_SIZE=5000`
   - `JOB_QUEUE_MAX_ATTEMPTS=3`
   - `JOB_QUEUE_TIMEOUT_MS=30000`
   - `JOB_QUEUE_RETRY_BASE_MS=1000`
   - `JOB_QUEUE_RETRY_MAX_MS=60000`
3. Ensure bypass flags are disabled in production:
   - `MEALSCOUT_BYPASS_STRIPE=false`
   - `MEALSCOUT_TEST_MODE=false`

## 3. Run DB migrations in production

Run each once:

1. `npm run -s migrate:sql 058_idempotency_keys.sql`
2. `npm run -s migrate:sql 059_rate_limit_counters.sql`
3. `npm run -s migrate:sql 060_supplier_marketplace_performance_indexes.sql`
4. `npm run -s migrate:sql 061_supplier_orders_created_at_index.sql`
5. `npm run -s migrate:sql 062_supplier_search_trigram_indexes.sql`

## 4. Health + readiness verification

1. Liveness:
   - `GET /health`
2. Readiness:
   - `GET /health/ready`
3. Metrics:
   - `GET /health/metrics` with header `X-Health-Token: <HEALTH_METRICS_TOKEN>`
   - Verify `jobs` stats are present and queue depth is stable.
4. Maintenance cleanup (manual trigger):
   - `POST /health/maintenance/cleanup` with header `X-Health-Token: <HEALTH_METRICS_TOKEN>`
   - Confirm response includes deleted row counts for `idempotency_keys` and `rate_limit_counters`.

## 5. Payment flow smoke test

Authenticated production smoke is blocked until `MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_READINESS_GATE.md` is `UNBLOCKED` and P2 is externally complete per `MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P2_ACCOUNTS_AND_SECRETS.md`. Do not use live customer, owner/business, admin/staff, payment, payout, or notification mutation smokes until approved smoke accounts, required production env/secrets, fixture quarantine, notification isolation, payment no-op boundaries, DB read-only verification, and reset dry-run evidence exist outside the repo.

P2 smoke-account and production-secret definition:

- Customer smoke account defined outside repo.
- Owner smoke account and smoke business/profile fixture ids defined outside repo.
- Admin/staff smoke account defined outside repo.
- Production public/API base URLs defined outside repo.
- Cookie/login secret strategy defined outside repo.
- Read-only production DB verification path defined outside repo.
- No credentials, cookies, passwords, tokens, database URLs, or production secrets committed.

P3 guarded authenticated smoke runner:

- Do not run the P3 authenticated smoke runner until `MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P3_RUNNER.md` is reviewed and `scripts/mealscout-authenticated-production-smoke.ts` passes its contract.
- Runner must fail closed unless `PROD_AUTH_SMOKE_ENABLED=true` is set outside the repo.
- Runner must require all customer, owner, and staff/admin smoke env vars before any network call.
- Runner must write redacted evidence only and must never print cookies, passwords, tokens, or production secrets.
- Runner must keep customer, owner, and staff/admin checks separated.
- Runner must avoid production mutations except approved login/session checks and read-only smoke fixture reads.

1. Supplier pay-intent idempotency (existing flow):
   - Create unpaid supplier order with `paymentMethod="stripe"`.
   - Call pay-intent endpoint with `Idempotency-Key`.
   - Retry same request with same key and same payload (expect replayed response).
   - Retry with same key and different payload (expect `409` mismatch).
2. Parking Pass booking + Stripe host onboarding smoke:
   - Set env vars:
     - `API_BASE=https://<your-origin>`
     - `TEST_PARKING_PASS_ID=<existing open paid pass>`
     - `TEST_TRUCK_ID=<truck that owns the authenticated session>`
     - `TEST_TRUCK_AUTH_COOKIE=<authenticated truck cookie>`
     - `TEST_HOST_AUTH_COOKIE=<authenticated host cookie>` (optional but recommended)
     - `EXPECT_HOST_CONNECTED=true` (optional)
     - `EXPECT_HOST_CHARGES_ENABLED=true` (optional)
     - `EXPECT_HOST_ONBOARDING_COMPLETED=true` (optional)
     - `CANCEL_PENDING_AFTER_CHECK=true` (recommended)
   - Run:
     - `npm run smoke:parking-pass-stripe`
   - Verify:
     - Host Stripe status endpoint returns expected flags.
     - Booking intent is created (`paymentIntentId` returned).
     - Duplicate booking attempt is blocked (`400` or `409`).
     - Cancel endpoint clears pending hold when cancel flag is enabled.

## 6. Rate limit verification

1. Burst pay-intent requests for one user.
2. Confirm `429` appears after threshold and `Retry-After` header is present.
3. Confirm behavior is consistent across app instances.

## 7. Load test

Run:

- `npm run load:supplier-payments`

Recommended target:

- at least 5x expected peak request rate for 10+ minutes.

## 8. Observability and alerting

Alert on:

- API p95 latency > 300ms sustained
- API 5xx > 0.5% sustained
- readiness check failures
- webhook processing lag spikes
