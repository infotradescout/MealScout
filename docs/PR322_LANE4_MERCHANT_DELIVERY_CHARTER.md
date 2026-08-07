# PR #322 Lane 4 — Merchant delivery lifecycle

Source: `repair/2026-07-28-mealscout-preview-validation` @ `e897188f`
Base: current `origin/main` @ `caa9a566`
Status: **CODE EXTRACT** — schedule-aware eligibility + timezone strict resolve + route/docs/tests.

## Landed
- `server/services/deliveryEligibility.ts`
- `server/services/cityTimeZone.ts` (AZ → Phoenix; `resolveCityTimeZoneStrict`)
- `server/routes/merchantDeliveryRoutes.ts`
- `scripts/merchant-delivery-lifecycle.contract.test.ts`
- `client/src/pages/merchant-delivery.tsx` activeModule `delivery`
- `shared/cleanAffiliateLinks.ts` reserved slug
- `MEALSCOUT_ROUTE_MAP.md` + route-map contract mentions

## Rejected
- `client/src/components/business-workspace-shell.tsx` — **REJECT** (main already has delivery module)
- `origin/agent/merchant-delivery-lifecycle` — **SUPERSEDED** by main migration 118 baseline

## Pending
Pickup callers passing `scheduledFor` into `getDeliveryQuote` remain lane 3. Optional arg keeps this branch compilable.

## Proof boundary (not claimed here)
Merchant authority, lifecycle transitions, customer visibility, pickup interaction.
