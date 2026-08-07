# Step 6 / Lane 1 — Schema + migration foundation proof

**Verdict: PASS** (lane 1 schema/migration foundation only)

**Date:** 2026-08-07

**Lane SHA (implementation tip before this evidence refresh commit):** `c0ffcc22e7cfe6d645c30d6d1ba8dfd80ac1e313`

**Branch:** `salvage/pr322-lane1-schema-stateful-foundation`

**PR:** https://github.com/infotradescout/MealScout/pull/333

**Refreshed onto:** `origin/main` `f6d0b874af353b395f6ac3aee717183a1da58bdf` (includes #330/#331/#332)

## Scope proved

- Migration `migrations/119_menu_inventory_auto_availability.sql`
- Drizzle column `menuItems.inventoryAutoUnavailable` + insert omit in `shared/schema/legacy.ts`
- Bounded residual charter in `docs/PR322_LANE1_SCHEMA_STATEFUL_CHARTER.md` (fixtures still pending lanes 2/3)
- Exact-commit identity after rebase onto `f6d0b874`
- Focused validation: TypeScript (`npm run check`) and production build (`npm run build`) on the refreshed tip

## Environment (ephemeral; not production)

- Docker Postgres `postgres:16-alpine`
- Container: `mealscout-lane1-pg-refresh`
- DB: `mealscout_lane1` on host port `55433`
- Production Neon `DATABASE_URL`: **not used / not touched**
- Rescue branch: **not touched**
- GitHub Actions: **not used as release evidence**
- #334–#338 and #322: **not modified and not merged in this move**

## Migration rehearsal results (re-run on refreshed tip)

| Step | Result | Log |
|---|---|---|
| Bootstrap pre-119 `menu_items` shape + seed rows | OK | `01-bootstrap.log` |
| Column absent before apply | OK (0 rows) | `02-pre-migration-column.log` |
| Apply 119 via `psql -f` | OK `ALTER TABLE` | `03-apply-119.log` |
| Column boolean NOT NULL DEFAULT false; seeds default false | OK | `04-verify-column-and-defaults.log` |
| Idempotent re-apply (IF NOT EXISTS) | OK (NOTICE skip) | `05-reapply-idempotent.log` |
| Mixed-version write of `inventory_auto_unavailable=true` | OK | `06-mixed-version-compat.log` |
| Rollback `DROP COLUMN IF EXISTS` | OK; core rows retained | `07-rollback-drop-column.log` |
| Safe roll-forward re-apply 119 | OK; defaults restored false | `08-rollforward-reapply.log`, `09-post-rollforward-verify.log` |

## Rollback / safe roll-forward

- **Rollback:** `ALTER TABLE menu_items DROP COLUMN IF EXISTS inventory_auto_unavailable;`
- **Safe roll-forward:** re-run migration 119 (`ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT FALSE`)
- **Preferred production posture:** leave the additive column in place (default false)

## PASS boundary (what this PR claims)

This PR **claims PASS** for Lane 1 schema/migration foundation only:

1. Additive migration 119 is apply/reapply/rollback/roll-forward safe on ephemeral Postgres 16
2. Schema field matches the migration
3. TypeScript and build succeed on the refreshed tip based on `f6d0b874`

This PR **does not claim** pickup/replay fixtures, Stripe webhook stateful replay, durable idempotency, pickup checkout, merchant delivery, or inventory behavior proofs (lanes 2–5).

## Residual

- Stateful Postgres fixtures remain after lanes 2/3
- Complete #334 only after this PR merges (no Lane 2 port in this move)
