# Production Rollout Checklist

Use this checklist for each production release.

## 1. Pre-deploy (local)

1. Ensure branch is clean:
   - `git status --short --branch`
2. Run checks:
   - `npm run check`
   - `npm run build:server`
   - `npm run build:client`
   - `npm run audit:signup-flows`
3. Run targeted payment/ordering checks when touching those areas:
   - `npm run test:supplier-payments`
   - `npm run test:ordering-subscription-scope`
   - `npm run smoke:parking-pass-full`
4. Ensure migrations are committed and ordered.

## 2. Deploy to Render

1. Deploy latest `main`.
2. Ensure env vars are set:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `REDIS_URL`
   - `STRIPE_SECRET_KEY`
   - `VITE_STRIPE_PUBLIC_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `BREVO_API_KEY`
   - `HEALTH_METRICS_TOKEN`
   - `SENTRY_DSN`
   - `CLIENT_ORIGIN`
   - `ALLOWED_ORIGINS`
   - `DB_POOL_MAX`
   - `DB_POOL_IDLE_TIMEOUT_MS`
   - `DB_POOL_CONNECTION_TIMEOUT_MS`
   - `COMPRESSION_THRESHOLD_BYTES`
   - `PERF_ALERT_P95_MS`
   - `PERF_ALERT_5XX_RATE_PCT`
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

Run any pending migrations once. At minimum, verify these scale/payment migrations have already been applied:

1. `npm run -s migrate:sql 058_idempotency_keys.sql`
2. `npm run -s migrate:sql 059_rate_limit_counters.sql`
3. `npm run -s migrate:sql 060_supplier_marketplace_performance_indexes.sql`
4. `npm run -s migrate:sql 061_supplier_orders_created_at_index.sql`
5. `npm run -s migrate:sql 062_supplier_search_trigram_indexes.sql`

## 4. Health + readiness verification

1. Set the production target:
   - PowerShell: `$env:SMOKE_BASE_URL="https://mealscout.onrender.com"`
   - Bash: `export SMOKE_BASE_URL=https://mealscout.onrender.com`
2. Run the automated pre-launch gate:
   - `npm run gate:prelaunch`
3. If running pieces individually:
   - `npm run smoke:critical`
   - `npm run test:flows`
   - `npm run check:scale-readiness`
   - `npm run smoke:launch-spike`
4. Metrics:
   - `GET /health/metrics` with header `X-Health-Token: <HEALTH_METRICS_TOKEN>`
   - Verify request latency, 5xx rate, cache, DB pool, and job stats are present.
5. Maintenance cleanup (manual trigger):
   - `POST /health/maintenance/cleanup` with header `X-Health-Token: <HEALTH_METRICS_TOKEN>`
   - Confirm response includes deleted row counts for `idempotency_keys` and `rate_limit_counters`.

## 5. Product-scope smoke tests

1. Business signup paths:
   - Diner signup creates a customer account.
   - Restaurant signup creates a `restaurant_owner` account with `businessType=restaurant`.
   - Bar signup creates a `restaurant_owner` account with `businessType=bar`.
   - Food truck signup creates/continues the truck claim flow with `businessType=food_truck`.
   - Host signup promotes first-action customers to `host`.
   - Event coordinator signup creates `event_coordinator`.
2. Public landing/SEO paths:
   - `/truck-landing`
   - `/for-restaurants`
   - `/for-bars`
   - `/for-hosts`
   - `/find-food`
3. Online ordering scope:
   - Restaurants and bars can expose menus and pickup ordering when subscribed.
   - Food trucks can expose menu/pickup preorder flow.
   - Customer-facing business delivery is intentionally out of scope.
   - Supplier delivery settings remain available for suppliers only.

## 6. Payment flow smoke test

1. Supplier pay-intent idempotency:
   - Create unpaid supplier order with `paymentMethod="stripe"`.
   - Call pay-intent endpoint with `Idempotency-Key`.
   - Retry same request with same key and same payload (expect replayed response).
   - Retry with same key and different payload (expect `409` mismatch).
2. Parking Pass booking + Stripe host onboarding smoke:
   - Set env vars:
     - `API_BASE=https://<your-origin>`
     - `TEST_TRUCK_AUTH_COOKIE=<authenticated truck cookie>` (optional if using truck email/password)
     - `TEST_TRUCK_EMAIL=<truck login email>` (optional alternative to cookie)
     - `TEST_TRUCK_PASSWORD=<truck login password>` (optional alternative to cookie)
     - `TEST_TRUCK_ID=<truck that owns the authenticated session>` (optional; auto-discovered from `/api/restaurants/my` when omitted)
     - `TEST_HOST_AUTH_COOKIE=<authenticated host cookie>` (optional; for host checks)
     - `TEST_HOST_EMAIL=<host login email>` (optional alternative to host cookie)
     - `TEST_HOST_PASSWORD=<host login password>` (optional alternative to host cookie)
     - `TEST_HOST_ID=<host id tied to TEST_HOST_AUTH_COOKIE>` (optional; auto-discovered from `/api/hosts/me` when omitted)
     - `TEST_PARKING_PASS_ID=<existing open paid pass>` (optional; auto-discovered from host/public parking-pass feeds when omitted)
     - `TEST_SESSION_COOKIE_NAME=connect.sid` (optional; change if your session cookie name differs)
     - `EXPECT_HOST_CONNECTED=true` (optional)
     - `EXPECT_HOST_CHARGES_ENABLED=true` (optional)
     - `EXPECT_HOST_ONBOARDING_COMPLETED=true` (optional)
     - `TEST_BOOKING_DATE=YYYY-MM-DD` (optional; if omitted and pass id is virtual, date is inferred)
     - `CANCEL_PENDING_AFTER_CHECK=true` (recommended)
   - Run:
     - `npm run smoke:parking-pass-full`
   - Verify:
     - Host Stripe status endpoint returns expected flags.
     - Host parking-pass list/update endpoints succeed.
     - Booking intent is created (`paymentIntentId` returned).
   - Duplicate booking attempt is blocked (`400` or `409`).
   - Truck + host booking list endpoints return successfully.
   - Cancel endpoint clears pending hold when cancel flag is enabled.
3. Stripe webhooks:
   - Confirm Stripe Dashboard has the webhook endpoint:
     - `https://mealscout.onrender.com/api/stripe/webhook`
   - Confirm required events:
     - `payment_intent.succeeded`
     - `invoice.payment_succeeded`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`

## 7. Rate limit verification

1. Burst pay-intent requests for one user.
2. Confirm `429` appears after threshold and `Retry-After` header is present.
3. Confirm behavior is consistent across app instances.

## 8. Load test

Run:

- `npm run load:supplier-payments`
- `npm run smoke:launch-spike`

Recommended target:

- at least 5x expected peak request rate for 10+ minutes.

## 9. Observability and alerting

Alert on:

- API p95 latency > 300ms sustained
- API 5xx > 0.5% sustained
- readiness check failures
- webhook processing lag spikes
- Redis unavailable/cache error rate spikes
- DB pool saturation
- support ticket volume tagged `critical`

## 10. Known launch caveats

- `npm run check:scale-readiness` skips `/health/metrics` when `HEALTH_METRICS_TOKEN` is not available locally. Run it with the token before final go-live.
- `npm run test:flows` skips admin-only affiliate and host/truck booking flows unless `MEALSCOUT_ADMIN_EMAIL` and `MEALSCOUT_ADMIN_PASSWORD` are set.
- Stripe end-to-end tests require live/test Stripe secrets and webhook configuration; do not treat route smoke checks as payment verification.
