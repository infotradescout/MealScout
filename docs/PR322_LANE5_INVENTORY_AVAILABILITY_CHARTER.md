# PR #322 Lane 5 — Inventory availability

Source: `repair/2026-07-28-mealscout-preview-validation` @ `e897188f`
Base: current `origin/main` @ `caa9a566`
Status: **PARTIAL EXTRACT** — column + owner-path clears landed; checkout exhaustion SET/restore remains with lanes 2/3.

## Landed
- `migrations/119_menu_inventory_auto_availability.sql`
- `shared/schema/legacy.ts` `inventoryAutoUnavailable`
- `server/routes/menuRoutes.ts` owner update/disable/qty paths clear `inventoryAutoUnavailable`

## Rejected from PR #322 `menuRoutes.ts`
- Ordering subscription-readiness rewrite — **SUPERSEDED / REJECT** vs free-profile main

## Still pending
Checkout path that SETs `inventoryAutoUnavailable=true` on exhaustion — lanes 2–3.

## Proof boundary (not claimed here)
Sold-out/zero-inventory truth, concurrency behavior, migration compatibility.
