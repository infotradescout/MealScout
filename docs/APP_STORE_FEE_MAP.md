# MealScout App Store Fee Map

## Purpose

Map current monetization/payment flows to likely app-store billing treatment for iOS and Android distributions.

Scope notes:
- This is an implementation guide, not legal advice.
- Apple/Google policies change; final classification should be validated during release review.
- References below point to current live server routes as of 2026-04-26.

## Fee Matrix

| Revenue flow | Current code path | What user is paying for | Likely Apple/Google billing treatment | Store commission risk | Stripe/processor fees |
| --- | --- | --- | --- | --- | --- |
| Business subscription (restaurant owner / truck premium access) | POST /api/create-subscription and related routes in server/routes/subscriptionRoutes.ts | Digital app feature access (premium tooling/access gates) | Typically treated as digital subscription when sold inside app | High if purchased in-app without platform billing | Yes if processed through Stripe today |
| Parking Pass booking (truck pays host price + fixed platform fee) | POST /api/events/:eventId/book in server/routes/eventRoutes.ts | Real-world booking slot / physical location usage | Usually qualifies as real-world service transaction | Low (generally exempt from mandatory in-app billing) | Yes (PaymentIntent + Connect flows) |
| Supplier order checkout | POST /api/supplier-orders and POST /api/supplier-orders/:orderId/pay-intent in server/routes/suppliers/ordersRoutes.ts and server/routes/suppliers/paymentsRoutes.ts | Real-world goods procurement | Usually qualifies as physical goods transaction | Low (generally exempt from mandatory in-app billing) | Yes (PaymentIntent + Connect destination transfers) |
| Host/supplier payouts | Host payout transfer flows in server/routes/hostPayoutAdminRoutes.ts and supplier transfer settlement fields | Platform disbursement to connected accounts | Not a user digital purchase flow | None for app-store commerce | Stripe Connect transfer fees may apply |
| Event booking where payment not required | Interest/booking paths without paid checkout | No direct payment | No store billing event | None | None |

## Flow-Specific Guidance

### 1) Subscription flow (high-risk for store commission)

Current behavior:
- Subscription creation is Stripe-based from app-access paths.
- Premium access is used to gate in-app business features.

Implication for store apps:
- If users can buy this subscription directly inside iOS/Android app UI, expect app-store billing requirements and commission exposure.

Recommended options:
1. Use Apple/Google in-app subscriptions for in-app purchase path.
2. Or shift purchase flow to web-only and keep store app focused on sign-in/use for previously subscribed accounts, with policy-safe UX copy and no prohibited steering language.

### 2) Parking Pass and supplier orders (real-world transactions)

Current behavior:
- Parking Pass and supplier orders are modeled as real-world fulfillment/payments.
- Stripe Connect is used to split funds and pass through seller payouts.

Implication for store apps:
- These are generally compatible with external payment processors (Stripe) without app-store commission, because they pay for real-world goods/services.

Guardrails:
- Keep product copy explicit about real-world fulfillment.
- Avoid framing these flows as digital unlocks/content access.

## Compliance Checklist Before Store Submission

1. Label each purchase entry point in mobile UI as either digital subscription or real-world commerce.
2. For digital subscription entry points, decide and implement platform billing strategy.
3. For real-world commerce entry points, keep fulfillment evidence and terminology clear in app review notes.
4. Remove ambiguous wording that could make real-world flows look like digital feature unlocks.
5. Prepare reviewer notes with endpoint-level behavior summary.

## Endpoint Evidence (Current)

- Subscription:
  - server/routes/subscriptionRoutes.ts
  - POST /api/subscriptions/initialize
  - POST /api/create-subscription
  - POST /api/subscription/customer-portal

- Parking Pass booking payment:
  - server/routes/eventRoutes.ts
  - POST /api/events/:eventId/book

- Supplier order payment:
  - server/routes/suppliers/ordersRoutes.ts
  - POST /api/supplier-orders
  - server/routes/suppliers/paymentsRoutes.ts
  - POST /api/supplier-orders/:orderId/pay-intent

- Payout operations:
  - server/routes/hostPayoutAdminRoutes.ts

## Practical Budget Impact Summary

- If subscription purchases are enabled in-app with platform billing: add store commission impact on that subscription revenue.
- Parking Pass and supplier order pass-through payments should remain processor-fee driven (Stripe), not store-commission driven, under standard real-world commerce treatment.
