# PR #322 Lane 1 — Schema and stateful-test foundation

Source: `repair/2026-07-28-mealscout-preview-validation` @ `e897188f`
Base: current `origin/main` @ `caa9a566`
Status: **PARTIAL EXTRACT** — schema/migration landed; stateful fixtures charter-only until step 6.

## Landed in this branch
- `migrations/119_menu_inventory_auto_availability.sql`
- `shared/schema/legacy.ts`: `menuItems.inventoryAutoUnavailable` (+ insert omit)

## Extraction checklist (step 6 before claiming PASS)
| Artifact from PR #322 | Disposition | Notes |
|---|---|---|
| `scripts/mealscout-pickup-order-postgres.integration.test.ts` | RETAIN (pending port) | Requires pickup routes + payment services from lanes 2/3 |
| `scripts/mealscout-stripe-webhook-stateful-replay.integration.test.ts` (fixture/bootstrap parts) | RETAIN (pending port) | Pair with lane 2 webhook/idempotency implementation |
| package.json `test:pickup-order-postgres` | RETAIN (pending) | Additive script only; do not drop main free-profile scripts |

## Rejected from this lane
- Wholesale `shared/schema/legacy.ts` formatting / `.notNull()` removals in PR #322 — **REJECT** (schema noise)
- `server/routes/actionRoutes.ts` — **EXCLUDE** (trusted-principal lane)

## Proof boundary (not claimed here)
Production-like PostgreSQL apply of migration 119, replay/rollback statement, mixed-version compatibility; stateful fixture green only after lanes 2/3 ports.
