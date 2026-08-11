# PR #322 Lane 3 — Pickup checkout and confirmation

Source: `repair/2026-07-28-mealscout-preview-validation` @ `e897188f`
Base: current `origin/main` @ `caa9a566`
Status: **EXTRACTION CHARTER** — full pickupOrderRoutes / checkout UI not ported wholesale (entangled with delivery quote, inventory reservation, Stripe intent recovery, subscription gating).

## Landed in this branch
- `server/services/merchantPromotionService.ts`: `consumePromotionAttribution` optional transaction argument

## Extraction checklist (step 6 before claiming PASS)
| Artifact from PR #322 | Disposition | Notes |
|---|---|---|
| `server/routes/pickupOrderRoutes.ts` | RETAIN (pending surgical port) | Deterministic order IDs, idempotent create, PI recovery via lane 2, inventory reservation, delivery `scheduledFor`. Do not copy subscription-gating that fights free-profile main. |
| `client/src/pages/pickup-checkout.tsx` | RETAIN (pending port) | |
| `client/src/pages/order-confirmation.tsx` | RETAIN (pending port) | |
| `scripts/mealscout-orders-workspace.contract.test.ts` | RETAIN (pending port) | |
| `scripts/mealscout-pickup-order-postgres.integration.test.ts` | RETAIN (pending; with lane 1) | |
| `scripts/testOrderingSubscriptionScope.ts` + package script swap | **SUPERSEDED / REJECT** | Main free-profile ordering tests win |

## Rejected / excluded
- `client/src/App.tsx` wholesale remap — **REJECT**
- `server/routes/actionRoutes.ts` — **EXCLUDE**

## Dependencies
Lane 2 classifier (+ later cancellation/webhook); lane 1/5 inventory; lane 4 optional `getDeliveryQuote(..., scheduledFor)`.

## Proof boundary (not claimed here)
Authoritative totals, stale reconfirmation, order creation, refund and exactly-once notification behavior.
