# PR #322 Lane 2 — Idempotency and Stripe state transitions

Source: `repair/2026-07-28-mealscout-preview-validation` @ `e897188f`
Base: current `origin/main` @ `caa9a566`
Status: **PARTIAL EXTRACT** — pure PaymentIntent classifier landed; durable webhook/idempotency ports remain charter-only.

## Landed in this branch
- `server/services/pickupOrderPaymentIntentState.ts`
- `scripts/mealscout-pickup-payment-intent-state.behavior.test.ts`
- package.json: additive `test:pickup-payment-intent-state` + prepend to `test:stripe-webhook-safety`

## Extraction checklist (step 6 before claiming PASS)
| Artifact from PR #322 | Disposition | Notes |
|---|---|---|
| `server/middleware/idempotency.ts` durable response gate | RETAIN (pending port) | Replaces localFallback persistence race |
| `server/routes/stripeWebhookRoutes.ts` canceled-intent + attribution | RETAIN (pending port) | Surgical port only; do not wholesale replace |
| `server/services/pickupOrderPaymentCancellation.ts` | RETAIN (pending port) | Needs lane 1 inventoryAutoUnavailable |
| `scripts/mealscout-stripe-webhook-idempotency-guards.contract.test.ts` | RETAIN (pending port) | After middleware/webhook port |
| `scripts/mealscout-stripe-webhook-stateful-replay.integration.test.ts` | RETAIN (pending port) | Shared with lane 1 |
| `scripts/mealscout-payment-webhook-safety-map.contract.test.ts` PR edits | **REJECT** | Conflicts with free-profile main |

## Excluded
- `server/routes/actionRoutes.ts` — trusted-principal lane only

## Proof boundary
- **Proven (unit/contract, step 6 partial):** pure PaymentIntent classifier + match helper via `npm run test:pickup-payment-intent-state` (includes duplicate / stale-terminal / out-of-order-style cases). No real Stripe calls.
- **Not claimed:** full webhook replay (duplicate/stale/out-of-order/terminal) until remaining ports below land.
