# MealScout Refactor Board

Use this board to track every refactor item from queue to verification.

## Queued

- [ ] [phase-3-storage-split] Split payments/subscriptions methods from `server/storage.ts` into dedicated repository module - PR TBD - owner TBD - 2026-04-14

## In Progress

- [ ] [phase-5-oversized-route-splits] Extract supplier marketplace split (orders/payments/catalog) - PR-5 through PR-7 - owner codex - 2026-04-15

## Merged

- [x] [phase-5-oversized-route-splits] Extracted 2 host profile endpoints (POST /api/hosts, GET /api/hosts/me) from hostRoutes.ts to dedicated hosts/profileRoutes.ts module; created shared utilities (buildLocationKey, buildGeocodeAddress) - PR-4 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted verification admin routes (GET /api/admin/verifications, POST approve, POST reject) from userAdminRoutes.ts to dedicated verificationRoutes.ts module - PR-2 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted deal admin routes (GET /api/admin/deals, GET stats, DELETE, POST clone, PATCH status, PATCH extend) from userAdminRoutes.ts to dedicated dealsRoutes.ts module; created shared utilities (buildLocationKey, buildCanonicalPath, toCountDeltaLine, formatDealValueLabel) - PR-1 - owner codex - 2026-04-15
- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts` - PR TBD - owner codex - 2026-04-14

## Verified

- [x] [phase-5-oversized-route-splits] Extracted 2 host profile endpoints to hosts/profileRoutes.ts; verified with `npm run check`, `npm run build:server`, and `npm run test:flows:with-server` (93.1% pass, no regressions) - PR-4 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted 3 verification admin endpoints to verificationRoutes.ts; verified with `npm run check`, `npm run build:server`, and `npm run test:flows:with-server` (93.1% pass, no regressions) - PR-2 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted deal admin routes (6 endpoints) to dealsRoutes.ts; verified with `npm run check`, `npm run build:server`, and `npm run test:flows:with-server` (93.1% pass, deal flows 100%) - PR-1 - owner codex - 2026-04-15
- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts`; verified with `npm run check` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts`; verified with `npm run check` - PR TBD - owner codex - 2026-04-14

## Rolled Back

- [ ] If rollback happens, record item and reason here

## Item Format

Use this one-line format for each item:

- `[phase-x] short title - PR # - owner - YYYY-MM-DD`
