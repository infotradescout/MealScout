# Scaling Readiness (1k -> 100k users)

This checklist is the minimum baseline for stable growth under burst traffic.

## 1. SLOs (set targets before scaling)

- API latency: p95 < 300ms, p99 < 800ms
- API server error rate (5xx): < 0.5%
- Checkout success rate: > 99.5%
- Stripe webhook processing delay: < 60s p95

## 2. Runtime and Infra (Render)

- Enable horizontal scaling for web service (at least 2 instances in production).
- Ensure sticky sessions are configured or session storage is shared.
- Use a production Postgres tier sized for expected peak QPS.
- Tune the Neon/Postgres pool with:
  - `DB_POOL_MAX`
  - `DB_POOL_IDLE_TIMEOUT_MS`
  - `DB_POOL_CONNECTION_TIMEOUT_MS`
- Configure Redis (`REDIS_URL`) for public response caching and future cross-instance workloads.
- Set health checks:
  - Liveness: `GET /health`
  - Readiness: `GET /health/ready`
- Set gzip/compression threshold:
  - `COMPRESSION_THRESHOLD_BYTES`

## 3. Security and abuse controls

- Keep CSRF and CORS allowlist strict in production.
- Keep strict rate limits on auth and payment endpoints.
- Require `Idempotency-Key` on payment mutation endpoints.
- Add WAF/bot controls in front of public endpoints if traffic grows materially.

## 4. Observability

- Enable Sentry in production (`SENTRY_DSN`).
- Collect app logs with request IDs (`X-Request-Id`).
- Poll `/health/metrics` with `X-Health-Token` and chart:
  - API p95/p99 latency
  - API 4xx/5xx rates
  - request volume
  - cache mode, hit/miss/error counters
  - DB pool totals/idle/waiting counts
- Alert on SLO breach windows (5m + 30m).
- Configure built-in alert thresholds:
  - `PERF_ALERT_P95_MS`
  - `PERF_ALERT_5XX_RATE_PCT`
- Track job-queue pressure from `/health/metrics`:
  - `jobs.queued`
  - `jobs.active`
  - `jobs.totals.retried`
  - `jobs.totals.failed`
  - `jobs.totals.timedOut`

## 5. Async job reliability

- Configure in-process job queue safety limits:
  - `JOB_QUEUE_CONCURRENCY=4`
  - `JOB_QUEUE_MAX_SIZE=5000`
  - `JOB_QUEUE_MAX_ATTEMPTS=3`
  - `JOB_QUEUE_TIMEOUT_MS=30000`
  - `JOB_QUEUE_RETRY_BASE_MS=1000`
  - `JOB_QUEUE_RETRY_MAX_MS=60000`
- If queue depth grows persistently, move job execution to a dedicated worker service.

## 6. Retention cleanup

- Enable scheduled cleanup in production:
  - `OPS_CLEANUP_ENABLED=true`
  - `OPS_CLEANUP_INTERVAL_MINUTES=30`
  - `IDEMPOTENCY_RETENTION_HOURS_AFTER_EXPIRY=24`
  - `RATE_LIMIT_COUNTER_RETENTION_HOURS=48`
- Verify `/health/metrics` includes a `cleanup` snapshot.
- Keep manual fallback available:
  - `POST /health/maintenance/cleanup` with `X-Health-Token`.

## 7. Payments and webhook safety

- Keep all payment mutations idempotent.
- Ensure webhook retry/replay is safe (idempotent DB writes).
- Monitor Stripe webhook failure count and latency.

## 8. Load testing cadence

- Run load tests before each major release:
  - public discovery/search/map feeds
  - signup and onboarding route guards
  - browse suppliers
  - create supplier orders
  - create pay-intent (ACH and card)
  - webhook success/failure processing
- Test at 5x expected peak RPS for at least 10 minutes.
- Use:
  - `npm run smoke:launch-spike` for a short public-feed spike check.
  - `npm run load:supplier-payments` for a repeatable supplier payment-intent load test harness.
  - `npm run stress-test` for broader read-heavy API stress.

## 9. Required DB migrations for scale controls

- Apply:
  - `migrations/058_idempotency_keys.sql`
  - `migrations/059_rate_limit_counters.sql`
  - `migrations/060_supplier_marketplace_performance_indexes.sql`
  - `migrations/061_supplier_orders_created_at_index.sql`
  - `migrations/062_supplier_search_trigram_indexes.sql`

## 10. Operational readiness

- On-call owner and escalation path defined.
- Incident runbook for:
  - database saturation
  - Redis unavailable or high cache error rate
  - Stripe outage
  - webhook backlog
  - elevated 5xx rates
- In-app support ticket triage owner assigned for launch week.

## 11. Release strategy

- Use feature flags for payment flow changes.
- Roll out via canary (small traffic slice first).
- Have a rollback procedure that is tested and documented.
- Keep customer-facing delivery disabled; only supplier delivery workflows are in scope.
