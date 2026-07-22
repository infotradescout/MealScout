## Refactor Lane Mapping

- Lane: <!-- required: critical-bug-fix or one refactor phase lane -->
- Why this belongs in the current cycle:

## Scope Check

- [ ] No new major feature work
- [ ] No new monetization surface
- [ ] No intel-heavy workflow added inside monolith files
- [ ] No schema redesign unrelated to this refactor

## Risk and Rollback

- Risk level: <!-- low/medium/high -->
- Rollback steps:

## Sacred Flow Verification

- [ ] Auth/session checked
- [ ] Booking checked
- [ ] Payments/Stripe checked
- [ ] Ordering subscription gate checked
- [ ] Mobile responsiveness on primary pages checked

## Metrics Evidence

- [ ] `docs/refactor/REFACTOR_METRICS_LOG.md` updated with `before` snapshot
- [ ] `docs/refactor/REFACTOR_METRICS_LOG.md` updated with `after` snapshot
- Evidence links/dashboards:

## Validation

- [ ] `npm run check`
# Refactor controls (required when a hot seam is touched)

- Bounded seam / excluded scope:
- Blast radius:
- Owner GitHub handle:
- Non-author reviewer GitHub handle:
- Rollback method:
- Auth and ownership parity:
- Subscription gate parity:
- Booking/event transition parity:
- Admin totals/telemetry parity:
- Metrics-log entry:
