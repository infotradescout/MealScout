# MealScout Refactor Board

Use this board to track every refactor item from queue to verification.

## Queued

_nothing queued_

## In Progress

_nothing active_

## Merged

- [x] [phase-3-storage-split] Extracted 4 Stripe persistence methods (`updateUserStripeCustomerId`, `updateUserStripeInfo`, `getUserByStripeCustomerId`, `getUserByStripeSubscriptionId`) from `server/storage/usersRepository.ts` into new `server/storage/paymentsSubscriptionsRepository.ts`; `DatabaseStorage` class delegates to new repo; `IStorage` signatures unchanged - PR-8 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted supplier orders and payment-intent endpoints (`POST /api/supplier-orders`, `GET /api/supplier/orders`, `GET /api/supplier-orders/mine`, `GET /api/supplier-orders/:orderId`, `PATCH /api/supplier/orders/:orderId/status`, `POST /api/supplier-orders/:orderId/pay-intent`) from `server/routes/supplierMarketplaceRoutes.ts` to `server/routes/suppliers/ordersRoutes.ts` and `server/routes/suppliers/paymentsRoutes.ts`; added supplier route dependency contract at `server/routes/suppliers/shared.ts` - PR-7 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted supplier catalog read endpoints (`GET /api/suppliers`, `GET /api/suppliers/:supplierId`, `GET /api/suppliers/:supplierId/products`) from `server/routes/supplierMarketplaceRoutes.ts` to `server/routes/suppliers/catalogRoutes.ts` - PR-6 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted 2 host profile endpoints (POST /api/hosts, GET /api/hosts/me) from hostRoutes.ts to dedicated hosts/profileRoutes.ts module; created shared utilities (buildLocationKey, buildGeocodeAddress) - PR-4 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted verification admin routes (GET /api/admin/verifications, POST approve, POST reject) from userAdminRoutes.ts to dedicated verificationRoutes.ts module - PR-2 - owner codex - 2026-04-15
- [x] [phase-5-oversized-route-splits] Extracted deal admin routes (GET /api/admin/deals, GET stats, DELETE, POST clone, PATCH status, PATCH extend) from userAdminRoutes.ts to dedicated dealsRoutes.ts module; created shared utilities (buildLocationKey, buildCanonicalPath, toCountDeltaLine, formatDealValueLabel) - PR-1 - owner codex - 2026-04-15
- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts` - PR TBD - owner codex - 2026-04-14

## Verified

	- [x] [phase-3-storage-split] Extracted payments/subscription persistence methods from `usersRepository.ts` into `server/storage/paymentsSubscriptionsRepository.ts`; verified with `npm run check`, `npm run build:server` (2.3mb, 115ms), `npm run test:supplier-payments` (6/6 passed); `IStorage` public surface unchanged - PR-8 - owner codex - 2026-04-15

## Rolled Back

- [ ] If rollback happens, record item and reason here

## Item Format

Use this one-line format for each item:

- `[phase-x] short title - PR # - owner - YYYY-MM-DD`
