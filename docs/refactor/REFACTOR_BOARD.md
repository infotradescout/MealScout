# MealScout Refactor Board

Use this board to track every refactor item from queue to verification.

## Queued

- [ ] [phase-3-storage-split] Split payments/subscriptions methods from `server/storage.ts` into dedicated repository module - PR TBD - owner TBD - 2026-04-14

## In Progress

- [ ] [phase-2-route-composition] Split oversized admin/supplier/host route modules by subdomain (users/moderation/metrics, catalog/orders/payments, profiles/events/parking-pass) - PR TBD - owner TBD - 2026-04-14

## Merged

- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts` - PR TBD - owner codex - 2026-04-14

## Verified

- [x] [phase-2-route-composition] Extracted deal notification/social helper logic from `server/routes.ts` to `server/routes/dealRouteDependencies.ts`; verified with `npm run check` - PR TBD - owner codex - 2026-04-14
- [x] [phase-2-route-composition] Extracted subscription/access-policy helper logic from `server/routes.ts` to `server/routes/accessPolicyDependencies.ts`; verified with `npm run check` - PR TBD - owner codex - 2026-04-14

## Rolled Back

- [ ] If rollback happens, record item and reason here

## Item Format

Use this one-line format for each item:

- `[phase-x] short title - PR # - owner - YYYY-MM-DD`
