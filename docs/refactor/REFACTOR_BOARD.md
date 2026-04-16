# MealScout Refactor Board

Use this board to track every refactor item from queue to verification.

## Queued

- [ ] [phase-3-storage-split] Split payments/subscriptions methods from `server/storage.ts` into dedicated repository module - PR TBD - owner TBD - 2026-04-14

## In Progress

- [ ] [phase-3-storage-split] Extract payments/subscriptions repository from `server/storage.ts` into `server/storage/paymentsSubscriptionsRepository.ts` - PR-8 - owner codex - 2026-04-15

## Merged

- [x] [phase-5-oversized-route-splits] Extracted supplier orders and payment-intent endpoints (`POST /api/supplier-orders`, `GET /api/supplier/orders`, `GET /api/supplier-orders/mine`, `GET /api/supplier-orders/:orderId`, `PATCH /api/supplier/orders/:orderId/status`, `POST /api/supplier-orders/:orderId/pay-intent`) from `server/routes/supplierMarketplaceRoutes.ts` to `server/routes/suppliers/ordersRoutes.ts` and `server/routes/suppliers/paymentsRoutes.ts`; added supplier route dependency contract at `server/routes/suppliers/shared.ts` - PR-7 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted supplier catalog read endpoints (`GET /api/suppliers`, `GET /api/suppliers/:supplierId`, `GET /api/suppliers/:supplierId/products`) from `server/routes/supplierMarketplaceRoutes.ts` to `server/routes/suppliers/catalogRoutes.ts` - PR-6 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted 2 host profile endpoints (POST /api/hosts, GET /api/hosts/me) from hostRoutes.ts to dedicated hosts/profileRoutes.ts module; created shared utilities (buildLocationKey, buildGeocodeAddress) - PR-4 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted verification admin routes (GET /api/admin/verifications, POST approve, POST reject) from userAdminRoutes.ts to dedicated verificationRoutes.ts module - PR-2 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted deal admin routes (GET /api/admin/deals, GET stats, DELETE, POST clone, PATCH status, PATCH extend) from userAdminRoutes.ts to dedicated dealsRoutes.ts module; created shared utilities (buildLocationKey, buildCanonicalPath, toCountDeltaLine, formatDealValueLabel) - PR-1 - owner codex - 2026-04-15
- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts` - PR TBD - owner codex - 2026-04-14

## Verified

- [x] [phase-5-oversized-route-splits] Extracted supplier orders/payment-intent handlers into dedicated modules and removed monolith duplicates; verified with `npm run check`, `npm run build:server`, `npm run test:supplier-payments` (6/6 passed), `npm run test:supplier-pay-intent-switch` (skip due to missing `TEST_AUTH_COOKIE`/`TEST_SUPPLIER_ORDER_ID`), and `npm run test:flows:with-server` (93.1% with unrelated admin-env gate) - PR-7 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted supplier catalog endpoints to `server/routes/suppliers/catalogRoutes.ts`; `npm run check` and `npm run build:server` passed; `npm run test:flows:with-server` blocked by missing admin credentials env (`MEALSCOUT_ADMIN_EMAIL`/`MEALSCOUT_ADMIN_PASSWORD`) with no type/build regressions from extraction - PR-6 - owner codex - 2026-04-15
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
