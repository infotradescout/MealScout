# Launch Week Readiness

Use this runbook when you expect high traffic and need a fast go/no-go signal.

## One-command execution

```bash
npm run check:launch-week
```

What this does:

1. Checks required and recommended launch environment variables.
2. Runs TypeScript check.
3. Runs release readiness checks.
4. Starts a temporary backend instance on a free local port.
5. Runs critical route smoke checks against the live instance.
6. Runs launch spike smoke checks against the live instance.
7. Stops the temporary backend and prints a final summary.

## Strict environment mode

By default, missing required env vars are reported but do not fail the command.

Use strict mode for staging/production gates:

```bash
LAUNCH_STRICT_ENV=true npm run check:launch-week
```

Required in strict mode:

- `DATABASE_URL`
- `SESSION_SECRET`
- `STRIPE_SECRET_KEY`
- `VITE_STRIPE_PUBLIC_KEY`
- `STRIPE_WEBHOOK_SECRET`

Recommended:

- `BREVO_API_KEY`
- `INCIDENT_EMAIL_RECIPIENTS`
- `GOOGLE_MAPS_API_KEY`
- `VITE_GOOGLE_MAPS_WEB_API_KEY`

## Recommended pass thresholds

- `smoke:critical`: all checks pass.
- `smoke:launch-spike`: fail rate <= 5%, p95 <= 3000ms.

## Daily launch-week cadence

1. Run `npm run check:launch-week` before peak traffic.
2. Keep `npm run monitor` running during peak periods.
3. If any smoke check fails, enable degraded launch mode and investigate:
   - `npm run launch:degraded:on`
4. Recover and return to normal mode after mitigation:
   - `npm run launch:degraded:off`
