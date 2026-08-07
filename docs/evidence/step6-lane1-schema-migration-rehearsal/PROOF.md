# Step 6 / Lane 1 — Schema + migration foundation proof

**Verdict: PASS** (lane 1 schema/migration foundation only)
**Date:** 2026-08-07
**Lane SHA:** `0be8489f88ef6185690fe9cf6c75907c3bc891aa`
**Branch:** `salvage/pr322-lane1-schema-stateful-foundation`
**PR:** https://github.com/infotradescout/MealScout/pull/333 (draft retained)
**Base:** `origin/main` (merge-base recorded in `10-exact-commit-identity.txt`)

## Scope proved
- Migration `migrations/119_menu_inventory_auto_availability.sql`
- Drizzle column `menuItems.inventoryAutoUnavailable` + insert omit in `shared/schema/legacy.ts`
- Exact-commit identity at `0be8489f88ef6185690fe9cf6c75907c3bc891aa`
- Focused validation: `npm run check` (tsc) on that SHA → exit 0

## Environment (ephemeral; not production)
- Docker Postgres `postgres:16-alpine`
- Container: `mealscout-lane1-pg-proof`
- DB: `mealscout_lane1` on host port `55432`
- Production Neon `DATABASE_URL`: **not used / not touched**
- Rescue branch: **not touched**
- GitHub Actions: **not used as release evidence**
- No merge of #322 / #333; no production deploy

## Migration rehearsal results
| Step | Result | Log |
|---|---|---|
| Bootstrap pre-119 `menu_items` shape + seed rows | OK | `01-bootstrap.log` |
| Column absent before apply | OK (0 rows) | `02-pre-migration-column.log` |
| Apply 119 via `psql -f` | OK `ALTER TABLE` | `03-apply-119.log` |
| Column boolean NOT NULL DEFAULT false; seeds default false | OK | `04-verify-column-and-defaults.log` |
| Idempotent re-apply (IF NOT EXISTS) | OK (NOTICE skip) | `05-reapply-idempotent.log` |
| Mixed-version read/write compatibility | OK | `06-mixed-version-compat.log` |
| Rollback `DROP COLUMN IF EXISTS` | OK; core rows retained | `07-rollback-drop-column.log` |
| Safe roll-forward re-apply 119 | OK; defaults restored false | `08-rollforward-reapply.log`, `09-post-rollforward-verify.log` |
| Final psql apply after npm-driver note | OK | `18-final-psql-apply.log`, `19-final-column-verify.log` |

## Rollback / safe roll-forward statement
- **Rollback (safe for this additive nullable-default column):**
  `ALTER TABLE menu_items DROP COLUMN IF EXISTS inventory_auto_unavailable;`
  Rehearsed: drops column; existing `is_available` / inventory fields remain.
- **Safe roll-forward:** re-run migration 119 (`ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT FALSE`). Idempotent; restores column with default `false`. Note: any runtime values written into the column are lost across rollback (expected for DROP COLUMN); roll-forward does not recreate prior true flags.
- **Preferred production posture:** roll-forward / leave column in place (additive, default false, compatible with older readers that omit the column from projections).

## npm migrate:sql note (non-blocking for lane 1 SQL proof)
`npm run migrate:sql` uses `@neondatabase/serverless` WebSocket Pool (`server/db.ts`). Against local TCP Postgres it attempted `wss://127.0.0.1/v2` and failed (`15-npm-migrate-sql.log`). Production-like SQL apply for this proof used `psql` on ephemeral Postgres 16. On real Neon endpoints, `migrate:sql` remains the app script path.

## Exact-commit / focused validation
- Identity: `10-exact-commit-identity.txt` — SHA matches tip `0be8489f`
- Static schema/migration shape: `12-schema-static-checks.txt` — PASS
- `npm run check` (tsc): exit 0 — `17-tsc-check.log`
- Diff discipline: `shared/schema/legacy.ts` only +11/-1 (no wholesale `.notNull()` churn)

## Residual for step 6 other lanes (NOT claimed PASS here)
1. **Lane 1 residual:** port `scripts/mealscout-pickup-order-postgres.integration.test.ts` and stripe webhook stateful-replay fixture/bootstrap only **after lanes 2/3 land** (charter: `docs/PR322_LANE1_SCHEMA_STATEFUL_CHARTER.md`).
2. **Lane 2 (#334):** idempotency + Stripe state transitions — duplicate/stale/out-of-order/terminal replay proof.
3. **Lane 3 (#335):** pickup checkout/confirmation — authoritative totals, order creation, refund/notification exactly-once.
4. **Lane 4 (#336):** merchant delivery schedule lifecycle.
5. **Lane 5 (#337):** inventory auto-availability behavior (sold-out/concurrency) on top of migration 119.
6. Do not treat GitHub Actions CI on #333 as release evidence.

## Safety bounds
See `13-safety-bounds.txt`.
